/** Proveedores y su regla de despacho. */
const Proveedores = {
  guardar(p, user) {
    const id = p.id ? String(p.id) : '';
    const actual = id ? Proveedores.requerir(id) : null;
    const datos = {
      nombre: Util.texto(p.nombre, 'El nombre', { requerido: true, max: 120 }),
      rut: Util.texto(p.rut, 'El RUT', { max: 20 }),
      contacto: Util.texto(p.contacto, 'El contacto', { max: 200 }),
      despachoUmbral: Util.entero(p.despachoUmbral, 'El monto para despacho gratis'),
      despachoMonto: Util.entero(p.despachoMonto, 'El costo de despacho'),
      notas: Util.texto(p.notas, 'Las notas', { max: 1000 }),
    };
    const norm = Util.normalizar(datos.nombre);
    if (Db.all('Proveedores').some((x) => x.id !== id && Util.normalizar(x.nombre) === norm)) {
      throw new AppError('Ya existe un proveedor llamado "' + datos.nombre + '".');
    }
    if (actual) {
      const nuevo = Db.update('Proveedores', id, Object.assign(datos, Util.sello(user)));
      Audit.log(user, 'editar', 'Proveedor', id, Audit.diff(actual, nuevo));
      return nuevo;
    }
    const nuevo = Object.assign({ id: Util.siguienteId('PRV', 3), activo: true }, datos, Util.sello(user, true));
    Db.insert('Proveedores', nuevo);
    Audit.log(user, 'crear', 'Proveedor', nuevo.id, { nombre: nuevo.nombre });
    return nuevo;
  },

  cambiarActivo(p, user) {
    const prov = Proveedores.requerir(p.id);
    const activo = p.activo === true;
    Db.update('Proveedores', prov.id, Object.assign({ activo: activo }, Util.sello(user)));
    Audit.log(user, activo ? 'reactivar' : 'archivar', 'Proveedor', prov.id, { nombre: prov.nombre });
  },

  requerir(id) {
    const prov = Db.get('Proveedores', String(id || ''));
    if (!prov) throw new AppError('El proveedor no existe.', 'NO_ENCONTRADO');
    return prov;
  },
};
