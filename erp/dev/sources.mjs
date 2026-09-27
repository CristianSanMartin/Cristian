// Lectura de los fuentes del ERP para pruebas y vista previa.
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ERP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SRC = path.join(ERP, "src");

/** Código del servidor concatenado en orden alfabético (como un solo proyecto de Apps Script). */
export function serverSource() {
  const dir = path.join(SRC, "server");
  return fs.readdirSync(dir).filter(f => f.endsWith(".js")).sort()
    .map(f => `// ---- ${f} ----\n` + fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
}

export function fakeSource() {
  return fs.readFileSync(path.join(ERP, "dev", "gas-fake.js"), "utf8");
}

/**
 * Resuelve las plantillas de HtmlService: <?!= include_('client/x'); ?> se reemplaza por
 * el archivo, y cualquier otra expresión <?!= ... ?> se evalúa con el código del servidor
 * (solo funciones puras, como interpretarNombre_.toString()).
 */
export function clientHtml() {
  const read = name => fs.readFileSync(path.join(SRC, name + ".html"), "utf8");
  const resolve = html => html.replace(/<\?!=\s*include_\('([^']+)'\);?\s*\?>/g, (_, name) => resolve(read(name)));
  const ctx = vm.createContext({});
  vm.runInContext(serverSource(), ctx);
  return resolve(read("client/index"))
    .replace(/<\?!=\s*([\s\S]*?);?\s*\?>/g, (_, expr) => String(vm.runInContext(expr, ctx)));
}
