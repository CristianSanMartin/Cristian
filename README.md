
Para comparar contra una proforma procesada de referencia (no se suben al repo):
```
node tests/compare-reference.mjs proforma_bruta.xlsx proforma_procesada_ok.xlsx
```

## Objeciones
Al procesar una proforma, la app arma la lista de objeciones y la acumula con las proformas que se procesen después:
- **TL 2da vuelta** (o TL pagado bajo tarifa): va al Template TMS con el valor total que corresponde y al Formato mail.
- **Ruta de CT pagada por parada**: motivo "Revisar Forma de Pago", solo en el Formato mail (ese motivo no existe en el TMS).

Botones: "Descargar Template TMS" (carga en TMS) y "Descargar Formato mail" (para el ejecutivo de Falabella, con la hoja Proforma de respaldo).

## Control de rutas (Google Sheets)
Pestaña "Control de rutas". Cada botón de carga guarda la información en su hoja del Google Sheet y la app arma el control desde ahí, así que los datos quedan disponibles la próxima vez que se abra.

| Botón | Hojas | Al volver a cargar |
|---|---|---|
| Proforma facturada (una o varias, en bruto o procesadas) | SERVICE, TL, DELIVERY, SHIPMENT (Viajes de Transferencia), con columnas x/y y Valor solo en x=1; más VIAJES PAGADOS (un viaje por fila) | Reemplaza las filas de esa proforma |
| Geosort (CSV o Excel) | GEOSORT, una fila por ruta (Idruta, fecha, patente, CT, puntos, terminados) | Reemplaza las rutas que trae el archivo |
| Registro de operaciones | REGISTRO, tal cual viene | Reemplaza los días que trae el archivo |

La app escribe la hoja CONTROL RUTAS con una fila por ruta: FECHA, PATENTE, ID RUTA, TERMINADO, TOTAL, NS, TOTAL RUTA, COBRO, VALIDADOR, INGRESO, DIF. COBRO, PROFORMA, FACTURA y ESTADO.
- **INGRESO**: lo que pagó Falabella por la ruta (si una solicitud de pago cubre varios viajes, se reparte entre ellos; si el viaje viene en varias proformas, se suma).
- **COBRO**: columna INGRESO del registro de operaciones (lo que se espera cobrar). **VALIDADOR** = COBRO − TOTAL RUTA y **DIF. COBRO** = INGRESO − COBRO.
- En pantalla, "Rutas por día" resume cada día (rutas, pagadas, por revisar, pendientes, ingreso y diferencia); al hacer clic en un día se ve el registro de ese día.

### Instalación
1. Crear un Google Sheet nuevo y abrir Extensiones > Apps Script.
2. Copiar `apps-script/Code.gs` y crear un archivo HTML llamado `index` con el contenido de `apps-script/index.html`.
3. Implementar > Nueva implementación > Aplicación web (ejecutar como: yo; acceso: solo yo o la organización).

Si el script no está ligado a una planilla, usa la propiedad del script `SPREADSHEET_ID` y, si no existe, crea la planilla "Control proformas Falabella". Fuera de Apps Script (vista previa o pruebas) los datos se guardan solo mientras la página está abierta.

## Reglas del cruce de rutas
Cruza el registro de operaciones (FECHA, CUENTA, ID RUTA) con las proformas guardadas y, opcionalmente, con el geosort de Falabella.
- Llave: ID RUTA = ID Viaje de la proforma (o Id Viaje de Viajes de Transferencia). Si no calza, se busca por patente + fecha ("Pagada con otro ID").
- Rutas hermanas: la columna Viajes de "Resumen Sol Pago" dice qué viajes comparten una Sol. Pago. Un viaje cuya hermana es de otro día no se usa como "Pagada con otro ID" (suele ser la 2da vuelta de la noche anterior).
- TL sin pago con 2 o más TL de la misma patente ese día: "TL 2da vuelta (esperar objeción)".
- Solo se marca "Pendiente" dentro del periodo que pagan las proformas cargadas (se sugiere solo y se puede ajustar en el panel lateral).
- Filas del registro con ID "-" (bonos y descuentos) no se consideran. Del geosort se descartan las rutas planificadas que no salieron.
- "Descargar cruce Excel" genera Resumen, Rutas y Pagado sin registro.

## Perú (Sodimac)
Sección "Cobro Sodimac" (grupo Perú del panel lateral): arma la liquidación de cobro a Sodimac Perú - Lurin desde el reporte de visitas de SIMPLI, con la misma lógica que el script `peru_v2.py` de control de gestión.

| Botón | Qué hace |
|---|---|
| Reporte de visitas SIMPLI (uno o varios, 15 días cada uno) | Calcula una ruta por placa y fecha y la guarda en la hoja PERU RUTAS. Los días repetidos entre archivos se cuentan una vez; volver a cargar reemplaza los días del archivo. |

"Descargar liquidación" genera el Excel con el mismo formato que se envía (FECHA, RAZÓN SOCIAL, PLACA, TIPO UNIDAD, PUNTOS, DISTRITOS, ZONA, TARIFA REGULAR, ADICIONAL, DETALLE ADICIONAL, VALOR TOTAL).

