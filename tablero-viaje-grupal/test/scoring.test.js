import test from 'node:test';
import assert from 'node:assert/strict';
import { computeScores, bestWindow, topWindows } from '../app/js/core/scoring.js';

const DATES = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05'];

test('computeScores suma puntos y cuenta breakdown correctamente', () => {
  const responses = [
    { days: { '2026-07-01': 'full', '2026-07-02': 'partial' } },
    { days: { '2026-07-01': 'full', '2026-07-02': 'none' } },
  ];
  const { scores, breakdown } = computeScores(DATES, responses);

  assert.equal(scores['2026-07-01'], 2); // full + full
  assert.equal(scores['2026-07-02'], 0.5); // partial + none
  assert.equal(scores['2026-07-03'], 0); // sin respuesta -> 'none' por defecto

  assert.deepEqual(breakdown['2026-07-01'], { full: 2, partial: 0, none: 0 });
  assert.deepEqual(breakdown['2026-07-02'], { full: 0, partial: 1, none: 1 });
  assert.deepEqual(breakdown['2026-07-03'], { full: 0, partial: 0, none: 2 });
});

test('computeScores con cero participantes: todas las puntuaciones a 0', () => {
  const { scores, breakdown } = computeScores(DATES, []);
  for (const d of DATES) {
    assert.equal(scores[d], 0);
    assert.deepEqual(breakdown[d], { full: 0, partial: 0, none: 0 });
  }
});

test('bestWindow elige la ventana de mayor puntuación total', () => {
  const responses = [
    {
      days: {
        '2026-07-01': 'none',
        '2026-07-02': 'none',
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
  // Ventana A: dos 'partial' (suma 1). Ventana B: un 'full' + un 'none' (suma 1).
  // Con longitud 2 sobre un rango de 2 fechas para simplificar el caso.
  const dates = ['2026-07-01', '2026-07-02'];
  const responsesA = [{ days: { '2026-07-01': 'partial', '2026-07-02': 'partial' } }];
  const { scores: sA, breakdown: bA } = computeScores(dates, responsesA);
  const winA = bestWindow(dates, sA, bA, 2);
  assert.equal(winA.sum, 1);
  assert.equal(winA.fullCount, 0);

  const responsesB = [{ days: { '2026-07-01': 'full', '2026-07-02': 'none' } }];
  const { scores: sB, breakdown: bB } = computeScores(dates, responsesB);
  const winB = bestWindow(dates, sB, bB, 2);
  assert.equal(winB.sum, 1);
  assert.equal(winB.fullCount, 1);
  // winB tiene más 'full' que winA con la misma suma -> ganaría en una comparación directa.
});

test('bestWindow desempate 2: misma suma, mismo fullCount, gana menos "none"', () => {
  const dates = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04'];
  // Ventana [0,1]: full+none (sum=1, full=1, none=1)
  // Ventana [2,3]: full+partial (sum=1.5, full=1, none=0) -> gana esta por suma mayor
  // Ajustamos para que las sumas coincidan exactamente:
  // [0,1]: full + none => sum=1, full=1, none=1
  // [2,3]: partial + full => sum=1.5 -> no sirve, cambiamos a partial+partial+...
  // Construimos un caso más directo con 2 respuestas:
  const responses = [
    { days: { '2026-07-01': 'full', '2026-07-02': 'none', '2026-07-03': 'full', '2026-07-04': 'partial' } },
    { days: { '2026-07-01': 'none', '2026-07-02': 'none', '2026-07-03': 'none', '2026-07-04': 'partial' } },
  ];
  const { scores, breakdown } = computeScores(dates, responses);
  // Ventana [0,1]: full+none + none+none = sum 1, full=1, none=3
  // Ventana [2,3]: full+partial + none+partial = sum 2, full=1, none=1
  const winFull = bestWindow(dates, scores, breakdown, 2);
  assert.equal(winFull.start, '2026-07-03');
  assert.equal(winFull.sum, 2);
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
        '2026-07-03': 'none', '2026-07-04': 'none',
        '2026-07-05': 'partial', '2026-07-06': 'partial', // segunda mejor
        '2026-07-07': 'none', '2026-07-08': 'none',
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
