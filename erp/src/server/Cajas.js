/**
 * Caja del día: el registro de lo que pasa en la tienda, rápido y sin pensar en la contabilidad.
 *
 *   - Una caja por fecha (CJ-20261012). Se abre, se registran tickets y se cierra.
 *   - Ticket (TK-20261012-01) = una atención. De venta: líneas de productos sellados (quedan
 *     reservados, nadie más los puede vender) y líneas por monto (singles, torneo, bazar…), con uno
 *     o varios medios de pago (efectivo, transferencia, TUU débito/crédito, pendiente = deuda).
 *     De salida: compra de singles o gasto menor.
 *   - Al cerrar, cada ticket pasa a donde corresponde: los sellados a una OC (se rebaja el stock),
 *     cada tipo por monto a su venta (SGL, TOR…), las salidas a Finanzas. El pago y la comisión de
 *     TUU se reparten en proporción al monto de cada documento. La comisión real sale del depósito
 *     de TUU (cobrado − depositado); si aún no llega, se estima y se concilia después.
 */
const Cajas = {
  /** Reservas que no cuentan: un ticket (al editarlo) o 'todo' (al cerrar la caja). */
  _omitir: null,

  idDe(fecha) {
    return 'CJ-' + String(fecha).replace(/-/g, '');
  },

  /** Abre la caja de una fecha (o devuelve la que ya existe). */
  abrir(p, user) {
    const fecha = Util.fecha(p.fecha || Util.hoy(), 'La fecha de la caja', { requerido: true });
    const id = Cajas.idDe(fecha);
    const existe = Db.get('Cajas', id);
    if (existe) {
      if (existe.estado === 'cerrada') throw new AppError('La caja del ' + fecha + ' ya está cerrada. Para agregarle tickets, ábrela y usa "Reabrir caja".');
      return existe;
    }
    const caja = Object.assign({ id: id, fecha: fecha, estado: 'abierta', tuuTotal: 0, depositoTuu: 0, comisionTuu: 0, tuuDocs: '', notas: '' }, Util.sello(user, true));
    Db.insert('Cajas', caja);
    Audit.log(user, 'abrir', 'Caja', id, { fecha: fecha });
    return caja;
  },

  requerirAbierta(id) {
    const caja = Db.get('Cajas', String(id || ''));
    if (!caja) throw new AppError('La caja no existe.', 'NO_ENCONTRADO');
    if (caja.estado !== 'abierta') throw new AppError('La caja ' + caja.id + ' ya está cerrada.');
    return caja;
  },

  _leer(t) {
    const json = (x, d) => { try { return x ? JSON.parse(x) : d; } catch (e) { return d; } };
    return Object.assign({}, t, { lineas: json(t.lineas, []), pagos: json(t.pagos, []), documentos: json(t.documentos, []) });
  },

  /** Unidades reservadas por los tickets abiertos de cajas abiertas: { productoId: cantidad }. */
  reservas() {
    const res = {};
    if (Cajas._omitir === 'todo') return res;
    const abiertas = {};
    Db.all('Cajas').forEach((c) => { if (c.estado === 'abierta') abiertas[c.id] = true; });
    Db.all('Caja_Tickets').forEach((t) => {
      if (t.estado !== 'abierto' || t.tipo !== 'venta' || !abiertas[t.cajaId] || t.id === Cajas._omitir) return;
      Cajas._leer(t).lineas.forEach((l) => { if (l.productoId) res[l.productoId] = (res[l.productoId] || 0) + l.cantidad; });
    });
    return res;
  },

  /** Valida y normaliza un ticket. */
  _validar(p, ticketId) {
    const tipo = Util.opcion(p.tipo || 'venta', 'El tipo de ticket', ['venta', 'egreso']);
    const notas = Util.texto(p.notas, 'Las notas', { max: 300 });
    if (tipo === 'egreso') {
      const l = (Array.isArray(p.lineas) ? p.lineas : [])[0] || {};
      const categoria = Util.opcion(l.categoria, 'El tipo de salida', Object.keys(EGRESOS_CAJA));
      const monto = Util.entero(l.monto, 'El monto', { requerido: true, min: 1 });
      return {
        tipo: tipo, cliente: '', canal: '', evento: '', notas: notas, total: monto,
        cuenta: p.cuenta ? Util.opcion(p.cuenta, 'La cuenta', Object.keys(CUENTAS)) : 'caja',
        lineas: [{ categoria: categoria, descripcion: Util.texto(l.descripcion, 'El detalle', { max: 120 }), monto: monto }], pagos: [],
      };
    }
    const cliente = Util.texto(p.cliente, 'El cliente', { max: 120 });
    const canal = Util.opcion(p.canal || 'Tienda', 'El canal', CANALES);
    const evento = Util.texto(p.evento, 'El evento', { max: 120 });
    const entrada = Array.isArray(p.lineas) ? p.lineas.filter((x) => x && (x.productoId || x.categoria)) : [];
    if (!entrada.length) throw new AppError('Agrega al menos un producto o una línea por monto al ticket.');
    const lineas = entrada.map((x) => {
      if (x.productoId) {
        const prod = Productos.requerir(x.productoId);
        const nombre = Productos.nombreCompleto(prod);
        const precioLista = Productos.precio(prod);
        return {
          productoId: prod.id, producto: nombre, cantidad: Util.entero(x.cantidad, 'La cantidad de ' + nombre, { requerido: true, min: 1 }),
          precioLista: precioLista, precio: x.precio === '' || x.precio == null ? precioLista : Util.entero(x.precio, 'El precio de ' + nombre, { min: 0 }),
        };
      }
      const categoria = Util.opcion(x.categoria, 'La categoría', CATEGORIAS_VENTA.filter((c) => c !== 'Ajuste'));
      return { categoria: categoria, descripcion: Util.texto(x.descripcion, 'El detalle', { max: 120 }), monto: Util.entero(x.monto, 'El monto de ' + categoria, { requerido: true, min: 1 }) };
    });
    // Stock: lo disponible menos lo reservado por otros tickets.
    const pedido = {};
    lineas.forEach((l) => { if (l.productoId) pedido[l.productoId] = (pedido[l.productoId] || 0) + l.cantidad; });
    if (Object.keys(pedido).length) {
      const disp = {};
      Cajas._omitir = ticketId || '';
      try { Ventas.lotesDisponibles().forEach((l) => { disp[l.productoId] = (disp[l.productoId] || 0) + Math.max(0, l.disponible); }); } finally { Cajas._omitir = null; }
      Object.keys(pedido).forEach((pid) => {
        if (pedido[pid] > (disp[pid] || 0)) {
          const nombre = lineas.find((l) => l.productoId === pid).producto;
          throw new AppError('Stock insuficiente de ' + nombre + ': ' + (disp[pid] ? 'quedan ' + disp[pid] + ' sin reservar' : 'no quedan unidades sin reservar') + '.');
        }
      });
    }
    const total = lineas.reduce((t, l) => t + (l.productoId ? l.precio * l.cantidad : l.monto), 0);
    const pagos = (Array.isArray(p.pagos) ? p.pagos : []).map((x) => {
      const pago = { medio: Util.opcion(x.medio, 'El medio de pago', Object.keys(MEDIOS_CAJA)), monto: Util.entero(x.monto, 'El monto del pago', { min: 0 }) };
      // TUU crédito en cuotas: TUU abona una cuota por mes.
      if (pago.medio === 'credito' && Number(x.cuotas) > 1) pago.cuotas = Util.entero(x.cuotas, 'Las cuotas', { min: 2, max: 48 });
      return pago;
    }).filter((x) => x.monto > 0);
    const suma = pagos.reduce((t, x) => t + x.monto, 0);
    if (suma !== total) throw new AppError('Los pagos suman $' + suma + ' y el ticket es de $' + total + '.');
    if (pagos.some((x) => x.medio === 'pendiente') && (!cliente || Util.normalizar(cliente) === Util.normalizar(Clientes.GENERAL))) {
      throw new AppError('Un ticket con pago pendiente necesita el nombre del cliente.');
    }
    return { tipo: tipo, cliente: cliente, canal: canal, evento: evento, notas: notas, total: total, cuenta: '', lineas: lineas, pagos: pagos };
  },

  guardarTicket(p, user) {
    const caja = Cajas.requerirAbierta(p.cajaId);
    let actual = null;
    if (p.id) {
      actual = Db.get('Caja_Tickets', String(p.id));
      if (!actual || actual.cajaId !== caja.id) throw new AppError('El ticket no existe.', 'NO_ENCONTRADO');
      if (actual.estado !== 'abierto') throw new AppError('El ticket ' + actual.id + ' ya no se puede editar.');
    }
    const d = Cajas._validar(p, actual && actual.id);
    const datos = {
      tipo: d.tipo, cliente: d.cliente, canal: d.canal, evento: d.evento, notas: d.notas, total: d.total, cuenta: d.cuenta,
      lineas: JSON.stringify(d.lineas), pagos: JSON.stringify(d.pagos),
    };
    if (actual) {
      Db.update('Caja_Tickets', actual.id, Object.assign(datos, Util.sello(user)));
      Audit.log(user, 'editar', 'Ticket', actual.id, { total: d.total });
      return { id: actual.id };
    }
    const prefijo = 'TK-' + caja.fecha.replace(/-/g, '') + '-';
    const n = Db.all('Caja_Tickets').filter((t) => t.cajaId === caja.id).reduce((m, t) => Math.max(m, Number(String(t.id).slice(prefijo.length)) || 0), 0) + 1;
    const id = prefijo + String(n).padStart(2, '0');
    Db.insert('Caja_Tickets', Object.assign({ id: id, cajaId: caja.id, estado: 'abierto', documentos: '' }, datos, Util.sello(user, true)));
    Audit.log(user, 'crear', 'Ticket', id, { tipo: d.tipo, total: d.total });
    return { id: id };
  },

  anularTicket(p, user) {
    const t = Db.get('Caja_Tickets', String(p.id || ''));
    if (!t) throw new AppError('El ticket no existe.', 'NO_ENCONTRADO');
    Cajas.requerirAbierta(t.cajaId);
    if (t.estado !== 'abierto') throw new AppError('El ticket ' + t.id + ' ya no se puede anular.');
    Db.update('Caja_Tickets', t.id, Object.assign({ estado: 'anulado' }, Util.sello(user)));
    Audit.log(user, 'anular', 'Ticket', t.id, { total: t.total });
  },

  /** Reparte un monto entero en proporción a unos pesos (la última parte se lleva el redondeo). */
  _repartir(monto, pesos) {
    const total = pesos.reduce((t, x) => t + x, 0);
    if (!total) return pesos.map(() => 0);
    let resto = monto;
    return pesos.map((x, i) => {
      if (i === pesos.length - 1) return resto;
      const v = Math.round(monto * x / total);
      resto -= v;
      return v;
    });
  },

  /** Comisión estimada de TUU (0,77% + $65 + IVA por pago con la máquina). */
  _comisionEstimada(medio, monto) {
    return Economia.comisionPago(medio, monto);
  },

  /**
   * Cierra la caja y pasa cada ticket a su lugar. p: { id, depositoTuu (opcional) }.
   * Devuelve { ventas, movimientos, tickets, comisionTuu, cuotas }.
   */
  cerrar(p, user) {
    const caja = Cajas.requerirAbierta(p.id);
    const tickets = Db.all('Caja_Tickets').filter((t) => t.cajaId === caja.id && t.estado === 'abierto').map(Cajas._leer);
    const deposito = p.depositoTuu === '' || p.depositoTuu == null ? null : Util.entero(p.depositoTuu, 'El depósito de TUU', { min: 0 });

    // Plan: cada ticket de venta se separa en documentos (OC con los sellados; una venta por tipo de monto)
    // y cada pago se reparte entre los documentos en proporción a su monto.
    const plan = [];
    tickets.forEach((t) => {
      if (t.tipo !== 'venta') return;
      const grupos = {};
      t.lineas.forEach((l) => {
        const k = l.productoId ? 'OC' : (PREFIJOS_VENTA[l.categoria] || 'OC');
        (grupos[k] = grupos[k] || []).push(l);
      });
      const docs = Object.keys(grupos).sort((a, b) => (a === 'OC' ? -1 : b === 'OC' ? 1 : a.localeCompare(b))).map((k) => ({
        lineas: grupos[k], total: grupos[k].reduce((s, l) => s + (l.productoId ? l.precio * l.cantidad : l.monto), 0), medios: {}, partes: [],
      }));
      t.pagos.forEach((x, ip) => {
        Cajas._repartir(x.monto, docs.map((d) => d.total)).forEach((v, i) => {
          if (!v) return;
          // Lo pagado en cuotas no entra hoy: TUU lo abona mes a mes (queda por cobrar a TUU).
          const medio = x.cuotas > 1 ? 'cuotas' : x.medio;
          docs[i].medios[medio] = (docs[i].medios[medio] || 0) + v;
          docs[i].partes.push({ pago: ip, medio: x.medio, monto: v, cuotas: x.cuotas || 1 });
        });
      });
      plan.push({ ticket: t, docs: docs });
    });
    const tuuContado = plan.reduce((s, x) => s + x.ticket.pagos.filter((g) => TUU_MEDIOS.indexOf(g.medio) !== -1 && !(g.cuotas > 1)).reduce((a, g) => a + g.monto, 0), 0);
    // Una caja reabierta suma lo nuevo a lo que ya se había pasado.
    const previos = Cajas._docs(caja);
    const tuuTotal = (caja.tuuTotal || 0) + tuuContado;
    if (deposito != null && deposito > tuuTotal) throw new AppError('El depósito de TUU ($' + deposito + ') es mayor que lo cobrado con TUU en la caja ($' + tuuTotal + ').');

    // Stock: lo que piden todos los tickets debe estar disponible (sin contar las reservas de esta caja).
    const pedido = {};
    plan.forEach((x) => x.docs.forEach((d) => d.lineas.forEach((l) => { if (l.productoId) pedido[l.productoId] = (pedido[l.productoId] || 0) + l.cantidad; })));
    Cajas._omitir = 'todo';
    try {
      const disp = {};
      Ventas.lotesDisponibles().forEach((l) => { disp[l.productoId] = (disp[l.productoId] || 0) + Math.max(0, l.disponible); });
      Object.keys(pedido).forEach((pid) => {
        if (pedido[pid] > (disp[pid] || 0)) throw new AppError('Stock insuficiente de ' + Productos.nombreCompleto(Productos.requerir(pid)) + ' para cerrar la caja: quedan ' + (disp[pid] || 0) + '.');
      });

      const sello = Util.sello(user, true);
      const tuuDocs = [];
      const cuotas = [];
      const ventaIds = [];
      let nMovs = 0;
      plan.forEach((x) => {
        const t = x.ticket;
        const ids = [];
        x.docs.forEach((d) => {
          const pagados = Object.keys(d.medios).filter((m) => m !== 'pendiente' && m !== 'cuotas' && d.medios[m] > 0).sort((a, b) => d.medios[b] - d.medios[a]);
          const principal = pagados[0] || (d.medios.cuotas ? 'credito' : 'efectivo');
          const v = Ventas.crear({
            fecha: caja.fecha, cliente: t.cliente, canal: t.canal, evento: t.evento, medioPago: principal, notas: 'Ticket ' + t.id + (t.notas ? ' · ' + t.notas : ''),
            lineas: d.lineas.map((l) => (l.productoId ? { productoId: l.productoId, cantidad: l.cantidad, precio: l.precio } : { categoria: l.categoria, descripcion: l.descripcion, monto: l.monto })),
          }, user);
          // Lo pagado con el medio principal es el abono; los otros medios quedan como abonos del mismo día.
          Db.update('Ventas', v.id, Object.assign({ abono: pagados.length ? d.medios[principal] : 0, comision: 0 }, Util.sello(user)));
          pagados.slice(1).forEach((m) => Db.insert('Cobros', Object.assign({
            id: Util.siguienteId('COB', 6), ventaId: v.id, fecha: caja.fecha, monto: d.medios[m], medioPago: m, notas: 'Ticket ' + t.id,
          }, sello)));
          d.partes.filter((g) => TUU_MEDIOS.indexOf(g.medio) !== -1).forEach((g) => tuuDocs.push({ ventaId: v.id, ticketId: t.id, pago: g.pago, medio: g.medio, monto: g.monto, cuotas: g.cuotas }));
          d.ventaId = v.id;
          ids.push(v.id);
          ventaIds.push(v.id);
        });
        // Calendario de cuotas: la cuota k llega en el abono de (fecha + k−1 meses).
        t.pagos.forEach((g, ip) => {
          if (!(g.cuotas > 1)) return;
          const partes = x.docs.map((d) => ({ ventaId: d.ventaId, monto: (d.partes.find((q) => q.pago === ip) || {}).monto || 0 })).filter((q) => q.monto);
          const valor = Math.floor(g.monto / g.cuotas);
          for (let k = 1; k <= g.cuotas; k++) {
            const monto = k === g.cuotas ? g.monto - valor * (g.cuotas - 1) : valor;
            const reparto = Cajas._repartir(monto, partes.map((q) => q.monto));
            cuotas.push({
              ticketId: t.id, cajaId: caja.id, pago: ip, numero: k, de: g.cuotas, monto: monto,
              ventas: JSON.stringify(partes.map((q, i) => ({ ventaId: q.ventaId, monto: reparto[i] }))),
              fechaEsperada: Cajas.fechaAbono(Util.sumarMeses(caja.fecha, k - 1)), estado: 'pendiente', fechaRecibida: '',
              comisionEstimada: Economia.comisionPago('credito', monto), comision: 0, comisionReal: false, idTransaccion: '',
            });
          }
        });
        Db.update('Caja_Tickets', t.id, Object.assign({ estado: 'pasado', documentos: JSON.stringify(ids) }, Util.sello(user)));
      });
      if (cuotas.length) {
        const idsC = Util.reservarIds('CT', 6, cuotas.length);
        Db.insertMany('Cuotas_TUU', cuotas.map((c, i) => Object.assign({ id: idsC[i] }, c, sello)));
      }
      tickets.filter((t) => t.tipo === 'egreso').forEach((t) => {
        const l = t.lineas[0];
        const e = EGRESOS_CAJA[l.categoria];
        const mov = Finanzas.guardar({
          fecha: caja.fecha, tipo: 'egreso', categoria: e.categoria, subcategoria: (e.prefijo + (l.descripcion || e.label)).slice(0, 120), monto: l.monto,
          cuenta: t.cuenta || 'caja', referencia: t.id, notas: 'Caja ' + caja.id + (t.notas ? ' · ' + t.notas : ''),
        }, user);
        Db.update('Caja_Tickets', t.id, Object.assign({ estado: 'pasado', documentos: JSON.stringify([mov.id]) }, Util.sello(user)));
        nMovs++;
      });
      Db.update('Cajas', caja.id, Object.assign({
        estado: 'cerrada', tuuTotal: tuuTotal, depositoTuu: deposito != null ? deposito : (caja.depositoTuu || 0), tuuDocs: JSON.stringify(previos.concat(tuuDocs)),
        cerradaEn: Util.ahora(), cerradaPor: user.email,
      }, Util.sello(user)));
      const comisionTuu = Cajas._recalcularComisiones(Array.from(new Set(previos.map((d) => d.ventaId).concat(ventaIds))), user);
      Db.update('Cajas', caja.id, { comisionTuu: comisionTuu });
      Audit.log(user, 'cerrar', 'Caja', caja.id, { tickets: tickets.length, ventas: ventaIds.length, movimientos: nMovs, tuu: tuuContado, deposito: deposito, comision: comisionTuu, cuotas: cuotas.length });
      return { ventas: ventaIds.length, movimientos: nMovs, tickets: tickets.length, comisionTuu: comisionTuu, cuotas: cuotas.length };
    } finally {
      Cajas._omitir = null;
    }
  },

  _docs(caja) {
    try { return JSON.parse(caja.tuuDocs || '[]'); } catch (e) { return []; }
  },

  /**
   * Comisión de TUU de las ventas que salieron de una caja, desde cero:
   *   - pago al contado (débito o crédito sin cuotas): la real del informe de TUU si ya llegó; si no, la del
   *     depósito registrado a mano para esa caja (repartido); si no, la estimada (0,77% + $65 + IVA por pago);
   *   - pago en cuotas: la suma de sus cuotas (real si llegó en el informe, estimada si no).
   * Cada comisión se reparte entre los documentos del ticket en proporción a su parte del pago.
   * Devuelve la comisión total de esas ventas.
   */
  _recalcularComisiones(ventaIds, user) {
    const quiero = {};
    ventaIds.forEach((id) => { quiero[id] = true; });
    if (!ventaIds.length) return 0;
    const real = {};   // ticketId|pago → comisión del informe
    Db.all('Abonos_TUU').forEach((a) => { if (a.ticketId && !a.cuotaId) real[a.ticketId + '|' + a.pago] = (real[a.ticketId + '|' + a.pago] || 0) + a.comision; });
    const tickets = {};
    Db.all('Caja_Tickets').forEach((t) => { tickets[t.id] = t; });
    const com = {};
    Db.all('Cajas').forEach((caja) => {
      const docs = Cajas._docs(caja);
      if (!docs.some((d) => quiero[d.ventaId])) return;
      const contado = docs.filter((d) => !(d.cuotas > 1));
      // Total de cada pago (para repartir su comisión entre los documentos).
      const totalPago = {};
      contado.forEach((d) => { const k = d.ticketId + '|' + d.pago; totalPago[k] = (totalPago[k] || 0) + d.monto; });
      // Depósito manual de la caja: comisión = cobrado al contado − depositado, para los pagos sin informe.
      let manual = null;
      if (caja.depositoTuu) {
        const sinInforme = Object.keys(totalPago).filter((k) => real[k] == null);
        const conInforme = Object.keys(totalPago).filter((k) => real[k] != null);
        const resto = caja.tuuTotal - caja.depositoTuu - conInforme.reduce((t, k) => t + real[k], 0);
        manual = {};
        Cajas._repartir(Math.max(0, resto), sinInforme.map((k) => totalPago[k])).forEach((v, i) => { manual[sinInforme[i]] = v; });
      }
      Object.keys(totalPago).forEach((k) => {
        const partes = contado.filter((d) => d.ticketId + '|' + d.pago === k);
        const medio = partes[0].medio;
        const total = real[k] != null ? real[k] : manual && manual[k] != null ? manual[k] : Economia.comisionPago(medio, totalPago[k]);
        Cajas._repartir(total, partes.map((d) => d.monto)).forEach((v, i) => { com[partes[i].ventaId] = (com[partes[i].ventaId] || 0) + v; });
      });
    });
    Db.all('Cuotas_TUU').forEach((c) => {
      let partes = [];
      try { partes = JSON.parse(c.ventas || '[]'); } catch (e) { partes = []; }
      if (!partes.some((q) => quiero[q.ventaId])) return;
      const total = c.comisionReal ? c.comision : c.comisionEstimada;
      Cajas._repartir(total, partes.map((q) => q.monto)).forEach((v, i) => { com[partes[i].ventaId] = (com[partes[i].ventaId] || 0) + v; });
    });
    const cambios = {};
    let suma = 0;
    ventaIds.forEach((id) => {
      const v = Db.get('Ventas', id);
      if (!v) return;
      const c = com[id] || 0;
      suma += c;
      if (v.comision !== c) cambios[id] = Object.assign({ comision: c }, Util.sello(user));
    });
    if (Object.keys(cambios).length) Db.actualizarVarios('Ventas', cambios);
    return suma;
  },

  /** Ventas que salieron de una caja (las que tienen pagos con TUU). */
  _ventasDe(caja) {
    return Array.from(new Set(Cajas._docs(caja).map((d) => d.ventaId)));
  },

  /**
   * Reabre una caja cerrada (se cerró antes de tiempo o faltaron tickets). Lo ya pasado a Ventas y
   * Finanzas queda como está; al volver a cerrarla solo pasan los tickets nuevos.
   */
  reabrir(p, user) {
    const caja = Db.get('Cajas', String(p.id || ''));
    if (!caja) throw new AppError('La caja no existe.', 'NO_ENCONTRADO');
    if (caja.estado !== 'cerrada') throw new AppError('La caja ' + caja.id + ' ya está abierta.');
    Db.update('Cajas', caja.id, Object.assign({ estado: 'abierta' }, Util.sello(user)));
    Audit.log(user, 'reabrir', 'Caja', caja.id, { fecha: caja.fecha });
    return { id: caja.id };
  },

  /** Caja cerrada sin el informe de TUU: con el depósito real se corrige la comisión de sus ventas (al contado). */
  conciliarTuu(p, user) {
    const caja = Db.get('Cajas', String(p.id || ''));
    if (!caja || caja.estado !== 'cerrada') throw new AppError('La caja no existe o aún no está cerrada.');
    const deposito = Util.entero(p.depositoTuu, 'El depósito de TUU', { requerido: true, min: 0, max: caja.tuuTotal });
    Db.update('Cajas', caja.id, Object.assign({ depositoTuu: deposito }, Util.sello(user)));
    const comision = Cajas._recalcularComisiones(Cajas._ventasDe(caja), user);
    Db.update('Cajas', caja.id, { comisionTuu: comision });
    Audit.log(user, 'conciliar TUU', 'Caja', caja.id, { deposito: deposito, comision: comision });
    return { comisionTuu: comision };
  },

  /* ---------- abonos de TUU: días hábiles, cuotas e informe ---------- */

  /** ¿Es día hábil? (lunes a viernes y no feriado). */
  _habil(fecha, feriados) {
    const d = new Date(fecha + 'T12:00:00Z').getUTCDay();
    return d !== 0 && d !== 6 && !feriados[fecha];
  },

  /** Fecha en que TUU abona una venta: 2 días hábiles después (jueves → lunes; viernes, sábado y domingo → martes). */
  fechaAbono(fecha, feriados) {
    feriados = feriados || Cajas._feriados();
    let f = fecha;
    let n = 0;
    while (n < 2) {
      f = Util.sumarDias(f, 1);
      if (Cajas._habil(f, feriados)) n++;
    }
    return f;
  },

  _feriados() {
    const res = {};
    Db.all('Feriados').forEach((x) => { res[x.fecha] = x.nombre || true; });
    return res;
  },

  guardarFeriado(p, user) {
    const fecha = Util.fecha(p.fecha, 'La fecha', { requerido: true });
    const nombre = Util.texto(p.nombre, 'El nombre', { requerido: true, max: 80 });
    if (Db.get('Feriados', fecha)) Db.update('Feriados', fecha, { nombre: nombre });
    else Db.insert('Feriados', { fecha: fecha, nombre: nombre });
    Audit.log(user, 'feriado', 'Feriados', fecha, { nombre: nombre });
  },

  quitarFeriado(p, user) {
    const fecha = Util.fecha(p.fecha, 'La fecha', { requerido: true });
    Db.remove('Feriados', fecha);
    Audit.log(user, 'quitar feriado', 'Feriados', fecha, {});
  },

  /** Registra una cuota como recibida: un abono en cada venta del ticket, en la fecha del abono de TUU. */
  _recibirCuota(c, fechaAbono, real, user) {
    let partes = [];
    try { partes = JSON.parse(c.ventas || '[]'); } catch (e) { partes = []; }
    const sello = Util.sello(user, true);
    partes.filter((q) => q.monto > 0).forEach((q) => Db.insert('Cobros', Object.assign({
      id: Util.siguienteId('COB', 6), ventaId: q.ventaId, fecha: fechaAbono, monto: q.monto, medioPago: 'credito', notas: 'Cuota ' + c.numero + '/' + c.de + ' TUU · ' + c.ticketId,
    }, sello)));
    Db.update('Cuotas_TUU', c.id, Object.assign({ estado: 'recibida', fechaRecibida: fechaAbono }, real || {}, Util.sello(user)));
    return partes.map((q) => q.ventaId);
  },

  /** Marca a mano una cuota como recibida (sin el informe de TUU). */
  recibirCuota(p, user) {
    const c = Db.get('Cuotas_TUU', String(p.id || ''));
    if (!c) throw new AppError('La cuota no existe.', 'NO_ENCONTRADO');
    if (c.estado !== 'pendiente') throw new AppError('La cuota ' + c.numero + '/' + c.de + ' ya está recibida.');
    const fecha = Util.fecha(p.fecha || Util.hoy(), 'La fecha del abono', { requerido: true });
    const ventas = Cajas._recibirCuota(c, fecha, null, user);
    Audit.log(user, 'cuota recibida', 'Cuota TUU', c.id, { cuota: c.numero + '/' + c.de, monto: c.monto, fecha: fecha });
    return { ventas: ventas };
  },

  /**
   * Procesa el informe de abonos de TUU (filas ya leídas del Excel). Cada transacción se cuadra con
   * su pago en la caja de su fecha (mismo medio y monto); si es en cuotas, con su cuota pendiente.
   * La comisión del informe reemplaza la estimada. p: { filas: [{ idTransaccion, fechaVenta, tipo, monto,
   * cuota, de, montoCuota, comision, fechaAbono, abonado }] }.
   */
  importarAbonos(p, user) {
    const filas = Array.isArray(p.filas) ? p.filas : [];
    if (!filas.length) throw new AppError('El informe no trae transacciones.');
    const ya = {};
    Db.all('Abonos_TUU').forEach((a) => { ya[a.id] = true; });
    const usados = {};
    Db.all('Abonos_TUU').forEach((a) => { if (a.ticketId && !a.cuotaId) usados[a.ticketId + '|' + a.pago] = true; });
    // Pagos con TUU de las cajas cerradas, por fecha.
    const pagosPorFecha = {};
    const tickets = {};
    Db.all('Caja_Tickets').forEach((t) => { tickets[t.id] = Cajas._leer(t); });
    Db.all('Cajas').filter((c) => c.estado === 'cerrada').forEach((c) => {
      Object.values(tickets).filter((t) => t.cajaId === c.id && t.estado === 'pasado' && t.tipo === 'venta').forEach((t) => {
        t.pagos.forEach((g, ip) => {
          if (TUU_MEDIOS.indexOf(g.medio) === -1) return;
          (pagosPorFecha[c.fecha] = pagosPorFecha[c.fecha] || []).push({ ticketId: t.id, pago: ip, medio: g.medio, monto: g.monto, cuotas: g.cuotas || 1 });
        });
      });
    });
    const cuotas = Db.all('Cuotas_TUU');
    const res = { nuevas: 0, repetidas: 0, sinVenta: [], cuotas: 0, abonado: 0, comision: 0 };
    const registros = [];
    const afectadas = {};
    filas.forEach((f, i) => {
      const fila = {
        idTransaccion: Util.texto(f.idTransaccion, 'El ID de transacción', { requerido: true, max: 60 }),
        fechaVenta: Util.fecha(f.fechaVenta, 'La fecha de la transacción', { requerido: true }),
        tipo: Util.texto(f.tipo, 'El tipo', { max: 30 }),
        monto: Util.entero(f.monto, 'El monto', { min: 0 }),
        cuota: Util.entero(f.cuota || 1, 'La cuota', { min: 1 }),
        de: Util.entero(f.de || 1, 'Las cuotas', { min: 1 }),
        montoCuota: Util.entero(f.montoCuota || f.monto, 'El monto pareado', { min: 0 }),
        comision: Util.entero(f.comision, 'La comisión', { min: 0 }),
        fechaAbono: Util.fecha(f.fechaAbono, 'La fecha de abono', { requerido: true }),
        abonado: Util.entero(f.abonado, 'El monto abonado', { min: 0 }),
      };
      const id = fila.idTransaccion + '-' + fila.cuota;
      if (ya[id]) { res.repetidas++; return; }
      const medio = /cr[eé]d/i.test(fila.tipo) ? 'credito' : 'debito';
      let reg = null;
      // ¿Cuota? Un pago en cuotas de la caja de esa fecha con el mismo total y esa cuota pendiente.
      const pagoCuota = (pagosPorFecha[fila.fechaVenta] || []).find((g) => g.cuotas > 1 && g.monto === fila.monto &&
        cuotas.some((c) => c.ticketId === g.ticketId && c.pago === g.pago && c.numero === fila.cuota && c.estado === 'pendiente'));
      if (pagoCuota || fila.de > 1) {
        const pago = pagoCuota;
        if (pago) {
          const c = cuotas.find((x) => x.ticketId === pago.ticketId && x.pago === pago.pago && x.numero === fila.cuota);
          Cajas._recibirCuota(c, fila.fechaAbono, { comision: fila.comision, comisionReal: true, idTransaccion: fila.idTransaccion }, user)
            .forEach((v) => { afectadas[v] = true; });
          c.estado = 'recibida';
          reg = { ticketId: pago.ticketId, pago: pago.pago, cuotaId: c.id };
          res.cuotas++;
        }
      } else {
        const pago = (pagosPorFecha[fila.fechaVenta] || []).find((g) => g.cuotas === 1 && g.medio === medio && g.monto === fila.monto && !usados[g.ticketId + '|' + g.pago])
          || (pagosPorFecha[fila.fechaVenta] || []).find((g) => g.cuotas === 1 && g.monto === fila.monto && !usados[g.ticketId + '|' + g.pago]);
        if (pago) {
          usados[pago.ticketId + '|' + pago.pago] = true;
          reg = { ticketId: pago.ticketId, pago: pago.pago, cuotaId: '' };
        }
      }
      if (!reg) { res.sinVenta.push(Object.assign({ fila: i + 1 }, fila)); return; }
      ya[id] = true;
      registros.push(Object.assign({ id: id }, fila, reg));
      res.nuevas++;
      res.abonado += fila.abonado;
      res.comision += fila.comision;
    });
    if (registros.length) {
      Db.insertMany('Abonos_TUU', registros.map((r) => Object.assign(r, Util.sello(user, true))));
      // Ventas de esas cajas: la comisión real reemplaza la estimada.
      const cajasTocadas = {};
      registros.forEach((r) => { const t = tickets[r.ticketId]; if (t) cajasTocadas[t.cajaId] = true; });
      Db.all('Cajas').filter((c) => cajasTocadas[c.id]).forEach((c) => Cajas._ventasDe(c).forEach((v) => { afectadas[v] = true; }));
      Cajas._recalcularComisiones(Object.keys(afectadas), user);
      Db.all('Cajas').filter((c) => cajasTocadas[c.id]).forEach((c) => {
        const vs = {};
        Cajas._ventasDe(c).forEach((v) => { vs[v] = true; });
        const suma = Db.all('Ventas').filter((v) => vs[v.id]).reduce((t, v) => t + v.comision, 0);
        Db.update('Cajas', c.id, { comisionTuu: suma });
      });
    }
    Audit.log(user, 'abono TUU', 'Abonos TUU', '', { nuevas: res.nuevas, repetidas: res.repetidas, sinVenta: res.sinVenta.length, cuotas: res.cuotas, abonado: res.abonado, comision: res.comision });
    return res;
  },

  /**
   * Abonos de TUU que vienen (para el calendario y el aviso de GSTin): las ventas al contado de cada caja
   * que aún no aparecen en un informe y las cuotas pendientes, con su fecha esperada.
   */
  abonosEsperados() {
    const feriados = Cajas._feriados();
    const informados = {};
    Db.all('Abonos_TUU').forEach((a) => { if (a.ticketId && !a.cuotaId) informados[a.ticketId + '|' + a.pago] = true; });
    const res = [];
    const tickets = Db.all('Caja_Tickets').map(Cajas._leer);
    Db.all('Cajas').forEach((c) => {
      if (c.estado === 'cerrada' && c.depositoTuu) return;   // depósito ya registrado a mano
      let monto = 0;
      let comision = 0;
      tickets.filter((t) => t.cajaId === c.id && t.tipo === 'venta' && t.estado !== 'anulado').forEach((t) => t.pagos.forEach((g, ip) => {
        if (TUU_MEDIOS.indexOf(g.medio) === -1 || g.cuotas > 1 || informados[t.id + '|' + ip]) return;
        monto += g.monto;
        comision += Economia.comisionPago(g.medio, g.monto);
      }));
      if (monto) res.push({ tipo: 'ventas', fecha: Cajas.fechaAbono(c.fecha, feriados), cajaId: c.id, fechaVenta: c.fecha, monto: monto, neto: monto - comision });
    });
    const ventaDe = {};
    Db.all('Caja_Tickets').forEach((t) => { ventaDe[t.id] = t.documentos; });
    Db.all('Cuotas_TUU').filter((c) => c.estado === 'pendiente').forEach((c) => {
      let docs = [];
      try { docs = JSON.parse(ventaDe[c.ticketId] || '[]'); } catch (e) { docs = []; }
      res.push({ tipo: 'cuota', fecha: c.fechaEsperada, cuotaId: c.id, ticketId: c.ticketId, numero: c.numero, de: c.de, monto: c.monto, neto: c.monto - c.comisionEstimada, ventas: docs });
    });
    return res.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  },

  /** Las cajas (más recientes primero) con sus tickets. */
  vista() {
    const tickets = {};
    Db.all('Caja_Tickets').forEach((t) => { (tickets[t.cajaId] = tickets[t.cajaId] || []).push(Cajas._leer(t)); });
    return Db.all('Cajas').slice().sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, 90).map((c) => Object.assign({}, c, {
      tickets: (tickets[c.id] || []).sort((a, b) => a.id.localeCompare(b.id)), tuuDocs: undefined,
    }));
  },
};