Reglas (montos en soles sin IGV):
- Tarifa por día según la sección **Tarifas**. Domingo o feriado: tarifa de domingo, que en el cobro va como adicional "Tarifa Domingo" o "Tarifa Feriado".
- 10 y 13 m³ se cobran como F13; 15 y 20 (m³ o TN) como F20.
- Distrito: el último tramo de la dirección después de la coma, para no confundir calles como "JR SANTA ROSA, COMAS" con el distrito Santa Rosa.
- Zona: la del punto más lejano efectivamente entregado. Las visitas fallidas no definen la zona; si una visita fallida estaba en periferia, la ruta lo indica en Observación.
- La sección también muestra el pago al transportista y el margen por ruta y del mes.

### Pago transporte
Sección "Pago transporte" del grupo Perú: el pago a CT ATLANTIS SODIMAC por quincena (1 al 15 y 16 a fin de mes), con las mismas rutas del cobro.

- Muestra cada ruta con su tarifa de pago (neto y con IGV 18%) y marca las rutas con puntos fallidos.
- **Ajustes** (hoja PERU AJUSTES): cuando una ruta se cobró o pagó con otra zona, se registra la zona real y el motivo. Cobro, pago y liquidación usan la zona ajustada y se guarda lo calculado para el cuadre.
- **Descuentos y otros pagos** (hoja PERU MOVIMIENTOS): los descuentos (con IGV) se restan del total a facturar; los otros pagos (netos) no van en la factura del transporte. El personal de seguimiento se carga solo con el costo fijo por quincena de Tarifas (hoja PERU COSTOS FIJOS, S/ 847,46 neto, S/ 1.000 con IGV).
- **Conductores** (hoja PERU CONDUCTORES) y **estado de la quincena** (hoja PERU QUINCENAS: Borrador, Enviado al transporte, Validado, Pagado).
- "Descargar detalle quincena" genera el Excel con el formato que se envía al transporte (Fecha, CtOrigen, Motivo, Patente, Distrito, Capacidad, PUNTOS, Tipo, Usuario, NoDocumentoUsuario, Tarifario, Neto, IGVInc) y la sección arma el texto del correo.

### Cuadre y KPI
Sección "Cuadre y KPI" del grupo Perú, por mes (hoja PERU FACTURAS para las facturas):
- **Cuadre del cobro:** calculado por la web, ajustes con su motivo, liquidado, factura a Sodimac (sin IGV) y diferencia sin explicar. La fecha de pago de Sodimac alimenta el "Pendiente de cobro".
- **Cuadre del pago:** por quincena, calculado, ajustes, total a facturar por el transporte (con IGV y descuentos) contra su factura.
- **Margen real** (neto): cobrado (factura o liquidado) menos pago al transporte, más descuentos recuperados sin IGV, menos otros pagos.
- **KPI:** rutas y rutas por placa, % periferia, % domingo o feriado, puntos por ruta, % entrega efectiva, ingreso, costo y margen por ruta, margen % y días del cierre de quincena al pago; tendencia de los últimos 6 meses.

### Pesos chilenos
Los resúmenes y KPI de Perú (Cobro Sodimac, Pago transporte y Cuadre y KPI) muestran también el monto en pesos chilenos. La data gestionada, las tablas por ruta y los Excel siguen en soles.
- El tipo de cambio diario sol a peso se guarda en la hoja PERU TIPO CAMBIO. Al abrir la web, `tipoCambioPeru` (Code.gs) completa los días que faltan con `GOOGLEFINANCE("CURRENCY:PENCLP")`, sin permisos nuevos.
- Todos los montos, de cualquier mes o quincena, se convierten al tipo de cambio del día en que se revisa (el último disponible en la hoja).

### Tarifas
Sección "Tarifas" del grupo Perú. Se guarda en tres hojas del Google Sheet, que la app crea con los valores iniciales la primera vez que se abre:

| Hoja | Contenido |
|---|---|
| PERU TARIFAS | TARIFARIO, TIPO (COBRO o PAGO), VIGENTE DESDE, UNIDAD, ZONA, REGULAR, DOMINGO |
| PERU DISTRITOS | DISTRITO, ZONA (Metropolitana o Periferia) |
| PERU FERIADOS | FECHA, NOMBRE (feriados nacionales 2025 y 2026) |

- Cada tarifario (cobro a Sodimac y pago al transportista) tiene vigencias. Cada ruta usa la vigencia más reciente con fecha igual o anterior a la ruta, así un cambio de tarifa no recalcula los meses ya liquidados. "Nueva vigencia" copia la tarifa actual para editarla y pide desde qué fecha rige.
- Valores iniciales, vigentes desde el 01-01-2025 (regular / domingo o feriado):

| Unidad | Zona | Cobro | Pago |
|---|---|---|---|
| F13 | Metropolitana | 420 / 546 | 380 / 494 |
| F13 | Periferia | 610 / 793 | 500 / 650 |
| F20 | Metropolitana | 460 / 598 | 410 / 533 |
| F20 | Periferia | 640 / 832 | 540 / 702 |

- Tarifas y feriados se aplican de inmediato a las rutas ya cargadas. Un cambio de distrito se aplica al volver a cargar los reportes SIMPLI de esas fechas, porque la zona de cada ruta se define al cargarla.

Para publicar la web en tu Apps Script con doble clic: ver [publicar/LEEME.md](publicar/LEEME.md).
