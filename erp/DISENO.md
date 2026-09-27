# GS Prime ERP — Documento de diseño

Versión 1 · septiembre 2026 · Estado: **para revisión**

Este documento describe **qué** hace el ERP y **por qué**. Sirve para que cualquier
persona (o una conversación futura) entienda el proyecto sin depender del historial.
El cómo técnico está en [README.md](README.md).

---

## 1. Propósito

GS Prime no necesita solo un sistema de stock: necesita **trazabilidad financiera
por producto, factura y cliente**. La pregunta que el ERP debe responder en todo momento es:

> De la factura 30th2 de Asmodee pagué $X. ¿Cuántas unidades quedan, cuántas vendí,
> a quién, cuánto recuperé, cuánto IVA corresponde y cuál es la ganancia real?

Un dato se ingresa **una sola vez** y acompaña al producto durante todo su ciclo:

```
Preventa ──► Asignación ──► Compra (factura) ──► Inventario (lote) ──► Venta ──► Cliente
                                   │                                      │
                                   └──── Resultado económico de la factura ◄┘
```

## 2. Principios

1. **Un dato, un lugar.** Se guardan los datos de origen (cantidades, costos netos, precios).
   Los resultados (IVA, costo con despacho, ganancia, stock) se **calculan**, no se copian.
   *Lección de la beta:* guardar resultados en varias hojas obligó a migraciones y
   "hotfixes" cuando cambió la regla del despacho.
   **Excepción:** la venta guarda su resultado económico al momento de vender
   (registro histórico que no debe cambiar después).
2. **Operaciones puntuales.** Cada acción ("registrar asignación", "recibir compra",
   "vender") modifica solo sus filas. Nunca se reescribe una hoja completa con lo que
   tiene el navegador (evita que un usuario borre sin querer lo que hizo otro).
3. **El estado es una columna.** Un registro no se mueve entre hojas al cambiar de
   etapa; cambia su estado. Revertir = volver al estado anterior.
4. **Validar antes de escribir**, y todo o nada dentro de una operación.
5. **Auditoría:** cada cambio queda registrado con usuario, fecha y detalle.
6. **IDs legibles y estables:** `PV-0001`, `CP-0001`, `OC-0001`, `CLI-0001`, etc.

## 3. Modelo económico (regla oficial "V4")

Todos los montos del proveedor son **netos**. IVA Chile = 19%.

| Concepto | Fórmula (por unidad comercial) |
|---|---|
| Costo | Neto producto + Despacho neto prorrateado |
| Crédito fiscal | Costo × 0,19 |
| Valor unitario | Costo + Crédito fiscal |
| Venta neta | Precio de venta bruto ÷ 1,19 |
| Débito fiscal | Precio bruto − Venta neta |
| Pago SII | Débito fiscal − Crédito fiscal |
| **Ganancia** | Venta neta − Costo |
| Ganancia económica | Ganancia − Costo financiero prorrateado (fuera del IVA) |
| Recargo sobre costo | (Precio bruto − Valor unitario) ÷ Valor unitario *(el "Margen" de la planilla actual)* |
| Margen sobre venta | Ganancia ÷ Venta neta |

Ejemplo real (Mini Tin 30th, factura 30th2): neto $8.230 + despacho $375 = costo $8.605;
venta $18.000 → neto $15.126, débito $2.874, crédito $1.635, pago SII $1.239, **ganancia $6.521**.

Los cálculos internos usan decimales; se muestran redondeados al peso.

## 4. Catálogo de productos

| Campo | Notas |
|---|---|
| SKU | Automático (`GS-0001`) o manual |
| Nombre | Nombre limpio, **sin** idioma (ej. "30th Celebration – Mini Tin") |
| Edición / colección | Ej. "30th Celebration". Permite agrupar y reportar |
| Idioma | ENG / ESP / JPN / Otro — atributo, filtrable |
| Tipo | Booster Box, Elite Trainer Box, Booster Bundle, Battle Deck, Mini Tin, Binder / Colección, Premium Collection, Blister, Sobre, Accesorio, Otro |
| Unidad del proveedor y factor | Cuántas unidades del proveedor forman una unidad comercial. **Booster Box = 36** (el proveedor factura sobres) |
| PVP | Precio sugerido del proveedor (referencia) |
| Precio de venta | El que define GS Prime según mercado. **Sigue al PVP** hasta que se cambie a mano |
| Stock mínimo | Alerta de reposición |
| Imagen | URL de la imagen del producto |
| Activo | Los archivados no aparecen en nuevas operaciones |

Al escribir el nombre tal como viene de Asmodee ("POKEMON TCG 30TH CELEBRATION - MINI TIN ENGLISH"),
el ERP **sugiere** nombre limpio, edición, idioma y tipo.

## 5. Proveedores

Nombre, RUT (opcional), contacto y **regla de despacho**:

| Proveedor | Despacho |
|---|---|
| Asmodee | Gratis si el neto de la compra **supera $1.000.000**; si no, **$15.000 neto** |
| Otros | Monto manual por compra |

## 6. Preventas

Una **preventa** nace del lanzamiento de una nueva edición (ej. *30th Celebration* con Asmodee).

**Encabezado** `PV-0001`: proveedor, edición, fecha de solicitud, notas.

**Líneas** `PVI-000001`, una por producto:

| Campo | Notas |
|---|---|
| Producto | Del catálogo (con idioma) |
| Fecha de lanzamiento | Cada producto puede tener la suya (02-oct, 30-oct, 06-nov…) |
| Solicitado | Lo que se pidió |
| Asignado | Lo que asignó el proveedor (se registra **una vez**) |
| Costo neto unitario | Precio del proveedor |
| PVP / Precio de venta | Tomados del catálogo, editables |

