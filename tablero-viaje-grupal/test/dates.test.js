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
  mondayIndex,
  groupByMonth,
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

test('MAX_RANGE_DAYS es 180 (límite acordado para el calendario)', () => {
  assert.equal(MAX_RANGE_DAYS, 180);
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

test('isValidRange: exactamente 180 días es válido, 181 no', () => {
  // 2026-01-01 a 2026-06-29 son exactamente 180 días (incluyendo ambos extremos)
  assert.deepEqual(isValidRange('2026-01-01', '2026-06-29'), { ok: true });
  assert.equal(isValidRange('2026-01-01', '2026-06-30').ok, false);
});

test('mondayIndex: lunes es 0, domingo es 6', () => {
  assert.equal(mondayIndex('2026-07-06'), 0); // lunes
  assert.equal(mondayIndex('2026-07-07'), 1); // martes
  assert.equal(mondayIndex('2026-07-12'), 6); // domingo
});

test('groupByMonth agrupa fechas contiguas del mismo mes en un solo bloque', () => {
  const dates = dateRangeArray('2026-07-28', '2026-08-03');
  const groups = groupByMonth(dates);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0], { year: 2026, month: 6, dates: ['2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31'] });
  assert.deepEqual(groups[1], { year: 2026, month: 7, dates: ['2026-08-01', '2026-08-02', '2026-08-03'] });
});

test('groupByMonth con un solo mes devuelve un único grupo', () => {
  const dates = dateRangeArray('2026-07-01', '2026-07-10');
  const groups = groupByMonth(dates);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].dates.length, 10);
});

test('groupByMonth con array vacío devuelve []', () => {
  assert.deepEqual(groupByMonth([]), []);
});

test('groupByMonth abarca un cambio de año correctamente', () => {
  const dates = dateRangeArray('2026-12-30', '2027-01-02');
  const groups = groupByMonth(dates);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].year, 2026);
  assert.equal(groups[1].year, 2027);
});
