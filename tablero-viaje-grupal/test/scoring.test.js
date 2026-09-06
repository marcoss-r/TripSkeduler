import test from 'node:test';
import assert from 'node:assert/strict';
import { computeScores, bestWindow, topWindows } from '../app/js/core/scoring.js';

const DATES = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05'];

test('computeScores suma puntos y cuenta breakdown correctamente (4 estados)', () => {
  const responses = [
    { days: { '2026-07-01': 'full', '2026-07-02': 'partial' } },
    { days: { '2026-07-01': 'full', '2026-07-02': 'unavailable' } },
  ];
  const { scores, breakdown } = computeScores(DATES, responses);

  assert.equal(scores['2026-07-01'], 2); // full + full
  assert.equal(scores['2026-07-02'], 0.5); // partial + unavailable(0)
  assert.equal(scores['2026-07-03'], 0); // sin marcar -> 'none' por defecto

  assert.deepEqual(breakdown['2026-07-01'], { full: 2, partial: 0, unavailable: 0, none: 0, blocked: 0 });
  assert.deepEqual(breakdown['2026-07-02'], { full: 0, partial: 1, unavailable: 1, none: 0, blocked: 0 });
  assert.deepEqual(breakdown['2026-07-03'], { full: 0, partial: 0, unavailable: 0, none: 2, blocked: 0 });
});

test('"none" (no definido) y "unavailable" (no disponible) puntúan igual: 0', () => {
  const responses = [{ days: { '2026-07-01': 'unavailable' } }]; // '2026-07-02' se queda sin marcar -> 'none'
  const { scores } = computeScores(DATES, responses);
  assert.equal(scores['2026-07-01'], 0);
  assert.equal(scores['2026-07-02'], 0);
});

test('computeScores con cero participantes: todas las puntuaciones a 0', () => {
  const { scores, breakdown } = computeScores(DATES, []);
  for (const d of DATES) {
    assert.equal(scores[d], 0);
    assert.deepEqual(breakdown[d], { full: 0, partial: 0, unavailable: 0, none: 0, blocked: 0 });
  }
});

test('un imprescindible que dice "no puedo" bloquea el día, sin tocar la puntuación', () => {
  const responses = [
    { days: { '2026-07-01': 'unavailable', '2026-07-02': 'full' }, essential: true },
    { days: { '2026-07-01': 'full', '2026-07-02': 'full' } },
  ];
  const { scores, breakdown } = computeScores(DATES, responses);
  // La puntuación es la de siempre: ser imprescindible no vale más puntos.
  assert.equal(scores['2026-07-01'], 1);
  assert.equal(scores['2026-07-02'], 2);
  assert.equal(breakdown['2026-07-01'].blocked, 1);
  assert.equal(breakdown['2026-07-02'].blocked, 0);
});

test('solo el "no disponible" explícito de un imprescindible bloquea: "none" y "partial" no', () => {
  const responses = [
    { days: { '2026-07-02': 'partial' }, essential: true }, // 07-01 se queda en 'none'
  ];
  const { breakdown } = computeScores(DATES, responses);
  assert.equal(breakdown['2026-07-01'].blocked, 0); // no ha contestado: no puede vetar
  assert.equal(breakdown['2026-07-02'].blocked, 0); // puede a medias: tampoco veta
});

test('un participante normal que no puede no bloquea nada', () => {
  const responses = [{ days: { '2026-07-01': 'unavailable' } }];
  const { breakdown } = computeScores(DATES, responses);
  assert.equal(breakdown['2026-07-01'].blocked, 0);
});

