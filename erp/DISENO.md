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
6. **IDs legibles y estables:** `PVI-000001`, `CP-0001`, `OC-0001`, `CLI-0001`, etc.

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
| Imagen | Se sube desde Preventas (al crear el producto) o desde Productos. Se guarda en la carpeta de Google Drive "GS Prime ERP · Imágenes" |
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

**La unidad principal es el producto solicitado, no la proforma.** Cada producto que se
pide al proveedor es un registro independiente `PVI-000001`, aunque varios nazcan de la
misma proforma. Así cada producto tiene su propia historia (asignación, compra, stock,
ventas) desde que se solicita hasta que se vende. Registrar la proforma como bloque y
luego descomponerla complicaba la trazabilidad, porque dentro de un mismo registro
convivían productos con asignaciones, costos y destinos distintos.

| Campo | Notas |
|---|---|
| Proveedor | Asmodee u otro |
| Producto | Del catálogo (con edición e idioma) |
| Fecha de lanzamiento | Cada producto tiene la suya |
| Solicitado | Lo que se pidió |
| Asignado ("Nuevo cant.") | Lo que confirmó el proveedor |
| Precio unidad | Costo neto del proveedor (admite centavos) |

- Se trabaja como un **carrito**: se van agregando productos a medida que se conocen;
  no hay que crear un contenedor antes. Proveedor (lista, Asmodee por defecto) y fecha de
  lanzamiento se mantienen para el siguiente producto. La proforma
  no se registra: la agrupación útil es por proveedor y fecha de lanzamiento.
- **El producto se escribe**, tal como viene en la proforma del proveedor o como aparece en
  el catálogo. Si ya existe se usa; si no, se crea solo con edición, idioma, tipo y factor
  interpretados del nombre. La pantalla muestra antes de agregar qué producto se usará. El
  precio sugerido ingresado actualiza el PVP del catálogo.
- Sin importar cómo se escriba, nombres y ediciones se guardan **en formato título**
  ("binder COLLECTION" → "Binder Collection"; siglas como TCG o ETB quedan en mayúsculas).
- **Idioma detectado del nombre:** ENG, ENGLISH o ING = inglés; ESP, ESPAÑOL o SPANISH =
  español. Se marca con color en toda la aplicación: **azul inglés, verde español**.
- El **mismo producto puede pedirse más de una vez** (ej. una reposición posterior):
  cada solicitud es su propio registro y se gestiona con su propia factura.
- **Solicitado, asignado e inventario son cantidades distintas.** Solicitado 60, asignado 6:
  las 6 siguen a Compra; las 54 no asignadas quedan como historial.
- La pantalla muestra las mismas columnas que la planilla (cant., nuevo cant., dif., precio
  unidad, precio + IVA, totales solicitados y asignados, precio sugerido, precio de venta,
  margen) más la **ganancia real neta**.
- Columnas: estado, imagen, producto, proveedor, **lanzamiento** y luego las cantidades y
  montos. Cada título tiene una flecha para **ordenar y filtrar** como en Excel; por defecto
  el estado muestra solo solicitadas y asignadas (lo que falta comprar).
- Sobre la tabla, **"Pedidos por lanzamiento"**: un pedido por proveedor y fecha con el aviso
  de despacho: *"Pedido $858.910 neto · Despacho $15.000 · faltan $141.090 para despacho gratis"*.
- **Precio de venta** editable en la misma tabla (es del producto: cambia en todas sus filas).
  Si no se edita, se acepta el **precio sugerido** (se ve en gris); vaciarlo vuelve al sugerido.
- **Asignación:** se escribe el "Nuevo cant." directo en la tabla y se guarda en bloque, o
  se seleccionan filas para marcar "asignado = solicitado" o "sin asignación". Vaciar la
  cantidad vuelve la fila a "solicitada".

**Estados:** `solicitada → asignada (o sin asignación) → en compra → recibida`.
Una preventa en compra o recibida ya no se modifica.

## 7. Compras

Una **compra** = un pedido/factura a un proveedor. Puede incluir líneas de una o varias
preventas (normalmente, las de una misma fecha de lanzamiento) **y/o reposición**.

**Encabezado** `CP-0001`: proveedor, N° de factura (único por proveedor), fecha,
despacho neto, forma de pago (contado / cuotas), costo financiero total (solo si es en cuotas).

**Líneas** `CPI-000001`: producto, cantidad del proveedor, costo neto unitario,
preventa de origen `PVI` (si aplica).

