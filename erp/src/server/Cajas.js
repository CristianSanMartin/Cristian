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
      if (existe.estado === 'cerrada') throw new AppError('La caja del ' + fecha + ' ya está cerrada.');
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
    const pagos = (Array.isArray(p.pagos) ? p.pagos : []).map((x) => ({
      medio: Util.opcion(x.medio, 'El medio de pago', Object.keys(MEDIOS_CAJA)), monto: Util.entero(x.monto, 'El monto del pago', { min: 0 }),
    })).filter((x) => x.monto > 0);
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

  /** Comisión estimada de TUU (0,77% + $65 por pago con la máquina). */
  _comisionEstimada(medio, monto) {
    const r = COMISIONES_PAGO[medio];
    return r && monto ? Math.round(monto * r.pct + r.fijo) : 0;
  },

  /**
   * Cierra la caja y pasa cada ticket a su lugar. p: { id, depositoTuu (opcional) }.
   * Devuelve { ventas, movimientos, tickets, comisionTuu }.
   */
  cerrar(p, user) {
    const caja = Cajas.requerirAbierta(p.id);
    const tickets = Db.all('Caja_Tickets').filter((t) => t.cajaId === caja.id && t.estado === 'abierto').map(Cajas._leer);
    const deposito = p.depositoTuu === '' || p.depositoTuu == null ? null : Util.entero(p.depositoTuu, 'El depósito de TUU', { min: 0 });

    // Plan: cada ticket de venta se separa en documentos (OC con los sellados; una venta por tipo de monto).
    const plan = [];
    tickets.forEach((t) => {
      if (t.tipo !== 'venta') return;
      const grupos = {};
      t.lineas.forEach((l) => {
        const k = l.productoId ? 'OC' : (PREFIJOS_VENTA[l.categoria] || 'OC');
        (grupos[k] = grupos[k] || []).push(l);
      });
      const docs = Object.keys(grupos).sort((a, b) => (a === 'OC' ? -1 : b === 'OC' ? 1 : a.localeCompare(b))).map((k) => ({
        lineas: grupos[k], total: grupos[k].reduce((s, l) => s + (l.productoId ? l.precio * l.cantidad : l.monto), 0),
      }));
      // Cada medio de pago se reparte entre los documentos en proporción a su monto.
      docs.forEach((d) => { d.medios = {}; });
      t.pagos.forEach((x) => {
        Cajas._repartir(x.monto, docs.map((d) => d.total)).forEach((v, i) => { if (v) docs[i].medios[x.medio] = (docs[i].medios[x.medio] || 0) + v; });
      });
      docs.forEach((d) => { d.tuu = (d.medios.debito || 0) + (d.medios.credito || 0); });
      plan.push({ ticket: t, docs: docs });
    });
    const docs = [];
    plan.forEach((x) => x.docs.forEach((d) => docs.push(d)));
    const tuuTotal = docs.reduce((t, d) => t + d.tuu, 0);
    if (deposito != null && deposito > tuuTotal) throw new AppError('El depósito de TUU ($' + deposito + ') es mayor que lo cobrado con TUU en la caja ($' + tuuTotal + ').');
    // Comisión: real (cobrado − depositado) repartida en proporción, o estimada por documento.
    const comisiones = deposito != null
      ? Cajas._repartir(tuuTotal - deposito, docs.map((d) => d.tuu))
      : docs.map((d) => Cajas._comisionEstimada('debito', d.medios.debito || 0) + Cajas._comisionEstimada('credito', d.medios.credito || 0));
    docs.forEach((d, i) => { d.comision = comisiones[i]; });

    // Stock: lo que piden todos los tickets debe estar disponible (sin contar las reservas de esta caja).
    const pedido = {};
    docs.forEach((d) => d.lineas.forEach((l) => { if (l.productoId) pedido[l.productoId] = (pedido[l.productoId] || 0) + l.cantidad; }));
    Cajas._omitir = 'todo';
    try {
      const disp = {};
      Ventas.lotesDisponibles().forEach((l) => { disp[l.productoId] = (disp[l.productoId] || 0) + Math.max(0, l.disponible); });
      Object.keys(pedido).forEach((pid) => {
        if (pedido[pid] > (disp[pid] || 0)) throw new AppError('Stock insuficiente de ' + Productos.nombreCompleto(Productos.requerir(pid)) + ' para cerrar la caja: quedan ' + (disp[pid] || 0) + '.');
      });

      const sello = Util.sello(user, true);
      const tuuDocs = [];
      let nVentas = 0;
      let nMovs = 0;
      plan.forEach((x) => {
        const t = x.ticket;
        const ids = [];
        x.docs.forEach((d) => {
          const pagados = Object.keys(d.medios).filter((m) => m !== 'pendiente' && d.medios[m] > 0).sort((a, b) => d.medios[b] - d.medios[a]);
          const principal = pagados[0] || 'efectivo';
          const v = Ventas.crear({
            fecha: caja.fecha, cliente: t.cliente, canal: t.canal, evento: t.evento, medioPago: principal, notas: 'Ticket ' + t.id + (t.notas ? ' · ' + t.notas : ''),
            lineas: d.lineas.map((l) => (l.productoId ? { productoId: l.productoId, cantidad: l.cantidad, precio: l.precio } : { categoria: l.categoria, descripcion: l.descripcion, monto: l.monto })),
          }, user);
          // Lo pagado con el medio principal es el abono; los otros medios quedan como abonos del mismo día.
          Db.update('Ventas', v.id, Object.assign({ abono: pagados.length ? d.medios[principal] : 0, comision: d.comision }, Util.sello(user)));
          pagados.slice(1).forEach((m) => Db.insert('Cobros', Object.assign({
            id: Util.siguienteId('COB', 6), ventaId: v.id, fecha: caja.fecha, monto: d.medios[m], medioPago: m, notas: 'Ticket ' + t.id,
          }, sello)));
          if (d.tuu) tuuDocs.push({ ventaId: v.id, monto: d.tuu });
          ids.push(v.id);
          nVentas++;
        });
        Db.update('Caja_Tickets', t.id, Object.assign({ estado: 'pasado', documentos: JSON.stringify(ids) }, Util.sello(user)));
      });
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
      const comisionTuu = docs.reduce((s, d) => s + d.comision, 0);
      Db.update('Cajas', caja.id, Object.assign({
        estado: 'cerrada', tuuTotal: tuuTotal, depositoTuu: deposito || 0, comisionTuu: comisionTuu, tuuDocs: JSON.stringify(tuuDocs),
        cerradaEn: Util.ahora(), cerradaPor: user.email,
      }, Util.sello(user)));
      Audit.log(user, 'cerrar', 'Caja', caja.id, { tickets: tickets.length, ventas: nVentas, movimientos: nMovs, tuu: tuuTotal, deposito: deposito, comision: comisionTuu });
      return { ventas: nVentas, movimientos: nMovs, tickets: tickets.length, comisionTuu: comisionTuu };
    } finally {
      Cajas._omitir = null;
    }
  },

  /** Caja cerrada sin el depósito de TUU (aún no llegaba): con el depósito real se corrige la comisión de sus ventas. */
  conciliarTuu(p, user) {
    const caja = Db.get('Cajas', String(p.id || ''));
    if (!caja || caja.estado !== 'cerrada') throw new AppError('La caja no existe o aún no está cerrada.');
    const deposito = Util.entero(p.depositoTuu, 'El depósito de TUU', { requerido: true, min: 0, max: caja.tuuTotal });
    let docs = [];
    try { docs = JSON.parse(caja.tuuDocs || '[]'); } catch (e) { docs = []; }
    const vivas = docs.filter((d) => { const v = Db.get('Ventas', d.ventaId); return v && !v.anulada; });
    const coms = Cajas._repartir(caja.tuuTotal - deposito, vivas.map((d) => d.monto));
    if (vivas.length) Db.actualizarVarios('Ventas', vivas.reduce((o, d, i) => { o[d.ventaId] = Object.assign({ comision: coms[i] }, Util.sello(user)); return o; }, {}));
    Db.update('Cajas', caja.id, Object.assign({ depositoTuu: deposito, comisionTuu: caja.tuuTotal - deposito }, Util.sello(user)));
    Audit.log(user, 'conciliar TUU', 'Caja', caja.id, { deposito: deposito, comision: caja.tuuTotal - deposito, ventas: vivas.length });
    return { comisionTuu: caja.tuuTotal - deposito };
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
