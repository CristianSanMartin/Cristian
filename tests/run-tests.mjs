// Prueba end-to-end de apps-script/index.html con una proforma sintética.
// Uso: node tests/run-tests.mjs
import { chromium } from "playwright";
import XLSX from "xlsx";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(root, "apps-script", "index.html");
const XLSX_JS = path.join(root, "node_modules", "xlsx", "dist", "xlsx.full.min.js");

// ---------- Proforma sintética ----------
const OT_H = ["ID Sol. Pago", "Estado Sol. Pago", "ID Viaje", "Origen", "Tipo Vehículo", "Valor",
  "Patente", "Dirección", "Tipo de solicitud de pago"];
const ot = [OT_H];
const tl = (sol, estado, viaje, origen, veh, valor, dir = "Dir") =>
  ot.push([sol, estado, viaje, origen, veh, valor, "AB1234", dir, "SERVICE"]);

// Caso A: 2 viajes, pagado 110.000 -> OBJETAR 50.000
tl(24279173, "Provision_OK", "a1ca1dad", "TL - Hub XD", "C11-20", 110000, "D1");
tl(24279173, "Provision_OK", "a1ca1dad", "TL - Hub XD", "C11-20", 110000, "D2");
tl(24279173, "Provision_OK", "6778130b", "TL - Hub XD", "C11-20", 110000, "D3");
tl(24279173, "Provision_OK", "6778130b", "TL - Hub XD", "C11-20", 110000, "D4");
// Caso B: OBJECTION_APPROVED, 2 viajes, pagado 180.000 -> OK - OBJECIÓN APROBADA
tl(24245413, "OBJECTION_APPROVED", "vb1", "TL - Hub XD", "C11-20", 180000);
tl(24245413, "OBJECTION_APPROVED", "vb2", "TL - Hub XD", "C11-20", 180000);
// Caso C: C81-130, 2 viajes, pagado 350.000 -> OK
tl(3001, "Provision_OK", "vc1", "TL - CD Fby Big Ticket", "C81-130", 350000);
tl(3001, "Provision_OK", "vc2", "TL - CD Fby Big Ticket", "C81-130", 350000);
// Caso C2: C81-130, 2 viajes, pagado 175.000 -> OBJETAR 175.000
tl(3002, "Provision_OK", "vc3", "TL - CD Fby Big Ticket", "C81-130", 175000);
tl(3002, "Provision_OK", "vc4", "TL - CD Fby Big Ticket", "C81-130", 175000);
// Caso D: 1 viaje C11-20 pagado 110.000 -> OK
tl(3003, "Provision_OK", "vd1", "TL - Hub XD", "C11-20", 110000);
// Caso E: TL (Valpo) 1 viaje C01-10 pagado 45.000 -> OK (debe clasificarse como TL)
tl(3004, "Provision_OK", "ve1", "TL (Valpo)", "C01-10", 45000);
// Caso F: 3 viajes -> REVISAR MANUAL
tl(3005, "Provision_OK", "vf1", "TL - Hub XD", "C11-20", 110000);
tl(3005, "Provision_OK", "vf2", "TL - Hub XD", "C11-20", 110000);
tl(3005, "Provision_OK", "vf3", "TL - Hub XD", "C11-20", 110000);
// Caso G: TL sin tarifa -> REVISAR
tl(3006, "Provision_OK", "vg1", "TL - CD Lof1", "C11-20", 110000);
// Caso H: vehículos distintos en el mismo ID Sol. Pago -> REVISAR MANUAL
tl(3007, "Provision_OK", "vh1", "TL - Hub XD", "C11-20", 110000);
tl(3007, "Provision_OK", "vh2", "TL - Hub XD", "C21-35", 110000);
// Caso I: Tipo de solicitud = TL (no SERVICE) -> igual va a TL
ot.push([3008, "Provision_OK", "vi1", "TL - Hub XD", "C11-20", 110000, "AB1234", "Dir", "TL"]);
// DELIVERY y SERVICE normales
ot.push([5001, "Provision_OK", "dl1", "CD Lo Espejo", "C01-10", 30000, "XX1111", "Calle 1", "DELIVERY"]);
ot.push([5001, "Provision_OK", "dl1", "CD Lo Espejo", "C01-10", 30000, "XX1111", "Calle 2", "DELIVERY"]);
ot.push([6001, "Provision_OK", "sv1", "Tienda Plaza Oeste", "C11-20", 90000, "YY2222", "Calle 3", "SERVICE"]);
ot.push([6001, "Provision_OK", "sv1", "Tienda Plaza Oeste", "C11-20", 90000, "YY2222", "Calle 4", "SERVICE"]);
ot.push([6001, "Provision_OK", "sv2", "Tienda Plaza Oeste", "C11-20", 90000, "YY2222", "Calle 5", "SERVICE"]);
// Tipo desconocido -> SIN CLASIFICAR (no debe perderse)
ot.push([7001, "Provision_OK", "ux1", "CD Lo Espejo", "C01-10", 10000, "ZZ3333", "Calle 6", "OTRO"]);

const tr = [["Id Sol. Pago", "Id Viaje (Solicitud de transporte)", "Valor"],
  [8001, "t1", 40000], [8001, "t1", 40000], [8001, "t2", 40000]];

