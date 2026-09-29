
Para comparar contra una proforma procesada de referencia (no se suben al repo):
```
node tests/compare-reference.mjs proforma_bruta.xlsx proforma_procesada_ok.xlsx
```

## Objeciones
Al procesar una proforma, la app arma la lista de objeciones y la acumula con las proformas que se procesen después:
- **TL 2da vuelta** (o TL pagado bajo tarifa): va al Template TMS con el valor total que corresponde y al Formato mail.
- **Ruta de CT pagada por parada**: motivo "Revisar Forma de Pago", solo en el Formato mail (ese motivo no existe en el TMS).

Botones: "Descargar Template TMS" (carga en TMS) y "Descargar Formato mail" (para el ejecutivo de Falabella, con la hoja Proforma de respaldo).

## Rutas pendientes
Pestaña "Rutas pendientes": cruza el registro de operaciones (FECHA, CUENTA, ID RUTA) con una o varias proformas y, opcionalmente, con el geosort de Falabella.
- Llave: ID RUTA = ID Viaje de la proforma (o Id Viaje de Viajes de Transferencia). Si no calza, se busca por patente + fecha ("Pagada con otro ID").
- TL sin pago con 2 o más TL de la misma patente ese día: "TL 2da vuelta (esperar objeción)".
- Solo se marca "Pendiente" dentro del periodo que pagan las proformas cargadas (se sugiere solo y se puede ajustar en el panel lateral).
- Filas del registro con ID "-" (bonos y descuentos) no se consideran. Del geosort se descartan las rutas planificadas que no salieron.
- "Descargar cruce Excel" genera Resumen, Rutas y Pagado sin registro.
