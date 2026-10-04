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
  version: '2.9.1',
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
  /** Una fila = un producto solicitado a un proveedor (PVI-000001). */
  Preventas: {
    key: 'id',
    cols: Object.assign({
      id: 's', proveedorId: 's', productoId: 's', lanzamiento: 'd', solicitado: 'n', asignado: 'n',
      estado: 's', costoNeto: 'n', notas: 's',
    }, AUDIT_COLS),
  },
  /** Factura de un proveedor (CP-0001). */
  Compras: {
    key: 'id',
    cols: Object.assign({
      id: 's', proveedorId: 's', factura: 's', fecha: 'd', despacho: 'n', notas: 's',
    }, AUDIT_COLS),
  },
  /** Línea de la factura (CPI-000001) = un lote del inventario. despacho = parte prorrateada del despacho. */
  Compras_Lineas: {
    key: 'id',
    cols: Object.assign({
      id: 's', compraId: 's', preventaId: 's', productoId: 's', cantidad: 'n', costoNeto: 'n', despacho: 'n',
    }, AUDIT_COLS),
  },
  Clientes: {
    key: 'id',
    cols: Object.assign({
      id: 's', nombre: 's', idPokemon: 's', telefono: 's', instagram: 's', notas: 's', activo: 'b',
    }, AUDIT_COLS),
  },
  /** Venta (OC-0001). abono = lo pagado al registrarla; lo demás se cobra con Cobros. comision = del medio de pago, al vender. */
  Ventas: {
    key: 'id',
    cols: Object.assign({
      id: 's', fecha: 'd', clienteId: 's', canal: 's', evento: 's', medioPago: 's', boleta: 's',
      abono: 'n', comision: 'n', anulada: 'b', notas: 's',
    }, AUDIT_COLS),
  },
  /** Línea de venta: unidades que salen de UN lote (CPI). costo = costo unitario del lote al vender. */
  Ventas_Lineas: {
    key: 'id',
    cols: Object.assign({
      id: 's', ventaId: 's', loteId: 's', productoId: 's', cantidad: 'n', precioLista: 'n', precio: 'n', costo: 'n',
      // Líneas por monto (sin producto del inventario): singles, torneo, bazar, ajuste…
      categoria: 's', descripcion: 's',
    }, AUDIT_COLS),
  },
  /** Abonos a ventas que quedaron pendientes de pago (cuentas por cobrar). */
  Cobros: {
    key: 'id',
    cols: Object.assign({
      id: 's', ventaId: 's', fecha: 'd', monto: 'n', medioPago: 's', notas: 's',
    }, AUDIT_COLS),
  },
  /** Unidades que salen del stock sin ser venta: premios de torneo, cajas abiertas, uso interno. costo = del lote. */
  Salidas: {
    key: 'id',
    cols: Object.assign({
      id: 's', fecha: 'd', motivo: 's', loteId: 's', productoId: 's', cantidad: 'n', costo: 'n', notas: 's', anulada: 'b',
    }, AUDIT_COLS),
  },
  /**
   * Finanzas: movimientos de caja que no son venta ni factura de compra (aportes de capital,
   * GAV, GOPM, pagos al SII, comisiones, compras por monto como singles o bazar…).
   * tipo: ingreso | egreso. monto siempre positivo.
   */
  Finanzas: {
    key: 'id',
    cols: Object.assign({
      id: 's', fecha: 'd', tipo: 's', categoria: 's', subcategoria: 's', monto: 'n', cuenta: 's', referencia: 's', notas: 's', anulado: 'b',
    }, AUDIT_COLS),
  },
  /** Zona de migración de la caja diaria: una fila por movimiento del Excel. */
  Migracion_Caja: {
    key: 'id',
    cols: {
      id: 's', fila: 'n', fecha: 'd', glosa: 's', entradas: 'n', salidas: 'n', detalle: 's', obs: 's', oc: 's', clave: 's', descartada: 'b', nota: 's',
      // Destino propio de la fila (vacío = el de su grupo) y lo que se creó al migrarla (vacío = pendiente).
      accion: 's', destino: 's', extra: 's', migrada: 's', firma: 's',
    },
  },
  /** Toma de inventario: foto de lo que debería haber, conteo unidad por unidad y cierre con ajustes. */
  Tomas: {
    key: 'id',
    cols: Object.assign({
      id: 's', fecha: 'd', estado: 's', notas: 's', cerradaEn: 't', cerradaPor: 's', resumen: 's',
    }, AUDIT_COLS),
  },
  /**
   * Una fila por lote con stock al iniciar la toma (esperado y marcas: "x" encontrada, "-" no),
   * más una fila por producto con unidades de sobra (loteId vacío, sobrante > 0).
   */
  Tomas_Lineas: {
    key: 'id',
    cols: { id: 's', tomaId: 's', productoId: 's', loteId: 's', esperado: 'n', marcas: 's', sobrante: 'n' },
  },
  /** Zona de migración: el Excel histórico unidad por unidad, para revisar antes de importar. */
  Migracion: {
    key: 'id',
    cols: {
      id: 's', fila: 'n', proveedor: 's', factura: 's', serie: 's', producto: 's', costo: 'n', venta: 'n',
      oc: 's', cliente: 's', boleta: 's', descartada: 'b', nota: 's',
    },
  },
  /** Homologación de la migración: cómo queda cada proveedor, factura, producto y cliente del Excel. */
  Migracion_Mapeos: {
    key: 'clave',
    cols: { clave: 's', tipo: 's', original: 's', destino: 's', accion: 's', extra: 's', confirmado: 'b' },
  },
  /** Migraciones de datos ya aplicadas (ver Respaldos.js). */
  Migraciones: {
    key: 'id',
    cols: { id: 's', descripcion: 's', aplicadaEn: 't', aplicadaPor: 's' },
  },
  /** Hallazgos de la Validación de datos que el administrador revisó (clave = regla|registro). */
  Validaciones: {
    key: 'clave',
    cols: { clave: 's', firma: 's', estado: 's', nota: 's', actualizadoEn: 't', actualizadoPor: 's' },
  },
  Auditoria: {
    key: null,
    cols: { fecha: 't', usuario: 's', accion: 's', entidad: 's', entidadId: 's', detalle: 's' },
  },
};

