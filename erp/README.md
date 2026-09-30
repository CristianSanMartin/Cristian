# GS Prime ERP

ERP de GS Prime TCG sobre **Google Sheets + Apps Script**. La base de datos es una
planilla de Google (una hoja por tabla) y la aplicación es una app web de Apps
Script con login de Google, roles por usuario y registro de auditoría.

El diseño funcional completo (flujo, reglas y decisiones) está en **[DISENO.md](DISENO.md)**.

Se construye por etapas:

| Etapa | Contenido | Estado |
|---|---|---|
| 1 | Catálogo de productos y proveedores, preventas por producto con asignación | ✅ |
| 2 | Compras (facturas desde preventas, despacho prorrateado) e inventario por lote | ✅ base (faltan cuotas y reposición) |
| 3 | Ventas con OC, clientes y cuentas por cobrar | ✅ base (faltan ventas por monto) |
| 4 | Finanzas: caja, GAV, aportes, SII, caja de singles, resumen mensual | Pendiente |

## Estructura

```
erp/
├── src/                      ← lo que se sube a Apps Script (rootDir de clasp)
│   ├── appsscript.json       manifiesto: zona horaria, V8, app web
│   ├── server/               backend (JavaScript de Apps Script)
│   │   ├── 00_Config.js      esquema de tablas, roles, catálogos, AppError
│   │   ├── Util.js           fechas, correlativos (hoja Secuencias), validación
│   │   ├── Db.js             acceso a la planilla (filas ⇄ objetos)
│   │   ├── Auth.js           usuario actual, permisos y auditoría
│   │   ├── Economia.js       modelo económico V4 (IVA, pago SII, ganancia) y despacho
│   │   ├── Proveedores.js    proveedores y regla de despacho
│   │   ├── Productos.js      catálogo (nombre + edición + idioma)
│   │   ├── Preventas.js      preventas (un registro por producto solicitado) y asignación
│   │   ├── Compras.js        facturas desde preventas, despacho prorrateado e inventario por lote
│   │   ├── Ventas.js         ventas (OC), salida FIFO por lote, comisión POS y abonos
│   │   ├── Clientes.js       fichas de clientes
│   │   ├── Usuarios.js       usuarios y roles
│   │   └── Api.js            doGet, api(), instalar(), foto de datos
│   └── client/               frontend (plantillas HtmlService)
│       ├── index.html        estructura de la página
│       ├── styles.html       estilos (identidad negro/dorado)
│       ├── logo.html         logo embebido
│       └── js-*.html         núcleo, dashboard, preventas, catálogo, admin
├── dev/                      herramientas locales (no se suben a Google)
│   ├── gas-fake.js           simulador de SpreadsheetApp, Session, etc.
│   ├── sources.mjs           lectura de fuentes y resolución de includes
│   └── build-preview.mjs     genera dist/preview.html
└── tests/                    pruebas del servidor y end-to-end
```

## Cómo está construido

- **Un solo punto de entrada.** El navegador llama únicamente a `api(accion, datos)`.
  Cada acción declara el rol mínimo y si escribe. En Apps Script cualquier función
  global sin `_` final es invocable desde el navegador, por eso toda la lógica vive
  dentro de objetos (`Db`, `Preventas`, ...) y no queda expuesta.
- **Escrituras seguras.** Toda escritura se hace con `LockService`, así dos personas
  guardando a la vez no se pisan, y devuelve los datos actualizados para refrescar
  la pantalla sin otra llamada.
- **Nada se guarda dos veces.** Se guardan los datos de origen (cantidades, costos
  netos, precios) y los resultados (IVA, totales, ganancia, despacho) se calculan.
- **Correlativos estables** (`PVI-000001`, `GS-0001`, `PRV-001`) desde la
  hoja `Secuencias`: un número nunca se reutiliza.
- **Validación en el servidor.** Montos en CLP (costos del proveedor con hasta 2
  decimales), fechas reales, productos únicos por nombre + edición + idioma, y
  líneas que ya pasaron a una compra no se pueden modificar.