const rsp = [["Sol Pago", "Tipo Sol Pago", "Estado Sol. Pago", "Valor"],
  [24279173, "SERVICE", "Provision_OK", 110000],
  [24245413, "SERVICE", "OBJECTION_APPROVED", 180000],
  [3003, "SERVICE", "Provision_OK", 999999]]; // no cuadra con OT

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Proforma", 99999]]), "Resumen");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ot), "Ordenes de Transporte");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tr), "Viajes de Transferencia");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rsp), "Resumen Sol Pago");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "proforma-"));
const input = path.join(tmp, "proforma_test.xlsx");
XLSX.writeFile(wb, input);

// ---------- Ejecutar la app ----------
const browser = await chromium.launch();
const page = await browser.newPage({ acceptDownloads: true });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.route("**/xlsx.full.min.js", r => r.fulfill({ path: XLSX_JS, contentType: "application/javascript" }));
await page.goto("file://" + HTML);
await page.setInputFiles("#fileInput", input);
await page.waitForSelector("#actions:not(.hidden)");
await page.click("text=Procesar y revisar");
await page.waitForSelector("#resultArea:not(.hidden)");

const rev = await page.evaluate("revisionTL");
const byId = Object.fromEntries(rev.map(r => [r.idSolPago, r]));
const [download] = await Promise.all([page.waitForEvent("download"), page.click("text=Descargar Excel procesado")]);
const outPath = path.join(tmp, "out.xlsx");
await download.saveAs(outPath);
const errText = await page.textContent("#errorText");
await browser.close();

// ---------- Verificaciones ----------
let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${JSON.stringify(got)}${ok ? "" : "  (esperado " + JSON.stringify(want) + ")"}`);
};
const pick = r => r && [r.resultado, r.valorEsperado, r.valorPagado, r.montoObjetar];

check("Sin errores JS", errors.concat(errText ? [errText] : []), []);
check("Caso A", pick(byId["24279173"]), ["OBJETAR", 160000, 110000, 50000]);
check("Caso B", pick(byId["24245413"]), ["OK - OBJECIÓN APROBADA", 160000, 180000, 0]);
check("Caso B 2da reconocida", byId["24245413"]?.segundaReconocida, 70000);
check("Caso C", pick(byId["3001"]), ["OK", 350000, 350000, 0]);
check("Caso C2", pick(byId["3002"]), ["OBJETAR", 350000, 175000, 175000]);
check("Caso D", pick(byId["3003"]), ["OK", 110000, 110000, 0]);
check("Caso E Valpo", pick(byId["3004"]), ["OK", 45000, 45000, 0]);
check("Caso F 3 viajes", byId["3005"]?.resultado, "REVISAR MANUAL");
check("Caso G sin tarifa", byId["3006"]?.resultado, "REVISAR");
check("Caso H vehículos distintos", byId["3007"]?.resultado, "REVISAR MANUAL");
check("Caso I tipo TL", byId["3008"]?.resultado, "OK");
check("Resumen Sol Pago cuadra (A)", byId["24279173"]?.validacionResumen, "OK");
check("Resumen Sol Pago no cuadra (D)", byId["3003"]?.validacionResumen?.startsWith("REVISAR"), true);

const out = XLSX.readFile(outPath);
const sheet = n => XLSX.utils.sheet_to_json(out.Sheets[n], { header: 1, defval: "" });
const control = Object.fromEntries(sheet("CONTROL").map(r => [r[0], r[1]]));
check("CONTROL bruto", control["Registros Ordenes de Transporte"], 25);
check("CONTROL DELIVERY/SERVICE/TL", [control["Registros DELIVERY"], control["Registros SERVICE"], control["Registros TL"]], [2, 3, 19]);
check("CONTROL sin clasificar", control["Registros sin clasificar"], 1);
check("CONTROL diferencia", control["Diferencia vs bruto"], 0);
const T = sheet("TL"), tv = T[0].indexOf("Valor"), tx = T[0].indexOf("x");
check("x/y y Valor en 0 para repetidos (caso A)", T.slice(1, 5).map(r => [r[tx], r[tv]]), [[1, 110000], ["-", 0], ["-", 0], ["-", 0]]);
const TR = sheet("Viajes de Transferencia");
check("Transferencias x/y", TR.slice(1).map(r => r.slice(0, 5)), [[8001, 1, "t1", 1, 40000], [8001, "-", "t1", "-", 0], [8001, "-", "t2", 1, 0]]);
check("TL_A_OBJETAR filas", sheet("TL_A_OBJETAR").slice(1).map(r => r[0]).sort(), [24279173, 3002].sort());
check("Hojas", out.SheetNames, ["Resumen", "CONTROL", "DELIVERY", "TD DELIVERY", "SERVICE", "TD SERVICE", "TL", "TD TL",
  "Viajes de Transferencia", "Ordenes de Transporte", "ANALISIS SERVICE", "Resumen Sol Pago", "SIN CLASIFICAR", "TL_REVISION", "TL_A_OBJETAR"]);

console.log(fails ? `\n${fails} prueba(s) fallaron` : "\nTodas las pruebas pasaron");
process.exit(fails ? 1 : 0);
