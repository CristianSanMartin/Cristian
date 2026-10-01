/**
 * Respaldos y migraciones.
 *
 * Respaldo = copia completa de la planilla en la carpeta "GS Prime ERP · Respaldos"
 * (junto a la planilla). Hay uno automático cada noche (se conservan los últimos 30),
 * uno antes de cada instalar/migración, y el administrador puede crear uno a mano.
 *
 * Migración = cambio único sobre datos existentes (ej. crear una llave nueva a partir
 * de otra columna). Se declara en MIGRACIONES con un id que nunca cambia; instalar()
 * ejecuta las pendientes, SIEMPRE después de un respaldo, y deja registro en la hoja
 * Migraciones para que ninguna corra dos veces.
 */

/** Migraciones de datos, en orden. Nunca editar ni quitar una ya publicada: se agrega una nueva. */
const MIGRACIONES = [
  // { id: '2026-10-01-ejemplo', descripcion: 'Qué cambia y por qué', fn: (user) => { ... } },
  {
    id: '2026-10-01-tipo-binder',
    descripcion: 'Tipo de producto "Binder / Colección" pasa a llamarse "Binder Colección"',
    fn: () => {
      const cambios = {};
      Db.all('Productos').forEach((p) => { if (p.tipo === 'Binder / Colección') cambios[p.id] = { tipo: 'Binder Colección' }; });
      if (Object.keys(cambios).length) Db.actualizarVarios('Productos', cambios);
    },
  },
];

