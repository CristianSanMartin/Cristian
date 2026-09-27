/**
 * Simulador mínimo de los servicios de Google Apps Script que usa el ERP
 * (SpreadsheetApp, Session, LockService, PropertiesService, Utilities).
 *
 * Se usa en las pruebas (Node, vía vm) y en la vista previa local (Web Worker).
 * Imita un detalle importante de Sheets: en columnas que no tienen formato de
 * texto, un string "yyyy-mm-dd" se convierte en fecha al escribirlo.
 */
// eslint-disable-next-line no-unused-vars
var createGasFake = function (opts) {
  opts = opts || {};
  var state = opts.state || { sheets: [], props: {} };
  state.files = state.files || {};
  state.folders = state.folders || {};
  var currentUser = opts.user || '';
  var sheetTz = 'UTC';

  function reviveCell(v) {
    return v && typeof v === 'object' && v.__date ? new Date(v.__date) : v;
  }
  state.sheets.forEach(function (s) {
    s.values = s.values.map(function (r) { return r.map(reviveCell); });
  });

  function isoDateLike(v) {
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  }

  function Range(sheet, row, col, numRows, numCols) {
    this._s = sheet; this._r = row; this._c = col; this._nr = numRows; this._nc = numCols;
  }
  Range.prototype.getValues = function () {
    var out = [];
    for (var i = 0; i < this._nr; i++) {
      var src = this._s.data.values[this._r - 1 + i] || [];
      var row = [];
      for (var j = 0; j < this._nc; j++) {
        var v = src[this._c - 1 + j];
        row.push(v === undefined ? '' : v);
      }
      out.push(row);
    }
    return out;
  };
  Range.prototype.setValues = function (values) {
    if (values.length !== this._nr || values[0].length !== this._nc) {
      throw new Error('Las dimensiones de los datos no coinciden con el rango.');
    }
    if (this._r + this._nr - 1 > this._s.data.maxRows) throw new Error('Rango fuera de los límites de la hoja.');
    for (var i = 0; i < this._nr; i++) {
      var rowIdx = this._r - 1 + i;
      var row = this._s.data.values[rowIdx] || (this._s.data.values[rowIdx] = []);
      for (var j = 0; j < this._nc; j++) {
        var colIdx = this._c - 1 + j;
        var v = values[i][j];
        if (typeof v === 'string' && v.charAt(0) === '=') throw new Error('El simulador no evalúa fórmulas: ' + v);
        if (typeof v === 'string' && v.charAt(0) === "'") v = v.slice(1);
        if (rowIdx > 0 && isoDateLike(v) && this._s.data.formats[colIdx] !== '@') {
          v = new Date(v + 'T00:00:00Z');
        }
        row[colIdx] = v;
      }
    }
    return this;
  };
  Range.prototype.setNumberFormat = function (f) {
    for (var j = 0; j < this._nc; j++) this._s.data.formats[this._c - 1 + j] = f;
    return this;
  };
  Range.prototype.clearContent = function () {
    for (var i = 0; i < this._nr; i++) {
      var row = this._s.data.values[this._r - 1 + i];
      if (!row) continue;
      for (var j = 0; j < this._nc; j++) row[this._c - 1 + j] = '';
    }
    return this;
  };
  ['setFontWeight', 'setBackground', 'setFontColor'].forEach(function (m) {
    Range.prototype[m] = function () { return this; };
  });

  function Sheet(data) { this.data = data; }
  Sheet.prototype.getName = function () { return this.data.name; };
  Sheet.prototype.setName = function (n) { this.data.name = n; return this; };
  Sheet.prototype.getLastRow = function () {
    for (var i = this.data.values.length - 1; i >= 0; i--) {
      var r = this.data.values[i];
      if (r && r.some(function (v) { return v !== '' && v != null; })) return i + 1;
    }
    return 0;
  };
  Sheet.prototype.getLastColumn = function () {
    return this.data.values.reduce(function (m, r) {
      var last = 0;
      (r || []).forEach(function (v, i) { if (v !== '' && v != null) last = i + 1; });
      return Math.max(m, last);
    }, 0);
  };
  Sheet.prototype.getMaxRows = function () { return this.data.maxRows; };
  Sheet.prototype.insertRowsAfter = function (after, n) { this.data.maxRows += n; };
  Sheet.prototype.getRange = function (row, col, numRows, numCols) {
    if (row < 1 || col < 1) throw new Error('Coordenadas de rango inválidas.');
    return new Range(this, row, col, numRows || 1, numCols || 1);
  };
  Sheet.prototype.getDataRange = function () {
    return new Range(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
  };
  Sheet.prototype.deleteRow = function (row) { this.data.values.splice(row - 1, 1); };
  Sheet.prototype.setFrozenRows = function () {};

  var spreadsheet = {
    getId: function () { return 'fake-spreadsheet'; },
    getSpreadsheetTimeZone: function () { return sheetTz; },
    getSheets: function () { return state.sheets.map(function (d) { return new Sheet(d); }); },
    getSheetByName: function (name) {
      var d = state.sheets.find(function (s) { return s.name === name; });
      return d ? new Sheet(d) : null;
    },
    insertSheet: function (name) {
      var d = { name: name, values: [], formats: {}, maxRows: 1000 };
      state.sheets.push(d);
      return new Sheet(d);
    },
    deleteSheet: function (sheet) {
      state.sheets = state.sheets.filter(function (s) { return s.name !== sheet.getName(); });
    },
  };

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  var gas = {
    SpreadsheetApp: {
      getActiveSpreadsheet: function () { return spreadsheet; },
      openById: function () { return spreadsheet; },
      flush: function () {},
      getUi: function () { throw new Error('UI no disponible en este contexto.'); },
    },
    Session: {
      getActiveUser: function () { return { getEmail: function () { return currentUser; } }; },
    },
    LockService: {
      getScriptLock: function () { return { tryLock: function () { return true; }, releaseLock: function () {} }; },
    },
    PropertiesService: {
      getScriptProperties: function () {
        return {
          getProperty: function (k) { return state.props[k] || null; },
          setProperty: function (k, v) { state.props[k] = String(v); },
        };
      },
    },
    Utilities: {
      getUuid: function () {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          var r = (Math.random() * 16) | 0;
          return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });
      },
      base64Decode: function (b64) { return String(b64); },
      newBlob: function (bytes, mime, name) { return { bytes: bytes, mime: mime, name: name }; },
      formatDate: function (date, tz, fmt) {
        var parts = {};
        new Intl.DateTimeFormat('en-US', {
          timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
        }).formatToParts(date).forEach(function (p) { parts[p.type] = Number(p.value); });
        return fmt.replace('yyyy', parts.year).replace('MM', pad(parts.month)).replace('dd', pad(parts.day))
          .replace('HH', pad(parts.hour)).replace('mm', pad(parts.minute)).replace('ss', pad(parts.second));
      },
    },
    HtmlService: {},
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
      Permission: { VIEW: 'VIEW' },
      createFolder: function (name) {
        var id = 'fld-' + Object.keys(state.folders).length;
        state.folders[id] = { name: name, editors: [] };
        return gas.DriveApp.getFolderById(id);
      },
      getFolderById: function (id) {
        var f = state.folders[id];
        if (!f) throw new Error('Carpeta no encontrada: ' + id);
        return {
          getId: function () { return id; },
          addEditor: function (email) { if (f.editors.indexOf(email) === -1) f.editors.push(email); },
          createFile: function (blob) {
            var fid = 'img-' + (Object.keys(state.files).length + 1);
            state.files[fid] = { folder: id, name: blob.name, mime: blob.mime, base64: blob.bytes, shared: false };
            return {
              getId: function () { return fid; },
              setSharing: function () { state.files[fid].shared = true; },
            };
          },
        };
      },
    },
    console: typeof console !== 'undefined' ? console : { log: function () {}, error: function () {} },
  };

  return {
    globals: gas,
    setUser: function (email) { currentUser = email; },
    /** Estado serializable (para guardar la vista previa en localStorage). */
    dump: function () {
      return JSON.parse(JSON.stringify(state, function (k, v) {
        return this[k] instanceof Date ? { __date: this[k].toISOString() } : v;
      }));
    },
    state: state,
  };
};
