// Pruebas de la lógica del servidor sobre el simulador de Apps Script.
// Uso: npm run test:erp
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "./helpers.mjs";

function conProducto(server, datos = {}) {
  const res = server.ok("guardarProducto", { nombre: "ETB Journey Together", categoria: "Elite Trainer Box", juego: "Pokémon", precioVenta: 45000, stockMinimo: 2, ...datos });
  return res.result;
}

function conPreventa(server, datos = {}) {
  const prod = datos.productoId ? null : conProducto(server);
  return server.ok("guardarPreventa", {
    productoId: prod?.id, proveedor: "TCG Imports SPA", cantidad: 10, costoUnit: 34000,
    fechaPedido: "2026-09-01", fechaLlegada: "2026-10-15", ...datos,
  }).result;
}

const errorDe = (res) => { assert.equal(res.ok, false, "se esperaba un error"); return res.error; };

test("instalar crea las hojas y registra al primer administrador", () => {
  const s = createServer();
  const nombres = s.fake.state.sheets.map(x => x.name);
  for (const t of ["Usuarios", "Productos", "Preventas", "Pagos", "Movimientos", "Auditoria"]) assert.ok(nombres.includes(t), t);
  const boot = s.ok("bootstrap").data;
  assert.equal(boot.user.email, "admin@gsprime.cl");
  assert.equal(boot.user.rol, "admin");
  // una segunda instalación no duplica usuarios ni da permisos a terceros
  s.as("intruso@gmail.com").run("instalar()");
  assert.equal(s.as("admin@gsprime.cl").ok("bootstrap").data.usuarios.length, 1);
  assert.equal(s.as("intruso@gmail.com").call("bootstrap").code, "NO_AUTORIZADO");
});

test("las fechas se guardan como texto y vuelven iguales", () => {
  const s = createServer();
  const pv = conPreventa(s);
  const boot = s.ok("bootstrap").data;
  const guardada = boot.preventas.find(x => x.id === pv.id);
  assert.equal(guardada.fechaPedido, "2026-09-01");
  assert.equal(guardada.fechaLlegada, "2026-10-15");
  const hoja = s.sheet("Preventas");
  const col = hoja[0].indexOf("fechaLlegada");
  assert.equal(typeof hoja[1][col], "string");
});

test("lee bien fechas que Sheets convirtió a Date (por ejemplo, editadas a mano)", () => {
  const s = createServer();
  const pv = conPreventa(s);
  const hoja = s.fake.state.sheets.find(x => x.name === "Preventas");
  const col = hoja.values[0].indexOf("fechaLlegada");
  hoja.values[1][col] = new Date("2026-12-24T00:00:00Z");
  assert.equal(s.ok("bootstrap").data.preventas.find(x => x.id === pv.id).fechaLlegada, "2026-12-24");
});

test("un texto que empieza con = se guarda como texto, no como fórmula", () => {
  const s = createServer();
  const pv = conPreventa(s, { notas: "=IMPORTXML(\"http://x\")" });
  assert.equal(s.ok("bootstrap").data.preventas.find(x => x.id === pv.id).notas, "=IMPORTXML(\"http://x\")");
});

test("productos: SKU automático, nombres únicos y validaciones", () => {
  const s = createServer();
  const a = conProducto(s);
  assert.equal(a.sku, "GS-0001");
  const b = conProducto(s, { nombre: "Booster Box Destined Rivals" });
  assert.equal(b.sku, "GS-0002");
  assert.match(errorDe(s.call("guardarProducto", { nombre: "etb journey  together" })), /Ya existe/);
  assert.match(errorDe(s.call("guardarProducto", { nombre: "X", sku: "gs-0001" })), /SKU GS-0001 ya está en uso/);
  assert.match(errorDe(s.call("guardarProducto", { nombre: "" })), /nombre es obligatorio/);
  assert.match(errorDe(s.call("guardarProducto", { nombre: "Y", precioVenta: -5 })), /mayor o igual a 0/);
  assert.match(errorDe(s.call("guardarProducto", { nombre: "Y", categoria: "Inventada" })), /categoría no es válido/);
  const editado = s.ok("guardarProducto", { id: a.id, nombre: "ETB Journey Together", precioVenta: 47000, categoria: "Elite Trainer Box" }).result;
  assert.equal(editado.sku, "GS-0001", "al editar sin SKU se conserva el existente");
  assert.equal(editado.precioVenta, 47000);
});

