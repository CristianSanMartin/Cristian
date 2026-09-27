// Genera erp/dist/preview.html: el ERP completo en un solo archivo que funciona
// sin Google. El código real del servidor corre en el navegador sobre el
// simulador de Apps Script, con datos de ejemplo guardados en localStorage.
//
// Uso: npm run erp:preview   (y abre erp/dist/preview.html en el navegador)
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { ERP, serverSource, fakeSource, clientHtml } from "./sources.mjs";

const js = (s) => JSON.stringify(s).replace(/<\/script/gi, "<\\/script");

// Huella del esquema de datos: si cambia, la vista previa descarta los datos guardados del navegador.
const config = fs.readFileSync(path.join(ERP, "src", "server", "00_Config.js"), "utf8");
const esquemaHash = crypto.createHash("sha1").update(config.slice(config.indexOf("const SCHEMA"), config.indexOf("const HOJAS_OBSOLETAS"))).digest("hex").slice(0, 10);

const preview = `
<script>${fakeSource().replace(/<\/script/gi, "<\\/script")}</script>
<script>
/* ---- Vista previa local: reemplaza google.script.run por el servidor simulado ---- */
(function () {
  var KEY = 'gsprime_erp_preview_v2';
  var USERS = {
    'admin@gsprime.cl': 'Administrador',
    'socio@gsprime.cl': 'Operador',
    'contador@gsprime.cl': 'Solo lectura'
  };
  var params = new URLSearchParams(location.search);
  var delay = params.has('delay') ? Number(params.get('delay')) : 250;
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  var user = params.get('user') || store.get(KEY + '_user') || 'admin@gsprime.cl';
  // Si cambió la estructura de datos desde la última visita, la demo parte de cero.
  var ESQUEMA = ${js(esquemaHash)};
  var saved = store.get(KEY_ESQUEMA()) === ESQUEMA ? store.get(KEY) : null;
  var reiniciada = !saved && !!store.get(KEY);
  var fake = createGasFake({ user: 'admin@gsprime.cl', state: saved ? JSON.parse(saved) : undefined });
  var g = fake.globals;
  var server = new Function('SpreadsheetApp', 'Session', 'LockService', 'PropertiesService', 'Utilities', 'HtmlService', 'DriveApp',
    ${js(serverSource())} + '\\nreturn { api: api, instalar: instalar };')(
    g.SpreadsheetApp, g.Session, g.LockService, g.PropertiesService, g.Utilities, g.HtmlService, g.DriveApp);
  // Las imágenes "subidas a Drive" en la vista previa quedan en el navegador.
  window.previewImagen = function (id) {
    var f = fake.state.files[id];
    return f ? 'data:' + f.mime + ';base64,' + f.base64 : '';
  };
  function KEY_ESQUEMA() { return KEY + '_esquema'; }
  var persist = function () { store.set(KEY, JSON.stringify(fake.dump())); store.set(KEY_ESQUEMA(), ESQUEMA); };

  if (!saved) {
    server.instalar();
    seed();
    persist();
  }
  fake.setUser(user);

  function seed() {
    var hoy = g.Utilities.formatDate(new Date(), 'America/Santiago', 'yyyy-MM-dd');
    var dia = function (n) { var d = new Date(hoy + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    var call = function (a, p) { var r = server.api(a, p); if (!r.ok) throw new Error(a + ': ' + r.error); return r.result; };
    call('guardarUsuario', { email: 'admin@gsprime.cl', nombre: 'Cristian', rol: 'admin' });
    call('guardarUsuario', { email: 'socio@gsprime.cl', nombre: 'Socio', rol: 'operador' });
    call('guardarUsuario', { email: 'contador@gsprime.cl', nombre: 'Contador', rol: 'lectura' });
    var asmodee = server.api('bootstrap', {}).data.proveedores[0];
    var prod = function (nombre, idioma, tipo, pvp, extra) {
      return call('guardarProducto', Object.assign({ nombre: nombre, edicion: '30th Celebration', idioma: idioma, tipo: tipo, pvp: pvp }, extra || {}));
    };
    var p = {
      binderEng: prod('Binder Collection', 'ENG', 'Binder / Colección', 43990),
      binderEsp: prod('Binder Collection', 'ESP', 'Binder / Colección', 43990),
      tinEng: prod('Mini Tin', 'ENG', 'Mini Tin', 13990, { precioManual: true, precioVenta: 18000 }),
      deckEng: prod('Battle Deck', 'ENG', 'Battle Deck', 26990),
      deckEsp: prod('Battle Deck', 'ESP', 'Battle Deck', 26990),
      dittoEng: prod('Ditto Premium Collection', 'ENG', 'Premium Collection', 53990),
      dittoEsp: prod('Ditto Premium Collection', 'ESP', 'Premium Collection', 53990),
    };
    call('guardarProducto', { nombre: 'Booster Box', edicion: 'Destined Rivals', idioma: 'ENG', tipo: 'Booster Box', pvp: 189990 });
    var pedir = function (prod, fecha, sol, costo) {
      return call('guardarPreventa', { proveedorId: asmodee.id, productoId: prod.id, lanzamiento: fecha, solicitado: sol, costoNeto: costo });
    };
    var f1 = dia(5), f2 = dia(33), f3 = dia(40);
    var lineas = [
      [pedir(p.binderEng, f1, 60, 25887), 24], [pedir(p.binderEsp, f1, 0, 25887), 6], [pedir(p.tinEng, f1, 80, 8230), 10],
      [pedir(p.deckEng, f2, 12, 15876.5), 12], [pedir(p.deckEsp, f2, 12, 15876.5), 12],
      [pedir(p.dittoEng, f3, 54, 31758.81), null], [pedir(p.dittoEsp, f3, 12, 31758.81), null],
    ];
    call('registrarAsignacion', { lineas: lineas.filter(function (x) { return x[1] != null; }).map(function (x) { return { id: x[0].id, asignado: x[1] }; }) });
  }

  function runner(ok, fail) {
    return new Proxy({}, {
      get: function (_, name) {
        if (name === 'withSuccessHandler') return function (h) { return runner(h, fail); };
        if (name === 'withFailureHandler') return function (h) { return runner(ok, h); };
        if (name === 'withUserObject') return function () { return runner(ok, fail); };
        return function () {
          var args = JSON.parse(JSON.stringify(Array.prototype.slice.call(arguments)));
          setTimeout(function () {
            var res;
            try {
              if (typeof server[name] !== 'function') throw new Error('Función no disponible: ' + name);
              res = JSON.parse(JSON.stringify(server[name].apply(null, args)));
              persist();
            } catch (e) {
              if (fail) fail(e);
              return;
            }
            if (ok) ok(res);
          }, delay);
        };
      }
    });
  }
  window.google = { script: { run: runner() } };

  document.addEventListener('DOMContentLoaded', function () {
    var bar = document.createElement('div');
    bar.id = 'preview-bar';
    bar.innerHTML = '<strong>Vista previa</strong> <span title="Datos de ejemplo guardados solo en este navegador">(datos de ejemplo)</span> · ' +
      (reiniciada ? '<span style="color:#f6b400">Se reinició por una actualización</span> · ' : '') + 'Ver como ' +
      '<select id="preview-user">' + Object.keys(USERS).map(function (e) {
        return '<option value="' + e + '"' + (e === user ? ' selected' : '') + '>' + USERS[e] + '</option>';
      }).join('') + '</select> <button id="preview-reset" type="button">Reiniciar demo</button>';
    document.body.appendChild(bar);
    document.getElementById('preview-user').addEventListener('change', function (e) {
      store.set(KEY + '_user', e.target.value);
      location.reload();
    });
    document.getElementById('preview-reset').addEventListener('click', function () {
      store.del(KEY);
      location.reload();
    });
  });
})();
</script>
<style>
#preview-bar{position:fixed;left:50%;transform:translateX(-50%);bottom:12px;z-index:300;background:#1f1f23;border:1px solid #f6b400;color:#f3f2ef;
  font:12px Inter,system-ui,sans-serif;padding:7px 12px;border-radius:30px;box-shadow:0 8px 24px rgba(0,0,0,.5);display:flex;gap:8px;align-items:center;
  flex-wrap:wrap;justify-content:center;max-width:calc(100vw - 24px);}
#preview-bar select,#preview-bar button{background:#17171a;color:#f3f2ef;border:1px solid #2b2b30;border-radius:6px;padding:3px 6px;font:inherit;cursor:pointer;}
.content{padding-bottom:90px;}
</style>
`;

const html = clientHtml().replace("</head>", () => preview + "</head>");
const out = path.join(ERP, "dist", "preview.html");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log("Vista previa generada:", path.relative(process.cwd(), out), `(${Math.round(html.length / 1024)} KB)`);

// Versión para publicar como Artifact de claude.ai (la plataforma agrega el esqueleto html/head/body).
const artifact = html
  .replace(/<!DOCTYPE html>\s*/i, "")
  .replace(/<\/?html[^>]*>\s*/gi, "")
  .replace(/<\/?head>\s*/gi, "")
  .replace(/<\/?body>\s*/gi, "")
  .replace(/<base [^>]*>\s*/i, "")
  .replace(/<meta charset[^>]*>\s*/i, "")
  .replace(/<meta name="viewport"[^>]*>\s*/i, "")
  .replace("</style>", ":root{color-scheme:dark;}\n</style>");
fs.writeFileSync(path.join(ERP, "dist", "preview-artifact.html"), artifact);
