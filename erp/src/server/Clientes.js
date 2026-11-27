/**
 * Clientes (DISENO.md, sección 10). "Cliente general" no es una fila: es una
 * venta sin clienteId. Solo el nombre es obligatorio.
 */
const Clientes = {
  GENERAL: 'Cliente general',

  guardar(p, user) {
    const id = p.id ? String(p.id) : '';
    const actual = id ? Clientes.requerir(id) : null;
    const ig = Util.texto(p.instagram, 'El Instagram', { max: 60 }).replace(/^@+/, '');
    const datos = {
      nombre: interpretarNombre_(Util.texto(p.nombre, 'El nombre', { requerido: true, max: 120 }), 'titulo'),
      idPokemon: Util.texto(p.idPokemon, 'El ID Pokémon', { max: 40 }),
      telefono: Util.texto(p.telefono, 'El teléfono', { max: 40 }),
      instagram: ig ? '@' + ig : '',
      notas: Util.texto(p.notas, 'Las notas', { max: 500 }),
      activo: p.activo === undefined ? (actual ? actual.activo : true) : p.activo === true,
    };
    if (Util.normalizar(datos.nombre) === Util.normalizar(Clientes.GENERAL)) throw new AppError('"Cliente general" ya existe: deja el cliente vacío en la venta.');
    const repetido = Db.all('Clientes').find((c) => c.id !== id && Util.normalizar(c.nombre) === Util.normalizar(datos.nombre));
    if (repetido) throw new AppError('Ya existe el cliente "' + repetido.nombre + '" (' + repetido.id + ').');
    if (actual) {
      const nuevo = Db.update('Clientes', id, Object.assign(datos, Util.sello(user)));
      Audit.log(user, 'editar', 'Cliente', id, Audit.diff(actual, nuevo));
      return nuevo;
    }
    const nuevo = Object.assign({ id: Util.siguienteId('CLI', 4) }, datos, Util.sello(user, true));
    Db.insert('Clientes', nuevo);
    Audit.log(user, 'crear', 'Cliente', nuevo.id, { nombre: nuevo.nombre });
    return nuevo;
  },

  /** Cliente por id o por nombre escrito; vacío o "Cliente general" = sin cliente (''). Si el nombre no existe, se crea. */
  resolver(p, user) {
    if (p.clienteId) return Clientes.requerir(p.clienteId).id;
    const nombre = Util.texto(p.cliente, 'El cliente', { max: 120 });
    if (!nombre || Util.normalizar(nombre) === Util.normalizar(Clientes.GENERAL)) return '';
    const n = Util.normalizar(interpretarNombre_(nombre, 'titulo'));
    const existe = Db.all('Clientes').find((c) => Util.normalizar(c.nombre) === n || Util.normalizar(c.id) === Util.normalizar(nombre));
    return existe ? existe.id : Clientes.guardar({ nombre: nombre }, user).id;
  },

  requerir(id) {
    const c = Db.get('Clientes', String(id || ''));
    if (!c) throw new AppError('El cliente no existe.', 'NO_ENCONTRADO');
    return c;
  },
};