test("preventa: folio correlativo, total, abono inicial y estado de pago", () => {
  const s = createServer();
  const prod = conProducto(s);
  const pv1 = conPreventa(s, { productoId: prod.id, abonoInicial: 100000 });
  const pv2 = conPreventa(s, { productoId: prod.id });
  assert.equal(pv1.folio, "PV-0001");
  assert.equal(pv2.folio, "PV-0002");
  const boot = s.ok("bootstrap").data;
  const v1 = boot.preventas.find(x => x.id === pv1.id);
  assert.deepEqual([v1.total, v1.abonado, v1.saldo, v1.estadoPago], [340000, 100000, 240000, "parcial"]);
  assert.equal(boot.preventas.find(x => x.id === pv2.id).estadoPago, "pendiente");
  assert.equal(boot.productos[0].entrante, 20);
  assert.deepEqual(boot.proveedores, ["TCG Imports SPA"]);
});

test("preventa: validaciones de negocio", () => {
  const s = createServer();
  const prod = conProducto(s);
  const base = { productoId: prod.id, proveedor: "P", cantidad: 2, costoUnit: 1000, fechaPedido: "2026-09-01", fechaLlegada: "2026-09-10" };
  assert.match(errorDe(s.call("guardarPreventa", { ...base, cantidad: 0 })), /cantidad debe ser mayor o igual a 1/);
  assert.match(errorDe(s.call("guardarPreventa", { ...base, cantidad: 1.5 })), /entero/);
  assert.match(errorDe(s.call("guardarPreventa", { ...base, fechaLlegada: "" })), /llegada es obligatoria/);
  assert.match(errorDe(s.call("guardarPreventa", { ...base, fechaLlegada: "2026-02-30" })), /no es una fecha válida/);
  assert.match(errorDe(s.call("guardarPreventa", { ...base, fechaLlegada: "2026-08-01" })), /anterior a la fecha de pedido/);
  assert.match(errorDe(s.call("guardarPreventa", { ...base, abonoInicial: 5000 })), /abono inicial no puede superar/);
  assert.match(errorDe(s.call("guardarPreventa", { ...base, productoId: "nope" })), /producto no existe/);
  assert.match(errorDe(s.call("guardarPreventa", { ...base, estado: "recibida" })), /estado no es válido/);
});

test("pagos: no superan el saldo y el total no puede bajar de lo abonado", () => {
  const s = createServer();
  const pv = conPreventa(s, { cantidad: 2, costoUnit: 10000 });
  s.ok("registrarPago", { preventaId: pv.id, monto: 15000, fecha: "2026-09-02", medio: "Transferencia" });
  assert.match(errorDe(s.call("registrarPago", { preventaId: pv.id, monto: 6000 })), /supera el saldo pendiente \(5000\)/);
  s.ok("registrarPago", { preventaId: pv.id, monto: 5000 });
  const boot = s.ok("bootstrap").data;
  assert.equal(boot.preventas[0].estadoPago, "pagado");
  assert.equal(boot.pagos.length, 2);
  assert.match(errorDe(s.call("guardarPreventa", { ...pv, cantidad: 1 })), /menor a lo ya abonado/);
});

