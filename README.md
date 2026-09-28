
Para comparar contra una proforma procesada de referencia (no se suben al repo):
```
node tests/compare-reference.mjs proforma_bruta.xlsx proforma_procesada_ok.xlsx
```

## Objeciones
Al procesar una proforma, la app arma la lista de objeciones y la acumula con las proformas que se procesen después:
- **TL 2da vuelta** (o TL pagado bajo tarifa): va al Template TMS con el valor total que corresponde y al Formato mail.
- **Ruta de CT pagada por parada**: motivo "Revisar Forma de Pago", solo en el Formato mail (ese motivo no existe en el TMS).

Botones: "Descargar Template TMS" (carga en TMS) y "Descargar Formato mail" (para el ejecutivo de Falabella, con la hoja Proforma de respaldo).
