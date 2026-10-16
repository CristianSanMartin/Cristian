// Prueba de la pestaña Perú (Sodimac) con reportes SIMPLI sintéticos.
// Uso: node tests/peru-tests.mjs
import { chromium } from "playwright";
import XLSX from "xlsx";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(root, "apps-script", "index.html");
const XLSX_JS = path.join(root, "node_modules", "xlsx", "dist", "xlsx.full.min.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "peru-"));

// ---------- Reportes SIMPLI sintéticos (dos tramos que se solapan el 15) ----------
const H = ["ID de visita", "Fecha planificada", "Conductor", "Vehículo", "Dirección", "Estado", "Motivo:"];
const v = (id, fecha, veh, dir, estado = "completed", motivo = "") => [id, new Date(fecha + "T00:00:00"), veh.split("-")[1], veh, dir, estado, motivo];
const A = "JOINT-AAA111-13M3", B = "JOINT-BBB222- 20TN", C = "JOINT-CCC333- 10M";
const tramo1 = [H,
  // 10-09 AAA111: "JR SANTA ROSA, COMAS" es Comas (Metropolitana), no Santa Rosa
  v(1, "2026-09-10", A, "JIRON SANTA ROSA 885, COMAS"), v(2, "2026-09-10", A, "AV TUPAC AMARU 100, INDEPENDENCIA"),
  // 12-09 AAA111: único punto de periferia fallido -> Metropolitana con observación
  v(3, "2026-09-12", A, "MZ S LOTE 2 , PUENTE PIEDRA", "failed", "Distrito errado"), v(4, "2026-09-12", A, "CALLE 1, COMAS"),
  // 12-09 BBB222 (F20): un punto entregado en periferia basta
  v(5, "2026-09-12", B, "AV LIMA 1, PUNTA HERMOSA"), v(6, "2026-09-12", B, "CALLE 2, SAN BORJA"),
  // 13-09 domingo, CCC333 (10M -> F13): +30%
  v(7, "2026-09-13", C, "CALLE SEVILLA 285, MIRAFLORES"),
  // 15-09 aparece en ambos tramos
  v(8, "2026-09-15", A, "PASAJE MATERIALES 620, LIMA"),
  // Otro proveedor: no entra
  [9, new Date("2026-09-15T00:00:00"), "ZZZ999", "OTRO-ZZZ999-13M3", "CALLE 3, LINCE", "completed", ""]];
const tramo2 = [H, v(8, "2026-09-15", A, "PASAJE MATERIALES 620, LIMA"), v(10, "2026-09-15", A, "AV AREQUIPA 1, LINCE"),
  v(11, "2026-09-30", A, "CALLE X, SAN JUAN DE")];
const escribir = (aoa, n) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa, { cellDates: true }), "Sheet1"); const f = path.join(tmp, n); XLSX.writeFile(wb, f); return f; };
const f1 = escribir(tramo1, "simpli_01_15.xlsx"), f2 = escribir(tramo2, "simpli_15_30.xlsx");

const LH = ["FECHA", "RAZÓN SOCIAL", "PLACA", "TIPO UNIDAD", "PUNTOS", "DISTRITOS", "ZONA", "TARIFA REGULAR", "ADICIONAL", "DETALLE ADICIONAL ", "VALOR TOTAL"];

// ---------- Ejecutar la app ----------
const browser = await chromium.launch();
const page = await browser.newPage({ acceptDownloads: true });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.route("**/xlsx.full.min.js", r => r.fulfill({ path: XLSX_JS, contentType: "application/javascript" }));
await page.goto("file://" + HTML);
await page.click("button.tab[data-vista=peru]");
const vistaVisible = await page.isVisible("#vistaPeru");
await page.setInputFiles("#inSimpli", [f1, f2]);
await page.waitForFunction("peruDatos.rutas.length===6");
const rutas = await page.evaluate(`Object.fromEntries(peruDatos.rutas.map(r=>[r.fecha+" "+r.placa,[r.unidad,r.puntos,r.entregados,r.distrito,r.zona,r.tarifa,r.adicional,r.detalle,r.total]]))`);
const obs12 = await page.evaluate(`peruDatos.rutas.find(r=>r.fecha==="2026-09-12"&&r.placa==="AAA111").obs`);
const hoja = await page.evaluate(`almacenLocal.hojas["PERU RUTAS"].length-1`);
// Volver a cargar un tramo reemplaza sus días y no duplica
await page.setInputFiles("#inSimpli", f2);
await page.waitForTimeout(300);
const hoja2 = await page.evaluate(`[almacenLocal.hojas["PERU RUTAS"].length-1, peruDatos.rutas.length]`);
const resumen = await page.evaluate(`["pRutas","pPeriferia","pDomingo","pTotal"].map(id=>document.getElementById(id).textContent)`);
await page.selectOption("#pFiltro", "obs");
const conObs = await page.$$eval("#peruBody tr", trs => trs.map(t => [t.children[0].textContent, t.children[1].textContent]));
await page.selectOption("#pFiltro", "");
const pagos = await page.evaluate(`Object.fromEntries(rutasMesPeru().rutas.map(r=>[r.fecha+" "+r.placa,[r.pago,r.margen,r.llave]]))`);
const resumenPago = await page.evaluate(`["pPago","pMargen"].map(id=>document.getElementById(id).textContent)`);
const [dlPago] = await Promise.all([page.waitForEvent("download"), page.click("text=Descargar pago transportista")]);
const outPago = path.join(tmp, "pago_out.xlsx"); await dlPago.saveAs(outPago);
const nombrePago = dlPago.suggestedFilename();
const [dl] = await Promise.all([page.waitForEvent("download"), page.click("text=Descargar liquidación")]);
const out = path.join(tmp, "liq_out.xlsx"); await dl.saveAs(out);
const nombre = dl.suggestedFilename();
await browser.close();