test('bestWindow prefiere una ventana sin bloqueos aunque puntúe MENOS', () => {
  const dates = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04'];
  const disponible = { '2026-07-01': 'full', '2026-07-02': 'full', '2026-07-03': 'partial', '2026-07-04': 'partial' };
  const responses = [
    // El imprescindible no puede el día 1.
    { days: { '2026-07-01': 'unavailable', '2026-07-02': 'full', '2026-07-03': 'partial', '2026-07-04': 'partial' }, essential: true },
    { days: { ...disponible } },
    { days: { ...disponible } },
  ];
  const { scores, breakdown } = computeScores(dates, responses);
  // [01,02] suma 5 — la más alta — pero el día 1 está vetado.
  // [02,03] suma 4.5 y no tiene ningún día bloqueado: gana igualmente.
  const win = bestWindow(dates, scores, breakdown, 2);
  assert.equal(win.start, '2026-07-02');
  assert.equal(win.sum, 4.5);
  assert.equal(win.blockedDays, 0);
});

test('si TODAS las ventanas están bloqueadas, bestWindow devuelve la menos mala, no null', () => {
  const dates = ['2026-07-01', '2026-07-02'];
  const responses = [
    { days: { '2026-07-01': 'unavailable', '2026-07-02': 'unavailable' }, essential: true },
  ];
  const { scores, breakdown } = computeScores(dates, responses);
  const win = bestWindow(dates, scores, breakdown, 2);
  assert.notEqual(win, null);
  assert.equal(win.blockedDays, 2);
});

test('topWindows también manda las ventanas bloqueadas al final', () => {
  const dates = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05', '2026-07-06'];
  const casiTodos = { '2026-07-01': 'partial', '2026-07-02': 'partial', '2026-07-05': 'full', '2026-07-06': 'full' };
  const responses = [
    { days: { '2026-07-05': 'unavailable', '2026-07-06': 'full' }, essential: true },
    { days: { ...casiTodos } },
    { days: { ...casiTodos } },
  ];
  const { scores, breakdown } = computeScores(dates, responses);
  const top = topWindows(dates, scores, breakdown, 2, 3);
  // [05,06] es con diferencia la de más puntuación (5), pero el día 5 lo veta
  // el imprescindible: se va al final, detrás de ventanas que puntúan menos.
  assert.equal(top[0].start, '2026-07-01');
  assert.equal(top[0].blockedDays, 0);
  assert.equal(top[top.length - 1].start, '2026-07-05');
  assert.equal(top[top.length - 1].sum, 5);
  assert.equal(top[top.length - 1].blockedDays, 1);
});

test('bestWindow elige la ventana de mayor puntuación total', () => {
  const responses = [
    {
      days: {
        '2026-07-01': 'unavailable',
        '2026-07-02': 'unavailable',
        '2026-07-03': 'full',
        '2026-07-04': 'full',
        '2026-07-05': 'full',
      },
    },
  ];
  const { scores, breakdown } = computeScores(DATES, responses);
  const win = bestWindow(DATES, scores, breakdown, 3);
  assert.equal(win.start, '2026-07-03');
  assert.equal(win.end, '2026-07-05');
  assert.equal(win.sum, 3);
});

test('bestWindow desempate 1: misma suma, gana más "full"', () => {
  const dates = ['2026-07-01', '2026-07-02'];
  const responsesA = [{ days: { '2026-07-01': 'partial', '2026-07-02': 'partial' } }];
  const { scores: sA, breakdown: bA } = computeScores(dates, responsesA);
  const winA = bestWindow(dates, sA, bA, 2);
  assert.equal(winA.sum, 1);
  assert.equal(winA.fullCount, 0);

  const responsesB = [{ days: { '2026-07-01': 'full', '2026-07-02': 'unavailable' } }];
  const { scores: sB, breakdown: bB } = computeScores(dates, responsesB);
  const winB = bestWindow(dates, sB, bB, 2);
  assert.equal(winB.sum, 1);
  assert.equal(winB.fullCount, 1);
  // winB tiene más 'full' que winA con la misma suma -> ganaría en una comparación directa.
});

