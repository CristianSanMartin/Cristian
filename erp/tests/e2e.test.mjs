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

test("flujo de preventa: crear, agregar producto nuevo desde el nombre del proveedor y asignar", { skip }, async () => {
  const browser = await chromium.launch();
  try {
    const { page, errores } = await abrir(browser);

    // Nueva preventa → queda en su detalle
    await page.click('[data-nav="preventas"]');
    await page.click('[data-action="nuevaPreventa"]');
    assert.equal(await page.locator("#modal-root .modal-overlay").count(), 0, "se despliega en la página, no en una ventana");
    const nueva = page.locator("#nueva-preventa");
    assert.equal(await nueva.locator('[name="proveedorId"] option:checked').textContent(), "Asmodee");
    await nueva.locator('button[type="submit"]').click();
    await nueva.locator(".form-error.show").waitFor();
    assert.match(await nueva.locator(".form-error").textContent(), /edición es obligatoria/);
    await nueva.locator('[name="edicion"]').fill("Surging Sparks");
    await nueva.locator('button[type="submit"]').click();
    await page.waitForSelector("text=Sin productos todavía");
    assert.equal(await page.textContent("#topbar-title"), "Preventa PV-0002");

    // Agregar línea creando el producto desde el nombre de Asmodee
    await page.click('[data-action="nuevaLinea"]');
    await modal(page).locator('[data-action="nuevoProductoLinea"]').click();
    const prod = modal(page);
    await prod.locator('[name="_raw"]').fill("POKEMON TCG SURGING SPARKS - BOOSTER BOX ENGLISH");
    await prod.locator("[data-completar]").click();
    assert.equal(await prod.locator('[name="edicion"]').inputValue(), "Surging Sparks");
    assert.equal(await prod.locator('[name="nombre"]').inputValue(), "Booster Box");
    assert.equal(await prod.locator('[name="idioma"]').inputValue(), "ENG");
    assert.equal(await prod.locator('[name="factor"]').inputValue(), "36");
    await prod.locator('[name="pvp"]').fill("189990");
    await prod.locator('button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelectorAll("#modal-root .modal-overlay").length === 1);

    const linea = modal(page);
    assert.match(await linea.locator('[name="productoId"] option:checked').textContent(), /Surging Sparks – Booster Box · ENG/);
    await linea.locator('[name="lanzamiento"]').fill("2030-11-08");
    await linea.locator('[name="solicitado"]').fill("20");
    await linea.locator('[name="costoNeto"]').fill("120000");
    assert.equal(await linea.locator('[data-calc="total"]').textContent(), "$2.400.000");
    assert.equal(await linea.locator('[data-calc="ganancia"]').textContent(), "$39.655");
    await linea.locator('button[type="submit"]').click();
    await cerrado(page);

    // Segunda línea con error de validación visible en el modal
    await page.click('[data-action="nuevaLinea"]');
    const l2 = modal(page);
    await l2.locator('[name="productoId"]').selectOption({ label: "Destined Rivals – Booster Box · ENG (GS-0008)" });
    await l2.locator('[name="solicitado"]').fill("5");
    await l2.locator('[name="costoNeto"]').fill("1.555");
    await l2.locator('button[type="submit"]').click();
    await l2.locator(".form-error.show").waitFor();
    assert.match(await l2.locator(".form-error").textContent(), /2 decimales/);
    await l2.locator('[name="costoNeto"]').fill("118000");
    await l2.locator('button[type="submit"]').click();
    await cerrado(page);

    // Asignación: 6 de 20 y 0 de 5
    await page.click('[data-action="asignar"]');
    const asig = modal(page);
    const inputs = asig.locator(".qty-input");
    assert.equal(await inputs.count(), 2);
    await inputs.nth(0).fill("0");
    await inputs.nth(1).fill("6");
    assert.equal(await asig.locator("[data-tot-neto]").textContent(), "$720.000");
    await asig.locator('button[type="submit"]').click();
    await cerrado(page);

    const panel = page.locator(".launch-panel");
    const texto = await panel.textContent();
    assert.match(texto, /Pedido \$720\.000 neto/);
    assert.match(texto, /faltan \$280\.000 para despacho gratis/);
    assert.match(texto, /Sin asignación/);
    assert.match(await page.textContent(".page-head"), /Asignada/);

    // El producto nuevo aparece en el catálogo con su último costo
    await page.click('[data-nav="productos"]');
    const fila = page.locator("#prod-tbody tr", { hasText: "Surging Sparks" });
    assert.match(await fila.textContent(), /\$189\.990.*\$120\.000/s);

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
    assert.equal(await page.locator('[data-action="nuevaPreventa"]').count(), 0);
    await page.click('#pv-tbody [data-nav="preventa"]');
    assert.match(await page.textContent(".launch-panel"), /Binder Collection/);
    assert.equal(await page.locator('[data-action="asignar"], [data-action="nuevaLinea"], [data-action="editarLinea"]').count(), 0);
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
    const vistas = ["dashboard", "preventas", "productos", "proveedores", "admin"];
    for (const vista of vistas) {
      await page.click("#menu-toggle");
      await page.click(`[data-nav="${vista}"]`);
      const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(ancho <= 390, `${vista}: la página mide ${ancho}px de ancho`);
    }
    await page.click("#menu-toggle");
    await page.click('[data-nav="preventas"]');
    await page.click('#pv-tbody [data-nav="preventa"]');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth) <= 390, "detalle de preventa");
    assert.deepEqual(errores, []);
  } finally {
    await browser.close();
  }
});
