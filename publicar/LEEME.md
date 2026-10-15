# Publicar la web en un paso (Windows)

`actualizar.cmd` descarga la última versión de la app de proformas desde GitHub, la sube a
tu proyecto de Apps Script y actualiza la aplicación web. **El link no cambia.**

## Primera vez

1. Si no tienes clasp (ya lo instalaste para el ERP, si es así sáltate esto):
   ```
   npm install -g @google/clasp
   ```
   y activa la *Google Apps Script API* en https://script.google.com/home/usersettings
2. Inicia sesión con la cuenta de Google **dueña del Apps Script de proformas**:
   ```
   clasp login
   ```
   Si clasp está con la cuenta del ERP y esta es otra, primero `clasp logout`.
3. Crea una carpeta, por ejemplo `C:\proformas-web`, y guarda ahí estos dos archivos
   (clic derecho → *Guardar enlace como*):
   - [actualizar.cmd](https://raw.githubusercontent.com/CristianSanMartin/Cristian/claude/publicar-web/publicar/actualizar.cmd)
   - [actualizar.ps1](https://raw.githubusercontent.com/CristianSanMartin/Cristian/claude/publicar-web/publicar/actualizar.ps1)
4. Doble clic en `actualizar.cmd`. Te pide el **ID del proyecto** (en Apps Script:
   *Configuración del proyecto* → *ID de secuencia de comandos*; también sirve pegar el link
   del editor). Si tienes varias implementaciones, te pregunta cuál es la web. Ambas cosas
   quedan guardadas.

## Cada vez que haya cambios

Doble clic en `actualizar.cmd`. Nada más.

## Bueno saber

- El proyecto de Apps Script queda igual a la carpeta `apps-script` del repo: un archivo que
  agregues a mano en el editor se borra en la siguiente publicación (por ejemplo `Código.gs`
  queda reemplazado por `Code.gs`).
- Tu `appsscript.json` (zona horaria, permisos, acceso de la web) se copia de tu proyecto la
  primera vez y no se toca después.
- Usa la rama más nueva que exista (la lista está al inicio de `actualizar.ps1`) y, cuando ya
  se hayan integrado, la rama principal. Al final muestra qué versión publicó.
