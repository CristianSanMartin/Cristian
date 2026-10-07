/**
 * Puntos de entrada de la aplicación web.
 *
 * El navegador solo llama a api(accion, datos). Cada ruta declara el rol
 * mínimo y si escribe; las escrituras se serializan con LockService para que
 * dos usuarios no pisen la misma fila, y devuelven la foto actualizada de los
 * datos para que el cliente se refresque sin otra llamada.
 */

function doGet() {
  return HtmlService.createTemplateFromFile('client/index')
    .evaluate()
    .setTitle('GS Prime · ERP')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Inserta el contenido de otro archivo HTML del proyecto (usado desde las plantillas). */
function include_(nombre) {
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}

function rutas_() {
  return {
    bootstrap: { rol: 'lectura', fn: (p, u) => Snapshot.build(u) },
    auditoria: { rol: 'admin', fn: () => Snapshot.auditoria() },

    guardarProveedor: { rol: 'operador', write: true, fn: Proveedores.guardar },
    archivarProveedor: { rol: 'operador', write: true, fn: Proveedores.cambiarActivo },

    guardarProducto: { rol: 'operador', write: true, fn: Productos.guardar },
    archivarProducto: { rol: 'operador', write: true, fn: Productos.cambiarActivo },
    eliminarProducto: { rol: 'admin', write: true, fn: Productos.eliminar },

    guardarPreventa: { rol: 'operador', write: true, fn: Preventas.guardar },
    eliminarPreventa: { rol: 'operador', write: true, fn: Preventas.eliminar },
    registrarAsignacion: { rol: 'operador', write: true, fn: Preventas.registrarAsignacion },
    fijarPreciosVenta: { rol: 'operador', write: true, fn: Productos.fijarPrecios },

    crearCompra: { rol: 'operador', write: true, fn: Compras.crear },
    anularCompra: { rol: 'admin', write: true, fn: Compras.anular },
    quitarLineaCompra: { rol: 'admin', write: true, fn: Compras.quitarLinea },
    editarCompra: { rol: 'admin', write: true, fn: Compras.editar },
    agregarLineaCompra: { rol: 'admin', write: true, fn: Compras.agregarLinea },
    registrarPagoCompra: { rol: 'operador', write: true, fn: Compras.registrarPago },
    anularPagoCompra: { rol: 'admin', write: true, fn: Compras.anularPago },
    reenlazarPagoCompra: { rol: 'admin', write: true, fn: Compras.reenlazarPago },
    registrarSalida: { rol: 'operador', write: true, fn: Salidas.registrar },
    anularSalida: { rol: 'admin', write: true, fn: Salidas.anular },
    cerrarMigracion: { rol: 'admin', write: true, fn: (p, u) => Migracion.cerrar(p, u) },
    reabrirMigracion: { rol: 'admin', write: true, fn: (p, u) => Migracion.reabrir(p, u) },
    unirProductos: { rol: 'admin', write: true, fn: Productos.unir },
    cajaEstado: { rol: 'admin', fn: () => MigracionCaja.estado() },
    cajaCargar: { rol: 'admin', write: true, fn: MigracionCaja.cargar },
    cajaMapeos: { rol: 'admin', write: true, fn: MigracionCaja.guardarMapeos },
    cajaFilas: { rol: 'admin', write: true, fn: MigracionCaja.guardarFilas },
    cajaMigrar: { rol: 'admin', write: true, fn: MigracionCaja.migrar },
    cajaLimpiar: { rol: 'admin', write: true, fn: MigracionCaja.limpiar },
    editarVenta: { rol: 'admin', write: true, fn: Ventas.editar },
    reclasificarVenta: { rol: 'admin', write: true, fn: Ventas.reclasificar },
    ocOriginales: { rol: 'admin', fn: (p, u) => Ventas.numerosOriginales({ aplicar: false }, u) },
    renumerarOc: { rol: 'admin', write: true, fn: (p, u) => Ventas.numerosOriginales({ aplicar: true }, u) },
    guardarMovimiento: { rol: 'operador', write: true, fn: Finanzas.guardar },
    anularMovimiento: { rol: 'admin', write: true, fn: Finanzas.anular },
    dividirMovimiento: { rol: 'admin', write: true, fn: Finanzas.dividir },
    iniciarToma: { rol: 'operador', write: true, fn: Tomas.iniciar },
    guardarToma: { rol: 'operador', write: true, fn: Tomas.guardar },
    cerrarToma: { rol: 'admin', write: true, fn: Tomas.cerrar },
    anularToma: { rol: 'admin', write: true, fn: Tomas.anular },

    crearVenta: { rol: 'operador', write: true, fn: Ventas.crear },
    registrarCobro: { rol: 'operador', write: true, fn: Ventas.registrarCobro },
    anularVenta: { rol: 'admin', write: true, fn: Ventas.anular },
    liberarNumeroVenta: { rol: 'admin', write: true, fn: Ventas.liberarNumero },
    guardarCliente: { rol: 'operador', write: true, fn: Clientes.guardar },

    validacion: { rol: 'admin', fn: (p, u) => Validacion.revisar(u) },
    validarHallazgos: { rol: 'admin', write: true, fn: Validacion.marcar },
    respaldos: { rol: 'admin', fn: () => Respaldos.estado() },
    crearRespaldo: { rol: 'admin', write: true, fn: (p, u) => Respaldos.crear('manual', u) },
    exportarDemo: { rol: 'admin', fn: Respaldos.exportarDemo },

    migracion: { rol: 'admin', fn: () => Migracion.estado() },
    migracionCargar: { rol: 'admin', write: true, fn: Migracion.cargar },
    migracionMapeos: { rol: 'admin', write: true, fn: Migracion.guardarMapeos },
    migracionFilas: { rol: 'admin', write: true, fn: Migracion.guardarFilas },
    migracionImportar: { rol: 'admin', write: true, fn: Migracion.importar },
    migracionLimpiar: { rol: 'admin', write: true, fn: Migracion.limpiar },

    guardarUsuario: { rol: 'admin', write: true, fn: Usuarios.guardar },
  };
}

function api(accion, datos) {
  try {
    const ruta = rutas_()[accion];
    if (!ruta) throw new AppError('Acción desconocida: ' + accion);
    Db.reset();
    const user = Auth.current();
    Auth.require(user, ruta.rol);
    const payload = datos && typeof datos === 'object' ? datos : {};

    if (!ruta.write) return { ok: true, data: ruta.fn(payload, user) };

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw new AppError('El sistema está ocupado con otra operación. Intenta de nuevo en unos segundos.', 'OCUPADO');
    let result;
    try {
      result = ruta.fn(payload, user);
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }
    Db.reset();
    return { ok: true, result: result == null ? null : JSON.parse(JSON.stringify(result)), data: Snapshot.build(user) };
  } catch (err) {
    if (!(err instanceof AppError)) console.error(accion, err && err.stack ? err.stack : err);
    return {
      ok: false,
      code: err instanceof AppError ? err.code : 'ERROR_INTERNO',
      error: err instanceof AppError ? err.message : 'Error inesperado: ' + (err && err.message ? err.message : err),
    };
  }
}

/**
 * Prepara la planilla: crea o actualiza las hojas, registra a quien lo ejecuta
 * como primer administrador y carga el proveedor Asmodee. Se ejecuta desde el
 * editor de Apps Script (o el menú "GS Prime ERP" de la planilla). Es idempotente:
 * nunca borra datos; las hojas vacías quedan con el encabezado de esta versión.
 */
function instalar() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Ejecuta instalar() desde el proyecto de Apps Script vinculado a la planilla del ERP.');
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  Db._ss = ss;
  Db.reset();
  const mensaje = [];

  // v2.1 usaba "Preventas" como encabezado de proforma. Si tiene datos, se respalda antes de crear la nueva.
  const antigua = ss.getSheetByName('Preventas');
  if (antigua && antigua.getLastRow() > 1) {
    const enc = antigua.getRange(1, 1, 1, antigua.getLastColumn()).getValues()[0].map(String);
    if (enc.indexOf('productoId') === -1) {
      antigua.setName('Preventas_v2_1');
      mensaje.push('La hoja "Preventas" de la versión anterior se renombró a "Preventas_v2_1" como respaldo.');
    }
  }
  // Si la planilla ya tiene datos, primero se respalda (así cualquier cambio de estructura se puede deshacer).
  const conDatos = ['Preventas', 'Compras', 'Ventas'].some((t) => { const h = ss.getSheetByName(t); return h && h.getLastRow() > 1; });
  if (conDatos) {
    const r = Respaldos.crear('antes de instalar v' + APP.version);
    mensaje.push('Respaldo creado: "' + r.nombre + '".');
  }
  Object.keys(SCHEMA).forEach((t) => Db.ensureSheet(t));

  HOJAS_OBSOLETAS.concat(['Hoja 1', 'Sheet1']).forEach((nombre) => {
    const hoja = ss.getSheetByName(nombre);
    if (hoja && hoja.getLastRow() <= 1 && ss.getSheets().length > 1) {
      ss.deleteSheet(hoja);
      if (HOJAS_OBSOLETAS.indexOf(nombre) !== -1) mensaje.push('Se eliminó la hoja vacía "' + nombre + '" de la versión anterior.');
    }
  });

  // Solo se crea un administrador cuando todavía no hay usuarios: evita que
  // alguien con acceso a la app se autoasigne permisos llamando a instalar().
  const email = Auth.email();
  if (Db.all('Usuarios').length === 0) {
    if (!email) throw new Error('No se pudo leer tu correo de Google para registrarte como administrador.');
    Db.insert('Usuarios', { email: email, nombre: email.split('@')[0], rol: 'admin', activo: true, creadoEn: Util.ahora(), creadoPor: 'instalar' });
    mensaje.push(email + ' quedó registrado como administrador.');
  }
  const sistema = { email: email || 'instalar' };
  if (Db.all('Proveedores').length === 0) {
    Db.insert('Proveedores', Object.assign({
      id: Util.siguienteId('PRV', 3), nombre: 'Asmodee', rut: '', contacto: '',
      despachoUmbral: 1000000, despachoMonto: 15000, activo: true, notas: 'Despacho gratis desde $1.000.000 neto; si no, $15.000 neto.',
    }, Util.sello(sistema, true)));
    mensaje.push('Proveedor Asmodee creado con su regla de despacho.');
  }
  const migradas = Migraciones.ejecutar(sistema, { respaldar: conDatos });   // planilla vacía: nada que respaldar
  if (migradas.length) mensaje.push('Migraciones aplicadas: ' + migradas.join(', ') + '.');
  if (Respaldos.programar()) mensaje.push('Respaldo automático programado todas las noches (se guardan los últimos ' + Respaldos.CONSERVAR + ').');
  if (Imagenes.preparar()) mensaje.push('Se creó la carpeta "' + Imagenes.NOMBRE_CARPETA + '" en tu Google Drive para las imágenes de productos.');
  Audit.log(sistema, 'instalar', 'Sistema', '', { version: APP.version });
  mensaje.push('Hojas listas (versión ' + APP.version + '): ' + Object.keys(SCHEMA).join(', ') + '.');
  return mensaje.join(' ');
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('GS Prime ERP')
    .addItem('Instalar / actualizar hojas', 'instalarDesdeMenu')
    .addToUi();
}

