// Lógica de puntuación y búsqueda de la mejor ventana — módulo puro.
// Copiada del prototipo (computeScores, bestWindow) y ampliada con
// topWindows para el backlog (Fase 12: top-3 ventanas alternativas).
//
// Cuatro estados por día y persona:
//   - 'none'        no definido (por defecto, antes de marcar nada)
//   - 'unavailable' no disponible (marcado explícitamente)
//   - 'partial'     parcial
//   - 'full'        disponible
// 'none' y 'unavailable' puntúan igual (0): la diferencia es solo de cara
// al usuario (saber quién no ha contestado todavía frente a quién ha dicho
// explícitamente que no puede). Por eso el desempate de bestWindow penaliza
// 'unavailable' pero no 'none' — no marcar un día no es una señal de
// conflicto, solo ausencia de dato.

const SCORE = { none: 0, unavailable: 0, partial: 0.5, full: 1 };

/**
 * Para cada fecha del rango, suma la puntuación de todas las respuestas
 * y cuenta cuántas fueron de cada estado.
 *
 * @param {string[]} dates - fechas "YYYY-MM-DD" del rango
 * @param {Array<{days: Record<string,string>}>} responses
 * @returns {{scores: Record<string,number>, breakdown: Record<string,{full:number,partial:number,unavailable:number,none:number}>}}
 */
export function computeScores(dates, responses) {
  const scores = {};
  const breakdown = {};
  for (const d of dates) {
    scores[d] = 0;
    breakdown[d] = { full: 0, partial: 0, unavailable: 0, none: 0 };
  }
  for (const r of responses) {
    for (const d of dates) {
      const st = (r.days && r.days[d]) || 'none';
      scores[d] += SCORE[st];
      breakdown[d][st]++;
    }
  }
  return { scores, breakdown };
}

/**
 * Busca, con una ventana deslizante de `length` días consecutivos, la de
 * mayor puntuación total. Desempate: 1) más "full" en la ventana,
 * 2) menos "unavailable" (no disponible explícito; "no definido" no cuenta
 * en contra).
 *
 * @returns {{start:string,end:string,sum:number,fullCount:number,unavailableCount:number}|null}
 *   null si el rango es más corto que `length`.
 */
export function bestWindow(dates, scores, breakdown, length) {
  if (dates.length < length) return null;
  let best = null;
  for (let i = 0; i + length <= dates.length; i++) {
    const slice = dates.slice(i, i + length);
    let sum = 0;
    let fullCount = 0;
    let unavailableCount = 0;
    for (const d of slice) {
      sum += scores[d];
      fullCount += breakdown[d].full;
      unavailableCount += breakdown[d].unavailable;
    }
    const cand = { start: slice[0], end: slice[slice.length - 1], sum, fullCount, unavailableCount };
    if (
      !best ||
      cand.sum > best.sum ||
      (cand.sum === best.sum && cand.fullCount > best.fullCount) ||
      (cand.sum === best.sum && cand.fullCount === best.fullCount && cand.unavailableCount < best.unavailableCount)
    ) {
      best = cand;
    }
  }
  return best;
}

/**
 * Devuelve las `n` mejores ventanas de `length` días, sin solaparse entre
 * sí, ordenadas de mejor a peor con el mismo criterio de desempate que
 * bestWindow. Usado por el backlog (top-3 alternativas), Fase 12.
 *
 * Estrategia: greedy — se calculan todas las ventanas candidatas, se
 * ordenan por (sum desc, fullCount desc, unavailableCount asc, start asc) y
 * se van aceptando las que no solapan en fechas con ninguna ya aceptada.
 *
 * @returns {Array<{start:string,end:string,sum:number,fullCount:number,unavailableCount:number}>}
 */
export function topWindows(dates, scores, breakdown, length, n = 3) {
  if (dates.length < length || n < 1) return [];

  const candidates = [];
  for (let i = 0; i + length <= dates.length; i++) {
    const slice = dates.slice(i, i + length);
    let sum = 0;
    let fullCount = 0;
    let unavailableCount = 0;
    for (const d of slice) {
      sum += scores[d];
      fullCount += breakdown[d].full;
      unavailableCount += breakdown[d].unavailable;
    }
    candidates.push({
      startIdx: i,
      endIdx: i + length - 1,
      start: slice[0],
      end: slice[slice.length - 1],
      sum,
      fullCount,
      unavailableCount,
    });
  }

  candidates.sort((a, b) => {
    if (b.sum !== a.sum) return b.sum - a.sum;
    if (b.fullCount !== a.fullCount) return b.fullCount - a.fullCount;
    if (a.unavailableCount !== b.unavailableCount) return a.unavailableCount - b.unavailableCount;
    return a.startIdx - b.startIdx;
  });

  const accepted = [];
  for (const cand of candidates) {
    const overlaps = accepted.some(
      (acc) => cand.startIdx <= acc.endIdx && acc.startIdx <= cand.endIdx
    );
    if (!overlaps) {
      accepted.push(cand);
      if (accepted.length >= n) break;
    }
  }

  return accepted.map(({ startIdx, endIdx, ...rest }) => rest);
}
