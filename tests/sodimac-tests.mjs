// Prueba de Sodimac Chile (revisión de proforma del TMS) con una proforma sintética.
// Uso: node tests/sodimac-tests.mjs [proforma.xlsx real opcional, solo imprime el resumen]
import { chromium } from "playwright";
import XLSX from "xlsx";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(root, "apps-script", "index.html");
const XLSX_JS = path.join(root, "node_modules", "xlsx", "dist", "xlsx.full.min.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sodimac-"));

// ---------- Proforma sintética con las columnas del TMS ----------
const H = ["Transportista", "ID Proforma", "Factura", "ID Sol. Pago", "Estado Sol. Pago", "Tipo de solicitud de pago", "Valor", "ID Viaje",
  "Fecha Creación Viaje", "Referencia Transport Order", "Tipo de Servicio", "Origen", "Destino", "Dirección", "Tamaño Consolidado", "Tamaño TO",
  "Fecha de entrega", "Volumen (m3)", "Patente", "Tipo Vehículo"];
const f = (sol, tipo, valor, viaje, fecha, destino, dir, pat, veh, factura = "") =>
  ["Transportes Joint", "40001", factura, String(sol), "Provision_OK", tipo, String(valor), viaje, new Date(fecha + "T18:00:00"), "1;1;1", "REGULAR",
    "Bod La Farfana 1", destino, dir, "UNICO", "UNICO", new Date(fecha + "T00:00:00"), "0.0001", pat, veh];
const ot = [H,
  // DELIVERY urbano OK, con 2 productos en la misma SP (el valor se repite en la bruta)
  f(1, "DELIVERY", 4800, "v1", "2026-10-01", "LAS CONDES", "A 1, LAS CONDES, SANTIAGO", "ZP7469", "F5"),
  f(1, "DELIVERY", 4800, "v1", "2026-10-01", "LAS CONDES", "A 1, LAS CONDES, SANTIAGO", "ZP7469", "F5"),
  // DELIVERY periferia pagado como urbano -> BAJO TARIFA (sin factura: se incluye)
  f(2, "DELIVERY", 4800, "v2", "2026-10-01", "MELIPILLA", "B 2, MELIPILLA, MELIPILLA", "ZP7469", "F5"),
  // Destino vacío: comuna desde la dirección (Pudahuel urbano)
  f(3, "DELIVERY", 4800, "v3", "2026-10-02", "", "C 3, PUDAHUEL, SANTIAGO, Chile", "ZP7469", "F5"),
  // Comuna sin zona -> SIN TARIFA
  f(4, "DELIVERY", 5800, "v4", "2026-10-02", "SAN PEDRO", "D 4, SAN PEDRO, MELIPILLA", "ZP7469", "F5"),
  // SERVICE P5 OK con 2 puntos, mismo día que DELIVERY de ZP7469? no: otra patente
  f(5, "SERVICE", 142000, "s5", "2026-10-01", "MAIPU", "E 5, MAIPU, SANTIAGO", "TA5271", "P5"),
  f(5, "SERVICE", 142000, "s5", "2026-10-01", "NUNOA", "F 6, NUNOA, SANTIAGO", "TA5271", "P5"),
  // SERVICE P10 sobre tarifa
  f(6, "SERVICE", 210000, "s6", "2026-10-01", "TILTIL", "G 7, TILTIL, CHACABUCO", "DPKL50", "P10"),
  // SERVICE F5 de ZP7469 el mismo día que sus DELIVERY -> modalidad mixta; pagado bajo tarifa pero ya facturado
  f(7, "SERVICE", 90000, "s7", "2026-10-01", "COLINA", "H 8, COLINA, CHACABUCO", "ZP7469", "F5", "999"),
];
const wbIn = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wbIn, XLSX.utils.aoa_to_sheet([["Cantidad Solicitudes de pago", "Tipo", "Total"], [], [null, "Valor Neto", 462200]]), "Resumen");
XLSX.utils.book_append_sheet(wbIn, XLSX.utils.aoa_to_sheet(ot, { cellDates: true }), "Ordenes de Transporte");
XLSX.utils.book_append_sheet(wbIn, XLSX.utils.aoa_to_sheet([["Id Proforma", "Factura", "Id Sol. Pago", "Valor", "Id Viaje (Solicitud de transporte)"]]), "Viajes de Transferencia");
XLSX.utils.book_append_sheet(wbIn, XLSX.utils.aoa_to_sheet([["Sol Pago", "Tipo Sol Pago"]]), "Resumen Sol Pago");
const archivo = path.join(tmp, "proforma_sodimac.xlsx");
XLSX.writeFile(wbIn, archivo);