**Calculado en pantalla** (igual que la planilla actual): diferencia, costo con IVA,
total neto y con IVA de lo solicitado y de lo asignado, ganancia real por unidad y total.

**Estados de la línea:** `solicitada → asignada → en compra → recibida`.
Si el proveedor asigna 0, la línea queda `sin asignación`.
Se pueden agregar líneas no solicitadas (solicitado 0, ej. el Binder ESP asignado sin pedirlo).

## 7. Compras

Una **compra** = un pedido/factura a un proveedor. Puede incluir líneas de una o varias
preventas (normalmente, las de una misma fecha de lanzamiento) **y/o reposición**.

**Encabezado** `CP-0001`: proveedor, N° de factura (único por proveedor), fecha,
despacho neto, forma de pago (contado / cuotas), costo financiero total (solo si es en cuotas).

**Líneas** `CPI-000001`: producto, cantidad del proveedor, costo neto unitario,
línea de preventa de origen (si aplica).

**Ciclo:** `armada → pagada → recibida`. El pedido se paga antes del despacho; el stock
entra al inventario al **recibir**. Mientras tanto figura como "entrante".

**Reglas:**
- **Aviso de despacho gratis** al armar: *"Neto $858.910 — faltan $141.090 para despacho gratis"*.
- **Despacho y costo financiero se prorratean por participación en $** de cada línea:
  `despacho línea = despacho × neto línea ÷ neto total de la compra`.
- **Conversión:** cantidad comercial = cantidad del proveedor ÷ factor (72 sobres → 2 Booster Box).
- **Recepción:** normalmente se recibe todo con un botón; existe "ajustar cantidades"
  para casos excepcionales (faltante o dañado).
- Una compra recibida con ventas asociadas no se puede revertir.

**Resultado de la factura** (calculado): unidades compradas / vendidas / disponibles,
venta y ganancia **realizadas**, venta y ganancia **proyectadas** (disponibles × precio de venta),
margen, y estado comercial `recibida → vendiendo → agotada`.

## 8. Inventario

- **Lote** = línea de compra recibida. Guarda cantidad y costo; el stock disponible es
  cantidad − vendidas − salidas.
- **Vista tipo Excel:** el ERP despliega cada lote unidad por unidad (Proveedor, Factura,
  Serie 1…N, Producto, Valor unitario, Costo, Crédito fiscal, Neto, Débito fiscal, Pago SII,
  Ganancia, $ Venta, OC, Cliente) con totales, filtrable y exportable. Las vendidas muestran
  su OC y cliente.
- Al vender, las unidades salen del **lote más antiguo** (FIFO), o del lote que se elija.
- **Salidas que no son venta** (pérdida, uso interno, premio de torneo) con motivo.

## 9. Ventas

**Encabezado** `OC-0001` (**correlativo automático**, sirve para cuadrar con caja):
fecha, cliente, canal, evento, medio de pago, referencia externa (opcional), notas.

- **Cliente:** opcional; por defecto **"Cliente general"**.
- **Canal:** Tienda, Evento, Instagram, WhatsApp, Otro.
- **Evento:** nombre del evento cuando corresponde (ej. "Torneo martes 07-10", "Feria BLVD").
  Reemplaza la práctica actual de escribir "Cliente + evento" en el nombre del cliente,
  y permite reportar **cuánto se vende en cada evento y canal**.

**Líneas:** producto, cantidad, precio bruto unitario (por defecto, el precio de venta),
lote(s) de origen. Cada línea guarda su resultado económico (sección 3) al momento de vender.

Anular una venta (administrador) devuelve el stock a su lote y queda auditado.

## 10. Clientes

`CLI-0001`: nombre, **ID Pokémon (Player ID)**, teléfono, Instagram, notas. Todo opcional
salvo el nombre. "Cliente general" existe siempre.

Ficha con historial de compras, total gastado y última compra: base para un futuro
**programa de fidelización**.

## 11. Usuarios y roles

Hoy: **Administrador** (todo), **Operador** (opera), **Solo lectura**. Pendiente definir
responsabilidades reales: quién compra, quién vende, quién maneja caja, quién administra
inventario y quién puede modificar costos o anular operaciones.

## 12. Tablas (hojas de la planilla)

| Hoja | Contenido |
|---|---|
| Usuarios | Acceso y roles |
| Proveedores | Datos y regla de despacho |
| Productos | Catálogo |
| Preventas / Preventas_Lineas | Encabezado y líneas |
| Compras / Compras_Lineas | Encabezado y líneas (= lotes al recibir) |
| Ventas / Ventas_Lineas | Encabezado y líneas con resultado histórico |
| Movimientos | Salidas que no son venta y ajustes |
| Clientes | Fichas |
| Auditoria | Historial de cambios |
| Secuencias | Correlativos (PV, CP, OC, CLI…) |

## 13. Temas abiertos (para próximas conversaciones)

- **Booster Box abiertas:** ¿se abren cajas para vender sobres sueltos o usarlos como premio?
  (Convertir 1 caja en 36 sobres conservando el costo de la factura.)
- **Cantidades no múltiplo de 36** en Booster Box: ¿bloquear o registrar sobres sueltos?
- **Torneos:** inscripciones como ingreso y premios como costo, para ver si cada torneo deja plata.
- **Caja:** cuadre por evento o por día, medios de pago.
- **Reservas de clientes en preventa:** clientes que apartan producto y abonan.
- **Singles** (cartas sueltas) y accesorios.
- **Resumen mensual de IVA** (débito − crédito) como apoyo al F29.
