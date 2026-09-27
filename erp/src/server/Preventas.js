/**
 * Preventas por edición (DISENO.md, sección 6).
 *
 * Una preventa (PV-0001) agrupa las líneas (PVI-000001) de una edición con un
 * proveedor. Cada línea es un producto con su fecha de lanzamiento, lo
 * solicitado y lo que el proveedor asignó. La asignación se registra una vez
 * y puede corregirse mientras la línea no pase a una compra.
 */
const Preventas = {
  EDITABLES: ['solicitada', 'asignada', 'sin_asignacion'],

  guardar(p, user) {
    const id = p.id ? String(p.id) : '';
    const actual = id ? Preventas.requerir(id) : null;
    const prov = Proveedores.requerir(p.proveedorId);
    if (!prov.activo && (!actual || actual.proveedorId !== prov.id)) throw new AppError('El proveedor está archivado.');
    const datos = {
      proveedorId: prov.id,
      edicion: Util.texto(p.edicion, 'La edición', { requerido: true, max: 80 }),
      fecha: Util.fecha(p.fecha, 'La fecha de solicitud', { defecto: Util.hoy() }),
      notas: Util.texto(p.notas, 'Las notas', { max: 1000 }),
    };
    if (actual) {
      const nuevo = Db.update('Preventas', id, Object.assign(datos, Util.sello(user)));
      Audit.log(user, 'editar', 'Preventa', id, Audit.diff(actual, nuevo));
      return nuevo;
    }
    const nuevo = Object.assign({ id: Util.siguienteId('PV', 4) }, datos, Util.sello(user, true));
    Db.insert('Preventas', nuevo);
    Audit.log(user, 'crear', 'Preventa', nuevo.id, { proveedor: prov.nombre, edicion: nuevo.edicion });
    return nuevo;
  },

  eliminar(p, user) {
    const pv = Preventas.requerir(p.id);
    const lineas = Preventas.lineasDe(pv.id);
    if (lineas.some((l) => Preventas.EDITABLES.indexOf(l.estado) === -1)) {
      throw new AppError('La preventa tiene productos que ya pasaron a una compra; no se puede eliminar.');
    }
    lineas.forEach((l) => Db.remove('Preventas_Lineas', l.id));
    Db.remove('Preventas', pv.id);
    Audit.log(user, 'eliminar', 'Preventa', pv.id, { edicion: pv.edicion, lineas: lineas.length });
  },

  guardarLinea(p, user) {
    const id = p.id ? String(p.id) : '';
    const actual = id ? Preventas.requerirLinea(id) : null;
    const pv = Preventas.requerir(actual ? actual.preventaId : p.preventaId);
    if (actual) Preventas._validarEditable(actual);

    const prod = Productos.requerir(p.productoId);
    if (!prod.activo && (!actual || actual.productoId !== prod.id)) throw new AppError('El producto está archivado.');
    if (Preventas.lineasDe(pv.id).some((l) => l.id !== id && l.productoId === prod.id)) {
      throw new AppError('"' + Productos.nombreCompleto(prod) + '" ya está en esta preventa.');
    }
    const datos = {
      productoId: prod.id,
      lanzamiento: Util.fecha(p.lanzamiento, 'La fecha de lanzamiento', { requerido: true }),
      solicitado: Util.entero(p.solicitado, 'La cantidad solicitada', { requerido: true }),
      costoNeto: Util.monto(p.costoNeto, 'El costo neto unitario', { requerido: true }),
      notas: Util.texto(p.notas, 'Las notas', { max: 500 }),
    };
    if (actual) {
      const nuevo = Db.update('Preventas_Lineas', id, Object.assign(datos, Util.sello(user)));
      Audit.log(user, 'editar línea', 'Preventa', pv.id, Object.assign({ linea: id }, Audit.diff(actual, nuevo)));
      return nuevo;
    }
    const nuevo = Object.assign({ id: Util.siguienteId('PVI', 6), preventaId: pv.id, asignado: 0, estado: 'solicitada' }, datos, Util.sello(user, true));
    Db.insert('Preventas_Lineas', nuevo);
    Audit.log(user, 'agregar línea', 'Preventa', pv.id, { linea: nuevo.id, producto: Productos.nombreCompleto(prod), solicitado: nuevo.solicitado });
    return nuevo;
  },

  eliminarLinea(p, user) {
    const linea = Preventas.requerirLinea(p.id);
    Preventas._validarEditable(linea);
    Db.remove('Preventas_Lineas', linea.id);
    Audit.log(user, 'eliminar línea', 'Preventa', linea.preventaId, linea);
  },

  /** Registra (o corrige) lo que asignó el proveedor, para varias líneas a la vez. */
  registrarAsignacion(p, user) {
    const pv = Preventas.requerir(p.preventaId);
    const entrada = Array.isArray(p.lineas) ? p.lineas : [];
    if (!entrada.length) throw new AppError('No hay cantidades para registrar.');
    const propias = {};
    Preventas.lineasDe(pv.id).forEach((l) => { propias[l.id] = l; });

    // Validar todo antes de escribir: o se registra la asignación completa o nada.
    const cambios = entrada.map((x) => {
      const linea = propias[String(x.id || '')];
      if (!linea) throw new AppError('Una de las líneas no pertenece a esta preventa.');
      Preventas._validarEditable(linea);
      const asignado = Util.entero(x.asignado, 'La cantidad asignada', { requerido: true });
      return { linea: linea, asignado: asignado };
    });
    cambios.forEach((c) => {
      Db.update('Preventas_Lineas', c.linea.id, Object.assign({
        asignado: c.asignado,
        estado: c.asignado > 0 ? 'asignada' : 'sin_asignacion',
      }, Util.sello(user)));
    });
    Audit.log(user, 'asignación', 'Preventa', pv.id, cambios.map((c) => ({ linea: c.linea.id, solicitado: c.linea.solicitado, asignado: c.asignado })));
  },

  _validarEditable(linea) {
    if (Preventas.EDITABLES.indexOf(linea.estado) === -1) {
      throw new AppError('La línea ' + linea.id + ' ya pasó a una compra y no se puede modificar.');
    }
  },

  lineasDe(preventaId) {
    return Db.all('Preventas_Lineas').filter((l) => l.preventaId === preventaId);
  },

  requerir(id) {
    const pv = Db.get('Preventas', String(id || ''));
    if (!pv) throw new AppError('La preventa no existe.', 'NO_ENCONTRADO');
    return pv;
  },

  requerirLinea(id) {
    const l = Db.get('Preventas_Lineas', String(id || ''));
    if (!l) throw new AppError('La línea de preventa no existe.', 'NO_ENCONTRADO');
    return l;
  },

  /**
   * Arma las preventas con sus líneas y todos los valores calculados que muestra
   * la pantalla (equivalentes a la planilla actual de preventas).
   */
  vista(productos, proveedores) {
    const prodPorId = {};
    productos.forEach((x) => { prodPorId[x.id] = x; });
    const provPorId = {};
    proveedores.forEach((x) => { provPorId[x.id] = x; });

    const lineasPor = {};
    Db.all('Preventas_Lineas').forEach((l) => {
      const prod = prodPorId[l.productoId] || { nombre: '(producto eliminado)', edicion: '', idioma: '', tipo: '', pvp: 0 };
      const precio = Productos.precio(prod);
      const asignada = l.estado !== 'solicitada';
      const cantidad = asignada ? l.asignado : l.solicitado;
      const e = Economia.unidad(l.costoNeto, precio);
      const linea = Object.assign(l, {
        producto: Productos.nombreCompleto(prod),
        productoNombre: prod.nombre,
        idioma: prod.idioma,
        tipo: prod.tipo,
        imagen: prod.imagen || '',
        pvp: prod.pvp,
        precioVenta: precio,
        precioManual: !!prod.precioManual,
        costoIva: Economia.conIva(l.costoNeto),
        diferencia: asignada ? l.solicitado - l.asignado : null,
        netoSolicitado: l.solicitado * l.costoNeto,
        netoAsignado: asignada ? l.asignado * l.costoNeto : null,
        cantidadVigente: cantidad,
        netoVigente: cantidad * l.costoNeto,
        gananciaUnidad: e.ganancia,
        gananciaTotal: e.ganancia * cantidad,
        recargo: e.recargo,
        margen: e.margen,
      });
      (lineasPor[l.preventaId] = lineasPor[l.preventaId] || []).push(linea);
    });

    return Db.all('Preventas').map((pv) => {
      const lineas = (lineasPor[pv.id] || []).sort((a, b) =>
        a.lanzamiento < b.lanzamiento ? -1 : a.lanzamiento > b.lanzamiento ? 1 : a.producto.localeCompare(b.producto));
      const prov = provPorId[pv.proveedorId];
      const sum = (k) => lineas.reduce((s, l) => s + (l[k] || 0), 0);

      // Un pedido por fecha de lanzamiento: sirve para anticipar el despacho.
      const porFecha = {};
      lineas.forEach((l) => { (porFecha[l.lanzamiento] = porFecha[l.lanzamiento] || []).push(l); });
      const lanzamientos = Object.keys(porFecha).sort().map((fecha) => {
        const neto = porFecha[fecha].reduce((s, l) => s + l.netoVigente, 0);
        const d = Economia.despacho(prov, neto);
        return { fecha: fecha, productos: porFecha[fecha].length, neto: neto, despacho: d.monto, faltaParaGratis: d.faltaParaGratis };
      });

      const pendientes = lineas.filter((l) => l.estado === 'solicitada').length;
      return Object.assign(pv, {
        proveedor: prov ? prov.nombre : '(proveedor eliminado)',
        estado: !lineas.length ? 'borrador' : pendientes ? 'solicitada' : 'asignada',
        lineasPendientes: pendientes,
        lineas: lineas,
        lanzamientos: lanzamientos,
        unidadesSolicitadas: sum('solicitado'),
        unidadesAsignadas: lineas.reduce((s, l) => s + (l.estado === 'solicitada' ? 0 : l.asignado), 0),
        netoSolicitado: sum('netoSolicitado'),
        netoVigente: sum('netoVigente'),
        gananciaProyectada: sum('gananciaTotal'),
      });
    });
  },
};
