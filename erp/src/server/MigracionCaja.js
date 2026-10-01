/**
 * Migración de la caja diaria (Excel: Periodo, Fecha, Glosa, Entradas, Salidas, Obs).
 *
 * Igual que la migración del stock: se carga, se homologa por grupos y se importa una vez.
 * Cada fila queda en uno de estos destinos (acción del grupo):
 *   - oc:         venta con OC original → la venta ya migrada toma su fecha real y, si el
 *                 monto de la caja es distinto, se agrega una línea "Ajuste" por la diferencia
 *                 (manda la caja). Si la OC no existe en el ERP se crea como venta por monto.
 *   - venta:      venta por monto (Singles, Torneo, Sobres sueltos, Bazar…). Los torneos del
 *                 mismo día se pueden consolidar en una sola venta.
 *   - movimiento: Finanzas (aporte, compra por monto, GAV, GOPM, SII, comisión…).
 *   - omitir:     no se importa (ej. compras que ya están como factura, saldos arrastrados).
 */
const MigracionCaja = {
  ACCIONES: { oc: 'Venta con OC', venta: 'Venta por monto', movimiento: 'Movimiento de Finanzas', omitir: 'No importar' },
  PROP: 'MIGRACION_CAJA_IMPORTADA',

  _noImportada() {
    if (PropertiesService.getScriptProperties().getProperty(MigracionCaja.PROP)) {
      throw new AppError('La caja diaria ya se importó. Si necesitas corregir algo, hazlo en Ventas o Finanzas.');
    }
  },

  /** "10-06-2025", "10/6/2025", "2025-06-10", "2025-06-10T…" o número de serie de Excel → "yyyy-mm-dd". */
  _fecha(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date) return Utilities.formatDate(v, Db.ss().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
    if (typeof v === 'number') {
      const d = new Date(Math.round((v - 25569) * 86400000));
      return d.toISOString().slice(0, 10);
    }
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

  /** Clave del grupo de homologación: glosa + observación sin montos ni cantidades. */
  clave(f) {
    if (f.oc) return 'caja|oc';
    const obs = Util.normalizar(String(f.obs || '').replace(/\$\s*[\d.,]+/g, ' ').replace(/\(x\s*\d+\)/gi, ' ').replace(/\s+/g, ' '));
    return 'caja|' + Util.normalizar(f.glosa || '') + '|' + obs;
  },

  cargar(p, user) {
    MigracionCaja._noImportada();
    const filas = Array.isArray(p.filas) ? p.filas : [];
    if (!filas.length) throw new AppError('No llegaron filas. Revisa que la hoja tenga la fila de títulos (Fecha, Glosa, Entradas, Salidas, Obs).');
    if (filas.length > 8000) throw new AppError('Son demasiadas filas para una carga (máximo 8.000).');
    const registros = filas.map((f, i) => {
      // A veces la columna Salidas trae texto (ej. el nombre de quien pagó): va al detalle.
      const salidaTexto = f.salidas != null && f.salidas !== '' && !Migracion._num(f.salidas) && /[a-z]/i.test(String(f.salidas));
      const r = {
        id: 'C-' + String(i + 1).padStart(5, '0'), fila: Number(f.fila) || i + 2,
        fecha: MigracionCaja._fecha(f.fecha), glosa: Migracion._txt(f.glosa), entradas: Math.round(Migracion._num(f.entradas)),
        salidas: salidaTexto ? 0 : Math.round(Migracion._num(f.salidas)), detalle: salidaTexto ? Migracion._txt(f.salidas) : '',
        obs: Migracion._txt(f.obs), oc: '', clave: '', descartada: false, nota: '',
      };
      if (Util.normalizar(r.glosa) === 'ventas') r.oc = MigracionCaja.normalizarOc(r.obs);
      r.clave = MigracionCaja.clave(r);
      const titulo = Util.normalizar(r.glosa) === 'glosa';
      if (titulo || (!r.glosa && !r.obs && !r.entradas && !r.salidas)) { r.descartada = true; r.nota = titulo ? 'Fila de títulos' : 'Fila vacía'; }
      return r;
    });
    Db.vaciar('Migracion_Caja');
    Db.insertMany('Migracion_Caja', registros);
    MigracionCaja._proponer();
    Audit.log(user, 'cargar', 'Migración caja', '', { filas: registros.length });
    return MigracionCaja.estado();
  },

  /** Propuesta para cada grupo nuevo (no toca los que ya se homologaron). */
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

  /** accion + destino (categoría) + extra (detalle / subcategoría). */
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
      if (proveedores.some((p) => o.indexOf(p) !== -1) || /asmodee|ludi|rancagua|panteon/.test(o)) return { accion: 'omitir', destino: '', extra: 'Ya está como factura de compra' };
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

  /** Correcciones de la homologación: [{ clave, accion?, destino?, extra?, confirmado? }]. */
  guardarMapeos(p, user) {
    MigracionCaja._noImportada();
    const todo = {};
    (Array.isArray(p.mapeos) ? p.mapeos : []).forEach((c) => {
      const patch = {};
      if ('accion' in c) patch.accion = Util.opcion(c.accion, 'La acción', Object.keys(MigracionCaja.ACCIONES));
      if ('destino' in c) patch.destino = Util.texto(c.destino, 'La categoría', { max: 60 });
      if ('extra' in c) patch.extra = Util.texto(c.extra, 'El detalle', { max: 120 });
      if ('confirmado' in c) patch.confirmado = c.confirmado === true;
      todo[String(c.clave || '')] = Object.assign(todo[String(c.clave || '')] || {}, patch);
    });
    Db.actualizarVarios('Migracion_Mapeos', todo);
    return MigracionCaja.estado();
  },

  /** Descartar o recuperar filas: [{ id, descartada }]. */
  guardarFilas(p, user) {
    MigracionCaja._noImportada();
    const todo = {};
    (Array.isArray(p.filas) ? p.filas : []).forEach((c) => {
      todo[String(c.id || '')] = { descartada: c.descartada === true, nota: c.descartada === true ? 'Descartada a mano' : '' };
    });
    Db.actualizarVarios('Migracion_Caja', todo);
    MigracionCaja._proponer();
    return MigracionCaja.estado();
  },

  /** Ventas ya en el ERP por OC original (de la migración del stock). */
  _ventasPorOc() {
    const res = {};
    Db.all('Ventas').filter((v) => !v.anulada).forEach((v) => {
      const m = /OC original (\S+)/.exec(v.notas || '');
      const oc = m ? MigracionCaja.normalizarOc(m[1]) : '';
      if (oc) (res[oc] = res[oc] || []).push(v);
    });
    return res;
  },

  /** Tipo (ingreso / egreso) de una categoría de movimiento. */
  _tipoDe(categoria) {
    return Object.keys(CATEGORIAS_MOVIMIENTO).find((t) => CATEGORIAS_MOVIMIENTO[t][categoria]) || '';
  },

  estado() {
    const filas = Db.all('Migracion_Caja');
    const activas = filas.filter((f) => !f.descartada);
    const mapeos = Db.all('Migracion_Mapeos').filter((m) => m.tipo === 'caja');
    const uso = {};
    activas.forEach((f) => {
      const u = uso[f.clave] = uso[f.clave] || { filas: 0, entradas: 0, salidas: 0 };
      u.filas++; u.entradas += f.entradas; u.salidas += f.salidas;
    });
    const vigentes = mapeos.filter((m) => uso[m.clave]).map((m) => Object.assign(m, uso[m.clave]));
    const errores = [];
    const sin = vigentes.filter((m) => !m.confirmado).length;
    if (sin) errores.push(sin + ' grupos sin confirmar');
    vigentes.forEach((m) => {
      if (m.accion === 'venta' && CATEGORIAS_VENTA.indexOf(m.destino) === -1) errores.push('"' + m.original + '": elige la categoría de venta');
      if (m.accion === 'movimiento' && !MigracionCaja._tipoDe(m.destino)) errores.push('"' + m.original + '": elige la categoría del movimiento');
    });
    const sinFecha = activas.filter((f) => !f.fecha).length;
    if (sinFecha) errores.push(sinFecha + ' filas sin fecha válida (corrígelas en el Excel o descártalas)');

    // Cruce de OC con las ventas migradas.
    const porOc = MigracionCaja._ventasPorOc();
    const ocs = {};
    activas.filter((f) => f.oc).forEach((f) => {
      const o = ocs[f.oc] = ocs[f.oc] || { oc: f.oc, monto: 0, fecha: f.fecha, filas: 0 };
      o.monto += f.entradas - f.salidas; o.filas++;
      if (f.fecha && (!o.fecha || f.fecha < o.fecha)) o.fecha = f.fecha;
    });
    const totalVenta = {};
    Db.all('Ventas_Lineas').forEach((l) => { totalVenta[l.ventaId] = (totalVenta[l.ventaId] || 0) + l.precio * l.cantidad; });
    const listaOc = Object.keys(ocs).map((k) => {
      const o = ocs[k];
      const vs = porOc[k] || [];
      const erp = vs.reduce((t, v) => t + (totalVenta[v.id] || 0), 0);
      return Object.assign(o, { ventas: vs.map((v) => v.id), montoErp: erp, diferencia: vs.length ? o.monto - erp : null });
    }).sort((a, b) => a.oc.localeCompare(b.oc));
    const enCaja = {};
    listaOc.forEach((o) => { enCaja[o.oc] = true; });
    const soloErp = Object.keys(porOc).filter((k) => !enCaja[k]).sort();
    const accionDe = {};
    vigentes.forEach((m) => { accionDe[m.clave] = m; });
    const suma = (fn) => activas.filter(fn).reduce((t, f) => t + f.entradas - f.salidas, 0);
    return {
      filas: filas,
      mapeos: vigentes,
      errores: errores,
      acciones: MigracionCaja.ACCIONES,
      ocs: listaOc,
      ocSoloErp: soloErp,
      resumen: {
        filas: filas.length, descartadas: filas.length - activas.length,
        desde: activas.reduce((m, f) => (f.fecha && (!m || f.fecha < m) ? f.fecha : m), ''),
        hasta: activas.reduce((m, f) => (f.fecha > m ? f.fecha : m), ''),
        ocCaja: listaOc.length, ocEnErp: listaOc.filter((o) => o.ventas.length).length, ocConDiferencia: listaOc.filter((o) => o.diferencia).length,
        ventasMonto: suma((f) => (accionDe[f.clave] || {}).accion === 'venta'),
        movimientos: activas.filter((f) => (accionDe[f.clave] || {}).accion === 'movimiento').length,
        omitidas: activas.filter((f) => (accionDe[f.clave] || {}).accion === 'omitir').length,
      },
      importada: PropertiesService.getScriptProperties().getProperty(MigracionCaja.PROP) || '',
    };
  },

  /** Importa todo. p.consolidarTorneos: los torneos de un mismo día quedan en una sola venta. */
  importar(p, user) {
    MigracionCaja._noImportada();
    const est = MigracionCaja.estado();
    if (est.errores.length) throw new AppError('Antes de importar resuelve: ' + est.errores.join('; ') + '.');
    const map = {};
    est.mapeos.forEach((m) => { map[m.clave] = m; });
    const filas = est.filas.filter((f) => !f.descartada);
    Respaldos.crear('antes de importar la caja diaria', user);
    const sello = Util.sello(user, true);
    const ventasNuevas = [];   // { fecha, notas, lineas: [{ categoria, descripcion, monto }] }
    const movimientos = [];
    const cambiosVentas = {};
    const ajustes = [];

    // 1) OC: fecha real y ajuste por la diferencia con la caja.
    est.ocs.forEach((o) => {
      if (!o.ventas.length) {
        ventasNuevas.push({ fecha: o.fecha, notas: 'Caja diaria · OC original ' + o.oc + ' (no estaba en el stock)', lineas: [{ categoria: 'Otro', descripcion: 'OC original ' + o.oc, monto: o.monto }] });
        return;
      }
      o.ventas.forEach((id) => { cambiosVentas[id] = Object.assign(cambiosVentas[id] || {}, { fecha: o.fecha }); });
      if (o.diferencia) {
        const v = Db.get('Ventas', o.ventas[0]);
        ajustes.push({ ventaId: v.id, monto: o.diferencia });
        cambiosVentas[v.id].abono = v.abono + o.diferencia;
      }
    });

    // 2) Ventas por monto (con torneos del día consolidados si se pide) y 3) movimientos.
    const torneosDia = {};
    filas.forEach((f) => {
      const m = map[f.clave];
      if (!m || m.accion === 'oc' || m.accion === 'omitir') return;
      const neto = f.entradas - f.salidas;
      if (m.accion === 'venta') {
        if (f.entradas > 0) {
          const linea = { categoria: m.destino, descripcion: (m.extra || f.obs).slice(0, 120), monto: f.entradas };
          if (p.consolidarTorneos !== false && m.destino === 'Torneo') {
            const t = torneosDia[f.fecha] = torneosDia[f.fecha] || { fecha: f.fecha, notas: 'Caja diaria · torneos del día consolidados', lineas: [{ categoria: 'Torneo', descripcion: 'Torneos del día', monto: 0 }], n: 0 };
            t.lineas[0].monto += f.entradas; t.n++;
          } else {
            ventasNuevas.push({ fecha: f.fecha, notas: 'Caja diaria · fila ' + f.fila + (f.detalle ? ' · ' + f.detalle : ''), lineas: [linea] });
          }
        }
        // Una salida dentro de "Ventas" (devolución, comisión de plataforma…) queda como egreso.
        if (f.salidas > 0) movimientos.push({ fecha: f.fecha, tipo: 'egreso', categoria: 'otro_egreso', subcategoria: 'Salida en ventas · ' + f.obs, monto: f.salidas, referencia: 'Caja fila ' + f.fila, notas: f.detalle });
        return;
      }
      const tipo = MigracionCaja._tipoDe(m.destino);
      const sub = (m.extra || f.obs || '').slice(0, 120);
      const base = { fecha: f.fecha, subcategoria: sub, referencia: 'Caja fila ' + f.fila, notas: f.detalle };
      if (tipo === 'ingreso') {
        if (neto > 0) movimientos.push(Object.assign({ tipo: 'ingreso', categoria: m.destino, monto: neto }, base));
        else if (neto < 0) movimientos.push(Object.assign({ tipo: 'egreso', categoria: 'otro_egreso', monto: -neto }, base));
      } else {
        if (f.salidas > 0) movimientos.push(Object.assign({ tipo: 'egreso', categoria: m.destino, monto: f.salidas }, base));
        if (f.entradas > 0) movimientos.push(Object.assign({ tipo: 'ingreso', categoria: 'otro_ingreso', monto: f.entradas }, base, { subcategoria: 'Devolución · ' + sub }));
      }
    });
    Object.keys(torneosDia).sort().forEach((k) => {
      const t = torneosDia[k];
      if (t.n > 1) t.lineas[0].descripcion = 'Torneos del día (' + t.n + ')';
      ventasNuevas.push(t);
    });

    // Escritura.
    if (Object.keys(cambiosVentas).length) Db.actualizarVarios('Ventas', Object.keys(cambiosVentas).reduce((o, id) => { o[id] = Object.assign(cambiosVentas[id], Util.sello(user)); return o; }, {}));
    const idsVenta = Util.reservarIds('OC', 4, ventasNuevas.length);
    const nLineas = ventasNuevas.reduce((t, v) => t + v.lineas.length, 0) + ajustes.length;
    const idsLinea = Util.reservarIds('VL', 6, nLineas);
    let il = 0;
    const regLineas = [];
    const regVentas = ventasNuevas.map((v, i) => {
      const total = v.lineas.reduce((t, l) => t + l.monto, 0);
      v.lineas.forEach((l) => regLineas.push(Object.assign({ id: idsLinea[il++], ventaId: idsVenta[i], loteId: '', productoId: '', cantidad: 1, precioLista: l.monto, precio: l.monto, costo: 0, categoria: l.categoria, descripcion: l.descripcion }, sello)));
      return Object.assign({ id: idsVenta[i], fecha: v.fecha, clienteId: '', canal: 'Tienda', evento: '', medioPago: 'otro', boleta: '', abono: total, comision: 0, anulada: false, notas: v.notas }, sello);
    });
    ajustes.forEach((a) => regLineas.push(Object.assign({
      id: idsLinea[il++], ventaId: a.ventaId, loteId: '', productoId: '', cantidad: 1, precioLista: a.monto, precio: a.monto, costo: 0,
      categoria: 'Ajuste', descripcion: 'Diferencia con la caja diaria (otros productos / descuento)',
    }, sello)));
    if (regVentas.length) Db.insertMany('Ventas', regVentas);
    if (regLineas.length) Db.insertMany('Ventas_Lineas', regLineas);
    const idsMov = Util.reservarIds('MOV', 5, movimientos.length);
    if (movimientos.length) Db.insertMany('Finanzas', movimientos.map((m, i) => Object.assign({ id: idsMov[i], cuenta: '', anulado: false }, m, sello)));

    const resumen = {
      ventasFechadas: Object.keys(cambiosVentas).length, ajustes: ajustes.length, ventasNuevas: regVentas.length,
      movimientos: movimientos.length, ocSinCaja: est.ocSoloErp.length,
    };
    PropertiesService.getScriptProperties().setProperty(MigracionCaja.PROP, Util.ahora() + ' · ' + user.email);
    Audit.log(user, 'importar', 'Migración caja', '', resumen);
    return resumen;
  },

  limpiar(p, user) {
    MigracionCaja._noImportada();
    Db.vaciar('Migracion_Caja');
    const quedan = Db.all('Migracion_Mapeos').filter((m) => m.tipo !== 'caja');
    Db.vaciar('Migracion_Mapeos');
    if (quedan.length) Db.insertMany('Migracion_Mapeos', quedan);
    Audit.log(user, 'limpiar', 'Migración caja', '', {});
    return MigracionCaja.estado();
  },
};
