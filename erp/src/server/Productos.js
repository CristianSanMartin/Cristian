/** Catálogo de productos. El stock no se guarda aquí: se calcula desde Movimientos. */
const Productos = {
  guardar(p, user) {
    const todos = Db.all('Productos');
    const id = p.id ? String(p.id) : '';
    const actual = id ? todos.find((x) => x.id === id) : null;
    if (id && !actual) throw new AppError('El producto no existe.', 'NO_ENCONTRADO');

    const datos = {
      nombre: Util.texto(p.nombre, 'El nombre', { requerido: true, max: 150 }),
      sku: Util.texto(p.sku, 'El SKU', { max: 40 }).toUpperCase(),
      categoria: Util.opcion(p.categoria || 'Otro', 'La categoría', CATEGORIAS),
      juego: Util.opcion(p.juego || 'Otro', 'El juego', JUEGOS),
      precioVenta: Util.entero(p.precioVenta, 'El precio de venta'),
      stockMinimo: Util.entero(p.stockMinimo, 'El stock mínimo'),
      notas: Util.texto(p.notas, 'Las notas', { max: 1000 }),
    };

    const otros = todos.filter((x) => x.id !== id);
    const nombreNorm = Util.normalizar(datos.nombre);
    if (otros.some((x) => Util.normalizar(x.nombre) === nombreNorm)) {
      throw new AppError('Ya existe un producto llamado "' + datos.nombre + '".');
    }
    if (!datos.sku) datos.sku = actual && actual.sku ? actual.sku : Util.siguienteCodigo('GS', todos.map((x) => x.sku));
    if (otros.some((x) => x.sku === datos.sku)) throw new AppError('El SKU ' + datos.sku + ' ya está en uso.');

    const ahora = Util.ahora();
    if (actual) {
      const nuevo = Db.update('Productos', id, Object.assign(datos, { actualizadoEn: ahora, actualizadoPor: user.email }));
      Audit.log(user, 'editar', 'Producto', id, Audit.diff(actual, nuevo));
      return nuevo;
    }
    const nuevo = Object.assign({ id: Util.uuid(), activo: true, creadoEn: ahora, creadoPor: user.email, actualizadoEn: ahora, actualizadoPor: user.email }, datos);
    Db.insert('Productos', nuevo);
    Audit.log(user, 'crear', 'Producto', nuevo.id, { nombre: nuevo.nombre, sku: nuevo.sku });
    return nuevo;
  },

  /** Busca por nombre (sin distinguir mayúsculas ni tildes) o crea uno nuevo. Usado por la importación. */
  obtenerOCrear(nombre, extra, user) {
    const norm = Util.normalizar(nombre);
    const existente = Db.all('Productos').find((x) => Util.normalizar(x.nombre) === norm);
    if (existente) return existente;
    return Productos.guardar(Object.assign({ nombre: nombre }, extra || {}), user);
  },

  cambiarActivo(p, user) {
    const prod = Productos.requerir(p.id);
    const activo = p.activo === true;
    if (!activo && Inventario.stockDe(prod.id) !== 0) {
      throw new AppError('No se puede archivar un producto con stock. Ajusta el inventario a 0 primero.');
    }
    Db.update('Productos', prod.id, { activo: activo, actualizadoEn: Util.ahora(), actualizadoPor: user.email });
    Audit.log(user, activo ? 'reactivar' : 'archivar', 'Producto', prod.id, { nombre: prod.nombre });
  },

  eliminar(p, user) {
    const prod = Productos.requerir(p.id);
    const usado = Db.all('Movimientos').some((m) => m.productoId === prod.id) || Db.all('Preventas').some((x) => x.productoId === prod.id);
    if (usado) throw new AppError('El producto tiene preventas o movimientos asociados; archívalo en lugar de eliminarlo.');
    Db.remove('Productos', prod.id);
    Audit.log(user, 'eliminar', 'Producto', prod.id, { nombre: prod.nombre, sku: prod.sku });
  },

  requerir(id) {
    const prod = Db.get('Productos', String(id || ''));
    if (!prod) throw new AppError('El producto no existe.', 'NO_ENCONTRADO');
    return prod;
  },
};
