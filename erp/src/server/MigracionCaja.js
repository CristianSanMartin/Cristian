/**
 * Migración de la caja diaria (Excel: Periodo, Fecha, Glosa, Entradas, Salidas, Obs), por partes.
 *
 * Se carga el Excel y cada fila queda pendiente. Cada grupo (glosa + observación) tiene un
 * destino por defecto y cada fila puede tener uno propio. Se seleccionan filas, se revisan y se
 * migran solo esas; quedan marcadas con lo que se creó y no se vuelven a migrar (aunque se
 * cargue el Excel de nuevo). Destinos:
 *   - oc:         venta con OC original → la venta ya migrada toma su fecha real y, si el monto
 *                 de la caja es distinto, se agrega una línea "Ajuste" (manda la caja). Si la OC no
 *                 existe en el ERP se crea como venta por monto. Todas las filas de una OC van juntas.
 *   - venta:      venta por monto (Singles, Torneo, Sobres sueltos, Bazar…). Los torneos de un día
 *                 quedan en una sola venta (una línea por fila).
 *   - movimiento: Finanzas (aporte, compra por monto, GAV, GOPM, SII, comisión…).
 *   - factura:    pago de una factura de compra que ya está en el ERP: se concilia (queda anotado en
 *                 la factura) sin crear un gasto nuevo.
 *   - omitir:     no se migra (saldos arrastrados, filas duplicadas…).
 */
