// Genera erp/dist/preview.html: el ERP completo en un solo archivo que funciona
// sin Google. El código real del servidor corre en el navegador sobre el
// simulador de Apps Script, con datos de ejemplo guardados en localStorage.
//
// Uso: npm run erp:preview   (y abre erp/dist/preview.html en el navegador)
import fs from "node:fs";
import path from "node:path";
import { ERP, serverSource, fakeSource, clientHtml } from "./sources.mjs";

const js = (s) => JSON.stringify(s).replace(/<\/script/gi, "<\\/script");

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
  var saved = store.get(KEY);
  var fake = createGasFake({ user: 'admin@gsprime.cl', state: saved ? JSON.parse(saved) : undefined });
  var g = fake.globals;
  var server = new Function('SpreadsheetApp', 'Session', 'LockService', 'PropertiesService', 'Utilities', 'HtmlService',
    ${js(serverSource())} + '\\nreturn { api: api, instalar: instalar };')(
    g.SpreadsheetApp, g.Session, g.LockService, g.PropertiesService, g.Utilities, g.HtmlService);
  var persist = function () { store.set(KEY, JSON.stringify(fake.dump())); };

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
    var prod = function (nombre, categoria, precio, min) { return call('guardarProducto', { nombre: nombre, categoria: categoria, juego: 'Pokémon', precioVenta: precio, stockMinimo: min }); };
    var bb = prod('Booster Box Prismatic Evolutions', 'Booster Box', 68000, 2);
    var etb = prod('ETB Journey Together', 'Elite Trainer Box', 45000, 3);
    var bundle = prod('Booster Bundle Destined Rivals', 'Booster Bundle', 29000, 4);
    var tw = prod('Elite Trainer Box Twilight Masquerade', 'Elite Trainer Box', 47000, 2);
    var sleeves = call('guardarProducto', { nombre: 'Sleeves Dragon Shield Matte (100)', categoria: 'Accesorio', juego: 'Otro', precioVenta: 12990, stockMinimo: 5 });
    var pv = function (p, o) {
      return call('guardarPreventa', Object.assign({ productoId: p.id, precioVenta: p.precioVenta }, o));
    };
    pv(bb, { proveedor: 'Distribuidora Central', cantidad: 6, costoUnit: 52000, abonoInicial: 150000, fechaPedido: dia(-18), fechaLlegada: dia(6), notas: 'Reserva confirmada por WhatsApp con el proveedor.' });
    pv(etb, { proveedor: 'TCG Imports SPA', cantidad: 10, costoUnit: 34000, abonoInicial: 340000, fechaPedido: dia(-25), fechaLlegada: dia(-2), estado: 'transito' });
    pv(bundle, { proveedor: 'Distribuidora Central', cantidad: 12, costoUnit: 21000, fechaPedido: dia(-5), fechaLlegada: dia(20), notas: 'Esperando confirmación de stock del proveedor.' });
    var recibida = pv(tw, { proveedor: 'Cartas Import', cantidad: 8, costoUnit: 36000, abonoInicial: 288000, fechaPedido: dia(-40), fechaLlegada: dia(-10), estado: 'transito' });
    call('recibirPreventa', { id: recibida.id, cantidadRecibida: 8, fecha: dia(-9) });
    call('registrarMovimiento', { productoId: tw.id, tipo: 'salida', cantidad: 5, fecha: dia(-4), nota: 'Venta evento liga local' });
    call('registrarMovimiento', { productoId: sleeves.id, tipo: 'entrada', cantidad: 20, costoUnit: 7500, fecha: dia(-15), nota: 'Compra directa' });
    call('registrarMovimiento', { productoId: sleeves.id, tipo: 'salida', cantidad: 16, fecha: dia(-3), nota: 'Ventas tienda' });
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
    bar.innerHTML = '<strong>Vista previa</strong> <span title="Datos de ejemplo guardados solo en este navegador">(datos de ejemplo)</span> · Ver como ' +
      '<select id="preview-user">' + Object.keys(USERS).map(function (e) {
        return '<option value="' + e + '"' + (e === user ? ' selected' : '') + '>' + USERS[e] + '</option>';
      }).join('') + '</select> <button id="preview-reset" type="button">Reiniciar demo</button>';
    document.body.appendChild(bar);
    document.getElementById('preview-user').addEventListener('change', function (e) {
      store.set(KEY + '_user', e.target.value);
      location.href = location.pathname;
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
