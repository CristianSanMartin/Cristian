// Procesa una proforma bruta con la app y compara hoja por hoja contra una procesada de referencia.
// Uso: node tests/compare-reference.mjs <bruta.xlsx> <procesada_ok.xlsx>
import { chromium } from "playwright";
import XLSX from "xlsx";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [bruta, ref] = process.argv.slice(2);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmp-"));

const browser = await chromium.launch();
const page = await browser.newPage({ acceptDownloads: true });
page.on("pageerror", e => console.log("JS ERROR:", e.message));
await page.route("**/xlsx.full.min.js", r => r.fulfill({ path: path.join(root, "node_modules/xlsx/dist/xlsx.full.min.js") }));
await page.goto("file://" + path.join(root, "apps-script/index.html"));
await page.setInputFiles("#fileInput", bruta);
await page.waitForSelector("#actions:not(.hidden)", { timeout: 120000 });
await page.click("text=Procesar y revisar");
await page.waitForSelector("#resultArea:not(.hidden), #errorArea:not(.hidden)", { timeout: 120000 });
const err = await page.textContent("#errorText"); if (err) console.log("ERROR APP:", err);
const rev = await page.evaluate("revisionTL");
const [dl] = await Promise.all([page.waitForEvent("download"), page.click("text=Descargar Excel procesado")]);
const outPath = path.join(tmp, "out.xlsx"); await dl.saveAs(outPath);
await browser.close();

const read = f => XLSX.readFile(f, { cellDates: true });
const A = read(outPath), B = read(ref);
// Fechas se comparan al segundo: SheetJS a veces redondea 1 ms distinto
const norm = v => v instanceof Date ? new Date(Math.round(v.getTime() / 1000) * 1000).toISOString() : String(v ?? "").trim();
console.log("Hojas app:", A.SheetNames.join(", "));
console.log("Hojas ref:", B.SheetNames.join(", "));
for (const n of B.SheetNames) {
  if (!A.Sheets[n]) { console.log(`\n[${n}] FALTA en app`); continue; }
  const a = XLSX.utils.sheet_to_json(A.Sheets[n], { header: 1, defval: "" });
  const b = XLSX.utils.sheet_to_json(B.Sheets[n], { header: 1, defval: "" });
  let diffs = 0, typeDiffs = {}, shown = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const ra = a[i] || [], rb = b[i] || [];
    for (let j = 0; j < Math.max(ra.length, rb.length); j++) {
      if (norm(ra[j]) !== norm(rb[j])) { diffs++; if (shown++ < 5) console.log(`  [${n}] fila ${i + 1} col ${(b[0] || [])[j]}: app=${JSON.stringify(ra[j])} ref=${JSON.stringify(rb[j])}`); }
      else if (i > 0 && typeof ra[j] !== typeof rb[j] && rb[j] !== "") typeDiffs[b[0][j]] = `${typeof ra[j]} vs ${typeof rb[j]}`;
    }
  }
  // Mismo contenido sin importar el orden (el Python original ordena x/y con un sort no estable)
  const key = r => r.map(v => norm(v).replace(/\s+/g, " ")).join("\u0001");
  const bag = new Map(); b.slice(1).forEach(r => bag.set(key(r), (bag.get(key(r)) || 0) + 1));
  let sinPar = 0; a.slice(1).forEach(r => { const k = key(r); if (bag.get(k)) bag.set(k, bag.get(k) - 1); else { sinPar++; if (sinPar <= 3) console.log(`  [${n}] sin par en app: ${JSON.stringify(r).slice(0, 400)}`); } });
  if (sinPar) [...bag].filter(([, c]) => c > 0).slice(0, 3).forEach(([k]) => console.log(`  [${n}] sobra en ref: ${JSON.stringify(k.split("\u0001")).slice(0, 400)}`));
  console.log(`[${n}] filas app=${a.length} ref=${b.length} celdas distintas en misma posición=${diffs} filas sin par (ignorando orden)=${sinPar}` + (Object.keys(typeDiffs).length ? ` tipos distintos=${JSON.stringify(typeDiffs)}` : ""));
}
const cnt = {}; rev.forEach(r => cnt[r.resultado] = (cnt[r.resultado] || 0) + 1);
console.log("\nRevisión TL:", cnt);
rev.filter(r => r.resultado !== "OK").forEach(r => console.log(" ", r.idSolPago, r.origen, r.tipoVehiculo, "viajes=" + r.cantidadViajes, "pagado=" + r.valorPagado, "esperado=" + r.valorEsperado, r.resultado, "|", r.motivo, "|", r.validacionResumen));
