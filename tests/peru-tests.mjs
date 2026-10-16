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
const [dl] = await Promise.all([page.waitForEvent("download"), page.click("text=Descargar liquidación")]);
const out = path.join(tmp, "liq_out.xlsx"); await dl.saveAs(out);
const nombre = dl.suggestedFilename();

// ---------- Pago transporte por quincena ----------
await page.click("button.tab[data-vista=peruPago]");
const vistaPago = await page.isVisible("#vistaPeruPago");
const quincenas = await page.$$eval("#qSel option", os => os.map(o => o.textContent));
await page.selectOption("#qSel", "2026-09-Q1");
const resumenQ = () => page.evaluate(`["qRutas","qNeto","qIgv","qDesc","qTotal","qOtros"].map(id=>document.getElementById(id).textContent)`);
const resumenQ1 = await resumenQ();
await page.selectOption("#qFiltro", "fal");
const conFallidos = await page.$$eval("#qBody tr", trs => trs.map(t => [t.children[0].textContent, t.children[1].textContent, t.children[5].textContent]));
await page.selectOption("#qFiltro", "");
await page.fill('#qConductores input[data-p=AAA111][data-k=nombre]', "JUAN PEREZ");
await page.fill('#qConductores input[data-p=AAA111][data-k=doc]', "DNI 123");
await page.click("text=Guardar conductores"); await page.waitForTimeout(200);
const hojaCond = await page.evaluate(`almacenLocal.hojas["PERU CONDUCTORES"]`);
await page.fill("#dConcepto", "Pagos en exceso periodos anteriores"); await page.fill("#dMonto", "100");
await page.click("#vistaPeruPago >> text=Agregar >> nth=0"); await page.waitForTimeout(200);
await page.fill("#opConcepto", "Personal de seguimiento"); await page.fill("#opBenef", "MARIA X"); await page.fill("#opDoc", "DNI 9"); await page.fill("#opMonto", "1000");
await page.click("#vistaPeruPago >> text=Agregar >> nth=1"); await page.waitForTimeout(200);
const hojaMov = await page.evaluate(`almacenLocal.hojas["PERU MOVIMIENTOS"].length-1`);
// Ajuste: 12-09 AAA111 se cobró y pagó como Periferia
await page.click('#qBody button[data-k="2026-09-12|AAA111"]');
await page.selectOption("#ajCobro", "PERIFERIA/LEJANO"); await page.selectOption("#ajPago", "PERIFERIA/LEJANO"); await page.fill("#ajMotivo", "Validado por Sodimac");
await page.click("text=Guardar ajuste"); await page.waitForTimeout(200);
const ajustada = await page.evaluate(`(r=>[r.zonaCobro,r.total,r.pago,r.totalCalc,r.pagoCalc,r.obsTarifa,r.llave])(peruDatos.rutas.find(r=>r.fecha==="2026-09-12"&&r.placa==="AAA111"))`);
const hojaAj = await page.evaluate(`almacenLocal.hojas["PERU AJUSTES"]`);
const resumenQ1b = await resumenQ();
await page.selectOption("#qEstado", "Enviado al transporte"); await page.waitForTimeout(200);
const hojaQuin = await page.evaluate(`almacenLocal.hojas["PERU QUINCENAS"].slice(1).map(r=>r.slice(0,2))`);
const correo = await page.inputValue("#qCorreo");
const [dlQ] = await Promise.all([page.waitForEvent("download"), page.click("text=Descargar detalle quincena")]);
const outQ = path.join(tmp, "q_out.xlsx"); await dlQ.saveAs(outQ);
const nombreQ = dlQ.suggestedFilename();
// Recargar desde las hojas conserva ajustes, descuentos, conductores y estado
await page.evaluate("recargarPeru()"); await page.waitForTimeout(200);
const trasRecargarPago = [await resumenQ(), await page.inputValue("#qEstado"), await page.evaluate(`peruDatos.rutas.find(r=>r.fecha==="2026-09-12"&&r.placa==="AAA111").pago`)];

