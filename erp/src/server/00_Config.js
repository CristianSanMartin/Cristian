/**
 * GS Prime ERP — configuración general y esquema de datos.
 *
 * Cada tabla es una hoja de la planilla vinculada. La primera fila es el
 * encabezado; las columnas se leen por nombre, así que pueden reordenarse,
 * pero los nombres deben coincidir con los definidos aquí.
 *
 * Convención de Apps Script: solo las funciones globales SIN guion bajo final
 * son invocables desde el navegador (google.script.run). Toda la lógica vive
 * en objetos (Db, Auth, Preventas, ...) que no son invocables directamente;
 * el único punto de entrada del cliente es api() en Api.js.
 *
 * Diseño funcional completo: erp/DISENO.md
 */

const APP = {
  nombre: 'GS Prime ERP',
  version: '2.1.0',
  tz: 'America/Santiago',
  iva: 0.19,
};

/** Jerarquía de roles: un rol incluye los permisos de los de menor nivel. */
const ROLES = { lectura: 1, operador: 2, admin: 3 };

/** Campos de auditoría comunes. */
const AUDIT_COLS = { creadoEn: 't', creadoPor: 's', actualizadoEn: 't', actualizadoPor: 's' };

/** Tipos de columna: s = texto, n = número, b = booleano, d = fecha (yyyy-MM-dd), t = fecha y hora. */
const SCHEMA = {
  Usuarios: {
    key: 'email',
    cols: { email: 's', nombre: 's', rol: 's', activo: 'b', creadoEn: 't', creadoPor: 's' },
  },
  Secuencias: {
    key: 'clave',
    cols: { clave: 's', valor: 'n' },
  },
  Proveedores: {
    key: 'id',
    cols: Object.assign({
      id: 's', nombre: 's', rut: 's', contacto: 's', despachoUmbral: 'n', despachoMonto: 'n', activo: 'b', notas: 's',
    }, AUDIT_COLS),
  },
  Productos: {
    key: 'id',
    cols: Object.assign({
      id: 's', nombre: 's', edicion: 's', idioma: 's', tipo: 's', factor: 'n', pvp: 'n', precioVenta: 'n',
      precioManual: 'b', stockMinimo: 'n', imagen: 's', codigoProveedor: 's', activo: 'b', notas: 's',
    }, AUDIT_COLS),
  },
  Preventas: {
    key: 'id',
    cols: Object.assign({ id: 's', proveedorId: 's', edicion: 's', fecha: 'd', notas: 's' }, AUDIT_COLS),
  },
  Preventas_Lineas: {
    key: 'id',
    cols: Object.assign({
      id: 's', preventaId: 's', productoId: 's', lanzamiento: 'd', solicitado: 'n', asignado: 'n', estado: 's',
      costoNeto: 'n', notas: 's',
    }, AUDIT_COLS),
  },
  Auditoria: {
    key: null,
    cols: { fecha: 't', usuario: 's', accion: 's', entidad: 's', entidadId: 's', detalle: 's' },
  },
};

/** Hojas de versiones anteriores que instalar() elimina si están vacías. */
const HOJAS_OBSOLETAS = ['Pagos', 'Movimientos'];

const IDIOMAS = ['ENG', 'ESP', 'JPN', 'Otro'];

/** Tipos de producto y su factor de conversión por defecto (unidades del proveedor por unidad comercial). */
const TIPOS_PRODUCTO = {
  'Booster Box': 36,
  'Elite Trainer Box': 1,
  'Booster Bundle': 1,
  'Battle Deck': 1,
  'Mini Tin': 1,
  'Tin': 1,
  'Binder / Colección': 1,
  'Premium Collection': 1,
  'Blister': 1,
  'Sobre': 1,
  'Accesorio': 1,
  'Otro': 1,
};

/**
 * Estado de una línea de preventa:
 * solicitada → asignada (o sin_asignacion si el proveedor asignó 0) → en_compra → recibida.
 */
const ESTADOS_LINEA = ['solicitada', 'asignada', 'sin_asignacion', 'en_compra', 'recibida'];

/** Error de negocio: su mensaje se muestra tal cual al usuario. */
class AppError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'AppError';
    this.code = code || 'VALIDACION';
  }
}
