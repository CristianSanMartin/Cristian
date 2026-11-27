/**
 * Toma de inventario (inventario físico).
 *
 * 1. Iniciar: se guarda una foto de lo que debería haber, lote por lote (Tomas_Lineas).
 * 2. Contar: cada unidad esperada se marca como encontrada ("x") o no ("-"); las unidades
 *    de más se anotan por producto (sobrante). El avance se guarda y se puede retomar.
 * 3. Cerrar (administrador): faltantes → salida "Pérdida" de su lote; sobrantes → entran al
 *    inventario como un lote de ajuste (compraId = id de la toma) al último costo conocido.
 *
 * Solo puede haber una toma abierta a la vez.
 */
const Tomas = {
  abierta() {
    return Db.all('Tomas').find((t) => t.estado === 'abierta') || null;
  },

  requerirAbierta(id) {
    const t = Db.get('Tomas', String(id || ''));
    if (!t) throw new AppError('La toma de inventario no existe.', 'NO_ENCONTRADO');
    if (t.estado !== 'abierta') throw new AppError('La toma ' + t.id + ' ya está ' + t.estado + '.');
    return t;
  },

  iniciar(p, user) {
    const actual = Tomas.abierta();
    if (actual) throw new AppError('Ya hay una toma abierta (' + actual.id + '): termínala o anúlala antes de empezar otra.');
    const lotes = Ventas.lotesDisponibles().filter((l) => l.disponible > 0);
    if (!lotes.length) throw new AppError('No hay stock disponible para contar.');
    const sello = Util.sello(user, true);
    const toma = Object.assign({
      id: Util.siguienteId('TOM', 4), fecha: Util.hoy(), estado: 'abierta',
      notas: Util.texto(p.notas, 'Las notas', { max: 300 }), cerradaEn: '', cerradaPor: '', resumen: '',
    }, sello);
    const ids = Util.reservarIds('TML', 6, lotes.length);
    Db.insert('Tomas', toma);
    Db.insertMany('Tomas_Lineas', lotes.map((l, i) => ({
      id: ids[i], tomaId: toma.id, productoId: l.productoId, loteId: l.id, esperado: l.disponible, marcas: '-'.repeat(l.disponible), sobrante: 0,
    })));
    Audit.log(user, 'iniciar', 'Toma', toma.id, { lotes: lotes.length, unidades: lotes.reduce((t, l) => t + l.disponible, 0) });
    return toma;
  },

  /** Guarda el avance: lineas [{ id, marcas }] y sobrantes [{ productoId, cantidad }]. */
  guardar(p, user) {
    const toma = Tomas.requerirAbierta(p.id);
    const lineas = Db.all('Tomas_Lineas').filter((l) => l.tomaId === toma.id);
    const porId = {};
    lineas.forEach((l) => { porId[l.id] = l; });
    const cambios = {};
    (Array.isArray(p.lineas) ? p.lineas : []).forEach((x) => {
      const l = porId[x.id];
      if (!l || !l.loteId) throw new AppError('Una de las líneas no pertenece a la toma ' + toma.id + '.');
      const marcas = String(x.marcas || '');
      if (marcas.length !== l.esperado || /[^x-]/.test(marcas)) throw new AppError('Marcas inválidas para la línea ' + l.id + '.');
      if (marcas !== l.marcas) cambios[l.id] = { marcas: marcas };
    });
    const nuevas = [];
    (Array.isArray(p.sobrantes) ? p.sobrantes : []).forEach((x) => {
      const prod = Productos.requerir(x.productoId);
      const n = Util.entero(x.cantidad, 'Las unidades de más de ' + Productos.nombreCompleto(prod));
      const l = lineas.find((y) => !y.loteId && y.productoId === prod.id);
      if (l) { if (l.sobrante !== n) cambios[l.id] = { sobrante: n }; }
      else if (n > 0) nuevas.push({ tomaId: toma.id, productoId: prod.id, loteId: '', esperado: 0, marcas: '', sobrante: n });
    });
    if (Object.keys(cambios).length) Db.actualizarVarios('Tomas_Lineas', cambios);
    if (nuevas.length) {
      const ids = Util.reservarIds('TML', 6, nuevas.length);
      Db.insertMany('Tomas_Lineas', nuevas.map((x, i) => Object.assign({ id: ids[i] }, x)));
    }
    Db.update('Tomas', toma.id, Util.sello(user));
    return { guardadas: Object.keys(cambios).length + nuevas.length };
  },

  /** Diferencias de la toma: faltantes por lote y sobrantes por producto, valorizados. */
  diferencias(toma) {
    const lineas = Db.all('Tomas_Lineas').filter((l) => l.tomaId === toma.id);
    const lotes = {};
    Ventas.lotesDisponibles().forEach((l) => { lotes[l.id] = l; });
    const ultimo = Tomas.ultimoCosto();
    const faltantes = [];
    const sobrantes = [];
    let esperado = 0;
    let encontrado = 0;
    lineas.forEach((l) => {
      if (l.loteId) {
        const n = (l.marcas.match(/x/g) || []).length;
        esperado += l.esperado;
        encontrado += n;
        if (n < l.esperado) {
          const lote = lotes[l.loteId];
          faltantes.push({ loteId: l.loteId, productoId: l.productoId, cantidad: l.esperado - n, costo: lote ? lote.costo : 0, disponibleHoy: lote ? lote.disponible : 0 });
        }
      } else if (l.sobrante > 0) {
        encontrado += l.sobrante;
        sobrantes.push({ productoId: l.productoId, cantidad: l.sobrante, costo: ultimo[l.productoId] || 0 });
      }
    });
    const valor = (arr) => arr.reduce((t, x) => t + x.cantidad * x.costo, 0);
    return { esperado: esperado, encontrado: encontrado, faltantes: faltantes, sobrantes: sobrantes, valorFaltante: valor(faltantes), valorSobrante: valor(sobrantes) };
  },

  /** Último costo unitario (con despacho) de cada producto: el de su lote más reciente. */
  ultimoCosto() {
    const res = {};
    // Sin lotes: el costo neto de su preventa más reciente.
    Db.all('Preventas').slice().sort((a, b) => String(a.lanzamiento).localeCompare(String(b.lanzamiento))).forEach((pv) => { res[pv.productoId] = pv.costoNeto; });
    Ventas.lotesDisponibles().forEach((l) => { res[l.productoId] = l.costo; });   // vienen del más antiguo al más nuevo
    return res;
  },

  /** Cierra la toma y, si se pide, aplica los ajustes. */
  cerrar(p, user) {
    const toma = Tomas.requerirAbierta(p.id);
    const d = Tomas.diferencias(toma);
    const sello = Util.sello(user, true);
    const hoy = Util.hoy();
    const aplicado = { faltantes: 0, sobrantes: 0, omitidos: 0 };
    if (p.aplicarFaltantes) {
      const salidas = [];
      d.faltantes.forEach((f) => {
        // Si desde que empezó la toma se vendieron unidades de ese lote, solo se ajusta lo que queda.
        const n = Math.min(f.cantidad, Math.max(0, f.disponibleHoy));
        aplicado.omitidos += f.cantidad - n;
        if (n > 0) salidas.push({ fecha: hoy, motivo: 'perdida', loteId: f.loteId, productoId: f.productoId, cantidad: n, costo: f.costo, notas: 'Faltante en toma ' + toma.id, anulada: false });
        aplicado.faltantes += n;
      });
      if (salidas.length) {
        const ids = Util.reservarIds('SAL', 6, salidas.length);
        Db.insertMany('Salidas', salidas.map((x, i) => Object.assign({ id: ids[i] }, x, sello)));
      }
    }
    if (p.aplicarSobrantes && d.sobrantes.length) {
      const ids = Util.reservarIds('CPI', 6, d.sobrantes.length);
      Db.insertMany('Compras_Lineas', d.sobrantes.map((x, i) => Object.assign({
        id: ids[i], compraId: toma.id, preventaId: '', productoId: x.productoId, cantidad: x.cantidad, costoNeto: x.costo, despacho: 0,
      }, sello)));
      aplicado.sobrantes = d.sobrantes.reduce((t, x) => t + x.cantidad, 0);
    }
    const resumen = Object.assign({}, d, { aplicado: aplicado });
    Db.update('Tomas', toma.id, Object.assign({ estado: 'cerrada', cerradaEn: Util.ahora(), cerradaPor: user.email, resumen: JSON.stringify(resumen) }, Util.sello(user)));
    Audit.log(user, 'cerrar', 'Toma', toma.id, { esperado: d.esperado, encontrado: d.encontrado, aplicado: aplicado });
    return resumen;
  },

  anular(p, user) {
    const toma = Tomas.requerirAbierta(p.id);
    Db.update('Tomas', toma.id, Object.assign({ estado: 'anulada', cerradaEn: Util.ahora(), cerradaPor: user.email }, Util.sello(user)));
    Audit.log(user, 'anular', 'Toma', toma.id, {});
  },

  /** Para la pantalla: historial (con su resumen) y la toma abierta con sus líneas y diferencias. */
  vista() {
    const tomas = Db.all('Tomas').map((t) => Object.assign(t, { resumen: t.resumen ? JSON.parse(t.resumen) : null }))
      .sort((a, b) => b.id.localeCompare(a.id));
    const abierta = tomas.find((t) => t.estado === 'abierta');
    if (abierta) {
      abierta.lineas = Db.all('Tomas_Lineas').filter((l) => l.tomaId === abierta.id);
      abierta.diferencias = Tomas.diferencias(abierta);
    }
    return tomas;
  },
};
