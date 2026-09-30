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
      const d = f.getDateCreated();
      res.push({ id: f.getId(), nombre: f.getName(), fecha: Util.fechaHora(d), ts: d.getTime(), url: 'https://docs.google.com/spreadsheets/d/' + f.getId() });
    }
    return res.sort((a, b) => b.ts - a.ts);
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
  ejecutar(user) {
    const pendientes = Migraciones.pendientes();
    if (!pendientes.length) return [];
    Respaldos.crear('antes de migrar ' + pendientes.map((m) => m.id).join(', '));
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
