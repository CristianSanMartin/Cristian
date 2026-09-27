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

    guardarProducto: { rol: 'operador', write: true, fn: Productos.guardar },
    archivarProducto: { rol: 'operador', write: true, fn: Productos.cambiarActivo },
    eliminarProducto: { rol: 'admin', write: true, fn: Productos.eliminar },

    guardarPreventa: { rol: 'operador', write: true, fn: Preventas.guardar },
    registrarPago: { rol: 'operador', write: true, fn: Preventas.registrarPago },
    eliminarPago: { rol: 'admin', write: true, fn: Preventas.eliminarPago },
    recibirPreventa: { rol: 'operador', write: true, fn: Preventas.recibir },
    anularRecepcion: { rol: 'admin', write: true, fn: Preventas.anularRecepcion },
    cancelarPreventa: { rol: 'operador', write: true, fn: Preventas.cancelar },
    eliminarPreventa: { rol: 'admin', write: true, fn: Preventas.eliminar },

    registrarMovimiento: { rol: 'operador', write: true, fn: Inventario.registrar },
    eliminarMovimiento: { rol: 'admin', write: true, fn: Inventario.eliminarMovimiento },

    guardarUsuario: { rol: 'admin', write: true, fn: Usuarios.guardar },
    importarLegacy: { rol: 'admin', write: true, fn: Importar.legacy },
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
 * Prepara la planilla: crea las hojas y registra a quien lo ejecuta como
 * primer administrador. Se ejecuta una vez desde el editor de Apps Script
 * (o desde el menú "GS Prime ERP" de la planilla). Es idempotente.
 */
function instalar() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Ejecuta instalar() desde el proyecto de Apps Script vinculado a la planilla del ERP.');
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  Db._ss = ss;
  Db.reset();
  Object.keys(SCHEMA).forEach((t) => Db.ensureSheet(t));
  const hoja = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (hoja && hoja.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(hoja);

  // Solo se crea un administrador cuando todavía no hay usuarios: evita que
  // alguien con acceso a la app se autoasigne permisos llamando a instalar().
  const email = Auth.email();
  const mensaje = [];
  if (Db.all('Usuarios').length === 0) {
    if (!email) throw new Error('No se pudo leer tu correo de Google para registrarte como administrador.');
    Db.insert('Usuarios', { email: email, nombre: email.split('@')[0], rol: 'admin', activo: true, creadoEn: Util.ahora(), creadoPor: 'instalar' });
    Audit.log({ email: email }, 'instalar', 'Sistema', '', { version: APP.version });
    mensaje.push(email + ' quedó registrado como administrador.');
  }
  mensaje.push('Hojas listas: ' + Object.keys(SCHEMA).join(', ') + '.');
  return mensaje.join(' ');
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('GS Prime ERP')
    .addItem('Instalar / reparar hojas', 'instalarDesdeMenu')
    .addToUi();
}

function instalarDesdeMenu() {
  SpreadsheetApp.getUi().alert(instalar());
}

/** Foto completa de los datos visibles para el usuario, con los cálculos ya hechos. */
const Snapshot = {
  build(user) {
    const productos = Db.all('Productos');
    const preventas = Db.all('Preventas');
    const pagos = Db.all('Pagos');
    const inv = Inventario.calcular(Db.all('Movimientos'));
    const prodPorId = {};
    productos.forEach((p) => { prodPorId[p.id] = p; });

    const abonadoPor = {};
    pagos.forEach((x) => { abonadoPor[x.preventaId] = (abonadoPor[x.preventaId] || 0) + x.monto; });

    const entrante = {};
    const pvs = preventas.map((pv) => {
      const total = pv.cantidad * pv.costoUnit;
      const abonado = abonadoPor[pv.id] || 0;
      if (pv.estado === 'pedido' || pv.estado === 'transito') entrante[pv.productoId] = (entrante[pv.productoId] || 0) + pv.cantidad;
      const prod = prodPorId[pv.productoId];
      return Object.assign(pv, {
        producto: prod ? prod.nombre : '(producto eliminado)',
        sku: prod ? prod.sku : '',
        total: total,
        abonado: abonado,
        saldo: Math.max(total - abonado, 0),
        estadoPago: Preventas.estadoPago(total, abonado),
      });
    });

    const prods = productos.map((p) => {
      const e = inv.porProducto[p.id] || { stock: 0, costoPromedio: 0, valor: 0, ultimoMovimiento: '' };
      return Object.assign(p, e, { entrante: entrante[p.id] || 0 });
    });

    const esAdmin = Auth.puede(user, 'admin');
    return {
      app: { nombre: APP.nombre, version: APP.version },
      hoy: Util.hoy(),
      user: { email: user.email, nombre: user.nombre, rol: user.rol },
      catalogos: { categorias: CATEGORIAS, juegos: JUEGOS, mediosPago: MEDIOS_PAGO, tiposMovimiento: TIPOS_MOVIMIENTO },
      productos: prods,
      preventas: pvs,
      pagos: pagos,
      movimientos: inv.kardex,
      proveedores: Array.from(new Set(preventas.map((x) => x.proveedor).filter(Boolean))).sort(),
      usuarios: esAdmin ? Db.all('Usuarios') : [],
    };
  },

  auditoria() {
    return Db.all('Auditoria').slice(-300).reverse();
  },
};
