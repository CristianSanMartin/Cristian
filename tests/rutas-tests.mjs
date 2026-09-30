// Prueba end-to-end de la pestaña "Rutas pendientes" con registro, geosort y proformas sintéticos.
// Uso: node tests/rutas-tests.mjs
import { chromium } from "playwright";
import XLSX from "xlsx";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(root, "apps-script", "index.html");
const XLSX_JS = path.join(root, "node_modules", "xlsx", "dist", "xlsx.full.min.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rutas-"));
const d = s => new Date(s + "T12:00:00");
const TL1 = "aaaaaaaa-0000-0000-0000-000000000001", TL2 = "aaaaaaaa-0000-0000-0000-000000000002",
      TL3 = "aaaaaaaa-0000-0000-0000-000000000003";

// ---------- Registro de operaciones ----------
const reg = [["FECHA", "CUENTA", "PATENTE", "ORIGEN", "ID RUTA", "TOTAL RUTA", "LOCALIDAD", "TERMINADO", "TOTAL", "NS", "INGRESO"],
  [d("2026-09-08"), "FALABELLA", "AAAA-11", "CT RANCAGUA (WMOS)", 14600001, 100000, "RANCAGUA", 9, 10, 0.9, 125000], // pagada por ID
  [d("2026-09-08"), "FALABELLA", "BBBB-22", "CT RANCAGUA (WMOS)", 14600002, 120000, "MACHALI"],    // pendiente
  [d("2026-09-08"), "FALABELLA", "CCCC-33", "CT VALPARAISO (WMOS)", 14600003, 60000, "VIÑA DEL MAR"], // pagada con otro ID
  [d("2026-09-09"), "FALABELLA", "DDDD-44/Garate", "TREN LOGISTICO", TL1, 85000, "RM"],          // TL 2da vuelta
  [d("2026-09-09"), "FALABELLA", "DDDD-44/Garate", "TREN LOGISTICO", TL2, 50000, "RM"],
  [d("2026-09-09"), "FALABELLA", "EEEE-55/Garate", "TREN LOGISTICO", TL3, 85000, "RM"],          // TL pagado
  [d("2026-09-09"), "FALABELLA", "FFFF-66", "CT RANCAGUA (STS)", 866001, 70000, "TOTTUS"],        // transferencia pagada
  [d("2026-09-09"), "FALABELLA", "FFFF-66", "CT RANCAGUA (STS)", 866001, 0, "HOME CENTER"],       // mismo viaje, otro destino
  [d("2026-09-01"), "FALABELLA", "GGGG-77", "CT RANCAGUA (WMOS)", 14590001, 120000, "RENGO"],     // fuera del periodo
  [d("2026-09-09"), "FALABELLA", "HHHH-88", "CT RANCAGUA (WMOS)", "-", -40000, "DESCUENTO COMBUSTIBLE"], // ajuste
  [d("2026-09-10"), "FALABELLA", "JJJJ-99", "BIG Ticket PM", 0, 90000, "RENCA"]];                  // sin ID
const wbReg = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wbReg, XLSX.utils.aoa_to_sheet(reg, { cellDates: true }), "Hoja1");
XLSX.writeFile(wbReg, path.join(tmp, "registro.xlsx"));

// ---------- Proformas ----------
const OT_H = ["Transportista", "ID Proforma", "Factura", "ID Sol. Pago", "Estado Sol. Pago", "Tipo de solicitud de pago", "Valor",
  "ID Viaje", "Fecha Creación Viaje", "Origen", "Patente"];
function proforma(nombre, id, ot, tr = []) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([OT_H, ...ot], { cellDates: true }), "Ordenes de Transporte");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Id Proforma", "Factura", "Id Sol. Pago", "Tipo Solicitud de pago",
    "Id Viaje (Solicitud de transporte)", "Fecha creación Viaje", "Origen", "Valor", "Patente"], ...tr], { cellDates: true }), "Viajes de Transferencia");
  XLSX.writeFile(wb, path.join(tmp, nombre));
}
const ot = (prof, sol, tipo, valor, viaje, fecha, origen, pat) =>
  ["GARATE", prof, "361", sol, "Payment_OK", tipo, valor, viaje, d(fecha), origen, pat];
const dia = (f, n, prof, base) => Array.from({ length: n }, (_, i) => ot(prof, base + i, "SERVICE", 100000, 15000000 + base + i, f, "CT RANCAGUA", "ZZ" + i));
proforma("p1.xlsx", "37956", [
  ot("37956", "900001", "SERVICE", "120000", "14600001", "2026-09-08", "CT RANCAGUA", "AAAA11"),
  ot("37956", "900001", "SERVICE", "120000", "14600001", "2026-09-08", "CT RANCAGUA", "AAAA11"),
  ot("37956", "900002", "DELIVERY", "1500", "14600099", "2026-09-08", "CT VALPARAISO", "CCCC33"),
  ot("37956", "900003", "DELIVERY", "1500", "14600099", "2026-09-08", "CT VALPARAISO", "CCCC33"),
  ot("37956", "900004", "SERVICE", "110000", TL3, "2026-09-09", "TL - Hub XD", "EEEE55"),
  ot("37956", "900005", "SERVICE", "250000", "14400000", "2026-04-28", "CT VALPARAISO", "KKKK00"), // rezagado sin registro
  ...dia("2026-09-08", 6, "37956", 1000), ...dia("2026-09-09", 6, "37956", 2000)],
  [["37956", "361", "900010", "SHIPMENT", "866001", d("2026-09-09"), "CT RANCAGUA", "70000", "FFFF66"],
   ["37956", "361", "900010", "SHIPMENT", "866001", d("2026-09-09"), "CT RANCAGUA", "70000", "FFFF66"]]);
