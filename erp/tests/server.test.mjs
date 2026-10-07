// Pruebas de la lógica del servidor sobre el simulador de Apps Script.
// Uso: npm run test:erp
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "./helpers.mjs";

const errorDe = (res) => { assert.equal(res.ok, false, "se esperaba un error"); return res.error; };
const asmodee = (s) => s.ok("bootstrap").data.proveedores.find(p => p.nombre === "Asmodee");

function producto(s, datos = {}) {
  return s.ok("guardarProducto", { nombre: "Binder Collection", edicion: "30th Celebration", idioma: "ENG", tipo: "Binder Colección", pvp: 43990, ...datos }).result;
}

/** Productos solicitados a Asmodee para 30th Celebration, con los números reales de la planilla de GS Prime. */
function preventa30th(s) {
  const prov = asmodee(s).id;
  const binderEng = producto(s);
  const binderEsp = producto(s, { idioma: "ESP" });
  const miniTin = producto(s, { nombre: "Mini Tin", tipo: "Tin / Mini Tin", pvp: 13990, precioManual: true, precioVenta: 18000 });
  const deck = producto(s, { nombre: "Battle Deck", tipo: "Battle Deck", pvp: 26990 });
  const pedir = (prod, lanzamiento, solicitado, costoNeto) =>
    s.ok("guardarPreventa", { proveedorId: prov, productoId: prod.id, lanzamiento, solicitado, costoNeto }).result;
  return {
    pv: {
      binderEng: pedir(binderEng, "2026-10-02", 60, 25887),
      binderEsp: pedir(binderEsp, "2026-10-02", 0, 25887),
      miniTin: pedir(miniTin, "2026-10-02", 80, 8230),
      deck: pedir(deck, "2026-10-30", 12, 15876.5),
    },
    prods: { binderEng, binderEsp, miniTin, deck },
  };
}

const preventas = (s) => s.ok("bootstrap").data.preventas;
const pv = (s, id) => preventas(s).find(p => p.id === id);

