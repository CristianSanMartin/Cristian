/**
 * GS Prime ERP — configuración general y esquema de datos.
 *
 * Cada tabla es una hoja de la planilla vinculada. La primera fila es el
 * encabezado; el orden de las columnas en la hoja puede cambiar (se lee por
 * nombre), pero los nombres deben coincidir con los definidos aquí.
 *
 * Convención de Apps Script: solo las funciones globales SIN guion bajo final
 * son invocables desde el navegador (google.script.run). Toda la lógica vive
 * en objetos (Db, Auth, Preventas, ...) que no son invocables directamente;
 * el único punto de entrada del cliente es api() en Api.js.
 */

const APP = {
  nombre: 'GS Prime ERP',
  version: '2.0.0',
  tz: 'America/Santiago',
};

/** Jerarquía de roles: un rol incluye los permisos de los de menor nivel. */
const ROLES = { lectura: 1, operador: 2, admin: 3 };

/** Tipos de columna: s = texto, n = número, b = booleano, d = fecha (yyyy-MM-dd), t = fecha y hora. */
const SCHEMA = {
  Usuarios: {
    key: 'email',
    cols: { email: 's', nombre: 's', rol: 's', activo: 'b', creadoEn: 't', creadoPor: 's' },
  },
  Productos: {
    key: 'id',
    cols: {
      id: 's', sku: 's', nombre: 's', categoria: 's', juego: 's', precioVenta: 'n', stockMinimo: 'n',
      activo: 'b', notas: 's', creadoEn: 't', creadoPor: 's', actualizadoEn: 't', actualizadoPor: 's',
    },
  },
  Preventas: {
    key: 'id',
    cols: {
      id: 's', folio: 's', productoId: 's', proveedor: 's', cantidad: 'n', costoUnit: 'n', precioVenta: 'n',
      fechaPedido: 'd', fechaLlegada: 'd', estado: 's', cantidadRecibida: 'n', fechaRecepcion: 'd',
      notas: 's', creadoEn: 't', creadoPor: 's', actualizadoEn: 't', actualizadoPor: 's',
    },
  },
  Pagos: {
    key: 'id',
    cols: {
      id: 's', preventaId: 's', fecha: 'd', monto: 'n', medio: 's', nota: 's', creadoEn: 't', creadoPor: 's',
    },
  },
  Movimientos: {
    key: 'id',
    cols: {
      id: 's', fecha: 'd', productoId: 's', tipo: 's', cantidad: 'n', costoUnit: 'n', refTipo: 's', refId: 's',
      nota: 's', creadoEn: 't', creadoPor: 's',
    },
  },
  Auditoria: {
    key: null,
    cols: { fecha: 't', usuario: 's', accion: 's', entidad: 's', entidadId: 's', detalle: 's' },
  },
};

/** Estado logístico de una preventa. El estado de pago se calcula a partir de los abonos. */
const ESTADOS_PREVENTA = ['pedido', 'transito', 'recibida', 'cancelada'];

const TIPOS_MOVIMIENTO = {
  entrada_preventa: 'Entrada por preventa',
  entrada_manual: 'Entrada manual',
  salida_manual: 'Salida manual',
  ajuste: 'Ajuste de inventario',
};

const CATEGORIAS = ['Booster Box', 'Elite Trainer Box', 'Booster Bundle', 'Blister', 'Sobre', 'Colección / Tin', 'Single', 'Accesorio', 'Otro'];

const JUEGOS = ['Pokémon', 'One Piece', 'Magic: The Gathering', 'Yu-Gi-Oh!', 'Lorcana', 'Dragon Ball', 'Otro'];

const MEDIOS_PAGO = ['Transferencia', 'Efectivo', 'Tarjeta', 'Otro'];

/** Error de negocio: su mensaje se muestra tal cual al usuario. */
class AppError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'AppError';
    this.code = code || 'VALIDACION';
  }
}