- **Auditoría.** Cada cambio queda en la hoja `Auditoria`, con quién lo hizo, cuándo
  y qué cambió.

### Tablas (hojas)

| Hoja | Contenido |
|---|---|
| `Usuarios` | correo, nombre, rol (`admin` / `operador` / `lectura`), activo |
| `Secuencias` | último número usado de cada correlativo |
| `Proveedores` | nombre, RUT, contacto, costo de despacho y monto para despacho gratis |
| `Productos` | SKU `GS-0001`, nombre, edición, idioma, tipo, factor (Booster Box = 36), PVP, precio de venta propio |
| `Preventas` | `PVI-000001`: proveedor, producto, lanzamiento, solicitado, asignado, estado, costo neto |
| `Compras` | `CP-0001`: factura del proveedor (N°, fecha, despacho neto) |
| `Clientes` | `CLI-0001`: nombre, ID Pokémon, teléfono, Instagram |
| `Ventas` | `OC-0001`: fecha, cliente, canal, evento, medio de pago, boleta, abono, comisión |
| `Ventas_Lineas` | `VL-000001`: unidades que salen de un lote, con precio y costo al vender |
| `Cobros` | `COB-000001`: abonos a ventas por cobrar |
| `Compras_Lineas` | `CPI-000001`: producto de la factura = lote del inventario (cantidad, costo neto, despacho prorrateado) |
| `Auditoria` | historial de cambios |

Las columnas se leen por nombre: puedes reordenarlas o agregar columnas propias en
la planilla sin romper nada. **No cambies los nombres de los encabezados.**

### Roles

| Rol | Puede |
|---|---|
| Solo lectura | ver todo (menos usuarios y auditoría) |
| Operador | crear y editar productos, proveedores y preventas, registrar asignaciones, eliminar preventas que no pasaron a compra |
| Administrador | todo lo anterior, más eliminar productos, gestionar usuarios y ver la auditoría |

## Probar en local (sin Google)

```bash
npm install
npm run erp:preview      # genera erp/dist/preview.html → ábrelo en el navegador
npm run test:erp         # pruebas del servidor + end-to-end con Playwright
```

La vista previa ejecuta **el mismo código del servidor** sobre un simulador de
Apps Script, con datos de ejemplo guardados en el navegador. Abajo tiene un
selector para ver la app como Administrador, Operador o Solo lectura.

## Instalar en Google

### 1. Crear la planilla y el proyecto

1. Crea una planilla nueva en Google Drive, por ejemplo **"GS Prime ERP · Base de datos"**.
2. En la planilla: **Extensiones → Apps Script**. Se abre un proyecto vinculado.
3. En Apps Script: **Configuración del proyecto** (engranaje) → copia el **ID de secuencia de comandos** (Script ID).

### 2. Subir el código con clasp (recomendado)

```bash
npm install -g @google/clasp
clasp login                                  # autoriza con tu cuenta de Google
# Activa "Google Apps Script API" en https://script.google.com/home/usersettings
cp erp/.clasp.json.example erp/.clasp.json   # pega el Script ID dentro
cd erp && clasp push
```

`clasp push` reemplaza todos los archivos del proyecto con los de `erp/src/`.
Repite `clasp push` cada vez que actualices el código.

> **Sin clasp:** en el editor de Apps Script crea un archivo por cada archivo de
> `erp/src/` con el mismo nombre y ruta: *Secuencia de comandos* `server/Api`,
> *HTML* `client/index`, etc. Luego pega el contenido y copia `appsscript.json`
> (actívalo en Configuración → "Mostrar el archivo de manifiesto").

### 3. Instalar las hojas

En el editor, selecciona la función **`instalar`** y presiona **Ejecutar**. Acepta
los permisos. Se crean las hojas y **tu correo queda registrado como administrador**.
También puedes hacerlo desde la planilla: menú **GS Prime ERP → Instalar / reparar hojas**.
`instalar` se puede volver a ejecutar sin riesgo: solo agrega lo que falte.

### Imágenes de productos

