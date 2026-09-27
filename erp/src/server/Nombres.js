/**
 * Interpreta el nombre de un producto tal como viene del proveedor:
 *   "POKEMON TCG 30TH CELEBRATION - BINDER COLLECTION ENGLISH"
 *   → { edicion: '30th Celebration', nombre: 'Binder Collection', idioma: 'ENG', tipo: 'Binder / Colección' }
 *
 * Es autocontenida a propósito: index.html entrega su código fuente al navegador
 * (interpretarNombre_.toString()), así la pantalla muestra exactamente la misma
 * interpretación que usará el servidor al guardar.
 */
function interpretarNombre_(raw) {
  var TIPOS = [
    [/BOOSTER\s+BOX/, 'Booster Box'],
    [/ELITE\s+TRAINER|\bETB\b/, 'Elite Trainer Box'],
    [/BOOSTER\s+BUNDLE/, 'Booster Bundle'],
    [/BATTLE\s+DECK/, 'Battle Deck'],
    [/MINI\s+TIN/, 'Mini Tin'],
    [/\bTIN\b/, 'Tin'],
    [/PREMIUM\s+COLLECTION/, 'Premium Collection'],
    [/BINDER|COLLECTION|COLECCI[OÓ]N/, 'Binder / Colección'],
    [/BLISTER/, 'Blister'],
    [/SLEEVED\s+BOOSTER|BOOSTER\s+PACK|\bSOBRE\b/, 'Sobre'],
    [/SLEEVES|DECK\s+BOX|PLAYMAT|TAPETE|PORTACARTAS/, 'Accesorio'],
  ];
  var IDIOMAS = [
    [/\b(ENGLISH|INGL[EÉ]S|ENG)\b/i, 'ENG'],
    [/\b(ESPA[NÑ]OL|SPANISH|ESP)\b/i, 'ESP'],
    [/\b(JAPANESE|JAPON[EÉ]S|JPN|JP)\b/i, 'JPN'],
  ];
  var SIGLAS = ['TCG', 'ETB', 'EX', 'GX', 'V', 'VMAX', 'VSTAR', 'SV'];
  var titulo = function (s) {
    return s.toLowerCase().split(' ').filter(Boolean).map(function (w) {
      if (SIGLAS.indexOf(w.toUpperCase()) !== -1) return w.toUpperCase();
      if (/^\d+(st|nd|rd|th)$/.test(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  };

  var s = String(raw || '').replace(/\s+/g, ' ').trim();
  var idioma = '';
  IDIOMAS.forEach(function (x) {
    if (!idioma && x[0].test(s)) { idioma = x[1]; s = s.replace(x[0], ' ').replace(/\s+/g, ' ').trim(); }
  });
  s = s.replace(/^POK[EÉ]MON\s+(TCG\s+)?/i, '').replace(/[\s-]+$/, '');
  var edicion = '';
  var nombre = s;
  var corte = s.indexOf(' - ');
  if (corte > 0) { edicion = s.slice(0, corte); nombre = s.slice(corte + 3); }
  var upper = s.toUpperCase();
  var tipo = 'Otro';
  for (var i = 0; i < TIPOS.length; i++) {
    if (TIPOS[i][0].test(upper)) { tipo = TIPOS[i][1]; break; }
  }
  return { nombre: titulo(nombre), edicion: titulo(edicion), idioma: idioma, tipo: tipo };
}