// ---------- Cuadre y KPI ----------
await page.click("button.tab[data-vista=peruCuadre]");
const vistaCuadre = await page.isVisible("#vistaPeruCuadre");
const cuadreSin = await page.evaluate(`(d=>[d.calc,d.liq,d.ajustes.length,d.difCobro,d.cobrado,d.pago,d.desc,d.otros,d.costo,d.margen])(mesCuadrePe("2026-09"))`);
await page.fill("#fcNumero", "F001-10"); await page.fill("#fcFecha", "2026-10-05"); await page.fill("#fcMonto", "3056");
await page.click("#cCuadreCobro >> text=Guardar factura"); await page.waitForTimeout(200);
const cuadreCobro = await page.$$eval("#cCuadreCobro tr", trs => trs.map(t => [...t.children].map(c => c.textContent.trim())));
const pendiente = await page.evaluate(`[document.getElementById("cPendiente").textContent,document.getElementById("cPendienteDet").textContent]`);
await page.fill("#fpQ1Numero", "E001-5"); await page.fill("#fpQ1Monto", "2606.92"); await page.fill("#fpQ1Pago", "2026-09-25");
await page.click("#cCuadrePago >> text=Guardar factura >> nth=0"); await page.waitForTimeout(200);
await page.fill("#fcPago", "2026-10-20"); await page.click("#cCuadreCobro >> text=Guardar factura"); await page.waitForTimeout(200);
const trasFacturas = await page.evaluate(`(d=>[d.difCobro,d.qs[0].dif,d.qs[0].dias,d.cobrado,Math.round(d.margen*100)/100,document.getElementById("cPendiente").textContent,almacenLocal.hojas["PERU FACTURAS"].length-1])(mesCuadrePe("2026-09"))`);
const kpi = await page.evaluate(`(k=>[k.rutas,k.placas,Math.round(k.perif*1000)/10,Math.round(k.dom*1000)/10,Math.round(k.entrega*1000)/10,k.diasPago])(mesCuadrePe("2026-09").kpi)`);
const cajasKpi = await page.$$eval("#cKpi .summary-title", e => e.map(x => x.textContent));
const tendencia = await page.$$eval("#cTendencia tbody tr", trs => trs.map(t => t.children[0].textContent));
const hojaFijos = await page.evaluate(`almacenLocal.hojas["PERU COSTOS FIJOS"]`);
// Pesos chilenos: tipo de cambio de la hoja PERU TIPO CAMBIO, al tipo de cambio de hoy (último), solo en resúmenes
const sinTc = await page.evaluate(`document.getElementById("cCobrado").parentNode.querySelector(".clp").textContent`);
await page.evaluate(`almacenLocal.hojas["PERU TIPO CAMBIO"]=[["FECHA","CLP POR SOL"],["2026-09-01",250],["2026-09-15",260],["2026-10-01",270]]; cargarTipoCambioPe()`);
await page.waitForTimeout(200);
const clp = await page.evaluate(`[document.getElementById("cCobrado").parentNode.querySelector(".clp").textContent, document.getElementById("cTc").textContent,
  [...document.querySelectorAll("#cKpi .clp")].length, document.querySelector("#cTendencia tbody tr").children[8].textContent,
  tcPeriodoPe().tc]`);
await page.click("button.tab[data-vista=peruPago]"); await page.selectOption("#qSel", "2026-09-Q1");
const clpPago = await page.evaluate(`[document.getElementById("qTotal").parentNode.querySelector(".clp").textContent, document.querySelectorAll("#qBody .clp").length]`);
await page.click("button.tab[data-vista=peruCuadre]");

