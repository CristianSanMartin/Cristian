/**
 * Preventas: pedidos comprometidos con proveedores antes de convertirse en stock.
 *
 * Ciclo de vida: pedido -> transito -> recibida (o cancelada).
 * El estado de pago (pendiente / parcial / pagado) se deriva de los abonos
 * registrados en la hoja Pagos, así nunca contradice los montos.
 */
const Preventas = {
  guardar(p, user) {
    const id = p.id ? String(p.id) : '';
    const actual = id ? Preventas.requerir(id) : null;
    if (actual && (actual.estado === 'recibida' || actual.estado === 'cancelada')) {
      return Preventas._guardarNotas(actual, p, user);
    }

    const prod = Productos.requerir(p.productoId);
    if (!prod.activo && (!actual || actual.productoId !== prod.id)) throw new AppError('El producto está archivado.');
    const datos = {
      productoId: prod.id,
      proveedor: Util.texto(p.proveedor, 'El proveedor', { requerido: true, max: 120 }),
      cantidad: Util.entero(p.cantidad, 'La cantidad', { requerido: true, min: 1 }),
      costoUnit: Util.entero(p.costoUnit, 'El costo unitario', { requerido: true }),
      precioVenta: Util.entero(p.precioVenta, 'El precio de venta estimado'),
      fechaPedido: Util.fecha(p.fechaPedido, 'La fecha de pedido', { defecto: Util.hoy() }),
      fechaLlegada: Util.fecha(p.fechaLlegada, 'La fecha estimada de llegada', { requerido: true }),
      estado: Util.opcion(p.estado || 'pedido', 'El estado', ['pedido', 'transito']),
      notas: Util.texto(p.notas, 'Las notas', { max: 1000 }),
    };
    if (datos.fechaLlegada < datos.fechaPedido) throw new AppError('La llegada estimada no puede ser anterior a la fecha de pedido.');
    const total = datos.cantidad * datos.costoUnit;
    const ahora = Util.ahora();

    if (actual) {
      const abonado = Preventas.abonado(actual.id);
      if (abonado > total) throw new AppError('El nuevo total (' + total + ') es menor a lo ya abonado (' + abonado + ').');
      const nuevo = Db.update('Preventas', id, Object.assign(datos, { actualizadoEn: ahora, actualizadoPor: user.email }));
      Audit.log(user, 'editar', 'Preventa', id, Audit.diff(actual, nuevo));
      return nuevo;
    }

    const abonoInicial = Util.entero(p.abonoInicial, 'El abono inicial');
    if (abonoInicial > total) throw new AppError('El abono inicial no puede superar el total de la preventa.');
    const nuevo = Object.assign({
      id: Util.uuid(),
      folio: Util.siguienteCodigo('PV', Db.all('Preventas').map((x) => x.folio)),
      cantidadRecibida: 0, fechaRecepcion: '',
      creadoEn: ahora, creadoPor: user.email, actualizadoEn: ahora, actualizadoPor: user.email,
    }, datos);
    Db.insert('Preventas', nuevo);
    Audit.log(user, 'crear', 'Preventa', nuevo.id, { folio: nuevo.folio, producto: prod.nombre, cantidad: nuevo.cantidad, total: total });
    if (abonoInicial > 0) {
      Preventas._insertarPago(nuevo, { fecha: datos.fechaPedido, monto: abonoInicial, medio: p.medioPago || 'Transferencia', nota: 'Abono inicial' }, user);
    }
    return nuevo;
  },

  /** En preventas cerradas solo se permite corregir las notas. */
  _guardarNotas(actual, p, user) {
    const notas = Util.texto(p.notas, 'Las notas', { max: 1000 });
    const nuevo = Db.update('Preventas', actual.id, { notas: notas, actualizadoEn: Util.ahora(), actualizadoPor: user.email });
    Audit.log(user, 'editar', 'Preventa', actual.id, Audit.diff(actual, nuevo));
    return nuevo;
  },

  registrarPago(p, user) {
    const pv = Preventas.requerir(p.preventaId);
    if (pv.estado === 'cancelada') throw new AppError('La preventa está cancelada.');
    const monto = Util.entero(p.monto, 'El monto', { requerido: true, min: 1 });
    const saldo = pv.cantidad * pv.costoUnit - Preventas.abonado(pv.id);
    if (monto > saldo) throw new AppError('El monto supera el saldo pendiente (' + saldo + ').');
    return Preventas._insertarPago(pv, {
      fecha: Util.fecha(p.fecha, 'La fecha', { defecto: Util.hoy() }),
      monto: monto,
      medio: Util.opcion(p.medio || 'Transferencia', 'El medio de pago', MEDIOS_PAGO),
      nota: Util.texto(p.nota, 'La nota', { max: 300 }),
    }, user);
  },

  _insertarPago(pv, datos, user) {
    const pago = Object.assign({ id: Util.uuid(), preventaId: pv.id, creadoEn: Util.ahora(), creadoPor: user.email }, datos);
    Db.insert('Pagos', pago);
    Audit.log(user, 'pago', 'Preventa', pv.id, { folio: pv.folio, monto: pago.monto, medio: pago.medio, fecha: pago.fecha });
    return pago;
  },

  eliminarPago(p, user) {
    const pago = Db.get('Pagos', String(p.id || ''));
    if (!pago) throw new AppError('El pago no existe.', 'NO_ENCONTRADO');
    Db.remove('Pagos', pago.id);
    Audit.log(user, 'eliminar pago', 'Preventa', pago.preventaId, pago);
  },

  /** Recepción: la mercadería entra al inventario al costo de la preventa. */
  recibir(p, user) {
    const pv = Preventas.requerir(p.id);
    if (pv.estado === 'recibida') throw new AppError('La preventa ya fue recibida.');
    if (pv.estado === 'cancelada') throw new AppError('La preventa está cancelada.');
    const prod = Productos.requerir(pv.productoId);
    const cantidad = Util.entero(p.cantidadRecibida, 'La cantidad recibida', { requerido: true, min: 1, max: pv.cantidad });
    const fecha = Util.fecha(p.fecha, 'La fecha de recepción', { defecto: Util.hoy() });
    const nota = Util.texto(p.nota, 'La nota', { max: 500 });

    Inventario.entradaPorPreventa(pv, cantidad, fecha, user);
    const notas = nota ? (pv.notas ? pv.notas + '\n' : '') + 'Recepción: ' + nota : pv.notas;
    Db.update('Preventas', pv.id, {
      estado: 'recibida', cantidadRecibida: cantidad, fechaRecepcion: fecha, notas: notas,
      actualizadoEn: Util.ahora(), actualizadoPor: user.email,
    });
    Audit.log(user, 'recibir', 'Preventa', pv.id, { folio: pv.folio, producto: prod.nombre, cantidad: cantidad, pedida: pv.cantidad });
  },

  /** Deshace una recepción errónea: quita la entrada del inventario y vuelve la preventa a "En tránsito". */
  anularRecepcion(p, user) {
    const pv = Preventas.requerir(p.id);
    if (pv.estado !== 'recibida') throw new AppError('La preventa no está recibida.');
    const movs = Db.all('Movimientos').filter((m) => m.tipo === 'entrada_preventa' && m.refId === pv.id);
    movs.forEach((m) => Inventario._validarReversion(m));
    movs.forEach((m) => Db.remove('Movimientos', m.id));
    Db.update('Preventas', pv.id, {
      estado: 'transito', cantidadRecibida: 0, fechaRecepcion: '', actualizadoEn: Util.ahora(), actualizadoPor: user.email,
    });
    Audit.log(user, 'anular recepción', 'Preventa', pv.id, { folio: pv.folio, cantidad: pv.cantidadRecibida });
  },

  cancelar(p, user) {
    const pv = Preventas.requerir(p.id);
    if (pv.estado === 'recibida') throw new AppError('No se puede cancelar una preventa recibida; anula la recepción primero.');
    if (pv.estado === 'cancelada') throw new AppError('La preventa ya está cancelada.');
    const motivo = Util.texto(p.motivo, 'El motivo', { requerido: true, max: 300 });
    Db.update('Preventas', pv.id, {
      estado: 'cancelada', notas: (pv.notas ? pv.notas + '\n' : '') + 'Cancelada: ' + motivo,
      actualizadoEn: Util.ahora(), actualizadoPor: user.email,
    });
    Audit.log(user, 'cancelar', 'Preventa', pv.id, { folio: pv.folio, motivo: motivo, abonado: Preventas.abonado(pv.id) });
  },

  eliminar(p, user) {
    const pv = Preventas.requerir(p.id);
    if (pv.estado === 'recibida') throw new AppError('No se puede eliminar una preventa recibida.');
    if (Preventas.abonado(pv.id) > 0) throw new AppError('La preventa tiene abonos registrados; cancélala en lugar de eliminarla.');
    Db.remove('Preventas', pv.id);
    Audit.log(user, 'eliminar', 'Preventa', pv.id, pv);
  },

  abonado(preventaId) {
    return Db.all('Pagos').filter((x) => x.preventaId === preventaId).reduce((s, x) => s + x.monto, 0);
  },

  estadoPago(total, abonado) {
    if (total <= 0) return 'pagado';
    if (abonado <= 0) return 'pendiente';
    return abonado >= total ? 'pagado' : 'parcial';
  },

  requerir(id) {
    const pv = Db.get('Preventas', String(id || ''));
    if (!pv) throw new AppError('La preventa no existe.', 'NO_ENCONTRADO');
    return pv;
  },
};
