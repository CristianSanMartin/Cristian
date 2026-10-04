// Prueba end-to-end de la interfaz sobre la vista previa local (erp/dist/preview.html).
// Requiere generarla antes: npm run erp:preview (npm run test:erp lo hace solo).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { ERP } from "../dev/sources.mjs";

const PREVIEW = path.join(ERP, "dist", "preview.html");
const url = (user = "admin@gsprime.cl") => "file://" + PREVIEW + "?delay=0&user=" + encodeURIComponent(user);
const skip = !fs.existsSync(PREVIEW);

async function abrir(browser, opts = {}) {
  const page = await browser.newPage({ viewport: opts.viewport || { width: 1400, height: 950 } });
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  await page.goto(url(opts.user));
  await page.waitForSelector("#app:not(.hidden)");
  return { page, errores };
}

const modal = (page) => page.locator("#modal-root .modal-overlay").last();
const cerrado = (page) => page.waitForSelector("#modal-root .modal-overlay", { state: "detached" });
const toast = async (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById("toast-msg").textContent), re.source);

test("preventas como carrito: agregar productos uno a uno, asignar en la tabla y en bloque", { skip }, async () => {
  const browser = await chromium.launch();
  try {
    const { page, errores } = await abrir(browser);
    await page.click('[data-nav="preventas"]');
    const form = page.locator("#agregar-preventa");
    assert.equal(await form.locator('select[name="proveedorId"] option:checked').textContent(), "Asmodee", "lista de proveedores con Asmodee por defecto");

    // Sin lista desplegable ni botón "Nuevo": el producto se escribe
    assert.equal(await form.locator('select[name="productoId"], [data-action="nuevoProductoPv"]').count(), 0);

    // Error visible en el mismo formulario
    await form.locator('button[type="submit"]').click();
    await form.locator(".form-error.show").waitFor();
    assert.match(await form.locator(".form-error").textContent(), /producto es obligatorio/);

    // Cualquier formato: se muestra en formato título y el idioma con su color (ESP verde, ENG azul)
    await form.locator('[name="producto"]').fill("pokemon tcg destined rivals - ELITE trainer box esp");
    assert.match(await form.locator("[data-producto]").textContent(), /Destined Rivals – Elite Trainer Box ESP/);
    assert.equal(await form.locator("[data-lang-badge]").getAttribute("class"), "lang-badge lang-ESP");
    await form.locator('[name="producto"]').fill("pokemon tcg 30th celebration - mini tin ING");
    assert.equal(await form.locator("[data-lang-badge]").getAttribute("class"), "lang-badge lang-ENG");

    // Nombre nuevo tal como viene de Asmodee: se interpreta y se crea al agregar
    await form.locator('[name="producto"]').fill("POKEMON TCG SURGING SPARKS - BOOSTER BOX ENGLISH");
    assert.match(await form.locator("[data-producto]").textContent(), /Surging Sparks – Booster Box ENG · Booster Box.*producto nuevo/);
    await form.locator('[name="lanzamiento"]').fill("2030-11-08");
    await form.locator('[name="solicitado"]').fill("20");
    await form.locator('[name="costoNeto"]').fill("120000");
    await form.locator('[name="pvp"]').fill("189990");
    // Imagen elegida desde el computador (PNG 1x1)
    await form.locator("[data-img-input]").setInputFiles({ name: "surging.png", mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") });
    await form.locator("[data-img-hint]", { hasText: "lista para guardar" }).waitFor();
    assert.match(await form.locator("[data-calc]").textContent(), /Total neto \$2\.400\.000.*Ganancia real \$39\.655/);
    await form.locator('button[type="submit"]').click();
    await toast(page, /PVI-\d{6} agregada/);
    const PV1 = (await page.textContent("#toast-msg")).match(/PVI-\d{6}/)[0];

    // La fecha se mantiene para el siguiente producto; no hay campo proforma
    assert.equal(await form.locator('[name="proforma"]').count(), 0);
    assert.equal(await form.locator('[name="lanzamiento"]').inputValue(), "2030-11-08");
    assert.equal(await form.locator('[name="producto"]').inputValue(), "");
    // Producto que ya existe, escrito como aparece en el catálogo
    await form.locator('[name="producto"]').fill("Destined Rivals – Booster Box · ENG");
    await form.locator('[name="producto"]').dispatchEvent("change");
    assert.match(await form.locator("[data-producto]").textContent(), /GS-\d{4}/);
    assert.doesNotMatch(await form.locator("[data-producto]").textContent(), /producto nuevo/);
    assert.equal(await form.locator('[name="pvp"]').inputValue(), "189990", "precarga el precio sugerido del catálogo");
    await form.locator('[name="solicitado"]').fill("5");
    await form.locator('[name="costoNeto"]').fill("118000");
    await form.locator('button[type="submit"]').click();
    await page.waitForFunction((a) => /PVI-\d{6} agregada/.test(document.getElementById("toast-msg").textContent) && !document.getElementById("toast-msg").textContent.includes(a), PV1);
    const PV2 = (await page.textContent("#toast-msg")).match(/PVI-\d{6}/)[0];
    // La tabla no muestra el PVI: solo el nombre y, debajo, la edición
    assert.doesNotMatch(await page.locator("#pv-tbody").textContent(), /PVI-0000/);

    // Sin grupos por lanzamiento: la fecha es una columna antes de "Cant." y el estado va primero
    assert.equal(await page.locator("#pv-tbody tr.group-row").count(), 0);
    const titulos = (await page.locator("#pv-thead th").allTextContents()).map((t) => t.replace(/[▾▲▼⧩]/g, "").trim());
    assert.deepEqual(titulos.slice(0, 6), ["", "Estado", "", "Producto", "Lanzamiento", "Cant."]);
    // Cada título con datos tiene su flecha de orden y filtro
    assert.equal(await page.locator("#pv-thead .th-menu").count(), titulos.filter(Boolean).length);

    // Filtrar la columna Lanzamiento como en Excel
    const menu = (col) => page.click(`[data-action="menuColumna"][data-id="preventas|${col}"]`);
    await menu("lanzamiento");
    await page.locator(".col-menu [data-todos]").uncheck();
    // Fechas en árbol año → mes → día: el buscador abre el mes y muestra el día
    await page.fill(".col-menu .col-menu-buscar", "08-11-2030");
    await page.locator('.col-menu .col-menu-lista input[value="08-11-2030"]').check();
    await page.click(".col-menu [data-aplicar]");
    const fila = (id) => page.locator(`#pv-tbody tr[data-pv="${id}"]`);
    assert.equal(await page.locator("#pv-tbody tr").count(), 2);
    const activos = await page.locator("#pv-thead .th-menu.activo").evaluateAll((b) => b.map((x) => x.dataset.id));
    assert.deepEqual(activos, ["preventas|estado", "preventas|lanzamiento"], "Estado viene filtrado por defecto (por comprar)");
    // El aviso de despacho del pedido queda en la franja "Pedidos por lanzamiento"
    const pedido = page.locator('.pedido-chip[data-pedido="2030-11-08"]');
    assert.match(await pedido.textContent(), /Pedido \$2\.990\.000 neto.*Despacho gratis/);

    // Ordenar por Cant. descendente
    await menu("cant");
    await page.click('.col-menu [data-orden="desc"]');
    assert.equal(await page.locator("#pv-tbody tr").first().getAttribute("data-pv"), PV1);
    await menu("cant");
    await page.click('.col-menu [data-orden="asc"]');
    assert.equal(await page.locator("#pv-tbody tr").first().getAttribute("data-pv"), PV2);

    // Nuevo cant. en la tabla: queda pendiente hasta guardar
    await fila(PV1).locator("[data-asig]").fill("6");
    await page.waitForSelector("text=1 cantidad asignada sin guardar");
    await page.click('[data-action="guardarAsignaciones"]');
    await toast(page, /Asignación guardada/);
    assert.match(await fila(PV1).textContent(), /Asignada/);
    assert.match(await pedido.textContent(), /Pedido \$1\.310\.000 neto/);

    // Precio de venta: vacío muestra el sugerido en gris; al escribirlo queda como precio propio
    const precio = fila(PV1).locator("[data-precio]");
    assert.equal(await precio.inputValue(), "");
    assert.equal(await precio.getAttribute("placeholder"), "189.990");
    assert.match(await fila(PV1).textContent(), /el sugerido/);
    await precio.fill("199990");
    await page.waitForSelector("text=1 precio de venta sin guardar");
    // Es del producto: otro producto no cambia
    assert.equal(await fila(PV2).locator("[data-precio]").inputValue(), "");
    await precio.press("Enter");
    await toast(page, /Precio de venta guardado/);
    assert.match(await fila(PV1).textContent(), /precio propio/);
    // Borrarlo vuelve al sugerido
    await fila(PV1).locator("[data-precio]").fill("");
    await page.click('[data-action="guardarPrecios"]');
    await toast(page, /Precio de venta guardado/);
    assert.match(await fila(PV1).textContent(), /el sugerido/);

    // En bloque: seleccionar y marcar sin asignación
    await fila(PV2).locator("[data-sel]").check();
    await page.click('[data-action="sinAsignacion"]');
    await toast(page, /Marcadas sin asignación/);
    assert.equal(await fila(PV2).count(), 0, "el filtro de Estado por defecto oculta las sin asignación");
    assert.match(await pedido.textContent(), /Pedido \$720\.000 neto.*faltan \$280\.000 para despacho gratis/);

    // La imagen subida se muestra en la preventa (ya no hay pestaña de catálogo)
    assert.equal(await page.locator('[data-nav="productos"]').count(), 0);
    const src = await fila(PV1).locator("img.thumb").getAttribute("src");
    assert.match(src, /^data:image\/jpeg;base64,/);

    assert.deepEqual(errores, []);
  } finally {
    await browser.close();
  }
});

test("factura de compra: las preventas seleccionadas pasan a Compras e Inventario con el despacho prorrateado", { skip }, async () => {
  const browser = await chromium.launch();
  try {
    const { page, errores } = await abrir(browser);
    await page.click('[data-nav="preventas"]');
    const fila = (id) => page.locator(`#pv-tbody tr[data-pv="${id}"]`);

    // Una preventa solo solicitada no se puede facturar
    await fila("PVI-000006").locator("[data-sel]").check();
    await page.click('[data-action="abrirFactura"]');
    assert.match(await page.locator("#crear-factura").textContent(), /Solo se facturan preventas asignadas.*Ditto Premium Collection ENG/);
    await fila("PVI-000006").locator("[data-sel]").uncheck();

    // Carrito: tres preventas asignadas del mismo lanzamiento
    for (const id of ["PVI-000001", "PVI-000002", "PVI-000003"]) await fila(id).locator("[data-sel]").check();
    await page.click('[data-action="abrirFactura"]');
    const panel = page.locator("#crear-factura");
    assert.match(await panel.locator("[data-despacho-hint]").textContent(), /Corresponde \$15\.000: faltan \$141\.090 para despacho gratis/);
    assert.match(await panel.locator("tfoot").textContent(), /Neto\$873\.910.*IVA 19%\$166\.043.*Total factura\$1\.039\.953/);
    // Como la factura de Asmodee: el despacho es una fila más
    assert.match(await panel.locator("tbody tr.item-despacho").textContent(), /Despacho1\$15\.000\$15\.000/);
    // Aquí, como en la factura: sin columnas de prorrateo (eso se ve en Compras e Inventario)
    assert.doesNotMatch(await panel.locator("thead").textContent(), /prorrateado/i);

    await panel.locator('button[type="submit"]').click();
    await panel.locator(".form-error.show").waitFor();
    assert.match(await panel.locator(".form-error").textContent(), /N° de factura es obligatorio/);
    await panel.locator('[name="factura"]').fill("30th2");
    await panel.locator('button[type="submit"]').click();
    await toast(page, /Factura 30th2 registrada: 3 productos pasaron a Inventario/);

    // Queda en Compras con el detalle abierto: productos, despacho como ítem y totales
    assert.equal(await page.locator('.nav-item.active').getAttribute("data-nav"), "compras");
    assert.doesNotMatch(await page.locator("#cp-tbody").textContent(), /CP-000/, "no se muestra el correlativo interno CP");
    const detalle = page.locator(".detalle-compra");
    assert.match(await detalle.textContent(), /Binder Collection.*Mini Tin.*Despacho.*\$15\.000.*Total factura\$1\.039\.953/s);
    // El despacho prorrateado no se muestra como columna: queda incluido en el costo unidad
    assert.doesNotMatch(await detalle.textContent(), /Despacho prorrateado/);
    assert.match(await detalle.textContent(), /incluido en el costo/);
    assert.match(await page.locator("#cp-tbody tr.fila-compra", { hasText: "30th2" }).textContent(), /Asmodee.*30th2.*3.*40.*\$873\.910.*\$166\.043.*\$1\.039\.953.*0 \/ 40.*\$0.*Sin ventas/s);
    // Sin columnas de neto productos ni despacho; primero fecha, proveedor y factura
    const titulosCp = (await page.locator("#cp-thead th").allTextContents()).map((t) => t.replace(/[▾▲▼⧩]/g, "").trim());
    assert.deepEqual(titulosCp.slice(1, 4), ["Fecha", "Proveedor", "Factura"]);
    assert.ok(!titulosCp.includes("Neto productos") && !titulosCp.includes("Despacho"));
    assert.ok(titulosCp.includes("Ventas acumuladas") && titulosCp.includes("Ganancia acumulada"));

    // Las preventas salen de "por comprar" y el producto está en Inventario con su costo real
    await page.click('[data-nav="preventas"]');
    assert.equal(await fila("PVI-000001").count(), 0);
    await page.click('[data-nav="inventario"]');
    // Un pool por producto (sin factura ni fecha); costo = $8.230 + $144 de despacho = $8.374
    assert.equal(await page.locator('[data-action="modoInventario"]').count(), 0);
    const tin = page.locator("#inv-tbody tr.fila-compra", { hasText: "Mini Tin" });
    // Costo c/IVA = (8.230 + 144) × 1,19 = 9.965, con el desglose neto + despacho + IVA.
    assert.match(await tin.textContent(), /10.*\$9\.965\$8\.230 \+ \$144 desp\. \+ \$1\.591 IVA/s);
    assert.doesNotMatch(await page.locator("#inv-thead").textContent(), /Factura|Fecha/);
    // La flecha despliega el lote unidad por unidad, como la planilla
    await tin.click();
    const unidades = page.locator("#inv-tbody .detalle-compra tbody tr");
    assert.equal(await unidades.count(), 10);
    assert.match(await unidades.first().textContent(), /1 \/ 10.*Disponible/s);

    // Anular (administrador) devuelve las preventas a asignadas
    await page.click('[data-nav="compras"]');
    await page.locator("#cp-tbody tr.fila-compra", { hasText: "30th2" }).locator('[data-action="anularCompra"]').click();
    await modal(page).locator(".btn.danger, [data-confirm]").first().click();
    await toast(page, /Factura 30th2 anulada/);
    await page.click('[data-nav="preventas"]');
    assert.match(await fila("PVI-000001").textContent(), /Asignada/);
    assert.deepEqual(errores, []);
  } finally {
    await browser.close();
  }
});

test("venta desde Inventario: cantidad en la fila, descuento, comisión TUU, stock y acumulado en la factura", { skip }, async () => {
  const browser = await chromium.launch();
  try {
    const { page, errores } = await abrir(browser);
    await page.click('[data-nav="inventario"]');
    const deckEng = page.locator('#inv-tbody tr[data-producto]', { hasText: "Battle Deck" }).filter({ has: page.locator(".lang-ENG") });
    // Sin panel de venta hasta agregar algo
    assert.equal(await page.locator("#nueva-venta").count(), 0);
    // Cantidad en la fila: no despliega el producto y no deja pasar el stock (quedan 9)
    await deckEng.locator("[data-cant-prod]").fill("20");
    assert.equal(await page.locator("#inv-tbody .detalle-compra").count(), 0);
    await deckEng.locator('[data-action="agregarProductoVenta"]').click();
    await toast(page, /9 unidades agregadas a la venta/);
    await page.click('[data-action="vaciarCarrito"]');
    assert.equal(await page.locator("#nueva-venta").count(), 0);

    await deckEng.locator("[data-cant-prod]").fill("2");
    await deckEng.locator("[data-cant-prod]").press("Enter");
    await toast(page, /2 unidades agregadas a la venta/);
    const form = page.locator("#nueva-venta");
    assert.equal(await form.locator('select[name="canal"]').inputValue(), "Tienda");
    // Descuento en la línea: 26.990 → 24.990
    await form.locator("[data-carrito-precio]").fill("24990");
    assert.match(await form.locator("[data-nv-totales]").textContent(), /Total\$49\.980.*Descuentos\$4\.000.*Comisión TUU\$450/);
    // Por cobrar sin cliente no se permite
    await form.locator('[name="pagada"]').uncheck();
    await form.locator('button[type="submit"]').click();
    await form.locator(".form-error.show").waitFor();
    assert.match(await form.locator(".form-error").textContent(), /necesita un cliente/);
    await form.locator('[name="pagada"]').check();
    await form.locator('[name="cliente"]').fill("maria soto");
    await form.locator('button[type="submit"]').click();
    await toast(page, /OC-\d{4} registrada · \$49\.980/);
    // Se queda en Inventario, sin panel, con el stock rebajado
    assert.equal(await page.locator('.nav-item.active').getAttribute("data-nav"), "inventario");
    assert.equal(await page.locator("#nueva-venta").count(), 0);
    assert.match(await deckEng.textContent(), /12.*5.*7/s);
    await deckEng.click();
    assert.match(await page.locator("#inv-tbody .detalle-compra").textContent(), /OC-\d{4}.*Maria Soto/s);

    // La factura de compra acumula lo vendido
    await page.click('[data-nav="compras"]');
    assert.match(await page.locator("#cp-tbody tr.fila-compra", { hasText: "30th-DECK" }).textContent(), /6 \/ 24.*Vendiendo/s);

    // Tablero de Ventas: la OC aparece en la lista del mes y en el ranking
    await page.click('[data-nav="ventas"]');
    assert.equal(await page.locator("#nueva-venta").count(), 0, "Ventas es informativo: sin formulario");
    const fila = page.locator("#vt-tbody tr.fila-compra", { hasText: "Maria Soto" });
    assert.match(await fila.textContent(), /Tienda.*Débito.*2.*\$49\.980.*\$450.*Pagada/s);
    assert.match(await page.locator(".dash-card", { hasText: "Mejores clientes del mes" }).textContent(), /Maria Soto.*\$49\.980/s);
    assert.ok(await page.locator("svg.grafico").count() >= 2, "gráficos de ventas vs compras y por día");
    assert.match(await page.locator(".resumen-mensual").textContent(), /Ventas.*Compras.*Ventas − compras/s);

    // Cobranza en Clientes: Ana Rojas debe $16.990 del ejemplo
    await page.click('[data-nav="clientes"]');
    const ana = page.locator("#cl-tbody tr.fila-compra", { hasText: "Ana Rojas" });
    assert.match(await ana.textContent(), /\$16\.990/);
    await ana.click();
    await page.locator('#cl-tbody .abono-form button[type="submit"]').click();
    await toast(page, /Abono registrado/);
    assert.doesNotMatch(await page.locator("#cl-tbody tr.fila-compra", { hasText: "Ana Rojas" }).textContent(), /\$16\.990/);
    assert.match(await page.locator("#cl-tbody tr.fila-compra", { hasText: "Maria Soto" }).textContent(), /1.*\$49\.980/s);
    assert.deepEqual(errores, []);
  } finally {
    await browser.close();
  }
});

test("inventario: se marcan unidades de un producto y se venden desde su lote", { skip }, async () => {
  const browser = await chromium.launch();
  try {
    const { page, errores } = await abrir(browser);
    await page.click('[data-nav="inventario"]');
    const deckEng = page.locator('#inv-tbody tr[data-producto]', { hasText: "Battle Deck" }).filter({ has: page.locator(".lang-ENG") });
    assert.match(await deckEng.textContent(), /12.*3.*9.*\$26\.990/s);
    assert.equal(await deckEng.locator("input[type=checkbox]").count(), 0);
    // Lo vendido en su totalidad va en su propia tabla, abajo, con la ganancia obtenida.
    assert.equal(await page.locator("#inv-tbody tr[data-producto]", { hasText: "Stellar Crown" }).filter({ hasText: "Booster Bundle" }).count(), 0);
    const agotado = page.locator("#inv-tbody-ago tr[data-producto]", { hasText: "Stellar Crown" }).filter({ hasText: "Booster Bundle" });
    assert.match(await agotado.textContent(), /19.*19.*0.*obtenida/s);
    assert.equal(await agotado.locator("[data-cant-prod]").count(), 0);
    assert.match(await page.locator("#inv-agotados-n").textContent(), /\(\d+\)/);
    await deckEng.click();
    const libres = page.locator("#inv-tbody .detalle-compra [data-sel-unidad]");
    assert.equal(await libres.count(), 9, "solo las 9 disponibles se pueden marcar");
    await libres.nth(0).check();
    await libres.nth(1).check();
    await page.waitForSelector("text=2 unidades seleccionadas");
    await page.click('[data-action="agregarSeleccionVenta"]');
    await toast(page, /2 unidades agregadas a la venta/);
    const linea = page.locator("#nueva-venta [data-carrito] tr");
    assert.equal(await linea.count(), 1);
    assert.match(await linea.textContent(), /Battle Deck.*factura 30th-DECK/s);
    assert.equal(await linea.locator("[data-carrito-cant]").inputValue(), "2");
    await page.locator('#nueva-venta button[type="submit"]').click();
    await toast(page, /OC-\d{4} registrada/);
    // Editar la ficha (foto, precio) desde el inventario
    await page.locator('#inv-tbody [data-action="editarProducto"]').first().click();
    await modal(page).waitFor();
    assert.deepEqual(errores, []);
  } finally {
    await browser.close();
  }
});

test("inventario: productos (filtros, editar, unir) y toma de inventario unidad por unidad", { skip }, async () => {
  const browser = await chromium.launch();
  try {
    const { page, errores } = await abrir(browser);
    await page.click('[data-nav="inventario"]');

    // Productos: filtro rápido y unir duplicados
    await page.click('[data-action="tab"][data-id="inventario.productos"]');
    const total = await page.locator("#prod-tbody tr").count();
    await page.selectOption('[data-filter="productos.rapido"]', "sinImagen");
    assert.equal(await page.locator("#prod-tbody tr").count(), total, "los de ejemplo no tienen foto");
    await page.selectOption('[data-filter="productos.rapido"]', "conStock");
    const conStock = await page.locator("#prod-tbody tr").count();
    assert.ok(conStock > 0 && conStock < total);
    await page.selectOption('[data-filter="productos.rapido"]', "");
    const fila = page.locator("#prod-tbody tr", { hasText: "GS-0005" });
    await fila.locator('[data-action="unirProducto"]').click();
    await modal(page).locator('select[name="destinoId"]').selectOption("GS-0004");
    await modal(page).locator('button[type="submit"]').click();
    await toast(page, /Productos unidos/);
    assert.equal(await page.locator("#prod-tbody tr", { hasText: "GS-0005" }).count(), 0);
    assert.match(await page.locator("#prod-tbody tr", { hasText: "GS-0004" }).textContent(), /20/, "9 + 11 Battle Deck");

    // Toma: iniciar, marcar unidades, una de más, guardar y cerrar con ajustes
    await page.click('[data-action="tab"][data-id="inventario.toma"]');
    await page.click('[data-action="tomaIniciar"]');
    await modal(page).locator('[name="notas"]').fill("Conteo de prueba");
    await modal(page).locator('button[type="submit"]').click();
    await toast(page, /Toma TOM-0001 iniciada/);
    const deck = page.locator('[data-toma-prod="GS-0004"]');
    await deck.locator('[data-action="tomaTodas"][data-id$="|x"]').click();
    await deck.locator('[data-action="tomaMarca"]').first().click();   // una no se encontró
    await deck.locator('[data-action="tomaSobra"][data-id$="|1"]').click();
    assert.match(await deck.locator(".toma-cifras").textContent(), /Esperado 20.*Encontrado 20/);
    await page.click('[data-action="tomaGuardar"]');
    await toast(page, /Avance guardado/);
    await page.click('[data-action="tomaCerrar"]');
    assert.match(await modal(page).textContent(), /productos sin revisar/);
    await modal(page).locator('button[type="submit"]').click();
    await toast(page, /Toma cerrada/);
    await page.waitForSelector("td:has-text('TOM-0001')");
    await page.click('[data-action="tab"][data-id="inventario.stock"]');
    assert.equal(await page.locator('[data-action="tab"][data-id="inventario.toma"] .pill').count(), 0);
    assert.deepEqual(errores, []);
  } finally {
    await browser.close();
  }
});

test("venta por monto, Finanzas y migración de la caja diaria", { skip }, async () => {
  const browser = await chromium.launch();
  try {
    const { page, errores } = await abrir(browser);
    // Venta por monto desde Inventario: no toca el stock
    await page.click('[data-nav="inventario"]');
    const antes = await page.locator(".kpi-card").first().textContent();
    await page.click('[data-action="agregarMontoVenta"]');
    const panel = page.locator("#nueva-venta");
    await panel.locator('[data-carrito-campo$="|categoria"]').selectOption("Torneo");
    await panel.locator('[data-carrito-campo$="|descripcion"]').fill("Torneo martes");
    await panel.locator('[data-carrito-campo$="|monto"]').fill("12000");
    assert.match(await panel.locator("[data-nv-totales]").textContent(), /\$12\.000/);
    await panel.locator('select[name="medioPago"]').selectOption("efectivo");
    await panel.locator('button[type="submit"]').click();
    await toast(page, /registrada · \$12\.000/);
    assert.equal(await page.locator(".kpi-card").first().textContent(), antes);

    // Finanzas: movimiento nuevo y resumen
    await page.click('[data-nav="finanzas"]');
    await page.click('[data-action="nuevoMovimiento"]');
    // El formulario enfoca su primer campo a los 30 ms: se espera para no escribir en medio de ese cambio de foco.
    await page.waitForFunction(() => document.activeElement && document.activeElement.name === "fecha");
    await modal(page).locator('[name="categoria"]').selectOption("gav");
    await modal(page).locator('[name="monto"]').fill("25000");
    await modal(page).locator('[name="subcategoria"]').fill("Sueldo Alex");
    await modal(page).locator('button[type="submit"]').click();
    await toast(page, /Movimiento MOV-\d{5} registrado/);
    assert.match(await page.locator(".fin-resumen").textContent(), /Ventas · Torneo/);
    assert.match(await page.locator(".fin-resumen").textContent(), /GAV/);
    await page.click('[data-action="tab"][data-id="finanzas.movimientos"]');
    await page.waitForSelector("td:has-text('Sueldo Alex')");

    // Migración de caja: pegar, homologar e importar
    await page.click('[data-nav="migracion"]');
    await page.click('[data-action="tab"][data-id="migracion.fuente.caja"]');
    const tsv = ["Periodo\tFecha\tGlosa\tEntradas\tSalidas\tObs", "01-06-2025\t10-06-2025\tPatrimonio\t335000\t\tIgnacio",
      "01-06-2025\t13-06-2025\tCompras\t\t100000\tStock | Singles", "01-06-2025\t22-06-2025\tVentas\t24500\t\tSingles",
      "01-06-2025\t23-06-2025\tSaldo\t\t435532\ta.Saldo 2025"].join("\n");
    await page.fill("[data-caja-pegar]", tsv);
    await page.click('[data-action="cajaPegar"]');
    await toast(page, /4 filas cargadas · 4 pendientes/);
    // Por partes: primero solo lo de singles (compra y venta)
    await page.fill("[data-caja-buscar]", "singles");
    await page.click('[data-action="cajaMarcarVisibles"]');
    assert.match(await page.locator("#caja-seleccion").textContent(), /2 filas · entradas \$24\.500 · salidas \$100\.000/);
    await page.click('[data-action="cajaMigrar"]');
    await modal(page).locator('button[type="submit"]').click();
    await toast(page, /2 filas migradas · 1 ventas nuevas, 0 fechadas, 1 movimientos, 0 facturas/);
    // Luego el resto, cambiando el destino del aporte a "Otro ingreso"
    await page.fill("[data-caja-buscar]", "");
    await page.click('[data-action="cajaMarcarVisibles"]');
    await page.click('[data-action="cajaMigrar"]');
    await modal(page).locator('button[type="submit"]').click();
    await toast(page, /2 filas migradas · 0 ventas nuevas, 0 fechadas, 1 movimientos, 0 facturas/);
    await page.selectOption("[data-caja-estado]", "");
    assert.equal(await page.locator(".badge:has-text('Migrada')").count(), 3);
    assert.equal(await page.locator(".badge:has-text('No se migra')").count(), 1, "el saldo 2025 no se migra");
    assert.deepEqual(errores, []);
  } finally {
    await browser.close();
  }
});

test("filtro de fechas como Excel: año, mes y día en orden cronológico", { skip }, async () => {
  const browser = await chromium.launch();
  try {
    const { page, errores } = await abrir(browser);
    await page.click('[data-nav="ventas"]');
    const total = await page.locator("#vt-tbody tr.fila-compra").count();
    await page.click('[data-action="menuColumna"][data-id="ventas|fecha"]');
    const menu = page.locator(".col-menu");
    // Meses en orden de calendario (no alfabético) y días como número
    const meses = await menu.locator(".cm-hijos input[data-grupo]").evaluateAll((els) => els.map((e) => e.dataset.grupo));
    assert.deepEqual(meses, [...meses].sort(), "meses en orden cronológico");
    assert.ok(meses.length >= 2);
    // Desmarcar un mes completo deja el año a medias y filtra solo ese mes
    const mes = menu.locator(".cm-hijos input[data-grupo]").first();
    const dias = await mes.locator("xpath=ancestor::div[contains(@class,'cm-grupo')][1]").locator(".cm-hijos input:not([data-grupo])").count();
    await mes.uncheck();
    assert.equal(await menu.locator("input[data-grupo]").first().evaluate((e) => e.indeterminate), true);
    await menu.locator("[data-aplicar]").click();
    const quedan = await page.locator("#vt-tbody tr.fila-compra").count();
    assert.ok(quedan < total && quedan > 0 && dias > 0);
    assert.ok(await page.locator('[data-id="ventas|fecha"].activo').count(), "el encabezado muestra el filtro activo");
    assert.deepEqual(errores, []);
  } finally {
    await browser.close();
  }
});

test("administración: validación de datos, buscar, validar y corregir", { skip }, async () => {
  const browser = await chromium.launch();
  try {
    const { page, errores } = await abrir(browser);
    await page.click('[data-nav="admin"]');
    await page.click('[data-id="admin.validacion"]');
    await page.waitForSelector("#val-cuerpo .val-grupo");
    const validar = page.locator('#val-cuerpo [data-action="valValidar"]');
    const n = await validar.count();
    assert.ok(n > 0, "la demo tiene hallazgos");
    // El buscador filtra sin perder el foco
    await page.locator('input[data-filter="validacion.q"]').type("CP-0001");
    assert.equal(await page.evaluate(() => document.activeElement.dataset.filter), "validacion.q");
    await page.locator('input[data-filter="validacion.q"]').fill("");
    await validar.first().click();
    await modal(page).locator('input[name="nota"]').fill("revisado");
    await modal(page).locator('button[type="submit"]').click();
    await toast(page, /1 validados/);
    await page.waitForFunction((n) => document.querySelectorAll('#val-cuerpo [data-action="valValidar"]').length === n - 1, n);
    // Validados: se ven con su nota y se pueden reabrir
    await page.selectOption('select[data-filter="validacion.estado"]', "validado");
    assert.match(await page.locator("#val-cuerpo").textContent(), /Validado por .*revisado/);
    assert.equal(await page.locator('#val-cuerpo [data-action="valReabrir"]').count(), 1);
    assert.deepEqual(errores, []);
  } finally {
    await browser.close();
  }
});

test("administración: respaldos automáticos y manuales", { skip }, async () => {
  const browser = await chromium.launch();
  try {
    const { page, errores } = await abrir(browser);
    await page.click('[data-nav="admin"]');
    await page.click('[data-action="tab"][data-id="admin.respaldos"]');
    await page.waitForSelector("text=Respaldo automático todas las noches");
    await page.click('[data-action="crearRespaldo"]');
    await toast(page, /Respaldo creado/);
    await page.waitForSelector("td:has-text('· manual')");
    assert.deepEqual(errores, []);
  } finally {
    await browser.close();
  }
});

test("demo con datos reales: exportar desde Respaldos y cargar el archivo en la vista previa", { skip }, async () => {
  const browser = await chromium.launch();
  try {
    const { page, errores } = await abrir(browser);
    await page.click('[data-nav="admin"]');
    await page.click('[data-action="tab"][data-id="admin.respaldos"]');
    await page.click('[data-action="exportarDemo"]');
    await toast(page, /Archivo listo/);
    await page.waitForSelector("a:has-text('Descargar')");

    // El archivo exportado (en el Drive simulado), con un cliente agregado para distinguirlo
    const datos = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem("gsprime_erp_preview_v2"));
      return JSON.parse(Object.values(st.files).find((f) => /datos para demo/.test(f.name) && !f.trashed).content);
    });
    const cli = datos.hojas.find((h) => h.nombre === "Clientes");
    const fila = cli.values[0].map((c) => ({ id: "CLI-9999", nombre: "Cliente Real Exportado", activo: true }[c] ?? ""));
    cli.values.push(fila);
    datos.hojas.find((h) => h.nombre === "Usuarios").values.push(["dueno@gmail.com", "Dueño", "admin", true, "", ""]);
    const archivo = path.join(ERP, "dist", "datos-demo-prueba.json");
    fs.writeFileSync(archivo, JSON.stringify(datos));

    assert.match(await page.locator("#preview-bar").textContent(), /datos de ejemplo/);
    await page.setInputFiles("#preview-archivo", archivo);
    await page.waitForFunction(() => /datos reales al/.test(document.getElementById("preview-bar")?.textContent || ""));
    await page.waitForSelector("#app:not(.hidden)");
    await page.click('[data-nav="clientes"]');
    await page.waitForSelector("text=Cliente Real Exportado");
    // Usuarios de la demo en vez de los reales: se puede cambiar de rol
    await page.click('[data-nav="admin"]');
    await page.click('[data-action="tab"][data-id="admin.usuarios"]');
    assert.equal(await page.locator("text=dueno@gmail.com").count(), 0);
    fs.unlinkSync(archivo);
    assert.deepEqual(errores, []);
  } finally {
    await browser.close();
  }
});