// ---------- Tarifas (vigencias, feriados, distritos) ----------
page.on("dialog", d => d.accept());
const ruta = (f, p) => page.evaluate(`(r=>r&&[r.tarifa,r.adicional,r.detalle,r.total,r.pago])(peruDatos.rutas.find(r=>r.fecha==="${f}"&&r.placa==="${p}"))`);
const hojasConfig = await page.evaluate(`["PERU TARIFAS","PERU DISTRITOS","PERU FERIADOS"].map(h=>(almacenLocal.hojas[h]||[]).length-1)`);
const encTarifas = await page.evaluate(`almacenLocal.hojas["PERU TARIFAS"][0]`);
await page.click("button.tab[data-vista=peruTarifas]");
const vistaTarifas = await page.isVisible("#vistaPeruTarifas");
const tablaCobro = await page.$$eval("#peTar_COBRO tbody tr", trs => trs.map(t => [...t.children].map(c => c.textContent.trim())));
// Nueva vigencia del cobro desde el 13-09-2026: F13 Metropolitana 450 / 585
await page.click("#peTar_COBRO >> text=Nueva vigencia");
await page.fill("#peDesde_COBRO", "2026-09-13");
await page.fill('#peTar_COBRO .in-tarifa[data-u=F13][data-c=URBANO][data-k=regular]', "450");
await page.fill('#peTar_COBRO .in-tarifa[data-u=F13][data-c=URBANO][data-k=domingo]', "585");
await page.click("#peTar_COBRO >> text=Guardar vigencia");
await page.waitForFunction(`vigenciasPe("COBRO").length===2`);
await page.waitForTimeout(200);
const conVigencia = [await ruta("2026-09-10", "AAA111"), await ruta("2026-09-13", "CCC333"), await ruta("2026-09-15", "AAA111")];
const filasTar = await page.evaluate(`almacenLocal.hojas["PERU TARIFAS"].length-1`);
const opcionesVig = await page.$$eval("#peVig_COBRO option", os => os.map(o => o.textContent));
// Se lee de la hoja al recargar
await page.evaluate("recargarPeru()"); await page.waitForTimeout(200);
const trasRecargar = [await page.evaluate(`tarifasPe.length`), await ruta("2026-09-15", "AAA111")];
await page.click("#peTar_COBRO >> text=Eliminar esta vigencia");
await page.waitForFunction(`vigenciasPe("COBRO").length===1`); await page.waitForTimeout(200);
const sinVigencia = await ruta("2026-09-15", "AAA111");
const sinTarifa = await page.evaluate(`(r=>[r.tarifa,r.pago,r.obsTarifa])(tarificarPeru({fecha:"2024-12-31",unidad:"F13",zona:"Metropolitana",obs:""}))`);
// Feriado nuevo: cobro con adicional "Tarifa Feriado" y pago con tarifa de domingo
await page.fill("#peNuevoFer", "2026-09-10"); await page.fill("#peNombreFer", "Prueba");
await page.click("#vistaPeruTarifas >> text=Agregar >> nth=1");
await page.waitForFunction(`FERIADOS_PE.has("2026-09-10")`); await page.waitForTimeout(200);
const conFeriado = await ruta("2026-09-10", "AAA111");
const feriadoEnHoja = await page.evaluate(`almacenLocal.hojas["PERU FERIADOS"].some(r=>String(r[0]).startsWith("2026-09-10")&&r[1]==="Prueba")`);
const feriados2025 = await page.$$eval("#peAnioFer option", os => os.map(o => o.value));
await page.evaluate(`quitarFeriadoPe("2026-09-10")`); await page.waitForTimeout(200);
const sinFeriado = await ruta("2026-09-10", "AAA111");
// Distrito: COMAS a Periferia se aplica al volver a cargar SIMPLI
await page.fill("#peBuscarDist", "COMAS");
await page.selectOption("#peDistritos select", "PERIFERIA/LEJANO"); await page.waitForTimeout(200);
const comasHoja = await page.evaluate(`almacenLocal.hojas["PERU DISTRITOS"].find(r=>r[0]==="COMAS")[1]`);
const antesRecarga = await page.evaluate(`peruDatos.rutas.find(r=>r.fecha==="2026-09-10"&&r.placa==="AAA111").zona`);
await page.setInputFiles("#inSimpli", [f1, f2]);
await page.waitForFunction(`peruDatos.rutas.find(r=>r.fecha==="2026-09-10"&&r.placa==="AAA111").zona==="Periferia"`);
const trasRecargaSimpli = await ruta("2026-09-10", "AAA111");
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
check("Pago transportista regular urbano", pagos["2026-09-10 AAA111"], [380, 40, "CT ATLANTIS SODIMAC;RUTA REGULAR;13M3;URBANO"]);
check("Pago transportista F20 periferia", pagos["2026-09-12 BBB222"], [540, 100, "CT ATLANTIS SODIMAC;RUTA REGULAR;20M3;PERIFERIA/LEJANO"]);
check("Pago transportista domingo", pagos["2026-09-13 CCC333"], [494, 52, "CT ATLANTIS SODIMAC;RUTA DOMINGO;13M3;URBANO"]);
check("Resumen pago y margen", resumenPago, ["S/ 2,554", "S/ 312 (11%)"]);
check("Vista pago transporte y quincenas", [vistaPago, quincenas], [true, ["2ª quincena septiembre 2026 (16 al 30)", "1ª quincena septiembre 2026 (01 al 15)"]]);
check("Resumen 1ª quincena", resumenQ1, ["5", "S/ 2,174.00", "S/ 2,565.32", "S/ 0.00", "S/ 2,565.32", "S/ 847.46"]);
check("Rutas con puntos fallidos", conFallidos, [["12-09-2026", "AAA111", "1"]]);
check("Conductor guardado", hojaCond, [["PLACA", "CONDUCTOR", "DOCUMENTO"], ["AAA111", "JUAN PEREZ", "DNI 123"]]);
check("Descuento y otro pago guardados", hojaMov, 2);
check("Ajuste cambia cobro y pago y guarda lo calculado", ajustada, ["Periferia", 610, 500, 420, 380,
  "Punto en PUENTE PIEDRA no entregado (Distrito errado): se cobra Metropolitana; Ajuste: cobrada como Periferia y pagada como Periferia (Validado por Sodimac)".split("; ").slice(1).join("; "),
  "CT ATLANTIS SODIMAC;RUTA REGULAR;13M3;PERIFERIA/LEJANO"]);
