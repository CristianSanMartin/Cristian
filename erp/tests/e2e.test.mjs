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

async function abrir(browser, opts = {}) {
  const page = await browser.newPage({ viewport: opts.viewport || { width: 1400, height: 950 } });
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  await page.goto(url(opts.user));
  await page.waitForSelector("#app:not(.hidden)");
  return { page, errores };
}

const modal = (page) => page.locator("#modal-root .modal-overlay").last();

test("flujo completo: producto, preventa, abono, recepción y salida de inventario", { skip: !fs.existsSync(PREVIEW) }, async () => {
  const browser = await chromium.launch();
  try {
    const { page, errores } = await abrir(browser);

    // Nueva preventa, creando el producto desde el mismo formulario
    await page.click('[data-nav="preventas"]');
    await page.click('[data-action="nuevaPreventa"]');
    await modal(page).locator('[data-action="nuevoProductoInline"]').click();
    const prodModal = modal(page);
    await prodModal.locator('[name="nombre"]').fill("Booster Box Surging Sparks");
    await prodModal.locator('[name="precioVenta"]').fill("70000");
    await prodModal.locator('[name="stockMinimo"]').fill("1");
    await prodModal.locator('button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelectorAll("#modal-root .modal-overlay").length === 1);

    const pvModal = modal(page);
    assert.match(await pvModal.locator('[name="productoId"] option:checked').textContent(), /Surging Sparks/);
    assert.equal(await pvModal.locator('[name="precioVenta"]').inputValue(), "70000", "toma el precio del producto");
    await pvModal.locator('[name="proveedor"]').fill("Distribuidora Central");
    await pvModal.locator('[name="cantidad"]').fill("4");
    await pvModal.locator('[name="costoUnit"]').fill("50000");
    await pvModal.locator('[name="abonoInicial"]').fill("50000");
    assert.equal(await pvModal.locator('[data-calc="total"]').textContent(), "$200.000");
    assert.equal(await pvModal.locator('[data-calc="saldo"]').textContent(), "$150.000");

    // Validación del servidor visible dentro del modal (falta la fecha de llegada)
    await pvModal.locator('button[type="submit"]').click();
    await assert.doesNotReject(pvModal.locator(".form-error.show").waitFor());
    assert.match(await pvModal.locator(".form-error").textContent(), /estimada de llegada es obligatoria/);

    await pvModal.locator('[name="fechaLlegada"]').fill("2030-01-15");
    await pvModal.locator('button[type="submit"]').click();
    await page.waitForSelector("#modal-root .modal-overlay", { state: "detached" });
    assert.match(await page.textContent("#toast-msg"), /PV-0005 creada/);

    const fila = page.locator("#pv-tbody tr", { hasText: "Surging Sparks" });
    assert.match(await fila.textContent(), /\$200\.000.*\$50\.000.*\$150\.000/);
    assert.match(await fila.textContent(), /Parcial/i);

    // Abono desde el detalle
    await fila.locator('[data-action="verPreventa"]').first().click();
    const det = modal(page);
    await det.locator('form[data-pago] [name="monto"]').fill("150000");
    await det.locator('form[data-pago] button[type="submit"]').click();
    await page.waitForFunction(() => /Pagado/i.test(document.querySelector("#modal-root .modal-overlay .btn-row").textContent));
    assert.equal(await det.locator("form[data-pago]").count(), 0, "sin saldo no se ofrece otro abono");

    // Recepción parcial
    await det.locator('.danger-zone [data-action="recibirPreventa"]').click();
    const rec = modal(page);
    await rec.locator('[name="cantidadRecibida"]').fill("3");
    await rec.locator('button[type="submit"]').click();
    await page.waitForFunction(() => /Recibida/i.test(document.querySelector("#modal-root .modal-overlay .btn-row").textContent));
    await page.keyboard.press("Escape");

    // Inventario: stock 3 a $50.000
    await page.click('[data-nav="inventario"]');
    const prod = page.locator("#inv-results tr", { hasText: "Surging Sparks" });
    assert.match(await prod.textContent(), /GS-0006.*3.*\$50\.000.*\$150\.000.*\$70\.000.*29%/s);

    // Salida mayor al stock: error dentro del modal, sin cerrarlo
    await prod.locator('[data-action="movimientoProducto"]').click();
    const mov = modal(page);
    await mov.locator('label:has(input[value="salida"])').click();
    await mov.locator('[name="cantidad"]').fill("5");
    await mov.locator('[name="nota"]').fill("Venta");
    assert.equal(await mov.locator('[data-calc="resultado"]').textContent(), "-2");
    await mov.locator('button[type="submit"]').click();
    await mov.locator(".form-error.show").waitFor();
    assert.match(await mov.locator(".form-error").textContent(), /Stock insuficiente: hay 3/);
    await mov.locator('[name="cantidad"]').fill("2");
    await mov.locator('button[type="submit"]').click();
    await page.waitForSelector("#modal-root .modal-overlay", { state: "detached" });
    assert.match(await prod.textContent(), /GS-0006\s*Booster Box Surging Sparks.*?1/s);

    // Kardex en la pestaña de movimientos
    await page.click('[data-id="inventario.movimientos"]');
    const kardex = await page.textContent("#inv-results");
    assert.match(kardex, /Salida manual/);
    assert.match(kardex, /PV-0005/);

    assert.deepEqual(errores, []);
  } finally {
    await browser.close();
  }
});

test("rol solo lectura: no ve acciones de escritura ni administración", { skip: !fs.existsSync(PREVIEW) }, async () => {
  const browser = await chromium.launch();
  try {
    const { page, errores } = await abrir(browser, { user: "contador@gsprime.cl" });
    assert.equal(await page.locator('[data-nav="admin"]').count(), 0);
    await page.click('[data-nav="preventas"]');
    assert.equal(await page.locator('[data-action="nuevaPreventa"]').count(), 0);
    assert.equal(await page.locator('[data-action="recibirPreventa"]').count(), 0);
    await page.click('[data-nav="inventario"]');
    assert.equal(await page.locator('[data-action="nuevoProducto"]').count(), 0);
    assert.equal(await page.locator('[data-action="movimientoProducto"]').count(), 0);
    assert.equal(await page.textContent(".user-chip .u-role"), "Solo lectura");
    assert.deepEqual(errores, []);
  } finally {
    await browser.close();
  }
});

test("se adapta a celular sin desbordar la página", { skip: !fs.existsSync(PREVIEW) }, async () => {
  const browser = await chromium.launch();
  try {
    const { page, errores } = await abrir(browser, { viewport: { width: 390, height: 844 } });
    for (const vista of ["dashboard", "preventas", "inventario", "admin"]) {
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