test("recepción: entra al inventario al costo de la preventa y cierra la preventa", () => {
  const s = createServer();
  const pv = conPreventa(s, { cantidad: 10, costoUnit: 34000 });
  s.ok("recibirPreventa", { id: pv.id, cantidadRecibida: 8, fecha: "2026-10-14", nota: "Allocation recortada" });
  const boot = s.ok("bootstrap").data;
  const recibida = boot.preventas[0];
  assert.deepEqual([recibida.estado, recibida.cantidadRecibida, recibida.fechaRecepcion], ["recibida", 8, "2026-10-14"]);
  assert.match(recibida.notas, /Allocation recortada/);
  const prod = boot.productos[0];
  assert.deepEqual([prod.stock, prod.costoPromedio, prod.valor, prod.entrante], [8, 34000, 272000, 0]);
  assert.equal(boot.movimientos[0].tipo, "entrada_preventa");
  assert.match(errorDe(s.call("recibirPreventa", { id: pv.id, cantidadRecibida: 1 })), /ya fue recibida/);
  // en una preventa cerrada solo se editan las notas
  s.ok("guardarPreventa", { ...pv, cantidad: 99, notas: "Revisado" });
  const cerrada = s.ok("bootstrap").data.preventas[0];
  assert.equal(cerrada.cantidad, 10);
  assert.equal(cerrada.notas, "Revisado");
});

test("recepción: no se puede recibir más de lo pedido", () => {
  const s = createServer();
  const pv = conPreventa(s, { cantidad: 3 });
  assert.match(errorDe(s.call("recibirPreventa", { id: pv.id, cantidadRecibida: 4 })), /no puede ser mayor a 3/);
});

test("costo promedio ponderado con entradas, salidas y ajustes", () => {
  const s = createServer();
  const prod = conProducto(s);
  s.ok("registrarMovimiento", { productoId: prod.id, tipo: "entrada", cantidad: 10, costoUnit: 30000, fecha: "2026-09-01" });
  s.ok("registrarMovimiento", { productoId: prod.id, tipo: "entrada", cantidad: 10, costoUnit: 40000, fecha: "2026-09-05" });
  let p = s.ok("bootstrap").data.productos[0];
  assert.deepEqual([p.stock, p.costoPromedio, p.valor], [20, 35000, 700000]);

  s.ok("registrarMovimiento", { productoId: prod.id, tipo: "salida", cantidad: 5, fecha: "2026-09-06", nota: "Venta tienda" });
  p = s.ok("bootstrap").data.productos[0];
  assert.deepEqual([p.stock, p.costoPromedio, p.valor], [15, 35000, 525000]);

  assert.match(errorDe(s.call("registrarMovimiento", { productoId: prod.id, tipo: "salida", cantidad: 16, nota: "x" })), /Stock insuficiente: hay 15/);
  assert.match(errorDe(s.call("registrarMovimiento", { productoId: prod.id, tipo: "salida", cantidad: 1 })), /motivo de la salida/);
  assert.match(errorDe(s.call("registrarMovimiento", { productoId: prod.id, tipo: "ajuste", stockContado: 15, nota: "x" })), /no hay nada que ajustar/);

  s.ok("registrarMovimiento", { productoId: prod.id, tipo: "ajuste", stockContado: 13, fecha: "2026-09-07", nota: "Conteo mensual" });
  const boot = s.ok("bootstrap").data;
  p = boot.productos[0];
  assert.deepEqual([p.stock, p.costoPromedio], [13, 35000]);
  const ajuste = boot.movimientos.find(m => m.tipo === "ajuste");
  assert.deepEqual([ajuste.cantidad, ajuste.costoUnit, ajuste.saldo], [-2, 35000, 13]);
});

