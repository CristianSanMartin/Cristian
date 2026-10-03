// Genera erp/dist/preview.html: el ERP completo en un solo archivo que funciona
// sin Google. El código real del servidor corre en el navegador sobre el
// simulador de Apps Script, con datos de ejemplo guardados en localStorage.
//
// Uso: npm run erp:preview   (y abre erp/dist/preview.html en el navegador)
//
// Con datos reales: DEMO_DATOS=ruta/al/archivo.json node erp/dev/build-preview.mjs
// (el archivo sale de Administración → Respaldos → "Exportar datos para la demo").
// La vista previa parte de esos datos en vez de los de ejemplo. Nunca subas ese
// archivo al repositorio: tiene datos de clientes.
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { ERP, serverSource, fakeSource, clientHtml } from "./sources.mjs";

const js = (s) => JSON.stringify(s).replace(/<\/script/gi, "<\\/script");

const DATOS = process.env.DEMO_DATOS ? JSON.parse(fs.readFileSync(process.env.DEMO_DATOS, "utf8")) : null;
if (DATOS && !Array.isArray(DATOS.hojas)) throw new Error("DEMO_DATOS no es una exportación del ERP (falta 'hojas').");

// Huella del esquema de datos: si cambia, la vista previa descarta los datos guardados del navegador.
const config = fs.readFileSync(path.join(ERP, "src", "server", "00_Config.js"), "utf8");
// Incluye las migraciones de datos: si hay una nueva, la demo ejecuta instalar y la aplica.
const respaldos = fs.readFileSync(path.join(ERP, "src", "server", "Respaldos.js"), "utf8");
const migracionesIds = (respaldos.match(/id: '[^']+'/g) || []).join(",");
const esquemaHash = crypto.createHash("sha1").update(config.slice(config.indexOf("const SCHEMA"), config.indexOf("const HOJAS_OBSOLETAS")) + migracionesIds).digest("hex").slice(0, 10);

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
  var ESQUEMA = ${js(esquemaHash)};
  var ROLES = { 'admin@gsprime.cl': 'admin', 'socio@gsprime.cl': 'operador', 'contador@gsprime.cl': 'lectura' };
  // Datos reales incluidos al generar la demo (DEMO_DATOS), o null para usar los de ejemplo.
  var BASE = ${js(DATOS)};
  /** Exportación del ERP → estado del simulador. Los usuarios se cambian por los de la demo. */
  function aEstado(datos) {
    var hojas = datos.hojas.map(function (h) {
      return { name: h.nombre, values: h.values, formats: h.formatos || {}, maxRows: Math.max(1000, h.values.length + 500) };
    });
    var u = hojas.find(function (h) { return h.name === 'Usuarios'; });
    if (u) {
      var cab = u.values[0] && u.values[0].length ? u.values[0] : ['email', 'nombre', 'rol', 'activo', 'creadoEn', 'creadoPor'];
      u.values = [cab].concat(Object.keys(USERS).map(function (e) {
        var o = { email: e, nombre: USERS[e], rol: ROLES[e], activo: true, creadoEn: '', creadoPor: 'demo' };
        return cab.map(function (c) { return o[c] !== undefined ? o[c] : ''; });
      }));
    }
    return { sheets: hojas, props: datos.props || {} };
  }
  // Si cambió la estructura de datos, se conservan los datos y se ejecuta instalar (agrega hojas y columnas).
  var saved = store.get(KEY);
  if (saved && store.get(KEY_ESQUEMA()) !== ESQUEMA) store.set(KEY + '_instalar', '1');
  var origen = saved ? (store.get(KEY + '_origen') || 'ejemplo') : (BASE ? 'reales|' + BASE.exportadoEn : 'ejemplo');
  var fake = createGasFake({ user: 'admin@gsprime.cl', state: saved ? JSON.parse(saved) : BASE ? aEstado(BASE) : undefined });
  var g = fake.globals;
  var server = new Function('SpreadsheetApp', 'Session', 'LockService', 'PropertiesService', 'Utilities', 'HtmlService', 'DriveApp', 'ScriptApp',
    ${js(serverSource())} + '\\nreturn { api: api, instalar: instalar };')(
    g.SpreadsheetApp, g.Session, g.LockService, g.PropertiesService, g.Utilities, g.HtmlService, g.DriveApp, g.ScriptApp);
  // Las imágenes "subidas a Drive" en la vista previa quedan en el navegador.
  window.previewImagen = function (id) {
    var f = fake.state.files[id];
    // Imágenes de los datos reales: siguen en el Drive de la tienda.
    return f && f.base64 ? 'data:' + f.mime + ';base64,' + f.base64 : 'https://drive.google.com/thumbnail?sz=w400&id=' + id;
  };
  function KEY_ESQUEMA() { return KEY + '_esquema'; }
  var persist = function () { store.set(KEY, JSON.stringify(fake.dump())); store.set(KEY_ESQUEMA(), ESQUEMA); store.set(KEY + '_origen', origen); };

  if (!saved || store.get(KEY + '_instalar')) {
    // Datos recién cargados (o de ejemplo): instalar agrega las hojas/columnas que falten.
    server.instalar();
    if (!saved && !BASE) seed();
    store.del(KEY + '_instalar');
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
      binderEng: prod('Binder Collection', 'ENG', 'Binder Colección', 43990),
      binderEsp: prod('Binder Collection', 'ESP', 'Binder Colección', 43990),
      tinEng: prod('Mini Tin', 'ENG', 'Tin / Mini Tin', 13990, { precioManual: true, precioVenta: 18000 }),
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
    // Los Battle Deck ya llegaron con su factura: están en Compras e Inventario (neto < $1.000.000, con despacho).
    call('crearCompra', { preventas: [lineas[3][0].id, lineas[4][0].id], factura: '30th-DECK', fecha: hoy });
    // Algunas ventas de esa factura: tienda con débito (comisión TUU), y una por cobrar.
    call('guardarCliente', { nombre: 'Juan Pérez', idPokemon: '1234567', telefono: '+56 9 1111 2222', instagram: 'juanpk' });
    call('crearVenta', { fecha: hoy, cliente: 'Juan Pérez', medioPago: 'debito', boleta: '1001', lineas: [{ productoId: p.deckEng.id, cantidad: 2 }] });
    call('crearVenta', { fecha: hoy, medioPago: 'efectivo', lineas: [{ productoId: p.deckEsp.id, cantidad: 1, precio: 24990 }] });
    call('crearVenta', { fecha: hoy, cliente: 'Ana Rojas', canal: 'Evento', evento: 'Torneo martes', medioPago: 'transferencia', pagada: false, abono: 10000,
      lineas: [{ productoId: p.deckEng.id, cantidad: 1 }] });
    historial();

    // Seis meses anteriores con compras y ventas, para que el tablero de Ventas tenga qué mostrar.
    function historial() {
      var mes = function (n, d) { var x = new Date(hoy.slice(0, 7) + '-01T12:00:00Z'); x.setUTCMonth(x.getUTCMonth() - n); x.setUTCDate(d); return x.toISOString().slice(0, 10); };
      var ediciones = ['Journey Together', 'Prismatic Evolutions', 'Surging Sparks', 'Stellar Crown', 'Shrouded Fable', 'Twilight Masquerade'];
      var clientes = ['Juan Pérez', 'Ana Rojas', 'Diego Muñoz', 'Camila Soto', 'Tomás Vera', ''];
      var medios = ['debito', 'credito', 'efectivo', 'transferencia', 'debito', 'debito'];
      var canales = ['Tienda', 'Tienda', 'Tienda', 'Evento', 'Instagram', 'Tienda'];
      var semilla = 7;
      var azar = function (n) { semilla = (semilla * 9301 + 49297) % 233280; return Math.floor((semilla / 233280) * n); };
      for (var n = 6; n >= 1; n--) {
        var ed = ediciones[n - 1];
        var bundle = call('guardarProducto', { nombre: 'Booster Bundle', edicion: ed, idioma: 'ENG', tipo: 'Booster Bundle', pvp: 32990 });
        var etb = call('guardarProducto', { nombre: 'Elite Trainer Box', edicion: ed, idioma: 'ENG', tipo: 'Elite Trainer Box', pvp: 64990 });
        var a = call('guardarPreventa', { proveedorId: asmodee.id, productoId: bundle.id, lanzamiento: mes(n, 2), solicitado: 30, costoNeto: 19500 });
        var b = call('guardarPreventa', { proveedorId: asmodee.id, productoId: etb.id, lanzamiento: mes(n, 2), solicitado: 20, costoNeto: 38900 });
        var cantA = 18 + azar(10);
        var cantB = 8 + azar(8);
        call('registrarAsignacion', { lineas: [{ id: a.id, asignado: cantA }, { id: b.id, asignado: cantB }] });
        call('crearCompra', { preventas: [a.id, b.id], factura: ed.split(' ')[0].toUpperCase() + '-' + (100 + n), fecha: mes(n, 3) });
        var ventas = 6 + azar(7);
        for (var i = 0; i < ventas; i++) {
          var k = azar(6);
          var cli = clientes[k];
          var lineasV = [{ productoId: bundle.id, cantidad: 1 + azar(3) }];
          if (azar(3) === 0) lineasV.push({ productoId: etb.id, cantidad: 1 });
          try {
            call('crearVenta', { fecha: mes(n, 4 + azar(24)), cliente: cli, canal: canales[k], evento: canales[k] === 'Evento' ? 'Torneo mensual' : '', medioPago: medios[azar(6)], lineas: lineasV });
          } catch (e) { /* sin stock: se omite */ }
        }
      }
    }
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
    var reales = origen.indexOf('reales|') === 0;
    // Compacta: una etiqueta en la esquina; al tocarla se despliegan las opciones de la demo.
    var abierta = store.get(KEY + '_bar') === '1';
    bar.className = abierta ? 'abierta' : '';
    bar.innerHTML = '<button id="preview-toggle" type="button" title="Opciones de la demo">Demo · ' +
      (reales ? 'datos reales al ' + origen.slice(7, 17) : 'datos de ejemplo') + ' · ' + USERS[user] + ' <span>' + (abierta ? '▾' : '▴') + '</span></button>' +
      '<div class="pv-opciones">' +
      '<label>Ver como <select id="preview-user">' + Object.keys(USERS).map(function (e) {
        return '<option value="' + e + '"' + (e === user ? ' selected' : '') + '>' + USERS[e] + '</option>';
      }).join('') + '</select></label>' +
      '<button id="preview-cargar" type="button" title="Archivo de Administración → Respaldos → Exportar datos para la demo">Cargar datos reales</button>' +
      '<button id="preview-reset" type="button">Reiniciar demo</button>' +
      '<span class="pv-nota">Lo que hagas aquí queda solo en este navegador.</span></div>' +
      '<input id="preview-archivo" type="file" accept=".json,application/json" hidden>';
    document.body.appendChild(bar);
    document.getElementById('preview-toggle').addEventListener('click', function () {
      store.set(KEY + '_bar', bar.classList.toggle('abierta') ? '1' : '0');
      this.querySelector('span').textContent = bar.classList.contains('abierta') ? '▾' : '▴';
    });
    document.getElementById('preview-user').addEventListener('change', function (e) {
      store.set(KEY + '_user', e.target.value);
      location.reload();
    });
    document.getElementById('preview-reset').addEventListener('click', function () {
      store.del(KEY);
      location.reload();
    });
    var archivo = document.getElementById('preview-archivo');
    document.getElementById('preview-cargar').addEventListener('click', function () { archivo.click(); });
    archivo.addEventListener('change', function () {
      var file = archivo.files[0];
      if (!file) return;
      var lector = new FileReader();
      lector.onload = function () {
        try {
          var datos = JSON.parse(lector.result);
          if (!datos || !Array.isArray(datos.hojas)) throw new Error('El archivo no es una exportación del ERP.');
          localStorage.setItem(KEY, JSON.stringify(aEstado(datos)));
          store.set(KEY_ESQUEMA(), ESQUEMA);
          store.set(KEY + '_origen', 'reales|' + (datos.exportadoEn || ''));
          store.set(KEY + '_instalar', '1');
          location.reload();
        } catch (e) {
          alert('No se pudieron cargar los datos: ' + (e && e.name === 'QuotaExceededError' ? 'el navegador no tiene espacio para guardarlos.' : e.message));
        }
      };
      lector.readAsText(file);
    });
  });
})();
</script>
<style>
#preview-bar{position:fixed;right:12px;bottom:12px;z-index:300;font:11px Inter,system-ui,sans-serif;color:#f3f2ef;display:flex;flex-direction:column-reverse;align-items:flex-end;gap:6px;max-width:calc(100vw - 24px);}
#preview-toggle{background:#1f1f23;border:1px solid #f6b400;color:#f3f2ef;border-radius:20px;padding:5px 10px;font:inherit;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.5);white-space:nowrap;}
#preview-toggle span{color:#f6b400;}
#preview-bar .pv-opciones{display:none;background:#1f1f23;border:1px solid #2b2b30;border-radius:10px;padding:10px;box-shadow:0 8px 24px rgba(0,0,0,.5);flex-direction:column;gap:8px;min-width:200px;}
#preview-bar.abierta .pv-opciones{display:flex;}
#preview-bar .pv-opciones label{display:flex;gap:6px;align-items:center;justify-content:space-between;}
#preview-bar .pv-nota{color:#a3a3a8;font-size:10px;}
#preview-bar select,#preview-bar .pv-opciones button{background:#17171a;color:#f3f2ef;border:1px solid #2b2b30;border-radius:6px;padding:4px 8px;font:inherit;cursor:pointer;}
.content{padding-bottom:50px;}
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
