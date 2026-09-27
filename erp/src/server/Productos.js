/**
 * Catálogo de productos. Un producto = nombre + edición + idioma
 * (el Binder 30th en inglés y en español son dos productos).
 *
 * Precio de venta: sigue al PVP del proveedor mientras precioManual sea falso;
 * al fijarlo a mano queda independiente (DISENO.md, sección 4).
 */
const Productos = {
  guardar(p, user) {
    const id = p.id ? String(p.id) : '';
    const actual = id ? Productos.requerir(id) : null;
    const tipo = Util.opcion(p.tipo || 'Otro', 'El tipo', Object.keys(TIPOS_PRODUCTO));
    const precioManual = p.precioManual === true;
    const datos = {
      nombre: Util.texto(p.nombre, 'El nombre', { requerido: true, max: 150 }),
      edicion: Util.texto(p.edicion, 'La edición', { max: 80 }),
      idioma: Util.opcion(p.idioma || 'ENG', 'El idioma', IDIOMAS),
      tipo: tipo,
      factor: Util.entero(p.factor === '' || p.factor == null ? TIPOS_PRODUCTO[tipo] : p.factor, 'El factor de conversión', { min: 1 }),
      pvp: Util.entero(p.pvp, 'El PVP'),
      precioManual: precioManual,
      precioVenta: precioManual ? Util.entero(p.precioVenta, 'El precio de venta', { requerido: true, min: 1 }) : 0,
      stockMinimo: Util.entero(p.stockMinimo, 'El stock mínimo'),
      imagen: Util.texto(p.imagen, 'La imagen', { max: 500 }),
      codigoProveedor: Util.texto(p.codigoProveedor, 'El código del proveedor', { max: 60 }),
      notas: Util.texto(p.notas, 'Las notas', { max: 1000 }),
    };
    if (datos.imagen && !/^https:\/\//i.test(datos.imagen)) throw new AppError('La imagen debe ser un enlace que empiece con https://');

    const clave = Productos._clave(datos);
    const repetido = Db.all('Productos').find((x) => x.id !== id && Productos._clave(x) === clave);
    if (repetido) throw new AppError('Ya existe "' + Productos.nombreCompleto(repetido) + '" (' + repetido.id + ').');

    if (actual) {
      const nuevo = Db.update('Productos', id, Object.assign(datos, Util.sello(user)));
      Audit.log(user, 'editar', 'Producto', id, Audit.diff(actual, nuevo));
      return nuevo;
    }
    const nuevo = Object.assign({ id: Util.siguienteId('GS', 4), activo: true }, datos, Util.sello(user, true));
    Db.insert('Productos', nuevo);
    Audit.log(user, 'crear', 'Producto', nuevo.id, { nombre: Productos.nombreCompleto(nuevo) });
    return nuevo;
  },

  cambiarActivo(p, user) {
    const prod = Productos.requerir(p.id);
    const activo = p.activo === true;
    Db.update('Productos', prod.id, Object.assign({ activo: activo }, Util.sello(user)));
    Audit.log(user, activo ? 'reactivar' : 'archivar', 'Producto', prod.id, { nombre: Productos.nombreCompleto(prod) });
  },

  eliminar(p, user) {
    const prod = Productos.requerir(p.id);
    if (Db.all('Preventas').some((l) => l.productoId === prod.id)) {
      throw new AppError('El producto está en una preventa; archívalo en lugar de eliminarlo.');
    }
    Db.remove('Productos', prod.id);
    Audit.log(user, 'eliminar', 'Producto', prod.id, prod);
  },

  /** Precio de venta vigente (bruto). */
  precio(prod) {
    return prod.precioManual ? prod.precioVenta : prod.pvp;
  },

  nombreCompleto(prod) {
    return [prod.edicion, prod.nombre].filter(Boolean).join(' – ') + ' · ' + prod.idioma;
  },

  _clave(prod) {
    return [prod.nombre, prod.edicion, prod.idioma].map(Util.normalizar).join('|');
  },

  requerir(id) {
    const prod = Db.get('Productos', String(id || ''));
    if (!prod) throw new AppError('El producto no existe.', 'NO_ENCONTRADO');
    return prod;
  },
};
