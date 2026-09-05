import test from 'node:test';
import assert from 'node:assert/strict';
import { newId, ALPHABET } from '../app/js/core/ids.js';

test('newId genera un id de la longitud pedida', () => {
  assert.equal(newId(10).length, 10);
  assert.equal(newId(4).length, 4);
  assert.equal(newId().length, 10); // longitud por defecto
});

test('newId solo usa caracteres del alfabeto sin ambigüedades', () => {
  const id = newId(200);
  for (const ch of id) {
    assert.ok(ALPHABET.includes(ch), `carácter inesperado: ${ch}`);
  }
});

test('el alfabeto no contiene caracteres ambiguos (0/O, 1/l/I)', () => {
  for (const ch of ['0', 'O', '1', 'l', 'I']) {
    assert.ok(!ALPHABET.includes(ch), `el alfabeto no debería incluir "${ch}"`);
  }
});

test('newId produce valores distintos entre llamadas (no determinista)', () => {
  const ids = new Set();
  for (let i = 0; i < 50; i++) ids.add(newId(10));
  // Con 50 muestras de 10 chars sobre un alfabeto de 33, una colisión es
  // astronómicamente improbable; si el generador estuviera roto (constante,
  // o con muy poca entropía), este test lo detectaría.
  assert.equal(ids.size, 50);
});
