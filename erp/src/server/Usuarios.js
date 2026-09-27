/** Administración de usuarios y roles (solo administradores). */
const Usuarios = {
  guardar(p, user) {
    const email = Util.email(p.email);
    const actual = Db.get('Usuarios', email);
    const datos = {
      nombre: Util.texto(p.nombre, 'El nombre', { requerido: true, max: 80 }),
      rol: Util.opcion(p.rol, 'El rol', Object.keys(ROLES)),
      activo: p.activo !== false,
    };
    if (actual && actual.rol === 'admin' && (datos.rol !== 'admin' || !datos.activo) && Usuarios._adminsActivos() <= 1) {
      throw new AppError('Debe quedar al menos un administrador activo.');
    }
    if (actual) {
      const nuevo = Db.update('Usuarios', email, datos);
      Audit.log(user, 'editar', 'Usuario', email, Audit.diff(actual, nuevo));
      return nuevo;
    }
    const nuevo = Object.assign({ email: email, creadoEn: Util.ahora(), creadoPor: user.email }, datos);
    Db.insert('Usuarios', nuevo);
    Audit.log(user, 'crear', 'Usuario', email, { rol: nuevo.rol });
    return nuevo;
  },

  _adminsActivos() {
    return Db.all('Usuarios').filter((u) => u.activo && u.rol === 'admin').length;
  },
};
