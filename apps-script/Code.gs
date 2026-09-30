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

// Hojas que la app lee para armar el control de rutas
const HOJAS_LECTURA = ['REGISTRO', 'GEOSORT', 'VIAJES PAGADOS'];

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