check("Hoja PERU AJUSTES", hojaAj, [["FECHA", "PLACA", "ZONA COBRO", "ZONA PAGO", "MOTIVO"], ["2026-09-12", "AAA111", "Periferia", "Periferia", "Validado por Sodimac"]]);
check("Resumen con ajuste, descuento y otros pagos", resumenQ1b, ["5", "S/ 2,294.00", "S/ 2,706.92", "S/ 100.00", "S/ 2,606.92", "S/ 1,000.00"]);
check("Estado de la quincena", hojaQuin, [["2026-09-Q1", "Enviado al transporte"]]);
check("Correo", [correo.includes("entre los días 01 al 15 de Septiembre del año 2026"), correo.includes("PAGOS EN EXCESO PERIODOS ANTERIORES    S/. 100,00"),
  correo.includes("TOTAL DESC. S/. 100,00"), correo.includes("asciende a: S/. 2.606,92 IGV incluido"), correo.includes("S/. 1.180,00 MARIA X DNI 9"), correo.includes("1ª Q SEP 26")],
  [true, true, true, true, true, true]);
const wbQ = XLSX.readFile(outQ), wsQ = wbQ.Sheets[wbQ.SheetNames[0]];
const salidaQ = XLSX.utils.sheet_to_json(wsQ, { header: 1, defval: "" });
check("Excel detalle quincena", [nombreQ, salidaQ[0], salidaQ[1], wsQ["L7"].f, wsQ["M9"].v, wsQ["K10"].v, wsQ["M10"].v],
  ["1Q SEP 2026.xlsx", ["Fecha", "CtOrigen", "Motivo", "Patente", "Distrito", "Capacidad", "PUNTOS", "Tipo", "Usuario", "NoDocumentoUsuario", "Tarifario", "Neto", "IGVInc"],
   ["jueves, 10 de septiembre de 2026", "CT ATLANTIS SODIMAC", "RUTA REGULAR", "AAA111", "COMAS", "13M3", 2, "URBANO", "JUAN PEREZ", "DNI 123", "CT ATLANTIS SODIMAC;RUTA REGULAR;13M3;URBANO", 380, 448.4],
   "SUM(L2:L6)", -100, "Total a facturar", 2606.92]);
