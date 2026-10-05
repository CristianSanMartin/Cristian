/**
 * Finanzas: movimientos de caja que no son una venta ni una factura de compra.
 * Ingresos: aportes de capital (subcategoría = socio), otros ingresos.
 * Egresos: compras por monto (singles por lote, bazar, mercadería sin inventario),
 * GAV, GOPM, pagos al SII, comisiones, retiros.
 *
 * El resumen mensual (ventas, compras, gastos y resultado) se arma en la pantalla
 * con las ventas, las facturas de compra y estos movimientos.
 */
const Finanzas = {
  validar(p) {
    const tipo = Util.opcion(p.tipo, 'El tipo', Object.keys(CATEGORIAS_MOVIMIENTO));
    return {
      fecha: Util.fecha(p.fecha, 'La fecha', { requerido: true }),
      tipo: tipo,
      categoria: Util.opcion(p.categoria, 'La categoría', Object.keys(CATEGORIAS_MOVIMIENTO[tipo])),
      subcategoria: Util.texto(p.subcategoria, 'El detalle', { max: 120 }),
      monto: Util.entero(p.monto, 'El monto', { requerido: true, min: 1 }),
      cuenta: p.cuenta ? Util.opcion(p.cuenta, 'La cuenta', Object.keys(CUENTAS)) : '',
      referencia: Util.texto(p.referencia, 'La referencia', { max: 80 }),
      notas: Util.texto(p.notas, 'Las notas', { max: 300 }),
    };
  },

  guardar(p, user) {
    const datos = Finanzas.validar(p);
    if (p.id) {
      const actual = Finanzas.requerir(p.id);
      if (actual.anulado) throw new AppError('El movimiento ' + actual.id + ' está anulado.');
      Audit.log(user, 'editar', 'Movimiento', actual.id, Audit.diff(actual, Object.assign({}, actual, datos)));
      return Db.update('Finanzas', actual.id, Object.assign(datos, Util.sello(user)));
    }
    const mov = Object.assign({ id: Util.siguienteId('MOV', 5), anulado: false }, datos, Util.sello(user, true));
    Db.insert('Finanzas', mov);
    Audit.log(user, 'crear', 'Movimiento', mov.id, { tipo: mov.tipo, categoria: mov.categoria, monto: mov.monto });
    return mov;
  },

  /**
   * Divide un movimiento en partes del mismo tipo (ej. la salida de un socio: retiro de capital +
   * compra de acciones). La primera parte queda en el movimiento original; las demás son movimientos
   * nuevos con la misma fecha, cuenta y referencia. La suma de las partes debe ser el monto original.
   * p: { id, partes: [{ categoria, subcategoria, monto }] }
   */
  dividir(p, user) {
    const mov = Finanzas.requerir(p.id);
    if (mov.anulado) throw new AppError('El movimiento ' + mov.id + ' está anulado.');
    const partes = (Array.isArray(p.partes) ? p.partes : []).map((x, i) => ({
      categoria: Util.opcion(x.categoria, 'La categoría de la parte ' + (i + 1), Object.keys(CATEGORIAS_MOVIMIENTO[mov.tipo])),
      subcategoria: Util.texto(x.subcategoria, 'El detalle de la parte ' + (i + 1), { max: 120 }),
      monto: Util.entero(x.monto, 'El monto de la parte ' + (i + 1), { requerido: true, min: 1 }),
    }));
    if (partes.length < 2) throw new AppError('Divide el movimiento en al menos dos partes.');
    const suma = partes.reduce((t, x) => t + x.monto, 0);
    if (suma !== mov.monto) throw new AppError('Las partes suman ' + suma + ' y el movimiento es de ' + mov.monto + '.');
    const sello = Util.sello(user);
    Db.update('Finanzas', mov.id, Object.assign({}, partes[0], sello));
    const ids = Util.reservarIds('MOV', 5, partes.length - 1);
    Db.insertMany('Finanzas', partes.slice(1).map((x, i) => Object.assign({
      id: ids[i], fecha: mov.fecha, tipo: mov.tipo, cuenta: mov.cuenta, referencia: mov.referencia,
      notas: ['Dividido de ' + mov.id, mov.notas].filter(Boolean).join(' · ').slice(0, 300), anulado: false,
    }, x, Util.sello(user, true))));
    Audit.log(user, 'dividir', 'Movimiento', mov.id, { monto: mov.monto, partes: partes.map((x, i) => (i ? ids[i - 1] : mov.id) + ' ' + x.categoria + ' ' + x.monto).join(', ') });
    return { id: mov.id, nuevos: ids };
  },

  anular(p, user) {
    const mov = Finanzas.requerir(p.id);
    if (mov.anulado) throw new AppError('El movimiento ' + mov.id + ' ya está anulado.');
    Db.update('Finanzas', mov.id, Object.assign({ anulado: true }, Util.sello(user)));
    Audit.log(user, 'anular', 'Movimiento', mov.id, { monto: mov.monto, categoria: mov.categoria });
  },

  requerir(id) {
    const m = Db.get('Finanzas', String(id || ''));
    if (!m) throw new AppError('El movimiento no existe.', 'NO_ENCONTRADO');
    return m;
  },

  vista() {
    return Db.all('Finanzas').map((m) => Object.assign(m, {
      categoriaLabel: (CATEGORIAS_MOVIMIENTO[m.tipo] || {})[m.categoria] || m.categoria,
      cuentaLabel: CUENTAS[m.cuenta] || '',
    })).sort((a, b) => (b.fecha + b.id).localeCompare(a.fecha + a.id));
  },
};
