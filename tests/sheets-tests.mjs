// Prueba de Code.gs (guardarLote / leerDatos) con una planilla simulada en memoria.
// Uso: node tests/sheets-tests.mjs
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const code = fs.readFileSync(path.join(root, "apps-script", "Code.gs"), "utf8");

// ---------- Planilla simulada ----------
function hoja(nombre) {
  let datos = [];
  return {
    nombre,
    getLastRow: () => datos.length,
    getDataRange: () => ({ getValues: () => datos.map(r => r.slice()) }),
    clearContents: () => { datos = []; },
    getRange: (r, c, n, w) => ({
      setValues: v => {
        if (v.length !== n || v.some(x => x.length !== w)) throw new Error("setValues: tamaño distinto al rango");
        datos = v.map(x => x.slice());
      },
      setFontWeight: () => {}
    }),
    setFrozenRows: () => {},
    _datos: () => datos
  };
}
const hojas = new Map();
const libro = {
  getSheetByName: n => hojas.get(n) || null,
  insertSheet: n => { const h = hoja(n); hojas.set(n, h); return h; },
  getUrl: () => "https://docs.google.com/spreadsheets/d/prueba"
};
const p = n => String(n).padStart(2, "0");
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => libro, flush: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  Session: { getScriptTimeZone: () => "America/Santiago" },
  Utilities: { formatDate: d => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` },
  HtmlService: {}
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

// ---------- Casos ----------
const H = ["ID Proforma", "Factura", "ID Sol. Pago", "x", "Valor", "ID Viaje", "y", "Fecha Creación Viaje"];
const serv = prof => [H, [prof, 361, 1, 1, 100000, 14600001, 1, "2026-09-08T10:15:00"], [prof, 361, 1, "-", 0, 14600001, "-", "2026-09-08T10:15:00"]];
ctx.guardarLote([{ hoja: "SERVICE", filas: serv(37956), llave: { col: "ID Proforma", en: ["37956"] } }]);
ctx.guardarLote([{ hoja: "SERVICE", filas: serv(38272), llave: { col: "ID Proforma", en: ["38272"] } }]);
const r1 = ctx.guardarLote([{ hoja: "SERVICE", filas: serv(37956), llave: { col: "ID Proforma", en: ["37956"] } }]);
const service = hojas.get("SERVICE")._datos();

// Columnas en otro orden y una nueva: se alinean por nombre
ctx.guardarLote([{ hoja: "SERVICE", filas: [["id proforma", "Valor", "Nueva"], [40000, 5, "z"]], llave: { col: "ID Proforma", en: ["40000"] } }]);
const service2 = hojas.get("SERVICE")._datos();

// Registro: reemplaza el rango de fechas que trae el archivo
const RH = ["FECHA", "ID RUTA", "TOTAL RUTA"];
ctx.guardarLote([{ hoja: "REGISTRO", filas: [RH, ["2026-09-01", 1, 10], ["2026-09-15", 2, 20]], llave: { col: "FECHA", desde: "2026-09-01", hasta: "2026-09-15" } }]);
ctx.guardarLote([{ hoja: "REGISTRO", filas: [RH, ["2026-09-10", 3, 30], ["2026-09-20", 4, 40]], llave: { col: "FECHA", desde: "2026-09-10", hasta: "2026-09-20" } }]);
const leido = ctx.leerDatos();

// Quitar una proforma
ctx.guardarLote([{ hoja: "SERVICE", filas: [], llave: { col: "ID Proforma", en: ["38272"] } }]);
const service3 = hojas.get("SERVICE")._datos();

let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${JSON.stringify(got)}${ok ? "" : "  (esperado " + JSON.stringify(want) + ")"}`);
};
check("Volver a cargar reemplaza la proforma", [r1.SERVICE, service.map(r => r[0]).slice(1)], [4, [38272, 38272, 37956, 37956]]);
check("Fecha guardada como fecha", [Object.prototype.toString.call(service[1][7]), service[1][7].getHours()], ["[object Date]", 10]);
check("Columnas por nombre", [service2[0], service2[5]], [[...H, "Nueva"], [40000, "", "", "", 5, "", "", "", "z"]]);
check("Registro reemplaza por rango de fechas", leido.hojas.REGISTRO.map(r => r[1]), ["ID RUTA", 1, 3, 4]);
check("leerDatos entrega fechas como texto", [leido.hojas.REGISTRO[1][0], leido.url], ["2026-09-01", "https://docs.google.com/spreadsheets/d/prueba"]);
check("Quitar proforma", service3.map(r => r[0]).slice(1), [37956, 37956, 40000]);

console.log(fails ? `\n${fails} prueba(s) fallaron` : "\nTodas las pruebas pasaron");
process.exit(fails ? 1 : 0);
