function doGet() {
  return HtmlService
    .createHtmlOutputFromFile('index')
    .setTitle('Revisión de Proformas')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ---------- Almacenamiento en Google Sheets ----------
// El libro es la planilla a la que está ligado el script. Si el script es independiente,
// usa la propiedad SPREADSHEET_ID y, si no existe, crea una planilla nueva y la recuerda.
function libro_() {
  const activo = SpreadsheetApp.getActiveSpreadsheet();
  if (activo) return activo;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  const nuevo = SpreadsheetApp.create('Control proformas Falabella');
  props.setProperty('SPREADSHEET_ID', nuevo.getId());
  return nuevo;
}

// Hojas que la app lee para armar el control de rutas, la liquidación de Perú y las tarifas de Sodimac Chile
const HOJAS_LECTURA = ['REGISTRO', 'GEOSORT', 'VIAJES PAGADOS', 'PERU RUTAS', 'PERU TARIFAS', 'PERU DISTRITOS', 'PERU FERIADOS', 'PERU AJUSTES', 'PERU MOVIMIENTOS', 'PERU CONDUCTORES', 'PERU QUINCENAS', 'PERU COSTOS FIJOS', 'PERU FACTURAS', 'PERU REGISTRO', 'SODIMAC CL TARIFAS', 'SODIMAC CL COMUNAS'];

function norm_(v) {
  return String(v == null ? '' : v).trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}
function iso_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss").replace('T00:00:00', '');
}
function clave_(v) {
  if (v instanceof Date) return iso_(v);
  if (typeof v === 'number' && Number.isInteger(v)) return String(v);
  return String(v == null ? '' : v).trim();
}
// Las fechas llegan como texto "AAAA-MM-DD[THH:MM:SS]" y se guardan como fecha real
function aCelda_(v) {
  if (v == null) return '';
  if (typeof v !== 'string') return v;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) : v;
}

// Borra las filas que calzan con la llave y agrega las nuevas, alineando columnas por nombre.
// llave: {todo:true} | {col, en:[valores]} | {col, desde, hasta} (fechas AAAA-MM-DD)
function combinar_(actual, op) {
  const head = actual.length ? actual[0].map(String) : [];
  let body = actual.slice(1);
  const pos = h => head.findIndex(x => norm_(x) === norm_(h));
  const ll = op.llave;
  if (ll && ll.todo) body = [];
  else if (ll) {
    const c = pos(ll.col);
    if (c >= 0) {
      const en = ll.en ? new Set(ll.en.map(String)) : null;
      body = body.filter(r => {
        const k = clave_(r[c]);
        if (en) return !en.has(k);
        const f = k.slice(0, 10);
        return !(f >= ll.desde && f <= ll.hasta);
      });
    }
  }
  const filas = op.filas || [];
  if (filas.length) {
    const map = filas[0].map(x => {
      if (String(x).trim() === '') return -1;
      let i = pos(x);
      if (i < 0) { head.push(String(x)); i = head.length - 1; }
      return i;
    });
    for (const r of filas.slice(1)) {
      const row = new Array(head.length).fill('');
      map.forEach((i, j) => { if (i >= 0) row[i] = aCelda_(r[j]); });
      body.push(row);
    }
  }
  const w = head.length;
  body = body.map(r => { const x = r.slice(0, w); while (x.length < w) x.push(''); return x; });
  return w ? [head].concat(body) : [];
}

function escribirHoja_(ss, nombre, datos) {
  let sh = ss.getSheetByName(nombre);
  if (!sh) sh = ss.insertSheet(nombre);
  sh.clearContents();
  if (!datos.length) return;
  sh.getRange(1, 1, datos.length, datos[0].length).setValues(datos);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, datos[0].length).setFontWeight('bold');
}

// ops: [{hoja, filas (con encabezado), llave}]
function guardarLote(ops) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = libro_(), res = {};
    for (const op of ops) {
      const sh = ss.getSheetByName(op.hoja);
      const actual = sh && sh.getLastRow() ? sh.getDataRange().getValues() : [];
      const datos = combinar_(actual, op);
      escribirHoja_(ss, op.hoja, datos);
      res[op.hoja] = Math.max(datos.length - 1, 0);
    }
    SpreadsheetApp.flush();
    return res;
  } finally {
    lock.releaseLock();
  }
}

function leerDatos() {
  const ss = libro_(), hojas = {};
  for (const n of HOJAS_LECTURA) {
    const sh = ss.getSheetByName(n);
    hojas[n] = sh && sh.getLastRow() ? sh.getDataRange().getValues().map(r => r.map(v => v instanceof Date ? iso_(v) : v)) : [];
  }
  return { hojas: hojas, url: ss.getUrl() };
}

// ---------- Tipo de cambio sol peruano -> peso chileno (hoja PERU TIPO CAMBIO) ----------
// Se completa con GOOGLEFINANCE("CURRENCY:PENCLP") los días que faltan desde el último guardado hasta hoy,
// cada vez que se abre la web. No pide permisos nuevos (usa la misma planilla). Solo se usa en resúmenes y KPI.
const HOJA_TC = 'PERU TIPO CAMBIO';
function tipoCambioPeru() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = libro_();
    let sh = ss.getSheetByName(HOJA_TC);
    if (!sh) {
      sh = ss.insertSheet(HOJA_TC);
      sh.getRange(1, 1, 1, 2).setValues([['FECHA', 'CLP POR SOL']]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    const leer = () => sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().filter(r => r[0] instanceof Date && Number(r[1]) > 0) : [];
    let filas = leer();
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    let desde = new Date(2025, 0, 1);
    if (filas.length) { desde = new Date(Math.max.apply(null, filas.map(r => r[0].getTime()))); desde.setDate(desde.getDate() + 1); }
    if (desde <= hoy) {
      const nuevas = historialPENCLP_(ss, desde, hoy);
      if (nuevas.length) { sh.getRange(sh.getLastRow() + 1, 1, nuevas.length, 2).setValues(nuevas); filas = leer(); }
    }
    return filas.map(r => [iso_(r[0]), Number(r[1])]);
  } finally {
    lock.releaseLock();
  }
}
function historialPENCLP_(ss, desde, hasta) {
  const tmp = ss.insertSheet('_TC_' + Date.now());
  try {
    const f = d => 'DATE(' + d.getFullYear() + ',' + (d.getMonth() + 1) + ',' + d.getDate() + ')';
    // Un día antes de "desde" para que GOOGLEFINANCE siempre devuelva al menos una fila
    const ini = new Date(desde); ini.setDate(ini.getDate() - 1);
    tmp.getRange('A1').setFormula('=GOOGLEFINANCE("CURRENCY:PENCLP","price",' + f(ini) + ',' + f(hasta) + ',"DAILY")');
    let v = [];
    for (let i = 0; i < 10; i++) {
      SpreadsheetApp.flush();
      v = tmp.getDataRange().getValues();
      if (v.length > 1 && v[1][0] instanceof Date) break;
      Utilities.sleep(1500);
    }
    return v.slice(1).filter(r => r[0] instanceof Date && Number(r[1]) > 0)
      .map(r => { const d = new Date(r[0]); d.setHours(0, 0, 0, 0); return [d, Number(r[1])]; })
      .filter(r => r[0] >= desde && r[0] <= hasta);
  } catch (e) {
    return [];
  } finally {
    ss.deleteSheet(tmp);
  }
}
