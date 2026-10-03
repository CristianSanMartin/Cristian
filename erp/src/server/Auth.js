/**
 * Identidad y permisos. La app se publica como "Ejecutar como: usuario que
 * accede", así que Session.getActiveUser() entrega el correo real de quien la
 * usa. Solo los correos activos en la hoja Usuarios pueden entrar.
 */
const Auth = {
  email() {
    return String(Session.getActiveUser().getEmail() || '').toLowerCase().trim();
  },

  current() {
    const email = Auth.email();
    if (!email) {
      throw new AppError('No se pudo identificar tu cuenta de Google. Inicia sesión e intenta de nuevo.', 'NO_AUTORIZADO');
    }
    const user = Db.get('Usuarios', email);
    if (!user || !user.activo) {
      throw new AppError('Tu cuenta (' + email + ') no tiene acceso al ERP. Pide a un administrador que te agregue.', 'NO_AUTORIZADO');
    }
    if (!ROLES[user.rol]) throw new AppError('Tu cuenta tiene un rol inválido (' + user.rol + ').', 'NO_AUTORIZADO');
    return user;
  },

  puede(user, rol) {
    return (ROLES[user.rol] || 0) >= ROLES[rol];
  },

  require(user, rol) {
    if (!Auth.puede(user, rol)) {
      throw new AppError('No tienes permisos para esta acción (requiere rol ' + rol + ').', 'SIN_PERMISO');
    }
  },
};

/** Registro de auditoría: quién hizo qué y cuándo. Se escribe en la hoja Auditoria. */
const Audit = {
  log(user, accion, entidad, entidadId, detalle) {
    let json = detalle == null ? '' : JSON.stringify(detalle);
    if (json.length > 4000) json = json.slice(0, 3997) + '...';
    Db.insert('Auditoria', {
      fecha: Util.ahora(),
      usuario: user ? user.email : '',
      accion: accion,
      entidad: entidad,
      entidadId: entidadId || '',
      detalle: json,
    });
  },

  /** Diferencias entre dos versiones de un registro, para no guardar campos sin cambios. */
  diff(antes, despues) {
    const cambios = {};
    Object.keys(despues).forEach((k) => {
      if (/^(actualizado|creado)/.test(k)) return;
      if (String(antes[k]) !== String(despues[k])) cambios[k] = [antes[k], despues[k]];
    });
    return cambios;
  },
};