const wb = XLSX.readFile(out, { cellDates: true }), ws = wb.Sheets[wb.SheetNames[0]];
const salida = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

let ok = true;
function check(nom, real, esperado) {
  const pasa = JSON.stringify(real) === JSON.stringify(esperado);
  ok = ok && pasa;
  console.log(`${pasa ? "OK  " : "FALLA"} ${nom}: ${JSON.stringify(real)}${pasa ? "" : "\n      esperado: " + JSON.stringify(esperado)}`);
}
check("Pestaña visible", vistaVisible, true);
check("Calle Santa Rosa en Comas es Metropolitana", rutas["2026-09-10 AAA111"], ["F13", 2, 2, "COMAS", "Metropolitana", 420, null, "", 420]);
check("Punto de periferia fallido no sube la ruta", rutas["2026-09-12 AAA111"], ["F13", 2, 1, "COMAS", "Metropolitana", 420, null, "", 420]);
check("Observación del punto fallido", obs12, "Punto en PUENTE PIEDRA no entregado (Distrito errado): se cobra Metropolitana");
check("Un punto entregado en periferia basta (F20)", rutas["2026-09-12 BBB222"], ["F20", 2, 2, "PUNTA HERMOSA", "Periferia", 640, null, "", 640]);
check("Domingo +30% y 10M como F13", rutas["2026-09-13 CCC333"], ["F13", 1, 1, "MIRAFLORES", "Metropolitana", 420, 126, "Tarifa Domingo", 546]);
check("Día repetido entre tramos se cuenta una vez; LIMA = Cercado; otro proveedor fuera", rutas["2026-09-15 AAA111"], ["F13", 2, 2, "CERCADO DE LIMA", "Metropolitana", 420, null, "", 420]);
check("SIMPLI corta 'SAN JUAN DE'", rutas["2026-09-30 AAA111"].slice(3, 6), ["SAN JUAN DE LURIGANCHO", "Metropolitana", 420]);
check("Guardado en PERU RUTAS y recarga sin duplicar", [hoja, hoja2], [6, [6, 6]]);
check("Resumen", resumen, ["6", "1", "1", "S/ 2,866"]);
check("Filtro con observación", conObs, [["12-09-2026", "AAA111"]]);
check("Nombre de la liquidación", nombre, "Liquidacion JOINT PERU S.A.C. UM SODIMAC - 09SEPTIEMBRE - 2026.xlsx");
check("Formato de la liquidación", [wb.SheetNames[0], salida[0], salida[2].slice(1, 9), salida.length, ws["K2"].f, ws["K8"].f],
  ["LIQUIDACIÓN SERVICIOS", LH, ["JOINT PERU S.A.C.", "AAA111", "F13", 2, "COMAS", "Metropolitana", 420, ""], 8, "SUM(H2:I2)", "SUM(K2:K7)"]);
check("Pago transportista regular urbano", pagos["2026-09-10 AAA111"], [380, 40, "CT ATLANTIS SODIMAC;RUTA REGULAR;13m3;URBANO"]);
check("Pago transportista F20 periferia", pagos["2026-09-12 BBB222"], [540, 100, "CT ATLANTIS SODIMAC;RUTA REGULAR;20m3;PERIFERIA/LEJANO"]);
check("Pago transportista domingo", pagos["2026-09-13 CCC333"], [494, 52, "CT ATLANTIS SODIMAC;RUTA DOMINGO;13m3;URBANO"]);
check("Resumen pago y margen", resumenPago, ["S/ 2,554", "S/ 312 (11%)"]);
const wbP = XLSX.readFile(outPago, { cellDates: true }), wsP = wbP.Sheets[wbP.SheetNames[0]];
const salidaP = XLSX.utils.sheet_to_json(wsP, { header: 1, defval: "" });
check("Excel pago transportista", [nombrePago, wbP.SheetNames[0], salidaP[0].length, salidaP[1].slice(1, 4), salidaP[1][9], salidaP.length, wsP["J8"].f],
  ["Pago transportista CT ATLANTIS SODIMAC - SEPTIEMBRE 2026.xlsx", "PAGO TRANSPORTE", 10, ["CT ATLANTIS SODIMAC", "AAA111", "F13"], 380, 8, "SUM(J2:J7)"]);
check("Sin errores JS", errors, []);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(ok ? "\nTodas las pruebas pasaron" : "\nHay pruebas con fallas");
process.exit(ok ? 0 : 1);
