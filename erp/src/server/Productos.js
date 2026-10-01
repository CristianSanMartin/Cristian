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
      nombre: interpretarNombre_(Util.texto(p.nombre, 'El nombre', { requerido: true, max: 150 }), 'titulo'),
      edicion: interpretarNombre_(Util.texto(p.edicion, 'La edición', { max: 80 }), 'titulo'),
      idioma: p.idioma ? Util.opcion(p.idioma, 'El idioma', IDIOMAS) : '',   // sin idioma si no se indica
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
    if (datos.imagen && !/^(https:\/\/|drive:[\w-]+$)/i.test(datos.imagen)) throw new AppError('La imagen debe ser un enlace que empiece con https://');
    const archivo = Imagenes.validar(p.imagenArchivo);

    const clave = Productos._clave(datos);
    const repetido = Db.all('Productos').find((x) => x.id !== id && Productos._clave(x) === clave);
    if (repetido) throw new AppError('Ya existe "' + Productos.nombreCompleto(repetido) + '" (' + repetido.id + ').');

    if (archivo) datos.imagen = Imagenes.subir(archivo, Productos.nombreCompleto(datos));
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

  /**
   * Producto a partir del nombre escrito (tal como viene del proveedor o como aparece
   * en el catálogo). Si existe se usa; si no, se crea con edición, idioma, tipo y
   * factor interpretados del nombre. Si se indica PVP, se actualiza en el catálogo.
   */
  resolverTexto(texto, pvp, user, imagen) {
    const raw = Util.texto(texto, 'El producto', { requerido: true, max: 200 });
    const todos = Db.all('Productos');
    const norm = Util.normalizar(raw);
    const i = interpretarNombre_(raw);
    const datos = { nombre: i.nombre || raw, edicion: i.edicion, idioma: i.idioma, tipo: i.tipo };   // si el nombre no dice el idioma, no se asume
    let prod = todos.find((x) => Util.normalizar(Productos.nombreCompleto(x)) === norm || Util.normalizar(x.id) === norm)
      || todos.find((x) => Productos._clave(x) === Productos._clave(datos));
    const precio = pvp === '' || pvp == null ? null : Util.entero(pvp, 'El precio sugerido');
    if (!prod) {
      return Productos.guardar(Object.assign(datos, { pvp: precio || 0, imagenArchivo: imagen }), user);
    }
    if (!prod.activo) throw new AppError('"' + Productos.nombreCompleto(prod) + '" está archivado. Reactívalo en Productos para usarlo.');
    const cambios = {};
    if (precio != null && precio !== prod.pvp) cambios.pvp = precio;
    const archivo = Imagenes.validar(imagen);
    if (archivo) cambios.imagen = Imagenes.subir(archivo, Productos.nombreCompleto(prod));
    if (Object.keys(cambios).length) {
      Audit.log(user, 'editar', 'Producto', prod.id, Audit.diff(prod, Object.assign({}, prod, cambios)));
      prod = Db.update('Productos', prod.id, Object.assign(cambios, Util.sello(user)));
    }
    return prod;
  },

  /**
   * Precios de venta editados desde la tabla de preventas: [{ productoId, precioVenta }].
   * Vacío (o igual al sugerido) = se acepta el precio sugerido (PVP) y lo sigue si cambia.
   * Todo o nada: si una fila tiene error no se guarda ninguna.
   */
  fijarPrecios(p, user) {
    const entrada = Array.isArray(p.precios) ? p.precios : [];
    if (!entrada.length) throw new AppError('No hay precios para guardar.');
    const cambios = entrada.map((x) => {
      const prod = Productos.requerir(x.productoId);
      const vacio = x.precioVenta === '' || x.precioVenta == null;
      const precio = vacio ? 0 : Util.entero(x.precioVenta, 'El precio de venta de ' + Productos.nombreCompleto(prod), { min: 1 });
      const manual = !vacio && precio !== prod.pvp;
      return { prod: prod, datos: { precioManual: manual, precioVenta: manual ? precio : 0 } };
    });
    cambios.forEach((c) => {
      Db.update('Productos', c.prod.id, Object.assign({}, c.datos, Util.sello(user)));
      Audit.log(user, 'editar', 'Producto', c.prod.id, Audit.diff(c.prod, Object.assign({}, c.prod, c.datos)));
    });
  },

  /** Precio de venta vigente (bruto). */
  precio(prod) {
    return prod.precioManual ? prod.precioVenta : prod.pvp;
  },

  nombreCompleto(prod) {
    return [prod.edicion, prod.nombre].filter(Boolean).join(' – ') + (prod.idioma ? ' · ' + prod.idioma : '');
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