Se crea como **"pagar el carrito"**: se marcan las preventas asignadas que vienen en la
factura (de una o varias fechas de lanzamiento) y se completa el encabezado.

**Implementado (v2.3):** en Preventas se seleccionan las preventas asignadas y se presiona
"Crear factura de compra": se ingresa el N° de factura real, la fecha y (si difiere de la regla)
el despacho. Al registrarla, la factura queda en **Compras** con sus productos, el despacho como
ítem y los totales (neto, IVA, total) para conciliar con la factura física; las preventas pasan a
"En inventario" y cada línea entra al **Inventario** como un lote con su costo real. Un
administrador puede anular una factura mal ingresada (sus preventas vuelven a "Asignada").
Pendiente: pago en cuotas y costo financiero, compras de reposición sin preventa, recepción parcial.

**Ciclo previsto:** `armada → pagada → recibida`. El pedido se paga antes del despacho; el stock
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

**Implementado (v2.4):** Inventario es un **pool por producto**: todo su stock junto, venga de la
factura o proveedor que venga (sin columnas de factura ni fecha): comprado, vendidas, disponible,
costo (precio + despacho; promedio si llegó en varias compras), precio de venta y ganancia. La
flecha **despliega sus unidades una por una** (estado, OC, cliente, valor unitario, costo, crédito,
venta, neto, débito, pago SII, ganancia), como la planilla. Por dentro cada unidad sigue ligada a
su lote (factura), así Compras conserva el resultado de cada factura. Desde la lista se
marca y se presiona **"Vender"** para llevar los productos al carrito de una venta; el lápiz edita
la ficha (nombre, foto, precio). Los lotes agotados se ocultan salvo "Mostrar agotados".
**No hay pestaña de catálogo:** las ediciones se renuevan cada ~3 meses; la ficha de cada
producto se crea sola al escribirlo en Preventas y solo enlaza preventa, factura, stock y venta.

- **Lote** = línea de compra recibida. Guarda cantidad y costo; el stock disponible es
  cantidad − vendidas − salidas.
- **Vista tipo Excel:** el ERP despliega cada lote unidad por unidad (Proveedor, Factura,
  Serie 1…N, Producto, Valor unitario, Costo, Crédito fiscal, Neto, Débito fiscal, Pago SII,
  Ganancia, $ Venta, OC, Cliente) con totales, filtrable y exportable. Las vendidas muestran
  su OC y cliente.
- Al vender, las unidades salen del **lote más antiguo** (FIFO), o del lote que se elija.
- **Salidas que no son venta** (pérdida, uso interno, premio de torneo) con motivo.
- **Sobres con stock controlado.** Se pueden comprar sueltos o **abrir una Booster Box**:
  la caja sale del inventario y entran 36 sobres, cada uno con costo = costo de la caja ÷ 36,
  manteniendo la factura de origen. Los sobres usados como premio salen como costo del torneo.

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

- **Medio de pago:** efectivo, transferencia, tarjeta (débito/crédito), otro.
- **Pago pendiente (cuenta por cobrar):** una venta puede quedar total o parcialmente
  impaga, con el cliente como deudor. Se registran abonos hasta saldarla. Reemplaza las
  filas "01-dic" de la planilla: lo impago no entra a caja ni a los gráficos hasta que se cobra.
- **Ventas por monto (sin stock):** singles y otros ingresos sin control unitario
  se registran por categoría y monto (ej. "Singles $38.000").

Anular una venta (administrador) devuelve el stock a su lote y queda auditado.

**Dónde se vende (v2.4):** en **Inventario**. En la fila de cada producto se escribe la cantidad y
"+ Venta" (sale de la compra más antigua), o se despliega y se marcan unidades (salen de ese lote).
Arriba se abre el panel **"Venta en curso"** con el carrito y los datos de la venta; al registrarla
se queda en Inventario. Una venta con saldo por cobrar exige un cliente.

**Ventas es un tablero informativo:** vendido del mes con avance contra la **meta = ventas del mes
anterior**, ganancia real, ticket promedio, **proyección de cierre** al ritmo actual; gráfico
**ventas vs compras** de 12 meses (un solo eje, con la tabla mensual Ventas / Compras / Ganancia /
Ventas − compras como en la planilla), ventas por día, por canal y evento, por medio de pago,
productos más vendidos, proyección del stock y **ranking de clientes** del mes y acumulado. Abajo,
la lista de OC del mes (consulta; el administrador puede anular).

