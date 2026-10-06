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
      id: Util.siguienteId(Ventas.prefijo(lineas), 4), fecha: fecha, clienteId: clienteId, canal: canal, evento: evento, medioPago: medioPago,
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

  /**
   * Correlativo de una venta según sus líneas: OC si lleva algún producto del inventario (o
   * conceptos sin prefijo propio); si es solo por monto, el prefijo de su categoría (la de mayor monto).
   */
  prefijo(lineas) {
    if (!lineas.length || lineas.some((l) => l.productoId)) return 'OC';
    const porCat = {};
    lineas.forEach((l) => { porCat[l.categoria] = (porCat[l.categoria] || 0) + l.precio * l.cantidad; });
    const cat = Object.keys(porCat).sort((a, b) => porCat[b] - porCat[a])[0];
    return PREFIJOS_VENTA[cat] || 'OC';
  },

  /** true si el id es de una OC (venta de sellados). */
  esOc(id) {
    return /^(OC|PR)-/.test(String(id || ''));
  },

  /**
   * Cambia ids (y opcionalmente fechas) de ventas y actualiza sus líneas, abonos y referencias en
   * texto (caja y Finanzas), con una escritura por hoja. mapa: { idViejo: idNuevo }; fechas: { idViejo: fecha }.
   */
  _renombrar(mapa, fechas, user) {
    const fs = fechas || {};
    const cambiosV = {};
    Object.keys(mapa).concat(Object.keys(fs)).forEach((id) => {
      const c = cambiosV[id] = cambiosV[id] || Util.sello(user);
      if (mapa[id] && mapa[id] !== id) c.id = mapa[id];
      if (fs[id]) c.fecha = fs[id];
    });
    if (Object.keys(cambiosV).length) Db.actualizarVarios('Ventas', cambiosV);
    const cambia = (id) => mapa[id] && mapa[id] !== id;
    if (!Object.keys(mapa).some(cambia)) return;
    const re = /\b(?:OC|PR|SGL|TOR|SOB|BAZ|ACC)-\d{4,}(?:-\d+)?\b/g;
    const reemplazar = (t) => String(t || '').replace(re, (id) => (cambia(id) ? mapa[id] : id));
    [['Ventas_Lineas', 'ventaId'], ['Cobros', 'ventaId']].forEach(([tabla, campo]) => {
      const cambios = {};
      Db.all(tabla).forEach((r) => { if (cambia(r[campo])) cambios[r.id] = { [campo]: mapa[r[campo]] }; });
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
  },

  /**
   * Ventas solo por monto de categorías con prefijo propio (singles, torneos…) que aún tienen
   * número de OC: pasan a SGL-/TOR-/… en orden de fecha. Las OC originales de la caja no se tocan.
   */
  separarSinOc(user) {
    const lineas = {};
    Db.all('Ventas_Lineas').forEach((l) => { (lineas[l.ventaId] = lineas[l.ventaId] || []).push(l); });
    const mover = Db.all('Ventas')
      .filter((v) => Ventas.esOc(v.id) && !/OC original/.test(v.notas || '') && Ventas.prefijo(lineas[v.id] || []) !== 'OC')
      .sort((a, b) => (a.fecha + a.id).localeCompare(b.fecha + b.id));
    const porPrefijo = {};
    mover.forEach((v) => { const pre = Ventas.prefijo(lineas[v.id]); (porPrefijo[pre] = porPrefijo[pre] || []).push(v); });
    const mapa = {};
    Object.keys(porPrefijo).forEach((pre) => {
      const ids = Util.reservarIds(pre, 4, porPrefijo[pre].length);
      porPrefijo[pre].forEach((v, i) => { mapa[v.id] = ids[i]; });
    });
    if (mover.length) Ventas._renombrar(mapa, null, user);
    return mapa;
  },

  /**
   * Corrige la fecha, el N° de boleta o las notas de una venta (administrador).
   * Opcional: total (lo que pagó el cliente) y comisión. Si el total cambia, la diferencia queda
   * como una línea "Ajuste" con su motivo, una anotación en las notas y la auditoría.
   */
  editar(p, user) {
    const v = Ventas.requerir(p.id);
    const datos = {
      fecha: Util.fecha(p.fecha, 'La fecha de la venta', { requerido: true }),
      boleta: Util.texto(p.boleta, 'El N° de boleta', { max: 40 }),
      notas: Util.texto(p.notas, 'Las notas', { max: 500 }),
    };
    if (p.comision != null && p.comision !== '') datos.comision = Util.entero(p.comision, 'La comisión', { min: 0 });
    if (p.canal != null && p.canal !== '') datos.canal = Util.opcion(p.canal, 'El canal', CANALES);
    if (p.evento != null) datos.evento = Util.texto(p.evento, 'El evento', { max: 120 });
    if (p.medioPago != null && p.medioPago !== '') datos.medioPago = Util.opcion(p.medioPago, 'El medio de pago', Object.keys(MEDIOS_PAGO));
    // Nuevo N°: "286", "0286", "OC286" u "OC-0286" (sin prefijo, conserva el de la venta).
    let nuevoId = v.id;
    if (p.numero != null && String(p.numero).trim() !== '') {
      const t = String(p.numero).trim().toUpperCase();
      const m = /^(?:(OC|PR|SGL|TOR|SOB|BAZ|ACC)\s*-?\s*)?0*(\d+)(-\d+)?$/.exec(t);
      if (!m) throw new AppError('El N° "' + p.numero + '" no es válido. Ej.: OC-0286 o 286.');
      nuevoId = (m[1] || v.id.split('-')[0]) + '-' + String(Number(m[2])).padStart(4, '0') + (m[3] || '');
      if (nuevoId !== v.id && Db.get('Ventas', nuevoId)) throw new AppError('El N° ' + nuevoId + ' ya lo usa otra venta.');
    }
    const lineas = Db.all('Ventas_Lineas').filter((l) => l.ventaId === v.id);
    const sumaAntes = lineas.reduce((t, l) => t + l.precio * l.cantidad, 0);
    // Precios de cada línea (corregir un precio mal ingresado).
    const precios = {};
    (Array.isArray(p.lineas) ? p.lineas : []).forEach((x) => {
      const l = lineas.find((y) => y.id === String(x.id));
      if (!l) throw new AppError('La línea ' + x.id + ' no es de la venta ' + v.id + '.');
      if (l.categoria === 'Ajuste') return;
      const precio = Util.entero(x.precio, 'El precio', { min: 0 });
      if (precio !== l.precio) precios[l.id] = precio;
    });
    if (Object.keys(precios).length && v.anulada) throw new AppError('La venta ' + v.id + ' está anulada.');
    const sumaLineas = lineas.reduce((t, l) => t + (l.id in precios ? precios[l.id] : l.precio) * l.cantidad, 0);
    let ajuste = null;
    let totalFinal = sumaLineas;
    if (p.total != null && p.total !== '') {
      if (v.anulada) throw new AppError('La venta ' + v.id + ' está anulada.');
      const total = Util.entero(p.total, 'El total pagado', { min: 0 });
      const dif = total - sumaLineas;
      if (dif) {
        const motivo = Util.texto(p.motivo, 'El motivo del ajuste', { requerido: true, max: 120 });
        ajuste = { dif: dif, actual: sumaLineas, total: total, motivo: motivo };
        totalFinal = total;
        const nota = Util.hoy() + ': total ajustado ' + sumaLineas + ' → ' + total + ' (' + motivo + ')';
        datos.notas = [datos.notas, nota].filter(Boolean).join(' · ').slice(-500);
      }
    }
    if (totalFinal !== sumaAntes) {
      // Si estaba pagada, sigue pagada con el total nuevo; si debía, el saldo cambia.
      const cobrado = v.abono + Db.all('Cobros').filter((c) => c.ventaId === v.id).reduce((t, c) => t + c.monto, 0);
      if (cobrado >= sumaAntes) datos.abono = Math.max(0, v.abono + totalFinal - sumaAntes);
    }
    // Pagado al vender: lo demás queda como deuda del cliente (se salda con abonos en Clientes).
    if (p.abono != null && p.abono !== '') {
      const cobros = Db.all('Cobros').filter((c) => c.ventaId === v.id).reduce((t, c) => t + c.monto, 0);
      datos.abono = Util.entero(p.abono, 'Lo pagado al vender', { min: 0, max: Math.max(0, totalFinal - cobros) });
    }
    if (p.cliente != null || p.clienteId || (datos.abono != null && datos.abono < v.abono)) {
      datos.clienteId = p.cliente != null || p.clienteId ? Clientes.resolver(p, user) : v.clienteId;
      const cobradoFinal = (datos.abono != null ? datos.abono : v.abono) + Db.all('Cobros').filter((c) => c.ventaId === v.id).reduce((t, c) => t + c.monto, 0);
      if (!datos.clienteId && cobradoFinal < totalFinal) throw new AppError('Una venta con saldo por cobrar necesita un cliente (no puede ser "Cliente general").');
    }
    Audit.log(user, 'editar', 'Venta', v.id, Object.assign(Audit.diff(v, Object.assign({}, v, datos)),
      nuevoId !== v.id ? { numero: v.id + ' → ' + nuevoId } : {},
      Object.keys(precios).length ? { precios: Object.keys(precios).map((k) => k + ' ' + lineas.find((l) => l.id === k).precio + '→' + precios[k]).join(', ') } : {},
      ajuste ? { totalAntes: ajuste.actual, total: ajuste.total, motivo: ajuste.motivo } : {}));
    Db.update('Ventas', v.id, Object.assign(datos, Util.sello(user)));
    if (Object.keys(precios).length) {
      Db.actualizarVarios('Ventas_Lineas', Object.keys(precios).reduce((o, k) => { o[k] = Object.assign({ precio: precios[k] }, Util.sello(user)); return o; }, {}));
    }
    if (ajuste) {
      Db.insert('Ventas_Lineas', Object.assign({
        id: Util.siguienteId('VL', 6), ventaId: v.id, loteId: '', productoId: '', cantidad: 1,
        precioLista: ajuste.dif, precio: ajuste.dif, costo: 0, categoria: 'Ajuste', descripcion: ajuste.motivo,
      }, Util.sello(user, true)));
    }
    if (nuevoId !== v.id) {
      Ventas._renombrar({ [v.id]: nuevoId }, null, user);
      // El correlativo de ese prefijo queda sobre el N° usado, para que una venta nueva no lo repita.
      const pre = nuevoId.split('-')[0];
      const n = Number(nuevoId.split('-')[1]);
      const sec = Db.get('Secuencias', pre);
      if (!sec) Db.insert('Secuencias', { clave: pre, valor: n });
      else if (sec.valor < n) Db.update('Secuencias', pre, { valor: n });
    }
    return { id: nuevoId };
  },


  /**
   * Ventas migradas con su número de OC original (la nota "OC original OC223" → OC-0223).
   * Si varias ventas venían de la misma OC, las siguientes llevan "-2", "-3"…
   * Las ventas sin OC original conservan su número si no choca y queda sobre el último
   * original; si no, pasan a continuación. El correlativo sigue desde el número más alto.
   * Además cada venta con OC original toma la fecha de esa OC en la caja diaria (la más antigua),
   * aunque sus filas aún no se hayan migrado.
   * Devuelve { cambios: [{ de, a, fecha, fechaNueva, oc, anulada }], siguiente, ultimo }.
   */
  _planOriginales() {
    // Solo las OC (sellados): singles, torneos y demás tienen su propio correlativo.
    const ventas = Db.all('Ventas').filter((v) => Ventas.esOc(v.id)).sort((a, b) => a.id.localeCompare(b.id));
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
    const fechaCaja = {};
    Db.all('Migracion_Caja').forEach((f) => {
      if (f.oc && !f.descartada && f.fecha && (!fechaCaja[f.oc] || f.fecha < fechaCaja[f.oc])) fechaCaja[f.oc] = f.fecha;
    });
    const cambios = [];
    ventas.forEach((v) => {
      const m = /OC original ((?:OC|PR)\s*-?\s*\d+)/i.exec(v.notas || '');
      const oc = m ? m[1] : '';
      const fechaNueva = (oc && fechaCaja[MigracionCaja.normalizarOc(oc)]) || v.fecha;
      if (destino[v.id] !== v.id || fechaNueva !== v.fecha) {
        cambios.push({ de: v.id, a: destino[v.id], fecha: v.fecha, fechaNueva: fechaNueva, oc: oc, anulada: v.anulada });
      }
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
    const fechas = {};
    plan.cambios.forEach((c) => { mapa[c.de] = c.a; if (c.fechaNueva !== c.fecha) fechas[c.de] = c.fechaNueva; });
    Ventas._renombrar(mapa, fechas, user);
    const sec = Db.get('Secuencias', 'OC');
    if (sec) Db.update('Secuencias', 'OC', { valor: Math.max(sec.valor, plan.ultimo) });
    else Db.insert('Secuencias', { clave: 'OC', valor: plan.ultimo });
    Audit.log(user, 'renumerar', 'Venta', '', { ventas: plan.cambios.length, ejemplos: plan.cambios.slice(0, 20).map((c) => c.de + '→' + c.a + (c.fechaNueva !== c.fecha ? ' (' + c.fechaNueva + ')' : '')).join(', ') });
    return plan;
  },

  /**
   * Reclasifica una venta sin productos del inventario (administrador):
   * - destino = una categoría de venta (Singles, Torneo… u Otro): sus líneas toman esa categoría y
   *   la venta pasa al correlativo que le corresponde (SGL-, TOR-…, u OC si es Otro).
   * - destino = 'finanzas': no fue una venta (ej. un pago de prueba). Se anula y lo cobrado queda
   *   como "Otro ingreso" en Finanzas, con referencia a la venta. Lo registrado en la caja apunta al movimiento.
   */
  reclasificar(p, user) {
    const v = Ventas.requerir(p.id);
    if (v.anulada) throw new AppError('La venta ' + v.id + ' está anulada.');
    const lineas = Db.all('Ventas_Lineas').filter((l) => l.ventaId === v.id);
    if (lineas.some((l) => l.productoId)) throw new AppError('La venta ' + v.id + ' tiene productos del inventario: anúlala y regístrala de nuevo.');
    const motivo = Util.texto(p.motivo, 'El motivo', { max: 120 });
    const sello = Util.sello(user);
    if (p.destino === 'finanzas') {
      const cobrado = v.abono + Db.all('Cobros').filter((c) => c.ventaId === v.id).reduce((t, c) => t + c.monto, 0);
      const cuenta = { efectivo: 'caja', transferencia: 'banco', debito: 'tuu', credito: 'tuu' }[v.medioPago] || '';
      let mov = null;
      if (cobrado > 0) {
        const categoria = p.categoriaMov ? Util.opcion(p.categoriaMov, 'La categoría', Object.keys(CATEGORIAS_MOVIMIENTO.ingreso)) : 'otro_ingreso';
        mov = Finanzas.guardar({ fecha: v.fecha, tipo: 'ingreso', categoria: categoria, subcategoria: motivo || 'No era una venta',
          monto: cobrado, cuenta: cuenta, referencia: 'Antes ' + v.id, notas: v.notas }, user);
      }
      Db.update('Ventas', v.id, Object.assign({ anulada: true, notas: [v.notas, 'Reclasificada a Finanzas' + (mov ? ' ' + mov.id : '') + (motivo ? ': ' + motivo : '')].filter(Boolean).join(' · ').slice(-500) }, sello));
      if (mov) {
        const re = new RegExp('\\b' + v.id + '\\b', 'g');
        const cambios = {};
        Db.all('Migracion_Caja').forEach((f) => { if (re.test(f.migrada || '')) { re.lastIndex = 0; cambios[f.id] = { migrada: f.migrada.replace(re, mov.id) }; } re.lastIndex = 0; });
        if (Object.keys(cambios).length) Db.actualizarVarios('Migracion_Caja', cambios);
      }
      Audit.log(user, 'reclasificar', 'Venta', v.id, { destino: 'Finanzas', movimiento: mov ? mov.id : '', monto: cobrado, motivo: motivo });
      return { id: v.id, nuevo: mov ? mov.id : '' };
    }
    const categoria = Util.opcion(p.destino, 'El concepto', CATEGORIAS_VENTA.filter((c) => c !== 'Ajuste'));
    const cambiosL = {};
    lineas.forEach((l) => { if (l.categoria !== 'Ajuste') cambiosL[l.id] = Object.assign({ categoria: categoria }, sello); });
    if (Object.keys(cambiosL).length) Db.actualizarVarios('Ventas_Lineas', cambiosL);
    const pre = PREFIJOS_VENTA[categoria] || 'OC';
    let nuevo = v.id;
    if (v.id.split('-')[0] !== pre && !(pre === 'OC' && Ventas.esOc(v.id))) {
      nuevo = Util.siguienteId(pre, 4);
      Ventas._renombrar({ [v.id]: nuevo }, null, user);
    }
    if (motivo) Db.update('Ventas', nuevo, { notas: [v.notas, 'Reclasificada a ' + categoria + ': ' + motivo].filter(Boolean).join(' · ').slice(-500) });
    Audit.log(user, 'reclasificar', 'Venta', v.id, { categoria: categoria, nuevo: nuevo, motivo: motivo });
    return { id: v.id, nuevo: nuevo };
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
