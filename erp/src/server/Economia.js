/**
 * Modelo económico oficial "V4" (ver DISENO.md, sección 3).
 * Todos los costos del proveedor son netos; los precios de venta son brutos (con IVA).
 * Se calcula con decimales; el redondeo al peso se hace al mostrar.
 */
const Economia = {
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