/** Hojas de versiones anteriores que instalar() elimina si están vacías. */
const HOJAS_OBSOLETAS = ['Pagos', 'Movimientos', 'Preventas_Lineas'];

const IDIOMAS = ['ENG', 'ESP', 'JPN', 'Otro'];

/** Motivos de salida de stock que no son venta. */
const MOTIVOS_SALIDA = { premio: 'Premio', apertura: 'Caja abierta', interno: 'Uso interno', perdida: 'Pérdida' };

/** Ventas por monto (sin unidades del inventario). Torneo = ingreso por servicio. */
const CATEGORIAS_VENTA = ['Singles', 'Torneo', 'Sobres sueltos', 'Bazar', 'Accesorios', 'Ajuste', 'Otro'];
/**
 * Las OC son solo para productos sellados del inventario. Una venta solo por monto de estas
 * categorías lleva su propio correlativo (SGL-0001, TOR-0001…). Ajuste y Otro siguen como OC.
 */
const PREFIJOS_VENTA = { 'Singles': 'SGL', 'Torneo': 'TOR', 'Sobres sueltos': 'SOB', 'Bazar': 'BAZ', 'Accesorios': 'ACC' };

/** Finanzas: categorías de movimientos (la subcategoría es texto libre: socio, proveedor, concepto). */
const CATEGORIAS_MOVIMIENTO = {
  ingreso: { aporte: 'Aporte de capital', otro_ingreso: 'Otro ingreso' },
  egreso: {
    compra: 'Compra por monto', gav: 'GAV', gopm: 'GOPM (puesta en marcha)', sii: 'Pago SII', comision: 'Comisión', retiro: 'Retiro de socio', otro_egreso: 'Otro egreso',
  },
};
const CUENTAS = { caja: 'Caja (efectivo)', banco: 'Banco', tuu: 'TUU' };

/** Ventas: canal (Tienda por defecto) y medios de pago. */
const CANALES = ['Tienda', 'Evento', 'Instagram', 'WhatsApp', 'Otro'];
const MEDIOS_PAGO = { efectivo: 'Efectivo', transferencia: 'Transferencia', debito: 'Débito', credito: 'Crédito', otro: 'Otro' };
/**
 * Comisión de la máquina POS (TUU, comisión mixta con abono a 2 días): % sobre la venta + monto fijo por venta.
 * Es un gasto (GAV) y se descuenta de la ganancia de la venta.
 */
const COMISIONES_PAGO = {
  debito: { pct: 0.0077, fijo: 65 },
  credito: { pct: 0.0077, fijo: 65 },
};

/** Tipos de producto y su factor de conversión por defecto (unidades del proveedor por unidad comercial). */
const TIPOS_PRODUCTO = {
  // En orden alfabético, con "Otro" al final (así aparecen en las listas).
  'Accesorios': 1,
  'Battle Deck': 1,
  'Binder Colección': 1,
  'Blister': 1,
  'Booster Box': 36,
  'Booster Bundle': 1,
  'Box': 1,
  'Elite Trainer Box': 1,
  'Poster Collection': 1,
  'Premium Collection': 1,
  'Sobre': 1,
  'Tech Sticker': 1,
  'Tin / Mini Tin': 1,
  'UPC': 1,
  'Otro': 1,
};

/**
 * Estado de una preventa (un producto solicitado):
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