// ---------- Ejecutar la app ----------
const browser = await chromium.launch();
const page = await browser.newPage({ acceptDownloads: true });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.route("**/xlsx.full.min.js", r => r.fulfill({ path: XLSX_JS, contentType: "application/javascript" }));
await page.goto("file://" + HTML);

const real = process.argv[2];
if (real) {
  await page.evaluate(`mostrarVista("sodimacCl")`);
  await page.setInputFiles("#scFile", real);
  await page.waitForFunction("scDatos.control");
  console.log(await page.evaluate(`({control:scDatos.control,
    estados:scDatos.revision.reduce((a,r)=>(a[r.estado]=(a[r.estado]||0)+1,a),{}),
    noOk:scDatos.revision.filter(r=>r.estado!=="OK").map(r=>[r.sol,r.tipo,r.fecha,r.patente,r.veh,r.comuna,r.tarifa,r.pagado,r.estado]),
    mixtas:scDatos.mixtas.map(x=>[x.fecha,x.patente,x.DELIVERY.length,x.SERVICE.map(r=>r.sol)])})`));
  await browser.close(); process.exit(errors.length ? 1 : 0);
}

const results = [];
const check = (name, ok, got, exp) => results.push({ name, ok, got, exp });

await page.click("[aria-controls=navSodimacCl]");
await page.click("button.tab[data-vista=sodimacCl]");
check("Vista visible", await page.isVisible("#vistaSodimacCl"), true, true);
const hojasIni = await page.evaluate(`[almacenLocal.hojas["SODIMAC CL TARIFAS"].length-1, almacenLocal.hojas["SODIMAC CL COMUNAS"][0]]`);
check("Hojas de tarifas creadas", JSON.stringify(hojasIni) === JSON.stringify([5, ["COMUNA", "ZONA"]]), hojasIni, [5, ["COMUNA", "ZONA"]]);

await page.setInputFiles("#scFile", archivo);
await page.waitForFunction("scDatos.control");
const est = await page.evaluate(`Object.fromEntries(scDatos.revision.map(r=>[r.sol,[r.tipo,r.comuna,r.tarifa,r.pagado,r.estado]]))`);
const exp = {
  1: ["DELIVERY", "LAS CONDES", 4800, 4800, "OK"], 2: ["DELIVERY", "MELIPILLA", 5800, 4800, "BAJO TARIFA"],
  3: ["DELIVERY", "PUDAHUEL", 4800, 4800, "OK"], 4: ["DELIVERY", "SAN PEDRO", null, 5800, "SIN TARIFA"],
  5: ["SERVICE", "MAIPU, NUNOA", 142000, 142000, "OK"], 6: ["SERVICE", "TILTIL", 200000, 210000, "SOBRE TARIFA"],
  7: ["SERVICE", "COLINA", 96000, 90000, "BAJO TARIFA"]
};
check("Estado por SP", JSON.stringify(est) === JSON.stringify(exp), est, exp);
const ctl = await page.evaluate(`[scDatos.control.raw,scDatos.control.spD,scDatos.control.spS,scDatos.control.neto,scDatos.control.resumen]`);
check("Control (bruto, SP, neto vs Resumen)", JSON.stringify(ctl) === JSON.stringify([9, 4, 3, 462200, 462200]), ctl, [9, 4, 3, 462200, 462200]);
const mix = await page.evaluate(`scDatos.mixtas.map(x=>[x.fecha,x.patente,x.DELIVERY.length,x.SERVICE.length])`);
check("Modalidad mixta", JSON.stringify(mix) === JSON.stringify([["2026-10-01", "ZP7469", 2, 1]]), mix, [["2026-10-01", "ZP7469", 2, 1]]);
const obj = await page.evaluate(`scDatos.objeciones.map(o=>[o.sol,o.corresponde,o.incluir,!!o.aviso])`);
check("Objeciones bajo tarifa (facturada no se incluye)", JSON.stringify(obj) === JSON.stringify([["2", 5800, true, false], ["7", 96000, false, true]]), obj, null);
const filas = await page.$$eval("#scBody tr", t => t.length);
check("Tabla de revisión", filas === 7, filas, 7);
await page.selectOption("#scEstado", "BAJO TARIFA");
const filtradas = await page.$$eval("#scBody tr", t => t.map(r => r.children[0].textContent));
check("Filtro por estado", JSON.stringify(filtradas) === JSON.stringify(["2", "7"]), filtradas, ["2", "7"]);

