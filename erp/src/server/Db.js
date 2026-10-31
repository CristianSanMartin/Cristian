/**
 * Acceso a datos sobre Google Sheets. Cada tabla de SCHEMA es una hoja;
 * las filas se exponen como objetos planos con tipos ya convertidos.
 *
 * Las lecturas se cachean durante una misma llamada a la API. Las escrituras
 * actualizan esa caché en el mismo momento (no se vuelve a leer la hoja), y
 * agregar filas a una tabla que no se ha leído (ej. Auditoria) no la lee entera:
 * así guardar no se hace más lento a medida que las hojas crecen.
 */
const Db = {
  _ss: null,
  _cache: {},
  _tz: null,
  /** Medición de la llamada en curso (se registra en los registros de ejecución de Apps Script). */
  stats: { lecturas: 0, filas: 0, escrituras: 0, msLectura: 0, tablas: {} },

  reset() {
    Db._cache = {};
    if (typeof Audit !== 'undefined') Audit._prop = undefined;
    Db.stats = { lecturas: 0, filas: 0, escrituras: 0, msLectura: 0, tablas: {} };
  },

  tz() {
    if (!Db._tz) Db._tz = Db.ss().getSpreadsheetTimeZone() || APP.tz;
    return Db._tz;
  },

  ss() {
    if (Db._ss) return Db._ss;
    const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      throw new AppError('La base de datos no está configurada. Un administrador debe ejecutar instalar() desde el editor de Apps Script.', 'NO_INSTALADO');
    }
    Db._ss = ss;
    return ss;
  },

  schema(table) {
    const s = SCHEMA[table];
    if (!s) throw new Error('Tabla desconocida: ' + table);
    return s;
  },

  sheet(table) {
    const sh = Db.ss().getSheetByName(table);
    if (!sh) {
      throw new AppError('Falta la hoja "' + table + '". Un administrador debe ejecutar instalar().', 'NO_INSTALADO');
    }
    return sh;
  },

  /** Crea la hoja si no existe y agrega las columnas faltantes (no borra ni reordena nada). */
  ensureSheet(table) {
    const schema = Db.schema(table);
    const ss = Db.ss();
    let sh = ss.getSheetByName(table);
    if (!sh) sh = ss.insertSheet(table);
    const lastCol = sh.getLastColumn();
    let headers;
    if (sh.getLastRow() <= 1) {
      // Hoja sin datos: el encabezado queda exactamente como el esquema actual.
      headers = Object.keys(schema.cols);
      if (lastCol > headers.length) sh.getRange(1, headers.length + 1, 1, lastCol - headers.length).clearContent();
    } else {
      headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
      Object.keys(schema.cols).forEach((col) => {
        if (headers.indexOf(col) === -1) headers.push(col);
      });
    }
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // Texto plano para fechas y textos: evita que Sheets convierta "2026-01-05" o "0012" en otros tipos.
    const filas = sh.getMaxRows() - 1;
    headers.forEach((col, i) => {
      const type = schema.cols[col];
      if (!type || filas < 1) return;
      sh.getRange(2, i + 1, filas, 1).setNumberFormat(type === 'n' || type === 'b' ? 'General' : '@');
    });
    delete Db._cache[table];
    return sh;
  },

  _load(table) {
    if (Db._cache[table] && Db._cache[table].rows) return Db._cache[table];
    const t0 = Date.now();
    const schema = Db.schema(table);
    const sh = Db.sheet(table);
    const tz = Db.tz();
    const values = sh.getLastRow() ? sh.getDataRange().getValues() : [];
    const headers = values.length ? values[0].map(String) : Object.keys(schema.cols);
    // Si la hoja no tiene alguna columna del esquema (se actualizó el código sin ejecutar instalar),
    // se detiene: escribir así perdería datos en silencio.
    const faltantes = values.length ? Object.keys(schema.cols).filter((c) => headers.indexOf(c) === -1) : [];
    if (faltantes.length) {
      throw new AppError('La hoja "' + table + '" no está actualizada (faltan columnas: ' + faltantes.join(', ') +
        '). Un administrador debe ejecutar instalar() para actualizar la planilla.', 'NO_INSTALADO');
    }
    const rows = [];
    for (let r = 1; r < values.length; r++) {
      const raw = values[r];
      if (raw.every((v) => v === '' || v == null)) continue;
      const obj = {};
      headers.forEach((col, i) => {
        const type = schema.cols[col];
        if (type) obj[col] = Db._parse(raw[i], type, tz);
      });
      rows.push({ rowNum: r + 1, raw: raw, obj: obj });
    }
    Db._cache[table] = { headers: headers, rows: rows, sheet: sh };
    const ms = Date.now() - t0;
    Db.stats.lecturas++;
    Db.stats.filas += rows.length;
    Db.stats.msLectura += ms;
    const st = Db.stats.tablas[table] = Db.stats.tablas[table] || { lecturas: 0, filas: 0, ms: 0 };
    st.lecturas++; st.filas = rows.length; st.ms += ms;
    return Db._cache[table];
  },

  /** Solo el encabezado (para agregar filas sin leer la hoja entera). */
  _encabezado(table) {
    const c = Db._cache[table];
    if (c) return c;
    const schema = Db.schema(table);
    const sh = Db.sheet(table);
    const lastCol = sh.getLastColumn();
    const headers = lastCol && sh.getLastRow() ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : Object.keys(schema.cols);
    const faltantes = Object.keys(schema.cols).filter((col) => headers.indexOf(col) === -1);
    if (faltantes.length) {
      throw new AppError('La hoja "' + table + '" no está actualizada (faltan columnas: ' + faltantes.join(', ') +
        '). Un administrador debe ejecutar instalar() para actualizar la planilla.', 'NO_INSTALADO');
    }
    Db._cache[table] = { headers: headers, rows: null, sheet: sh };
    return Db._cache[table];
  },

  /** Lo que se leería de una fila recién escrita (para mantener la caché al día sin volver a leer la hoja). */
  _leida(table, headers, row) {
    const cols = Db.schema(table).cols;
    const tz = Db.tz();
    const obj = {};
    headers.forEach((col, i) => {
      if (!cols[col]) return;
      let v = row[i];
      if (typeof v === 'string' && v.charAt(0) === "'" && v.charAt(1) === '=') v = v.slice(1);
      obj[col] = Db._parse(v, cols[col], tz);
    });
    return obj;
  },

  _parse(v, type, tz) {
    if (Object.prototype.toString.call(v) === '[object Date]') {
      if (type === 't') return Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm:ss');
      if (type === 'n') return v.getTime();
      return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    }
    switch (type) {
      case 'n': return v === '' || v == null ? 0 : Number(v) || 0;
      case 'b': return v === true || String(v).toUpperCase() === 'TRUE' || v === 1;
      case 'd': return v == null ? '' : String(v).trim().slice(0, 10);
      default: return v == null ? '' : String(v);
    }
  },

  _serialize(v, type) {
    switch (type) {
      case 'n': return Number(v) || 0;
      case 'b': return v === true;
      default: {
        const str = v == null ? '' : String(v);
        // Un texto que empieza con "=" se guardaría como fórmula; el apóstrofo lo fuerza a texto (Sheets no lo devuelve al leer).
        return str.charAt(0) === '=' ? "'" + str : str;
      }
    }
  },

  _toRow(table, headers, obj, raw) {
    const cols = Db.schema(table).cols;
    return headers.map((col, i) => (cols[col] ? Db._serialize(obj[col], cols[col]) : raw ? raw[i] : ''));
  },

  all(table) {
    return Db._load(table).rows.map((r) => Object.assign({}, r.obj));
  },

  get(table, key) {
    const k = Db.schema(table).key;
    const entry = Db._load(table).rows.find((r) => r.obj[k] === key);
    return entry ? Object.assign({}, entry.obj) : null;
  },

  insert(table, obj) {
    Db.insertMany(table, [obj]);
    return obj;
  },

  insertMany(table, objs) {
    if (!objs.length) return;
    // Si la tabla no se ha leído en esta llamada, basta con su encabezado (no se lee entera).
    const data = Db._encabezado(table);
    const rows = objs.map((o) => Db._toRow(table, data.headers, o));
    const start = Math.max(data.sheet.getLastRow(), 1) + 1;
    const faltan = start + rows.length - 1 - data.sheet.getMaxRows();
    if (faltan > 0) data.sheet.insertRowsAfter(data.sheet.getMaxRows(), faltan);
    data.sheet.getRange(start, 1, rows.length, data.headers.length).setValues(rows);
    Db.stats.escrituras++;
    if (data.rows) rows.forEach((row, i) => data.rows.push({ rowNum: start + i, raw: row, obj: Db._leida(table, data.headers, row) }));
  },

  update(table, key, patch) {
    const k = Db.schema(table).key;
    const data = Db._load(table);
    const entry = data.rows.find((r) => r.obj[k] === key);
    if (!entry) throw new AppError('El registro no existe o fue eliminado.', 'NO_ENCONTRADO');
    const merged = Object.assign({}, entry.obj, patch);
    const row = Db._toRow(table, data.headers, merged, entry.raw);
    data.sheet.getRange(entry.rowNum, 1, 1, data.headers.length).setValues([row]);
    Db.stats.escrituras++;
    entry.raw = row;
    entry.obj = Db._leida(table, data.headers, row);
    return Object.assign({}, entry.obj);
  },

  /** Actualiza varios registros con una sola escritura: { clave: cambios }. */
  actualizarVarios(table, cambios) {
    const k = Db.schema(table).key;
    const data = Db._load(table);
    const claves = Object.keys(cambios);
    if (!claves.length) return;
    claves.forEach((c) => { if (!data.rows.some((r) => r.obj[k] === c)) throw new AppError('El registro ' + c + ' no existe.', 'NO_ENCONTRADO'); });
    const primera = data.rows[0].rowNum;
    const ultima = data.rows[data.rows.length - 1].rowNum;
    const valores = data.sheet.getRange(primera, 1, ultima - primera + 1, data.headers.length).getValues();
    data.rows.forEach((r) => {
      const patch = cambios[r.obj[k]];
      if (!patch) return;
      const row = Db._toRow(table, data.headers, Object.assign({}, r.obj, patch), r.raw);
      valores[r.rowNum - primera] = row;
      r.raw = row;
      r.obj = Db._leida(table, data.headers, row);
    });
    data.sheet.getRange(primera, 1, valores.length, data.headers.length).setValues(valores);
    Db.stats.escrituras++;
  },

  /** Deja la tabla vacía (solo el encabezado). Se usa en la zona de migración. */
  vaciar(table) {
    const data = Db._load(table);
    const ultima = data.sheet.getLastRow();
    if (ultima > 1) data.sheet.getRange(2, 1, ultima - 1, Math.max(data.headers.length, data.sheet.getLastColumn())).clearContent();
    delete Db._cache[table];
  },

  remove(table, key) {
    const k = Db.schema(table).key;
    const data = Db._load(table);
    const entry = data.rows.find((r) => r.obj[k] === key);
    if (!entry) throw new AppError('El registro no existe o fue eliminado.', 'NO_ENCONTRADO');
    data.sheet.deleteRow(entry.rowNum);
    Db.stats.escrituras++;
    // Las filas de abajo suben una posición.
    data.rows = data.rows.filter((r) => r !== entry);
    data.rows.forEach((r) => { if (r.rowNum > entry.rowNum) r.rowNum--; });
  },
};