test('bestWindow desempate 2: misma suma, mismo fullCount, gana menos "unavailable"', () => {
  const dates = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04'];
  const responses = [
    { days: { '2026-07-01': 'full', '2026-07-02': 'unavailable', '2026-07-03': 'full', '2026-07-04': 'partial' } },
    { days: { '2026-07-01': 'unavailable', '2026-07-02': 'unavailable', '2026-07-03': 'unavailable', '2026-07-04': 'partial' } },
  ];
  const { scores, breakdown } = computeScores(dates, responses);
  // Ventana [0,1]: full+unavailable + unavailable+unavailable = sum 1, full=1, unavailable=3
  // Ventana [2,3]: full+partial + unavailable+partial = sum 2, full=1, unavailable=1
  const win = bestWindow(dates, scores, breakdown, 2);
  assert.equal(win.start, '2026-07-03');
  assert.equal(win.sum, 2);
});

test('bestWindow: días sin marcar ("none") no penalizan el desempate, a diferencia de "unavailable"', () => {
  const dates = ['2026-07-01', '2026-07-02'];
  // Ventana única de longitud 2: un "full" + un "none" sin marcar.
  const responsesNone = [{ days: { '2026-07-01': 'full' } }]; // '2026-07-02' queda 'none'
  const { scores: sN, breakdown: bN } = computeScores(dates, responsesNone);
  const winNone = bestWindow(dates, sN, bN, 2);
  assert.equal(winNone.unavailableCount, 0); // 'none' no cuenta como unavailable

  const responsesUnavail = [{ days: { '2026-07-01': 'full', '2026-07-02': 'unavailable' } }];
  const { scores: sU, breakdown: bU } = computeScores(dates, responsesUnavail);
  const winUnavail = bestWindow(dates, sU, bU, 2);
  assert.equal(winUnavail.unavailableCount, 1);
});

test('bestWindow devuelve null si el rango es más corto que la duración', () => {
  const { scores, breakdown } = computeScores(DATES, []);
  assert.equal(bestWindow(DATES, scores, breakdown, 10), null);
});

test('bestWindow con cero participantes: cualquier ventana vale 0, elige la primera', () => {
  const { scores, breakdown } = computeScores(DATES, []);
  const win = bestWindow(DATES, scores, breakdown, 3);
  assert.equal(win.start, '2026-07-01');
  assert.equal(win.sum, 0);
});

test('topWindows devuelve ventanas no solapadas ordenadas de mejor a peor', () => {
  const dates = [
    '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04',
    '2026-07-05', '2026-07-06', '2026-07-07', '2026-07-08',
  ];
  const responses = [
    {
      days: {
        '2026-07-01': 'full', '2026-07-02': 'full', // mejor ventana de 2
        '2026-07-03': 'unavailable', '2026-07-04': 'unavailable',
        '2026-07-05': 'partial', '2026-07-06': 'partial', // segunda mejor
        '2026-07-07': 'unavailable', '2026-07-08': 'unavailable',
      },
    },
  ];
  const { scores, breakdown } = computeScores(dates, responses);
  const top = topWindows(dates, scores, breakdown, 2, 3);

  assert.equal(top.length, 3);
  assert.equal(top[0].start, '2026-07-01');
  assert.equal(top[0].sum, 2);
  assert.equal(top[1].start, '2026-07-05');
  assert.equal(top[1].sum, 1);

  // Ninguna ventana se solapa con otra.
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      const a = top[i];
      const b = top[j];
      const overlap = !(a.end < b.start || b.end < a.start);
      assert.equal(overlap, false, `las ventanas ${a.start}-${a.end} y ${b.start}-${b.end} se solapan`);
    }
  }
});

test('topWindows devuelve [] si el rango es más corto que la duración', () => {
  const { scores, breakdown } = computeScores(DATES, []);
  assert.deepEqual(topWindows(DATES, scores, breakdown, 10, 3), []);
});

test('topWindows respeta el límite n aunque haya más candidatas', () => {
  const { scores, breakdown } = computeScores(DATES, []);
  const top = topWindows(DATES, scores, breakdown, 1, 2);
  assert.equal(top.length, 2);
});
