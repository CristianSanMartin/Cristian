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
      iva: tipo === 'egreso' && p.iva !== '' && p.iva != null ? Util.entero(p.iva, 'El IVA de la factura', { min: 0, max: Util.entero(p.monto, 'El monto', { requerido: true, min: 1 }) }) : 0,
    };
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

  /**
   * Un egreso que en realidad fue el pago (total o parcial) de una factura de compra: se registra como
   * pago de esa factura (misma fecha, monto y cuenta) y el movimiento queda anulado, para no contarlo dos veces.
   */
  /**
   * Un ingreso que en realidad fue el abono de una venta con saldo pendiente: se registra como abono de esa
   * venta (misma fecha y monto) y el movimiento queda anulado, para no contarlo dos veces.
   */
  aCobroVenta(p, user) {
    const mov = Finanzas.requerir(p.id);
    if (mov.anulado) throw new AppError('El movimiento ' + mov.id + ' está anulado.');
    if (mov.tipo !== 'ingreso') throw new AppError('Solo un ingreso puede ser el abono de una venta.');
    const v = Ventas.requerir(p.ventaId);
    const saldo = v.anulada ? 0 : Ventas.saldo(v);
    if (saldo <= 0) throw new AppError('La venta ' + v.id + ' no tiene saldo pendiente.');
    if (mov.monto > saldo) throw new AppError('El ingreso es de $' + mov.monto + ' y ' + v.id + ' debe $' + saldo + '.');
    const cobro = Ventas.registrarCobro({
      ventaId: v.id, fecha: mov.fecha, monto: mov.monto, medioPago: { caja: 'efectivo', tuu: 'debito' }[mov.cuenta] || 'transferencia',
      notas: ('Desde ' + mov.id + (mov.subcategoria ? ' · ' + mov.subcategoria : '') + (mov.referencia ? ' · ' + mov.referencia : '')).slice(0, 300),
    }, user);
    const nota = 'Pasado a abono de ' + v.id + ' (' + cobro.id + ')';
    Db.update('Finanzas', mov.id, Object.assign({ anulado: true, notas: [mov.notas, nota].filter(Boolean).join(' · ').slice(-300) }, Util.sello(user)));
    Audit.log(user, 'a abono de venta', 'Movimiento', mov.id, { venta: v.id, cobro: cobro.id, monto: mov.monto });
    return { cobro: cobro.id, ventaId: v.id };
  },

  aPagoFactura(p, user) {
    const mov = Finanzas.requerir(p.id);
    if (mov.anulado) throw new AppError('El movimiento ' + mov.id + ' está anulado.');
    if (mov.tipo !== 'egreso') throw new AppError('Solo un egreso puede ser el pago de una factura.');
    const compra = Compras.requerir(p.compraId);
    const pago = Compras.registrarPago({
      compraId: compra.id, fecha: mov.fecha, monto: mov.monto, cuenta: mov.cuenta,
      notas: ('Desde ' + mov.id + (mov.subcategoria ? ' · ' + mov.subcategoria : '') + (mov.referencia ? ' · ' + mov.referencia : '')).slice(0, 300),
    }, user);
    const nota = 'Pasado a pago de la factura ' + compra.factura + ' (' + compra.id + ', ' + pago.id + ')';
    Db.update('Finanzas', mov.id, Object.assign({ anulado: true, notas: [mov.notas, nota].filter(Boolean).join(' · ').slice(-300) }, Util.sello(user)));
    Audit.log(user, 'a pago de factura', 'Movimiento', mov.id, { compra: compra.id, pago: pago.id, monto: mov.monto });
    return { pago: pago.id, compraId: compra.id };
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
    })).sort((a, b) => (b.fecha + b.id).localeCompare(a.fecha + a.id));
  },
};
