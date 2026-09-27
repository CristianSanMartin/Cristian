/**
 * Preventas (DISENO.md, sección 6).
 *
 * La unidad es el producto solicitado, no la proforma: cada fila (PVI-000001)
 * es un producto pedido a un proveedor, con su fecha de lanzamiento, lo
 * solicitado, lo que el proveedor asignó y su propio estado. Así cada producto
 * tiene su historia completa hasta la venta. El mismo producto puede pedirse
 * más de una vez: cada solicitud es un registro independiente.
 *
 * Estados: solicitada → asignada (o sin_asignacion) → en_compra → recibida.
 */
const Preventas = {
  EDITABLES: ['solicitada', 'asignada', 'sin_asignacion'],

  guardar(p, user) {
    const id = p.id ? String(p.id) : '';
    const actual = id ? Preventas.requerir(id) : null;
    if (actual) Preventas._validarEditable(actual);

    const prov = Proveedores.requerir(p.proveedorId);
    if (!prov.activo && (!actual || actual.proveedorId !== prov.id)) throw new AppError('El proveedor está archivado.');
    // Se valida todo antes de tocar el catálogo: si algo falla, no queda un producto creado a medias.
    if (!p.productoId) Util.texto(p.producto, 'El producto', { requerido: true, max: 200 });
    Imagenes.validar(p.imagen);
    const datos = {
      proveedorId: prov.id,
      lanzamiento: Util.fecha(p.lanzamiento, 'La fecha de lanzamiento', { requerido: true }),
      solicitado: Util.entero(p.solicitado, 'La cantidad solicitada', { requerido: true }),
      costoNeto: Util.monto(p.costoNeto, 'El costo neto unitario', { requerido: true }),
      notas: Util.texto(p.notas, 'Las notas', { max: 500 }),
    };
    // El producto llega como ID (editar) o como texto escrito (agregar): el texto se resuelve o se crea.
    const prod = p.productoId ? Productos.requerir(p.productoId) : Productos.resolverTexto(p.producto, p.pvp, user, p.imagen);
    if (!prod.activo && (!actual || actual.productoId !== prod.id)) throw new AppError('El producto está archivado.');
    datos.productoId = prod.id;
    if (actual) {
      const nuevo = Db.update('Preventas', id, Object.assign(datos, Util.sello(user)));
      Audit.log(user, 'editar', 'Preventa', id, Audit.diff(actual, nuevo));
      return nuevo;
    }
    const nuevo = Object.assign({ id: Util.siguienteId('PVI', 6), asignado: 0, estado: 'solicitada' }, datos, Util.sello(user, true));
    Db.insert('Preventas', nuevo);
    Audit.log(user, 'crear', 'Preventa', nuevo.id, {
      producto: Productos.nombreCompleto(prod), proveedor: prov.nombre, solicitado: nuevo.solicitado,
    });
    return nuevo;
  },

  eliminar(p, user) {
    const pv = Preventas.requerir(p.id);
    Preventas._validarEditable(pv);
    Db.remove('Preventas', pv.id);
    Audit.log(user, 'eliminar', 'Preventa', pv.id, pv);
  },

  /**
   * Registra (o corrige) lo que asignó el proveedor en una o varias preventas.
   * asignado vacío = volver a "solicitada"; 0 = "sin asignación". Todo o nada.
   */
  registrarAsignacion(p, user) {
    const entrada = Array.isArray(p.lineas) ? p.lineas : [];
    if (!entrada.length) throw new AppError('No hay cantidades para registrar.');
    const cambios = entrada.map((x) => {
      const pv = Preventas.requerir(x.id);
      Preventas._validarEditable(pv);
      const vacio = x.asignado === '' || x.asignado == null;
      const asignado = vacio ? 0 : Util.entero(x.asignado, 'La cantidad asignada de ' + pv.id);
      return { pv: pv, asignado: asignado, estado: vacio ? 'solicitada' : asignado > 0 ? 'asignada' : 'sin_asignacion' };
    });
    cambios.forEach((c) => {
      Db.update('Preventas', c.pv.id, Object.assign({ asignado: c.asignado, estado: c.estado }, Util.sello(user)));
    });
    Audit.log(user, 'asignación', 'Preventa', cambios.map((c) => c.pv.id).join(', '),
      cambios.map((c) => ({ id: c.pv.id, solicitado: c.pv.solicitado, asignado: c.estado === 'solicitada' ? null : c.asignado })));
  },

  _validarEditable(pv) {
    if (Preventas.EDITABLES.indexOf(pv.estado) === -1) {
      throw new AppError('La preventa ' + pv.id + ' ya pasó a una compra y no se puede modificar.');
    }
  },

  requerir(id) {
    const pv = Db.get('Preventas', String(id || ''));
    if (!pv) throw new AppError('La preventa ' + (id || '') + ' no existe.', 'NO_ENCONTRADO');
    return pv;
  },

  /** Preventas con los datos del producto y los valores calculados que muestra la pantalla (equivalentes a la planilla). */
  vista(productos, proveedores) {
    const prodPorId = {};
    productos.forEach((x) => { prodPorId[x.id] = x; });
    const provPorId = {};
    proveedores.forEach((x) => { provPorId[x.id] = x; });

    return Db.all('Preventas').map((pv) => {
      const prod = prodPorId[pv.productoId] || { nombre: '(producto eliminado)', edicion: '', idioma: '', tipo: '', pvp: 0 };
      const prov = provPorId[pv.proveedorId];
      const precio = Productos.precio(prod);
      const asignada = pv.estado !== 'solicitada';
      const cantidad = asignada ? pv.asignado : pv.solicitado;
      const e = Economia.unidad(pv.costoNeto, precio);
      return Object.assign(pv, {
        proveedor: prov ? prov.nombre : '(proveedor eliminado)',
        producto: Productos.nombreCompleto(prod),
        productoNombre: prod.nombre,
        edicion: prod.edicion,
        idioma: prod.idioma,
        tipo: prod.tipo,
        imagen: prod.imagen || '',
        pvp: prod.pvp,
        precioVenta: precio,
        precioManual: !!prod.precioManual,
        costoIva: Economia.conIva(pv.costoNeto),
        diferencia: asignada ? pv.solicitado - pv.asignado : null,
        netoSolicitado: pv.solicitado * pv.costoNeto,
        netoAsignado: asignada ? pv.asignado * pv.costoNeto : null,
        cantidadVigente: cantidad,
        netoVigente: cantidad * pv.costoNeto,
        gananciaUnidad: e.ganancia,
        gananciaTotal: e.ganancia * cantidad,
        recargo: e.recargo,
        margen: e.margen,
      });
    }).sort((a, b) =>
      a.lanzamiento < b.lanzamiento ? -1 : a.lanzamiento > b.lanzamiento ? 1 : a.producto.localeCompare(b.producto));
  },
};
