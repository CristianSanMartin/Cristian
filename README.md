# Herramientas GS Prime / Cristian

| Proyecto | Carpeta | Descripción |
|---|---|---|
| **GS Prime ERP** | [`erp/`](erp/README.md) | ERP de GS Prime TCG (preventas, inventario, usuarios) sobre Google Sheets + Apps Script |
| Revisión de proformas | `apps-script/` | Revisión de proformas de transporte (Apps Script) |

```bash
npm install
npm test               # todas las pruebas
npm run test:erp       # solo el ERP
npm run erp:preview    # vista previa local del ERP → erp/dist/preview.html
```

## Revisión de proformas

Para comparar contra una proforma procesada de referencia (no se suben al repo):
```
node tests/compare-reference.mjs proforma_bruta.xlsx proforma_procesada_ok.xlsx
```
