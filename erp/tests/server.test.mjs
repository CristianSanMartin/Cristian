// Pruebas de la lógica del servidor sobre el simulador de Apps Script.
// Uso: npm run test:erp
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "./helpers.mjs";

const errorDe = (res) => { assert.equal(res.ok, false, "se esperaba un error"); return res.error; };
const asmodee = (s) => s.ok("bootstrap").data.proveedores.find(p => p.nombre === "Asmodee");

function producto(s, datos = {}) {
  return s.ok("guardarProducto", { nombre: "Binder Collection", edicion: "30th Celebration", idioma: "ENG", tipo: "Binder / Colección", pvp: 43990, ...datos }).result;
}

/** Preventa 30th Celebration con los números reales de la planilla de GS Prime. */
function preventa30th(s) {
  const pv = s.ok("guardarPreventa", { proveedorId: asmodee(s).id, edicion: "30th Celebration", fecha: "2026-08-20" }).result;
  const binderEng = producto(s);
  const binderEsp = producto(s, { idioma: "ESP" });
  const miniTin = producto(s, { nombre: "Mini Tin", tipo: "Mini Tin", pvp: 13990, precioManual: true, precioVenta: 18000 });
  const deck = producto(s, { nombre: "Battle Deck", tipo: "Battle Deck", pvp: 26990 });
  const linea = (prod, lanzamiento, solicitado, costoNeto) =>
    s.ok("guardarLineaPreventa", { preventaId: pv.id, productoId: prod.id, lanzamiento, solicitado, costoNeto }).result;
  const l = {
    binderEng: linea(binderEng, "2026-10-02", 60, 25887),
    binderEsp: linea(binderEsp, "2026-10-02", 0, 25887),
    miniTin: linea(miniTin, "2026-10-02", 80, 8230),
    deck: linea(deck, "2026-10-30", 12, 15876.5),
  };
  return { pv, l, prods: { binderEng, binderEsp, miniTin, deck } };
}

const vista = (s, id) => s.ok("bootstrap").data.preventas.find(p => p.id === id);

test("instalar crea las hojas, el administrador y el proveedor Asmodee", () => {
  const s = createServer();
  const nombres = s.fake.state.sheets.map(x => x.name);
  for (const t of ["Usuarios", "Secuencias", "Proveedores", "Productos", "Preventas", "Preventas_Lineas", "Auditoria"]) assert.ok(nombres.includes(t), t);
  const boot = s.ok("bootstrap").data;
  assert.equal(boot.user.rol, "admin");
  const a = asmodee(s);
  assert.deepEqual([a.id, a.despachoUmbral, a.despachoMonto], ["PRV-001", 1000000, 15000]);
  // reinstalar no duplica nada ni da permisos a terceros
  s.as("intruso@gmail.com").run("instalar()");
  assert.equal(s.as("admin@gsprime.cl").ok("bootstrap").data.proveedores.length, 1);
  assert.equal(s.as("intruso@gmail.com").call("bootstrap").code, "NO_AUTORIZADO");
});

test("instalar actualiza hojas vacías de la versión anterior y elimina las obsoletas", () => {
  const s = createServer();
  const ss = s.fake.state;
  ss.sheets = ss.sheets.filter(x => x.name !== "Productos");
  ss.sheets.push({ name: "Productos", values: [["id", "sku", "nombre", "categoria", "juego", "precioVenta", "stockMinimo", "activo"]], formats: {}, maxRows: 1000 });
  ss.sheets.push({ name: "Pagos", values: [["id", "preventaId", "monto"]], formats: {}, maxRows: 1000 });
  s.run("instalar()");
  const encabezado = s.sheet("Productos")[0].filter(Boolean);
  assert.equal(encabezado.includes("categoria"), false);
  assert.ok(encabezado.includes("idioma") && encabezado.includes("precioManual"));
  assert.equal(ss.sheets.some(x => x.name === "Pagos"), false);
});