**Cobranza en Clientes:** al desplegar un cliente se ven sus deudas con "Registrar abono" y un
botón **WhatsApp** (abre el chat con el mensaje del saldo listo para enviar, si tiene teléfono).
Envío automático por WhatsApp: pendiente (requiere WhatsApp Business API).

**Detalle (v2.4):** formulario "Nueva venta" tipo carrito (canal **Tienda** por
defecto, medio de pago, N° de boleta, cliente escrito o "Cliente general"). El precio se completa
con el precio de venta y se puede rebajar **por producto** (el precio es el mismo en todos los
canales). Las unidades salen del lote más antiguo (FIFO), repartiéndose en varios lotes si hace
falta. **Comisión TUU** (débito y crédito, abono a 2 días): 0,77% + $65 por venta, sobre lo
pagado con la máquina; se descuenta de la ganancia real. Venta pagada completa o con abono
(el resto queda **por cobrar** y se salda con abonos). Cada factura de compra acumula lo vendido
de sus lotes; el inventario unidad por unidad muestra la OC y el cliente de cada unidad vendida.
Pendiente: ventas por monto (singles), abrir Booster Box en sobres, comisión a GAV (Finanzas).

## 10. Clientes

`CLI-0001`: nombre, **ID Pokémon (Player ID)**, teléfono, Instagram, notas. Todo opcional
salvo el nombre. "Cliente general" existe siempre.

Ficha con historial de compras, total gastado y última compra: base para un futuro
**programa de fidelización**.

## 11. Finanzas

**Caja (libro de ingresos y egresos).** Las ventas cobradas, compras pagadas, gastos,
aportes y pagos al SII generan su movimiento de caja **automáticamente**, con su
referencia (OC, factura). No se digita dos veces.

| Concepto | Detalle |
|---|---|
| Cuentas por cobrar | Ventas impagas por deudor, con antigüedad y abonos |
| Gastos (GAV) | Categorías: publicidad, insumos, transporte, premios, arriendo de stand/ferias, comisiones de medios de pago, otros |
| Comisiones de tarjeta | Se calculan solas por venta según el % configurado para cada medio de pago y van a GAV. Cada venta muestra su **ganancia después de comisión** |
| Patrimonio | Aportes de socios (García / San Martín), por socio. Sin retiros por ahora |
| SII | Pago mensual F29 y cualquier otro pago al SII |

**Caja de singles:** fondo separado para singles. Registra compras y ventas de singles
y muestra saldo, rentabilidad y un **tope de compra** configurable (alerta si se compra
más de lo que se vende o se supera el tope), para evitar sobre-stock.

**Resumen mensual** equivalente a la planilla actual: Ventas, Compras, Patrimonio, GAV,
SII y Total (flujo de caja), con gráfico de ventas vs. compras. Además, la mirada de
**resultado real**: flujo de caja + variación del inventario valorizado a costo
(comprar stock baja la caja pero no es pérdida).

## 12. Usuarios y roles

Hoy: **Administrador** (todo), **Operador** (opera), **Solo lectura**. Pendiente definir
responsabilidades reales: quién compra, quién vende, quién maneja caja, quién administra
inventario y quién puede modificar costos o anular operaciones.

## 13. Tablas (hojas de la planilla)

| Hoja | Contenido |
|---|---|
| Usuarios | Acceso y roles |
| Proveedores | Datos y regla de despacho |
| Productos | Catálogo |
| Preventas | Un registro por producto solicitado (`PVI`) |
| Compras / Compras_Lineas | Encabezado y líneas (= lotes al recibir) |
| Ventas / Ventas_Lineas | Encabezado y líneas con resultado histórico |
| Movimientos | Salidas que no son venta y ajustes |
| Clientes | Fichas |
| Cobros | Abonos a ventas pendientes |
| Caja | Movimientos de dinero (automáticos y manuales) |
| Gastos | GAV por categoría |
| Aportes | Aportes de socios |
| Configuracion | Comisiones por medio de pago, tope de singles, reglas |
| Auditoria | Historial de cambios |
| Secuencias | Correlativos (PV, CP, OC, CLI…) |

## 14. Temas abiertos (para próximas conversaciones)

- **Cantidades no múltiplo de 36** en Booster Box: ¿bloquear o registrar sobres sueltos?
- **Torneos:** inscripciones como ingreso y premios como costo, para ver si cada torneo deja plata.
- **Cuadre de caja** por evento o por día.
- **Reservas de clientes en preventa:** clientes que apartan producto y abonan.
- **Inventario de singles** carta por carta (por ahora se venden por monto) y accesorios.
- **Resumen mensual de IVA** (débito − crédito) como apoyo al F29.
