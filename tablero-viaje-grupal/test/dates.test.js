import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fmtDate,
  parseDate,
  addDays,
  dateRangeArray,
  weekdayShort,
  monthShort,
  dayNum,
  isValidRange,
  MAX_RANGE_DAYS,
} from '../app/js/core/dates.js';

// --- Regresión del bug de zona horaria -------------------------------------
// El prototipo original usaba `d.toISOString().slice(0,10)`, que serializa
// en UTC mientras que parseDate construye fechas en hora local. Este test
// se ejecuta en CI bajo dos zonas horarias distintas (Europe/Madrid y
// America/New_York) para garantizar que fmtDate(parseDate(s)) === s siempre,
// sin importar el TZ del proceso.
test('fmtDate(parseDate(s)) es la identidad, independientemente del TZ del proceso', () => {
  const samples = ['2026-01-01', '2026-07-10', '2026-12-31', '2026-02-28', '2028-02-29'];
  for (const s of samples) {
    assert.equal(fmtDate(parseDate(s)), s, `falló para ${s} con TZ=${process.env.TZ}`);
  }
});

test('fmtDate nunca usa toISOString (no debe desplazar el día)', () => {
  // Construir una fecha a medianoche local y comprobar que el día no cambia.
  const d = new Date(2026, 6, 10); // 10 de julio de 2026, hora local
  assert.equal(fmtDate(d), '2026-07-10');
});

test('addDays sube y baja correctamente, incluyendo cambio de mes', () => {
  const d = parseDate('2026-01-31');
  assert.equal(fmtDate(addDays(d, 1)), '2026-02-01');
  assert.equal(fmtDate(addDays(d, -31)), '2025-12-31');
});

test('dateRangeArray incluye ambos extremos', () => {
  const arr = dateRangeArray('2026-03-01', '2026-03-03');
  assert.deepEqual(arr, ['2026-03-01', '2026-03-02', '2026-03-03']);
});

test('dateRangeArray de un solo día', () => {
  assert.deepEqual(dateRangeArray('2026-03-01', '2026-03-01'), ['2026-03-01']);
});

test('dateRangeArray se corta en MAX_RANGE_DAYS', () => {
  const arr = dateRangeArray('2026-01-01', '2030-01-01'); // rango absurdamente largo
  assert.equal(arr.length, MAX_RANGE_DAYS);
});

test('weekdayShort, monthShort y dayNum devuelven lo esperado', () => {
  // 2026-07-10 es viernes
  assert.equal(weekdayShort('2026-07-10'), 'VIE');
  assert.equal(monthShort('2026-07-10'), 'JUL');
  assert.equal(dayNum('2026-07-10'), 10);
});

test('isValidRange: rango válido', () => {
  assert.deepEqual(isValidRange('2026-07-01', '2026-07-10'), { ok: true });
});

test('isValidRange: rango de un solo día es válido', () => {
  assert.deepEqual(isValidRange('2026-07-01', '2026-07-01'), { ok: true });
});

test('isValidRange: fecha fin anterior a fecha inicio', () => {
  const r = isValidRange('2026-07-10', '2026-07-01');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'end-before-start');
});

test('isValidRange: rango demasiado largo', () => {
  const r = isValidRange('2026-01-01', '2026-12-31');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'range-too-long');
});

test('isValidRange: formato inválido', () => {
  assert.equal(isValidRange('10-07-2026', '2026-07-20').ok, false);
  assert.equal(isValidRange('2026-07-01', 'no-es-fecha').ok, false);
});

test('isValidRange: rechaza fechas imposibles (31 de febrero)', () => {
  const r = isValidRange('2026-02-31', '2026-03-01');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid-format');
});
