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
    assert.equal(await form.locator('select[name="proveedorId"]').count(), 0, "el proveedor no se pide: Asmodee por defecto");
    assert.match(await form.locator(".inline-panel-head").textContent(), /registro propio de Asmodee/);

    // Producto nuevo creado desde el nombre de Asmodee, sin salir de Preventas
    await form.locator('[data-action="nuevoProductoPv"]').click();
    const prod = modal(page);
    await prod.locator('[name="_raw"]').fill("POKEMON TCG SURGING SPARKS - BOOSTER BOX ENGLISH");
    await prod.locator("[data-completar]").click();
    assert.equal(await prod.locator('[name="factor"]').inputValue(), "36");
    await prod.locator('[name="pvp"]').fill("189990");
    await prod.locator('button[type="submit"]').click();
    await cerrado(page);
    assert.match(await form.locator('[name="productoId"] option:checked').textContent(), /Surging Sparks – Booster Box · ENG/);

    // Error visible en el mismo formulario
    await form.locator('button[type="submit"]').click();
    await form.locator(".form-error.show").waitFor();
    assert.match(await form.locator(".form-error").textContent(), /lanzamiento es obligatoria/);

    await form.locator('[name="proforma"]').fill("Proforma Surging Sparks");
    await form.locator('[name="lanzamiento"]').fill("2030-11-08");
    await form.locator('[name="solicitado"]').fill("20");
    await form.locator('[name="costoNeto"]').fill("120000");
    assert.match(await form.locator("[data-calc]").textContent(), /Total neto \$2\.400\.000.*Ganancia real \$39\.655/);
    await form.locator('button[type="submit"]').click();
    await toast(page, /PVI-000008 agregada/);

    // Proveedor, proforma y fecha se mantienen para el siguiente producto
    assert.equal(await form.locator('[name="proforma"]').inputValue(), "Proforma Surging Sparks");
    assert.equal(await form.locator('[name="lanzamiento"]').inputValue(), "2030-11-08");
    assert.equal(await form.locator('[name="productoId"]').inputValue(), "");
    await form.locator('[name="productoId"]').selectOption({ label: "Destined Rivals – Booster Box · ENG" });
    await form.locator('[name="solicitado"]').fill("5");
    await form.locator('[name="costoNeto"]').fill("118000");
    await form.locator('button[type="submit"]').click();
    await toast(page, /PVI-000009 agregada/);

    // Filtrar por la proforma: un grupo por fecha con su aviso de despacho
    await page.selectOption('[data-filter="preventas.proforma"]', "Proforma Surging Sparks");
    const grupo = page.locator("#pv-tbody tr.group-row");
    assert.equal(await grupo.count(), 1);
    assert.match(await grupo.textContent(), /Pedido \$2\.990\.000 neto.*Despacho gratis/);

    // Nuevo cant. en la tabla: queda pendiente hasta guardar
    const fila = (texto) => page.locator("#pv-tbody tr", { hasText: texto });
    await fila("PVI-000008").locator("[data-asig]").fill("6");
    await page.waitForSelector("text=1 cantidad asignada sin guardar");
    await page.click('[data-action="guardarAsignaciones"]');
    await toast(page, /Asignación guardada/);
    assert.match(await fila("PVI-000008").textContent(), /Asignada/);
    assert.match(await grupo.textContent(), /Pedido \$1\.310\.000 neto/);

    // En bloque: seleccionar y marcar sin asignación
    await fila("PVI-000009").locator("[data-sel]").check();
    await page.click('[data-action="sinAsignacion"]');
    await toast(page, /Marcadas sin asignación/);
    assert.equal(await fila("PVI-000009").count(), 0, "sale de la vista 'Por comprar'");
    assert.match(await grupo.textContent(), /Pedido \$720\.000 neto.*faltan \$280\.000 para despacho gratis/);

    // El producto aparece en el catálogo con su último costo
    await page.click('[data-nav="productos"]');
    assert.match(await page.locator("#prod-tbody tr", { hasText: "Surging Sparks" }).textContent(), /\$189\.990.*\$120\.000/s);

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
    await page.click('[data-nav="productos"]');
    assert.equal(await page.locator('[data-action="nuevoProducto"], [data-action="editarProducto"]').count(), 0);
    assert.deepEqual(errores, []);
  } finally {
    await browser.close();
  }
});

test("se adapta a celular sin desbordar la página", { skip }, async () => {
  const browser = await chromium.launch();
  try {
    const { page, errores } = await abrir(browser, { viewport: { width: 390, height: 844 } });
    for (const vista of ["dashboard", "preventas", "productos", "proveedores", "admin"]) {
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
