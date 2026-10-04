/**
 * Finanzas: movimientos de caja que no son una venta ni una factura de compra.
 * Ingresos: aportes de capital (subcategoría = socio), otros ingresos.
 * Egresos: compras por monto (singles por lote, bazar, mercadería sin inventario),
 * GAV, GOPM, pagos al SII, comisiones, retiros.
 *
 * El resumen mensual (ventas, compras, gastos y resultado) se arma en la pantalla
 * con las ventas, las facturas de compra y estos movimientos.
 */
const Finanzas = {
  validar(p) {
    const tipo = Util.opcion(p.tipo, 'El tipo', Object.keys(CATEGORIAS_MOVIMIENTO));
    return {
      fecha: Util.fecha(p.fecha, 'La fecha', { requerido: true }),
      tipo: tipo,
      categoria: Util.opcion(p.categoria, 'La categoría', Object.keys(CATEGORIAS_MOVIMIENTO[tipo])),
      subcategoria: Util.texto(p.subcategoria, 'El detalle', { max: 120 }),
      monto: Util.entero(p.monto, 'El monto', { requerido: true, min: 1 }),
      cuenta: p.cuenta ? Util.opcion(p.cuenta, 'La cuenta', Object.keys(CUENTAS)) : '',
      referencia: Util.texto(p.referencia, 'La referencia', { max: 80 }),
      notas: Util.texto(p.notas, 'Las notas', { max: 300 }),
      periodo: Finanzas.periodo(p.periodo, p.fecha),
    };
  },

  /** Mes contable como AAAA-MM-01: el indicado (AAAA-MM o una fecha) o, si no viene, el de la fecha. */
  periodo(v, fecha) {
    const m = /^(\d{4})-(\d{2})/.exec(String(v || '')) || /^(\d{4})-(\d{2})/.exec(String(fecha || ''));
    return m ? m[1] + '-' + m[2] + '-01' : '';
  },

  guardar(p, user) {
    const datos = Finanzas.validar(p);
    if (p.id) {
      const actual = Finanzas.requerir(p.id);
      if (actual.anulado) throw new AppError('El movimiento ' + actual.id + ' está anulado.');
      Audit.log(user, 'editar', 'Movimiento', actual.id, Audit.diff(actual, Object.assign({}, actual, datos)));
      return Db.update('Finanzas', actual.id, Object.assign(datos, Util.sello(user)));
    }
    const mov = Object.assign({ id: Util.siguienteId('MOV', 5), anulado: false }, datos, Util.sello(user, true));
    Db.insert('Finanzas', mov);
    Audit.log(user, 'crear', 'Movimiento', mov.id, { tipo: mov.tipo, categoria: mov.categoria, monto: mov.monto });
    return mov;
  },

  anular(p, user) {
    const mov = Finanzas.requerir(p.id);
    if (mov.anulado) throw new AppError('El movimiento ' + mov.id + ' ya está anulado.');
    Db.update('Finanzas', mov.id, Object.assign({ anulado: true }, Util.sello(user)));
    Audit.log(user, 'anular', 'Movimiento', mov.id, { monto: mov.monto, categoria: mov.categoria });
  },

  requerir(id) {
    const m = Db.get('Finanzas', String(id || ''));
    if (!m) throw new AppError('El movimiento no existe.', 'NO_ENCONTRADO');
    return m;
  },

  vista() {
    return Db.all('Finanzas').map((m) => Object.assign(m, {
      categoriaLabel: (CATEGORIAS_MOVIMIENTO[m.tipo] || {})[m.categoria] || m.categoria,
      cuentaLabel: CUENTAS[m.cuenta] || '',
      periodo: m.periodo || Finanzas.periodo('', m.fecha),
    })).sort((a, b) => (b.fecha + b.id).localeCompare(a.fecha + a.id));
  },
};
