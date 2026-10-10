/**
 * Migración del histórico desde el Excel "Stock" (una fila por unidad, como la planilla).
 *
 * Nada entra al ERP hasta el final. El proceso es:
 *   1. cargar: las filas del Excel quedan en la hoja Migracion (zona de preparación) y se
 *      generan propuestas de homologación en Migracion_Mapeos: proveedor, factura,
 *      producto y cliente/destino de cada unidad vendida.
 *   2. revisar: el administrador corrige y confirma cada propuesta, completa facturas y
 *      filas con datos faltantes (o las descarta).
 *   3. importar: con todo confirmado y sin errores, se respalda la planilla y se crean
 *      proveedores, productos, compras (lotes con su costo), ventas (OC nuevas que guardan
 *      la OC original) y salidas (premios, cajas abiertas). Se hace una sola vez.
 */
const Migracion = {
  ACCIONES: { cliente: 'Venta a cliente', general: 'Venta a Cliente general', evento: 'Venta en evento', premio: 'Premio (salida)', apertura: 'Caja abierta (salida)', interno: 'Uso interno (salida)' },
  FACTURA_VACIA: ['', '-', 'e', '0', 'factura', 'none'],

  /** Carga (o recarga) las filas del Excel. Conserva lo ya homologado para las mismas claves. */
  cargar(p, user) {
    Migracion._noImportada();
    const filas = Array.isArray(p.filas) ? p.filas : [];
    if (!filas.length) throw new AppError('No llegaron filas. Revisa que el archivo tenga la hoja con la fila de títulos (Proveedor, Factura, Producto…).');
    if (filas.length > 5000) throw new AppError('Son demasiadas filas para una carga (máximo 5.000).');
    const ids = filas.map((_, i) => 'M-' + String(i + 1).padStart(5, '0'));
    const registros = filas.map((f, i) => {
      const r = {
        id: ids[i], fila: Number(f.fila) || i + 1,
        proveedor: Migracion._txt(f.proveedor), factura: Migracion._txt(f.factura), serie: Migracion._txt(f.serie),
        producto: Migracion._txt(f.producto), costo: Migracion._num(f.costo), venta: Migracion._num(f.venta),
        oc: Migracion._txt(f.oc), cliente: Migracion._txt(f.cliente), boleta: Migracion._txt(f.boleta), nota: '',
      };
      // Filas que no son unidades: vacías o títulos repetidos.
      const titulo = Util.normalizar(r.producto) === 'producto' || Util.normalizar(r.proveedor) === 'proveedor';
      r.descartada = titulo || (!r.producto && !r.costo && !r.venta);
      if (r.descartada) r.nota = titulo ? 'Fila de títulos' : 'Fila vacía';
      return r;
    });
    Db.vaciar('Migracion');
    Db.insertMany('Migracion', registros);
    Migracion._proponer(user);
    Audit.log(user, 'cargar', 'Migración', '', { filas: registros.length });
    return Migracion.estado();
  },

  /** Crea las propuestas que falten (no toca las que ya existen). */
  _proponer() {
    const filas = Db.all('Migracion').filter((f) => !f.descartada);
    const existentes = {};
    Db.all('Migracion_Mapeos').forEach((m) => { existentes[m.clave] = m; });
    const nuevos = {};
    const agregar = (m) => { if (!existentes[m.clave] && !nuevos[m.clave]) nuevos[m.clave] = Object.assign({ confirmado: false, accion: '', extra: '' }, m); };
    const provs = Db.all('Proveedores');
    filas.forEach((f) => {
      const kp = Migracion.clave('proveedor', f.proveedor);
      const prov = provs.find((x) => Util.normalizar(x.nombre) === Util.normalizar(f.proveedor));
      agregar({ clave: kp, tipo: 'proveedor', original: f.proveedor, destino: prov ? prov.nombre : interpretarNombre_(f.proveedor, 'titulo') });
      const vacia = Migracion.FACTURA_VACIA.indexOf(Util.normalizar(f.factura)) !== -1;
      agregar({ clave: Migracion.claveFactura(f), tipo: 'factura', original: f.proveedor + ' · ' + (f.factura || '(vacía)'), destino: vacia ? '' : f.factura });
      agregar({ clave: Migracion.clave('producto', f.producto), tipo: 'producto', original: f.producto, destino: Migracion._propuestaProducto(f.producto) });
      if (Migracion.vendida(f)) {
        const p = Migracion._propuestaCliente(f.cliente);
        agregar({ clave: Migracion.clave('cliente', f.cliente), tipo: 'cliente', original: f.cliente || '(sin cliente)', destino: p.destino, accion: p.accion, extra: p.extra });
      }
    });
    const lista = Object.keys(nuevos).map((k) => nuevos[k]);
    if (lista.length) Db.insertMany('Migracion_Mapeos', lista);
  },

  _propuestaProducto(raw) {
    const i = interpretarNombre_(raw);
    return [i.edicion, i.nombre].filter(Boolean).join(' – ') + (i.idioma ? ' · ' + i.idioma : '');
  },

  _propuestaCliente(raw) {
    const n = Util.normalizar(raw);
    if (!n) return { accion: 'general', destino: '', extra: '' };
    if (/premio/.test(n)) return { accion: 'premio', destino: '', extra: '' };
    if (/abierto/.test(n)) return { accion: 'apertura', destino: '', extra: '' };
    if (/\bnn\b/.test(n)) return /evento/.test(n) ? { accion: 'evento', destino: '', extra: 'Evento' } : { accion: 'general', destino: '', extra: '' };
    if (/feria|evento|torneo|release/.test(n)) return { accion: 'evento', destino: '', extra: interpretarNombre_(raw, 'titulo') };
    return { accion: 'cliente', destino: interpretarNombre_(raw, 'titulo'), extra: '' };
  },

  vendida(f) { return !!(f.oc || f.cliente); },
  clave(tipo, v) { return tipo + '|' + Util.normalizar(v); },
  claveFactura(f) { return 'factura|' + Util.normalizar(f.proveedor) + '|' + Util.normalizar(f.factura); },
  _txt(v) { return v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); },
  /** Números como vienen del Excel: 39995, "39.995", "$ 47.594,05", "47594.05". */
  _num(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    let s = String(v == null ? '' : v).replace(/[$\s]/g, '');
    if (!s) return 0;
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  },

  /** Guarda correcciones de homologación: [{ clave, destino?, accion?, extra?, confirmado? }]. */
  guardarMapeos(p, user) {
    Migracion._noImportada();
    const cambios = Array.isArray(p.mapeos) ? p.mapeos : [];
    const todo = {};
    cambios.forEach((c) => {
      const patch = {};
      if ('destino' in c) patch.destino = Util.texto(c.destino, 'El valor', { max: 200 });
      if ('accion' in c) patch.accion = Util.opcion(c.accion, 'La acción', Object.keys(Migracion.ACCIONES));
      if ('extra' in c) patch.extra = Util.texto(c.extra, 'El dato adicional', { max: 120 });
      if ('confirmado' in c) patch.confirmado = c.confirmado === true;
      todo[String(c.clave || '')] = Object.assign(todo[String(c.clave || '')] || {}, patch);
    });
    Db.actualizarVarios('Migracion_Mapeos', todo);
    return Migracion.estado();
  },

  /** Corrige filas: [{ id, producto?, costo?, venta?, descartada? }]. */
  guardarFilas(p, user) {
    Migracion._noImportada();
    const cambios = Array.isArray(p.filas) ? p.filas : [];
    const todo = {};
    cambios.forEach((c) => {
      const patch = {};
      if ('producto' in c) patch.producto = Util.texto(c.producto, 'El producto', { max: 200 });
      if ('costo' in c) patch.costo = Util.monto(c.costo, 'El costo');
      if ('venta' in c) patch.venta = Util.monto(c.venta, 'El precio de venta');
      if ('descartada' in c) { patch.descartada = c.descartada === true; patch.nota = patch.descartada ? 'Descartada a mano' : ''; }
      todo[String(c.id || '')] = Object.assign(todo[String(c.id || '')] || {}, patch);
    });
    Db.actualizarVarios('Migracion', todo);
    Migracion._proponer(user);
    return Migracion.estado();
  },

  /** Estado completo para la pantalla: filas, mapeos con su cantidad de unidades, problemas y resumen. */
  estado() {
    const filas = Db.all('Migracion');
    const mapeos = Db.all('Migracion_Mapeos');
    const activas = filas.filter((f) => !f.descartada);
    const uso = {};
    const sumar = (k) => { uso[k] = (uso[k] || 0) + 1; };
    activas.forEach((f) => {
      sumar(Migracion.clave('proveedor', f.proveedor));
      sumar(Migracion.claveFactura(f));
      sumar(Migracion.clave('producto', f.producto));
      if (Migracion.vendida(f)) sumar(Migracion.clave('cliente', f.cliente));
    });
    const vigentes = mapeos.filter((m) => uso[m.clave]).map((m) => Object.assign(m, { unidades: uso[m.clave] }));
    const problemas = [];
    activas.forEach((f) => {
      const faltas = [];
      if (!f.producto) faltas.push('producto');
      if (!f.costo) faltas.push('costo');
      if (Migracion.vendida(f) && !f.venta) {
        const m = vigentes.find((x) => x.clave === Migracion.clave('cliente', f.cliente));
        if (!m || ['cliente', 'general', 'evento'].indexOf(m.accion) !== -1) faltas.push('precio de venta');
      }
      if (faltas.length) problemas.push({ id: f.id, fila: f.fila, faltas: faltas });
    });
    const errores = [];
    const porTipo = (t) => vigentes.filter((m) => m.tipo === t);
    ['proveedor', 'factura', 'producto', 'cliente'].forEach((t) => {
      const sin = porTipo(t).filter((m) => !m.confirmado).length;
      if (sin) errores.push(sin + ' ' + { proveedor: 'proveedores', factura: 'facturas', producto: 'productos', cliente: 'clientes/destinos' }[t] + ' sin confirmar');
    });
    const sinNumero = porTipo('factura').filter((m) => !m.destino).length;
    if (sinNumero) errores.push(sinNumero + ' facturas sin número');
    const sinNombre = vigentes.filter((m) => (m.tipo === 'producto' || m.tipo === 'proveedor' || (m.tipo === 'cliente' && m.accion === 'cliente')) && !m.destino).length;
    if (sinNombre) errores.push(sinNombre + ' homologaciones sin nombre de destino');
    if (problemas.length) errores.push(problemas.length + ' filas con datos faltantes');
    const vendidas = activas.filter(Migracion.vendida);
    const props = PropertiesService.getScriptProperties();
    return {
      filas: filas,
      mapeos: vigentes,
      problemas: problemas,
      errores: errores,
      acciones: Migracion.ACCIONES,
      resumen: {
        filas: filas.length, descartadas: filas.length - activas.length, unidades: activas.length,
        vendidas: vendidas.length, disponibles: activas.length - vendidas.length,
        costoDisponible: activas.filter((f) => !Migracion.vendida(f)).reduce((t, f) => t + f.costo, 0),
      },
      importada: props.getProperty('MIGRACION_IMPORTADA') || '',
    };
  },

  /** Crea todo en el ERP. Una sola vez, con respaldo previo y sin errores pendientes. */
  importar(p, user) {
    Migracion._noImportada();
    const fecha = Util.fecha(p.fecha, 'La fecha de la migración', { requerido: true });
    const est = Migracion.estado();
    if (est.errores.length) throw new AppError('Antes de importar resuelve: ' + est.errores.join('; ') + '.');
    const map = {};
    est.mapeos.forEach((m) => { map[m.clave] = m; });
    const filas = est.filas.filter((f) => !f.descartada);
    Respaldos.crear('antes de importar la migración', user);
    const sello = Util.sello(user, true);

    // Proveedores.
    const provId = {};
    est.mapeos.filter((m) => m.tipo === 'proveedor').forEach((m) => {
      const ex = Db.all('Proveedores').find((x) => Util.normalizar(x.nombre) === Util.normalizar(m.destino));
      provId[m.clave] = ex ? ex.id : Proveedores.guardar({ nombre: m.destino, despachoUmbral: 0, despachoMonto: 0, notas: 'Creado en la migración' }, user).id;
    });

    // Productos: con el precio de venta más usado entre sus unidades disponibles (o todas).
    const prodId = {};
    est.mapeos.filter((m) => m.tipo === 'producto').forEach((m) => {
      const suyas = filas.filter((f) => Migracion.clave('producto', f.producto) === m.clave);
      const base = suyas.filter((f) => !Migracion.vendida(f) && f.venta).length ? suyas.filter((f) => !Migracion.vendida(f) && f.venta) : suyas.filter((f) => f.venta);
      const cuenta = {};
      base.forEach((f) => { cuenta[f.venta] = (cuenta[f.venta] || 0) + 1; });
      const pvp = Object.keys(cuenta).sort((a, b) => cuenta[b] - cuenta[a])[0];
      prodId[m.clave] = Productos.resolverTexto(m.destino, pvp ? Math.round(Number(pvp)) : '', user).id;
    });

    // Compras (una por factura) y lotes (uno por producto + costo dentro de la factura).
    const facturas = {};
    filas.forEach((f) => {
      const kf = Migracion.claveFactura(f);
      const fac = facturas[kf] = facturas[kf] || { mapeo: map[kf], proveedorId: provId[Migracion.clave('proveedor', f.proveedor)], lotes: {} };
      const kl = Migracion.clave('producto', f.producto) + '|' + f.costo;
      (fac.lotes[kl] = fac.lotes[kl] || { productoId: prodId[Migracion.clave('producto', f.producto)], costo: f.costo, filas: [] }).filas.push(f);
    });
    const listaFac = Object.keys(facturas).map((k) => facturas[k]);
    // Facturas con el mismo número y proveedor (en el Excel o ya en el ERP) se unen en una sola compra.
    const unidas = {};
    listaFac.forEach((fac) => {
      const k = fac.proveedorId + '|' + Util.normalizar(fac.mapeo.destino);
      if (!unidas[k]) unidas[k] = { proveedorId: fac.proveedorId, numero: fac.mapeo.destino, fecha: fac.mapeo.extra || fecha, lotes: [] };
      Object.keys(fac.lotes).forEach((kl) => unidas[k].lotes.push(fac.lotes[kl]));
    });
    const compras = Object.keys(unidas).map((k) => unidas[k]);
    const existentes = Db.all('Compras');
    compras.forEach((c) => {
      const rep = existentes.find((x) => x.proveedorId === c.proveedorId && Util.normalizar(x.factura) === Util.normalizar(c.numero));
      if (rep) throw new AppError('La factura ' + c.numero + ' ya existe en el ERP (' + rep.id + '). Cámbiale el número en la homologación.');
    });
    const idsCompra = Util.reservarIds('CP', 4, compras.length);
    const nLotes = compras.reduce((t, c) => t + c.lotes.length, 0);
    const idsLote = Util.reservarIds('CPI', 6, nLotes);
    const loteDeFila = {};
    const regCompras = [];
    const regLotes = [];
    let il = 0;
    compras.forEach((c, i) => {
      regCompras.push(Object.assign({ id: idsCompra[i], proveedorId: c.proveedorId, factura: c.numero, fecha: Util.fecha(c.fecha, 'La fecha de la factura ' + c.numero) || fecha, despacho: 0, notas: 'Migración desde Excel' }, sello));
      c.lotes.forEach((l) => {
        const id = idsLote[il++];
        regLotes.push(Object.assign({ id: id, compraId: idsCompra[i], preventaId: '', productoId: l.productoId, cantidad: l.filas.length, costoNeto: l.costo, despacho: 0 }, sello));
        l.filas.forEach((f) => { loteDeFila[f.id] = { id: id, costo: l.costo, productoId: l.productoId }; });
      });
    });
    Db.insertMany('Compras', regCompras);
    Db.insertMany('Compras_Lineas', regLotes);

    // Ventas (agrupadas por OC original) y salidas.
    const vendidas = filas.filter(Migracion.vendida);
    const grupos = {};
    const salidas = {};
    vendidas.forEach((f) => {
      const m = map[Migracion.clave('cliente', f.cliente)];
      const lote = loteDeFila[f.id];
      if (['premio', 'apertura', 'interno'].indexOf(m.accion) !== -1) {
        const k = lote.id + '|' + m.accion + '|' + m.original;
        (salidas[k] = salidas[k] || { motivo: m.accion, lote: lote, notas: 'Migración · ' + m.original, cantidad: 0 }).cantidad++;
        return;
      }
      const ocValida = /^(oc|pr)\s*-?\s*0*[1-9]\d*$/i.test(f.oc);
      const k = (ocValida ? Util.normalizar(f.oc) : 'sin-oc') + '|' + m.clave;
      const g = grupos[k] = grupos[k] || { mapeo: m, oc: ocValida ? f.oc : '', boletas: [], lineas: {} };
      if (f.boleta && g.boletas.indexOf(f.boleta) === -1) g.boletas.push(f.boleta);
      const kl = lote.id + '|' + f.venta;
      (g.lineas[kl] = g.lineas[kl] || { loteId: lote.id, productoId: lote.productoId, costo: lote.costo, precio: Math.round(f.venta), cantidad: 0 }).cantidad++;
    });
    const listaVentas = Object.keys(grupos).map((k) => grupos[k]);
    const idsVenta = Util.reservarIds('OC', 4, listaVentas.length);
    const nLineas = listaVentas.reduce((t, g) => t + Object.keys(g.lineas).length, 0);
    const idsLinea = Util.reservarIds('VL', 6, nLineas);
    // Clientes: se reutilizan los que ya existen (mismo nombre) y el resto se crea en bloque.
    const clienteDe = {};
    const actuales = Db.all('Clientes');
    const nuevosCli = [];
    est.mapeos.filter((m) => m.tipo === 'cliente' && m.accion === 'cliente').forEach((m) => {
      const nombre = interpretarNombre_(m.destino, 'titulo');
      const ex = actuales.find((c) => Util.normalizar(c.nombre) === Util.normalizar(nombre));
      const nuevo = nuevosCli.find((c) => Util.normalizar(c.nombre) === Util.normalizar(nombre));
      if (ex) clienteDe[m.clave] = ex.id;
      else if (nuevo) nuevo.claves.push(m.clave);   // dos nombres del Excel unidos en un mismo cliente
      else nuevosCli.push({ nombre: nombre, claves: [m.clave] });
    });
    const idsCli = Util.reservarIds('CLI', 4, nuevosCli.length);
    Db.insertMany('Clientes', nuevosCli.map((c, i) => {
      c.claves.forEach((k) => { clienteDe[k] = idsCli[i]; });
      return Object.assign({ id: idsCli[i], nombre: c.nombre, idPokemon: '', telefono: '', instagram: '', notas: 'Creado en la migración', activo: true }, sello);
    }));
    const regVentas = [];
    const regLineas = [];
    let iv = 0;
    listaVentas.forEach((g, i) => {
      const m = g.mapeo;
      const lineas = Object.keys(g.lineas).map((k) => g.lineas[k]);
      const total = lineas.reduce((t, l) => t + l.precio * l.cantidad, 0);
      regVentas.push(Object.assign({
        id: idsVenta[i], fecha: fecha, clienteId: m.accion === 'cliente' ? clienteDe[m.clave] : '',
        canal: m.accion === 'evento' ? 'Evento' : 'Tienda', evento: m.accion === 'evento' ? m.extra : '', medioPago: 'otro',
        boleta: g.boletas.join(', ').slice(0, 40), abono: total, comision: 0, anulada: false,
        notas: 'Migración desde Excel' + (g.oc ? ' · OC original ' + g.oc : '') + (m.accion !== 'cliente' ? ' · ' + m.original : ''),
      }, sello));
      lineas.forEach((l) => regLineas.push(Object.assign({ id: idsLinea[iv++], ventaId: idsVenta[i], loteId: l.loteId, productoId: l.productoId, cantidad: l.cantidad, precioLista: l.precio, precio: l.precio, costo: l.costo }, sello)));
    });
    Db.insertMany('Ventas', regVentas);
    Db.insertMany('Ventas_Lineas', regLineas);
    const listaSal = Object.keys(salidas).map((k) => salidas[k]);
    const idsSal = Util.reservarIds('SAL', 6, listaSal.length);
    Db.insertMany('Salidas', listaSal.map((x, i) => Object.assign({
      id: idsSal[i], fecha: fecha, motivo: x.motivo, loteId: x.lote.id, productoId: x.lote.productoId, cantidad: x.cantidad, costo: x.lote.costo, notas: x.notas, anulada: false,
    }, sello)));

    const resumen = { compras: regCompras.length, lotes: regLotes.length, ventas: regVentas.length, salidas: listaSal.length, unidades: filas.length };
    PropertiesService.getScriptProperties().setProperty('MIGRACION_IMPORTADA', Util.ahora() + ' · ' + user.email);
    Audit.log(user, 'importar', 'Migración', '', resumen);
    return resumen;
  },

  /** Borra la zona de migración (no toca lo ya importado al ERP). */
  limpiar(p, user) {
    Db.vaciar('Migracion');
    Db.vaciar('Migracion_Mapeos');
    Audit.log(user, 'limpiar', 'Migración', '', {});
    return Migracion.estado();
  },

  /** Fecha y usuario del cierre, o '' si la migración sigue abierta. */
  cerrada() {
    return PropertiesService.getScriptProperties().getProperty('MIGRACION_CERRADA') || '';
  },

  /**
   * Cierra la migración: respaldo, se vacía la zona de trabajo del stock y lo pendiente o descartado de
   * la caja (lo migrado de la caja se conserva: es el registro de lo creado, incluidos los pagos de
   * facturas) y Migración sale del menú. Se puede reabrir.
   */
  cerrar(p, user) {
    Respaldos.crear('antes de cerrar la migración', user);
    const caja = Db.all('Migracion_Caja');
    const quedan = caja.filter((f) => f.migrada);
    Db.vaciar('Migracion');
    Db.vaciar('Migracion_Mapeos');
    Db.vaciar('Migracion_Caja');
    if (quedan.length) Db.insertMany('Migracion_Caja', quedan);
    const marca = Util.ahora() + ' · ' + user.email;
    PropertiesService.getScriptProperties().setProperty('MIGRACION_CERRADA', marca);
    Audit.log(user, 'cerrar', 'Migración', '', { cajaConservadas: quedan.length, cajaQuitadas: caja.length - quedan.length });
    return { cerrada: marca, conservadas: quedan.length, quitadas: caja.length - quedan.length };
  },

  reabrir(p, user) {
    PropertiesService.getScriptProperties().deleteProperty('MIGRACION_CERRADA');
    Audit.log(user, 'reabrir', 'Migración', '', {});
    return { cerrada: '' };
  },

  _noImportada() {
    if (PropertiesService.getScriptProperties().getProperty('MIGRACION_IMPORTADA')) {
      throw new AppError('La migración ya se importó. Si necesitas corregir algo, hazlo en el ERP (queda en la auditoría).');
    }
  },
};
