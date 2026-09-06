import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSharedLink } from '../app/js/core/parse-link.js';

// Ids válidos: alfabeto sin caracteres ambiguos (ver core/ids.js), así que
// nada de 0, 1, l ni o mayúscula en estos ejemplos.
const BOARD = 'qwrtyu2345';
const GROUP = 'mnbvcx9876';

test('enlace completo de tablero', () => {
  assert.deepEqual(parseSharedLink(`https://marcoss-r.github.io/TripSkeduler/?b=${BOARD}`), {
    kind: 'board',
    id: BOARD,
  });
});

test('enlace completo de grupo', () => {
  assert.deepEqual(parseSharedLink(`https://marcoss-r.github.io/TripSkeduler/?g=${GROUP}`), {
    kind: 'group',
    id: GROUP,
  });
});

test('enlace con texto alrededor (pegado desde WhatsApp)', () => {
  assert.deepEqual(parseSharedLink(`Mira: https://x.dev/?b=${BOARD} ¿puedes?`), { kind: 'board', id: BOARD });
});

test('el parámetro no tiene por qué ser el primero', () => {
  assert.deepEqual(parseSharedLink(`https://x.dev/?store=local&b=${BOARD}#seccion`), { kind: 'board', id: BOARD });
});

test('espacios sobrantes al pegar', () => {
  assert.deepEqual(parseSharedLink(`  https://x.dev/?b=${BOARD}\n`), { kind: 'board', id: BOARD });
});

test('solo el identificador se interpreta como tablero', () => {
  assert.deepEqual(parseSharedLink(BOARD), { kind: 'board', id: BOARD });
});

test('un identificador suelto con texto alrededor NO se adivina', () => {
  assert.equal(parseSharedLink(`el tablero es ${BOARD}`), null);
});

test('vacío, basura y enlaces sin parámetro devuelven null', () => {
  assert.equal(parseSharedLink(''), null);
  assert.equal(parseSharedLink('   '), null);
  assert.equal(parseSharedLink(null), null);
  assert.equal(parseSharedLink('https://marcoss-r.github.io/TripSkeduler/'), null);
});

test('un id con caracteres fuera del alfabeto se rechaza', () => {
  assert.equal(parseSharedLink('https://x.dev/?b=ABC'), null); // mayúsculas
  assert.equal(parseSharedLink('https://x.dev/?b=abc01l'), null); // 0, 1, l son ambiguos y no se usan
  assert.equal(parseSharedLink('https://x.dev/?b=abc'), null); // demasiado corto
});

test('el id llega decodificado si venía escapado', () => {
  assert.deepEqual(parseSharedLink(`https://x.dev/?b=%71wrtyu2345`), { kind: 'board', id: BOARD });
});