proforma("p2.xlsx", "38272", dia("2026-09-10", 6, "38272", 3000));

// ---------- Geosort (CSV con ";" dentro de campos entre comillas) ----------
const G_H = "Suborden;Estado;Patente;Empresa;Idruta;Ct;Fechainicioruta;Fechapactada;Simpliroute_id";
const geo = [G_H,
  `1;Terminado;AAAA-11;GARATE;14600001;CT RANCAGUA (WMOS);08-09-2026 10:00;08-09-2026;"a;b"`,
  `2;Terminado;AAAA-11;GARATE;14600001;CT RANCAGUA (WMOS);08-09-2026 10:00;08-09-2026;"c;d"`,
  `3;Terminado;LLLL-10;GARATE;14600050;CT RANCAGUA (WMOS);09-09-2026 10:00;09-09-2026;x`,   // salió y no está en registro
  `4;Pendiente;LLLL-10;GARATE;14600050;CT RANCAGUA (WMOS);09-09-2026 10:00;09-09-2026;x`,
  `5;Planificado;MMMM-20;GARATE;14600060;CT VALPARAISO (WMOS);31/12/0001 0:00;09-09-2026;x`]; // no salió
fs.writeFileSync(path.join(tmp, "geosort.csv"), "﻿" + geo.join("\r\n"));

// ---------- Ejecutar la app ----------
const browser = await chromium.launch();
const page = await browser.newPage({ acceptDownloads: true });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.route("**/xlsx.full.min.js", r => r.fulfill({ path: XLSX_JS, contentType: "application/javascript" }));
await page.goto("file://" + HTML);
await page.click("text=Control de rutas");
const vistaProformaOculta = await page.isHidden("#vistaProforma");
await page.setInputFiles("#inRegistro", path.join(tmp, "registro.xlsx"));
await page.setInputFiles("#inGeosort", path.join(tmp, "geosort.csv"));
await page.setInputFiles("#inProformas", [path.join(tmp, "p1.xlsx"), path.join(tmp, "p2.xlsx")]);
await page.waitForFunction("rutasDatos.proformas.length===2 && rutasDatos.geosort && rutasDatos.registro");
await page.waitForFunction("cruceRutas && cruceRutas.filas.some(f=>f.fuente==='Solo geosort')");
const res = await page.evaluate(`({
  cob:[cruceRutas.desde,cruceRutas.hasta],
  est:Object.fromEntries(cruceRutas.filas.map(f=>[f.id||f.patente,f.estado])),
  n:cruceRutas.filas.length, ajustes:cruceRutas.ajustes, plan:cruceRutas.planificadas,
  sinReg:cruceRutas.sinRegistro.map(v=>v.id).filter(id=>!id.startsWith("15")),
  valorTransfer:cruceRutas.filas.find(f=>f.id==="866001").pago.valor,
  totalTransfer:cruceRutas.filas.find(f=>f.id==="866001").total,
  geoPuntos:cruceRutas.filas.find(f=>f.id==="14600001").geo.puntos
})`);
await page.click(".estado-item >> nth=0");
const filasPendiente = await page.$$eval("#rutasBody tr", trs => trs.length);
const [dl] = await Promise.all([page.waitForEvent("download"), page.click("text=Descargar cruce Excel")]);
const out = path.join(tmp, "cruce.xlsx"); await dl.saveAs(out);
// Almacén: cada carga queda en su hoja y volver a cargar el mismo archivo no duplica filas
const hojas1 = await page.evaluate(`Object.fromEntries(Object.entries(almacenLocal.hojas).map(([k,v])=>[k,v.length-1]))`);
await page.setInputFiles("#inProformas", path.join(tmp, "p1.xlsx"));
await page.setInputFiles("#inRegistro", path.join(tmp, "registro.xlsx"));
await page.waitForTimeout(500);
await page.waitForFunction("rutasDatos.proformas.length===2 && cruceRutas");
const hojas2 = await page.evaluate(`Object.fromEntries(Object.entries(almacenLocal.hojas).map(([k,v])=>[k,v.length-1]))`);
const control = await page.evaluate(`(()=>{ const f=cruceRutas.filas.find(f=>f.id==="14600001");
  const h=almacenLocal.hojas["CONTROL RUTAS"], r=h.find(r=>r[3]===14600001);
  return {fila:[f.terminado,f.puntos,f.ns,f.total,f.cobro,f.validador,f.ingreso,f.dif,f.pago.proforma,f.pago.factura],
    hoja:Object.fromEntries(h[0].map((k,i)=>[k,r[i]])),
    dia:resumenDias().find(d=>d.fecha==="2026-09-08"),
    shipmentHead:almacenLocal.hojas.SHIPMENT[0].slice(0,4), serviceX:almacenLocal.hojas.SERVICE[0].includes("x") }; })()`);
