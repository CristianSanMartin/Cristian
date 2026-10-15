/**
 * Salidas de stock que no son venta: uso interno de la tienda, premios, cajas abiertas, pérdidas.
 * Sacan unidades de los lotes más antiguos (igual que una venta) al costo del lote, sin crear OC.
 * El uso interno cuenta como GOPM en el resumen de Finanzas (al costo, con IVA).
 */
const Salidas = {
  registrar(p, user) {
    const prod = Productos.requerir(p.productoId);
    const nombre = Productos.nombreCompleto(prod);
    const cantidad = Util.entero(p.cantidad, 'La cantidad', { requerido: true, min: 1 });
    const motivo = Util.opcion(p.motivo, 'El motivo', Object.keys(MOTIVOS_SALIDA));
    const fecha = Util.fecha(p.fecha, 'La fecha', { requerido: true });
    const notas = Util.texto(p.notas, 'El detalle', { max: 200 });
    const suyos = Ventas.lotesDisponibles().filter((l) => l.productoId === prod.id && l.disponible > 0);
    const stock = suyos.reduce((t, l) => t + l.disponible, 0);
    if (cantidad > stock) throw new AppError('Stock insuficiente de ' + nombre + ': ' + (stock ? 'quedan ' + stock : 'no hay unidades') + ' en inventario.');
    const salidas = [];
    let falta = cantidad;
    suyos.forEach((l) => {
      if (!falta) return;
      const n = Math.min(falta, l.disponible);
      falta -= n;
      salidas.push({ fecha: fecha, motivo: motivo, loteId: l.id, productoId: prod.id, cantidad: n, costo: l.costo, notas: notas, anulada: false });
    });
    const ids = Util.reservarIds('SAL', 6, salidas.length);
    const sello = Util.sello(user, true);
    Db.insertMany('Salidas', salidas.map((x, i) => Object.assign({ id: ids[i] }, x, sello)));
    Audit.log(user, 'salida', 'Producto', prod.id, { motivo: motivo, cantidad: cantidad, salidas: ids, notas: notas });
    return { ids: ids, costo: Math.round(salidas.reduce((t, x) => t + x.costo * x.cantidad, 0)) };
  },

  anular(p, user) {
    const s = Db.get('Salidas', String(p.id || ''));
    if (!s) throw new AppError('La salida no existe.', 'NO_ENCONTRADO');
    if (s.anulada) throw new AppError('La salida ' + s.id + ' ya está anulada.');
    Db.update('Salidas', s.id, Object.assign({ anulada: true }, Util.sello(user)));
    Audit.log(user, 'anular salida', 'Producto', s.productoId, { salida: s.id, cantidad: s.cantidad, motivo: s.motivo });
  },

  /** Las salidas vigentes, para la pantalla (lista en Inventario y GOPM en Finanzas). */
  vista() {
    return Db.all('Salidas').filter((x) => !x.anulada)
      .map((x) => ({ id: x.id, fecha: x.fecha, motivo: x.motivo, motivoLabel: MOTIVOS_SALIDA[x.motivo] || x.motivo, loteId: x.loteId, productoId: x.productoId, cantidad: x.cantidad, costo: x.costo, notas: x.notas }))
      .sort((a, b) => (b.fecha + b.id).localeCompare(a.fecha + a.id));
  },
};