test("migración: pegar el Excel, homologar por secciones e importar", { skip }, async () => {
  const browser = await chromium.launch();
  try {
    const { page, errores } = await abrir(browser);
    await page.click('[data-nav="migracion"]');
    const tsv = [
      "PROVEEDOR\t\t\t\tSII",
      "Proveedor\tFactura\tSerie\tProducto\tValor Unitario\tCosto\tCredito Fiscal\tNeto\tDebito Fiscal\tPago SII\tGanancia\t$ Venta\tOC\tCliente\tBoleta",
      "Ludi\tL-77\t1\tPitch Black - ETB (ESP)\t$ 47.594\t$ 39.995\t\t\t\t\t\t$ 59.990\tOC401\tCAMILO PUG\t2001",
      "Ludi\tL-77\t2\tPitch Black - ETB (ESP)\t$ 47.594\t$ 39.995\t\t\t\t\t\t$ 59.990\t\t\t",
      "Ludi\t-\t1\tPitch Black - ETB (ESP)\t$ 47.594\t$ 39.995\t\t\t\t\t\t$ 59.990\tOC000\tPREMIOS | MUGRI\t",
    ].join("\n");
    await page.locator("[data-mig-pegar]").fill(tsv);
    await page.click('[data-action="migPegar"]');
    await toast(page, /3 filas cargadas/);
    assert.match(await page.locator(".kpi-grid").textContent(), /Unidades a migrar3.*Disponibles1/s);

    // Productos: la propuesta ya viene homologada
    await page.click('[data-action="migSeccion"][data-id="producto"]');
    assert.equal(await page.locator(".mig-tabla input[data-campo=destino]").first().inputValue(), "Pitch Black – ETB · ESP");
    // Confirmar cada sección; en facturas completar la que viene con "-"
    for (const sec of ["proveedor", "producto", "cliente"]) {
      await page.click(`[data-action="migSeccion"][data-id="${sec}"]`);
      await page.click('[data-action="migConfirmarTodo"]');
      await toast(page, /Cambios guardados/);
    }
    await page.click('[data-action="migSeccion"][data-id="factura"]');
    await page.locator(".mig-tabla input.falta").fill("L-78");
    await page.click('[data-action="migConfirmarTodo"]');
    await toast(page, /Cambios guardados/);

    await page.click('[data-action="migSeccion"][data-id="importar"]');
    await page.click('[data-action="migImportar"]');
    await modal(page).locator("button.btn:not(.ghost)").last().click();
    await toast(page, /Importado: 2 facturas, 1 ventas, 1 salidas/);
    await page.waitForSelector("text=Migración importada");

    // El stock quedó en Inventario y la venta con su OC original
    await page.click('[data-nav="inventario"]');
    const etb = page.locator('#inv-tbody tr[data-producto]', { hasText: "Pitch Black" });
    assert.match(await etb.textContent(), /3.*1.*\+1 salidas.*1/s);
    await etb.click();
    assert.match(await page.locator("#inv-tbody .detalle-compra").textContent(), /Premio.*Premios \| Mugri|Premio.*PREMIOS \| MUGRI/s);
    assert.deepEqual(errores, []);
  } finally {
    await browser.close();
  }
});