test("anular recepción revierte el stock, y no se puede si ya salieron las unidades", () => {
  const s = createServer();
  const pv = conPreventa(s, { cantidad: 4, costoUnit: 1000 });
  s.ok("recibirPreventa", { id: pv.id, cantidadRecibida: 4 });
  s.ok("registrarMovimiento", { productoId: pv.productoId, tipo: "salida", cantidad: 1, nota: "Venta" });
  assert.match(errorDe(s.call("anularRecepcion", { id: pv.id })), /ya salieron/);
  const salida = s.ok("bootstrap").data.movimientos.find(m => m.tipo === "salida_manual");
  s.ok("eliminarMovimiento", { id: salida.id });
  s.ok("anularRecepcion", { id: pv.id });
  const boot = s.ok("bootstrap").data;
  assert.equal(boot.productos[0].stock, 0);
  assert.equal(boot.preventas[0].estado, "transito");
  assert.equal(boot.movimientos.length, 0);
});

test("cancelar y eliminar preventas", () => {
  const s = createServer();
  const pv = conPreventa(s, { abonoInicial: 1000 });
  assert.match(errorDe(s.call("eliminarPreventa", { id: pv.id })), /tiene abonos/);
  assert.match(errorDe(s.call("cancelarPreventa", { id: pv.id })), /motivo es obligatorio/);
  s.ok("cancelarPreventa", { id: pv.id, motivo: "Proveedor sin stock" });
  const boot = s.ok("bootstrap").data;
  assert.equal(boot.preventas[0].estado, "cancelada");
  assert.equal(boot.productos[0].entrante, 0);
  assert.match(errorDe(s.call("registrarPago", { preventaId: pv.id, monto: 1 })), /cancelada/);

  const otra = conPreventa(s, { productoId: pv.productoId });
  s.ok("eliminarPreventa", { id: otra.id });
  assert.equal(s.ok("bootstrap").data.preventas.length, 1);
});

test("productos con historial no se eliminan; con stock no se archivan", () => {
  const s = createServer();
  const pv = conPreventa(s, { cantidad: 1 });
  assert.match(errorDe(s.call("eliminarProducto", { id: pv.productoId })), /archívalo/);
  s.ok("recibirPreventa", { id: pv.id, cantidadRecibida: 1 });
  assert.match(errorDe(s.call("archivarProducto", { id: pv.productoId, activo: false })), /con stock/);
  const libre = conProducto(s, { nombre: "Sleeves Dragon Shield" });
  s.ok("archivarProducto", { id: libre.id, activo: false });
  assert.match(errorDe(s.call("guardarPreventa", { productoId: libre.id, proveedor: "P", cantidad: 1, costoUnit: 1, fechaLlegada: "2030-01-01" })), /archivado/);
  s.ok("eliminarProducto", { id: libre.id });
});

test("roles: lectura solo consulta, operador opera, admin administra", () => {
  const s = createServer();
  s.ok("guardarUsuario", { email: "Socio@GSPrime.cl", nombre: "Socio", rol: "operador" });
  s.ok("guardarUsuario", { email: "vista@gsprime.cl", nombre: "Vista", rol: "lectura" });
  const pv = conPreventa(s, { abonoInicial: 1000 });

  s.as("vista@gsprime.cl");
  assert.equal(s.ok("bootstrap").data.usuarios.length, 0, "no-admin no ve usuarios");
  assert.equal(s.call("guardarProducto", { nombre: "X" }).code, "SIN_PERMISO");

  s.as("socio@gsprime.cl");
  s.ok("registrarPago", { preventaId: pv.id, monto: 500 });
  assert.equal(s.call("eliminarPago", { id: s.ok("bootstrap").data.pagos[0].id }).code, "SIN_PERMISO");
  assert.equal(s.call("guardarUsuario", { email: "a@b.cl", nombre: "A", rol: "admin" }).code, "SIN_PERMISO");
  assert.equal(s.call("auditoria").code, "SIN_PERMISO");

  s.as("admin@gsprime.cl");
  s.ok("guardarUsuario", { email: "socio@gsprime.cl", nombre: "Socio", rol: "operador", activo: false });
  assert.equal(s.as("socio@gsprime.cl").call("bootstrap").code, "NO_AUTORIZADO");
});