const MigracionCaja = {
  ACCIONES: { oc: 'Venta con OC', venta: 'Venta por monto', movimiento: 'Movimiento de Finanzas', factura: 'Pago de factura', omitir: 'No migrar' },
  NOTA_TORNEOS: 'torneos del día consolidados',

  /** "10-06-2025", "10/6/2025", "2025-06-10", "2025-06-10T…" o número de serie de Excel → "yyyy-mm-dd". */
  _fecha(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date) return Utilities.formatDate(v, Db.ss().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
    if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
    const s = String(v).trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
    if (m) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    return '';
  },

  /** "OC001", "OC 1", "OC164 BOOSTER", "PR-5" → "OC001", "OC001", "OC164", "PR005". OC y PR (post-release) son series distintas. */
  normalizarOc(v) {
    const m = /^\s*(OC|PR)\s*-?\s*0*(\d+)/i.exec(String(v || ''));
    return m ? m[1].toUpperCase() + String(Number(m[2])).padStart(3, '0') : '';
  },

  /** Clave del grupo: glosa + observación sin montos ni cantidades. */
  clave(f) {
    if (f.oc) return 'caja|oc';
    const obs = Util.normalizar(String(f.obs || '').replace(/\$\s*[\d.,]+/g, ' ').replace(/\(x\s*\d+\)/gi, ' ').replace(/\s+/g, ' '));
    return 'caja|' + Util.normalizar(f.glosa || '') + '|' + obs;
  },

  /** Identifica una fila al volver a cargar el Excel (para no migrarla dos veces). */
  firma(r) {
    return [r.fecha, Util.normalizar(r.glosa), r.entradas, r.salidas, Util.normalizar(r.obs), Util.normalizar(r.detalle)].join('|');
  },

  cargar(p, user) {
    const filas = Array.isArray(p.filas) ? p.filas : [];
    if (!filas.length) throw new AppError('No llegaron filas. Revisa que la hoja tenga la fila de títulos (Fecha, Glosa, Entradas, Salidas, Obs).');
    if (filas.length > 8000) throw new AppError('Son demasiadas filas para una carga (máximo 8.000).');
    // Lo ya trabajado (destino propio, migrada, descartada) se conserva por firma.
    const previas = {};
    Db.all('Migracion_Caja').forEach((f) => { (previas[f.firma] = previas[f.firma] || []).push(f); });
    const compras = MigracionCaja._compras();
    const registros = filas.map((f, i) => {
      // A veces la columna Salidas trae texto (ej. el nombre de quien pagó): va al detalle.
      const salidaTexto = f.salidas != null && f.salidas !== '' && !Migracion._num(f.salidas) && /[a-z]/i.test(String(f.salidas));
      const r = {
        fila: Number(f.fila) || i + 2,
        fecha: MigracionCaja._fecha(f.fecha), glosa: Migracion._txt(f.glosa), entradas: Math.round(Migracion._num(f.entradas)),
        salidas: salidaTexto ? 0 : Math.round(Migracion._num(f.salidas)), detalle: salidaTexto ? Migracion._txt(f.salidas) : '',
        obs: Migracion._txt(f.obs), oc: '', clave: '', descartada: false, nota: '', accion: '', destino: '', extra: '', migrada: '', firma: '',
      };
      if (Util.normalizar(r.glosa) === 'ventas') r.oc = MigracionCaja.normalizarOc(r.obs);
      r.clave = MigracionCaja.clave(r);
      r.firma = MigracionCaja.firma(r);
      const prev = (previas[r.firma] || []).shift();
      if (prev) {
        ['accion', 'destino', 'extra', 'migrada', 'descartada', 'nota'].forEach((k) => { r[k] = prev[k]; });
      } else {
        const titulo = Util.normalizar(r.glosa) === 'glosa';
        if (titulo || (!r.glosa && !r.obs && !r.entradas && !r.salidas)) { r.descartada = true; r.nota = titulo ? 'Fila de títulos' : 'Fila vacía'; }
        else Object.assign(r, MigracionCaja._facturaPropuesta(r, compras));
      }
      return r;
    });
    // Filas ya migradas que no vienen en esta carga: se mantienen como registro.
    Object.keys(previas).forEach((k) => previas[k].filter((f) => f.migrada).forEach((f) => registros.push(f)));
    registros.forEach((r, i) => { r.id = 'C-' + String(i + 1).padStart(5, '0'); });
    Db.vaciar('Migracion_Caja');
    Db.insertMany('Migracion_Caja', registros);
    MigracionCaja._proponer();
    Audit.log(user, 'cargar', 'Migración caja', '', { filas: registros.length });
    return MigracionCaja.estado();
  },

  /** Facturas de compra del ERP con su total (neto + despacho + IVA). */
  _compras() {
    const neto = {};
    Db.all('Compras_Lineas').forEach((l) => { neto[l.compraId] = (neto[l.compraId] || 0) + l.cantidad * l.costoNeto; });
    const prov = {};
    Db.all('Proveedores').forEach((p) => { prov[p.id] = p.nombre; });
    return Db.all('Compras').map((c) => ({
      id: c.id, factura: c.factura, fecha: c.fecha, proveedor: prov[c.proveedorId] || '',
      total: Math.round(((neto[c.id] || 0) + (c.despacho || 0)) * (1 + APP.iva)),
    }));
  },

  /** Compra de un proveedor que ya tiene facturas: propone la de total más parecido (±0,5 % o $2.000). */
  _facturaPropuesta(r, compras) {
    if (Util.normalizar(r.glosa) !== 'compras' || !r.salidas) return {};
    const o = Util.normalizar(r.obs);
    const suyas = compras.filter((c) => c.proveedor && o.indexOf(Util.normalizar(c.proveedor)) !== -1);
    if (!suyas.length) return {};
    const mejor = suyas.map((c) => ({ c: c, d: Math.abs(c.total - r.salidas) })).sort((a, b) => a.d - b.d)[0];
    if (mejor.d <= Math.max(2000, mejor.c.total * 0.005)) return { accion: 'factura', destino: mejor.c.id };
    return {};
  },

  /** Destino por defecto de cada grupo nuevo (no toca los que ya existen). */
  _proponer() {
    const existentes = {};
    Db.all('Migracion_Mapeos').forEach((m) => { existentes[m.clave] = true; });
    const proveedores = Db.all('Proveedores').map((x) => Util.normalizar(x.nombre)).filter((x) => x.length > 2);
    const nuevos = {};
    Db.all('Migracion_Caja').filter((f) => !f.descartada).forEach((f) => {
      if (existentes[f.clave] || nuevos[f.clave]) return;
      nuevos[f.clave] = Object.assign({ clave: f.clave, tipo: 'caja', original: f.oc ? 'Ventas con OC' : [f.glosa || '(sin glosa)', f.obs].filter(Boolean).join(' · '), confirmado: false },
        MigracionCaja._propuesta(f, proveedores));
    });
    const lista = Object.keys(nuevos).map((k) => nuevos[k]);
    if (lista.length) Db.insertMany('Migracion_Mapeos', lista);
  },

  /** accion + destino (categoría / factura) + extra (detalle / subcategoría). */
  _propuesta(f, proveedores) {
    const g = Util.normalizar(f.glosa);
    const o = Util.normalizar(f.obs);
    const mov = (categoria, extra) => ({ accion: 'movimiento', destino: categoria, extra: extra == null ? f.obs : extra });
    if (f.oc) return { accion: 'oc', destino: '', extra: '' };
    if (g === 'ventas') {
      const cat = /single/.test(o) ? 'Singles' : /torneo/.test(o) ? 'Torneo' : /sobre|booster|mugri|challa/.test(o) ? 'Sobres sueltos'
        : /bazar|bebida|snack/.test(o) ? 'Bazar' : /accesori|sleeve|deck/.test(o) ? 'Accesorios' : 'Otro';
      return { accion: 'venta', destino: cat, extra: f.obs };
    }
    if (g === 'compras') {
      // Proveedores con facturas en el ERP: pago de factura (la factura se elige en cada fila).
      if (proveedores.some((p) => o.indexOf(p) !== -1) || /asmodee|ludi|rancagua|panteon/.test(o)) return { accion: 'factura', destino: '', extra: '' };
      return mov('compra', /single/.test(o) ? 'Singles' : /bazar|bebida|snack/.test(o) ? 'Bazar' : f.obs);
    }
    if (g === 'patrimonio') return mov('aporte', f.obs);
    if (g === 'gav') return mov('gav');
    if (g === 'gopm') return mov('gopm');
    if (g === 'sii') return mov('sii');
    if (g === 'comision') return mov('comision');
    if (g === 'saldo') return { accion: 'omitir', destino: '', extra: 'Saldo arrastrado: no se migra' };
    if (!g) return mov('gav');
    return mov('otro_egreso');
  },

  _validarDestino(c) {
    const patch = {};
    if ('accion' in c) patch.accion = c.accion === '' ? '' : Util.opcion(c.accion, 'El destino', Object.keys(MigracionCaja.ACCIONES));
    if ('destino' in c) patch.destino = Util.texto(c.destino, 'La categoría', { max: 60 });
    if ('extra' in c) patch.extra = Util.texto(c.extra, 'El detalle', { max: 120 });
    return patch;
  },

  /** Destino por defecto de los grupos: [{ clave, accion?, destino?, extra? }]. */
  guardarMapeos(p, user) {
    const todo = {};
    (Array.isArray(p.mapeos) ? p.mapeos : []).forEach((c) => {
      const patch = MigracionCaja._validarDestino(c);
      if ('confirmado' in c) patch.confirmado = c.confirmado === true;
      todo[String(c.clave || '')] = Object.assign(todo[String(c.clave || '')] || {}, patch);
    });
    Db.actualizarVarios('Migracion_Mapeos', todo);
    return MigracionCaja.estado();
  },

  /** Filas pendientes: [{ id, descartada?, accion?, destino?, extra? }]. accion "" = vuelve al destino del grupo. */
  guardarFilas(p, user) {
    const porId = {};
    Db.all('Migracion_Caja').forEach((f) => { porId[f.id] = f; });
    const todo = {};
    (Array.isArray(p.filas) ? p.filas : []).forEach((c) => {
      const f = porId[String(c.id || '')];
      if (!f) throw new AppError('La fila ' + c.id + ' no existe.');
      if (f.migrada) throw new AppError('La fila ' + f.fila + ' ya se migró (' + f.migrada + ').');
      const patch = MigracionCaja._validarDestino(c);
      if (patch.accion === '') Object.assign(patch, { destino: '', extra: '' });
      if ('descartada' in c) Object.assign(patch, { descartada: c.descartada === true, nota: c.descartada === true ? 'Descartada a mano' : '' });
      todo[f.id] = Object.assign(todo[f.id] || {}, patch);
    });
    Db.actualizarVarios('Migracion_Caja', todo);
    MigracionCaja._proponer();
    return MigracionCaja.estado();
  },

  /** Ventas ya en el ERP por OC original (de la migración del stock). */
  _ventasPorOc() {
    const res = {};
    Db.all('Ventas').filter((v) => !v.anulada).forEach((v) => {
      const m = /OC original ((?:OC|PR)\s*-?\s*\d+)/i.exec(v.notas || '');
      const oc = m ? MigracionCaja.normalizarOc(m[1]) : '';
      if (oc) (res[oc] = res[oc] || []).push(v);
    });
    return res;
  },

  /** Tipo (ingreso / egreso) de una categoría de movimiento. */
  _tipoDe(categoria) {
    return Object.keys(CATEGORIAS_MOVIMIENTO).find((t) => CATEGORIAS_MOVIMIENTO[t][categoria]) || '';
  },

  /** Destino efectivo de una fila (el suyo o el de su grupo) y lo que le falta para poder migrarse. */
  _efectivo(f, mapa, compraPorId) {
    const m = mapa[f.clave] || {};
    const propio = !!f.accion;
    const ef = { accion: propio ? f.accion : m.accion || '', destino: propio ? f.destino : m.destino || '', extra: f.extra || (propio ? '' : m.extra || ''), propio: propio };
    let problema = '';
    if (!f.fecha) problema = 'Sin fecha válida';
    else if (!ef.accion) problema = 'Sin destino';
    else if (ef.accion === 'venta' && CATEGORIAS_VENTA.indexOf(ef.destino) === -1) problema = 'Elige la categoría de venta';
    else if (ef.accion === 'venta' && !f.entradas && !f.salidas) problema = 'Sin monto';
    else if (ef.accion === 'movimiento' && !MigracionCaja._tipoDe(ef.destino)) problema = 'Elige la categoría del movimiento';
    else if (ef.accion === 'factura' && !compraPorId[ef.destino]) problema = 'Elige la factura';
    else if (ef.accion === 'oc' && !f.oc) problema = 'La fila no tiene OC';
    ef.problema = problema;
    return ef;
  },

  estado() {
    const filas = Db.all('Migracion_Caja');
    const mapeos = Db.all('Migracion_Mapeos').filter((m) => m.tipo === 'caja');
    const mapa = {};
    mapeos.forEach((m) => { mapa[m.clave] = m; });
    const compras = MigracionCaja._compras();
    const compraPorId = {};
    compras.forEach((c) => { compraPorId[c.id] = c; });
    filas.forEach((f) => {
      // Filas cargadas con una versión anterior: la OC se vuelve a normalizar (OC001, PR001…).
      if (f.oc) f.oc = MigracionCaja.normalizarOc(f.obs) || f.oc;
      const ef = MigracionCaja._efectivo(f, mapa, compraPorId);
      Object.assign(f, {
        estado: f.migrada ? 'migrada' : f.descartada ? 'descartada' : 'pendiente',
        accionEf: ef.accion, destinoEf: ef.destino, extraEf: ef.extra, propio: ef.propio, problema: f.migrada || f.descartada ? '' : ef.problema,
      });
    });
    const pendientes = filas.filter((f) => f.estado === 'pendiente');
    const uso = {};
    pendientes.forEach((f) => {
      const u = uso[f.clave] = uso[f.clave] || { filas: 0, entradas: 0, salidas: 0 };
      u.filas++; u.entradas += f.entradas; u.salidas += f.salidas;
    });
    const vigentes = mapeos.filter((m) => uso[m.clave]).map((m) => Object.assign(m, uso[m.clave]));

    // Pagos de la caja asociados a cada factura (migrados o propuestos).
    const pagos = {};
    filas.filter((f) => f.accionEf === 'factura' && f.destinoEf && f.estado !== 'descartada').forEach((f) => {
      const p = pagos[f.destinoEf] = pagos[f.destinoEf] || { pagado: 0, filas: 0 };
      p.pagado += f.salidas; p.filas++;
    });
    compras.forEach((c) => Object.assign(c, pagos[c.id] || { pagado: 0, filas: 0 }));

    // OC pendientes cruzadas con las ventas migradas.
    const porOc = MigracionCaja._ventasPorOc();
    const totalVenta = {};
    Db.all('Ventas_Lineas').forEach((l) => { totalVenta[l.ventaId] = (totalVenta[l.ventaId] || 0) + l.precio * l.cantidad; });
    const ocs = {};
    filas.filter((f) => f.oc && f.estado !== 'descartada').forEach((f) => {
      const o = ocs[f.oc] = ocs[f.oc] || { oc: f.oc, monto: 0, fecha: f.fecha, filas: 0, migrada: '' };
      o.monto += f.entradas - f.salidas; o.filas++;
      if (f.migrada) o.migrada = f.migrada;
      if (f.fecha && (!o.fecha || f.fecha < o.fecha)) o.fecha = f.fecha;
    });
    const listaOc = Object.keys(ocs).sort().map((k) => {
      const o = ocs[k];
      const vs = porOc[k] || [];
      const erp = vs.reduce((t, v) => t + (totalVenta[v.id] || 0), 0);
      return Object.assign(o, { ventas: vs.map((v) => v.id), montoErp: erp, diferencia: o.migrada ? 0 : vs.length ? o.monto - erp : null });
    });
    const enCaja = {};
    listaOc.forEach((o) => { enCaja[o.oc] = true; });
    const cuenta = (e) => filas.filter((f) => f.estado === e).length;
    return {
      filas: filas,
      mapeos: vigentes,
      acciones: MigracionCaja.ACCIONES,
      compras: compras.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))),
      ocs: listaOc,
      ocSoloErp: Object.keys(porOc).filter((k) => !enCaja[k]).sort(),
      resumen: {
        filas: filas.length, pendientes: cuenta('pendiente'), migradas: cuenta('migrada'), descartadas: cuenta('descartada'),
        conProblema: pendientes.filter((f) => f.problema).length,
        desde: filas.reduce((m, f) => (f.fecha && (!m || f.fecha < m) ? f.fecha : m), ''),
        hasta: filas.reduce((m, f) => (f.fecha > m ? f.fecha : m), ''),
        ocPendientes: listaOc.filter((o) => !o.migrada).length, ocEnErp: listaOc.filter((o) => !o.migrada && o.ventas.length).length,
      },
    };
  },

  /** Migra las filas indicadas (p.ids). Las de una misma OC van siempre juntas. */
  migrar(p, user) {
    const est = MigracionCaja.estado();
    const ids = {};
    (Array.isArray(p.ids) ? p.ids : []).forEach((id) => { ids[String(id)] = true; });
    let sel = est.filas.filter((f) => ids[f.id] && f.estado === 'pendiente');
    if (!sel.length) throw new AppError('Selecciona al menos una fila pendiente.');
    const ocsSel = {};
    sel.filter((f) => f.accionEf === 'oc').forEach((f) => { ocsSel[f.oc] = true; });
    est.filas.filter((f) => f.estado === 'pendiente' && f.accionEf === 'oc' && ocsSel[f.oc] && !ids[f.id]).forEach((f) => sel.push(f));
    const malas = sel.filter((f) => f.problema);
    if (malas.length) {
      throw new AppError('Hay ' + malas.length + ' filas que no se pueden migrar todavía: ' +
        malas.slice(0, 5).map((f) => 'fila ' + f.fila + ' (' + f.problema + ')').join(', ') + (malas.length > 5 ? '…' : '') + '.');
    }
    // Un respaldo por día de trabajo en la caja.
    const hoy = Util.hoy();
    if (!Respaldos.listar().some((r) => r.fecha.slice(0, 10) === hoy && /antes de migrar caja/.test(r.nombre))) Respaldos.crear('antes de migrar caja', user);

    const sello = Util.sello(user, true);
    const ref = {};          // id de fila → lo que se creó
    const ventasNuevas = [];  // { fecha, notas, lineas: [{ categoria, descripcion, monto, fila }] }
    const lineasExtra = [];   // líneas que se agregan a ventas existentes (ajustes, torneos del día)
    const cambiosVentas = {};
    const movimientos = [];
    const notasCompra = {};
    const descartar = {};

    // 1) OC: fecha real y ajuste por la diferencia con la caja.
    const porOc = MigracionCaja._ventasPorOc();
    const totalVenta = {};
    Db.all('Ventas_Lineas').forEach((l) => { totalVenta[l.ventaId] = (totalVenta[l.ventaId] || 0) + l.precio * l.cantidad; });
    const grupos = {};
    sel.filter((f) => f.accionEf === 'oc').forEach((f) => { (grupos[f.oc] = grupos[f.oc] || []).push(f); });
    Object.keys(grupos).forEach((oc) => {
      const fs = grupos[oc];
      const monto = fs.reduce((t, f) => t + f.entradas - f.salidas, 0);
      const fecha = fs.reduce((m, f) => (!m || f.fecha < m ? f.fecha : m), '');
      const vs = porOc[oc] || [];
      if (!vs.length) {
        ventasNuevas.push({ oc: oc, fecha: fecha, notas: 'Caja diaria · OC original ' + oc + ' (no estaba en el stock)', lineas: [{ categoria: 'Otro', descripcion: 'OC original ' + oc, monto: monto }], filas: fs });
        return;
      }
      vs.forEach((v) => { cambiosVentas[v.id] = Object.assign(cambiosVentas[v.id] || {}, { fecha: fecha }); });
      const dif = monto - vs.reduce((t, v) => t + (totalVenta[v.id] || 0), 0);
      if (dif) {
        lineasExtra.push({ ventaId: vs[0].id, categoria: 'Ajuste', descripcion: 'Diferencia con la caja diaria (otros productos / descuento)', monto: dif });
        cambiosVentas[vs[0].id].abono = (cambiosVentas[vs[0].id].abono != null ? cambiosVentas[vs[0].id].abono : vs[0].abono) + dif;
      }
      fs.forEach((f) => { ref[f.id] = 'Fecha ' + vs.map((v) => v.id).join(', ') + (dif ? ' · ajuste ' + dif : ''); });
    });

    // 2) Ventas por monto: los torneos de un día van en una sola venta (también si ya existe de otra tanda).
    const torneoDia = {};
    Db.all('Ventas').filter((v) => !v.anulada && (v.notas || '').indexOf(MigracionCaja.NOTA_TORNEOS) !== -1).forEach((v) => { torneoDia[v.fecha] = { existente: v }; });
    sel.filter((f) => f.accionEf === 'venta').forEach((f) => {
      if (f.entradas > 0) {
        const linea = { categoria: f.destinoEf, descripcion: (f.extraEf || f.obs).slice(0, 120), monto: f.entradas, fila: f };
        if (f.destinoEf === 'Torneo') {
          const t = torneoDia[f.fecha] = torneoDia[f.fecha] || {};
          if (t.existente) {
            lineasExtra.push({ ventaId: t.existente.id, categoria: 'Torneo', descripcion: linea.descripcion, monto: f.entradas });
            const c = cambiosVentas[t.existente.id] = cambiosVentas[t.existente.id] || {};
            c.abono = (c.abono != null ? c.abono : t.existente.abono) + f.entradas;
            ref[f.id] = t.existente.id;
          } else {
            if (!t.nueva) { t.nueva = { fecha: f.fecha, notas: 'Caja diaria · ' + MigracionCaja.NOTA_TORNEOS, lineas: [], filas: [] }; ventasNuevas.push(t.nueva); }
            t.nueva.lineas.push(linea); t.nueva.filas.push(f);
          }
        } else {
          ventasNuevas.push({ fecha: f.fecha, notas: 'Caja diaria · fila ' + f.fila + (f.detalle ? ' · ' + f.detalle : ''), lineas: [linea], filas: [f] });
        }
      }
      // Una salida dentro de "Ventas" (devolución, comisión de plataforma…) queda como egreso.
      if (f.salidas > 0) movimientos.push({ fila: f, m: { fecha: f.fecha, tipo: 'egreso', categoria: 'otro_egreso', subcategoria: 'Salida en ventas · ' + f.obs, monto: f.salidas, referencia: 'Caja fila ' + f.fila, notas: f.detalle } });
    });

    // 3) Movimientos de Finanzas.
    sel.filter((f) => f.accionEf === 'movimiento').forEach((f) => {
      const tipo = MigracionCaja._tipoDe(f.destinoEf);
      const neto = f.entradas - f.salidas;
      const base = { fecha: f.fecha, subcategoria: (f.extraEf || f.obs || '').slice(0, 120), referencia: 'Caja fila ' + f.fila, notas: f.detalle };
      if (tipo === 'ingreso') {
        if (neto > 0) movimientos.push({ fila: f, m: Object.assign({ tipo: 'ingreso', categoria: f.destinoEf, monto: neto }, base) });
        else if (neto < 0) movimientos.push({ fila: f, m: Object.assign({ tipo: 'egreso', categoria: 'otro_egreso', monto: -neto }, base) });
      } else {
        if (f.salidas > 0) movimientos.push({ fila: f, m: Object.assign({ tipo: 'egreso', categoria: f.destinoEf, monto: f.salidas }, base) });
        if (f.entradas > 0) movimientos.push({ fila: f, m: Object.assign({ tipo: 'ingreso', categoria: 'otro_ingreso', monto: f.entradas }, base, { subcategoria: 'Devolución · ' + base.subcategoria }) });
      }
    });

    // 4) Pagos de facturas (conciliación) y 5) filas que no se migran.
    sel.filter((f) => f.accionEf === 'factura').forEach((f) => {
      (notasCompra[f.destinoEf] = notasCompra[f.destinoEf] || []).push('Pago caja ' + f.fecha + ' $' + f.salidas + ' (fila ' + f.fila + ')');
      ref[f.id] = 'Pago ' + f.destinoEf;
    });
    sel.filter((f) => f.accionEf === 'omitir').forEach((f) => { descartar[f.id] = { descartada: true, nota: f.extraEf || 'No se migra' }; });

    // Escritura.
    if (Object.keys(cambiosVentas).length) Db.actualizarVarios('Ventas', Object.keys(cambiosVentas).reduce((o, id) => { o[id] = Object.assign(cambiosVentas[id], Util.sello(user)); return o; }, {}));
    // Una OC que no estaba en el stock toma su número original (OC048 → OC-0048) si está libre.
    const existentes = {};
    Db.all('Ventas').forEach((v) => { existentes[v.id] = true; });
    const propio = ventasNuevas.map((v) => {
      const o = v.oc && /^(OC|PR)\s*-?\s*0*(\d+)$/i.exec(v.oc);
      const id = o ? o[1].toUpperCase() + '-' + String(Number(o[2])).padStart(4, '0') : '';
      if (!id || existentes[id]) return '';
      existentes[id] = true;
      return id;
    });
    // El resto: OC si es venta de sellados u "Otro"; singles, torneos, bazar… con su propio correlativo.
    const prefijos = ventasNuevas.map((v, i) => (propio[i] ? '' : v.oc ? 'OC' : Ventas.prefijo(v.lineas.map((l) => ({ categoria: l.categoria, precio: l.monto, cantidad: 1 })))));
    const correlativos = {};
    prefijos.forEach((pre) => { if (pre) correlativos[pre] = (correlativos[pre] || 0) + 1; });
    Object.keys(correlativos).forEach((pre) => { correlativos[pre] = Util.reservarIds(pre, 4, correlativos[pre]); });
    const idsVenta = propio.map((id, i) => id || correlativos[prefijos[i]].shift());
    // El correlativo queda sobre el número más alto usado, para que una venta nueva no lo repita.
    const altoOc = propio.reduce((m, id) => Math.max(m, /^OC-\d+$/.test(id) ? Number(id.slice(3)) : 0), 0);
    const secOc = Db.get('Secuencias', 'OC');
    if (altoOc && (!secOc || secOc.valor < altoOc)) {
      if (secOc) Db.update('Secuencias', 'OC', { valor: altoOc }); else Db.insert('Secuencias', { clave: 'OC', valor: altoOc });
    }
    const idsLinea = Util.reservarIds('VL', 6, ventasNuevas.reduce((t, v) => t + v.lineas.length, 0) + lineasExtra.length);
    let il = 0;
    const regLineas = [];
    const linea = (ventaId, l) => Object.assign({ id: idsLinea[il++], ventaId: ventaId, loteId: '', productoId: '', cantidad: 1, precioLista: l.monto, precio: l.monto, costo: 0, categoria: l.categoria, descripcion: l.descripcion }, sello);
    const regVentas = ventasNuevas.map((v, i) => {
      v.lineas.forEach((l) => regLineas.push(linea(idsVenta[i], l)));
      v.filas.forEach((f) => { ref[f.id] = idsVenta[i]; });
      return Object.assign({ id: idsVenta[i], fecha: v.fecha, clienteId: '', canal: 'Tienda', evento: '', medioPago: 'otro', boleta: '', abono: v.lineas.reduce((t, l) => t + l.monto, 0), comision: 0, anulada: false, notas: v.notas }, sello);
    });
    lineasExtra.forEach((l) => regLineas.push(linea(l.ventaId, l)));
    if (regVentas.length) Db.insertMany('Ventas', regVentas);
    if (regLineas.length) Db.insertMany('Ventas_Lineas', regLineas);
    const idsMov = Util.reservarIds('MOV', 5, movimientos.length);
    if (movimientos.length) Db.insertMany('Finanzas', movimientos.map((x, i) => Object.assign({ id: idsMov[i], cuenta: '', anulado: false }, x.m, sello)));
    movimientos.forEach((x, i) => { ref[x.fila.id] = ref[x.fila.id] ? ref[x.fila.id] + ', ' + idsMov[i] : idsMov[i]; });
    Object.keys(notasCompra).forEach((id) => {
      const c = Db.get('Compras', id);
      Db.update('Compras', id, Object.assign({ notas: [c.notas, notasCompra[id].join(' · ')].filter(Boolean).join(' · ').slice(0, 500) }, Util.sello(user)));
    });
    const marcas = {};
    sel.forEach((f) => { marcas[f.id] = descartar[f.id] || { migrada: ref[f.id] || 'Migrada' }; });
    Db.actualizarVarios('Migracion_Caja', marcas);

    const resumen = {
      filas: sel.length, ventasFechadas: Object.keys(cambiosVentas).length, ventasNuevas: regVentas.length, lineas: regLineas.length,
      movimientos: movimientos.length, facturas: Object.keys(notasCompra).length, noMigradas: Object.keys(descartar).length,
    };
    Audit.log(user, 'migrar', 'Migración caja', '', resumen);
    return resumen;
  },

  /** Pagos de facturas conciliados desde la caja: [{ compraId, fecha, monto }] (para el flujo de caja). */
  pagosFacturas() {
    const res = [];
    Db.all('Migracion_Caja').forEach((f) => {
      const m = /^Pago (\S+)/.exec(f.migrada || '');
      if (m) res.push({ compraId: m[1], fecha: f.fecha, monto: f.salidas });
    });
    return res;
  },

  /** Quita las filas pendientes y descartadas; las ya migradas se conservan como registro. */
  limpiar(p, user) {
    const quedan = Db.all('Migracion_Caja').filter((f) => f.migrada);
    Db.vaciar('Migracion_Caja');
    if (quedan.length) Db.insertMany('Migracion_Caja', quedan);
    Audit.log(user, 'limpiar', 'Migración caja', '', { conservadas: quedan.length });
    return MigracionCaja.estado();
  },
};