test("rol solo lectura: ve la información pero no las acciones", { skip }, async () => {
  const browser = await chromium.launch();
  try {
    const { page, errores } = await abrir(browser, { user: "contador@gsprime.cl" });
    assert.equal(await page.locator('[data-nav="admin"]').count(), 0);
    await page.click('[data-nav="preventas"]');
    assert.equal(await page.locator("#agregar-preventa").count(), 0);
    assert.match(await page.textContent("#pv-tbody"), /Binder Collection/);
    assert.equal(await page.locator("[data-asig], [data-sel], [data-action='editarPreventa']").count(), 0);
    await page.click('[data-nav="inventario"]');
    assert.match(await page.textContent("#inv-tbody"), /Battle Deck/);
    assert.equal(await page.locator('[data-action="agregarProductoVenta"], [data-cant-prod], [data-action="editarProducto"], [data-sel-unidad]').count(), 0);
    assert.deepEqual(errores, []);
  } finally {
    await browser.close();
  }
});

test("se adapta a celular sin desbordar la página", { skip }, async () => {
  const browser = await chromium.launch();
  try {
    const { page, errores } = await abrir(browser, { viewport: { width: 390, height: 844 } });
    for (const vista of ["dashboard", "preventas", "compras", "inventario", "ventas", "clientes", "proveedores", "admin"]) {
      await page.click("#menu-toggle");
      await page.click(`[data-nav="${vista}"]`);
      const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(ancho <= 390, `${vista}: la página mide ${ancho}px de ancho`);
    }
    assert.deepEqual(errores, []);
  } finally {
    await browser.close();
  }
});