test("debe quedar al menos un administrador activo", () => {
  const s = createServer();
  assert.match(errorDe(s.call("guardarUsuario", { email: "admin@gsprime.cl", nombre: "Admin", rol: "operador" })), /al menos un administrador/);
  assert.match(errorDe(s.call("guardarUsuario", { email: "no-es-correo", nombre: "X", rol: "operador" })), /correo no es válido/);
});

test("auditoría registra quién hizo cada cambio", () => {
  const s = createServer();
  const pv = conPreventa(s);
  s.ok("guardarPreventa", { ...pv, cantidad: 12 });
  const log = s.ok("auditoria").data;
  const edicion = log.find(x => x.accion === "editar" && x.entidad === "Preventa");
  assert.equal(edicion.usuario, "admin@gsprime.cl");
  assert.deepEqual(JSON.parse(edicion.detalle), { cantidad: [10, 12] });
  assert.ok(log.some(x => x.accion === "crear" && x.entidad === "Producto"));
});

test("importa las preventas del ERP anterior", () => {
  const s = createServer();
  const legacy = [
    { id: "pv_1", producto: "Booster Box Prismatic Evolutions", proveedor: "Distribuidora Central", cantidad: 6, costoUnit: 52000, abono: 150000, precioVenta: 68000, fechaPedido: "2026-09-01", fechaLlegada: "2026-10-03", estado: "parcial", notas: "Reserva por WhatsApp" },
    { id: "pv_2", producto: "ETB Twilight Masquerade", proveedor: "Cartas Import", cantidad: 8, costoUnit: 36000, abono: 288000, precioVenta: 47000, fechaPedido: "2026-08-10", fechaLlegada: "2026-09-10", estado: "recibido", notas: "" },
    { id: "pv_3", producto: "booster box prismatic evolutions", proveedor: "Otro", cantidad: 1, costoUnit: 50000, abono: 0, fechaPedido: "2026-09-02", fechaLlegada: "2026-10-01", estado: "transito" },
    { id: "pv_4", producto: "Mal", proveedor: "", cantidad: 1, costoUnit: 1, fechaLlegada: "2026-10-01", estado: "pendiente" },
  ];
  const res = s.ok("importarLegacy", { json: JSON.stringify(legacy) });
  assert.equal(res.result.importadas, 3);
  assert.equal(res.result.errores.length, 1);
  assert.match(res.result.errores[0], /Fila 4 \(Mal\): El proveedor es obligatorio/);
  const boot = res.data;
  assert.equal(boot.productos.filter(p => p.nombre !== "Mal").length, 2, "reutiliza el producto por nombre");
  const recibida = boot.preventas.find(p => p.producto === "ETB Twilight Masquerade");
  assert.deepEqual([recibida.estado, recibida.estadoPago, recibida.cantidadRecibida], ["recibida", "pagado", 8]);
  assert.equal(boot.productos.find(p => p.nombre === "ETB Twilight Masquerade").stock, 8);
  assert.equal(boot.preventas.find(p => p.proveedor === "Otro").estado, "transito");
  assert.match(errorDe(s.call("importarLegacy", { json: "no es json" })), /JSON válido/);
});

test("las respuestas de la API se pueden serializar (google.script.run no acepta Date)", () => {
  const s = createServer();
  conPreventa(s);
  const raw = s.run("api('bootstrap', {})");
  const hayDate = JSON.stringify(raw, function (k, v) { if (Object.prototype.toString.call(this[k]) === "[object Date]") throw new Error("Date en " + k); return v; });
  assert.ok(hayDate.length > 0);
  assert.equal(s.call("accionInexistente").ok, false);
});

test("inserta más filas que las disponibles en la hoja", () => {
  const s = createServer();
  const hoja = s.fake.state.sheets.find(x => x.name === "Auditoria");
  hoja.maxRows = 3;
  conProducto(s);
  conProducto(s, { nombre: "Otro producto" });
  assert.ok(hoja.maxRows >= 4);
});
