# GS Prime ERP

ERP de GS Prime TCG sobre **Google Sheets + Apps Script**. La base de datos es una
planilla de Google (una hoja por tabla) y la aplicación es una app web de Apps
Script con login de Google, roles por usuario y registro de auditoría.

Módulos disponibles: **Dashboard**, **Preventas** (con abonos y recepción),
**Inventario** (catálogo, stock valorizado, movimientos y kardex) y
**Administración** (usuarios, auditoría, importación del ERP anterior).
Compras y Ventas quedan como próximos módulos.

## Estructura

```
erp/
├── src/                      ← lo que se sube a Apps Script (rootDir de clasp)
│   ├── appsscript.json       manifiesto: zona horaria, V8, app web
│   ├── server/               backend (JavaScript de Apps Script)
│   │   ├── 00_Config.js      esquema de tablas, roles, catálogos, AppError
│   │   ├── Util.js           fechas, códigos correlativos, validación
│   │   ├── Db.js             acceso a la planilla (filas ⇄ objetos)
│   │   ├── Auth.js           usuario actual, permisos y auditoría
│   │   ├── Productos.js      catálogo
│   │   ├── Preventas.js      preventas, abonos, recepción, cancelación
│   │   ├── Inventario.js     kardex y costo promedio ponderado
│   │   ├── Usuarios.js       usuarios + importación del ERP anterior
│   │   └── Api.js            doGet, api(), instalar(), foto de datos
│   └── client/               frontend (plantillas HtmlService)
│       ├── index.html        estructura de la página
│       ├── styles.html       estilos (identidad negro/dorado)
│       ├── logo.html         logo embebido
│       └── js-*.html         núcleo, dashboard, preventas, inventario, admin
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
- **Nada se guarda dos veces.** El stock sale de sumar los movimientos, y el abonado
  de sumar los pagos. El estado de pago (pendiente, parcial o pagado) se calcula,
  así nunca contradice los montos.
- **Costo promedio ponderado.** Cada entrada recalcula el costo promedio; las salidas
  y ajustes descuentan al costo vigente. La recepción de una preventa ingresa el
  stock a su costo unitario.
- **Validación en el servidor.** Montos enteros en CLP, fechas reales, abonos que no
  superan el saldo, recepción que no supera lo pedido, salidas que no superan el stock.
- **Auditoría.** Cada cambio queda en la hoja `Auditoria`, con quién lo hizo, cuándo
  y qué cambió.

### Tablas (hojas)

| Hoja | Contenido |
|---|---|
| `Usuarios` | correo, nombre, rol (`admin` / `operador` / `lectura`), activo |
| `Productos` | SKU, nombre, categoría, juego, precio de venta, stock mínimo, activo |
| `Preventas` | folio `PV-0001`, producto, proveedor, cantidad, costo, fechas, estado (`pedido` → `transito` → `recibida` / `cancelada`) |
| `Pagos` | abonos a cada preventa: fecha, monto, medio |
| `Movimientos` | kardex: entradas por preventa, entradas/salidas manuales, ajustes |
| `Auditoria` | historial de cambios |

Las columnas se leen por nombre: puedes reordenarlas o agregar columnas propias en
la planilla sin romper nada. **No cambies los nombres de los encabezados.**

### Roles

| Rol | Puede |
|---|---|
| Solo lectura | ver todo (menos usuarios y auditoría) |
| Operador | crear y editar productos y preventas, registrar abonos, recibir, cancelar y registrar movimientos |
| Administrador | todo lo anterior, más eliminar, revertir movimientos o recepciones, gestionar usuarios, ver la auditoría e importar |

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

### 6. Traer los datos del ERP anterior

En **Administración → Importar datos** están los pasos: abre el ERP anterior
(`gsprime-erp.html`) en el mismo navegador donde lo usabas, ejecuta en la consola
`copy(localStorage.getItem('gsprime_erp_preventas_v1'))` y pega el resultado.
Cada producto se crea en el catálogo, los abonos pasan a Pagos y las preventas
"Recibido" ingresan su stock.

## Límites conocidos

- Cada operación tarda de 1 a 3 segundos (es la velocidad normal de Apps Script).
- El sistema lee todas las tablas en cada carga. Eso anda bien hasta unos miles de
  filas por hoja; si el volumen crece mucho, conviene archivar años anteriores o
  migrar a una base de datos.
- La opción "Borrar todos los datos" del ERP anterior se eliminó a propósito: ahora
  se cancela o elimina registro por registro, y cada cambio queda auditado.
