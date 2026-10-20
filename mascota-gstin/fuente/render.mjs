// usage: node render.mjs <svg> <out-prefix> [titulo] [texto]
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { pathToFileURL } from 'url';

const [svgPath, out, title = '¡Gran día de ventas!', body = 'Cerraste el torneo con 32 jugadores.'] = process.argv.slice(2);
const logo = 'data:image/png;base64,' + readFileSync(resolve(dirname(svgPath), 'logo.png')).toString('base64');
const svg = readFileSync(svgPath, 'utf8').replace('href="logo.png"', `href="${logo}"`);
const base = pathToFileURL(dirname(resolve(svgPath)) + '/').href;
const H = 500, W = Math.round(500 * 640 / 900);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 1100 }, deviceScaleFactor: 1 });

async function shot(html, file, clip, transparent) {
  await page.setContent(`<html><head><base href="${base}"><style>html,body{margin:0;background:transparent}</style></head><body>${html}</body></html>`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: file, clip, omitBackground: transparent });
}
const sized = (w, h) => svg.replace('width="640" height="900"', `width="${w}" height="${h}"`);
await shot(sized(W, H), `${out}.png`, { x: 0, y: 0, width: W, height: H }, true);
await shot(sized(W * 2, H * 2), `${out}@2x.png`, { x: 0, y: 0, width: W * 2, height: H * 2 }, true);

// preview on ERP-like dark popup: 500px and 150px sizes
const sw = Math.round(150 * 640 / 900);
await shot(`<div style="display:flex;gap:40px;align-items:center;padding:30px;background:#0F0F10;font-family:Inter;color:#eee;width:1100px;height:560px;box-sizing:border-box">
  ${sized(W, H)}
  <div style="border:1px solid #C9A227;border-radius:14px;padding:18px;display:flex;gap:16px;align-items:center;background:#17171A;width:420px">
    ${sized(sw, 150)}
    <div><div style="color:#F5C518;font-weight:800;font-size:18px">${title}</div><div style="font-size:14px;opacity:.8;margin-top:6px">${body}</div></div>
  </div></div>`, `${out}-preview.png`, { x: 0, y: 0, width: 1100, height: 560 }, false);
await browser.close();
