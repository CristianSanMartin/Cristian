import { chromium } from "playwright";
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 700 } });
await p.addInitScript(() => { const g = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { return /^gstin-/.test(k) ? "1" : g.call(this, k); }; });
await p.goto("file://" + process.cwd() + "/erp/dist/preview.html?delay=0"); await p.waitForSelector("#app:not(.hidden)");
await p.click('[data-nav="clientes"]'); await p.waitForTimeout(300);
await p.screenshot({ path: process.argv[2] }); await b.close();
