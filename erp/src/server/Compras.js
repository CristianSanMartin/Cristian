/**
 * Compras (DISENO.md, secciones 7 y 8).
 *
 * Una compra es la factura real del proveedor. Se arma como un carrito desde
 * Preventas: se marcan las preventas asignadas que vienen en la factura y se
 * completa el N° de factura. Al registrarla:
 *   - cada preventa pasa a "recibida" y deja de figurar como pendiente;
 *   - cada una queda como una línea de la compra (CPI) = un lote del inventario;
 *   - el despacho se decide con la regla del proveedor (Asmodee: gratis desde
 *     $1.000.000 neto) y se prorratea por participación en $ de cada línea,
 *     así el costo de cada unidad lleva su parte del despacho.
 */
const Compras = {
  crear(p, user) {
    const ids = Array.from(new Set((Array.isArray(p.preventas) ? p.preventas : []).map(String)));
    if (!ids.length) throw new AppError('Selecciona al menos una preventa asignada.');
    const pvs = ids.map((id) => {
      const pv = Preventas.requerir(id);
      if (pv.estado !== 'asignada' || !(pv.asignado > 0)) {
        throw new AppError('La preventa ' + pv.id + ' no está asignada: solo se facturan preventas con cantidad asignada.');
      }
      return pv;
    });
    if (new Set(pvs.map((pv) => pv.proveedorId)).size > 1) throw new AppError('Todas las preventas de una factura deben ser del mismo proveedor.');
    const prov = Proveedores.requerir(pvs[0].proveedorId);

    const factura = Util.texto(p.factura, 'El N° de factura', { requerido: true, max: 40 });
    const repetida = Db.all('Compras').find((c) => c.proveedorId === prov.id && Util.normalizar(c.factura) === Util.normalizar(factura));
    if (repetida) throw new AppError('La factura ' + factura + ' de ' + prov.nombre + ' ya está registrada (' + repetida.id + ').');
    const fecha = Util.fecha(p.fecha, 'La fecha de la factura', { requerido: true });
    const notas = Util.texto(p.notas, 'Las notas', { max: 500 });

    const neto = pvs.reduce((s, pv) => s + pv.asignado * pv.costoNeto, 0);
    const despacho = p.despacho === '' || p.despacho == null
      ? Economia.despacho(prov, neto).monto
      : Util.monto(p.despacho, 'El despacho');

    const sello = Util.sello(user, true);
    const compra = Object.assign({ id: Util.siguienteId('CP', 4), proveedorId: prov.id, factura: factura, fecha: fecha, despacho: despacho, notas: notas }, sello);
    const lineas = pvs.map((pv) => {
      const netoLinea = pv.asignado * pv.costoNeto;
      return Object.assign({
        id: Util.siguienteId('CPI', 6), compraId: compra.id, preventaId: pv.id, productoId: pv.productoId,
        cantidad: pv.asignado, costoNeto: pv.costoNeto,
        // Despacho de la línea = despacho × neto línea ÷ neto de la factura.
        despacho: neto ? despacho * netoLinea / neto : 0,
      }, sello);
    });
    Db.insert('Compras', compra);
    Db.insertMany('Compras_Lineas', lineas);
    pvs.forEach((pv) => Db.update('Preventas', pv.id, Object.assign({ estado: 'recibida' }, Util.sello(user))));
    Audit.log(user, 'crear', 'Compra', compra.id, {
      proveedor: prov.nombre, factura: factura, neto: neto, despacho: despacho, preventas: ids.join(', '),
    });
    return compra;
  },

  /**
   * Corrige una factura (administrador): N°, fecha, despacho y precio unitario neto de cada
   * línea. El despacho se vuelve a repartir por participación en $, y el costo de lo ya vendido
   * o entregado de esos lotes se actualiza (es una corrección, no un cambio de precio).
   * p: { id, factura?, fecha?, despacho, lineas: [{ id, costoNeto, cantidad? }] }
   */
  editar(p, user) {
    const compra = Compras.requerir(p.id);
    const lineas = Db.all('Compras_Lineas').filter((l) => l.compraId === compra.id);
    const nuevos = {};
    const cantidades = {};
    const usadas = Ventas.vendidasPorLote();
    (Array.isArray(p.lineas) ? p.lineas : []).forEach((x) => {
      const l = lineas.find((y) => y.id === String(x.id));
      if (!l) throw new AppError('La línea ' + x.id + ' no es de la factura ' + compra.factura + '.');
      nuevos[l.id] = Util.monto(x.costoNeto, 'El precio unitario', { requerido: true });
      if (x.cantidad != null && x.cantidad !== '') {
        // La cantidad se puede corregir, pero nunca por debajo de lo ya vendido o entregado.
        const cant = Util.entero(x.cantidad, 'La cantidad', { min: 1 });
        if (cant < (usadas[l.id] || 0)) throw new AppError('No puedes dejar ' + cant + ' unidades en la línea ' + l.id + ': ya salieron ' + usadas[l.id] + ' (ventas y entregas).');
        cantidades[l.id] = cant;
      }
    });
    const factura = p.factura == null ? compra.factura : Util.texto(p.factura, 'El N° de factura', { requerido: true, max: 40 });
    const repetida = Db.all('Compras').find((c) => c.id !== compra.id && c.proveedorId === compra.proveedorId && Util.normalizar(c.factura) === Util.normalizar(factura));
    if (repetida) throw new AppError('La factura ' + factura + ' de ese proveedor ya está registrada (' + repetida.id + ').');
    const fecha = p.fecha == null ? compra.fecha : Util.fecha(p.fecha, 'La fecha de la factura', { requerido: true });
    const despacho = Util.monto(p.despacho, 'El despacho');
    const costoNeto = (l) => (l.id in nuevos ? nuevos[l.id] : l.costoNeto);
    const cantidad = (l) => (l.id in cantidades ? cantidades[l.id] : l.cantidad);
    const neto = lineas.reduce((t, l) => t + cantidad(l) * costoNeto(l), 0);
    const sello = Util.sello(user);
    const cambios = {};
    const costoUnidad = {};
    lineas.forEach((l) => {
      const desp = neto ? despacho * cantidad(l) * costoNeto(l) / neto : 0;
      cambios[l.id] = Object.assign({ cantidad: cantidad(l), costoNeto: costoNeto(l), despacho: desp }, sello);
      costoUnidad[l.id] = cantidad(l) ? costoNeto(l) + desp / cantidad(l) : costoNeto(l);
    });
    Db.update('Compras', compra.id, Object.assign({ factura: factura, fecha: fecha, despacho: despacho }, sello));
    if (lineas.length) Db.actualizarVarios('Compras_Lineas', cambios);
    // Lo ya vendido o entregado de estos lotes pasa a tener el costo corregido.
    const vl = {};
    Db.all('Ventas_Lineas').forEach((l) => { if (l.loteId in costoUnidad && Math.abs(l.costo - costoUnidad[l.loteId]) > 0.001) vl[l.id] = { costo: costoUnidad[l.loteId] }; });
    if (Object.keys(vl).length) Db.actualizarVarios('Ventas_Lineas', vl);
    const sal = {};
    Db.all('Salidas').forEach((x) => { if (x.loteId in costoUnidad && Math.abs(x.costo - costoUnidad[x.loteId]) > 0.001) sal[x.id] = { costo: costoUnidad[x.loteId] }; });
    if (Object.keys(sal).length) Db.actualizarVarios('Salidas', sal);
    Audit.log(user, 'editar', 'Compra', compra.id, {
      factura: factura, fecha: fecha, despachoAntes: compra.despacho, despacho: despacho,
      lineas: lineas.map((l) => l.id + ' ' + l.costoNeto + '→' + costoNeto(l) + (cantidad(l) !== l.cantidad ? ' · ' + l.cantidad + '→' + cantidad(l) + ' u.' : '')).join(', '), ventasCorregidas: Object.keys(vl).length,
    });
  },

  /**
   * Agrega un producto a una factura ya registrada (corrección de la puesta en marcha). Se crea
   * con el mismo estándar que una compra normal: su preventa (recibida, asignada = cantidad), el lote
   * del inventario y el despacho vuelto a repartir entre todas las líneas.
   * p: { compraId, productoId | producto (texto), cantidad, costoNeto, pvp? }
   */
  agregarLinea(p, user) {
    const compra = Compras.requerir(p.compraId);
    const cantidad = Util.entero(p.cantidad, 'La cantidad', { requerido: true, min: 1 });
    const costoNeto = Util.monto(p.costoNeto, 'El precio unitario neto', { requerido: true });
    if (!p.productoId) Util.texto(p.producto, 'El producto', { requerido: true, max: 200 });
    const prod = p.productoId ? Productos.requerir(p.productoId) : Productos.resolverTexto(p.producto, p.pvp, user);
    if (!prod.activo) throw new AppError('El producto está archivado.');
    const sello = Util.sello(user, true);
    const pv = Object.assign({
      id: Util.siguienteId('PVI', 6), proveedorId: compra.proveedorId, productoId: prod.id, lanzamiento: compra.fecha,
      solicitado: cantidad, asignado: cantidad, estado: 'recibida', costoNeto: costoNeto,
      notas: 'Agregado a la factura ' + compra.factura + ' (corrección)',
    }, sello);
    Db.insert('Preventas', pv);
    const linea = Object.assign({ id: Util.siguienteId('CPI', 6), compraId: compra.id, preventaId: pv.id, productoId: prod.id, cantidad: cantidad, costoNeto: costoNeto, despacho: 0 }, sello);
    Db.insert('Compras_Lineas', linea);
    // Reparte de nuevo el despacho de la factura entre todas sus líneas (y corrige el costo de lo vendido).
    Compras.editar({ id: compra.id, despacho: compra.despacho, lineas: [] }, user);
    Audit.log(user, 'agregar producto', 'Compra', compra.id, { producto: Productos.nombreCompleto(prod), cantidad: cantidad, costoNeto: costoNeto, lote: linea.id, preventa: pv.id });
    return { lote: linea.id, preventa: pv.id, productoId: prod.id };
  },

  /** Deshace una factura mal ingresada: sus preventas vuelven a "asignada" y los lotes salen del inventario. */
  anular(p, user) {
    const compra = Compras.requerir(p.id);
    const lineas = Db.all('Compras_Lineas').filter((l) => l.compraId === compra.id);
    const vendidas = Ventas.vendidasPorLote();
    if (lineas.some((l) => vendidas[l.id])) {
      throw new AppError('La factura ' + compra.factura + ' tiene productos vendidos: anula primero esas ventas.');
    }
    lineas.forEach((l) => {
      const pv = Db.get('Preventas', l.preventaId);
      if (pv) Db.update('Preventas', pv.id, Object.assign({ estado: 'asignada' }, Util.sello(user)));
    });
    lineas.forEach((l) => Db.remove('Compras_Lineas', l.id));
    Db.remove('Compras', compra.id);
    Audit.log(user, 'anular', 'Compra', compra.id, { factura: compra.factura, lineas: lineas.map((l) => l.preventaId).join(', ') });
  },

  /**
   * Quita un producto (lote) de una factura: para corregir una línea que no debía estar
   * (por ejemplo, una fila de totales que se coló en la migración). Sus salidas se anulan,
   * su preventa vuelve a "asignada" y el despacho se reparte entre las líneas que quedan.
   * Si era la única línea, se borra la factura completa.
   */
  quitarLinea(p, user) {
    const lote = Db.get('Compras_Lineas', String(p.id || ''));
    if (!lote) throw new AppError('Ese producto ya no está en la factura.', 'NO_ENCONTRADO');
    const compra = Compras.requerir(lote.compraId);
    const anuladas = {};
    Db.all('Ventas').forEach((v) => { if (v.anulada) anuladas[v.id] = true; });
    const ocs = Array.from(new Set(Db.all('Ventas_Lineas').filter((l) => l.loteId === lote.id && !anuladas[l.ventaId]).map((l) => l.ventaId)));
    if (ocs.length) throw new AppError('Este producto tiene ventas (' + ocs.join(', ') + '): anula primero esas ventas en Ventas.');
    const sello = Util.sello(user);
    const salidas = Db.all('Salidas').filter((x) => x.loteId === lote.id && !x.anulada);
    if (salidas.length) Db.actualizarVarios('Salidas', salidas.reduce((o, x) => { o[x.id] = Object.assign({ anulada: true }, sello); return o; }, {}));
    if (lote.preventaId) {
      const pv = Db.get('Preventas', lote.preventaId);
      if (pv) Db.update('Preventas', pv.id, Object.assign({ estado: 'asignada' }, sello));
    }
    Db.remove('Compras_Lineas', lote.id);
    const resto = Db.all('Compras_Lineas').filter((l) => l.compraId === compra.id);
    if (!resto.length) {
      Db.remove('Compras', compra.id);
    } else if (compra.despacho) {
      const neto = resto.reduce((t, l) => t + l.cantidad * l.costoNeto, 0);
      Db.actualizarVarios('Compras_Lineas', resto.reduce((o, l) => {
        o[l.id] = Object.assign({ despacho: neto ? compra.despacho * l.cantidad * l.costoNeto / neto : 0 }, sello);
        return o;
      }, {}));
    }
    Audit.log(user, 'quitar producto', 'Compra', compra.id, {
      factura: compra.factura, lote: lote.id, productoId: lote.productoId, cantidad: lote.cantidad, salidasAnuladas: salidas.length, facturaBorrada: !resto.length,
    });
  },

  /** Pago (total o parcial) de una factura al proveedor. Cuenta en el flujo de Finanzas en su fecha. */
  registrarPago(p, user) {
    const compra = Compras.requerir(p.compraId);
    const pago = Object.assign({
      id: Util.siguienteId('PAG', 5), compraId: compra.id,
      fecha: Util.fecha(p.fecha, 'La fecha del pago', { requerido: true }),
      monto: Util.entero(p.monto, 'El monto del pago', { requerido: true, min: 1, max: Compras._porPagar(compra) }),
      cuenta: p.cuenta ? Util.opcion(p.cuenta, 'La cuenta', Object.keys(CUENTAS)) : '',
      notas: Util.texto(p.notas, 'Las notas', { max: 300 }),
      anulado: false,
    }, Util.sello(user, true));
    Db.insert('Pagos_Facturas', pago);
    Audit.log(user, 'pago', 'Compra', compra.id, { pago: pago.id, monto: pago.monto, fecha: pago.fecha, cuenta: pago.cuenta });
    return pago;
  },

  anularPago(p, user) {
    const pago = Db.get('Pagos_Facturas', String(p.id || ''));
    if (!pago) throw new AppError('El pago no existe.', 'NO_ENCONTRADO');
    if (pago.anulado) throw new AppError('El pago ' + pago.id + ' ya está anulado.');
    Db.update('Pagos_Facturas', pago.id, Object.assign({ anulado: true }, Util.sello(user)));
    Audit.log(user, 'anular pago', 'Compra', pago.compraId, { pago: pago.id, monto: pago.monto });
  },

  /**
   * Cambia la factura a la que corresponde un pago (enlace equivocado). Sirve para los pagos registrados
   * en Compras y para los conciliados desde la caja diaria; mueve también la nota "Pago caja …".
   */
  reenlazarPago(p, user) {
    const destino = Compras.requerir(p.compraId);
    const caja = p.origen === 'caja';
    const pago = caja ? Db.get('Migracion_Caja', String(p.id || '')) : Db.get('Pagos_Facturas', String(p.id || ''));
    const m = caja && pago && /^Pago (\S+)$/.exec(pago.migrada || '');
    if (!pago || (caja && !m) || (!caja && pago.anulado)) throw new AppError('El pago no existe.', 'NO_ENCONTRADO');
    const anterior = caja ? m[1] : pago.compraId;
    if (anterior === destino.id) throw new AppError('El pago ya está enlazado a ' + destino.id + '.');
    const monto = caja ? pago.salidas : pago.monto;
    if (caja) {
      Db.update('Migracion_Caja', pago.id, { migrada: 'Pago ' + destino.id });
      // La nota de conciliación se va con el pago.
      const nota = 'Pago caja ' + pago.fecha + ' $' + pago.salidas + ' (fila ' + pago.fila + ')';
      const vieja = Db.get('Compras', anterior);
      if (vieja && String(vieja.notas || '').indexOf(nota) !== -1) {
        Db.update('Compras', vieja.id, Object.assign({ notas: vieja.notas.split(' · ').filter((x) => x !== nota).join(' · ') }, Util.sello(user)));
      }
      Db.update('Compras', destino.id, Object.assign({ notas: [destino.notas, nota].filter(Boolean).join(' · ').slice(0, 500) }, Util.sello(user)));
    } else {
      Db.update('Pagos_Facturas', pago.id, Object.assign({ compraId: destino.id }, Util.sello(user)));
    }
    Audit.log(user, 'reenlazar pago', 'Compra', destino.id, { pago: pago.id, origen: caja ? 'caja' : 'manual', antes: anterior, monto: monto });
    return { compraId: destino.id };
  },

  /** Lo que falta pagar de una factura (total con IVA − pagos), redondeado hacia arriba. */
  _porPagar(compra) {
    const lineas = Db.all('Compras_Lineas').filter((l) => l.compraId === compra.id);
    const total = (lineas.reduce((t, l) => t + l.cantidad * l.costoNeto, 0) + compra.despacho) * (1 + APP.iva);
    const pagado = Compras.pagos().filter((x) => x.compraId === compra.id).reduce((t, x) => t + x.monto, 0);
    return Math.max(0, Math.ceil(total - pagado));
  },

  /** Todos los pagos de facturas: los registrados en Compras y los conciliados desde la caja diaria. */
  pagos() {
    const manuales = Db.all('Pagos_Facturas').filter((x) => !x.anulado)
      .map((x) => ({ id: x.id, compraId: x.compraId, fecha: x.fecha, monto: x.monto, cuenta: x.cuenta, notas: x.notas, origen: 'manual' }));
    const caja = MigracionCaja.pagosFacturas().map((x) => Object.assign({ origen: 'caja', cuenta: '' }, x));
    return manuales.concat(caja).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  },

  requerir(id) {
    const c = Db.get('Compras', String(id || ''));
    if (!c) throw new AppError('La compra no existe.', 'NO_ENCONTRADO');
    return c;
  },

  /**
   * Compras con sus líneas y totales, y el inventario (un lote por línea) con el
   * resultado económico V4 por unidad: costo = neto + despacho prorrateado.
   */
  vista(productos, proveedores, porLote) {
    porLote = porLote || {};
    const prodPorId = {};
    productos.forEach((x) => { prodPorId[x.id] = x; });
    const provPorId = {};
    proveedores.forEach((x) => { provPorId[x.id] = x; });
    const compraPorId = {};
    const compras = Db.all('Compras').map((c) => {
      const prov = provPorId[c.proveedorId];
      compraPorId[c.id] = Object.assign(c, { proveedor: prov ? prov.nombre : '(proveedor eliminado)', lineas: [] });
      return c;
    });

    // Lotes de ajuste: unidades de más encontradas en una toma de inventario.
    const tomaPorId = {};
    Db.all('Tomas').forEach((t) => { tomaPorId[t.id] = t; });
    const lotes = Db.all('Compras_Lineas').map((l) => {
      const toma = tomaPorId[l.compraId];
      const c = compraPorId[l.compraId] || (toma ? { factura: 'Ajuste ' + toma.id, fecha: toma.fecha, proveedorId: '', proveedor: 'Toma de inventario', ajuste: true } : null);
      const prod = prodPorId[l.productoId] || { nombre: '(producto eliminado)', edicion: '', idioma: '', tipo: '', pvp: 0 };
      const precio = Productos.precio(prod);
      const costo = l.cantidad ? l.costoNeto + l.despacho / l.cantidad : l.costoNeto;
      const e = Economia.unidad(costo, precio);
      const vendido = porLote[l.id] || { vendidas: 0, ventas: 0, ganancia: 0, unidades: [] };
      const salidas = vendido.salidas || 0;
      const disponible = l.cantidad - vendido.vendidas - salidas;
      const lote = Object.assign(l, {
        factura: c ? c.factura : '',
        fecha: c ? c.fecha : '',
        proveedorId: c ? c.proveedorId : '',
        proveedor: c ? c.proveedor : '',
        producto: Productos.nombreCompleto(prod),
        productoNombre: prod.nombre,
        edicion: prod.edicion,
        idioma: prod.idioma,
        tipo: prod.tipo,
        imagen: prod.imagen || '',
        netoLinea: l.cantidad * l.costoNeto,
        despachoUnidad: l.cantidad ? l.despacho / l.cantidad : 0,
        costo: costo,
        credito: e.credito,
        valorUnitario: e.valorUnitario,
        precioVenta: precio,
        ventaNeta: e.ventaNeta,
        debito: e.debito,
        pagoSii: e.pagoSii,
        gananciaUnidad: e.ganancia,
        // Lo vendido de este lote: unidades, venta bruta y ganancia realizada (al precio real de cada venta).
        vendidas: vendido.vendidas,
        ventasAcumuladas: vendido.ventas,
        gananciaAcumulada: vendido.ganancia,
        unidadesVendidas: vendido.unidades,
        salidas: salidas,
        costoSalidas: vendido.costoSalidas || 0,
        disponible: disponible,
        valorInventario: disponible * costo,
        gananciaProyectada: disponible * e.ganancia,
        ventaProyectada: disponible * precio,
      });
      if (c && !c.ajuste) c.lineas.push(lote);
      return lote;
    });

    const pagosPorCompra = {};
    Compras.pagos().forEach((x) => { (pagosPorCompra[x.compraId] = pagosPorCompra[x.compraId] || []).push(x); });
    compras.forEach((c) => {
      c.netoProductos = c.lineas.reduce((s, l) => s + l.netoLinea, 0);
      c.unidades = c.lineas.reduce((s, l) => s + l.cantidad, 0);
      c.neto = c.netoProductos + c.despacho;
      c.iva = c.neto * APP.iva;
      c.total = c.neto + c.iva;
      const prov = provPorId[c.proveedorId];
      c.despachoGratisDesde = prov ? prov.despachoUmbral : 0;
      // Resultado de la factura: lo vendido hasta ahora y si ya se vendió todo lo comprado.
      const suma = (k) => c.lineas.reduce((s, l) => s + l[k], 0);
      c.vendidas = suma('vendidas');
      c.salidas = suma('salidas');
      c.ventasAcumuladas = suma('ventasAcumuladas');
      c.gananciaAcumulada = suma('gananciaAcumulada');
      c.gananciaProyectada = c.lineas.reduce((s, l) => s + l.cantidad * l.gananciaUnidad, 0);
      const salieron = c.vendidas + c.salidas;
      c.estadoVenta = salieron === 0 ? 'sin_ventas' : salieron < c.unidades ? 'vendiendo' : 'vendida';
      c.pagos = pagosPorCompra[c.id] || [];
      c.pagado = c.pagos.reduce((s, x) => s + x.monto, 0);
      c.porPagar = Math.max(0, Math.round(c.total - c.pagado));
    });
    compras.sort((a, b) => (b.fecha + b.id).localeCompare(a.fecha + a.id));
    lotes.sort((a, b) => (a.fecha + a.id).localeCompare(b.fecha + b.id));
    return { compras: compras, lotes: lotes };
  },
};