check("Pago se lee desde las hojas", trasRecargarPago, [["5", "S/ 2,294.00", "S/ 2,706.92", "S/ 100.00", "S/ 2,606.92", "S/ 1,000.00"], "Enviado al transporte", 500]);
check("Vista cuadre", vistaCuadre, true);
// Sep: 6 rutas; 12-09 AAA111 ajustada a Periferia (+190 cobro, +120 pago). Q1: 5 rutas pago 2294, desc 100 con IGV, otro pago 1000 (reemplaza el fijo). Q2: 1 ruta 380, fijo 847,46.
check("Cuadre sin facturas", cuadreSin, [2866, 3056, 1, null, 3056, 2674, 84.75, 1847.46, 4436.71, -1380.71]);
check("Cuadre del cobro con factura", cuadreCobro, [["Calculado por la web", "S/ 2,866.00"], ["Ajuste 12-09-2026 AAA111: Validado por Sodimac", "S/ 190.00"], ["Liquidado", "S/ 3,056.00"],
  ["Facturado a Sodimac", "S/ 3,056.00"], ["Diferencia sin explicar", "Cuadra"]]);
check("Pendiente de cobro", pendiente, ["S/ 3,056.00", "Septiembre 2026 (F F001-10)"]);
check("Facturas del transporte, días a pago y cobro pagado", trasFacturas, [0, 0, 10, 3056, -1380.71, "S/ 0.00", 2]);
check("KPI del mes", kpi, [6, { AAA111: 4, BBB222: 1, CCC333: 1 }, 33.3, 16.7, 90, 10]);
check("Cajas KPI", cajasKpi, ["Rutas", "% periferia", "% domingo o feriado", "Puntos por ruta", "% entrega efectiva", "Ingreso por ruta", "Costo por ruta", "Margen por ruta", "Margen %", "Días cierre a pago"]);
check("Tendencia", tendencia, ["Septiembre 2026"]);
check("Costo fijo de seguimiento", hojaFijos, [["CONCEPTO", "BENEFICIARIO", "DOCUMENTO", "VIGENTE DESDE", "MONTO NETO"], ["Personal de seguimiento", "", "", "2025-01-01", 847.46]]);
check("Sin tipo de cambio no muestra pesos", sinTc, "");
check("Pesos chilenos en el cuadre (tipo de cambio de hoy: 270)", clp,
  ["≈ $ 825.120 CLP", "Pesos chilenos al tipo de cambio de hoy: 1 S/ = $ 270,00 (Google Finance, 01-10-2026).", 3, "-$ 372.792", 270]);
check("Pesos chilenos en el resumen de la quincena (hoy: 270) y no en la tabla", clpPago, ["≈ $ 703.868 CLP", 0]);
check("Hojas de tarifas, distritos y feriados creadas al abrir", hojasConfig, [8, 55, 32]);
check("Encabezado PERU TARIFAS", encTarifas, ["TARIFARIO", "TIPO", "VIGENTE DESDE", "UNIDAD", "ZONA", "REGULAR", "DOMINGO"]);
check("Vista Tarifas", [vistaTarifas, tablaCobro[0], tablaCobro[3]], [true, ["F13", "Metropolitana", "S/ 420", "S/ 546 +30%"], ["F20", "Periferia", "S/ 640", "S/ 832 +30%"]]);
check("Nueva vigencia solo cambia desde su fecha", conVigencia, [[420, null, "", 420, 380], [450, 135, "Tarifa Domingo", 585, 494], [450, null, "", 450, 380]]);
check("Vigencia guardada con historial", [filasTar, opcionesVig], [12, ["Desde 13-09-2026 (vigente)", "Desde 01-01-2025"]]);
check("Tarifas leídas desde la hoja", trasRecargar, [12, [450, null, "", 450, 380]]);
check("Eliminar vigencia vuelve a la anterior", sinVigencia, [420, null, "", 420, 380]);
check("Fecha sin tarifa vigente", sinTarifa, [null, null, "Sin tarifa de cobro ni de pago vigente al 31-12-2024"]);
check("Feriado nuevo", [conFeriado, feriadoEnHoja, feriados2025], [[420, 126, "Tarifa Feriado", 546, 494], true, ["2026", "2025"]]);
check("Quitar feriado", sinFeriado, [420, null, "", 420, 380]);
check("Distrito cambia de zona al recargar SIMPLI", [comasHoja, antesRecarga, trasRecargaSimpli], ["Periferia", "Metropolitana", [610, null, "", 610, 500]]);
check("Sin errores JS", errors, []);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(ok ? "\nTodas las pruebas pasaron" : "\nHay pruebas con fallas");
process.exit(ok ? 0 : 1);