test("productos: correlativo GS, nombre+edición+idioma únicos y precio que sigue al PVP", () => {
  const s = createServer();
  const eng = producto(s);
  const esp = producto(s, { idioma: "ESP" });
  assert.deepEqual([eng.id, esp.id], ["GS-0001", "GS-0002"]);
  assert.match(errorDe(s.call("guardarProducto", { nombre: "binder collection", edicion: "30th celebration", idioma: "ENG" })), /Ya existe "30th Celebration – Binder Collection · ENG" \(GS-0001\)/);

  let p = s.ok("bootstrap").data.productos.find(x => x.id === eng.id);
  assert.equal(p.precio, 43990, "sin precio manual usa el PVP");
  s.ok("guardarProducto", { ...eng, pvp: 44990 });
  assert.equal(s.ok("bootstrap").data.productos.find(x => x.id === eng.id).precio, 44990);
  s.ok("guardarProducto", { ...eng, pvp: 44990, precioManual: true, precioVenta: 49990 });
  p = s.ok("bootstrap").data.productos.find(x => x.id === eng.id);
  assert.deepEqual([p.precio, p.pvp], [49990, 44990]);

  assert.match(errorDe(s.call("guardarProducto", { nombre: "X", precioManual: true })), /precio de venta es obligatorio/);
  assert.match(errorDe(s.call("guardarProducto", { nombre: "X", imagen: "javascript:alert(1)" })), /https:\/\//);
  assert.match(errorDe(s.call("guardarProducto", { nombre: "X", idioma: "FR" })), /idioma no es válido/);
});

test("booster box usa factor 36 por defecto", () => {
  const s = createServer();
  const bb = s.ok("guardarProducto", { nombre: "Booster Box", edicion: "Destined Rivals", tipo: "Booster Box" }).result;
  const etb = s.ok("guardarProducto", { nombre: "ETB", edicion: "Destined Rivals", tipo: "Elite Trainer Box" }).result;
  assert.deepEqual([bb.factor, etb.factor], [36, 1]);
});

test("los correlativos no se reutilizan aunque se elimine el registro", () => {
  const s = createServer();
  const a = producto(s, { nombre: "A" });
  s.ok("eliminarProducto", { id: a.id });
  const b = producto(s, { nombre: "B" });
  assert.equal(b.id, "GS-0002");
});

test("preventa: líneas, totales y ganancia real como en la planilla", () => {
  const s = createServer();
  const { pv, l } = preventa30th(s);
  assert.equal(pv.id, "PV-0001");
  assert.equal(l.binderEng.id, "PVI-000001");

  let v = vista(s, pv.id);
  assert.equal(v.estado, "solicitada");
  const be = v.lineas.find(x => x.id === l.binderEng.id);
  assert.equal(Math.round(be.costoIva), 30806);
  assert.equal(be.netoSolicitado, 1553220);
  assert.equal(Math.round(be.netoSolicitado * 1.19), 1848332);
  assert.equal(Math.round(be.gananciaUnidad), 11079, "ganancia real neta, no la bruta de $13.184");
  const mt = v.lineas.find(x => x.id === l.miniTin.id);
  assert.equal(mt.precioVenta, 18000, "precio manual");
  assert.deepEqual(v.lineas.map(x => x.lanzamiento), ["2026-10-02", "2026-10-02", "2026-10-02", "2026-10-30"]);
});

test("asignación: diferencia, nuevos totales, línea no solicitada y 'sin asignación'", () => {
  const s = createServer();
  const { pv, l } = preventa30th(s);
  s.ok("registrarAsignacion", { preventaId: pv.id, lineas: [
    { id: l.binderEng.id, asignado: 24 },
    { id: l.binderEsp.id, asignado: 6 },
    { id: l.miniTin.id, asignado: 10 },
  ] });
  let v = vista(s, pv.id);
  assert.equal(v.estado, "solicitada", "aún falta asignar el Battle Deck");
  const be = v.lineas.find(x => x.id === l.binderEng.id);
  assert.deepEqual([be.estado, be.diferencia, be.netoAsignado, Math.round(be.netoAsignado * 1.19)], ["asignada", 36, 621288, 739333]);
  const esp = v.lineas.find(x => x.id === l.binderEsp.id);
  assert.deepEqual([esp.diferencia, esp.netoAsignado], [-6, 155322]);

  s.ok("registrarAsignacion", { preventaId: pv.id, lineas: [{ id: l.deck.id, asignado: 0 }] });
  v = vista(s, pv.id);
  assert.equal(v.estado, "asignada");
  assert.equal(v.lineas.find(x => x.id === l.deck.id).estado, "sin_asignacion");
  assert.equal(v.unidadesAsignadas, 40);
  // se puede corregir la asignación
  s.ok("registrarAsignacion", { preventaId: pv.id, lineas: [{ id: l.deck.id, asignado: 12 }] });
  assert.equal(vista(s, pv.id).lineas.find(x => x.id === l.deck.id).estado, "asignada");
});

test("despacho por fecha de lanzamiento según la regla de Asmodee", () => {
  const s = createServer();
  const { pv, l } = preventa30th(s);
  s.ok("registrarAsignacion", { preventaId: pv.id, lineas: [
    { id: l.binderEng.id, asignado: 24 }, { id: l.binderEsp.id, asignado: 6 }, { id: l.miniTin.id, asignado: 10 }, { id: l.deck.id, asignado: 12 },
  ] });
  const [oct2, oct30] = vista(s, pv.id).lanzamientos;
  assert.deepEqual([oct2.fecha, oct2.neto, oct2.despacho, oct2.faltaParaGratis], ["2026-10-02", 858910, 15000, 141090]);
  assert.deepEqual([oct30.neto, oct30.despacho], [190518, 15000]);

  const ditto = producto(s, { nombre: "Ditto Premium Collection", tipo: "Premium Collection", pvp: 53990 });
  const ld = s.ok("guardarLineaPreventa", { preventaId: pv.id, productoId: ditto.id, lanzamiento: "2026-11-06", solicitado: 54, costoNeto: 31758.81 }).result;
  s.ok("registrarAsignacion", { preventaId: pv.id, lineas: [{ id: ld.id, asignado: 54 }] });
  const nov6 = vista(s, pv.id).lanzamientos[2];
  assert.deepEqual([Math.round(nov6.neto), nov6.despacho, nov6.faltaParaGratis], [1714976, 0, 0]);
});

test("validaciones de líneas", () => {
  const s = createServer();
  const { pv, l, prods } = preventa30th(s);
  const base = { preventaId: pv.id, productoId: prods.binderEng.id, lanzamiento: "2026-10-02", solicitado: 1, costoNeto: 1 };
  assert.match(errorDe(s.call("guardarLineaPreventa", base)), /ya está en esta preventa/);
  const otro = producto(s, { nombre: "Otro" });
  assert.match(errorDe(s.call("guardarLineaPreventa", { ...base, productoId: otro.id, lanzamiento: "" })), /lanzamiento es obligatoria/);
  assert.match(errorDe(s.call("guardarLineaPreventa", { ...base, productoId: otro.id, solicitado: -1 })), /mayor o igual a 0/);
  assert.match(errorDe(s.call("guardarLineaPreventa", { ...base, productoId: otro.id, costoNeto: 1.555 })), /2 decimales/);
  assert.match(errorDe(s.call("registrarAsignacion", { preventaId: pv.id, lineas: [{ id: l.binderEng.id, asignado: 3 }, { id: "PVI-999999", asignado: 1 }] })), /no pertenece/);
  assert.equal(vista(s, pv.id).lineas.find(x => x.id === l.binderEng.id).estado, "solicitada", "una asignación inválida no escribe nada");
});

test("líneas que ya pasaron a compra no se editan ni se eliminan", () => {
  const s = createServer();
  const { pv, l } = preventa30th(s);
  const hoja = s.fake.state.sheets.find(x => x.name === "Preventas_Lineas");
  const col = hoja.values[0].indexOf("estado");
  hoja.values[1][col] = "en_compra";
  assert.match(errorDe(s.call("guardarLineaPreventa", { ...l.binderEng, solicitado: 99 })), /ya pasó a una compra/);
  assert.match(errorDe(s.call("eliminarLineaPreventa", { id: l.binderEng.id })), /ya pasó a una compra/);
  assert.match(errorDe(s.call("eliminarPreventa", { id: pv.id })), /no se puede eliminar/);
  assert.match(errorDe(s.call("eliminarProducto", { id: l.binderEng.productoId })), /archívalo/);
});

test("eliminar una preventa borra sus líneas", () => {
  const s = createServer();
  const { pv } = preventa30th(s);
  s.ok("eliminarPreventa", { id: pv.id });
  const boot = s.ok("bootstrap").data;
  assert.equal(boot.preventas.length, 0);
  assert.equal(s.sheet("Preventas_Lineas").length, 1, "solo queda el encabezado");
});

test("proveedores: nombre único, archivado bloquea nuevas preventas", () => {
  const s = createServer();
  assert.match(errorDe(s.call("guardarProveedor", { nombre: "asmodee" })), /Ya existe/);
  const otro = s.ok("guardarProveedor", { nombre: "Distribuidora Central", despachoMonto: 5000 }).result;
  assert.equal(otro.id, "PRV-002");
  s.ok("archivarProveedor", { id: otro.id, activo: false });
  assert.match(errorDe(s.call("guardarPreventa", { proveedorId: otro.id, edicion: "X" })), /archivado/);
});

test("roles: lectura solo consulta, operador opera, admin elimina y administra", () => {
  const s = createServer();
  s.ok("guardarUsuario", { email: "Socio@GSPrime.cl", nombre: "Socio", rol: "operador" });
  s.ok("guardarUsuario", { email: "vista@gsprime.cl", nombre: "Vista", rol: "lectura" });
  const { pv, l } = preventa30th(s);

  s.as("vista@gsprime.cl");
  assert.equal(s.ok("bootstrap").data.usuarios.length, 0);
  assert.equal(s.call("guardarProducto", { nombre: "X" }).code, "SIN_PERMISO");

  s.as("socio@gsprime.cl");
  s.ok("registrarAsignacion", { preventaId: pv.id, lineas: [{ id: l.binderEng.id, asignado: 24 }] });
  s.ok("eliminarLineaPreventa", { id: l.deck.id });
  assert.equal(s.call("eliminarPreventa", { id: pv.id }).code, "SIN_PERMISO");
  assert.equal(s.call("auditoria").code, "SIN_PERMISO");

  s.as("admin@gsprime.cl");
  s.ok("guardarUsuario", { email: "socio@gsprime.cl", nombre: "Socio", rol: "operador", activo: false });
  assert.equal(s.as("socio@gsprime.cl").call("bootstrap").code, "NO_AUTORIZADO");
});

test("debe quedar al menos un administrador activo", () => {
  const s = createServer();
  assert.match(errorDe(s.call("guardarUsuario", { email: "admin@gsprime.cl", nombre: "Admin", rol: "operador" })), /al menos un administrador/);
});

test("auditoría registra quién hizo cada cambio", () => {
  const s = createServer();
  const { pv, l } = preventa30th(s);
  s.ok("registrarAsignacion", { preventaId: pv.id, lineas: [{ id: l.binderEng.id, asignado: 24 }] });
  const log = s.ok("auditoria").data;
  const asig = log.find(x => x.accion === "asignación");
  assert.equal(asig.usuario, "admin@gsprime.cl");
  assert.deepEqual(JSON.parse(asig.detalle), [{ linea: "PVI-000001", solicitado: 60, asignado: 24 }]);
});

test("fechas se guardan como texto y se leen bien si Sheets las convirtió", () => {
  const s = createServer();
  const { pv } = preventa30th(s);
  const hoja = s.fake.state.sheets.find(x => x.name === "Preventas_Lineas");
  const col = hoja.values[0].indexOf("lanzamiento");
  assert.equal(typeof hoja.values[1][col], "string");
  hoja.values[1][col] = new Date("2026-12-24T00:00:00Z");
  assert.ok(vista(s, pv.id).lineas.some(x => x.lanzamiento === "2026-12-24"));
});

test("un texto que empieza con = se guarda como texto, no como fórmula", () => {
  const s = createServer();
  const p = producto(s, { notas: "=IMPORTXML(\"http://x\")" });
  assert.equal(s.ok("bootstrap").data.productos.find(x => x.id === p.id).notas, "=IMPORTXML(\"http://x\")");
});

test("las respuestas de la API se pueden serializar (google.script.run no acepta Date)", () => {
  const s = createServer();
  preventa30th(s);
  const raw = s.run("api('bootstrap', {})");
  JSON.stringify(raw, function (k, v) { if (Object.prototype.toString.call(this[k]) === "[object Date]") throw new Error("Date en " + k); return v; });
  assert.equal(s.call("accionInexistente").ok, false);
});
