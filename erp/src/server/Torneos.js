/**
 * Torneos: inscripciones, premios, juez y resultado de cada torneo.
 *
 *   - Se crea desde el archivo .tdf de TOM (el navegador lo lee y manda nombre, fecha y jugadores con
 *     su Player ID y lugar final). Cada jugador se enlaza con su cliente por el ID Pokémon (o por nombre
 *     la primera vez) y queda como un ticket "pendiente" en la caja de ese día: al cobrarle se cambia el
 *     medio de pago en la caja, y si no paga, al cerrar la caja queda como deuda del cliente.
 *   - Premios: salen del inventario como salida ligada al torneo, "comprados" por el torneo a su precio
 *     (por defecto el PVP), así la factura del producto no pierde ganancia y el torneo carga el premio.
 *   - Juez: pago en efectivo, como egreso de la caja del torneo (categoría Torneos en Finanzas).
 *   - Resultado = inscripciones sin IVA − comisiones TUU − premios sin IVA − juez.
 */
const Torneos = {
  requerir(id) {
    const t = Db.get('Torneos', String(id || ''));
    if (!t) throw new AppError('El torneo no existe.', 'NO_ENCONTRADO');
    return t;
  },

  /** Cliente del jugador: el elegido, el que tiene su ID Pokémon, o por nombre (se crea si no existe). Le guarda el ID. */
  _cliente(j, user) {
    const popId = String(j.popId || '').trim();
    let cli = null;
    if (j.clienteId) cli = Clientes.requerir(j.clienteId);
    else if (j.cliente) cli = Clientes.requerir(Clientes.resolver({ cliente: j.cliente }, user));
    else if (popId) cli = Db.all('Clientes').find((c) => String(c.idPokemon || '').trim() === popId) || null;
    if (!cli) cli = Clientes.requerir(Clientes.resolver({ cliente: j.nombre }, user));
    if (popId) {
      const otro = Db.all('Clientes').find((c) => c.id !== cli.id && String(c.idPokemon || '').trim() === popId);
      if (otro) throw new AppError('El ID Pokémon ' + popId + ' (' + j.nombre + ') ya es de ' + otro.nombre + ' (' + otro.id + ').');
      const actual = String(cli.idPokemon || '').trim();
      if (actual && actual !== popId) throw new AppError(cli.nombre + ' ya tiene el ID Pokémon ' + actual + ': no puede ser también ' + j.nombre + ' (' + popId + ').');
      if (!actual) Db.update('Clientes', cli.id, Object.assign({ idPokemon: popId }, Util.sello(user)));
    }
    return Db.get('Clientes', cli.id);
  },

  /** Ticket "pendiente" en la caja del torneo con la inscripción del jugador. */
  _ticket(torneo, jugador, cliente, user) {
    return Cajas.guardarTicket({
      cajaId: torneo.cajaId, tipo: 'venta', cliente: cliente.nombre, canal: 'Tienda', evento: '',
      lineas: [{ categoria: 'Torneo', descripcion: (torneo.nombre + ' · ' + jugador.nombre).slice(0, 120), monto: torneo.inscripcion, tj: jugador.id }],
      pagos: [{ medio: 'pendiente', monto: torneo.inscripcion }],
    }, user).id;
  },

  /**
   * Crea el torneo con sus jugadores. p: { nombre, fecha, formato, inscripcion, ciudad, rondas, notas,
   * jugadores: [{ popId, nombre, lugar, clienteId | cliente, sinCosto }] }.
   */
  crear(p, user) {
    const nombre = Util.texto(p.nombre, 'El nombre del torneo', { requerido: true, max: 80 });
    const fecha = Util.fecha(p.fecha, 'La fecha del torneo', { requerido: true });
    const formato = Util.texto(p.formato, 'El formato', { requerido: true, max: 60 });
    const inscripcion = Util.entero(p.inscripcion, 'El valor de la inscripción', { requerido: true, min: 1 });
    const entrada = Array.isArray(p.jugadores) ? p.jugadores : [];
    if (!entrada.length) throw new AppError('El torneo no tiene jugadores.');
    if (Db.all('Torneos').some((t) => t.fecha === fecha && Util.normalizar(t.nombre) === Util.normalizar(nombre))) {
      throw new AppError('Ya existe el torneo "' + nombre + '" del ' + fecha + '.');
    }
    const ids = {};
    const jugadores = entrada.map((j, i) => {
      const nom = Util.texto(j.nombre, 'El nombre del jugador ' + (i + 1), { requerido: true, max: 120 });
      const popId = Util.texto(j.popId, 'El Player ID de ' + nom, { max: 20 });
      if (popId && ids[popId]) throw new AppError('El Player ID ' + popId + ' está repetido.');
      if (popId) ids[popId] = true;
      return { popId: popId, nombre: nom, lugar: Util.entero(j.lugar, 'El lugar de ' + nom, { min: 0 }), clienteId: j.clienteId || '', cliente: j.cliente || '', sinCosto: j.sinCosto === true };
    });
    const caja = Cajas.abrir({ fecha: fecha }, user);
    const torneo = Object.assign({
      id: Util.siguienteId('TRN', 4), fecha: fecha, nombre: nombre, formato: formato, inscripcion: inscripcion, cajaId: caja.id,
      ciudad: Util.texto(p.ciudad, 'La ciudad', { max: 60 }), rondas: Util.entero(p.rondas, 'Las rondas', { min: 0 }),
      juez: 0, juezTicket: '', notas: Util.texto(p.notas, 'Las notas', { max: 300 }),
    }, Util.sello(user, true));
    // Primero los clientes (si algo falla, aún no hay torneo ni tickets).
    const clientes = jugadores.map((j) => Torneos._cliente(j, user));
    Db.insert('Torneos', torneo);
    const tjIds = Util.reservarIds('TJ', 6, jugadores.length);
    const filas = jugadores.map((j, i) => Object.assign({
      id: tjIds[i], torneoId: torneo.id, popId: j.popId, nombre: j.nombre, clienteId: clientes[i].id, lugar: j.lugar, sinCosto: j.sinCosto,
    }, Util.sello(user, true)));
    Db.insertMany('Torneo_Jugadores', filas);
    let tickets = 0;
    filas.forEach((j, i) => { if (!j.sinCosto) { Torneos._ticket(torneo, j, clientes[i], user); tickets++; } });
    Audit.log(user, 'crear', 'Torneo', torneo.id, { nombre: nombre, fecha: fecha, formato: formato, inscripcion: inscripcion, jugadores: filas.length, tickets: tickets });
    return { id: torneo.id, cajaId: caja.id, jugadores: filas.length, tickets: tickets };
  },

  editar(p, user) {
    const t = Torneos.requerir(p.id);
    const datos = {
      nombre: Util.texto(p.nombre, 'El nombre del torneo', { requerido: true, max: 80 }),
      formato: Util.texto(p.formato, 'El formato', { requerido: true, max: 60 }),
      notas: Util.texto(p.notas, 'Las notas', { max: 300 }),
    };
    const nuevo = Db.update('Torneos', t.id, Object.assign(datos, Util.sello(user)));
    Audit.log(user, 'editar', 'Torneo', t.id, Audit.diff(t, nuevo));
    return { id: t.id };
  },

  /** Ticket abierto (de una caja abierta) que tiene la línea del jugador, con la línea. */
  _ticketDe(tjId) {
    const abiertas = {};
    Db.all('Cajas').forEach((c) => { if (c.estado === 'abierta') abiertas[c.id] = true; });
    for (const t of Db.all('Caja_Tickets')) {
      if (t.estado !== 'abierto' || !abiertas[t.cajaId] || t.tipo !== 'venta') continue;
      const tk = Cajas._leer(t);
      if (tk.lineas.some((l) => l.tj === tjId)) return tk;
    }
    return null;
  },

  /** Enlaza un jugador con otro cliente (cuadrar jugadores con clientes). El ID Pokémon pasa al cliente nuevo. */
  vincularJugador(p, user) {
    const j = Db.get('Torneo_Jugadores', String(p.id || ''));
    if (!j) throw new AppError('El jugador no existe.', 'NO_ENCONTRADO');
    const antes = j.clienteId ? Db.get('Clientes', j.clienteId) : null;
    const nuevo = p.clienteId ? Clientes.requerir(p.clienteId) : Clientes.requerir(Clientes.resolver({ cliente: Util.texto(p.cliente, 'El cliente', { requerido: true, max: 120 }) }, user));
    if (antes && antes.id === nuevo.id) return { id: j.id };
    // El ID Pokémon se mueve del cliente anterior al nuevo.
    if (j.popId && antes && String(antes.idPokemon || '').trim() === j.popId) Db.update('Clientes', antes.id, Object.assign({ idPokemon: '' }, Util.sello(user)));
    const actual = String(nuevo.idPokemon || '').trim();
    if (j.popId && actual && actual !== j.popId) throw new AppError(nuevo.nombre + ' ya tiene el ID Pokémon ' + actual + '.');
    if (j.popId && !actual) Db.update('Clientes', nuevo.id, Object.assign({ idPokemon: j.popId }, Util.sello(user)));
    Db.update('Torneo_Jugadores', j.id, Object.assign({ clienteId: nuevo.id }, Util.sello(user)));
    // Si su ticket es solo de él, el ticket pasa a nombre del cliente correcto.
    const tk = Torneos._ticketDe(j.id);
    if (tk && antes && Util.normalizar(tk.cliente) === Util.normalizar(antes.nombre)) {
      Db.update('Caja_Tickets', tk.id, Object.assign({ cliente: nuevo.nombre }, Util.sello(user)));
    }
    Audit.log(user, 'vincular jugador', 'Torneo', j.torneoId, { jugador: j.nombre, popId: j.popId, antes: antes ? antes.id : '', cliente: nuevo.id });
    return { id: j.id, clienteId: nuevo.id };
  },

  /** Jugador sin costo (invitado, juez que juega) o de vuelta a pagar: quita o crea su inscripción en la caja. */
  cambiarCobro(p, user) {
    const j = Db.get('Torneo_Jugadores', String(p.id || ''));
    if (!j) throw new AppError('El jugador no existe.', 'NO_ENCONTRADO');
    const torneo = Torneos.requerir(j.torneoId);
    const sinCosto = p.sinCosto === true;
    if (sinCosto === j.sinCosto) return { id: j.id };
    const tk = Torneos._ticketDe(j.id);
    if (sinCosto) {
      if (!tk && Torneos._pasado(j.id)) throw new AppError('La inscripción de ' + j.nombre + ' ya pasó a Ventas (caja cerrada): anúlala o edítala en Ventas.');
      if (tk) {
        const lineas = tk.lineas.filter((l) => l.tj !== j.id);
        if (!lineas.length) Cajas.anularTicket({ id: tk.id }, user);
        else {
          const linea = tk.lineas.find((l) => l.tj === j.id);
          // Lo pendiente baja en lo que valía la inscripción; si ya pagó, se ajusta en la caja.
          const pagos = tk.pagos.map((g) => Object.assign({}, g));
          const pend = pagos.find((g) => g.medio === 'pendiente');
          if (pend && pend.monto >= linea.monto) pend.monto -= linea.monto;
          else throw new AppError('El ticket ' + tk.id + ' ya tiene pagos: quita la inscripción de ' + j.nombre + ' editando el ticket en la caja.');
          Cajas.guardarTicket(Object.assign({}, tk, { lineas: lineas, pagos: pagos.filter((g) => g.monto > 0) }), user);
        }
      }
    } else {
      Cajas.requerirAbierta(torneo.cajaId);
      Torneos._ticket(torneo, j, Clientes.requerir(j.clienteId), user);
    }
    Db.update('Torneo_Jugadores', j.id, Object.assign({ sinCosto: sinCosto }, Util.sello(user)));
    Audit.log(user, sinCosto ? 'sin costo' : 'cobrar inscripción', 'Torneo', torneo.id, { jugador: j.nombre });
    return { id: j.id };
  },

  /** ¿La inscripción del jugador ya pasó a Ventas (ticket cerrado)? */
  _pasado(tjId) {
    return Db.all('Caja_Tickets').some((t) => t.estado === 'pasado' && Cajas._leer(t).lineas.some((l) => l.tj === tjId));
  },

  /** Pago al juez (variable, en efectivo): un egreso en la caja del torneo. Monto 0 = sin pago. */
  guardarJuez(p, user) {
    const t = Torneos.requerir(p.id);
    const monto = Util.entero(p.monto, 'El pago al juez', { min: 0 });
    const actual = t.juezTicket ? Db.get('Caja_Tickets', t.juezTicket) : null;
    if (actual && actual.estado === 'pasado') throw new AppError('El pago al juez ya pasó a Finanzas (caja cerrada). Para cambiarlo, reabre la caja del ' + t.fecha + ' o edítalo en Finanzas.');
    const vivo = actual && actual.estado === 'abierto' ? actual : null;
    let ticket = '';
    if (monto) {
      Cajas.requerirAbierta(t.cajaId);
      const nota = Util.texto(p.notas, 'El detalle', { max: 100 });
      ticket = Cajas.guardarTicket({
        id: vivo ? vivo.id : '', cajaId: t.cajaId, tipo: 'egreso', cuenta: 'caja', notas: 'Torneo ' + t.id,
        lineas: [{ categoria: 'juez_torneo', descripcion: (t.nombre + (nota ? ' · ' + nota : '')).slice(0, 120), monto: monto }],
      }, user).id;
    } else if (vivo) Cajas.anularTicket({ id: vivo.id }, user);
    Db.update('Torneos', t.id, Object.assign({ juez: monto, juezTicket: ticket }, Util.sello(user)));
    Audit.log(user, 'juez', 'Torneo', t.id, { monto: monto, ticket: ticket });
    return { id: t.id, ticket: ticket };
  },

  /** Premio del inventario para el torneo: sale del stock "comprado" por el torneo a su precio (por defecto el PVP). */
  agregarPremio(p, user) {
    const t = Torneos.requerir(p.id);
    const prod = Productos.requerir(p.productoId);
    const precio = p.precio === '' || p.precio == null ? Productos.precio(prod) : Util.entero(p.precio, 'El precio del premio', { min: 0 });
    const lugar = Util.entero(p.lugar, 'El lugar', { min: 0 });
    const ganador = lugar ? Db.all('Torneo_Jugadores').find((j) => j.torneoId === t.id && j.lugar === lugar) : null;
    const notas = (t.nombre + (lugar ? ' · ' + lugar + 'º lugar' : '') + (ganador ? ' · ' + ganador.nombre : '') + (p.notas ? ' · ' + p.notas : '')).slice(0, 200);
    const r = Salidas.registrar({ productoId: prod.id, cantidad: p.cantidad, motivo: PREMIO_TORNEO, fecha: t.fecha, notas: notas, torneoId: t.id, precio: precio }, user);
    return { ids: r.ids, precio: precio };
  },

  /**
   * Varios premios de una vez (como agregar productos a un ticket). p: { id, premios: [{ productoId, cantidad, precio }] }.
   * Se revisa el stock de todos antes de sacar ninguno.
   */
  agregarPremios(p, user) {
    const t = Torneos.requerir(p.id);
    const todos = Array.isArray(p.premios) ? p.premios : [];
    const items = todos.filter((x) => x && x.productoId);
    // Sobres sueltos: sin stock, se suman al torneo a su precio (PVP $6.000 por defecto).
    const sobres = todos.filter((x) => x && x.sobres).map((x) => {
      const n = Util.entero(x.cantidad, 'La cantidad de sobres', { requerido: true, min: 1 });
      const precio = x.precio === '' || x.precio == null ? PRECIO_SOBRE_SUELTO : Util.entero(x.precio, 'El precio del sobre', { min: 0 });
      return { n: n, monto: n * precio };
    });
    if (!items.length && !sobres.length) throw new AppError('Elige al menos un premio.');
    const pedido = {};
    const filas = items.map((x) => {
      const prod = Productos.requerir(x.productoId);
      const nombre = Productos.nombreCompleto(prod);
      const cantidad = Util.entero(x.cantidad, 'La cantidad de ' + nombre, { requerido: true, min: 1 });
      const precio = x.precio === '' || x.precio == null ? Productos.precio(prod) : Util.entero(x.precio, 'El precio de ' + nombre, { min: 0 });
      pedido[prod.id] = (pedido[prod.id] || 0) + cantidad;
      return { prod: prod, nombre: nombre, cantidad: cantidad, precio: precio };
    });
    const disp = {};
    Ventas.lotesDisponibles().forEach((l) => { disp[l.productoId] = (disp[l.productoId] || 0) + Math.max(0, l.disponible); });
    filas.forEach((f) => {
      if (pedido[f.prod.id] > (disp[f.prod.id] || 0)) throw new AppError('Stock insuficiente de ' + f.nombre + ': quedan ' + (disp[f.prod.id] || 0) + '.');
    });
    const ids = [];
    if (sobres.length) {
      const n = sobres.reduce((a, x) => a + x.n, 0);
      const monto = sobres.reduce((a, x) => a + x.monto, 0);
      Db.update('Torneos', t.id, Object.assign({ sobres: (t.sobres || 0) + n, sobresMonto: (t.sobresMonto || 0) + monto }, Util.sello(user)));
      Audit.log(user, 'sobres premio', 'Torneo', t.id, { sobres: n, monto: monto });
    }
    filas.forEach((f) => {
      const r = Salidas.registrar({ productoId: f.prod.id, cantidad: f.cantidad, motivo: PREMIO_TORNEO, fecha: t.fecha, notas: t.nombre, torneoId: t.id, precio: f.precio }, user);
      ids.push.apply(ids, r.ids);
    });
    return { ids: ids, unidades: filas.reduce((a, f) => a + f.cantidad, 0) + sobres.reduce((a, x) => a + x.n, 0) };
  },

  /** Sobres sueltos de premio: fija la cantidad y el precio por sobre (0 sobres = quitarlos). */
  guardarSobres(p, user) {
    const t = Torneos.requerir(p.id);
    const n = Util.entero(p.cantidad, 'La cantidad de sobres', { min: 0 });
    const precio = p.precio === '' || p.precio == null ? PRECIO_SOBRE_SUELTO : Util.entero(p.precio, 'El precio del sobre', { min: 0 });
    Db.update('Torneos', t.id, Object.assign({ sobres: n, sobresMonto: n * precio }, Util.sello(user)));
    Audit.log(user, 'sobres premio', 'Torneo', t.id, { antes: (t.sobres || 0) + ' por $' + (t.sobresMonto || 0), sobres: n, monto: n * precio });
    return { id: t.id };
  },

  /**
   * Sobres de participación: uno para cada jugador, al precio torneo (por defecto $2.000). Se compran de
   * manera informal (la compra va como gasto en la caja o Finanzas); aquí solo se cargan al torneo. 0 = quitar.
   */
  guardarParticipacion(p, user) {
    const t = Torneos.requerir(p.id);
    const n = Util.entero(p.cantidad, 'La cantidad de sobres de participación', { min: 0 });
    const precio = p.precio === '' || p.precio == null ? PRECIO_SOBRE_PARTICIPACION : Util.entero(p.precio, 'El precio del sobre de participación', { min: 0 });
    Db.update('Torneos', t.id, Object.assign({ participacion: n, participacionMonto: n * precio }, Util.sello(user)));
    Audit.log(user, 'sobres participación', 'Torneo', t.id, { sobres: n, monto: n * precio });
    return { id: t.id };
  },

  /** Premio del torneo: cambiar el precio al que el torneo lo "compra" o quitarlo (la unidad vuelve al stock). */
  _premio(id) {
    const x = Db.get('Salidas', String(id || ''));
    if (!x || !x.torneoId || x.anulada) throw new AppError('El premio no existe.', 'NO_ENCONTRADO');
    return x;
  },
  precioPremio(p, user) {
    const x = Torneos._premio(p.id);
    const precio = Util.entero(p.precio, 'El precio del premio', { requerido: true, min: 0 });
    Db.update('Salidas', x.id, Object.assign({ precio: precio }, Util.sello(user)));
    Audit.log(user, 'precio premio', 'Torneo', x.torneoId, { salida: x.id, antes: x.precio, precio: precio });
    return { id: x.id };
  },
  quitarPremio(p, user) {
    const x = Torneos._premio(p.id);
    Salidas.anular({ id: x.id }, user);
    return { id: x.id };
  },

  /** Elimina un torneo mal importado: solo si sus inscripciones no han pasado a Ventas. Anula sus tickets y premios. */
  eliminar(p, user) {
    const t = Torneos.requerir(p.id);
    const jugadores = Db.all('Torneo_Jugadores').filter((j) => j.torneoId === t.id);
    if (jugadores.some((j) => Torneos._pasado(j.id))) throw new AppError('Hay inscripciones que ya pasaron a Ventas (caja cerrada): el torneo no se puede eliminar.');
    const juez = t.juezTicket ? Db.get('Caja_Tickets', t.juezTicket) : null;
    if (juez && juez.estado === 'pasado') throw new AppError('El pago al juez ya pasó a Finanzas: el torneo no se puede eliminar.');
    const mios = {};
    jugadores.forEach((j) => { mios[j.id] = true; });
    Db.all('Caja_Tickets').filter((x) => x.estado === 'abierto' && x.tipo === 'venta').map(Cajas._leer).forEach((tk) => {
      if (!tk.lineas.some((l) => mios[l.tj])) return;
      const resto = tk.lineas.filter((l) => !mios[l.tj]);
      if (!resto.length) { Cajas.anularTicket({ id: tk.id }, user); return; }
      throw new AppError('El ticket ' + tk.id + ' tiene otras cosas además de inscripciones de este torneo: quítalas primero en la caja.');
    });
    if (juez && juez.estado === 'abierto') Cajas.anularTicket({ id: juez.id }, user);
    Db.all('Salidas').filter((x) => x.torneoId === t.id && !x.anulada).forEach((x) => Salidas.anular({ id: x.id }, user));
    jugadores.forEach((j) => Db.remove('Torneo_Jugadores', j.id));
    Db.remove('Torneos', t.id);
    Audit.log(user, 'eliminar', 'Torneo', t.id, { nombre: t.nombre, fecha: t.fecha, jugadores: jugadores.length });
  },

  /**
   * Torneos con jugadores (estado de pago de cada inscripción), premios, juez y resultado.
   * ventas: la vista de Ventas (para saber si una inscripción que ya pasó a Ventas quedó pagada o debe).
   */
  vista(ventas, clientes) {
    const torneos = Db.all('Torneos');
    if (!torneos.length) return [];
    const cli = {};
    clientes.forEach((c) => { cli[c.id] = c; });
    const ventaPorId = {};
    ventas.forEach((v) => { ventaPorId[v.id] = v; });
    // Dónde quedó cada inscripción: ticket abierto o venta TOR (ticket ya pasado).
    const enTicket = {};
    Db.all('Caja_Tickets').filter((t) => t.tipo === 'venta' && t.estado !== 'anulado').map(Cajas._leer).forEach((t) => {
      t.lineas.forEach((l) => { if (l.tj) enTicket[l.tj] = { ticket: t, linea: l }; });
    });
    const premios = {};
    Db.all('Salidas').filter((x) => x.torneoId && !x.anulada).forEach((x) => { (premios[x.torneoId] = premios[x.torneoId] || []).push(x); });
    const prodNombre = {};
    Db.all('Productos').forEach((p) => { prodNombre[p.id] = Productos.nombreCompleto(p); });
    const porTorneo = {};
    Db.all('Torneo_Jugadores').forEach((j) => { (porTorneo[j.torneoId] = porTorneo[j.torneoId] || []).push(j); });
    const juezTicket = {};
    Db.all('Caja_Tickets').forEach((t) => { juezTicket[t.id] = t; });

    return torneos.map((t) => {
      const jugadores = (porTorneo[t.id] || []).map((j) => {
        const c = cli[j.clienteId];
        const r = { id: j.id, popId: j.popId, nombre: j.nombre, lugar: j.lugar, sinCosto: j.sinCosto, clienteId: j.clienteId, cliente: c ? c.nombre : '', monto: 0, comision: 0, estado: j.sinCosto ? 'sin_costo' : 'sin_ticket', ticketId: '', ventaId: '', pagadoPor: '', debe: 0 };
        const e = enTicket[j.id];
        if (!e || j.sinCosto) return r;
        const tk = e.ticket;
        r.monto = e.linea.monto;
        r.ticketId = tk.id;
        r.pagadoPor = tk.cliente;
        const parte = tk.total ? r.monto / tk.total : 0;
        if (tk.estado === 'abierto') {
          const pend = tk.pagos.filter((g) => g.medio === 'pendiente').reduce((s, g) => s + g.monto, 0);
          r.debe = Math.round(pend * parte);
          r.estado = pend >= tk.total ? 'por_cobrar' : pend > 0 ? 'parcial' : 'pagado';
          r.comision = Math.round(tk.pagos.filter((g) => TUU_MEDIOS.indexOf(g.medio) !== -1).reduce((s, g) => s + Economia.comisionPago(g.medio, g.monto), 0) * parte);
          r.medios = tk.pagos.filter((g) => g.medio !== 'pendiente').map((g) => g.medio);
        } else {
          const tor = (tk.documentos || []).map((id) => ventaPorId[id]).find((v) => v && /^TOR-/.test(v.id));
          if (tor) {
            const p2 = tor.total ? r.monto / tor.total : 0;
            r.ventaId = tor.id;
            r.debe = Math.round(Math.max(0, tor.saldo) * p2);
            r.comision = Math.round((tor.comision || 0) * p2);
            r.estado = tor.anulada ? 'anulada' : r.debe > 0 ? (r.debe < r.monto ? 'parcial' : 'debe') : 'pagado';
            r.medios = [tor.medioPago];
          }
        }
        return r;
      }).sort((a, b) => (a.lugar || 999) - (b.lugar || 999) || a.nombre.localeCompare(b.nombre));
      const pr = (premios[t.id] || []).map((x) => ({ id: x.id, productoId: x.productoId, producto: prodNombre[x.productoId] || x.productoId, cantidad: x.cantidad, precio: x.precio || 0, costo: x.costo, notas: x.notas }));
      const vivos = jugadores.filter((j) => j.estado !== 'anulada');
      const inscripciones = vivos.reduce((s, j) => s + j.monto, 0);
      const comisiones = vivos.reduce((s, j) => s + j.comision, 0);
      const premiosBruto = pr.reduce((s, x) => s + x.precio * x.cantidad, 0) + (t.sobresMonto || 0) + (t.participacionMonto || 0);
      const premiosCosto = pr.reduce((s, x) => s + x.costo * x.cantidad, 0);
      const insNeto = Economia.sinIva(inscripciones);
      const premiosNeto = Economia.sinIva(premiosBruto);
      const margen = insNeto - comisiones - premiosNeto - (t.juez || 0);
      const pagan = vivos.filter((j) => j.monto > 0).length;
      // Punto de equilibrio: jugadores que pagan la inscripción para cubrir premios y juez.
      const porJugador = Economia.sinIva(t.inscripcion) - (pagan ? comisiones / pagan : 0);
      const jt = t.juezTicket ? juezTicket[t.juezTicket] : null;
      return Object.assign({}, t, {
        jugadores: jugadores, premios: pr,
        juezEstado: jt ? jt.estado : '',
        cajaEstado: (Db.get('Cajas', t.cajaId) || {}).estado || '',
        resultado: {
          jugadores: jugadores.length, pagan: pagan, inscripciones: inscripciones, iva: inscripciones - insNeto, comisiones: comisiones,
          premiosBruto: premiosBruto, premiosNeto: premiosNeto, premiosCosto: premiosCosto, juez: t.juez || 0, margen: margen,
          margenPct: insNeto ? margen / insNeto : 0, porJugador: jugadores.length ? margen / jugadores.length : 0,
          equilibrio: porJugador > 0 ? Math.ceil((premiosNeto + (t.juez || 0)) / porJugador) : 0,
          porCobrar: vivos.filter((j) => j.estado === 'por_cobrar' || j.estado === 'parcial' || j.estado === 'debe').reduce((s, j) => s + j.debe, 0),
        },
      });
    }).sort((a, b) => (b.fecha + b.id).localeCompare(a.fecha + a.id));
  },
};