test("instalar crea las hojas, el administrador y el proveedor Asmodee", () => {
  const s = createServer();
  const nombres = s.fake.state.sheets.map(x => x.name);
  for (const t of ["Usuarios", "Secuencias", "Proveedores", "Productos", "Preventas", "Auditoria"]) assert.ok(nombres.includes(t), t);
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

test("cada producto solicitado es una preventa independiente con su correlativo", () => {
  const s = createServer();
  const { pv: p } = preventa30th(s);
  assert.deepEqual(Object.values(p).map(x => x.id), ["PVI-000001", "PVI-000002", "PVI-000003", "PVI-000004"]);
  const be = pv(s, p.binderEng.id);
  assert.deepEqual([be.estado, be.proveedor, be.edicion, be.idioma], ["solicitada", "Asmodee", "30th Celebration", "ENG"]);
  assert.equal(Math.round(be.costoIva), 30806);
  assert.equal(be.netoSolicitado, 1553220);
  assert.equal(Math.round(be.netoSolicitado * 1.19), 1848332);
  assert.equal(Math.round(be.gananciaUnidad), 11079, "ganancia real neta, no la bruta de $13.184");
  assert.equal(pv(s, p.miniTin.id).precioVenta, 18000, "precio manual");
  assert.deepEqual(preventas(s).map(x => x.lanzamiento), ["2026-10-02", "2026-10-02", "2026-10-02", "2026-10-30"], "ordenadas por lanzamiento");
});

test("precio de venta desde preventas: si no se edita se acepta el sugerido", () => {
  const s = createServer();
  const { pv: p, prods } = preventa30th(s);
  assert.deepEqual([pv(s, p.binderEng.id).precioVenta, pv(s, p.binderEng.id).precioManual], [43990, false], "sin editar = sugerido");

  // Precio propio: afecta a todas las preventas del producto y a la ganancia
  s.ok("fijarPreciosVenta", { precios: [{ productoId: prods.binderEng.id, precioVenta: 49990 }] });
  const be = pv(s, p.binderEng.id);
  assert.deepEqual([be.precioVenta, be.precioManual, be.pvp], [49990, true, 43990]);
  assert.equal(Math.round(be.gananciaUnidad), Math.round(49990 / 1.19 - 25887));

  // Vaciarlo (o poner el mismo sugerido) vuelve a seguir el precio sugerido
  s.ok("fijarPreciosVenta", { precios: [{ productoId: prods.binderEng.id, precioVenta: "" }, { productoId: prods.miniTin.id, precioVenta: 13990 }] });
  assert.deepEqual([pv(s, p.binderEng.id).precioVenta, pv(s, p.binderEng.id).precioManual], [43990, false]);
  assert.deepEqual([pv(s, p.miniTin.id).precioVenta, pv(s, p.miniTin.id).precioManual], [13990, false]);
  s.ok("guardarProducto", { ...prods.binderEng, pvp: 45990 });
  assert.equal(pv(s, p.binderEng.id).precioVenta, 45990, "sigue al sugerido cuando cambia");

  // Todo o nada
  assert.match(errorDe(s.call("fijarPreciosVenta", { precios: [{ productoId: prods.deck.id, precioVenta: 29990 }, { productoId: prods.miniTin.id, precioVenta: "abc" }] })), /precio de venta/);
  assert.equal(pv(s, p.deck.id).precioManual, false);
  assert.match(errorDe(s.call("fijarPreciosVenta", { precios: [] })), /No hay precios/);
});

test("el mismo producto puede pedirse de nuevo como otra preventa", () => {
  const s = createServer();
  const { prods } = preventa30th(s);
  const otra = s.ok("guardarPreventa", { proveedorId: asmodee(s).id, productoId: prods.binderEng.id, lanzamiento: "2026-12-01", solicitado: 12, costoNeto: 25887 }).result;
  assert.equal(otra.id, "PVI-000005");
  assert.equal(preventas(s).filter(x => x.productoId === prods.binderEng.id).length, 2);
});

test("asignación: diferencia, nuevos totales, 'sin asignación' y volver a solicitada", () => {
  const s = createServer();
  const { pv: p } = preventa30th(s);
  s.ok("registrarAsignacion", { lineas: [
    { id: p.binderEng.id, asignado: 24 }, { id: p.binderEsp.id, asignado: 6 }, { id: p.miniTin.id, asignado: 10 },
  ] });
  const be = pv(s, p.binderEng.id);
  assert.deepEqual([be.estado, be.diferencia, be.netoAsignado, Math.round(be.netoAsignado * 1.19)], ["asignada", -36, 621288, 739333]);
  const esp = pv(s, p.binderEsp.id);
  assert.deepEqual([esp.diferencia, esp.netoAsignado, Math.round(esp.netoAsignado * 1.19)], [6, 155322, 184833]);
  assert.equal(pv(s, p.deck.id).estado, "solicitada");

  s.ok("registrarAsignacion", { lineas: [{ id: p.deck.id, asignado: 0 }] });
  assert.equal(pv(s, p.deck.id).estado, "sin_asignacion");
  s.ok("registrarAsignacion", { lineas: [{ id: p.deck.id, asignado: 12 }] });
  assert.equal(pv(s, p.deck.id).estado, "asignada");
  s.ok("registrarAsignacion", { lineas: [{ id: p.deck.id, asignado: "" }] });
  const deck = pv(s, p.deck.id);
  assert.deepEqual([deck.estado, deck.diferencia], ["solicitada", null], "vaciar la cantidad deshace la asignación");
});

test("una asignación con errores no escribe nada", () => {
  const s = createServer();
  const { pv: p } = preventa30th(s);
  assert.match(errorDe(s.call("registrarAsignacion", { lineas: [{ id: p.binderEng.id, asignado: 3 }, { id: "PVI-999999", asignado: 1 }] })), /PVI-999999 no existe/);
  assert.match(errorDe(s.call("registrarAsignacion", { lineas: [{ id: p.binderEng.id, asignado: 3 }, { id: p.deck.id, asignado: -1 }] })), /asignada de PVI-000004 debe ser mayor o igual a 0/);
  assert.equal(pv(s, p.binderEng.id).estado, "solicitada");
});

test("validaciones al solicitar", () => {
  const s = createServer();
  const { prods } = preventa30th(s);
  const base = { proveedorId: asmodee(s).id, productoId: prods.binderEng.id, lanzamiento: "2026-10-02", solicitado: 1, costoNeto: 1 };
  assert.match(errorDe(s.call("guardarPreventa", { ...base, lanzamiento: "" })), /lanzamiento es obligatoria/);
  assert.match(errorDe(s.call("guardarPreventa", { ...base, solicitado: "" })), /cantidad solicitada es obligatoria/);
  assert.match(errorDe(s.call("guardarPreventa", { ...base, solicitado: -1 })), /mayor o igual a 0/);
  assert.match(errorDe(s.call("guardarPreventa", { ...base, costoNeto: 1.555 })), /2 decimales/);
  assert.match(errorDe(s.call("guardarPreventa", { ...base, productoId: "GS-9999" })), /producto no existe/);
  assert.match(errorDe(s.call("guardarPreventa", { ...base, proveedorId: "" })), /proveedor no existe/);
});

test("preventas que ya pasaron a compra no se editan, asignan ni eliminan", () => {
  const s = createServer();
  const { pv: p } = preventa30th(s);
  const hoja = s.fake.state.sheets.find(x => x.name === "Preventas");
  hoja.values[1][hoja.values[0].indexOf("estado")] = "en_compra";
  assert.match(errorDe(s.call("guardarPreventa", { ...p.binderEng, solicitado: 99 })), /ya pasó a una compra/);
  assert.match(errorDe(s.call("registrarAsignacion", { lineas: [{ id: p.binderEng.id, asignado: 1 }] })), /ya pasó a una compra/);
  assert.match(errorDe(s.call("eliminarPreventa", { id: p.binderEng.id })), /ya pasó a una compra/);
  assert.match(errorDe(s.call("eliminarProducto", { id: p.binderEng.productoId })), /archívalo/);
  s.ok("eliminarPreventa", { id: p.deck.id });
  assert.equal(preventas(s).length, 3);
});

test("despacho según la regla de Asmodee", () => {
  const s = createServer();
  const a = asmodee(s);
  assert.deepEqual(s.run(`JSON.stringify(Economia.despacho(${JSON.stringify(a)}, 858910))`), JSON.stringify({ monto: 15000, faltaParaGratis: 141090 }));
  assert.deepEqual(s.run(`JSON.stringify(Economia.despacho(${JSON.stringify(a)}, 2096081))`), JSON.stringify({ monto: 0, faltaParaGratis: 0 }));
});

test("proveedores: nombre único, archivado bloquea nuevas preventas", () => {
  const s = createServer();
  assert.match(errorDe(s.call("guardarProveedor", { nombre: "asmodee" })), /Ya existe/);
  const otro = s.ok("guardarProveedor", { nombre: "Distribuidora Central", despachoMonto: 5000 }).result;
  assert.equal(otro.id, "PRV-002");
  s.ok("archivarProveedor", { id: otro.id, activo: false });
  const prod = producto(s);
  assert.match(errorDe(s.call("guardarPreventa", { proveedorId: otro.id, productoId: prod.id, lanzamiento: "2026-10-02", solicitado: 1, costoNeto: 1 })), /archivado/);
});

test("roles: lectura solo consulta, operador opera, admin administra", () => {
  const s = createServer();
  s.ok("guardarUsuario", { email: "Socio@GSPrime.cl", nombre: "Socio", rol: "operador" });
  s.ok("guardarUsuario", { email: "vista@gsprime.cl", nombre: "Vista", rol: "lectura" });
  const { pv: p } = preventa30th(s);

  s.as("vista@gsprime.cl");
  assert.equal(s.ok("bootstrap").data.usuarios.length, 0);
  assert.equal(s.call("guardarProducto", { nombre: "X" }).code, "SIN_PERMISO");
  assert.equal(s.call("registrarAsignacion", { lineas: [{ id: p.binderEng.id, asignado: 1 }] }).code, "SIN_PERMISO");
  assert.equal(s.call("fijarPreciosVenta", { precios: [{ productoId: p.binderEng.productoId, precioVenta: 1 }] }).code, "SIN_PERMISO");

  s.as("socio@gsprime.cl");
  s.ok("registrarAsignacion", { lineas: [{ id: p.binderEng.id, asignado: 24 }] });
  s.ok("eliminarPreventa", { id: p.deck.id });
  assert.equal(s.call("eliminarProducto", { id: p.deck.productoId }).code, "SIN_PERMISO");
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
  const { pv: p } = preventa30th(s);
  s.ok("registrarAsignacion", { lineas: [{ id: p.binderEng.id, asignado: 24 }] });
  const asig = s.ok("auditoria").data.find(x => x.accion === "asignación");
  assert.equal(asig.usuario, "admin@gsprime.cl");
  assert.deepEqual(JSON.parse(asig.detalle), [{ id: "PVI-000001", solicitado: 60, asignado: 24 }]);
});

test("fechas se guardan como texto y se leen bien si Sheets las convirtió", () => {
  const s = createServer();
  preventa30th(s);
  const hoja = s.fake.state.sheets.find(x => x.name === "Preventas");
  const col = hoja.values[0].indexOf("lanzamiento");
  assert.equal(typeof hoja.values[1][col], "string");
  hoja.values[1][col] = new Date("2026-12-24T00:00:00Z");
  assert.ok(preventas(s).some(x => x.lanzamiento === "2026-12-24"));
});

test("instalar respalda la hoja Preventas de la v2.1 si tiene datos", () => {
  const s = createServer();
  const ss = s.fake.state;
  ss.sheets = ss.sheets.filter(x => x.name !== "Preventas");
  ss.sheets.push({ name: "Preventas", values: [["id", "proveedorId", "edicion", "fecha"], ["PV-0001", "PRV-001", "30th", "2026-08-20"]], formats: {}, maxRows: 1000 });
  ss.sheets.push({ name: "Preventas_Lineas", values: [["id", "preventaId"]], formats: {}, maxRows: 1000 });
  const msg = s.run("instalar()");
  assert.match(msg, /Preventas_v2_1/);
  assert.ok(ss.sheets.some(x => x.name === "Preventas_v2_1"));
  assert.ok(s.sheet("Preventas")[0].includes("productoId"));
  assert.equal(ss.sheets.some(x => x.name === "Preventas_Lineas"), false);
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

test("agregar escribiendo el nombre: usa el producto existente o lo crea desde el nombre del proveedor", () => {
  const s = createServer();
  const prov = asmodee(s).id;
  const base = { proveedorId: prov, lanzamiento: "2026-10-02", solicitado: 10, costoNeto: 1000 };
  const binder = producto(s);

  // Nombre de Asmodee de un producto que ya existe → se reutiliza (sin duplicar)
  const a = s.ok("guardarPreventa", { ...base, producto: "POKEMON TCG 30TH CELEBRATION - BINDER COLLECTION ENGLISH" }).result;
  assert.equal(a.productoId, binder.id);
  // Nombre tal como aparece en el catálogo
  const b = s.ok("guardarPreventa", { ...base, producto: "30th Celebration – Binder Collection · ENG" }).result;
  assert.equal(b.productoId, binder.id);

  // Producto nuevo: se crea con edición, idioma, tipo, factor y PVP
  const c = s.ok("guardarPreventa", { ...base, producto: "POKEMON TCG SURGING SPARKS - BOOSTER BOX ESPAÑOL", pvp: 189990 }).result;
  const nuevo = s.ok("bootstrap").data.productos.find(x => x.id === c.productoId);
  assert.deepEqual([nuevo.edicion, nuevo.nombre, nuevo.idioma, nuevo.tipo, nuevo.factor, nuevo.pvp],
    ["Surging Sparks", "Booster Box", "ESP", "Booster Box", 36, 189990]);

  // PVP informado actualiza el catálogo
  s.ok("guardarPreventa", { ...base, producto: "30th Celebration – Binder Collection · ENG", pvp: 44990 });
  assert.equal(s.ok("bootstrap").data.productos.find(x => x.id === binder.id).pvp, 44990);

  assert.match(errorDe(s.call("guardarPreventa", { ...base, producto: "" })), /producto es obligatorio/);
  s.ok("archivarProducto", { id: binder.id, activo: false });
  assert.match(errorDe(s.call("guardarPreventa", { ...base, producto: "30th Celebration – Binder Collection · ENG" })), /está archivado/);
});

test("nombres siempre en formato título e idioma detectado por ING/ENG/ESP", () => {
  const s = createServer();
  const p = s.ok("guardarProducto", { nombre: "BINDER collection", edicion: "30TH CELEBRATION", idioma: "ENG" }).result;
  assert.deepEqual([p.nombre, p.edicion], ["Binder Collection", "30th Celebration"]);
  const base = { proveedorId: asmodee(s).id, lanzamiento: "2026-10-02", solicitado: 1, costoNeto: 1 };
  const ing = s.ok("guardarPreventa", { ...base, producto: "pokemon tcg 30th celebration - mini tin ING" }).result;
  const esp = s.ok("guardarPreventa", { ...base, producto: "POKEMON TCG DESTINED RIVALS - ELITE TRAINER BOX ESP" }).result;
  const prods = s.ok("bootstrap").data.productos;
  const a = prods.find(x => x.id === ing.productoId);
  const b = prods.find(x => x.id === esp.productoId);
  assert.deepEqual([a.edicion, a.nombre, a.idioma], ["30th Celebration", "Mini Tin", "ENG"]);
  assert.deepEqual([b.edicion, b.nombre, b.idioma, b.tipo], ["Destined Rivals", "Elite Trainer Box", "ESP", "Elite Trainer Box"]);
});

test("si el nombre no indica idioma, el producto queda sin idioma (no se asume ENG)", () => {
  const s = createServer();
  const pv = s.ok("guardarPreventa", { proveedorId: asmodee(s).id, producto: "Pokemon TCG Mega Evolution - Booster Box", lanzamiento: "2026-11-01", solicitado: 2, costoNeto: 100000 }).result;
  const prod = s.ok("bootstrap").data.productos.find(p => p.id === pv.productoId);
  assert.deepEqual([prod.idioma, prod.nombreCompleto], ["", "Mega Evolution – Booster Box"]);
  // Con idioma es otro producto distinto
  const eng = s.ok("guardarPreventa", { proveedorId: asmodee(s).id, producto: "Pokemon TCG Mega Evolution - Booster Box ENG", lanzamiento: "2026-11-01", solicitado: 1, costoNeto: 100000 }).result;
  assert.notEqual(eng.productoId, pv.productoId);
});

test("si la preventa tiene errores no se crea el producto escrito", () => {
  const s = createServer();
  const antes = s.ok("bootstrap").data.productos.length;
  assert.match(errorDe(s.call("guardarPreventa", { proveedorId: asmodee(s).id, producto: "POKEMON TCG X - BOOSTER BOX ENG", solicitado: 1, costoNeto: 1 })), /lanzamiento es obligatoria/);
  assert.equal(s.ok("bootstrap").data.productos.length, antes);
});

test("con la planilla desactualizada se detiene y pide ejecutar instalar", () => {
  const s = createServer();
  const hoja = s.fake.state.sheets.find(x => x.name === "Preventas");
  hoja.values[0] = ["id", "proveedorId", "edicion", "fecha", "notas"];
  hoja.values.push(["PV-0001", "PRV-001", "30th", "2026-08-20", ""]);
  const r = s.call("bootstrap");
  assert.equal(r.code, "NO_INSTALADO");
  assert.match(r.error, /faltan columnas: productoId.*ejecutar instalar/);
  s.run("instalar()");
  assert.equal(s.call("bootstrap").ok, true);
});

test("imágenes: carpeta en Drive, subida al crear desde preventa, reemplazo y quitar desde productos", () => {
  const s = createServer();
  const drive = s.fake.state;
  const [carpetaId] = Object.keys(drive.folders);
  assert.equal(drive.folders[carpetaId].name, "GS Prime ERP · Imágenes");
  assert.equal(drive.props.CARPETA_IMAGENES, carpetaId);

  // Los usuarios que operan quedan como editores de la carpeta; los de solo lectura no
  s.ok("guardarUsuario", { email: "socio@gsprime.cl", nombre: "Socio", rol: "operador" });
  s.ok("guardarUsuario", { email: "vista@gsprime.cl", nombre: "Vista", rol: "lectura" });
  assert.ok(drive.folders[carpetaId].editors.includes("socio@gsprime.cl"));
  assert.ok(!drive.folders[carpetaId].editors.includes("vista@gsprime.cl"));

  const img = { mime: "image/jpeg", base64: "QUJD" };
  const pv = s.ok("guardarPreventa", { proveedorId: asmodee(s).id, producto: "POKEMON TCG 30TH CELEBRATION - MINI TIN ENG", lanzamiento: "2026-10-02", solicitado: 1, costoNeto: 1, imagen: img }).result;
  let prod = s.ok("bootstrap").data.productos.find(x => x.id === pv.productoId);
  assert.match(prod.imagen, /^drive:img-1$/);
  const archivo = drive.files["img-1"];
  assert.deepEqual([archivo.folder, archivo.name, archivo.shared], [carpetaId, "30th Celebration – Mini Tin · ENG.jpg", true]);

  // Reemplazar y quitar desde Productos
  s.ok("guardarProducto", { ...prod, imagenArchivo: { mime: "image/png", base64: "REVG" } });
  prod = s.ok("bootstrap").data.productos.find(x => x.id === pv.productoId);
  assert.equal(prod.imagen, "drive:img-2");
  s.ok("guardarProducto", { ...prod, imagen: "" });
  assert.equal(s.ok("bootstrap").data.productos.find(x => x.id === pv.productoId).imagen, "");

  assert.match(errorDe(s.call("guardarProducto", { ...prod, imagenArchivo: { mime: "application/pdf", base64: "QQ==" } })), /JPG, PNG o WEBP/);
  assert.match(errorDe(s.call("guardarProducto", { ...prod, imagenArchivo: { mime: "image/jpeg", base64: "A".repeat(5 * 1024 * 1024) } })), /muy pesada/);
  // Una imagen inválida en la preventa no deja el producto creado
  const antes = s.ok("bootstrap").data.productos.length;
  assert.match(errorDe(s.call("guardarPreventa", { proveedorId: asmodee(s).id, producto: "OTRO - BLISTER ENG", lanzamiento: "2026-10-02", solicitado: 1, costoNeto: 1, imagen: { mime: "text/plain", base64: "QQ==" } })), /JPG, PNG o WEBP/);
  assert.equal(s.ok("bootstrap").data.productos.length, antes);
});

test("factura de compra desde preventas: pasan a inventario con el despacho prorrateado", () => {
  const s = createServer();
  const { pv: p, prods } = preventa30th(s);
  s.ok("registrarAsignacion", { lineas: [
    { id: p.binderEng.id, asignado: 24 }, { id: p.binderEsp.id, asignado: 6 }, { id: p.miniTin.id, asignado: 10 }, { id: p.deck.id, asignado: 12 },
  ] });

  // Validaciones: solo preventas asignadas, N° de factura y fecha obligatorios
  assert.match(errorDe(s.call("crearCompra", { preventas: [], factura: "1", fecha: "2026-10-02" })), /al menos una preventa/);
  assert.match(errorDe(s.call("crearCompra", { preventas: [p.binderEng.id], fecha: "2026-10-02" })), /N° de factura es obligatorio/);
  assert.match(errorDe(s.call("crearCompra", { preventas: [p.binderEng.id], factura: "30th2" })), /fecha de la factura es obligatoria/);

  // Neto $858.910 < $1.000.000: Asmodee cobra $15.000 de despacho
  const c = s.ok("crearCompra", { preventas: [p.binderEng.id, p.binderEsp.id, p.miniTin.id], factura: "30th2", fecha: "2026-10-02" }).result;
  assert.equal(c.id, "CP-0001");
  const data = s.ok("bootstrap").data;
  const compra = data.compras.find(x => x.id === c.id);
  assert.deepEqual([compra.netoProductos, compra.despacho, compra.neto, compra.unidades], [858910, 15000, 873910, 40]);
  assert.equal(Math.round(compra.total), Math.round(873910 * 1.19));
  assert.equal(compra.lineas.length, 3);

  // Despacho por participación en $: Mini Tin $82.300 / $858.910 × $15.000 = $1.437 → $143,7 por unidad
  const tin = data.lotes.find(l => l.preventaId === p.miniTin.id);
  assert.equal(Math.round(tin.despacho), 1437);
  assert.equal(Math.round(tin.costo), Math.round(8230 + 15000 * 82300 / 858910 / 10));
  assert.equal(Math.round(tin.gananciaUnidad), Math.round(18000 / 1.19 - tin.costo));
  assert.equal(Math.round(data.lotes.reduce((t, l) => t + l.despacho, 0)), 15000, "el despacho completo queda repartido");
  assert.equal(tin.disponible, 10);

  // Las preventas salen de pendientes y ya no se modifican
  assert.equal(pv(s, p.binderEng.id).estado, "recibida");
  assert.equal(pv(s, p.binderEng.id).factura, "30th2");
  assert.match(errorDe(s.call("registrarAsignacion", { lineas: [{ id: p.binderEng.id, asignado: 1 }] })), /ya pasó a una compra/);
  assert.match(errorDe(s.call("crearCompra", { preventas: [p.binderEng.id], factura: "otra", fecha: "2026-10-02" })), /no está asignada/);

  // N° de factura único por proveedor
  assert.match(errorDe(s.call("crearCompra", { preventas: [p.deck.id], factura: "30TH2", fecha: "2026-10-30" })), /ya está registrada \(CP-0001\)/);

  // Despacho gratis desde $1.000.000, y se puede corregir a mano según la factura real
  const grande = s.ok("guardarPreventa", { proveedorId: asmodee(s).id, productoId: prods.deck.id, lanzamiento: "2026-10-30", solicitado: 70, costoNeto: 15876.5 }).result;
  s.ok("registrarAsignacion", { lineas: [{ id: grande.id, asignado: 70 }] });
  const c2 = s.ok("crearCompra", { preventas: [grande.id, p.deck.id], factura: "DECK-1", fecha: "2026-10-30" }).result;
  assert.equal(s.ok("bootstrap").data.compras.find(x => x.id === c2.id).despacho, 0, "neto $1.301.873 ≥ $1.000.000");
  s.ok("anularCompra", { id: c2.id });
  const c3 = s.ok("crearCompra", { preventas: [grande.id], factura: "DECK-1", fecha: "2026-10-30", despacho: 9000 }).result;
  assert.equal(s.ok("bootstrap").data.compras.find(x => x.id === c3.id).despacho, 9000);
});

test("anular una factura devuelve las preventas a asignadas (solo administrador)", () => {
  const s = createServer();
  const { pv: p } = preventa30th(s);
  s.ok("registrarAsignacion", { lineas: [{ id: p.miniTin.id, asignado: 10 }] });
  const c = s.ok("crearCompra", { preventas: [p.miniTin.id], factura: "F-1", fecha: "2026-10-02" }).result;
  s.ok("guardarUsuario", { email: "socio@gsprime.cl", nombre: "Socio", rol: "operador" });
  assert.equal(s.as("socio@gsprime.cl").call("anularCompra", { id: c.id }).code, "SIN_PERMISO");
  s.as("admin@gsprime.cl").ok("anularCompra", { id: c.id });
  const data = s.ok("bootstrap").data;
  assert.deepEqual([data.compras.length, data.lotes.length], [0, 0]);
  assert.deepEqual([pv(s, p.miniTin.id).estado, pv(s, p.miniTin.id).asignado], ["asignada", 10]);
});

/** Factura 30th2 con Binder ENG 24, Binder ESP 6 y Mini Tin 10 (despacho $15.000 prorrateado). */
function conInventario(s) {
  const r = preventa30th(s);
  const { pv: p } = r;
  s.ok("registrarAsignacion", { lineas: [{ id: p.binderEng.id, asignado: 24 }, { id: p.binderEsp.id, asignado: 6 }, { id: p.miniTin.id, asignado: 10 }] });
  s.ok("crearCompra", { preventas: [p.binderEng.id, p.binderEsp.id, p.miniTin.id], factura: "30th2", fecha: "2026-10-02" });
  return r;
}
const lote = (s, prodId) => s.ok("bootstrap").data.lotes.filter(l => l.productoId === prodId);

test("venta: sale del inventario, calcula ganancia real y comisión TUU, y acumula en su factura", () => {
  const s = createServer();
  const { prods } = conInventario(s);

  // Validaciones
  assert.match(errorDe(s.call("crearVenta", { fecha: "2026-10-05", lineas: [] })), /al menos un producto/);
  assert.match(errorDe(s.call("crearVenta", { fecha: "2026-10-05", lineas: [{ productoId: prods.miniTin.id, cantidad: 11 }] })), /Stock insuficiente de .*Mini Tin.*quedan 10/);
  assert.match(errorDe(s.call("crearVenta", { fecha: "2026-10-05", lineas: [{ productoId: prods.deck.id, cantidad: 1 }] })), /no hay unidades/);
  assert.equal(s.ok("bootstrap").data.clientes.length, 0, "un error no deja clientes creados");

  // Cliente general, Tienda por defecto, precio de venta del producto, débito con comisión 0,77% + $65
  const v = s.ok("crearVenta", { fecha: "2026-10-05", medioPago: "debito", boleta: "1234",
    lineas: [{ productoId: prods.miniTin.id, cantidad: 2 }, { productoId: prods.binderEng.id, cantidad: 1, precio: 39990 }] }).result;
  assert.equal(v.id, "OC-0001");
  const data = s.ok("bootstrap").data;
  const venta = data.ventas.find(x => x.id === v.id);
  assert.deepEqual([venta.cliente, venta.canal, venta.boleta, venta.total, venta.estadoPago], ["Cliente general", "Tienda", "1234", 2 * 18000 + 39990, "pagada"]);
  assert.equal(venta.comision, Math.round(75990 * 0.0077 + 65));
  assert.equal(venta.descuento, 4000, "descuento por producto: 43.990 → 39.990");
  const tin = data.lotes.find(l => l.productoId === prods.miniTin.id);
  assert.equal(Math.round(venta.lineas.find(l => l.productoId === prods.miniTin.id).gananciaUnidad), Math.round(18000 / 1.19 - tin.costo), "ganancia con el costo real del lote (con despacho)");
  assert.equal(Math.round(venta.gananciaNeta), Math.round(venta.ganancia - venta.comision));

  // Inventario y factura de compra
  assert.deepEqual([tin.vendidas, tin.disponible], [2, 8]);
  assert.deepEqual(tin.unidadesVendidas.map(u => u.oc), ["OC-0001", "OC-0001"]);
  const compra = data.compras[0];
  assert.deepEqual([compra.vendidas, compra.unidades, compra.estadoVenta, compra.ventasAcumuladas], [3, 40, "vendiendo", 75990]);
  assert.equal(Math.round(compra.gananciaAcumulada), Math.round(venta.ganancia));

  // Efectivo: sin comisión. Vender todo deja la factura "vendida completa"
  const resto = [[prods.miniTin.id, 8], [prods.binderEng.id, 23], [prods.binderEsp.id, 6]].map(([id, n]) => ({ productoId: id, cantidad: n }));
  const v2 = s.ok("crearVenta", { fecha: "2026-10-06", medioPago: "efectivo", cliente: "juan perez", canal: "Evento", evento: "Torneo martes", lineas: resto }).result;
  assert.equal(v2.comision, 0);
  const d2 = s.ok("bootstrap").data;
  assert.equal(d2.compras[0].estadoVenta, "vendida");
  assert.equal(d2.clientes[0].nombre, "Juan Perez", "el cliente escrito se crea");
  assert.equal(d2.clientes[0].compras, 1);

  // No se puede anular la factura con ventas; anular la venta devuelve el stock
  assert.match(errorDe(s.call("anularCompra", { id: compra.id })), /tiene productos vendidos/);
  s.ok("anularVenta", { id: v2.id });
  assert.equal(lote(s, prods.miniTin.id)[0].disponible, 8);
  assert.equal(s.ok("bootstrap").data.compras[0].estadoVenta, "vendiendo");
});

test("quitar un producto de una factura: sale del inventario, reparte el despacho y si era el último borra la factura", () => {
  const s = createServer();
  const { prods } = conInventario(s);
  const compra = s.ok("bootstrap").data.compras[0];
  const despacho = compra.despacho;
  const tin = lote(s, prods.miniTin.id)[0];
  s.ok("guardarUsuario", { email: "socio@gsprime.cl", nombre: "Socio", rol: "operador" });
  assert.equal(s.as("socio@gsprime.cl").call("quitarLineaCompra", { id: tin.id }).code, "SIN_PERMISO");
  s.as("admin@gsprime.cl");

  // Con ventas no se puede: primero se anulan
  const v = s.ok("crearVenta", { fecha: "2026-10-05", lineas: [{ productoId: prods.miniTin.id, cantidad: 1 }] }).result;
  assert.match(errorDe(s.call("quitarLineaCompra", { id: tin.id })), /tiene ventas \(OC-0001\)/);
  s.ok("anularVenta", { id: v.id });
  s.ok("quitarLineaCompra", { id: tin.id });
  let data = s.ok("bootstrap").data;
  assert.equal(data.lotes.filter(l => l.productoId === prods.miniTin.id).length, 0);
  const c = data.compras[0];
  assert.equal(c.lineas.length, 2);
  assert.equal(Math.round(c.lineas.reduce((t, l) => t + l.despacho, 0)), despacho, "el despacho completo queda en las líneas que quedan");

  // Quitar las otras dos borra la factura
  c.lineas.forEach(l => s.ok("quitarLineaCompra", { id: l.id }));
  data = s.ok("bootstrap").data;
  assert.deepEqual([data.compras.length, data.lotes.length], [0, 0]);
});

test("toma de inventario: foto de lo esperado, marcas por unidad, sobrantes y cierre con ajustes", () => {
  const s = createServer();
  const { prods } = conInventario(s);   // Binder ENG 24, Binder ESP 6, Mini Tin 10
  s.ok("crearVenta", { fecha: "2026-10-05", lineas: [{ productoId: prods.miniTin.id, cantidad: 2 }] });
  s.ok("guardarUsuario", { email: "socio@gsprime.cl", nombre: "Socio", rol: "operador" });

  // El operador inicia y cuenta; solo puede haber una abierta
  s.as("socio@gsprime.cl");
  const toma = s.ok("iniciarToma", { notas: "Conteo de octubre" }).result;
  assert.equal(toma.id, "TOM-0001");
  assert.match(errorDe(s.call("iniciarToma", {})), /Ya hay una toma abierta/);
  let t = s.ok("bootstrap").data.tomas[0];
  const linea = (prodId) => t.lineas.find(l => l.productoId === prodId && l.loteId);
  assert.deepEqual([linea(prods.miniTin.id).esperado, linea(prods.miniTin.id).marcas], [8, "--------"]);
  assert.equal(t.diferencias.esperado, 38);

  // Encontradas: todo el Binder ENG, 5 de 6 ESP y 7 de 8 Mini Tin; 2 Mini Tin de más y 1 Deck que no debía haber
  const lineas = [
    { id: linea(prods.binderEng.id).id, marcas: "x".repeat(24) },
    { id: linea(prods.binderEsp.id).id, marcas: "xxx-xx" },
    { id: linea(prods.miniTin.id).id, marcas: "xxxxxxx-" },
  ];
  assert.match(errorDe(s.call("guardarToma", { id: toma.id, lineas: [{ id: lineas[1].id, marcas: "xx" }] })), /Marcas inválidas/);
  s.ok("guardarToma", { id: toma.id, lineas, sobrantes: [{ productoId: prods.miniTin.id, cantidad: 2 }, { productoId: prods.deck.id, cantidad: 1 }] });
  t = s.ok("bootstrap").data.tomas[0];
  assert.deepEqual([t.diferencias.esperado, t.diferencias.encontrado], [38, 36 + 3]);
  assert.deepEqual(t.diferencias.faltantes.map(f => [f.productoId, f.cantidad]), [[prods.binderEsp.id, 1], [prods.miniTin.id, 1]]);

  // Cerrar es del administrador
  assert.equal(s.call("cerrarToma", { id: toma.id, aplicarFaltantes: true, aplicarSobrantes: true }).code, "SIN_PERMISO");
  s.as("admin@gsprime.cl");
  const costoTin = lote(s, prods.miniTin.id)[0].costo;
  const r = s.ok("cerrarToma", { id: toma.id, aplicarFaltantes: true, aplicarSobrantes: true }).result;
  assert.deepEqual(r.aplicado, { faltantes: 2, sobrantes: 3, omitidos: 0 });
  const d = s.ok("bootstrap").data;
  assert.equal(d.tomas[0].estado, "cerrada");
  const tin = d.lotes.filter(l => l.productoId === prods.miniTin.id);
  const ajuste = tin.find(l => l.factura === "Ajuste TOM-0001");
  const original = tin.find(l => l !== ajuste);
  assert.deepEqual([original.disponible, ajuste.disponible], [7, 2], "faltante como pérdida y sobrante como lote de ajuste");
  assert.equal(Math.round(ajuste.costo), Math.round(costoTin), "el sobrante entra al último costo");
  assert.equal(d.compras.length, 1, "el ajuste no aparece como factura");
  assert.equal(d.lotes.find(l => l.productoId === prods.deck.id).costo, 15876.5, "sin lotes: costo de su preventa");
  assert.match(errorDe(s.call("guardarToma", { id: toma.id, lineas: [] })), /ya está cerrada/);
});

test("unir productos duplicados: el stock y el historial pasan al que se conserva", () => {
  const s = createServer();
  const { prods } = conInventario(s);
  s.ok("crearVenta", { fecha: "2026-10-05", lineas: [{ productoId: prods.binderEsp.id, cantidad: 1 }] });
  assert.match(errorDe(s.call("eliminarProducto", { id: prods.binderEsp.id })), /preventa|inventario/);
  s.ok("unirProductos", { origenId: prods.binderEsp.id, destinoId: prods.binderEng.id });
  const d = s.ok("bootstrap").data;
  assert.equal(d.productos.some(p => p.id === prods.binderEsp.id), false);
  const eng = d.lotes.filter(l => l.productoId === prods.binderEng.id);
  assert.deepEqual([eng.length, eng.reduce((t, l) => t + l.disponible, 0)], [2, 29]);
  assert.ok(d.ventas[0].lineas.every(l => l.productoId === prods.binderEng.id));
  assert.match(errorDe(s.call("unirProductos", { origenId: prods.binderEng.id, destinoId: prods.binderEng.id })), /distintos/);
});

test("editar factura: separar el despacho que venía incluido en los precios (como la 46056) y corregir costos vendidos", () => {
  const s = createServer();
  const { pv: p } = preventa30th(s);
  // Como quedó tras la migración: precios con el despacho ya prorrateado y despacho 0
  s.ok("guardarPreventa", { id: p.binderEng.id, proveedorId: asmodee(s).id, productoId: p.binderEng.productoId, lanzamiento: "2026-10-30", solicitado: 12, costoNeto: 12592.5 });
  s.ok("guardarPreventa", { id: p.binderEsp.id, proveedorId: asmodee(s).id, productoId: p.binderEsp.productoId, lanzamiento: "2026-10-30", solicitado: 6, costoNeto: 12592.5 });
  s.ok("registrarAsignacion", { lineas: [{ id: p.binderEng.id, asignado: 12 }, { id: p.binderEsp.id, asignado: 6 }] });
  const c = s.ok("crearCompra", { preventas: [p.binderEng.id, p.binderEsp.id], factura: "46056", fecha: "2026-06-16", despacho: 0 }).result;
  let d = s.ok("bootstrap").data;
  const lotes = d.lotes.filter(l => l.compraId === c.id);
  s.ok("crearVenta", { fecha: "2026-06-20", lineas: [{ productoId: p.binderEng.productoId, cantidad: 2 }] });
  const totalAntes = d.compras[0].total;

  s.ok("guardarUsuario", { email: "socio@gsprime.cl", nombre: "Socio", rol: "operador" });
  assert.equal(s.as("socio@gsprime.cl").call("editarCompra", { id: c.id, despacho: 15000, lineas: [] }).code, "SIN_PERMISO");
  s.as("admin@gsprime.cl");
  s.ok("editarCompra", { id: c.id, despacho: 15000, lineas: lotes.map(l => ({ id: l.id, costoNeto: 11759 })) });
  d = s.ok("bootstrap").data;
  const cp = d.compras.find(x => x.id === c.id);
  assert.deepEqual([cp.despacho, Math.round(cp.neto), Math.round(cp.iva), Math.round(cp.total)], [15000, 226662, 43066, 269728], "igual que el PDF");
  assert.ok(Math.abs(cp.total - totalAntes) < 5, "el total prácticamente no cambia (redondeo de los precios migrados)");
  const eng = d.lotes.find(l => l.id === lotes[0].id);
  assert.deepEqual([eng.costoNeto, Math.round(eng.despacho)], [11759, 10000], "despacho prorrateado por $: 12 de 18 unidades");
  const venta = d.ventas[0];
  assert.equal(Math.round(venta.lineas[0].costo * 100) / 100, Math.round(eng.costo * 100) / 100, "la venta ya hecha toma el costo corregido");
  assert.match(errorDe(s.call("editarCompra", { id: c.id, despacho: -1, lineas: [] })), /despacho/);
});

test("editar factura: corregir la cantidad de un producto (23 → 25) deja las unidades de más disponibles", () => {
  const s = createServer();
  const { prods } = conInventario(s);   // Binder ENG 24, Binder ESP 6, Mini Tin 10 (despacho $15.000)
  s.ok("crearVenta", { fecha: "2026-10-05", lineas: [{ productoId: prods.binderEsp.id, cantidad: 4 }] });
  let d = s.ok("bootstrap").data;
  const compra = d.compras[0];
  const esp = d.lotes.find(l => l.productoId === prods.binderEsp.id);
  const lineas = (cant) => compra.lineas.map(l => ({ id: l.id, costoNeto: l.costoNeto, cantidad: l.id === esp.id ? cant : l.cantidad }));
  assert.match(errorDe(s.call("editarCompra", { id: compra.id, despacho: compra.despacho, lineas: lineas(3) })), /ya salieron 4/);
  s.ok("editarCompra", { id: compra.id, despacho: compra.despacho, lineas: lineas(8) });
  d = s.ok("bootstrap").data;
  const lote = d.lotes.find(l => l.id === esp.id);
  assert.deepEqual([lote.cantidad, lote.vendidas, lote.disponible], [8, 4, 4]);
  const cp = d.compras[0];
  assert.equal(Math.round(cp.neto - cp.despacho), Math.round(compra.neto - compra.despacho + 2 * esp.costoNeto), "el neto suma las 2 unidades");
  const totalDesp = d.lotes.filter(l => l.compraId === compra.id).reduce((t, l) => t + l.despacho, 0);
  assert.ok(Math.abs(totalDesp - 15000) < 0.01, "el despacho se vuelve a repartir completo");
  assert.equal(Math.round(d.ventas[0].lineas[0].costo * 100) / 100, Math.round(lote.costo * 100) / 100, "la venta toma el costo nuevo");
});

test("editar venta: el total que pagó el cliente queda con una línea de ajuste, su motivo y la comisión", () => {
  const s = createServer();
  const v = s.ok("crearVenta", { fecha: "2026-07-01", lineas: [{ categoria: "Otro", descripcion: "OC original OC004", monto: 84280 }] }).result;
  assert.match(errorDe(s.call("editarVenta", { id: v.id, fecha: "2026-07-01", total: 85000, comision: 720 })), /motivo del ajuste/);
  s.ok("editarVenta", { id: v.id, fecha: "2026-07-01", boleta: "", notas: "Migrada", total: 85000, comision: 720, motivo: "La caja registró el monto con la comisión descontada" });
  const venta = s.ok("bootstrap").data.ventas.find(x => x.id === v.id);
  assert.deepEqual([venta.total, venta.comision, venta.estadoPago, venta.saldo], [85000, 720, "pagada", 0]);
  const aj = venta.lineas.find(l => l.categoria === "Ajuste");
  assert.deepEqual([aj.precio, aj.descripcion], [720, "La caja registró el monto con la comisión descontada"]);
  assert.match(venta.notas, /^Migrada · \d{4}-\d{2}-\d{2}: total ajustado 84280 → 85000 \(La caja registró/);
  // Mismo total: no agrega nada
  s.ok("editarVenta", { id: v.id, fecha: "2026-07-01", boleta: "", notas: venta.notas, total: 85000, comision: 720 });
  assert.equal(s.ok("bootstrap").data.ventas.find(x => x.id === v.id).lineas.length, 2);
});

test("OC migradas: toman su N° original (OC223 → OC-0223), con sus líneas, abonos y referencias", () => {
  const s = createServer();
  const venta = (notas, monto, extra) => {
    const v = s.ok("crearVenta", Object.assign({ fecha: "2026-07-01", lineas: [{ categoria: "Otro", descripcion: "x", monto: monto }] }, extra || {})).result;
    s.ok("editarVenta", { id: v.id, fecha: "2026-07-01", boleta: "", notas: notas });
    return v.id;
  };
  const a = venta("Migración desde Excel · OC original OC3", 1000);                     // OC-0001 → OC-0003
  const b = venta("Migración desde Excel · OC original OC1", 2000, { pagada: false, abono: 500, cliente: "Ana" });   // OC-0002 → OC-0001
  const c = venta("Migración desde Excel · OC original oc 1", 3000);                    // misma OC → OC-0001-2
  const d = venta("Caja diaria · torneos del día consolidados", 4000);                  // sin OC original y sobre el máximo (3): conserva OC-0004
  s.ok("registrarCobro", { ventaId: b, fecha: "2026-07-02", monto: 500, medioPago: "efectivo" });
  s.run(`Db.insert("Migracion_Caja", { id: "MC-1", fila: 2, fecha: "2026-07-01", glosa: "Ventas", entradas: 1000, salidas: 0, migrada: "Fecha ${a}, ${b}" })`);
  // Fila de la caja con la OC003 aún sin migrar: la venta toma su fecha (la más antigua)
  s.run(`Db.insertMany("Migracion_Caja", [{ id: "MC-2", fila: 3, fecha: "2025-11-05", glosa: "Ventas", entradas: 600, salidas: 0, oc: "OC003" },
    { id: "MC-3", fila: 4, fecha: "2025-11-09", glosa: "Ventas", entradas: 400, salidas: 0, oc: "OC003" }])`);
  const plan = s.ok("ocOriginales").data;
  assert.deepEqual(plan.cambios.map(x => x.de + ">" + x.a).sort(), [a + ">OC-0003", b + ">OC-0001", c + ">OC-0001-2"].sort());
  assert.equal(plan.cambios.find(x => x.a === "OC-0003").fechaNueva, "2025-11-05");
  assert.equal(d, "OC-0004", "la venta sin OC original ya queda sobre el número más alto y conserva su número");
  s.ok("renumerarOc");
  const data = s.ok("bootstrap").data;
  const v = (id) => data.ventas.find(x => x.id === id);
  assert.deepEqual([v("OC-0003").total, v("OC-0001").total, v("OC-0001-2").total, v("OC-0004").total], [1000, 2000, 3000, 4000]);
  assert.deepEqual([v("OC-0003").fecha, v("OC-0001").fecha], ["2025-11-05", "2026-07-01"], "fecha de la caja; sin fila en la caja no cambia");
  assert.deepEqual([v("OC-0001").cobros.length, v("OC-0001").saldo], [1, 1000], "el abono sigue en su venta");
  assert.equal(s.run(`Db.get("Migracion_Caja", "MC-1").migrada`), "Fecha OC-0003, OC-0001");
  assert.equal(s.ok("crearVenta", { fecha: "2026-07-03", lineas: [{ categoria: "Otro", descripcion: "y", monto: 10 }] }).result.id, "OC-0005", "las ventas nuevas siguen desde el más alto");
  assert.equal(s.ok("ocOriginales").data.cambios.length, 0);
  s.ok("guardarUsuario", { email: "vista@gsprime.cl", nombre: "Vista", rol: "lectura" });
  assert.equal(s.as("vista@gsprime.cl").call("renumerarOc", {}).code, "SIN_PERMISO");
});

test("ventas sin OC: singles, torneos, bazar… con su propio correlativo; las existentes se separan", () => {
  const s = createServer();
  const { prods } = conInventario(s);
  const monto = (categoria, m) => s.ok("crearVenta", { fecha: "2026-10-05", lineas: [{ categoria: categoria, descripcion: "x", monto: m }] }).result.id;
  assert.equal(monto("Singles", 5000), "SGL-0001");
  assert.equal(monto("Torneo", 3000), "TOR-0001");
  assert.equal(monto("Singles", 2000), "SGL-0002");
  assert.equal(monto("Otro", 1000), "OC-0001", "Otro sigue como OC");
  assert.equal(s.ok("crearVenta", { fecha: "2026-10-05", lineas: [{ productoId: prods.miniTin.id, cantidad: 1 }] }).result.id, "OC-0002");
  // Ventas antiguas de singles/torneos con N° de OC (y sus abonos y referencias) pasan a su correlativo
  const v = s.ok("crearVenta", { fecha: "2026-09-01", cliente: "Ana", pagada: false, abono: 0, lineas: [{ categoria: "Bazar", descripcion: "y", monto: 4000 }] }).result;
  s.run(`Db.update("Ventas", "${v.id}", { id: "OC-0090" });
    Db.all("Ventas_Lineas").filter(l => l.ventaId === "${v.id}").forEach(l => Db.update("Ventas_Lineas", l.id, { ventaId: "OC-0090" }));
    Db.insert("Migracion_Caja", { id: "MC-1", fila: 2, fecha: "2026-09-01", glosa: "Ventas", entradas: 4000, salidas: 0, migrada: "OC-0090" });`);
  s.ok("registrarCobro", { ventaId: "OC-0090", fecha: "2026-09-02", monto: 1000, medioPago: "efectivo" });
  const mig = JSON.parse(s.run(`JSON.stringify(Ventas.separarSinOc({ email: "admin@gsprime.cl" }))`));
  assert.deepEqual(mig, { "OC-0090": "BAZ-0002" });   // BAZ-0001 lo usó al crearse
  const venta = s.ok("bootstrap").data.ventas.find(x => x.id === "BAZ-0002");
  assert.deepEqual([venta.total, venta.cobros.length, venta.saldo], [4000, 1, 3000]);
  assert.equal(s.run(`Db.get("Migracion_Caja", "MC-1").migrada`), "BAZ-0002");
  // La OC "Otro" queda como OC y la Validación la marca como OC sin producto
  assert.ok(s.ok("bootstrap").data.ventas.some(x => x.id === "OC-0001"));
  assert.ok(s.ok("validacion").data.hallazgos.some(h => h.regla === "vtOcSinProducto" && h.ref === "OC-0001"));
});

test("editar venta: N°, cliente, canal, medio de pago y precios; el N° libre se respeta", () => {
  const s = createServer();
  const { prods } = conInventario(s);
  const v = s.ok("crearVenta", { fecha: "2026-07-01", lineas: [{ productoId: prods.miniTin.id, cantidad: 2 }] }).result;   // OC-0001, 2 × 18.000
  const linea = s.ok("bootstrap").data.ventas.find(x => x.id === v.id).lineas[0];
  s.ok("crearVenta", { fecha: "2026-07-02", lineas: [{ productoId: prods.miniTin.id, cantidad: 1 }] });                   // OC-0002
  assert.match(errorDe(s.call("editarVenta", { id: v.id, fecha: "2026-07-01", numero: "OC-0002" })), /ya lo usa otra venta/);
  assert.match(errorDe(s.call("editarVenta", { id: v.id, fecha: "2026-07-01", numero: "abc" })), /no es válido/);
  const r = s.ok("editarVenta", { id: v.id, fecha: "2026-07-01", numero: "286", cliente: "Vicente", canal: "Evento", evento: "Liga", medioPago: "transferencia",
    lineas: [{ id: linea.id, precio: 17000 }] }).result;
  assert.equal(r.id, "OC-0286");
  const d = s.ok("bootstrap").data;
  const e = d.ventas.find(x => x.id === "OC-0286");
  assert.deepEqual([e.cliente, e.canal, e.evento, e.medioPago, e.total, e.estadoPago], ["Vicente", "Evento", "Liga", "transferencia", 34000, "pagada"]);
  assert.ok(!d.ventas.some(x => x.id === v.id));
  assert.equal(s.ok("crearVenta", { fecha: "2026-07-03", lineas: [{ productoId: prods.miniTin.id, cantidad: 1 }] }).result.id, "OC-0287", "el correlativo sigue después del N° usado");
});

test("reclasificar una venta sin productos: a otro concepto o a Finanzas", () => {
  const s = createServer();
  conInventario(s);
  const v1 = s.ok("crearVenta", { fecha: "2025-06-13", medioPago: "debito", lineas: [{ categoria: "Otro", descripcion: "OC original OC389", monto: 1000 }] }).result;
  const v2 = s.ok("crearVenta", { fecha: "2025-06-14", lineas: [{ categoria: "Otro", descripcion: "Cartas", monto: 8000 }] }).result;
  s.run(`Db.insert("Migracion_Caja", { id: "MC-1", fila: 2, fecha: "2025-06-13", glosa: "Ventas", entradas: 1000, salidas: 0, migrada: "${v1.id}" })`);
  // Compra de prueba: no fue una venta → Finanzas
  const r1 = s.ok("reclasificarVenta", { id: v1.id, destino: "finanzas", motivo: "Compra de prueba en la app" }).result;
  let d = s.ok("bootstrap").data;
  assert.equal(d.ventas.find(x => x.id === v1.id).anulada, true);
  const mov = d.movimientos.find(m => m.id === r1.nuevo);
  assert.deepEqual([mov.tipo, mov.categoria, mov.monto, mov.cuenta, mov.referencia, mov.fecha], ["ingreso", "otro_ingreso", 1000, "tuu", "Antes " + v1.id, "2025-06-13"]);
  assert.equal(s.run(`Db.get("Migracion_Caja", "MC-1").migrada`), r1.nuevo);
  // Devolución del SII que entró como venta: va a Finanzas con su categoría
  const sii = s.ok("crearVenta", { fecha: "2026-05-14", lineas: [{ categoria: "Otro", descripcion: "SII", monto: 986 }] }).result;
  const r3 = s.ok("reclasificarVenta", { id: sii.id, destino: "finanzas", categoriaMov: "devolucion_sii", motivo: "Devolución de impuestos" }).result;
  assert.equal(s.ok("bootstrap").data.movimientos.find(m => m.id === r3.nuevo).categoria, "devolucion_sii");
  // Otra: eran singles → sale de las OC
  const r2 = s.ok("reclasificarVenta", { id: v2.id, destino: "Singles" }).result;
  assert.equal(r2.nuevo, "SGL-0001");
  d = s.ok("bootstrap").data;
  assert.equal(d.ventas.find(x => x.id === "SGL-0001").lineas[0].categoria, "Singles");
  // Con productos del inventario no se puede
  const v3 = s.ok("crearVenta", { fecha: "2026-10-05", lineas: [{ productoId: d.productos[0].id, cantidad: 1 }] });
  assert.match(errorDe(s.call("reclasificarVenta", { id: v3.result.id, destino: "Singles" })), /productos del inventario/);
});

test("dividir un movimiento: salida de un socio en retiro de capital + compra de acciones", () => {
  const s = createServer();
  s.ok("guardarMovimiento", { fecha: "2025-05-01", tipo: "ingreso", categoria: "aporte", subcategoria: "Jaime", monto: 500000 });
  const m = s.ok("guardarMovimiento", { fecha: "2026-03-13", tipo: "egreso", categoria: "gopm", subcategoria: "Salida Jaime", monto: 750000, cuenta: "banco" }).result;
  assert.match(errorDe(s.call("dividirMovimiento", { id: m.id, partes: [{ categoria: "retiro", subcategoria: "Jaime", monto: 500000 }, { categoria: "otro_egreso", monto: 200000 }] })), /suman 700000/);
  assert.match(errorDe(s.call("dividirMovimiento", { id: m.id, partes: [{ categoria: "aporte", monto: 750000 }, { categoria: "gav", monto: 0 }] })), /categoría/);
  const r = s.ok("dividirMovimiento", { id: m.id, partes: [{ categoria: "retiro", subcategoria: "Jaime", monto: 500000 }, { categoria: "otro_egreso", subcategoria: "Compensación Jaime", monto: 250000 }] }).result;
  const movs = s.ok("bootstrap").data.movimientos;
  const a = movs.find(x => x.id === m.id), b = movs.find(x => x.id === r.nuevos[0]);
  assert.deepEqual([a.categoria, a.monto, b.categoria, b.monto, b.fecha, b.cuenta], ["retiro", 500000, "otro_egreso", 250000, "2026-03-13", "banco"]);
  assert.match(b.notas, /Dividido de MOV-/);
});

test("pagos de facturas: registrar en partes, anular y estado de pago", () => {
  const s = createServer();
  const { pv: pp } = preventa30th(s);
  s.ok("registrarAsignacion", { lineas: [{ id: pp.binderEng.id, asignado: 24 }, { id: pp.binderEsp.id, asignado: 6 }, { id: pp.miniTin.id, asignado: 10 }] });
  s.ok("crearCompra", { preventas: [pp.binderEng.id, pp.binderEsp.id], factura: "30th2", fecha: "2026-10-02" });
  s.ok("crearCompra", { preventas: [pp.miniTin.id], factura: "30th3", fecha: "2026-10-03" });   // otra factura, para reenlazar
  let c = s.ok("bootstrap").data.compras.find(x => x.factura === "30th2");
  assert.deepEqual([c.pagado, c.porPagar], [0, Math.round(c.total)]);
  assert.match(errorDe(s.call("registrarPagoCompra", { compraId: c.id, fecha: "2026-10-10", monto: Math.round(c.total) + 10 })), /no puede ser mayor/);
  const p1 = s.ok("registrarPagoCompra", { compraId: c.id, fecha: "2026-10-10", monto: 100000, cuenta: "banco" }).result;
  s.ok("registrarPagoCompra", { compraId: c.id, fecha: "2026-10-20", monto: Math.round(c.total) - 100000 });
  let d = s.ok("bootstrap").data;
  c = d.compras.find(x => x.id === c.id);
  assert.deepEqual([c.pagos.length, c.porPagar], [2, 0]);
  assert.ok(d.pagosFacturas.some(x => x.id === p1.id && x.cuenta === "banco"), "llega a Finanzas");
  // Reenlazar a otra factura: la primera vuelve a quedar por pagar
  const otra = d.compras.find(x => x.id !== c.id);
  s.ok("reenlazarPagoCompra", { origen: "manual", id: p1.id, compraId: otra.id });
  d = s.ok("bootstrap").data;
  assert.deepEqual([d.compras.find(x => x.id === c.id).porPagar, d.compras.find(x => x.id === otra.id).pagado], [100000, 100000]);
  assert.match(errorDe(s.call("reenlazarPagoCompra", { origen: "manual", id: p1.id, compraId: "CP-9999" })), /no existe/);
  s.ok("reenlazarPagoCompra", { origen: "manual", id: p1.id, compraId: c.id });
  s.ok("anularPagoCompra", { id: p1.id });
  assert.equal(s.ok("bootstrap").data.compras.find(x => x.id === c.id).porPagar, 100000);
  s.ok("guardarUsuario", { email: "vista@gsprime.cl", nombre: "Vista", rol: "lectura" });
  assert.equal(s.as("vista@gsprime.cl").call("registrarPagoCompra", { compraId: c.id, fecha: "2026-10-10", monto: 1 }).code, "SIN_PERMISO");
});

test("editar venta: lo pagado al vender deja deuda (con cliente) y se salda con abonos", () => {
  const s = createServer();
  const { prods } = conInventario(s);
  const v = s.ok("crearVenta", { fecha: "2026-07-01", lineas: [{ productoId: prods.miniTin.id, cantidad: 2 }] }).result;   // 36.000 pagada
  assert.match(errorDe(s.call("editarVenta", { id: v.id, fecha: "2026-07-01", abono: 10000 })), /necesita un cliente/);
  s.ok("editarVenta", { id: v.id, fecha: "2026-07-01", abono: 10000, cliente: "Vicente" });
  let e = s.ok("bootstrap").data.ventas.find(x => x.id === v.id);
  assert.deepEqual([e.estadoPago, e.saldo, e.cliente], ["abonada", 26000, "Vicente"]);
  s.ok("registrarCobro", { ventaId: v.id, fecha: "2026-07-05", monto: 26000, medioPago: "efectivo" });
  e = s.ok("bootstrap").data.ventas.find(x => x.id === v.id);
  assert.equal(e.estadoPago, "pagada");
  assert.match(errorDe(s.call("editarVenta", { id: v.id, fecha: "2026-07-01", abono: 20000 })), /no puede ser mayor a 10000/);
});

test("cerrar la migración: limpia la zona de trabajo, conserva lo migrado de la caja y se puede reabrir", () => {
  const s = createServer();
  s.run(`Db.insertMany("Migracion_Caja", [
    { id: "MC-1", fila: 2, fecha: "2026-01-01", glosa: "Ventas", entradas: 1000, salidas: 0, migrada: "OC-0001" },
    { id: "MC-2", fila: 3, fecha: "2026-01-02", glosa: "GAV", entradas: 0, salidas: 500 },
    { id: "MC-3", fila: 4, fecha: "2026-01-03", glosa: "x", entradas: 0, salidas: 0, descartada: true }]);
    Db.insert("Migracion", { id: "MIG-1", fila: 2, producto: "x" });`);
  assert.equal(s.ok("bootstrap").data.app.migracionCerrada, "");
  const r = s.ok("cerrarMigracion").result;
  assert.deepEqual([r.conservadas, r.quitadas], [1, 2]);
  assert.deepEqual(JSON.parse(s.run(`JSON.stringify(Db.all("Migracion_Caja").map(f => f.id))`)), ["MC-1"]);
  assert.equal(s.run(`Db.all("Migracion").length`), 0);
  const d = s.ok("bootstrap").data;
  assert.match(d.app.migracionCerrada, /admin@gsprime.cl/);
  assert.deepEqual(d.cajaPendiente, {});
  s.ok("reabrirMigracion");
  assert.equal(s.ok("bootstrap").data.app.migracionCerrada, "");
});

test("agregar un producto que faltó en una factura: preventa recibida, lote y despacho repartido", () => {
  const s = createServer();
  const { prods } = conInventario(s);   // factura con despacho $15.000
  let d = s.ok("bootstrap").data;
  const c = d.compras[0];
  const r = s.ok("agregarLineaCompra", { compraId: c.id, producto: "Pokemon TCG Journey Together - Booster Bundle ENG", cantidad: 3, costoNeto: 19500, pvp: 32990 }).result;
  d = s.ok("bootstrap").data;
  const cp = d.compras.find(x => x.id === c.id);
  assert.equal(cp.lineas.length, c.lineas.length + 1);
  const lote = d.lotes.find(l => l.id === r.lote);
  assert.deepEqual([lote.cantidad, lote.disponible, lote.costoNeto, lote.producto], [3, 3, 19500, "Journey Together – Booster Bundle · ENG"]);
  assert.ok(lote.despacho > 0, "le toca parte del despacho");
  assert.ok(Math.abs(cp.lineas.reduce((t, l) => t + l.despacho, 0) - 15000) < 0.01);
  const pv = d.preventas.find(x => x.id === r.preventa);
  assert.deepEqual([pv.estado, pv.asignado, pv.proveedorId], ["recibida", 3, cp.proveedorId]);
  // Producto existente por ID
  s.ok("agregarLineaCompra", { compraId: c.id, productoId: prods.miniTin.id, cantidad: 1, costoNeto: 8000 });
  assert.equal(s.ok("bootstrap").data.compras.find(x => x.id === c.id).lineas.length, c.lineas.length + 2);
  s.ok("guardarUsuario", { email: "socio@gsprime.cl", nombre: "Socio", rol: "operador" });
  assert.equal(s.as("socio@gsprime.cl").call("agregarLineaCompra", { compraId: c.id, productoId: prods.miniTin.id, cantidad: 1, costoNeto: 1 }).code, "SIN_PERMISO");
});

test("validación de datos: encuentra inconsistencias, se validan y reaparecen si los datos cambian", () => {
  const s = createServer();
  const { prods } = conInventario(s);   // Binder ENG 24, Binder ESP 6, Mini Tin 10
  // Duplicado, venta con descuento alto y bajo costo, cliente duplicado, movimiento duplicado
  s.run(`Db.insert("Productos", { id: "GS-9999", nombre: "Mini  Tin", edicion: "30th celebration", idioma: "ENG", tipo: "Tin / Mini Tin", pvp: 13990, activo: true })`);   // como quedó de la migración
  s.ok("crearVenta", { fecha: "2026-10-05", lineas: [{ productoId: prods.miniTin.id, cantidad: 1, precio: 5000 }] });
  s.ok("guardarCliente", { nombre: "Ana Rojas" });
  s.run(`Db.insert("Clientes", { id: "CLI-9999", nombre: "Ana  Rojas.", activo: true })`);
  const mov = { fecha: "2026-10-01", tipo: "egreso", categoria: "gav", subcategoria: "Luz", monto: 30000 };
  s.ok("guardarMovimiento", mov);
  s.ok("guardarMovimiento", mov);
  let r = s.ok("validacion").data;
  const de = (regla) => r.hallazgos.filter(h => h.regla === regla);
  assert.equal(de("prodDuplicado").length, 1);
  assert.equal(de("vtDescuentoAlto").length, 1);
  assert.equal(de("vtPerdida").length, 1);
  assert.equal(de("cliDuplicado").length, 1);
  assert.equal(de("finDuplicado").length, 1);
  assert.ok(r.hallazgos.every(h => h.area && h.nivel && h.titulo && h.estado === "pendiente"));
  // Validar el descuento: queda validado; si cambia la venta (otra firma), vuelve a pendiente
  const h = de("vtDescuentoAlto")[0];
  s.ok("validarHallazgos", { items: [{ clave: h.clave, firma: h.firma }], nota: "precio especial" });
  r = s.ok("validacion").data;
  assert.deepEqual([de("vtDescuentoAlto")[0].estado, de("vtDescuentoAlto")[0].nota], ["validado", "precio especial"]);
  s.run(`Db.update("Ventas_Lineas", "${h.ref}", { precio: 4000 })`);
  r = s.ok("validacion").data;
  assert.equal(de("vtDescuentoAlto")[0].estado, "pendiente", "cambió el dato: hay que revisarlo de nuevo");
  // Reabrir y permisos
  s.ok("validarHallazgos", { items: [{ clave: de("cliDuplicado")[0].clave, firma: de("cliDuplicado")[0].firma }] });
  s.ok("validarHallazgos", { items: [{ clave: de("cliDuplicado")[0].clave, firma: de("cliDuplicado")[0].firma }], estado: "pendiente" });
  assert.equal(s.ok("validacion").data.hallazgos.find(x => x.regla === "cliDuplicado").estado, "pendiente");
  s.ok("guardarUsuario", { email: "socio@gsprime.cl", nombre: "Socio", rol: "operador" });
  assert.equal(s.as("socio@gsprime.cl").call("validacion", {}).code, "SIN_PERMISO");
});

test("venta en varios lotes (FIFO) y cuenta por cobrar con abonos", () => {
  const s = createServer();
  const { prods } = conInventario(s);
  // Segundo lote de Mini Tin con otro costo
  const pv2 = s.ok("guardarPreventa", { proveedorId: asmodee(s).id, productoId: prods.miniTin.id, lanzamiento: "2026-11-01", solicitado: 5, costoNeto: 9000 }).result;
  s.ok("registrarAsignacion", { lineas: [{ id: pv2.id, asignado: 5 }] });
  s.ok("crearCompra", { preventas: [pv2.id], factura: "TIN-2", fecha: "2026-11-01", despacho: 0 });

  assert.match(errorDe(s.call("crearVenta", { fecha: "2026-11-05", pagada: false, abono: 0, lineas: [{ productoId: prods.miniTin.id, cantidad: 1 }] })), /necesita un cliente/);
  const v = s.ok("crearVenta", { fecha: "2026-11-05", medioPago: "transferencia", cliente: "Ana", pagada: false, abono: 50000,
    lineas: [{ productoId: prods.miniTin.id, cantidad: 12 }] }).result;
  const venta = s.ok("bootstrap").data.ventas.find(x => x.id === v.id);
  assert.deepEqual(venta.lineas.map(l => l.cantidad), [10, 2], "primero el lote más antiguo");
  assert.deepEqual([venta.total, venta.cobrado, venta.saldo, venta.estadoPago], [216000, 50000, 166000, "abonada"]);
  assert.equal(venta.lineas[1].costo, 9000);

  assert.match(errorDe(s.call("registrarCobro", { ventaId: v.id, fecha: "2026-11-06", monto: 200000 })), /no puede ser mayor a 166000/);
  s.ok("registrarCobro", { ventaId: v.id, fecha: "2026-11-06", monto: 166000 });
  const pagada = s.ok("bootstrap").data.ventas.find(x => x.id === v.id);
  assert.deepEqual([pagada.saldo, pagada.estadoPago], [0, "pagada"]);
  assert.match(errorDe(s.call("registrarCobro", { ventaId: v.id, fecha: "2026-11-07", monto: 1 })), /ya está pagada/);
  assert.equal(s.ok("bootstrap").data.clientes[0].deuda, 0);
});

test("venta desde un lote elegido en Inventario: sale de ese lote aunque haya uno más antiguo", () => {
  const s = createServer();
  const { prods } = conInventario(s);
  const pv2 = s.ok("guardarPreventa", { proveedorId: asmodee(s).id, productoId: prods.miniTin.id, lanzamiento: "2026-11-01", solicitado: 5, costoNeto: 9000 }).result;
  s.ok("registrarAsignacion", { lineas: [{ id: pv2.id, asignado: 5 }] });
  s.ok("crearCompra", { preventas: [pv2.id], factura: "TIN-2", fecha: "2026-11-01", despacho: 0 });
  const nuevo = lote(s, prods.miniTin.id).find(l => l.factura === "TIN-2");
  assert.match(errorDe(s.call("crearVenta", { fecha: "2026-11-05", lineas: [{ productoId: prods.miniTin.id, cantidad: 6, loteId: nuevo.id }] })), /en ese lote: quedan 5/);
  const v = s.ok("crearVenta", { fecha: "2026-11-05", lineas: [{ productoId: prods.miniTin.id, cantidad: 2, loteId: nuevo.id }, { productoId: prods.miniTin.id, cantidad: 1 }] }).result;
  const venta = s.ok("bootstrap").data.ventas.find(x => x.id === v.id);
  assert.deepEqual(venta.lineas.map(l => [l.loteId === nuevo.id, l.cantidad]), [[true, 2], [false, 1]], "2 del lote elegido y 1 por FIFO del más antiguo");
  assert.equal(lote(s, prods.miniTin.id).find(l => l.id === nuevo.id).disponible, 3);
});

test("respaldos: activador diario, respaldo antes de instalar con datos y se guardan los últimos 30", () => {
  const s = createServer();
  assert.deepEqual(JSON.parse(JSON.stringify(s.fake.state.triggers.map(t => [t.fn, t.hour]))), [["respaldoDiario", 3]], "instalar programa el respaldo de las 3 a. m.");
  const copias = () => Object.values(s.fake.state.files).filter(f => f.copyOf && !f.trashed);
  assert.equal(copias().length, 0, "planilla vacía: no hace falta respaldar");

  preventa30th(s);
  s.run("instalar()");
  assert.equal(s.fake.state.triggers.length, 1, "no duplica el activador");
  assert.equal(copias().length, 1);
  assert.match(copias()[0].name, /GS Prime ERP · Base de datos · respaldo .* · antes de instalar v\d+\.\d+\.\d+/);
  const carpeta = s.fake.state.folders[copias()[0].folder];
  assert.deepEqual(JSON.parse(JSON.stringify([carpeta.name, carpeta.parent])), ["GS Prime ERP · Respaldos", "fld-root"], "junto a la planilla");

  // Diario: uno por día aunque se llame dos veces
  s.run("respaldoDiario()");
  s.run("respaldoDiario()");
  assert.equal(copias().filter(f => /· diario$/.test(f.name)).length, 1);
  // Conserva los últimos 30 diarios
  for (let i = 0; i < 35; i++) s.fake.state.files["viejo-" + i] = { folder: copias()[0].folder, name: "x · diario", copyOf: "fake-spreadsheet", created: new Date(2020, 0, i + 1).toISOString() };
  s.run("respaldoDiario()");
  assert.equal(copias().filter(f => /· diario$/.test(f.name)).length, 30);

  // Manual (solo administrador) y listado
  s.ok("guardarUsuario", { email: "socio@gsprime.cl", nombre: "Socio", rol: "operador" });
  assert.equal(s.as("socio@gsprime.cl").call("crearRespaldo", {}).code, "SIN_PERMISO");
  s.as("admin@gsprime.cl").ok("crearRespaldo", {});
  const estado = s.ok("respaldos").data;
  assert.equal(estado.programado, true);
  assert.ok(estado.respaldos.some(r => /· manual$/.test(r.nombre)));
  assert.match(estado.respaldos[0].url, /^https:\/\/docs\.google\.com\/spreadsheets\/d\//);
});

test("exportar datos para la demo: un JSON con todas las hojas que se puede volver a cargar igual", () => {
  const s = createServer();
  const { prods } = conInventario(s);
  s.ok("crearVenta", { fecha: "2026-10-05", cliente: "Ana Rojas", medioPago: "debito", lineas: [{ productoId: prods.miniTin.id, cantidad: 2 }] });
  s.ok("guardarUsuario", { email: "socio@gsprime.cl", nombre: "Socio", rol: "operador" });
  assert.equal(s.as("socio@gsprime.cl").call("exportarDemo").code, "SIN_PERMISO");
  s.as("admin@gsprime.cl");
  s.run("PropertiesService.getScriptProperties().setProperty('CARPETA_IMAGENES', 'abc')");

  s.ok("exportarDemo");
  const r = s.ok("exportarDemo").data;
  assert.match(r.url, /^https:\/\/drive\.google\.com\/uc\?export=download&id=/);
  const archivos = Object.values(s.fake.state.files).filter(f => /datos para demo/.test(f.name));
  assert.equal(archivos.filter(f => !f.trashed).length, 1, "solo queda la exportación más reciente");
  assert.ok(!s.ok("respaldos").data.respaldos.some(x => /\.json$/.test(x.nombre)), "no aparece en la lista de respaldos");

  const datos = JSON.parse(archivos.find(f => !f.trashed).content);
  const hoja = (n) => datos.hojas.find(h => h.nombre === n);
  assert.equal(hoja("Ventas").values.length, 2);
  const fecha = hoja("Compras").values[0].indexOf("fecha");
  assert.equal(hoja("Compras").values[1][fecha], "2026-10-02", "las fechas salen como texto");
  assert.equal(datos.props.CARPETA_IMAGENES, undefined, "sin las carpetas de Drive");

  // Cargado en otro simulador queda igual
  const s2 = createServer({ state: { sheets: datos.hojas.map(h => ({ name: h.nombre, values: h.values, formats: h.formatos, maxRows: 1000 })), props: datos.props } });
  const a = s.ok("bootstrap").data;
  const b = s2.ok("bootstrap").data;
  for (const k of ["compras", "lotes", "ventas", "clientes", "preventas"]) assert.deepEqual(b[k], a[k], k);
  const venta = s2.ok("crearVenta", { fecha: "2026-10-06", lineas: [{ productoId: prods.miniTin.id, cantidad: 1 }] }).result;
  assert.equal(venta.id, "OC-0002", "los correlativos siguen donde iban");
});

test("migración: el tipo 'Binder / Colección' pasa a 'Binder Colección' en los productos existentes", () => {
  const s = createServer();
  const { prods } = preventa30th(s);
  s.run(`Db.update("Productos", "${prods.binderEng.id}", { tipo: "Binder / Colección" });
    Db.vaciar("Migraciones");`);
  s.run("instalar()");
  assert.equal(s.ok("bootstrap").data.productos.find(p => p.id === prods.binderEng.id).tipo, "Binder Colección");
});

test("migración: 'Accesorio' pasa a 'Accesorios' y 'Tin'/'Mini Tin' se unen en 'Tin / Mini Tin'", () => {
  const s = createServer();
  const { prods } = preventa30th(s);
  s.run(`Db.update("Productos", "${prods.miniTin.id}", { tipo: "Mini Tin" });
    Db.update("Productos", "${prods.binderEng.id}", { tipo: "Tin" });
    Db.update("Productos", "${prods.binderEsp.id}", { tipo: "Accesorio" });
    Db.vaciar("Migraciones");`);
  s.run("instalar()");
  const tipo = (id) => s.ok("bootstrap").data.productos.find(p => p.id === id).tipo;
  assert.deepEqual([tipo(prods.miniTin.id), tipo(prods.binderEng.id), tipo(prods.binderEsp.id)], ["Tin / Mini Tin", "Tin / Mini Tin", "Accesorios"]);
  // Orden alfabético con "Otro" al final, e interpretación de nombres nuevos
  const tipos = Object.keys(s.ok("bootstrap").data.catalogos.tipos);
  assert.equal(tipos.at(-1), "Otro");
  assert.deepEqual(tipos.slice(0, -1), [...tipos.slice(0, -1)].sort((a, b) => a.localeCompare(b)));
  assert.equal(s.run("interpretarNombre_('POKEMON TCG 30TH CELEBRATION MINI TIN ENG').tipo"), "Tin / Mini Tin");
  assert.equal(s.run("interpretarNombre_('POKEMON TCG MEGA EVOLUTION BOX ESP').tipo"), "Box");
  assert.equal(s.run("interpretarNombre_('POKEMON TCG MEWTWO ULTRA PREMIUM COLLECTION ENG').tipo"), "UPC");
  assert.equal(s.run("interpretarNombre_('POKEMON TCG PRISMATIC EVOLUTIONS POSTER COLLECTION ENG').tipo"), "Poster Collection");
  assert.equal(s.run("interpretarNombre_('POKEMON TCG PRISMATIC EVOLUTIONS TECH STICKER COLLECTION ESP').tipo"), "Tech Sticker");
});

test("migraciones: corren una sola vez, después de un respaldo, y quedan registradas", () => {
  const s = createServer();
  const { prods } = preventa30th(s);
  s.run(`MIGRACIONES.push({ id: "2026-10-01-notas", descripcion: "Marca los productos migrados", fn: () => {
    Db.all("Productos").forEach((p) => Db.update("Productos", p.id, { notas: "migrado" }));
  } })`);
  assert.deepEqual(s.ok("respaldos").data.pendientes.map(m => m.id), ["2026-10-01-notas"]);
  s.run("instalar()");
  const data = s.ok("bootstrap").data;
  assert.equal(data.productos.find(p => p.id === prods.miniTin.id).notas, "migrado");
  const copias = Object.values(s.fake.state.files).filter(f => f.copyOf);
  assert.ok(copias.some(f => /antes de migrar 2026-10-01-notas/.test(f.name)), "respaldo previo a la migración");
  const estado = s.ok("respaldos").data;
  assert.deepEqual([estado.pendientes.length, estado.migraciones.map(m => m.id).filter(id => id === "2026-10-01-notas")], [0, ["2026-10-01-notas"]]);

  // Reinstalar no la vuelve a correr
  s.ok("guardarProducto", { ...data.productos.find(p => p.id === prods.miniTin.id), notas: "editado" });
  s.run("instalar()");
  assert.equal(s.ok("bootstrap").data.productos.find(p => p.id === prods.miniTin.id).notas, "editado");
});

/** Muestra con las mismas particularidades del Excel "Stock" real. */
function excelEjemplo() {
  const u = (proveedor, factura, producto, costo, venta, oc = "", cliente = "", boleta = "") => ({ proveedor, factura, producto, costo, venta, oc, cliente, boleta });
  const filas = [
    u("Proveedor", "Factura", "Producto", "Costo", "$ Venta"),                         // título repetido
    u("Asmodee", "30th", "30TH CELEBRATION - ETB (ENG)", 39995, 89000, "OC285", "DANI", "1001"),
    u("Asmodee", "30th", "30TH CELEBRATION - ETB (ENG)", 39995, 89000),
    u("Asmodee", "30th", "30th Celebration - Poster Collection (Eng)", 12054, 15000, "OC", "PREMIOS"),
    u("Asmodee", "30th", "30th Celebration - Poster Collection (Eng)", 12054, 15000, "OC000", "PREMIOS | MUGRI"),
    u("Asmodee", "-", "Luminose City  - Mini Tin (ENG)", 7010, 13990, "OC171", "CLIENTE NN"),
    u("Asmodee", "-", "Luminose City  - Mini Tin (ENG)", 7010, 13990),
    u("Panteon", 45642, "Phantasmal Flames | Blister (ESP)", "$ 5.500", "$ 9.990", "OC026", "Feria del Libro"),
    u("Panteon", 45642, "Phantasmal Flames | Blister (ESP)", 5500, 9990, "OC300", "razor"),
    u("Panteon", 45642, "Phantasmal Flames | Blister (ESP)", 5500, 9990, "OC301", "RAIZOR"),
    u("Asmodee", "30th", "POKEMON TCG 30TH CELEBRATION - BINDER COLLECTION Epañol", 26252, 53000, "OC0", "ABIERTOS"),
    u("", "", "", "", ""),                                                                 // fila vacía
    u("Asmodee", "30th", "", "", 12000),                                                   // sin producto ni costo
  ];
  return filas.map((f, i) => ({ fila: i + 3, ...f }));
}

test("migración: carga el Excel, propone homologaciones y bloquea la importación hasta revisar", () => {
  const s = createServer();
  const e = s.ok("migracionCargar", { filas: excelEjemplo() }).result;
  assert.deepEqual([e.resumen.filas, e.resumen.descartadas, e.resumen.unidades, e.resumen.vendidas, e.resumen.disponibles], [13, 2, 11, 8, 3]);
  const m = (tipo, original) => e.mapeos.find(x => x.tipo === tipo && x.original === original);
  assert.equal(m("producto", "30TH CELEBRATION - ETB (ENG)").destino, "30th Celebration – ETB · ENG");
  assert.equal(m("producto", "Phantasmal Flames | Blister (ESP)").destino, "Phantasmal Flames – Blister · ESP");
  assert.equal(m("producto", "POKEMON TCG 30TH CELEBRATION - BINDER COLLECTION Epañol").destino, "30th Celebration – Binder Collection · ESP");
  assert.deepEqual(["PREMIOS", "PREMIOS | MUGRI", "ABIERTOS", "CLIENTE NN", "Feria del Libro", "DANI"].map(c => m("cliente", c).accion), ["premio", "premio", "apertura", "general", "evento", "cliente"]);
  assert.equal(m("cliente", "Feria del Libro").extra, "Feria Del Libro");
  assert.equal(m("factura", "Asmodee · -").destino, "", "factura '-' queda por completar");
  assert.equal(m("proveedor", "Asmodee").destino, "Asmodee");
  // La fila sin producto ni costo aparece como problema; nada está confirmado
  assert.equal(e.problemas.length, 1);
  assert.match(e.errores.join(" | "), /sin confirmar.*facturas sin número.*filas con datos faltantes/);
  assert.match(errorDe(s.call("migracionImportar", { fecha: "2026-09-30" })), /Antes de importar resuelve/);
  // Solo administrador
  s.ok("guardarUsuario", { email: "socio@gsprime.cl", nombre: "Socio", rol: "operador" });
  assert.equal(s.as("socio@gsprime.cl").call("migracion").code, "SIN_PERMISO");
});

test("migración: homologar, importar y queda todo en el ERP (lotes, ventas con OC original, salidas)", () => {
  const s = createServer();
  let e = s.ok("migracionCargar", { filas: excelEjemplo() }).result;
  const clave = (tipo, original) => e.mapeos.find(x => x.tipo === tipo && x.original === original).clave;
  // Completar la fila sin producto: se descarta. Número a la factura "-". Unir razor/RAIZOR.
  e = s.ok("migracionFilas", { filas: [{ id: e.problemas[0].id, descartada: true }] }).result;
  e = s.ok("migracionMapeos", { mapeos: [
    { clave: clave("factura", "Asmodee · -"), destino: "LUM-001", extra: "2026-08-10" },
    { clave: clave("cliente", "RAIZOR"), destino: "Razor" },
  ] }).result;
  e = s.ok("migracionMapeos", { mapeos: e.mapeos.map(x => ({ clave: x.clave, confirmado: true })) }).result;
  assert.deepEqual(e.errores, []);
  const r = s.ok("migracionImportar", { fecha: "2026-09-30" }).result;
  assert.deepEqual([r.compras, r.ventas, r.salidas, r.unidades], [3, 5, 3, 10]);

  const d = s.ok("bootstrap").data;
  assert.ok(d.proveedores.some(p => p.nombre === "Panteon"), "proveedor nuevo");
  const lum = d.compras.find(c => c.factura === "LUM-001");
  assert.equal(lum.fecha, "2026-08-10");
  const etb = d.lotes.find(l => l.producto === "30th Celebration – ETB · ENG");
  assert.deepEqual([etb.cantidad, etb.vendidas, etb.disponible, etb.costo], [2, 1, 1, 39995]);
  assert.equal(d.productos.find(p => p.id === etb.productoId).pvp, 89000, "precio de venta desde el Excel");
  // Premios y cajas abiertas salen del stock sin ser venta
  const poster = d.lotes.find(l => l.producto === "30th Celebration – Poster Collection · ENG");
  assert.deepEqual([poster.vendidas, poster.salidas, poster.disponible], [0, 2, 0]);
  assert.equal(poster.unidadesVendidas[0].salida, "premio");
  // Ventas con la OC original en las notas; Razor y RAIZOR son el mismo cliente
  const dani = d.ventas.find(v => v.cliente === "Dani");
  assert.match(dani.notas, /OC original OC285/);
  assert.deepEqual([dani.total, dani.boleta, dani.canal], [89000, "1001", "Tienda"]);
  assert.equal(d.clientes.find(c => c.nombre === "Razor").compras, 2);
  const feria = d.ventas.find(v => v.evento === "Feria Del Libro");
  assert.deepEqual([feria.canal, feria.cliente, feria.total], ["Evento", "Cliente general", 9990]);
  // Respaldo previo y no se puede importar dos veces
  assert.ok(Object.values(s.fake.state.files).some(f => /antes de importar la migración/.test(f.name)));
  assert.match(errorDe(s.call("migracionImportar", { fecha: "2026-09-30" })), /ya se importó/);
  assert.match(errorDe(s.call("migracionMapeos", { mapeos: [] })), /ya se importó/);
});

/** Migra el Excel de stock de ejemplo (ventas con OC original OC285, OC171, OC026, OC300, OC301). */
function migrarStock(s) {
  // + una venta post-release PR171: es otra serie, no la OC171
  const pr = { fila: 99, proveedor: "Asmodee", factura: "-", producto: "Luminose City  - Mini Tin (ENG)", costo: 7010, venta: 13990, oc: "PR171", cliente: "POST-RELEASE", boleta: "" };
  let e = s.ok("migracionCargar", { filas: excelEjemplo().concat([pr]) }).result;
  const clave = (tipo, original) => e.mapeos.find(x => x.tipo === tipo && x.original === original).clave;
  e = s.ok("migracionFilas", { filas: [{ id: e.problemas[0].id, descartada: true }] }).result;
  e = s.ok("migracionMapeos", { mapeos: [{ clave: clave("factura", "Asmodee · -"), destino: "LUM-001" }] }).result;
  s.ok("migracionMapeos", { mapeos: e.mapeos.map(x => ({ clave: x.clave, confirmado: true })) });
  s.ok("migracionImportar", { fecha: "2026-09-30" });
}

function cajaEjemplo(totalFactura) {
  const c = (fecha, glosa, entradas, salidas, obs) => ({ fecha, glosa, entradas, salidas, obs });
  return [
    c("Fecha", "Glosa", "Entradas", "Salidas", "Obs"),
    c("2025-06-10", "Patrimonio", 335000, "", "Ignacio"),
    c("13-06-2025", "Compras", "", 100000, "Stock | Singles"),
    c(45823, "Compras", "", totalFactura, "Stock | Asmodee $" + totalFactura),
    c("2025-06-20", "Compras", "", 12345, "Stock | Asmodee"),
    c("2025-06-22", "Ventas", 24500, "", "Stock | Singles"),
    c("2025-07-05", "Ventas", 8000, "", "TORNEO"),
    c("2025-07-05", "Ventas", 8000, "", "Torneo"),
    c("2025-07-06", "Ventas", 9000, "", "TORNEO"),
    c("2025-07-05", "Ventas", 5000, "", "Torneo martes"),
    c("2025-07-10", "Ventas", 89000, "", "OC285"),
    c("2025-07-11", "Ventas", 10000, "TUU", "OC171"),
    c("2025-07-12", "Ventas", 5000, "", "OC 171"),
    c("2025-07-14", "Ventas", 20000, "", "OC048"),
    c("2025-07-15", "GAV", "", 25000, "Sueldo | Alex"),
    c("2026-01-01", "Saldo", "", 435532, "a.Saldo 2025"),
    c("2025-07-20", "Compras", "", 6000, "Bazar | Bebidas"),
    c("2025-07-21", "Ventas", 2500, "", "Bazar | Bebidas"),
    c("2025-07-15", "Patrimonio", 32940, "Sleeved - jorney together", "Jaime"),
    c("", "", "", "", ""),
  ].map((f, i) => ({ fila: i + 1, ...f }));
}

test("migración de la caja por partes: seleccionar, migrar, pago de factura, torneos del día y recargar sin duplicar", () => {
  const s = createServer();
  migrarStock(s);
  const fac = s.ok("bootstrap").data.compras.find(c => c.factura === "30th");
  let e = s.ok("cajaCargar", { filas: cajaEjemplo(Math.round(fac.total)) }).result;
  const fila = (n) => e.filas.find(f => f.fila === n);
  const ids = (fn) => e.filas.filter(fn).map(f => f.id);
  assert.deepEqual([e.resumen.filas, e.resumen.pendientes, e.resumen.descartadas], [20, 18, 2]);
  // Destinos propuestos
  assert.deepEqual([fila(4).accionEf, fila(4).destinoEf], ["factura", fac.id], "Asmodee con el total de una factura: se propone esa factura");
  assert.deepEqual([fila(5).accionEf, fila(5).problema], ["factura", "Elige la factura"]);
  assert.deepEqual([fila(3).accionEf, fila(3).destinoEf, fila(3).extraEf], ["movimiento", "compra", "Singles"]);
  assert.equal(fila(16).accionEf, "omitir");
  assert.deepEqual(e.ocSoloErp, ["OC026", "OC300", "OC301", "PR171"], "PR171 no se confunde con OC171");

  // 1) Solo lo de bazar (compras y ventas)
  let r = s.ok("cajaMigrar", { ids: ids(f => /bazar/i.test(f.obs)) }).result;
  assert.deepEqual([r.filas, r.ventasNuevas, r.movimientos], [2, 1, 1]);
  e = s.ok("cajaEstado").data;
  assert.equal(e.resumen.migradas, 2);
  assert.match(fila(17).migrada, /^MOV-/);
  assert.match(fila(18).migrada, /^BAZ-0001/, "el bazar no usa N° de OC");

  // 2) Torneos: los del mismo día quedan en una venta; una tanda posterior se suma a esa venta
  r = s.ok("cajaMigrar", { ids: [fila(7).id, fila(8).id, fila(9).id] }).result;
  assert.equal(r.ventasNuevas, 2);
  e = s.ok("cajaEstado").data;
  r = s.ok("cajaMigrar", { ids: [fila(10).id] }).result;
  assert.deepEqual([r.ventasNuevas, r.lineas], [0, 1]);
  let d = s.ok("bootstrap").data;
  const t5 = d.ventas.find(v => v.fecha === "2025-07-05" && v.lineas.some(l => l.categoria === "Torneo"));
  assert.deepEqual([t5.total, t5.lineas.length, t5.estadoPago], [21000, 3, "pagada"]);
  assert.match(t5.id, /^TOR-/, "los torneos llevan su propio correlativo");

  // 3) Una fila de la OC171 arrastra a la otra; fecha real y ajuste
  e = s.ok("cajaEstado").data;
  r = s.ok("cajaMigrar", { ids: [fila(12).id] }).result;
  assert.deepEqual([r.filas, r.ventasFechadas], [2, 1]);
  d = s.ok("bootstrap").data;
  const v171 = d.ventas.find(v => /OC original OC171\b/.test(v.notas));
  assert.deepEqual([v171.fecha, v171.total, v171.estadoPago], ["2025-07-11", 15000, "pagada"]);

  // 4) Pago de factura: sin factura elegida no se puede; al elegirla se concilia
  e = s.ok("cajaEstado").data;
  assert.match(errorDe(s.call("cajaMigrar", { ids: [fila(4).id, fila(5).id] })), /fila 5 \(Elige la factura\)/);
  e = s.ok("cajaFilas", { filas: [{ id: fila(5).id, accion: "factura", destino: fac.id }] }).result;
  r = s.ok("cajaMigrar", { ids: [fila(4).id, fila(5).id] }).result;
  assert.deepEqual([r.facturas, r.movimientos], [1, 0], "no crea gasto: la factura ya está en el ERP");
  d = s.ok("bootstrap").data;
  assert.match(d.compras.find(c => c.id === fac.id).notas, /Pago caja .*fila 4.*Pago caja .*fila 5/);
  assert.deepEqual(d.pagosFacturas.filter(p => p.compraId === fac.id).map(p => p.monto).sort((a, b) => a - b), [12345, Math.round(fac.total)].sort((a, b) => a - b), "pagos para el flujo de caja");
  e = s.ok("cajaEstado").data;
  assert.equal(e.compras.find(c => c.id === fac.id).pagado, Math.round(fac.total) + 12345);
  // Enlace equivocado: el pago de la fila 5 se pasa a otra factura (y vuelve)
  const otra = d.compras.find(c => c.id !== fac.id && c.porPagar >= 12345);
  const p5 = d.pagosFacturas.find(p => p.origen === "caja" && p.fila === 5);
  assert.match(errorDe(s.call("reenlazarPagoCompra", { origen: "caja", id: p5.id, compraId: fac.id })), /ya está enlazado/);
  s.ok("reenlazarPagoCompra", { origen: "caja", id: p5.id, compraId: otra.id });
  d = s.ok("bootstrap").data;
  assert.equal(d.pagosFacturas.find(p => p.id === p5.id).compraId, otra.id);
  assert.match(d.compras.find(c => c.id === otra.id).notas, /Pago caja .*fila 5/);
  assert.doesNotMatch(d.compras.find(c => c.id === fac.id).notas, /fila 5\)/);
  assert.equal(d.compras.find(c => c.id === otra.id).pagado, p5.monto);
  s.ok("reenlazarPagoCompra", { origen: "caja", id: p5.id, compraId: fac.id });

  // 5) "No migrar": queda descartada
  s.ok("cajaMigrar", { ids: [fila(16).id] });
  e = s.ok("cajaEstado").data;
  assert.equal(fila(16).estado, "descartada");

  // 6) Recargar el mismo Excel no duplica: lo migrado sigue migrado
  e = s.ok("cajaCargar", { filas: cajaEjemplo(Math.round(fac.total)) }).result;
  assert.equal(e.resumen.migradas, 10);
  assert.match(errorDe(s.call("cajaMigrar", { ids: [fila(17).id] })), /al menos una fila pendiente/);
  assert.match(errorDe(s.call("cajaFilas", { filas: [{ id: fila(17).id, descartada: true }] })), /ya se migró/);
  // Limpiar conserva lo migrado
  e = s.ok("cajaLimpiar", {}).result;
  assert.deepEqual([e.resumen.filas, e.resumen.migradas], [10, 10]);

  // El resto pendiente se migra después sin problemas
  e = s.ok("cajaCargar", { filas: cajaEjemplo(Math.round(fac.total)) }).result;
  r = s.ok("cajaMigrar", { ids: e.filas.filter(f => f.estado === "pendiente").map(f => f.id) }).result;
  e = s.ok("cajaEstado").data;
  assert.equal(e.resumen.pendientes, 0);
  d = s.ok("bootstrap").data;
  assert.equal(d.ventas.find(v => /OC original OC048 /.test(v.notas)).total, 20000);
  assert.deepEqual(d.movimientos.filter(m => m.categoria === "aporte").map(m => [m.monto, m.subcategoria, m.notas]).sort(), [[32940, "Jaime", "Sleeved - jorney together"], [335000, "Ignacio", ""]]);
  assert.ok(!d.movimientos.some(m => m.monto === 435532), "el saldo 2025 no se migra");
});

test("ventas por monto y movimientos de Finanzas", () => {
  const s = createServer();
  const { prods } = conInventario(s);
  const v = s.ok("crearVenta", { fecha: "2026-10-05", medioPago: "efectivo", lineas: [
    { productoId: prods.miniTin.id, cantidad: 1 },
    { categoria: "Singles", descripcion: "Charizard ex", monto: 25000 },
  ] }).result;
  assert.equal(v.total, 43000);
  assert.match(errorDe(s.call("crearVenta", { fecha: "2026-10-05", lineas: [{ categoria: "Cualquiera", monto: 1 }] })), /categoría no es válid/);
  const d = s.ok("bootstrap").data;
  const venta = d.ventas.find(x => x.id === v.id);
  assert.deepEqual(venta.lineas.map(l => [l.porMonto, l.producto]), [[false, venta.lineas[0].producto], [true, "Singles · Charizard ex"]]);
  assert.equal(d.lotes.find(l => l.productoId === prods.miniTin.id).disponible, 9, "la línea por monto no toca el inventario");

  const mv = s.ok("guardarMovimiento", { fecha: "2026-10-06", tipo: "egreso", categoria: "gav", subcategoria: "Arriendo", monto: 300000, cuenta: "banco" }).result;
  assert.equal(mv.id, "MOV-00001");
  assert.match(errorDe(s.call("guardarMovimiento", { fecha: "2026-10-06", tipo: "egreso", categoria: "aporte", monto: 1 })), /categoría no es válid/);
  s.ok("guardarMovimiento", { id: mv.id, fecha: "2026-10-06", tipo: "egreso", categoria: "gav", subcategoria: "Arriendo octubre", monto: 310000, cuenta: "banco" });
  s.ok("anularMovimiento", { id: mv.id });
  const m2 = s.ok("bootstrap").data.movimientos[0];
  assert.deepEqual([m2.monto, m2.subcategoria, m2.anulado, m2.cuentaLabel, m2.categoriaLabel], [310000, "Arriendo octubre", true, "Banco", "GAV"]);
});

test("salida sin venta (uso interno): rebaja stock al costo del lote, sin OC, y se anula", () => {
  const s = createServer();
  const { prods } = conInventario(s);
  const antes = s.ok("bootstrap").data;
  assert.match(errorDe(s.call("registrarSalida", { productoId: prods.miniTin.id, cantidad: 11, motivo: "interno", fecha: "2026-10-05" })), /quedan 10/);
  assert.match(errorDe(s.call("registrarSalida", { productoId: prods.miniTin.id, cantidad: 1, motivo: "regalo", fecha: "2026-10-05" })), /motivo/i);
  const r = s.ok("registrarSalida", { productoId: prods.miniTin.id, cantidad: 2, motivo: "interno", fecha: "2026-10-05", notas: "Protectores vitrina" }).result;
  const lt = lote(s, prods.miniTin.id)[0];
  assert.equal(r.costo, Math.round(lt.costo * 2));
  let d = s.ok("bootstrap").data;
  assert.equal(d.ventas.length, antes.ventas.length, "no crea venta ni OC");
  assert.deepEqual(d.salidas.map(x => [x.motivoLabel, x.cantidad, x.notas]), [["Uso interno", 2, "Protectores vitrina"]]);
  assert.equal(d.catalogos.motivosSalida.interno, "Uso interno");
  // No se puede vender lo que salió
  assert.match(errorDe(s.call("crearVenta", { fecha: "2026-10-06", lineas: [{ productoId: prods.miniTin.id, cantidad: 9 }] })), /quedan 8/);
  s.ok("guardarUsuario", { email: "socio@gsprime.cl", nombre: "Socio", rol: "operador" });
  assert.equal(s.as("socio@gsprime.cl").call("anularSalida", { id: r.ids[0] }).code, "SIN_PERMISO");
  s.as("admin@gsprime.cl").ok("anularSalida", { id: r.ids[0] });
  d = s.ok("bootstrap").data;
  assert.equal(d.salidas.length, 0);
  s.ok("crearVenta", { fecha: "2026-10-06", lineas: [{ productoId: prods.miniTin.id, cantidad: 10 }] });
});

test("editar venta: cambiar un concepto por un producto del inventario (quitar y agregar líneas)", () => {
  const s = createServer();
  const { prods } = conInventario(s);
  const v = s.ok("crearVenta", { fecha: "2026-07-01", lineas: [{ productoId: prods.miniTin.id, cantidad: 1 }, { categoria: "Otro", descripcion: "Diferencia con la caja diaria", monto: 30000 }] }).result;
  let venta = s.ok("bootstrap").data.ventas.find(x => x.id === v.id);
  const otro = venta.lineas.find(l => !l.productoId);
  const tin = venta.lineas.find(l => l.productoId);
  assert.match(errorDe(s.call("editarVenta", { id: v.id, fecha: venta.fecha, quitar: [otro.id, tin.id] })), /al menos un producto/);
  assert.match(errorDe(s.call("editarVenta", { id: v.id, fecha: venta.fecha, agregar: [{ productoId: prods.miniTin.id, cantidad: 10 }] })), /quedan 9/);
  // Quitar la diferencia y agregar 1 Binder ENG a $30.000: el total no cambia y sigue pagada
  s.ok("editarVenta", { id: v.id, fecha: venta.fecha, quitar: [otro.id], agregar: [{ productoId: prods.binderEng.id, cantidad: 1, precio: 30000 }] });
  let d = s.ok("bootstrap").data;
  venta = d.ventas.find(x => x.id === v.id);
  assert.deepEqual([venta.total, venta.estadoPago, venta.lineas.length], [v.total, "pagada", 2]);
  assert.ok(venta.lineas.some(l => l.productoId === prods.binderEng.id && l.costo > 0), "con el costo de su lote");
  const disp = (id) => d.lotes.filter(l => l.productoId === id).reduce((t, l) => t + l.disponible, 0);
  assert.equal(disp(prods.binderEng.id), 23);
  // Cambiar el Mini Tin por otro Binder: las unidades del Mini Tin vuelven
  s.ok("editarVenta", { id: v.id, fecha: venta.fecha, quitar: [tin.id], agregar: [{ productoId: prods.binderEsp.id, cantidad: 1, precio: tin.precio }] });
  d = s.ok("bootstrap").data;
  assert.deepEqual([disp(prods.miniTin.id), disp(prods.binderEsp.id), d.ventas.find(x => x.id === v.id).total], [10, 5, v.total]);
  // Una línea de ajuste (ej. "Diferencia con la caja diaria") también se puede quitar
  s.ok("editarVenta", { id: v.id, fecha: venta.fecha, total: v.total + 5000, motivo: "Diferencia con la caja diaria" });
  venta = s.ok("bootstrap").data.ventas.find(x => x.id === v.id);
  const aj = venta.lineas.find(l => l.categoria === "Ajuste");
  assert.equal(venta.total, v.total + 5000);
  s.ok("editarVenta", { id: v.id, fecha: venta.fecha, quitar: [aj.id] });
  venta = s.ok("bootstrap").data.ventas.find(x => x.id === v.id);
  assert.deepEqual([venta.total, venta.estadoPago, venta.lineas.some(l => l.categoria === "Ajuste")], [v.total, "pagada", false]);
});

test("anular venta liberando el N°: la anulada pasa a -ANU y el correlativo se reutiliza", () => {
  const s = createServer();
  const { prods } = conInventario(s);
  const a = s.ok("crearVenta", { fecha: "2026-07-01", lineas: [{ productoId: prods.miniTin.id, cantidad: 1 }] }).result;
  const b = s.ok("crearVenta", { fecha: "2026-07-02", lineas: [{ productoId: prods.miniTin.id, cantidad: 1 }] }).result;
  s.ok("guardarMovimiento", { fecha: "2026-07-02", tipo: "ingreso", categoria: "otro_ingreso", monto: 1000, referencia: b.id });
  assert.match(errorDe(s.call("liberarNumeroVenta", { id: b.id })), /anulada/);
  const r = s.ok("anularVenta", { id: b.id, liberar: true }).result;
  assert.equal(r.id, b.id + "-ANU");
  let d = s.ok("bootstrap").data;
  const anu = d.ventas.find(v => v.id === b.id + "-ANU");
  assert.ok(anu && anu.anulada && anu.lineas.length === 1, "conserva sus líneas");
  assert.equal(d.movimientos[0].referencia, b.id + "-ANU");
  assert.match(errorDe(s.call("liberarNumeroVenta", { id: anu.id })), /ya está liberado/);
  // La próxima venta toma el N° liberado
  const c = s.ok("crearVenta", { fecha: "2026-07-03", lineas: [{ productoId: prods.miniTin.id, cantidad: 1 }] }).result;
  assert.equal(c.id, b.id);
  // Un N° del medio: queda libre para asignarlo con Editar
  s.ok("anularVenta", { id: a.id });
  s.ok("liberarNumeroVenta", { id: a.id });
  const e = s.ok("crearVenta", { fecha: "2026-07-04", lineas: [{ productoId: prods.miniTin.id, cantidad: 1 }] }).result;
  assert.notEqual(e.id, a.id);
  assert.equal(s.ok("editarVenta", { id: e.id, fecha: "2026-07-04", numero: a.id }).result.id, a.id);
  // Liberar dos veces el mismo N°: -ANU2
  s.ok("anularVenta", { id: a.id, liberar: true });
  assert.ok(s.ok("bootstrap").data.ventas.some(v => v.id === a.id + "-ANU2"));
});

test("eliminar una venta anulada (duplicado): se borra con sus líneas y abonos", () => {
  const s = createServer();
  const { prods } = conInventario(s);
  const v = s.ok("crearVenta", { fecha: "2026-07-01", cliente: "Ludi", pagada: false, abono: 1000, lineas: [{ categoria: "Otro", descripcion: "Ludi", monto: 184990 }] }).result;
  s.ok("registrarCobro", { ventaId: v.id, fecha: "2026-07-02", monto: 5000 });
  assert.match(errorDe(s.call("eliminarVenta", { id: v.id })), /Primero anula/);
  s.ok("anularVenta", { id: v.id, liberar: true });
  const anu = v.id + "-ANU";
  s.ok("eliminarVenta", { id: anu });
  const d = s.ok("bootstrap").data;
  assert.ok(!d.ventas.some(x => x.id === anu));
  assert.equal(s.ok("crearVenta", { fecha: "2026-07-03", lineas: [{ productoId: prods.miniTin.id, cantidad: 1 }] }).result.id, v.id, "el N° queda libre");
});
