/**
 * Ventas (DISENO.md, sección 9).
 *
 * Una venta = una OC correlativa (OC-0001). Sus productos salen del inventario
 * desde el lote más antiguo (FIFO); si una cantidad no cabe en un lote, se
 * reparte en varios, y cada parte queda como una línea con el costo real de
 * su lote. Así cada factura de compra acumula lo vendido y lo ganado.
 *
 * Medio de pago con máquina POS (débito / crédito): la comisión se calcula al
 * vender y se descuenta de la ganancia. Una venta puede quedar pendiente de
 * pago (cuenta por cobrar) y saldarse con abonos (Cobros).
 */
const Ventas = {
  crear(p, user) {
    // Se valida todo antes de escribir: si algo falla no queda ni cliente ni venta a medias.
    const fecha = Util.fecha(p.fecha, 'La fecha de la venta', { requerido: true });
    const canal = Util.opcion(p.canal || 'Tienda', 'El canal', CANALES);
    const evento = Util.texto(p.evento, 'El evento', { max: 120 });
    const medioPago = Util.opcion(p.medioPago || 'efectivo', 'El medio de pago', Object.keys(MEDIOS_PAGO));
    const boleta = Util.texto(p.boleta, 'El N° de boleta', { max: 40 });
    const notas = Util.texto(p.notas, 'Las notas', { max: 500 });
    const entrada = Array.isArray(p.lineas) ? p.lineas : [];
    if (!entrada.length) throw new AppError('Agrega al menos un producto a la venta.');
    if (p.clienteId) Clientes.requerir(p.clienteId);
    else Util.texto(p.cliente, 'El cliente', { max: 120 });

    const lotes = Ventas.lotesDisponibles();
    const lineas = [];
    entrada.forEach((x) => {
      const prod = Productos.requerir(x.productoId);
      const nombre = Productos.nombreCompleto(prod);
      const cantidad = Util.entero(x.cantidad, 'La cantidad de ' + nombre, { requerido: true, min: 1 });
      const precioLista = Productos.precio(prod);
      const precio = x.precio === '' || x.precio == null ? precioLista : Util.entero(x.precio, 'El precio de ' + nombre);
      const suyos = lotes.filter((l) => l.productoId === prod.id && l.disponible > 0);
      const stock = suyos.reduce((t, l) => t + l.disponible, 0);
      if (cantidad > stock) throw new AppError('Stock insuficiente de ' + nombre + ': ' + (stock ? 'quedan ' + stock : 'no hay unidades') + ' en inventario.');
      let falta = cantidad;
      suyos.forEach((l) => {
        if (!falta) return;
        const n = Math.min(falta, l.disponible);
        l.disponible -= n;
        falta -= n;
        lineas.push({ loteId: l.id, productoId: prod.id, cantidad: n, precioLista: precioLista, precio: precio, costo: l.costo });
      });
    });

    const total = lineas.reduce((t, l) => t + l.precio * l.cantidad, 0);
    const pagada = p.pagada !== false;
    const abono = pagada ? total : Util.entero(p.abono, 'El abono', { max: total });
    const regla = COMISIONES_PAGO[medioPago];
    // La comisión se cobra sobre lo pagado con la máquina.
    const comision = regla && abono ? Math.round(abono * regla.pct + regla.fijo) : 0;

    const clienteId = Clientes.resolver(p, user);
    const sello = Util.sello(user, true);
    const venta = Object.assign({
      id: Util.siguienteId('OC', 4), fecha: fecha, clienteId: clienteId, canal: canal, evento: evento, medioPago: medioPago,
      boleta: boleta, abono: abono, comision: comision, anulada: false, notas: notas,
    }, sello);
    Db.insert('Ventas', venta);
    Db.insertMany('Ventas_Lineas', lineas.map((l) => Object.assign({ id: Util.siguienteId('VL', 6), ventaId: venta.id }, l, sello)));
    Audit.log(user, 'crear', 'Venta', venta.id, {
      cliente: clienteId || Clientes.GENERAL, total: total, medioPago: medioPago, abono: abono,
      productos: lineas.map((l) => l.productoId + ' ×' + l.cantidad + ' (' + l.loteId + ')').join(', '),
    });
    return Object.assign({ total: total }, venta);
  },

  /** Anula una venta (administrador): sus unidades vuelven a su lote. La OC no se reutiliza. */
  anular(p, user) {
    const v = Ventas.requerir(p.id);
    if (v.anulada) throw new AppError('La venta ' + v.id + ' ya está anulada.');
    Db.update('Ventas', v.id, Object.assign({ anulada: true }, Util.sello(user)));
    Audit.log(user, 'anular', 'Venta', v.id, { motivo: Util.texto(p.motivo, 'El motivo', { max: 300 }) });
  },

  /** Abono a una venta pendiente de pago. */
  registrarCobro(p, user) {
    const v = Ventas.requerir(p.ventaId);
    if (v.anulada) throw new AppError('La venta ' + v.id + ' está anulada.');
    const saldo = Ventas.saldo(v);
    if (saldo <= 0) throw new AppError('La venta ' + v.id + ' ya está pagada.');
    const cobro = Object.assign({
      id: Util.siguienteId('COB', 6), ventaId: v.id,
      fecha: Util.fecha(p.fecha, 'La fecha del abono', { requerido: true }),
      monto: Util.entero(p.monto, 'El monto del abono', { requerido: true, min: 1, max: saldo }),
      medioPago: Util.opcion(p.medioPago || 'transferencia', 'El medio de pago', Object.keys(MEDIOS_PAGO)),
      notas: Util.texto(p.notas, 'Las notas', { max: 300 }),
    }, Util.sello(user, true));
    Db.insert('Cobros', cobro);
    Audit.log(user, 'abono', 'Venta', v.id, { monto: cobro.monto, medioPago: cobro.medioPago, saldo: saldo - cobro.monto });
    return cobro;
  },

  saldo(v) {
    const total = Db.all('Ventas_Lineas').filter((l) => l.ventaId === v.id).reduce((t, l) => t + l.precio * l.cantidad, 0);
    const cobrado = Db.all('Cobros').filter((c) => c.ventaId === v.id).reduce((t, c) => t + c.monto, 0);
    return total - v.abono - cobrado;
  },

  /** Lotes con su costo unitario real y lo que queda disponible (sin contar ventas anuladas), del más antiguo al más nuevo. */
  lotesDisponibles() {
    const vendidas = Ventas.vendidasPorLote();
    const fechaCompra = {};
    Db.all('Compras').forEach((c) => { fechaCompra[c.id] = c.fecha; });
    return Db.all('Compras_Lineas').map((l) => ({
      id: l.id,
      productoId: l.productoId,
      fecha: fechaCompra[l.compraId] || '',
      costo: l.cantidad ? l.costoNeto + l.despacho / l.cantidad : l.costoNeto,
      disponible: l.cantidad - (vendidas[l.id] || 0),
    })).sort((a, b) => (a.fecha + a.id).localeCompare(b.fecha + b.id));
  },

  vendidasPorLote() {
    const anuladas = {};
    Db.all('Ventas').forEach((v) => { if (v.anulada) anuladas[v.id] = true; });
    const res = {};
    Db.all('Ventas_Lineas').forEach((l) => { if (!anuladas[l.ventaId]) res[l.loteId] = (res[l.loteId] || 0) + l.cantidad; });
    return res;
  },

  requerir(id) {
    const v = Db.get('Ventas', String(id || ''));
    if (!v) throw new AppError('La venta no existe.', 'NO_ENCONTRADO');
    return v;
  },

  /**
   * Ventas con sus líneas y resultado, y lo vendido por lote (para Inventario y el
   * acumulado de cada factura de compra). Las anuladas se muestran pero no cuentan.
   */
  vista(productos, clientes) {
    const prodPorId = {};
    productos.forEach((x) => { prodPorId[x.id] = x; });
    const cliPorId = {};
    clientes.forEach((x) => { cliPorId[x.id] = x; });
    const cobrosPorVenta = {};
    Db.all('Cobros').forEach((c) => { (cobrosPorVenta[c.ventaId] = cobrosPorVenta[c.ventaId] || []).push(c); });
    const ventaPorId = {};
    const ventas = Db.all('Ventas').map((v) => {
      const cli = cliPorId[v.clienteId];
      ventaPorId[v.id] = Object.assign(v, {
        cliente: cli ? cli.nombre : Clientes.GENERAL,
        medioPagoLabel: MEDIOS_PAGO[v.medioPago] || v.medioPago,
        cobros: (cobrosPorVenta[v.id] || []).sort((a, b) => (a.fecha + a.id).localeCompare(b.fecha + b.id)),
        lineas: [],
      });
      return v;
    });

    const porLote = {};
    Db.all('Ventas_Lineas').forEach((l) => {
      const v = ventaPorId[l.ventaId];
      const prod = prodPorId[l.productoId] || { nombre: '(producto eliminado)', edicion: '', idioma: '', imagen: '' };
      const e = Economia.unidad(l.costo, l.precio);
      const linea = Object.assign(l, {
        producto: Productos.nombreCompleto(prod), productoNombre: prod.nombre, edicion: prod.edicion, idioma: prod.idioma, imagen: prod.imagen || '',
        subtotal: l.precio * l.cantidad,
        descuento: (l.precioLista - l.precio) * l.cantidad,
        gananciaUnidad: e.ganancia,
        ganancia: e.ganancia * l.cantidad,
        debito: e.debito * l.cantidad,
      });
      if (v) v.lineas.push(linea);
      if (v && !v.anulada) {
        const r = porLote[l.loteId] = porLote[l.loteId] || { vendidas: 0, ventas: 0, ganancia: 0, unidades: [] };
        r.vendidas += l.cantidad;
        r.ventas += linea.subtotal;
        r.ganancia += linea.ganancia;
        for (let i = 0; i < l.cantidad; i++) r.unidades.push({ oc: v.id, cliente: v.cliente, fecha: v.fecha, precio: l.precio });
      }
    });

    ventas.forEach((v) => {
      v.total = v.lineas.reduce((t, l) => t + l.subtotal, 0);
      v.unidades = v.lineas.reduce((t, l) => t + l.cantidad, 0);
      v.neto = Economia.sinIva(v.total);
      v.iva = v.total - v.neto;
      v.descuento = v.lineas.reduce((t, l) => t + l.descuento, 0);
      v.ganancia = v.lineas.reduce((t, l) => t + l.ganancia, 0);
      v.gananciaNeta = v.ganancia - v.comision;
      v.cobrado = v.abono + v.cobros.reduce((t, c) => t + c.monto, 0);
      v.saldo = v.anulada ? 0 : v.total - v.cobrado;
      v.estadoPago = v.anulada ? 'anulada' : v.saldo <= 0 ? 'pagada' : v.cobrado > 0 ? 'abonada' : 'pendiente';
    });
    ventas.sort((a, b) => (b.fecha + b.id).localeCompare(a.fecha + a.id));
    Object.keys(porLote).forEach((k) => porLote[k].unidades.sort((a, b) => (a.fecha + a.oc).localeCompare(b.fecha + b.oc)));
    return { ventas: ventas, porLote: porLote };
  },
};