await page.click(".estado-item.sel");
await page.click("#diasBody tr >> text=08-09-2026");
const filasDia = await page.$$eval("#rutasBody tr", trs => trs.length);
// Filtros por columna y orden alfabético
await page.click("#diasBody tr.sel");  // quitar filtro de día
await page.click(".orden >> text=Patente");
const patAsc = await page.$$eval("#rutasBody tr td:nth-child(2)", tds => tds.map(t => t.textContent));
await page.click(".orden >> text=Patente");
const patDesc = await page.$$eval("#rutasBody tr td:nth-child(2)", tds => tds.map(t => t.textContent));
await page.fill('.filtro-col[data-k="estado"]', "pendi");
const filtroEstado = await page.$$eval("#rutasBody tr td:nth-child(2)", tds => tds.map(t => t.textContent));
const errText = await page.textContent("#errorText");
await browser.close();

// ---------- Verificaciones ----------
let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${JSON.stringify(got)}${ok ? "" : "  (esperado " + JSON.stringify(want) + ")"}`);
};
check("Sin errores JS", errors.concat(errText ? [errText] : []), []);
check("Pestaña oculta la vista de proforma", vistaProformaOculta, true);
check("Periodo cubierto (sin rezagados)", res.cob, ["2026-09-08", "2026-09-10"]);
check("Pagada por ID", res.est["14600001"], "Pagada");
check("Pendiente", res.est["14600002"], "Pendiente");
check("Pagada con otro ID (patente + fecha)", res.est["14600003"], "Pagada con otro ID");
check("TL 2da vuelta", [res.est[TL1], res.est[TL2]], ["TL 2da vuelta (esperar objeción)", "TL 2da vuelta (esperar objeción)"]);
check("TL pagado", res.est[TL3], "Pagada");
check("Transferencia pagada", res.est["866001"], "Pagada");
check("Transferencia agrupa destinos", [res.valorTransfer, res.totalTransfer], [70000, 70000]);
check("Fuera del periodo", res.est["14590001"], "Sin proforma cargada");
check("Sin ID", res.est["JJJJ-99"], "Sin ID en registro");
check("Solo en geosort", res.est["14600050"], "Pendiente");
check("Ajustes y planificadas fuera", [res.ajustes, res.plan, res.n], [1, 1, 10]);
check("Pagado sin registro", res.sinReg, ["14400000"]);
check("Puntos del geosort", res.geoPuntos, 2);
check("Filtro por estado desde el panel", filasPendiente, 2);
const wb = XLSX.readFile(out);
check("Hojas del Excel", wb.SheetNames, ["Resumen", "Rutas", "Pagado sin registro"]);
const resumen = XLSX.utils.sheet_to_json(wb.Sheets["Resumen"], { header: 1 });
check("Resumen pendientes", resumen[1], ["Pendiente", 2, 120000]);

check("Hojas guardadas", hojas1, { REGISTRO: 11, GEOSORT: 3, SERVICE: 21, TL: 1, DELIVERY: 2, SHIPMENT: 2, "VIAJES PAGADOS": 23, "CONTROL RUTAS": 10 });
check("Recargar no duplica", hojas2, hojas1);
check("Columnas de control", control.fila, [9, 10, 0.9, 100000, 125000, 25000, 120000, -5000, "37956", "361"]);
check("Hoja CONTROL RUTAS", [control.hoja.FECHA, control.hoja.INGRESO, control.hoja["DIF. COBRO"], control.hoja.ESTADO], ["2026-09-08", 120000, -5000, "Pagada"]);
check("Resumen del día", control.dia, { fecha: "2026-09-08", rutas: 3, pagadas: 1, revisar: 1, pendientes: 1, total: 280000, ingreso: 123000, dif: -5000 });
check("Proforma repartida con x/y", [control.shipmentHead, control.serviceX], [["Id Proforma", "Factura", "Id Sol. Pago", "x"], true]);
check("Filtro por día", filasDia, 3);
check("Orden por patente A-Z", patAsc, [...patAsc].sort((a, b) => a.localeCompare(b, "es")));
check("Orden por patente Z-A", patDesc, [...patAsc].reverse());
check("Filtro por columna Estado", filtroEstado, ["LLLL-10", "BBBB-22"]);

console.log(fails ? `\n${fails} prueba(s) fallaron` : "\nTodas las pruebas pasaron");
process.exit(fails ? 1 : 0);
