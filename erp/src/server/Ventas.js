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
    // Las unidades elegidas de un lote específico (desde Inventario) se reservan primero; el resto sale por FIFO.
    entrada.slice().sort((a, b) => (b.loteId ? 1 : 0) - (a.loteId ? 1 : 0)).forEach((x) => {
      // Línea por monto (singles, torneo, bazar…): no descuenta unidades del inventario.
      if (!x.productoId && x.categoria) {
        const categoria = Util.opcion(x.categoria, 'La categoría', CATEGORIAS_VENTA);
        const monto = Util.entero(x.monto, 'El monto de ' + categoria, { requerido: true, min: 1 });
        lineas.push({ loteId: '', productoId: '', cantidad: 1, precioLista: monto, precio: monto, costo: 0, categoria: categoria, descripcion: Util.texto(x.descripcion, 'La descripción', { max: 120 }) });
        return;
      }
      const prod = Productos.requerir(x.productoId);
      const nombre = Productos.nombreCompleto(prod);
      const cantidad = Util.entero(x.cantidad, 'La cantidad de ' + nombre, { requerido: true, min: 1 });
      const precioLista = Productos.precio(prod);
      const precio = x.precio === '' || x.precio == null ? precioLista : Util.entero(x.precio, 'El precio de ' + nombre);
      const suyos = lotes.filter((l) => l.productoId === prod.id && l.disponible > 0 && (!x.loteId || l.id === String(x.loteId)));
      const stock = suyos.reduce((t, l) => t + l.disponible, 0);
      if (cantidad > stock) throw new AppError('Stock insuficiente de ' + nombre + (x.loteId ? ' en ese lote' : '') + ': ' + (stock ? 'quedan ' + stock : 'no hay unidades') + ' en inventario.');
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
    if (abono < total && !clienteId) throw new AppError('Una venta con saldo por cobrar necesita un cliente (no puede ser "Cliente general").');
    const sello = Util.sello(user, true);
    const venta = Object.assign({
      id: Util.siguienteId('OC', 4), fecha: fecha, clienteId: clienteId, canal: canal, evento: evento, medioPago: medioPago,
      boleta: boleta, abono: abono, comision: comision, anulada: false, notas: notas,
    }, sello);
    Db.insert('Ventas', venta);
    Db.insertMany('Ventas_Lineas', lineas.map((l) => Object.assign({ id: Util.siguienteId('VL', 6), ventaId: venta.id }, l, sello)));
    Audit.log(user, 'crear', 'Venta', venta.id, {
      cliente: clienteId || Clientes.GENERAL, total: total, medioPago: medioPago, abono: abono,
      productos: lineas.map((l) => (l.productoId ? l.productoId + ' ×' + l.cantidad + ' (' + l.loteId + ')' : l.categoria + ' ' + l.precio)).join(', '),
    });
    return Object.assign({ total: total }, venta);
  },

  /** Corrige la fecha, el N° de boleta o las notas de una venta (administrador). */
  editar(p, user) {
    const v = Ventas.requerir(p.id);
    const datos = {
      fecha: Util.fecha(p.fecha, 'La fecha de la venta', { requerido: true }),
      boleta: Util.texto(p.boleta, 'El N° de boleta', { max: 40 }),
      notas: Util.texto(p.notas, 'Las notas', { max: 500 }),
    };
    Audit.log(user, 'editar', 'Venta', v.id, Audit.diff(v, Object.assign({}, v, datos)));
    Db.update('Ventas', v.id, Object.assign(datos, Util.sello(user)));
  },

  /**
   * Ventas migradas con su número de OC original (la nota "OC original OC223" → OC-0223).
   * Si varias ventas venían de la misma OC, las siguientes llevan "-2", "-3"…
   * Las ventas sin OC original conservan su número si no choca y queda sobre el último
   * original; si no, pasan a continuación. El correlativo sigue desde el número más alto.
   * Devuelve { cambios: [{ de, a, fecha, oc, anulada }], siguiente, ultimo }.
   */
  _planOriginales() {
    const ventas = Db.all('Ventas').sort((a, b) => a.id.localeCompare(b.id));
    const num = (id) => { const m = /^OC-(\d+)$/.exec(id); return m ? Number(m[1]) : null; };
    const destino = {};
    const usados = {};
    const porOc = {};
    ventas.forEach((v) => {
      const o = /OC original (OC|PR)\s*-?\s*0*(\d+)\b/i.exec(v.notas || '');
      if (!o) return;
      const base = o[1].toUpperCase() + '-' + String(Number(o[2])).padStart(4, '0');
      (porOc[base] = porOc[base] || []).push(v);
    });
    let max = 0;
    Object.keys(porOc).forEach((base) => {
      porOc[base].forEach((v, i) => { destino[v.id] = i ? base + '-' + (i + 1) : base; usados[destino[v.id]] = true; });
      if (base.indexOf('OC-') === 0) max = Math.max(max, Number(base.slice(3)));
    });
    const resto = ventas.filter((v) => !(v.id in destino));
    resto.forEach((v) => { if (num(v.id) > max && !usados[v.id]) { destino[v.id] = v.id; usados[v.id] = true; } });
    const sec = Db.get('Secuencias', 'OC');
    let n = Math.max(max, sec ? sec.valor : 0);
    resto.forEach((v) => {
      if (v.id in destino) return;
      do { n++; } while (usados['OC-' + String(n).padStart(4, '0')]);
      destino[v.id] = 'OC-' + String(n).padStart(4, '0');
      usados[destino[v.id]] = true;
    });
    const ultimo = Object.keys(usados).reduce((m, id) => Math.max(m, num(id) || 0), n);
    const cambios = ventas.filter((v) => destino[v.id] !== v.id).map((v) => {
      const m = /OC original ((?:OC|PR)\s*-?\s*\d+)/i.exec(v.notas || '');
      return { de: v.id, a: destino[v.id], fecha: v.fecha, oc: m ? m[1] : '', anulada: v.anulada };
    });
    return { cambios: cambios, siguiente: 'OC-' + String(ultimo + 1).padStart(4, '0'), ultimo: ultimo };
  },

  /** Vista previa (aplicar = false) o renumeración de las OC migradas a su número original. */
  numerosOriginales(p, user) {
    const plan = Ventas._planOriginales();
    if (!p || !p.aplicar) return plan;
    if (!plan.cambios.length) return plan;
    Respaldos.crear('antes de renumerar las OC', user);
    const mapa = {};
    plan.cambios.forEach((c) => { mapa[c.de] = c.a; });
    const re = /\bOC-\d{4,}(?:-\d+)?\b/g;
    const reemplazar = (t) => String(t || '').replace(re, (id) => (id in mapa ? mapa[id] : id));
    // Todo en una escritura por hoja: los cambios de id se aplican a la vez (sin choques intermedios).
    Db.actualizarVarios('Ventas', plan.cambios.reduce((o, c) => { o[c.de] = { id: c.a }; return o; }, {}));
    [['Ventas_Lineas', 'ventaId'], ['Cobros', 'ventaId']].forEach(([tabla, campo]) => {
      const cambios = {};
      Db.all(tabla).forEach((r) => { if (r[campo] in mapa) cambios[r.id] = { [campo]: mapa[r[campo]] }; });
      if (Object.keys(cambios).length) Db.actualizarVarios(tabla, cambios);
    });
    // Referencias en texto: lo que creó la migración de la caja y las notas de Finanzas.
    [['Migracion_Caja', ['migrada']], ['Finanzas', ['referencia', 'notas']]].forEach(([tabla, campos]) => {
      const cambios = {};
      Db.all(tabla).forEach((r) => {
        const c = {};
        campos.forEach((k) => { const t = reemplazar(r[k]); if (t !== String(r[k] || '')) c[k] = t; });
        if (Object.keys(c).length) cambios[r.id] = c;
      });
      if (Object.keys(cambios).length) Db.actualizarVarios(tabla, cambios);
    });
    const sec = Db.get('Secuencias', 'OC');
    if (sec) Db.update('Secuencias', 'OC', { valor: Math.max(sec.valor, plan.ultimo) });
    else Db.insert('Secuencias', { clave: 'OC', valor: plan.ultimo });
    Audit.log(user, 'renumerar', 'Venta', '', { ventas: plan.cambios.length, ejemplos: plan.cambios.slice(0, 20).map((c) => c.de + '→' + c.a).join(', ') });
    return plan;
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
    Db.all('Tomas').forEach((t) => { fechaCompra[t.id] = t.fecha; });   // lotes de ajuste por sobrantes
    return Db.all('Compras_Lineas').map((l) => ({
      id: l.id,
      productoId: l.productoId,
      fecha: fechaCompra[l.compraId] || '',
      costo: l.cantidad ? l.costoNeto + l.despacho / l.cantidad : l.costoNeto,
      disponible: l.cantidad - (vendidas[l.id] || 0),
    })).sort((a, b) => (a.fecha + a.id).localeCompare(b.fecha + b.id));
  },

  /** Unidades que ya salieron de cada lote: vendidas (ventas no anuladas) + salidas (premios, aperturas…). */
  vendidasPorLote() {
    const anuladas = {};
    Db.all('Ventas').forEach((v) => { if (v.anulada) anuladas[v.id] = true; });
    const res = {};
    Db.all('Ventas_Lineas').forEach((l) => { if (!anuladas[l.ventaId]) res[l.loteId] = (res[l.loteId] || 0) + l.cantidad; });
    Db.all('Salidas').forEach((x) => { if (!x.anulada) res[x.loteId] = (res[x.loteId] || 0) + x.cantidad; });
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
      const porMonto = !l.productoId;
      const prod = porMonto ? { nombre: l.descripcion || l.categoria, edicion: l.categoria, idioma: '', imagen: '' }
        : prodPorId[l.productoId] || { nombre: '(producto eliminado)', edicion: '', idioma: '', imagen: '' };
      const e = Economia.unidad(l.costo, l.precio);
      const linea = Object.assign(l, {
        producto: porMonto ? [l.categoria, l.descripcion].filter(Boolean).join(' · ') : Productos.nombreCompleto(prod),
        productoNombre: prod.nombre, edicion: prod.edicion, idioma: prod.idioma, imagen: prod.imagen || '', porMonto: porMonto,
        subtotal: l.precio * l.cantidad,
        descuento: (l.precioLista - l.precio) * l.cantidad,
        gananciaUnidad: e.ganancia,
        ganancia: e.ganancia * l.cantidad,
        debito: e.debito * l.cantidad,
      });
      if (v) v.lineas.push(linea);
      if (v && !v.anulada && l.loteId) {
        const r = porLote[l.loteId] = porLote[l.loteId] || { vendidas: 0, ventas: 0, ganancia: 0, unidades: [] };
        r.vendidas += l.cantidad;
        r.ventas += linea.subtotal;
        r.ganancia += linea.ganancia;
        for (let i = 0; i < l.cantidad; i++) r.unidades.push({ oc: v.id, cliente: v.cliente, fecha: v.fecha, precio: l.precio });
      }
    });

    // Salidas que no son venta: ocupan unidades del lote, con su motivo en lugar de OC.
    Db.all('Salidas').filter((x) => !x.anulada).forEach((x) => {
      const r = porLote[x.loteId] = porLote[x.loteId] || { vendidas: 0, ventas: 0, ganancia: 0, unidades: [] };
      r.salidas = (r.salidas || 0) + x.cantidad;
      r.costoSalidas = (r.costoSalidas || 0) + x.costo * x.cantidad;
      for (let i = 0; i < x.cantidad; i++) r.unidades.push({ oc: MOTIVOS_SALIDA[x.motivo] || x.motivo, cliente: x.notas, fecha: x.fecha, precio: 0, salida: x.motivo });
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
