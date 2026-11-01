/**
 * Imágenes de productos guardadas en una carpeta de Google Drive.
 *
 * instalar() crea la carpeta "GS Prime ERP · Imágenes" y la comparte con los
 * usuarios que operan (la app se ejecuta como cada usuario, así que necesitan
 * poder escribir en ella). Cada imagen se guarda como un archivo visible con el
 * enlace, y en el producto queda como "drive:<id>"; el navegador la muestra con
 * la miniatura de Drive.
 */
const Imagenes = {
  NOMBRE_CARPETA: 'GS Prime ERP · Imágenes',
  TIPOS: { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' },
  MAX_BYTES: 3 * 1024 * 1024,
  MAX_PDF: 5 * 1024 * 1024,

  carpeta() {
    const id = PropertiesService.getScriptProperties().getProperty('CARPETA_IMAGENES');
    if (id) {
      try {
        return DriveApp.getFolderById(id);
      } catch (e) {
        throw new AppError('No tienes acceso a la carpeta de imágenes en Drive. Pide a un administrador que ejecute instalar() o que te agregue como usuario de nuevo.', 'SIN_PERMISO');
      }
    }
    throw new AppError('Falta la carpeta de imágenes en Drive. Un administrador debe ejecutar instalar().', 'NO_INSTALADO');
  },

  /** Crea la carpeta si no existe (desde instalar) y la comparte con quienes operan. */
  preparar() {
    const props = PropertiesService.getScriptProperties();
    let carpeta = null;
    const id = props.getProperty('CARPETA_IMAGENES');
    if (id) {
      try { carpeta = DriveApp.getFolderById(id); } catch (e) { carpeta = null; }
    }
    const creada = !carpeta;
    if (!carpeta) {
      carpeta = DriveApp.createFolder(Imagenes.NOMBRE_CARPETA);
      props.setProperty('CARPETA_IMAGENES', carpeta.getId());
    }
    Db.all('Usuarios').forEach((u) => Imagenes.compartir(u, carpeta));
    return creada;
  },

  compartir(user, carpeta) {
    if (!user.activo || !Auth.puede(user, 'operador')) return;
    try {
      (carpeta || Imagenes.carpeta()).addEditor(user.email);
    } catch (e) {
      console.error('No se pudo compartir la carpeta de imágenes con ' + user.email + ': ' + e);
    }
  },

  /** Valida la imagen que llega del navegador ({ base64, mime }); devuelve null si no viene. */
  validar(img) {
    if (!img || !img.base64) return null;
    const mime = String(img.mime || '');
    if (!Imagenes.TIPOS[mime]) throw new AppError('La imagen debe ser JPG, PNG o WEBP.');
    const base64 = String(img.base64).replace(/^data:[^,]*,/, '');
    if (base64.length * 0.75 > Imagenes.MAX_BYTES) throw new AppError('La imagen es muy pesada (máximo 3 MB).');
    return { base64: base64, mime: mime };
  },

  /** Guarda la imagen en la carpeta y devuelve la referencia para el producto ("drive:<id>"). */
  subir(img, nombre) {
    const blob = Utilities.newBlob(Utilities.base64Decode(img.base64), img.mime,
      String(nombre || 'producto').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 100) + Imagenes.TIPOS[img.mime]);
    const archivo = Imagenes.carpeta().createFile(blob);
    try {
      archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (e) {
      // En cuentas de empresa puede estar prohibido compartir por enlace; los usuarios con acceso a la carpeta la siguen viendo.
      console.error('No se pudo compartir la imagen por enlace: ' + e);
    }
    return 'drive:' + archivo.getId();
  },

  /** Valida un PDF que llega del navegador ({ base64, mime }). */
  validarPdf(arch) {
    if (!arch || !arch.base64) throw new AppError('Elige el archivo PDF.');
    if (String(arch.mime || '') !== 'application/pdf') throw new AppError('El comprobante debe ser un PDF.');
    const base64 = String(arch.base64).replace(/^data:[^,]*,/, '');
    if (base64.length * 0.75 > Imagenes.MAX_PDF) throw new AppError('El PDF es muy pesado (máximo 5 MB).');
    return base64;
  },

  /** Guarda un PDF en la misma carpeta de Drive (solo lo ven quienes tienen acceso a ella) y devuelve "drive:<id>". */
  subirPdf(base64, nombre) {
    const blob = Utilities.newBlob(Utilities.base64Decode(base64), 'application/pdf',
      String(nombre || 'comprobante').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 120) + '.pdf');
    return 'drive:' + Imagenes.carpeta().createFile(blob).getId();
  },

  /** Guarda un archivo de texto (ej. el .tdf de un torneo) en la carpeta y devuelve "drive:<id>". */
  subirTexto(texto, mime, nombre) {
    const blob = Utilities.newBlob(String(texto), mime || 'text/plain', String(nombre || 'archivo').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 140));
    return 'drive:' + Imagenes.carpeta().createFile(blob).getId();
  },

  /** Lee un archivo guardado ("drive:<id>") para mostrarlo en el navegador. */
  leer(ref) {
    const id = String(ref).replace(/^drive:/, '');
    let archivo;
    try {
      archivo = DriveApp.getFileById(id);
    } catch (e) {
      throw new AppError('No se encontró el archivo en Drive (puede que lo hayan borrado o que no tengas acceso).');
    }
    const blob = archivo.getBlob();
    return { nombre: archivo.getName(), mime: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()), url: 'https://drive.google.com/file/d/' + id + '/view' };
  },

  /** Manda a la papelera de Drive un archivo que se reemplazó o quitó (si falla, queda en la carpeta). */
  papelera(ref) {
    try {
      DriveApp.getFileById(String(ref).replace(/^drive:/, '')).setTrashed(true);
    } catch (e) {
      console.error('No se pudo mandar a la papelera ' + ref + ': ' + e);
    }
  },
};