// Template TMS: solo la SP incluida, con el total que corresponde
const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#vistaSodimacCl >> text=Descargar Template TMS")]);
const tms = XLSX.utils.sheet_to_json(XLSX.readFile(await dl.path()).Sheets["Hoja 1"], { header: 1 });
check("Template TMS", JSON.stringify(tms) === JSON.stringify([["Id Solicitud Pago", "Motivo Objeción", "Valor a Objetar", "Comentario Objeción"], [2, "Tarifa distinta a valor negociado", 5800, "F5"]]), tms, null);

// Excel procesado: hojas en el orden de la procesada, x/y y Valor solo en x=1
const [dl2] = await Promise.all([page.waitForEvent("download"), page.click("#vistaSodimacCl >> text=Descargar Excel procesado")]);
const wbOut = XLSX.readFile(await dl2.path());
check("Hojas del procesado", JSON.stringify(wbOut.SheetNames) === JSON.stringify(["Resumen", "SERVICE", "DELIVERY", "Resumen Sol Pago", "REVISION TARIFAS", "MODALIDAD MIXTA"]), wbOut.SheetNames, null);
const del = XLSX.utils.sheet_to_json(wbOut.Sheets.DELIVERY, { header: 1 });
const cx = del[0].indexOf("x"), cv = del[0].indexOf("Valor");
check("DELIVERY con x y valor sin repetir", del.slice(1).reduce((a, r) => a + Number(r[cv]), 0) === 4800 * 3 + 5800 && cx === 4, [cx, del.slice(1).map(r => r[cv])], null);

// Nueva tarifa P10 210.000 desde el 01-10: la SP 6 pasa a OK
await page.evaluate(`mostrarVista("sodimacClTarifas")`);
await page.selectOption("#scNTipo", "SERVICE");
await page.fill("#scNClave", "p10"); await page.fill("#scNDesde", "2026-10-01"); await page.fill("#scNValor", "210000");
await page.click("#vistaSodimacClTarifas >> text=Agregar");
await page.waitForTimeout(200);
const s6 = await page.evaluate(`scDatos.revision.find(r=>r.sol==="6").estado`);
check("Nueva vigencia recalcula", s6 === "OK", s6, "OK");
// Asignar zona a una comuna nueva
await page.fill("#scNuevaCom", "San Pedro"); await page.selectOption("#scNuevaZona", "PERIFERIA");
await page.click("#vistaSodimacClTarifas .card:nth-child(2) >> text=Agregar");
await page.waitForTimeout(200);
const s4 = await page.evaluate(`[scDatos.revision.find(r=>r.sol==="4").estado, almacenLocal.hojas["SODIMAC CL COMUNAS"].some(r=>r[0]==="SAN PEDRO"&&r[1]==="PERIFERIA")]`);
check("Comuna nueva", JSON.stringify(s4) === JSON.stringify(["OK", true]), s4, ["OK", true]);
check("Sin errores de página", errors.length === 0, errors, []);

await browser.close();
let fallas = 0;
for (const r of results) { if (!r.ok) fallas++; console.log(`${r.ok ? "OK  " : "FAIL"} ${r.name}: ${JSON.stringify(r.got)}${r.ok ? "" : `  (esperado ${JSON.stringify(r.exp)})`}`); }
if (fallas) { console.log(`\n${fallas} prueba(s) fallaron`); process.exit(1); }
console.log("\nTodas las pruebas de Sodimac Chile pasaron");