`instalar` crea en tu Google Drive la carpeta **"GS Prime ERP · Imágenes"** y la comparte
como editor con los usuarios Operador y Administrador (también se comparte sola al agregar
usuarios nuevos). Las fotos que se suben desde Preventas o Productos se reducen a 800 px
en el navegador, se guardan en esa carpeta y quedan visibles con el enlace. Al actualizar a
la versión con imágenes, Google pide **autorizar el acceso a Drive** la primera vez.

### 4. Publicar la app web

**Implementar → Nueva implementación → Aplicación web**:

- *Ejecutar como:* **Usuario que accede a la aplicación web**
- *Quién tiene acceso:* **Cualquier usuario con una cuenta de Google**

Copia la URL `.../exec`: esa es la dirección del ERP. Cuando subas cambios, usa
**Implementar → Administrar implementaciones → Editar → Nueva versión** para
mantener la misma URL.

### 5. Dar acceso a socios o empleados

Cada persona necesita **las dos cosas**:

1. **Acceso de edición a la planilla** (botón Compartir de Google Sheets).
2. **Estar en Administración → Usuarios**, activa y con su rol.

Si falta lo primero, Google le pedirá permiso. Si falta lo segundo, verá
"Acceso restringido".

> **Por qué "usuario que accede".** Con cuentas @gmail.com, Apps Script solo informa
> el correo de quien usa la app si esta se ejecuta como ese usuario. Así cada cambio
> queda firmado con el correo correcto en la auditoría. La contracara es que quien
> tiene acceso de edición a la planilla también podría editarla a mano: comparte la
> planilla solo con personas de confianza. Los roles se aplican en la app.

### 6. Actualizar a una versión nueva

1. Descarga la versión nueva (conserva tu `erp/.clasp.json`) y ejecuta `clasp push` dentro de `erp`.
2. **Obligatorio cuando cambia la estructura de datos:** en el editor de Apps Script ejecuta **`instalar`** (o en la planilla, menú
   **GS Prime ERP → Instalar / actualizar hojas**). Crea las hojas nuevas, agrega columnas
   faltantes y deja las hojas vacías con el encabezado de la versión. Nunca borra datos.
   Si se te olvida, el ERP no guarda nada y muestra "ERP sin instalar" indicando qué columnas faltan.
3. **Implementar → Administrar implementaciones → ✏️ → Nueva versión → Implementar.**

## Respaldos y cambios con datos reales

- **Respaldo nocturno automático:** `instalar` programa un activador que todas las noches (3 a. m.)
  copia la planilla completa en la carpeta **"GS Prime ERP · Respaldos"**, junto a la planilla. Se
  guardan los últimos 30. En **Administración → Respaldos** se ven todos y se puede crear uno a mano.
- **Respaldo antes de cada actualización:** si la planilla ya tiene datos, `instalar` crea una copia
  ("antes de instalar v2.x") antes de tocar nada.
- **Migraciones:** cuando un cambio necesita transformar datos existentes (crear una llave nueva,
  separar un campo, recalcular algo), se escribe como una migración en `server/Respaldos.js`
  (`MIGRACIONES`). `instalar` las ejecuta una sola vez, después de un respaldo, y las registra en la
  hoja `Migraciones`. Nunca se edita ni se quita una migración ya publicada.
- **Reglas que no se rompen:** las columnas se leen por nombre, `instalar` solo agrega (nunca borra
  ni renombra) y los registros se enlazan por ID (`GS-`, `PVI-`, `CP-`, `CPI-`, `OC-`, `CLI-`), no por
  nombre. Renombrar un producto o cliente no rompe nada.
- **Volver atrás:** en Apps Script, *Implementar → Administrar implementaciones* permite volver a la
  versión anterior del código; los datos se recuperan desde el respaldo.

## Límites conocidos

- Cada operación tarda de 1 a 3 segundos (es la velocidad normal de Apps Script).
- El sistema lee todas las tablas en cada carga. Eso anda bien hasta unos miles de
  filas por hoja; si el volumen crece mucho, conviene archivar años anteriores o
  migrar a una base de datos.
