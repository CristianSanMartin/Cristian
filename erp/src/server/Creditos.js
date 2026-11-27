/**
 * Créditos bancarios con calendario de cuotas.
 *
 * Al registrar el crédito: Ingreso "Crédito bancario recibido" por el monto del crédito (la deuda) y Egreso "Gastos
 * financieros" por los gastos iniciales (impuesto, notario): en la cuenta queda el monto líquido.
 * Cada cuota pagada: Egreso "Pago de crédito (capital)" por su capital y Egreso "Gastos financieros" por el resto
 * (intereses, seguro, comisión FOGAPE). Las cuotas se proponen con amortización francesa a la tasa mensual y se
 * pueden corregir con el calendario del banco mientras no estén pagadas.
 */
const Creditos = {
  requerir(id) {
    const c = Db.get('Creditos', String(id || ''));
    if (!c) throw new AppError('El crédito no existe.', 'NO_ENCONTRADO');
    return c;
  },
  _cuota(id) {
    const q = Db.get('Credito_Cuotas', String(id || ''));
    if (!q) throw new AppError('La cuota no existe.', 'NO_ENCONTRADO');
    return q;
  },

  /**
   * Calendario propuesto: n cuotas mensuales desde el primer vencimiento. Capital por amortización francesa a la
   * tasa mensual (el último ajusta para que sume la deuda); el resto de cada cuota es interés y otros cargos.
   */
  calendario(montoCredito, tasaMensual, n, valorCuota, primerVencimiento) {
    const r = tasaMensual / 100;
    const frances = r ? montoCredito * r / (1 - Math.pow(1 + r, -n)) : montoCredito / n;
    let saldo = montoCredito;
    const cuotas = [];
    for (let k = 1; k <= n; k++) {
      const interes = saldo * r;
      let capital = k === n ? saldo : Math.round(frances - interes);
      capital = Math.min(capital, saldo);
      const total = valorCuota || Math.round(frances);
      cuotas.push({ numero: k, fecha: Util.sumarMeses(primerVencimiento, k - 1), total: k === n && !valorCuota ? Math.round(capital + interes) : total, capital: Math.round(capital) });
      saldo -= Math.round(capital);
    }
    return cuotas;
  },

  /**
   * p: { banco, operacion, fecha, montoLiquido, gastosIniciales, tasaMensual, cuotas (n), valorCuota, primerVencimiento,
   *      cuenta, notas, calendario: [{ fecha, total, capital }] (opcional: si no viene, se propone) }
   */
  crear(p, user) {
    const banco = Util.texto(p.banco, 'El banco', { requerido: true, max: 60 });
    const operacion = Util.texto(p.operacion, 'El N° de operación', { max: 40 });
    const fecha = Util.fecha(p.fecha, 'La fecha del depósito', { requerido: true });
    const montoLiquido = Util.entero(p.montoLiquido, 'El monto líquido', { requerido: true, min: 1 });
    const gastos = Util.entero(p.gastosIniciales, 'Los gastos iniciales', { min: 0 });
    const tasa = Util.monto(p.tasaMensual, 'La tasa mensual');
    const n = Util.entero(p.cuotas, 'El N° de cuotas', { requerido: true, min: 1, max: 120 });
    const valorCuota = Util.entero(p.valorCuota, 'El valor de la cuota', { min: 0 });
    const primer = Util.fecha(p.primerVencimiento, 'El primer vencimiento', { requerido: true });
    const cuenta = p.cuenta ? Util.opcion(p.cuenta, 'La cuenta', Object.keys(CUENTAS)) : 'banco';
    const montoCredito = montoLiquido + gastos;
    let cuotas = Array.isArray(p.calendario) && p.calendario.length ? p.calendario.map((q, i) => ({
      numero: i + 1, fecha: Util.fecha(q.fecha, 'La fecha de la cuota ' + (i + 1), { requerido: true }),
      total: Util.entero(q.total, 'El valor de la cuota ' + (i + 1), { requerido: true, min: 1 }),
      capital: Util.entero(q.capital, 'El capital de la cuota ' + (i + 1), { min: 0 }),
    })) : Creditos.calendario(montoCredito, tasa, n, valorCuota, primer);
    if (cuotas.some((q) => q.capital > q.total)) throw new AppError('El capital de una cuota no puede ser mayor que la cuota.');
    const sumaCapital = cuotas.reduce((t, q) => t + q.capital, 0);
    if (sumaCapital !== montoCredito) throw new AppError('El capital de las cuotas suma ' + sumaCapital + ' y el crédito es de ' + montoCredito + ' (líquido + gastos iniciales).');
    const id = Util.siguienteId('CRE', 4);
    const detalle = banco + (operacion ? ' · Op. ' + operacion : '');
    const ingreso = Finanzas.guardar({ fecha: fecha, tipo: 'ingreso', categoria: 'credito', subcategoria: detalle, monto: montoCredito, cuenta: cuenta, referencia: id,
      notas: 'Depositado ' + montoLiquido + (gastos ? ' + gastos iniciales ' + gastos : '') }, user);
    const gasto = gastos ? Finanzas.guardar({ fecha: fecha, tipo: 'egreso', categoria: 'gasto_financiero', subcategoria: 'Gastos iniciales · ' + detalle, monto: gastos, cuenta: cuenta, referencia: id,
      notas: 'Impuesto, notario y otros gastos del crédito' }, user) : null;
    Db.insert('Creditos', Object.assign({ id: id, banco: banco, operacion: operacion, fecha: fecha, montoLiquido: montoLiquido, gastosIniciales: gastos, montoCredito: montoCredito,
      tasaMensual: tasa, valorCuota: valorCuota, cuenta: cuenta, notas: Util.texto(p.notas, 'Las notas', { max: 300 }), estado: 'vigente',
      movIngreso: ingreso.id, movGasto: gasto ? gasto.id : '' }, Util.sello(user, true)));
    const ids = Util.reservarIds('CQ', 6, cuotas.length);
    Db.insertMany('Credito_Cuotas', cuotas.map((q, i) => Object.assign({ id: ids[i], creditoId: id, numero: q.numero, fecha: q.fecha, total: q.total, capital: q.capital,
      estado: 'pendiente', fechaPago: '', movCapital: '', movInteres: '' }, Util.sello(user, true))));
    Audit.log(user, 'crear', 'Crédito', id, { banco: banco, monto: montoCredito, cuotas: cuotas.length });
    return { id: id, cuotas: cuotas.length, montoCredito: montoCredito };
  },

  /** Corrige una cuota pendiente con el calendario del banco: fecha, valor y capital. */
  editarCuota(p, user) {
    const q = Creditos._cuota(p.id);
    if (q.estado !== 'pendiente') throw new AppError('La cuota ' + q.numero + ' ya está pagada: deshaz el pago para editarla.');
    const datos = {
      fecha: Util.fecha(p.fecha, 'La fecha', { requerido: true }),
      total: Util.entero(p.total, 'El valor de la cuota', { requerido: true, min: 1 }),
      capital: Util.entero(p.capital, 'El capital', { min: 0 }),
    };
    if (datos.capital > datos.total) throw new AppError('El capital no puede ser mayor que la cuota.');
    Db.update('Credito_Cuotas', q.id, Object.assign(datos, Util.sello(user)));
    Audit.log(user, 'editar cuota', 'Crédito', q.creditoId, { cuota: q.numero, antes: q.total + ' (capital ' + q.capital + ')', ahora: datos.total + ' (capital ' + datos.capital + ')' });
    return { id: q.id };
  },

  /** Paga una cuota: capital (baja la deuda) + intereses y otros cargos (gasto financiero). p: { id, fecha, cuenta } */
  pagarCuota(p, user) {
    const q = Creditos._cuota(p.id);
    if (q.estado === 'pagada') throw new AppError('La cuota ' + q.numero + ' ya está pagada.');
    const c = Creditos.requerir(q.creditoId);
    if (c.estado === 'anulado') throw new AppError('El crédito está anulado.');
    const fecha = Util.fecha(p.fecha || q.fecha, 'La fecha del pago', { requerido: true });
    const cuenta = p.cuenta ? Util.opcion(p.cuenta, 'La cuenta', Object.keys(CUENTAS)) : c.cuenta || 'banco';
    const cuotas = Db.all('Credito_Cuotas').filter((x) => x.creditoId === c.id);
    const detalle = c.banco + (c.operacion ? ' · Op. ' + c.operacion : '') + ' · cuota ' + q.numero + '/' + cuotas.length;
    const cap = q.capital ? Finanzas.guardar({ fecha: fecha, tipo: 'egreso', categoria: 'pago_credito', subcategoria: detalle, monto: q.capital, cuenta: cuenta, referencia: q.id }, user) : null;
    const resto = q.total - q.capital;
    const int = resto ? Finanzas.guardar({ fecha: fecha, tipo: 'egreso', categoria: 'gasto_financiero', subcategoria: 'Intereses · ' + detalle, monto: resto, cuenta: cuenta, referencia: q.id,
      notas: 'Intereses, seguro y comisiones de la cuota' }, user) : null;
    Db.update('Credito_Cuotas', q.id, Object.assign({ estado: 'pagada', fechaPago: fecha, movCapital: cap ? cap.id : '', movInteres: int ? int.id : '' }, Util.sello(user)));
    if (cuotas.every((x) => x.id === q.id || x.estado === 'pagada')) Db.update('Creditos', c.id, Object.assign({ estado: 'pagado' }, Util.sello(user)));
    Audit.log(user, 'pagar cuota', 'Crédito', c.id, { cuota: q.numero, total: q.total, capital: q.capital });
    return { id: q.id, capital: q.capital, intereses: resto };
  },

  /** Deshace el pago de una cuota (sus movimientos quedan anulados). */
  deshacerPago(p, user) {
    const q = Creditos._cuota(p.id);
    if (q.estado !== 'pagada') throw new AppError('La cuota ' + q.numero + ' no está pagada.');
    [q.movCapital, q.movInteres].filter(Boolean).forEach((id) => { const m = Db.get('Finanzas', id); if (m && !m.anulado) Finanzas.anular({ id: id }, user); });
    Db.update('Credito_Cuotas', q.id, Object.assign({ estado: 'pendiente', fechaPago: '', movCapital: '', movInteres: '' }, Util.sello(user)));
    const c = Creditos.requerir(q.creditoId);
    if (c.estado === 'pagado') Db.update('Creditos', c.id, Object.assign({ estado: 'vigente' }, Util.sello(user)));
    Audit.log(user, 'deshacer pago cuota', 'Crédito', q.creditoId, { cuota: q.numero });
    return { id: q.id };
  },

  /** Anula un crédito mal registrado (sin cuotas pagadas): sus movimientos quedan anulados. */
  anular(p, user) {
    const c = Creditos.requerir(p.id);
    if (c.estado === 'anulado') throw new AppError('El crédito ya está anulado.');
    if (Db.all('Credito_Cuotas').some((q) => q.creditoId === c.id && q.estado === 'pagada')) throw new AppError('El crédito tiene cuotas pagadas: deshaz esos pagos primero.');
    [c.movIngreso, c.movGasto].filter(Boolean).forEach((id) => { const m = Db.get('Finanzas', id); if (m && !m.anulado) Finanzas.anular({ id: id }, user); });
    Db.update('Creditos', c.id, Object.assign({ estado: 'anulado' }, Util.sello(user)));
    Audit.log(user, 'anular', 'Crédito', c.id, { banco: c.banco, monto: c.montoCredito });
    return { id: c.id };
  },

  vista() {
    const porCredito = {};
    Db.all('Credito_Cuotas').forEach((q) => { (porCredito[q.creditoId] = porCredito[q.creditoId] || []).push(q); });
    return Db.all('Creditos').filter((c) => c.estado !== 'anulado').map((c) => {
      const cuotas = (porCredito[c.id] || []).sort((a, b) => a.numero - b.numero)
        .map((q) => ({ id: q.id, numero: q.numero, fecha: q.fecha, total: q.total, capital: q.capital, interes: q.total - q.capital, estado: q.estado, fechaPago: q.fechaPago || '' }));
      const pagadas = cuotas.filter((q) => q.estado === 'pagada');
      const pendientes = cuotas.filter((q) => q.estado !== 'pagada');
      return {
        id: c.id, banco: c.banco, operacion: c.operacion, fecha: c.fecha, montoLiquido: c.montoLiquido, gastosIniciales: c.gastosIniciales, montoCredito: c.montoCredito,
        tasaMensual: c.tasaMensual, valorCuota: c.valorCuota, cuenta: c.cuenta, notas: c.notas, estado: c.estado, cuotas: cuotas,
        saldoCapital: pendientes.reduce((t, q) => t + q.capital, 0), porPagar: pendientes.reduce((t, q) => t + q.total, 0),
        interesesPagados: pagadas.reduce((t, q) => t + q.interes, 0) + c.gastosIniciales, costoTotal: cuotas.reduce((t, q) => t + q.interes, 0) + c.gastosIniciales,
        proxima: pendientes[0] || null,
      };
    }).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  },
};
