/** Utilidades compartidas: fechas, identificadores y validación de entradas. */
const Util = {
  hoy() {
    return Utilities.formatDate(new Date(), APP.tz, 'yyyy-MM-dd');
  },

  ahora() {
    return Utilities.formatDate(new Date(), APP.tz, 'yyyy-MM-dd HH:mm:ss');
  },

  uuid() {
    return Utilities.getUuid();
  },

  /**
   * Siguiente correlativo estable (PV-0001, PVI-000001...). Usa la hoja
   * Secuencias, así un número nunca se reutiliza aunque se elimine el registro.
   * Debe llamarse dentro de una escritura (con LockService tomado).
   */
  siguienteId(prefijo, ancho) {
    const fila = Db.get('Secuencias', prefijo);
    const valor = (fila ? fila.valor : 0) + 1;
    if (fila) Db.update('Secuencias', prefijo, { valor: valor });
    else Db.insert('Secuencias', { clave: prefijo, valor: valor });
    return prefijo + '-' + String(valor).padStart(ancho || 4, '0');
  },

  /** Campos de auditoría para un registro nuevo o actualizado. */
  sello(user, nuevo) {
    const ahora = Util.ahora();
    const s = { actualizadoEn: ahora, actualizadoPor: user.email };
    if (nuevo) { s.creadoEn = ahora; s.creadoPor = user.email; }
    return s;
  },

  texto(valor, campo, opts) {
    opts = opts || {};
    const s = valor == null ? '' : String(valor).trim();
    if (opts.requerido && !s) throw new AppError(campo + ' es obligatorio.');
    const max = opts.max || 500;
    if (s.length > max) throw new AppError(campo + ' no puede superar ' + max + ' caracteres.');
    return s;
  },

  /** Entero (CLP o unidades). Acepta strings numéricos; rechaza decimales y negativos salvo que se indique. */
  entero(valor, campo, opts) {
    opts = opts || {};
    if (valor === '' || valor == null) {
      if (opts.requerido) throw new AppError(campo + ' es obligatorio.');
      return opts.defecto != null ? opts.defecto : 0;
    }
    const n = Number(valor);
    if (!Number.isFinite(n) || !Number.isInteger(n)) throw new AppError(campo + ' debe ser un número entero.');
    const min = opts.min != null ? opts.min : 0;
    if (n < min) throw new AppError(campo + ' debe ser mayor o igual a ' + min + '.');
    if (opts.max != null && n > opts.max) throw new AppError(campo + ' no puede ser mayor a ' + opts.max + '.');
    return n;
  },

  /** Monto con hasta 2 decimales (los costos netos del proveedor pueden traer centavos). */
  monto(valor, campo, opts) {
    opts = opts || {};
    if (valor === '' || valor == null) {
      if (opts.requerido) throw new AppError(campo + ' es obligatorio.');
      return 0;
    }
    const n = Number(String(valor).replace(',', '.'));
    if (!Number.isFinite(n)) throw new AppError(campo + ' debe ser un número.');
    if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) throw new AppError(campo + ' admite como máximo 2 decimales.');
    if (n < 0) throw new AppError(campo + ' debe ser mayor o igual a 0.');
    return Math.round(n * 100) / 100;
  },

  fecha(valor, campo, opts) {
    opts = opts || {};
    const s = valor == null ? '' : String(valor).trim();
    if (!s) {
      if (opts.requerido) throw new AppError(campo + ' es obligatoria.');
      return opts.defecto || '';
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new AppError(campo + ' no tiene un formato de fecha válido.');
    const d = new Date(s + 'T00:00:00Z');
    if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new AppError(campo + ' no es una fecha válida.');
    return s;
  },

  opcion(valor, campo, opciones) {
    const s = valor == null ? '' : String(valor).trim();
    if (opciones.indexOf(s) === -1) throw new AppError(campo + ' no es válido.');
    return s;
  },

  email(valor) {
    const s = Util.texto(valor, 'El correo', { requerido: true, max: 200 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new AppError('El correo no es válido.');
    return s;
  },

  normalizar(s) {
    return String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  },
};
