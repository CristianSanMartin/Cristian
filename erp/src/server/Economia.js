/**
 * Modelo económico oficial "V4" (ver DISENO.md, sección 3).
 * Todos los costos del proveedor son netos; los precios de venta son brutos (con IVA).
 * Se calcula con decimales; el redondeo al peso se hace al mostrar.
 */
const Economia = {
  /** Comisión de la máquina (TUU) por un pago: redondear(monto × % + fijo) + IVA sobre esa comisión. */
  comisionPago(medio, monto) {
    const r = COMISIONES_PAGO[medio];
    if (!r || !monto) return 0;
    // TUU redondea al par en los medios exactos ($55.000 → 488,5 → 488 + 93 IVA = $581).
    const par = (x) => { const f = Math.floor(x); const d = x - f; return Math.abs(d - 0.5) < 1e-9 ? (f % 2 ? f + 1 : f) : Math.round(x); };
    const c = par(monto * r.pct + r.fijo);
    return c + par(c * (r.iva || 0));
  },

  conIva(neto) {
    return neto * (1 + APP.iva);
  },

  sinIva(bruto) {
    return bruto / (1 + APP.iva);
  },

  /**
   * Resultado por unidad comercial.
   * @param {number} costoNeto  neto del producto + despacho neto prorrateado
   * @param {number} precioBruto precio de venta con IVA
   */
  unidad(costoNeto, precioBruto) {
    const costo = Number(costoNeto) || 0;
    const precio = Number(precioBruto) || 0;
    const credito = costo * APP.iva;
    const valorUnitario = costo + credito;
    const ventaNeta = Economia.sinIva(precio);
    const debito = precio - ventaNeta;
    const ganancia = ventaNeta - costo;
    return {
      costo: costo,
      credito: credito,
      valorUnitario: valorUnitario,
      precio: precio,
      ventaNeta: ventaNeta,
      debito: debito,
      pagoSii: debito - credito,
      ganancia: ganancia,
      recargo: valorUnitario ? (precio - valorUnitario) / valorUnitario : 0,
      margen: ventaNeta ? ganancia / ventaNeta : 0,
    };
  },

  /** Despacho que corresponde a un pedido según la regla del proveedor (gratis desde el umbral). */
  despacho(proveedor, netoPedido) {
    if (!proveedor || !proveedor.despachoMonto) return { monto: 0, faltaParaGratis: 0 };
    if (proveedor.despachoUmbral && netoPedido >= proveedor.despachoUmbral) return { monto: 0, faltaParaGratis: 0 };
    return {
      monto: proveedor.despachoMonto,
      faltaParaGratis: proveedor.despachoUmbral ? proveedor.despachoUmbral - netoPedido : 0,
    };
  },
};
