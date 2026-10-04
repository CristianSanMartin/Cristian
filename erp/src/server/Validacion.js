/**
 * Validación de datos: revisa toda la información del ERP y lista las inconsistencias
 * para que el administrador las corrija o las marque como revisadas.
 *
 * Cada hallazgo tiene una clave estable (regla|registro) y una firma con los valores que lo
 * provocaron. Al validarlo se guarda en la hoja Validaciones; si después cambian esos valores
 * (otra firma), el hallazgo vuelve a aparecer como pendiente.
 *
 * nivel: error (dato incorrecto) · aviso (revisar) · info (para completar)
 */
const Validacion = {
  AREAS: ['Productos', 'Preventas', 'Compras', 'Inventario', 'Ventas', 'Clientes', 'Finanzas', 'Caja diaria'],

  /** Reglas: id → { area, nivel, titulo, ayuda }. */
  REGLAS: {
    prodSinPrecio: { area: 'Productos', nivel: 'error', titulo: 'Producto con stock y sin precio de venta', ayuda: 'No se puede calcular la ganancia ni vender al precio correcto.' },
    prodBajoCosto: { area: 'Productos', nivel: 'error', titulo: 'Precio de venta bajo el costo', ayuda: 'Venderlo a ese precio deja pérdida.' },
    prodDuplicado: { area: 'Productos', nivel: 'aviso', titulo: 'Posible producto duplicado', ayuda: 'Mismo nombre, edición e idioma. Únelos si son el mismo.' },
    prodSinIdioma: { area: 'Productos', nivel: 'aviso', titulo: 'Producto sin idioma', ayuda: 'Indica si es ENG, ESP o JPN.' },
    prodTipoOtro: { area: 'Productos', nivel: 'info', titulo: 'Producto con tipo "Otro"', ayuda: 'Asigna su tipo para ordenar el catálogo.' },
    prodSinImagen: { area: 'Productos', nivel: 'info', titulo: 'Producto con stock y sin imagen', ayuda: '' },

    pvSinCosto: { area: 'Preventas', nivel: 'aviso', titulo: 'Preventa sin costo', ayuda: 'Sin costo no se puede proyectar la ganancia.' },
    pvAtrasada: { area: 'Preventas', nivel: 'aviso', titulo: 'Preventa asignada sin factura hace más de 30 días', ayuda: 'El lanzamiento ya pasó: ¿llegó la factura o se canceló?' },

    cpLineaSinCosto: { area: 'Compras', nivel: 'error', titulo: 'Producto de factura con precio $0', ayuda: 'El costo del inventario queda en cero.' },
    cpSinDespacho: { area: 'Compras', nivel: 'aviso', titulo: 'Factura bajo el mínimo del proveedor sin despacho', ayuda: '¿Los precios traen el despacho incluido? Corrígelo en Editar factura.' },
    cpFechaFutura: { area: 'Compras', nivel: 'aviso', titulo: 'Factura con fecha futura', ayuda: '' },
    cpSinPago: { area: 'Compras', nivel: 'info', titulo: 'Factura sin pago registrado', ayuda: 'No hay pago conciliado desde la caja diaria.' },

    invNegativo: { area: 'Inventario', nivel: 'error', titulo: 'Lote con más unidades vendidas que compradas', ayuda: 'Corrige la cantidad de la factura o la venta.' },
    invVentaAntes: { area: 'Inventario', nivel: 'aviso', titulo: 'Factura con unidades vendidas antes de su fecha', ayuda: 'Normalmente la fecha de la factura quedó con la de la migración: corrígela en Editar factura.' },

    vtSinLineas: { area: 'Ventas', nivel: 'error', titulo: 'Venta sin productos o con total $0', ayuda: '' },
    vtOcSinProducto: { area: 'Ventas', nivel: 'aviso', titulo: 'OC sin producto del inventario', ayuda: 'Probablemente un sellado vendido que no se rebajó del stock (o quedó como abierto o premio). Cuádralo con la toma de inventario o valídalo con una nota.' },
    vtSinCosto: { area: 'Ventas', nivel: 'error', titulo: 'Producto vendido con costo $0', ayuda: 'La ganancia de esa venta queda inflada.' },
    vtPerdida: { area: 'Ventas', nivel: 'aviso', titulo: 'Producto vendido bajo el costo', ayuda: '' },
    vtDescuentoAlto: { area: 'Ventas', nivel: 'aviso', titulo: 'Descuento mayor al 30%', ayuda: '' },
    vtFechaMigracion: { area: 'Ventas', nivel: 'aviso', titulo: 'Venta con la fecha de la migración', ayuda: 'La fecha real no se encontró en la caja diaria.' },
    vtNumeroOriginal: { area: 'Ventas', nivel: 'aviso', titulo: 'Ventas con un N° o fecha distinto a su OC original', ayuda: 'Corregir abre "Usar los N° y fechas de las OC originales", con la lista completa.' },
    vtSinComision: { area: 'Ventas', nivel: 'aviso', titulo: 'Pago con tarjeta sin comisión', ayuda: '' },
    vtSaldoAntiguo: { area: 'Ventas', nivel: 'aviso', titulo: 'Deuda de cliente con más de 30 días', ayuda: '' },
    vtFechaFutura: { area: 'Ventas', nivel: 'aviso', titulo: 'Venta con fecha futura', ayuda: '' },

    cliDuplicado: { area: 'Clientes', nivel: 'aviso', titulo: 'Posible cliente duplicado', ayuda: 'El mismo nombre con otros espacios, tildes o puntos.' },

    finDuplicado: { area: 'Finanzas', nivel: 'aviso', titulo: 'Movimiento posiblemente duplicado', ayuda: 'Misma fecha, categoría y monto.' },
    finSinCuenta: { area: 'Finanzas', nivel: 'info', titulo: 'Movimiento sin cuenta (caja, banco o TUU)', ayuda: '' },

    cajaPendiente: { area: 'Caja diaria', nivel: 'aviso', titulo: 'Filas de la caja diaria sin migrar', ayuda: 'Revísalas en Migración → Caja diaria.' },
    cajaOcSinVenta: { area: 'Caja diaria', nivel: 'aviso', titulo: 'OC de la caja sin venta en el ERP', ayuda: '' },
    cajaMontoDistinto: { area: 'Caja diaria', nivel: 'aviso', titulo: 'Monto de la caja distinto al de la venta', ayuda: 'Ajusta el total de la venta si el cliente pagó otro monto.' },
  },

  /** Lista los hallazgos con su estado (pendiente / validado). */
  revisar(user) {
    const d = Snapshot.build(user);
    const hoy = d.hoy;
    const hace30 = Validacion._restarDias(hoy, 30);
    const out = [];
    const add = (regla, ref, detalle, firma, accion) => {
      out.push({ clave: regla + '|' + ref, regla: regla, ref: ref, detalle: detalle, firma: String(firma), accion: accion || null });
    };
    const $ = (n) => '$' + Math.round(n).toLocaleString('es-CL');
    const iva = 1 + d.app.iva;

    // ---------- Productos ----------
    const stockPorProd = {};
    const costoPorProd = {};
    d.lotes.forEach((l) => {
      stockPorProd[l.productoId] = (stockPorProd[l.productoId] || 0) + l.disponible;
      if (l.disponible > 0) costoPorProd[l.productoId] = Math.max(costoPorProd[l.productoId] || 0, l.costo);
    });
    const grupos = {};
    d.productos.forEach((p) => {
      const nombre = p.nombreCompleto;
      const stock = stockPorProd[p.id] || 0;
      const editar = { tipo: 'editarProducto', id: p.id };
      if (stock > 0 && !p.precio) add('prodSinPrecio', p.id, nombre + ' · ' + stock + ' en stock', p.precio, editar);
      if (stock > 0 && p.precio && costoPorProd[p.id] && p.precio / iva < costoPorProd[p.id]) {
        add('prodBajoCosto', p.id, nombre + ' · precio ' + $(p.precio) + ' (sin IVA ' + $(p.precio / iva) + ') < costo ' + $(costoPorProd[p.id]), p.precio + '/' + Math.round(costoPorProd[p.id]), editar);
      }
      if (p.activo !== false) {
        if (!p.idioma && p.tipo !== 'Accesorios') add('prodSinIdioma', p.id, nombre, p.idioma, editar);
        if (p.tipo === 'Otro') add('prodTipoOtro', p.id, nombre, p.tipo, editar);
        if (stock > 0 && !p.imagen) add('prodSinImagen', p.id, nombre + ' · ' + stock + ' en stock', p.imagen ? 1 : 0, editar);
        const k = Validacion._clave(p.nombre) + '|' + Validacion._clave(p.edicion) + '|' + (p.idioma || '');
        (grupos[k] = grupos[k] || []).push(p);
      }
    });
    Object.keys(grupos).forEach((k) => {
      const g = grupos[k];
      if (g.length < 2) return;
      g.slice(1).forEach((p) => add('prodDuplicado', p.id, p.nombreCompleto + ' (' + p.id + ') parece igual a ' + g[0].id, g.map((x) => x.id).join(','), { tipo: 'unirProducto', id: p.id }));
    });

    // ---------- Preventas ----------
    const prodNombre = {};
    d.productos.forEach((p) => { prodNombre[p.id] = p.nombreCompleto; });
    d.preventas.forEach((pv) => {
      if (pv.estado === 'recibida' || pv.estado === 'sin_asignacion') return;
      const editar = { tipo: 'editarPreventa', id: pv.id };
      const nombre = prodNombre[pv.productoId] || pv.productoId;
      if (!pv.costoNeto) add('pvSinCosto', pv.id, nombre + ' · ' + pv.id, pv.costoNeto, editar);
      if (pv.estado === 'asignada' && pv.lanzamiento && pv.lanzamiento < hace30) {
        add('pvAtrasada', pv.id, nombre + ' · lanzamiento ' + pv.lanzamiento + ' · ' + pv.asignado + ' asignadas', pv.lanzamiento + '/' + pv.estado, editar);
      }
    });

    // ---------- Compras ----------
    const pagadas = {};
    (d.pagosFacturas || []).forEach((x) => { pagadas[x.compraId || x.id] = true; });
    d.compras.forEach((c) => {
      const ref = c.factura + ' · ' + c.proveedor;
      const editar = { tipo: 'editarCompra', id: c.id };
      c.lineas.forEach((l) => {
        if (!l.costoNeto) add('cpLineaSinCosto', l.id, ref + ' · ' + (l.productoNombre || l.productoId), l.costoNeto, editar);
      });
      const netoProductos = c.lineas.reduce((t, l) => t + l.cantidad * l.costoNeto, 0);
      if (!c.despacho && c.despachoGratisDesde && netoProductos < c.despachoGratisDesde) {
        add('cpSinDespacho', c.id, ref + ' · neto ' + $(netoProductos) + ' bajo el mínimo de ' + $(c.despachoGratisDesde), c.despacho + '/' + Math.round(netoProductos), editar);
      }
      if (c.fecha > hoy) add('cpFechaFutura', c.id, ref + ' · ' + c.fecha, c.fecha, editar);
      if (!pagadas[c.id] && !/pago/i.test(c.notas || '')) add('cpSinPago', c.id, ref + ' · total ' + $(c.total), c.notas || '', { tipo: 'verCompra', id: c.id });
    });

    // ---------- Inventario ----------
    const fechaLote = {};
    const loteDe = {};
    d.lotes.forEach((l) => {
      fechaLote[l.id] = l.fecha;
      loteDe[l.id] = l;
      if (l.disponible < 0) {
        add('invNegativo', l.id, (l.productoNombre || prodNombre[l.productoId]) + ' · factura ' + (l.factura || '') + ' · compradas ' + l.cantidad + ', salieron ' + (l.cantidad - l.disponible), l.cantidad + '/' + l.disponible, { tipo: 'editarCompra', id: l.compraId });
      }
    });

    // ---------- Ventas ----------
    const vivas = d.ventas.filter((v) => !v.anulada);
    const fechasMig = {};
    vivas.forEach((v) => { if (/Migración desde Excel/.test(v.notas || '')) fechasMig[v.fecha] = (fechasMig[v.fecha] || 0) + 1; });
    const fechaMig = Object.keys(fechasMig).sort((a, b) => fechasMig[b] - fechasMig[a])[0];
    const usarFechaMig = fechaMig && fechasMig[fechaMig] >= 5;
    const plan = Ventas._planOriginales();
    if (plan.cambios.length) {
      const n = plan.cambios.filter((c) => c.a !== c.de).length;
      const f = plan.cambios.filter((c) => c.fechaNueva !== c.fecha).length;
      add('vtNumeroOriginal', 'Ventas', [n ? n + ' con otro N° (ej. ' + plan.cambios.find((c) => c.a !== c.de).de + ' → ' + plan.cambios.find((c) => c.a !== c.de).a + ')' : '', f ? f + ' con otra fecha' : ''].filter(Boolean).join(' · '),
        plan.cambios.map((c) => c.de + c.a + c.fechaNueva).join(','), { tipo: 'ocOriginales', id: '' });
    }
    const antes = {};   // compraId → unidades vendidas antes de la fecha de la factura
    vivas.forEach((v) => {
      const editar = { tipo: 'editarVenta', id: v.id };
      const quien = v.id + ' · ' + v.cliente;
      if (!v.lineas.length || !v.total) add('vtSinLineas', v.id, quien + ' · ' + v.fecha, v.lineas.length + '/' + v.total, editar);
      else if (Ventas.esOc(v.id) && v.lineas.every((l) => l.porMonto)) {
        add('vtOcSinProducto', v.id, quien + ' · ' + v.fecha + ' · ' + $(v.total) + ' · ' + v.lineas.map((l) => l.producto).join(', '), v.total + '/' + v.lineas.length, { tipo: 'verVenta', id: v.id });
      }
      v.lineas.forEach((l) => {
        if (l.porMonto) return;
        const nombre = l.productoNombre + (l.idioma ? ' ' + l.idioma : '');
        if (!l.costo) add('vtSinCosto', l.id, quien + ' · ' + nombre, l.costo, { tipo: 'verVenta', id: v.id });
        else if (l.ganancia < 0) add('vtPerdida', l.id, quien + ' · ' + nombre + ' a ' + $(l.precio) + ' (sin IVA ' + $(l.precio / iva) + ', costo ' + $(l.costo) + ')', l.precio + '/' + Math.round(l.costo), { tipo: 'verVenta', id: v.id });
        if (l.precioLista > 0 && (l.precioLista - l.precio) / l.precioLista > 0.3) {
          add('vtDescuentoAlto', l.id, quien + ' · ' + nombre + ' ' + $(l.precioLista) + ' → ' + $(l.precio), l.precioLista + '/' + l.precio, { tipo: 'verVenta', id: v.id });
        }
        if (l.loteId && fechaLote[l.loteId] && v.fecha < fechaLote[l.loteId]) {
          const lote = loteDe[l.loteId];
          const a = antes[lote.compraId] = antes[lote.compraId] || { lote: lote, unidades: 0, primera: v.fecha };
          a.unidades += l.cantidad;
          if (v.fecha < a.primera) a.primera = v.fecha;
        }
      });
      if (usarFechaMig && v.fecha === fechaMig && /Migración desde Excel/.test(v.notas || '')) add('vtFechaMigracion', v.id, quien + ' · ' + v.fecha, v.fecha, editar);
      if ((v.medioPago === 'debito' || v.medioPago === 'credito') && !v.comision) add('vtSinComision', v.id, quien + ' · ' + v.medioPagoLabel + ' · ' + $(v.total), v.comision, editar);
      if (v.saldo > 0 && v.fecha < hace30) add('vtSaldoAntiguo', v.id, quien + ' · debe ' + $(v.saldo) + ' desde ' + v.fecha, v.saldo, { tipo: 'verCliente', id: v.clienteId });
      if (v.fecha > hoy) add('vtFechaFutura', v.id, quien + ' · ' + v.fecha, v.fecha, editar);
    });

    Object.keys(antes).forEach((id) => {
      const a = antes[id];
      add('invVentaAntes', id, (a.lote.factura || id) + ' · ' + (a.lote.proveedor || '') + ' · factura del ' + a.lote.fecha + ', ' + a.unidades + ' unidades vendidas antes (la primera el ' + a.primera + ')',
        a.lote.fecha + '/' + a.primera, a.lote.proveedor === 'Toma de inventario' ? null : { tipo: 'editarCompra', id: id });
    });

    // ---------- Clientes ----------
    const cliGrupos = {};
    d.clientes.forEach((c) => { const k = Validacion._clave(c.nombre); (cliGrupos[k] = cliGrupos[k] || []).push(c); });
    Object.keys(cliGrupos).forEach((k) => {
      const g = cliGrupos[k];
      if (g.length > 1) g.slice(1).forEach((c) => add('cliDuplicado', c.id, c.nombre + ' (' + c.id + ') y ' + g[0].id, g.map((x) => x.id).join(','), { tipo: 'editarCliente', id: c.id }));
    });

    // ---------- Finanzas ----------
    const movGrupos = {};
    (d.movimientos || []).filter((m) => !m.anulado).forEach((m) => {
      const k = m.fecha + '|' + m.tipo + '|' + m.categoria + '|' + m.monto;
      (movGrupos[k] = movGrupos[k] || []).push(m);
      if (!m.cuenta) add('finSinCuenta', m.id, m.id + ' · ' + m.fecha + ' · ' + (m.subcategoria || m.categoria) + ' · ' + $(m.monto), m.cuenta, { tipo: 'editarMovimiento', id: m.id });
    });
    Object.keys(movGrupos).forEach((k) => {
      const g = movGrupos[k];
      if (g.length > 1) g.slice(1).forEach((m) => add('finDuplicado', m.id, m.id + ' igual a ' + g[0].id + ' · ' + m.fecha + ' · ' + $(m.monto), g.map((x) => x.id).join(','), { tipo: 'editarMovimiento', id: m.id }));
    });

    // ---------- Caja diaria ----------
    const caja = Db.all('Migracion_Caja');
    if (caja.length) {
      const pendientes = caja.filter((f) => !f.migrada && !f.descartada);
      if (pendientes.length) add('cajaPendiente', 'caja', pendientes.length + ' filas pendientes de ' + caja.length, pendientes.length, { tipo: 'nav', id: 'migracion' });
      const porOc = MigracionCaja._ventasPorOc();
      const ocs = {};
      caja.filter((f) => f.oc && !f.descartada).forEach((f) => {
        const o = ocs[f.oc] = ocs[f.oc] || { monto: 0, fecha: f.fecha };
        o.monto += f.entradas - f.salidas;
      });
      const totalVenta = {};
      vivas.forEach((v) => { totalVenta[v.id] = v.total; });
      Object.keys(ocs).forEach((oc) => {
        const vs = (porOc[oc] || []).filter((v) => !v.anulada);
        if (!vs.length) { add('cajaOcSinVenta', oc, oc + ' · ' + ocs[oc].fecha + ' · ' + $(ocs[oc].monto), ocs[oc].monto, { tipo: 'nav', id: 'migracion' }); return; }
        const total = vs.reduce((t, v) => t + (totalVenta[v.id] || 0), 0);
        if (Math.abs(total - ocs[oc].monto) > 1) {
          add('cajaMontoDistinto', oc, oc + ' (' + vs.map((v) => v.id).join(', ') + ') · caja ' + $(ocs[oc].monto) + ' · venta ' + $(total), ocs[oc].monto + '/' + total, { tipo: 'editarVenta', id: vs[0].id });
        }
      });
    }

    // Estado de cada hallazgo según lo validado.
    const marcas = {};
    Db.all('Validaciones').forEach((m) => { marcas[m.clave] = m; });
    out.forEach((h) => {
      const r = Validacion.REGLAS[h.regla];
      h.area = r.area; h.nivel = r.nivel; h.titulo = r.titulo; h.ayuda = r.ayuda;
      const m = marcas[h.clave];
      h.estado = m && m.firma === h.firma ? m.estado : 'pendiente';
      if (m && m.firma === h.firma) { h.nota = m.nota; h.validadoPor = m.actualizadoPor; h.validadoEn = m.actualizadoEn; }
    });
    return { hallazgos: out, reglas: Validacion.REGLAS, areas: Validacion.AREAS, revisado: Util.ahora() };
  },

  /** Marca hallazgos como validados (o los reabre). p: { items: [{ clave, firma }], estado: 'validado' | 'pendiente', nota } */
  marcar(p, user) {
    const items = Array.isArray(p.items) ? p.items : [];
    if (!items.length) throw new AppError('Selecciona al menos un hallazgo.');
    const estado = p.estado === 'pendiente' ? 'pendiente' : 'validado';
    const nota = Util.texto(p.nota, 'La nota', { max: 300 });
    const actuales = {};
    Db.all('Validaciones').forEach((m) => { actuales[m.clave] = true; });
    const ahora = Util.ahora();
    const cambios = {};
    const nuevos = [];
    items.forEach((x) => {
      const fila = { clave: String(x.clave), firma: String(x.firma || ''), estado: estado, nota: nota, actualizadoEn: ahora, actualizadoPor: user.email };
      if (actuales[fila.clave]) cambios[fila.clave] = fila; else nuevos.push(fila);
    });
    if (Object.keys(cambios).length) Db.actualizarVarios('Validaciones', cambios);
    if (nuevos.length) Db.insertMany('Validaciones', nuevos);
    Audit.log(user, estado === 'validado' ? 'validar' : 'reabrir', 'Validación', '', { hallazgos: items.length, nota: nota, ejemplos: items.slice(0, 10).map((x) => x.clave).join(', ') });
    return { marcados: items.length };
  },

  /** Para comparar nombres: sin tildes, mayúsculas, espacios ni signos. */
  _clave(t) {
    return Util.normalizar(t).replace(/[^a-z0-9ñ]/g, '');
  },

  _restarDias(iso, n) {
    const d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  },
};
