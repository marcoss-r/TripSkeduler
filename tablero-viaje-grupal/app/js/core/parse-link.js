// Interpreta lo que el usuario pega en "abrir con un enlace".
//
// La idea es ser generoso con la entrada: la gente pega el enlace entero
// desde WhatsApp, a veces con texto alrededor, a veces solo el trozo del
// final, y a veces solo el identificador que ha leído por ahí. Todos esos
// casos deberían acabar en el mismo sitio.
//
// Módulo puro (sin DOM, sin `location`) para poder probarlo en Node.

import { ALPHABET } from './ids.js';

const ID_RE = new RegExp(`^[${ALPHABET}]{6,32}$`);

/**
 * parseSharedLink(texto) -> { kind: 'board'|'group', id } | null
 *
 * Acepta:
 *   https://…/?b=abcde12345           -> tablero
 *   https://…/?g=abcde12345&crear=1   -> grupo
 *   …/?b=abcde12345 con texto alrededor
 *   abcde12345                        -> se asume tablero (es lo que se comparte)
 * Devuelve null si no encuentra nada reconocible.
 */
export function parseSharedLink(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;

  // 1) ¿hay un ?b= / ?g= / &b= / &g= en cualquier parte del texto pegado?
  //    Se busca sobre el texto crudo en vez de parsear una URL porque el
  //    pegado real suele traer basura delante ("Mira: https://…") y porque
  //    un enlace sin esquema ("marcoss-r.github.io/?b=x") no es una URL
  //    válida para `new URL`.
  const param = text.match(/[?&](b|g)=([^&\s#]+)/);
  if (param) {
    const id = safeDecode(param[2]);
    if (ID_RE.test(id)) return { kind: param[1] === 'g' ? 'group' : 'board', id };
    return null;
  }

  // 2) ¿es el identificador pelado? Solo si TODO el texto lo es: si hay algo
  //    más, preferimos fallar a adivinar y mandar a la persona a un tablero
  //    que no es el suyo.
  if (ID_RE.test(text)) return { kind: 'board', id: text };

  return null;
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
