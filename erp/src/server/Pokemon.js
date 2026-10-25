/**
 * Biblioteca de Pokémon para la Story del Top 5 de los torneos.
 *
 * Cada Pokémon tiene un nombre y, si se subió, una imagen (PNG con fondo transparente funciona mejor)
 * guardada en la carpeta de Drive del ERP, así todo el equipo la tiene para los torneos siguientes.
 * El navegador pide solo las imágenes que va a dibujar (verImagenesPokemon), como data URL, para que
 * el canvas pueda exportar el PNG.
 */
const Pokemon = {
  requerir(id) {
    const x = Db.get('Pokemon', String(id || ''));
    if (!x) throw new AppError('Ese Pokémon ya no está en la biblioteca.', 'NO_ENCONTRADO');
    return x;
  },

  /** Crea la biblioteca con los Pokémon de partida (desde instalar, solo si está vacía). */
  sembrar(user) {
    if (Db.all('Pokemon').length) return false;
    const ids = Util.reservarIds('POK', 4, POKEMON_INICIALES.length);
    Db.insertMany('Pokemon', POKEMON_INICIALES.map((n, i) => Object.assign({ id: ids[i], nombre: n, imagen: '' }, Util.sello(user, true))));
    return true;
  },

  agregar(p, user) {
    const nombre = Util.texto(p.nombre, 'El nombre del Pokémon', { requerido: true, max: 40 });
    if (Db.all('Pokemon').some((x) => Util.normalizar(x.nombre) === Util.normalizar(nombre))) throw new AppError(nombre + ' ya está en la biblioteca.');
    const x = Object.assign({ id: Util.siguienteId('POK', 4), nombre: nombre, imagen: '' }, Util.sello(user, true));
    Db.insert('Pokemon', x);
    Audit.log(user, 'crear', 'Pokémon', x.id, { nombre: nombre });
    return { id: x.id, nombre: nombre };
  },

  /** Cambia el nombre; los torneos que ya lo tienen elegido pasan al nombre nuevo. */
  renombrar(p, user) {
    const x = Pokemon.requerir(p.id);
    const nombre = Util.texto(p.nombre, 'El nombre del Pokémon', { requerido: true, max: 40 });
    if (Db.all('Pokemon').some((o) => o.id !== x.id && Util.normalizar(o.nombre) === Util.normalizar(nombre))) throw new AppError(nombre + ' ya está en la biblioteca.');
    if (nombre === x.nombre) return { id: x.id, nombre: nombre, torneos: 0 };
    const viejo = Util.normalizar(x.nombre);
    const cambios = {};
    Db.all('Torneo_Jugadores').forEach((j) => {
      const c = {};
      if (Util.normalizar(j.principal) === viejo) c.principal = nombre;
      if (Util.normalizar(j.secundario) === viejo) c.secundario = nombre;
      if (Object.keys(c).length) cambios[j.id] = Object.assign(c, Util.sello(user));
    });
    if (Object.keys(cambios).length) Db.actualizarVarios('Torneo_Jugadores', cambios);
    Db.update('Pokemon', x.id, Object.assign({ nombre: nombre }, Util.sello(user)));
    Audit.log(user, 'renombrar', 'Pokémon', x.id, { antes: x.nombre, nombre: nombre, jugadores: Object.keys(cambios).length });
    return { id: x.id, nombre: nombre, antes: x.nombre, jugadores: Object.keys(cambios).length };
  },

  /** Sube o reemplaza la imagen (p.archivo: { base64, mime }), o la quita (p.quitar). La anterior va a la papelera. */
  imagen(p, user) {
    const x = Pokemon.requerir(p.id);
    const nueva = p.quitar ? '' : Imagenes.subir(Imagenes.validar(p.archivo) || (() => { throw new AppError('Elige la imagen.'); })(), 'Pokémon ' + x.nombre);
    if (x.imagen) Imagenes.papelera(x.imagen);
    Db.update('Pokemon', x.id, Object.assign({ imagen: nueva }, Util.sello(user)));
    Audit.log(user, p.quitar ? 'quitar imagen' : 'subir imagen', 'Pokémon', x.id, { nombre: x.nombre });
    return { id: x.id };
  },

  eliminar(p, user) {
    const x = Pokemon.requerir(p.id);
    Db.remove('Pokemon', x.id);
    if (x.imagen) Imagenes.papelera(x.imagen);
    Audit.log(user, 'eliminar', 'Pokémon', x.id, { nombre: x.nombre });
    return { id: x.id };
  },

  /** Imágenes como data URL para dibujarlas: { POK-0001: 'data:image/png;base64,…' } (las que no se pueden leer, se omiten). */
  verImagenes(p) {
    const res = {};
    (Array.isArray(p.ids) ? p.ids : []).slice(0, 40).forEach((id) => {
      const x = Db.get('Pokemon', String(id));
      if (!x || !x.imagen) return;
      try {
        const a = Imagenes.leer(x.imagen);
        res[x.id] = 'data:' + (a.mime || 'image/png') + ';base64,' + a.base64;
      } catch (e) {
        // Archivo borrado o sin acceso: se dibuja el nombre.
      }
    });
    return res;
  },

  vista() {
    return Db.all('Pokemon').map((x) => ({ id: x.id, nombre: x.nombre, imagen: x.imagen || '', version: String(x.actualizadoEn || x.creadoEn || '') }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  },
};