const Respaldos = {
  NOMBRE_CARPETA: 'GS Prime ERP · Respaldos',
  CONSERVAR: 30,

  /** Carpeta de respaldos: junto a la planilla (ej. "GSPrime WEB"), o en Mi unidad si no tiene carpeta. */
  carpeta() {
    const props = PropertiesService.getScriptProperties();
    const id = props.getProperty('CARPETA_RESPALDOS');
    if (id) {
      try { return DriveApp.getFolderById(id); } catch (e) { /* se recrea abajo */ }
    }
    const archivo = DriveApp.getFileById(Db.ss().getId());
    const padres = archivo.getParents();
    const carpeta = padres.hasNext() ? padres.next().createFolder(Respaldos.NOMBRE_CARPETA) : DriveApp.createFolder(Respaldos.NOMBRE_CARPETA);
    props.setProperty('CARPETA_RESPALDOS', carpeta.getId());
    return carpeta;
  },

  /** Copia completa de la planilla. motivo: "diario", "manual", "antes de instalar v2.5", etc. */
  crear(motivo, user) {
    const ss = Db.ss();
    const nombre = ss.getName() + ' · respaldo ' + Util.ahora().slice(0, 16) + ' · ' + (motivo || 'manual');
    const copia = DriveApp.getFileById(ss.getId()).makeCopy(nombre, Respaldos.carpeta());
    if (user) Audit.log(user, 'respaldo', 'Sistema', copia.getId(), { nombre: nombre });
    return { id: copia.getId(), nombre: nombre };
  },

  listar() {
    const res = [];
    const it = Respaldos.carpeta().getFiles();
    while (it.hasNext()) {
      const f = it.next();
      if (/\.json$/.test(f.getName())) continue;   // archivos de datos para la demo
      const d = f.getDateCreated();
      res.push({ id: f.getId(), nombre: f.getName(), fecha: Util.fechaHora(d), ts: d.getTime(), url: 'https://docs.google.com/spreadsheets/d/' + f.getId() });
    }
    return res.sort((a, b) => b.ts - a.ts);
  },

  /**
   * Exporta todas las hojas a un archivo JSON en la carpeta de respaldos, para cargar los
   * datos reales en la vista previa (demo). Las fechas salen como texto; la Auditoría
   * solo con sus últimos 500 registros. Se conserva solo la exportación más reciente.
   */
  exportarDemo(p, user) {
    const ss = Db.ss();
    const tz = ss.getSpreadsheetTimeZone();
    const texto = (v) => {
      if (!(v instanceof Date)) return v;
      const hora = Utilities.formatDate(v, tz, 'HH:mm:ss');
      return Utilities.formatDate(v, tz, 'yyyy-MM-dd') + (hora === '00:00:00' ? '' : ' ' + hora);
    };
    const hojas = ss.getSheets().map((sh) => {
      const filas = sh.getLastRow();
      const cols = sh.getLastColumn();
      let values = filas && cols ? sh.getRange(1, 1, filas, cols).getValues() : [];
      if (sh.getName() === 'Auditoria' && values.length > 501) values = [values[0]].concat(values.slice(-500));
      const formatos = {};
      if (filas > 1 && cols) sh.getRange(2, 1, 1, cols).getNumberFormats()[0].forEach((f, i) => { if (f === '@') formatos[i] = '@'; });
      return { nombre: sh.getName(), values: values.map((r) => r.map(texto)), formatos: formatos };
    });
    const props = PropertiesService.getScriptProperties().getProperties();
    Object.keys(props).forEach((k) => { if (/^CARPETA_/.test(k)) delete props[k]; });   // carpetas de Drive: no aplican en la demo
    const ahora = Util.ahora();
    const datos = { app: 'GS Prime ERP', version: APP.version, exportadoEn: ahora, exportadoPor: user.email, hojas: hojas, props: props };
    const carpeta = Respaldos.carpeta();
    const it = carpeta.getFiles();
    while (it.hasNext()) {
      const f = it.next();
      if (/· datos para demo .*\.json$/.test(f.getName())) f.setTrashed(true);
    }
    const nombre = ss.getName() + ' · datos para demo ' + ahora.slice(0, 16).replace(':', '.') + '.json';
    const contenido = JSON.stringify(datos);
    const archivo = carpeta.createFile(nombre, contenido, 'application/json');
    Audit.log(user, 'exportar demo', 'Sistema', archivo.getId(), { nombre: nombre, hojas: hojas.length });
    return { nombre: nombre, kb: Math.round(contenido.length / 1024), url: 'https://drive.google.com/uc?export=download&id=' + archivo.getId() };
  },

  /** Respaldo nocturno (lo llama el activador): uno por día y se conservan los últimos 30 automáticos. */
  diario() {
    const hoy = Util.hoy();
    const lista = Respaldos.listar();
    if (!lista.some((r) => r.fecha.slice(0, 10) === hoy && /· diario$/.test(r.nombre))) Respaldos.crear('diario');
    const it = Respaldos.carpeta().getFiles();
    const diarios = [];
    while (it.hasNext()) {
      const f = it.next();
      if (/· diario$/.test(f.getName())) diarios.push(f);
    }
    diarios.sort((a, b) => b.getDateCreated() - a.getDateCreated()).slice(Respaldos.CONSERVAR).forEach((f) => f.setTrashed(true));
  },

  /** Crea el activador diario (3 a. m.) si no existe. Lo llama instalar(). */
  programar() {
    const existe = ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'respaldoDiario');
    if (!existe) ScriptApp.newTrigger('respaldoDiario').timeBased().everyDays(1).atHour(3).create();
    return !existe;
  },

  estado() {
    return {
      respaldos: Respaldos.listar(),
      programado: ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'respaldoDiario'),
      conservar: Respaldos.CONSERVAR,
      migraciones: Db.all('Migraciones').sort((a, b) => b.aplicadaEn.localeCompare(a.aplicadaEn)),
      pendientes: Migraciones.pendientes().map((m) => ({ id: m.id, descripcion: m.descripcion })),
    };
  },
};

const Migraciones = {
  pendientes() {
    const hechas = Db.all('Migraciones').map((m) => m.id);
    return MIGRACIONES.filter((m) => hechas.indexOf(m.id) === -1);
  },

  /** Ejecuta las pendientes en orden, después de un respaldo. Si una falla, se detiene (las siguientes no corren). */
  ejecutar(user, opts) {
    const pendientes = Migraciones.pendientes();
    if (!pendientes.length) return [];
    if (!opts || opts.respaldar !== false) Respaldos.crear('antes de migrar ' + pendientes.map((m) => m.id).join(', '));
    pendientes.forEach((m) => {
      m.fn(user);
      Db.insert('Migraciones', { id: m.id, descripcion: m.descripcion, aplicadaEn: Util.ahora(), aplicadaPor: user.email || '' });
      Audit.log(user, 'migración', 'Sistema', m.id, { descripcion: m.descripcion });
    });
    return pendientes.map((m) => m.id);
  },
};

/** Activador nocturno (instalar lo programa a las 3 a. m.). */
function respaldoDiario() {
  Respaldos.diario();
}