function instalarDesdeMenu() {
  SpreadsheetApp.getUi().alert(instalar());
}

/** Foto completa de los datos visibles para el usuario, con los cálculos ya hechos. */
const Snapshot = {
  build(user) {
    const proveedores = Db.all('Proveedores');
    const productos = Db.all('Productos');
    const preventas = Preventas.vista(productos, proveedores);
    const clientes = Db.all('Clientes');
    const ventas = Ventas.vista(productos, clientes);
    const compras = Compras.vista(productos, proveedores, ventas.porLote);
    // Factura en la que quedó cada preventa recibida.
    const facturaDe = {};
    compras.lotes.forEach((l) => { facturaDe[l.preventaId] = { compraId: l.compraId, factura: l.factura }; });
    preventas.forEach((pv) => Object.assign(pv, facturaDe[pv.id] || { compraId: '', factura: '' }));

    // Último costo neto conocido de cada producto (de su preventa con lanzamiento más reciente).
    const ultimoCosto = {};
    preventas.forEach((pv) => {
      const prev = ultimoCosto[pv.productoId];
      if (!prev || pv.lanzamiento >= prev.fecha) ultimoCosto[pv.productoId] = { fecha: pv.lanzamiento, costo: pv.costoNeto };
    });
    const prods = productos.map((p) => {
      const costo = ultimoCosto[p.id] ? ultimoCosto[p.id].costo : 0;
      const e = Economia.unidad(costo, Productos.precio(p));
      return Object.assign(p, {
        nombreCompleto: Productos.nombreCompleto(p),
        precio: Productos.precio(p),
        ultimoCosto: costo,
        gananciaUnidad: costo ? e.ganancia : null,
        margen: costo ? e.margen : null,
      });
    });

    // Ficha de cada cliente: compras, total gastado, deuda y última compra (ventas no anuladas).
    const clis = clientes.map((c) => {
      const suyas = ventas.ventas.filter((v) => v.clienteId === c.id && !v.anulada);
      return Object.assign(c, {
        compras: suyas.length,
        totalGastado: suyas.reduce((t, v) => t + v.total, 0),
        deuda: suyas.reduce((t, v) => t + v.saldo, 0),
        ultimaCompra: suyas.reduce((m, v) => (v.fecha > m ? v.fecha : m), ''),
      });
    });

    return {
      app: { nombre: APP.nombre, version: APP.version, iva: APP.iva, migracionCerrada: Migracion.cerrada() },
      hoy: Util.hoy(),
      user: { email: user.email, nombre: user.nombre, rol: user.rol },
      catalogos: {
        idiomas: IDIOMAS, tipos: TIPOS_PRODUCTO, canales: CANALES, mediosPago: MEDIOS_PAGO, comisiones: COMISIONES_PAGO,
        categoriasVenta: CATEGORIAS_VENTA, motivosSalida: MOTIVOS_SALIDA, categoriasMovimiento: CATEGORIAS_MOVIMIENTO, cuentas: CUENTAS,
      },
      proveedores: proveedores,
      productos: prods,
      preventas: preventas,
      compras: compras.compras,
      lotes: compras.lotes,
      tomas: Tomas.vista(),
      movimientos: Finanzas.vista(),
      pagosFacturas: Compras.pagos(),
      salidas: Salidas.vista(),
      // Filas de la caja diaria aún sin migrar, por glosa (para avisarlo en Finanzas).
      cajaPendiente: Auth.puede(user, 'admin') ? Db.all('Migracion_Caja').filter((f) => !f.migrada && !f.descartada)
        .reduce((o, f) => { const k = f.glosa || 'Sin glosa'; o[k] = (o[k] || 0) + 1; return o; }, {}) : {},
      ventas: ventas.ventas,
      clientes: clis,
      usuarios: Auth.puede(user, 'admin') ? Db.all('Usuarios') : [],
    };
  },

  auditoria() {
    return Db.all('Auditoria').slice(-300).reverse();
  },
};
