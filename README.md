
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
- TL sin pago con 2 o más TL de la misma patente ese día: "TL 2da vuelta (esperar objeción)".
- Solo se marca "Pendiente" dentro del periodo que pagan las proformas cargadas (se sugiere solo y se puede ajustar en el panel lateral).
- Filas del registro con ID "-" (bonos y descuentos) no se consideran. Del geosort se descartan las rutas planificadas que no salieron.
- "Descargar cruce Excel" genera Resumen, Rutas y Pagado sin registro.
