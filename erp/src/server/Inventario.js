/**
 * Inventario valorizado por costo promedio ponderado.
 *
 * El stock de cada producto es la suma de sus movimientos (kardex); nunca se
 * guarda un saldo que pueda desincronizarse. Entradas recalculan el costo
 * promedio; salidas y ajustes negativos descuentan unidades al costo vigente.
 */
const Inventario = {
  /** Recorre los movimientos en orden cronológico y devuelve el estado por producto y el kardex anotado. */
  calcular(movimientos) {
    const orden = movimientos.slice().sort((a, b) =>
      a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.creadoEn < b.creadoEn ? -1 : a.creadoEn > b.creadoEn ? 1 : 0);
    const porProducto = {};
    const kardex = orden.map((m) => {
      const e = porProducto[m.productoId] || (porProducto[m.productoId] = { stock: 0, costoPromedio: 0, ultimoMovimiento: '' });
      if (m.cantidad > 0) {
        e.costoPromedio = e.stock > 0
          ? (e.stock * e.costoPromedio + m.cantidad * m.costoUnit) / (e.stock + m.cantidad)
          : m.costoUnit;
      }
      e.stock += m.cantidad;
      e.ultimoMovimiento = m.fecha;
      return Object.assign({}, m, { saldo: e.stock, costoPromedio: Math.round(e.costoPromedio) });
    });
    Object.keys(porProducto).forEach((id) => {
      const e = porProducto[id];
      e.valor = Math.round(Math.max(e.stock, 0) * e.costoPromedio);
      e.costoPromedio = Math.round(e.costoPromedio);
    });
    return { porProducto: porProducto, kardex: kardex };
  },

  estadoDe(productoId) {
    return Inventario.calcular(Db.all('Movimientos').filter((m) => m.productoId === productoId)).porProducto[productoId]
      || { stock: 0, costoPromedio: 0, valor: 0, ultimoMovimiento: '' };
  },

  stockDe(productoId) {
    return Inventario.estadoDe(productoId).stock;
  },

  /** Movimiento manual desde la pantalla de Inventario: entrada, salida o ajuste por conteo físico. */
  registrar(p, user) {
    const prod = Productos.requerir(p.productoId);
    if (!prod.activo) throw new AppError('El producto está archivado.');
    const tipo = Util.opcion(p.tipo, 'El tipo de movimiento', ['entrada', 'salida', 'ajuste']);
    const fecha = Util.fecha(p.fecha, 'La fecha', { defecto: Util.hoy() });
    const estado = Inventario.estadoDe(prod.id);
    let cantidad;
    let costoUnit = estado.costoPromedio;
    let nota = Util.texto(p.nota, 'La nota', { max: 500 });

    if (tipo === 'entrada') {
      cantidad = Util.entero(p.cantidad, 'La cantidad', { requerido: true, min: 1 });
      costoUnit = Util.entero(p.costoUnit, 'El costo unitario', { requerido: true });
    } else if (tipo === 'salida') {
      cantidad = -Util.entero(p.cantidad, 'La cantidad', { requerido: true, min: 1 });
      if (-cantidad > estado.stock) {
        throw new AppError('Stock insuficiente: hay ' + estado.stock + ' unidades de "' + prod.nombre + '".');
      }
      if (!nota) throw new AppError('Indica el motivo de la salida (venta, regalo, dañado, etc.).');
    } else {
      const contado = Util.entero(p.stockContado, 'El stock contado', { requerido: true });
      cantidad = contado - estado.stock;
      if (cantidad === 0) throw new AppError('El stock contado es igual al del sistema; no hay nada que ajustar.');
      if (cantidad > 0 && !estado.costoPromedio) costoUnit = Util.entero(p.costoUnit, 'El costo unitario');
      if (!nota) throw new AppError('Indica el motivo del ajuste.');
    }

    const mov = Inventario._insertar({
      fecha: fecha, productoId: prod.id, tipo: tipo === 'entrada' ? 'entrada_manual' : tipo === 'salida' ? 'salida_manual' : 'ajuste',
      cantidad: cantidad, costoUnit: costoUnit, refTipo: '', refId: '', nota: nota,
    }, user);
    Audit.log(user, 'movimiento', 'Producto', prod.id, { tipo: mov.tipo, cantidad: cantidad, costoUnit: costoUnit, nota: nota });
    return mov;
  },

  entradaPorPreventa(preventa, cantidad, fecha, user) {
    return Inventario._insertar({
      fecha: fecha, productoId: preventa.productoId, tipo: 'entrada_preventa', cantidad: cantidad,
      costoUnit: preventa.costoUnit, refTipo: 'Preventa', refId: preventa.id, nota: 'Recepción ' + preventa.folio,
    }, user);
  },

  _insertar(mov, user) {
    const m = Object.assign({ id: Util.uuid(), creadoEn: Util.ahora(), creadoPor: user.email }, mov);
    Db.insert('Movimientos', m);
    return m;
  },

  /** Revierte un movimiento. Las entradas de preventa se revierten anulando la recepción. */
  eliminarMovimiento(p, user) {
    const mov = Db.get('Movimientos', String(p.id || ''));
    if (!mov) throw new AppError('El movimiento no existe.', 'NO_ENCONTRADO');
    if (mov.tipo === 'entrada_preventa') {
      throw new AppError('Este movimiento viene de una preventa: usa "Anular recepción" en la preventa.');
    }
    Inventario._validarReversion(mov);
    Db.remove('Movimientos', mov.id);
    Audit.log(user, 'eliminar', 'Movimiento', mov.id, mov);
  },

  _validarReversion(mov) {
    if (mov.cantidad > 0 && Inventario.stockDe(mov.productoId) - mov.cantidad < 0) {
      throw new AppError('No se puede revertir: esas unidades ya salieron del inventario.');
    }
  },
};
