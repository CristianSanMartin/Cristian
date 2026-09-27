/** Administración de usuarios y roles (solo administradores). */
const Usuarios = {
  guardar(p, user) {
    const email = Util.email(p.email);
    const actual = Db.get('Usuarios', email);
    const datos = {
      nombre: Util.texto(p.nombre, 'El nombre', { requerido: true, max: 80 }),
      rol: Util.opcion(p.rol, 'El rol', Object.keys(ROLES)),
      activo: p.activo !== false,
    };
    if (actual && actual.rol === 'admin' && (datos.rol !== 'admin' || !datos.activo) && Usuarios._adminsActivos() <= 1) {
      throw new AppError('Debe quedar al menos un administrador activo.');
    }
    if (actual) {
      const nuevo = Db.update('Usuarios', email, datos);
      Audit.log(user, 'editar', 'Usuario', email, Audit.diff(actual, nuevo));
      return nuevo;
    }
    const nuevo = Object.assign({ email: email, creadoEn: Util.ahora(), creadoPor: user.email }, datos);
    Db.insert('Usuarios', nuevo);
    Audit.log(user, 'crear', 'Usuario', email, { rol: nuevo.rol });
    return nuevo;
  },

  _adminsActivos() {
    return Db.all('Usuarios').filter((u) => u.activo && u.rol === 'admin').length;
  },
};

/**
 * Importa las preventas del ERP anterior (archivo HTML con localStorage).
 * Recibe el JSON guardado bajo la clave "gsprime_erp_preventas_v1".
 */
const Importar = {
  ESTADOS: { pendiente: 'pedido', parcial: 'pedido', pagado: 'pedido', transito: 'transito', recibido: 'recibida' },

  legacy(p, user) {
    let lista;
    try {
      lista = JSON.parse(String(p.json || ''));
    } catch (e) {
      throw new AppError('El texto pegado no es un JSON válido.');
    }
    if (!Array.isArray(lista)) throw new AppError('Se esperaba una lista de preventas.');
    if (lista.length > 500) throw new AppError('Máximo 500 preventas por importación.');

    const errores = [];
    let importadas = 0;
    lista.forEach((x, i) => {
      try {
        Importar._una(x || {}, user);
        importadas++;
      } catch (e) {
        errores.push('Fila ' + (i + 1) + ' (' + (x && x.producto ? x.producto : 'sin producto') + '): ' + e.message);
      }
    });
    Audit.log(user, 'importar', 'Preventa', '', { importadas: importadas, errores: errores.length });
    return { importadas: importadas, errores: errores };
  },

  _una(x, user) {
    const estadoLegacy = Importar.ESTADOS[x.estado] ? x.estado : 'pendiente';
    const prod = Productos.obtenerOCrear(Util.texto(x.producto, 'El producto', { requerido: true, max: 150 }), { precioVenta: x.precioVenta || 0 }, user);
    const cantidad = Number(x.cantidad) || 0;
    const costoUnit = Math.round(Number(x.costoUnit) || 0);
    const abono = Math.min(Math.round(Number(x.abono) || 0), cantidad * costoUnit);
    const fechaPedido = Util.fecha(x.fechaPedido, 'La fecha de pedido', { defecto: Util.hoy() });
    const pv = Preventas.guardar({
      productoId: prod.id,
      proveedor: x.proveedor,
      cantidad: cantidad,
      costoUnit: costoUnit,
      precioVenta: Math.round(Number(x.precioVenta) || 0),
      fechaPedido: fechaPedido,
      fechaLlegada: x.fechaLlegada && x.fechaLlegada >= fechaPedido ? x.fechaLlegada : fechaPedido,
      estado: estadoLegacy === 'transito' ? 'transito' : 'pedido',
      notas: [x.notas, 'Importada del ERP anterior'].filter(Boolean).join('\n'),
      abonoInicial: abono,
      medioPago: 'Otro',
    }, user);
    if (Importar.ESTADOS[estadoLegacy] === 'recibida') {
      Preventas.recibir({ id: pv.id, cantidadRecibida: pv.cantidad, fecha: pv.fechaLlegada }, user);
    }
  },
};
