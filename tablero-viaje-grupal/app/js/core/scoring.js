// Lógica de puntuación y búsqueda de la mejor ventana — módulo puro.
// Copiada del prototipo (computeScores, bestWindow) y ampliada con
// topWindows (top-3 ventanas alternativas) y con participantes
// imprescindibles.
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
//
// PARTICIPANTE IMPRESCINDIBLE (sustituye al "cuenta doble" anterior). Hay
// gente sin la que no hay viaje: quien pone la casa, quien conduce. Eso no
// es "su voto vale más" — es un veto. Un día que un imprescindible ha
// marcado como 'unavailable' queda BLOQUEADO, y una ventana con algún día
// bloqueado va SIEMPRE por detrás de cualquier ventana sin bloqueos, valga
// lo que valga su puntuación. Ponderar la puntuación no servía para esto:
// con suficiente gente disponible, la suma tapaba el veto y la ventana
// ganadora seguía siendo una en la que esa persona no podía ir.
//
// Solo bloquea el 'unavailable' explícito: 'none' (aún no ha contestado) no
// puede vetar nada, y 'partial' significa que puede a medias, no que no
// pueda.

const SCORE = { none: 0, unavailable: 0, partial: 0.5, full: 1 };

/**
 * Para cada fecha del rango, suma la puntuación de todas las respuestas
 * y cuenta cuántas fueron de cada estado.
 *
 * `essential` (opcional) marca a un participante como imprescindible: sus
 * días 'unavailable' se cuentan además en `breakdown[fecha].blocked`, que
 * es lo que usan bestWindow/topWindows para descartar esas ventanas. NO
 * altera `scores`: la puntuación sigue siendo "cuánta gente puede", y el
 * veto se aplica aparte, al elegir ventana.
 *
 * @param {string[]} dates - fechas "YYYY-MM-DD" del rango
 * @param {Array<{days: Record<string,string>, essential?: boolean}>} responses
 * @returns {{scores: Record<string,number>, breakdown: Record<string,{full:number,partial:number,unavailable:number,none:number,blocked:number}>}}
 */
export function computeScores(dates, responses) {
  const scores = {};
  const breakdown = {};
  for (const d of dates) {
    scores[d] = 0;
    breakdown[d] = { full: 0, partial: 0, unavailable: 0, none: 0, blocked: 0 };
  }
  for (const r of responses) {
    for (const d of dates) {
      const st = (r.days && r.days[d]) || 'none';
      scores[d] += SCORE[st];
      breakdown[d][st]++;
      if (r.essential && st === 'unavailable') breakdown[d].blocked++;
    }
  }
  return { scores, breakdown };
}

/** Estadísticas de la ventana que empieza en el índice `i` y dura `length` días. */
function windowStats(dates, scores, breakdown, i, length) {
  const slice = dates.slice(i, i + length);
  let sum = 0;
  let fullCount = 0;
  let unavailableCount = 0;
  let blockedDays = 0;
  for (const d of slice) {
    sum += scores[d];
    fullCount += breakdown[d].full;
    unavailableCount += breakdown[d].unavailable;
    if (breakdown[d].blocked > 0) blockedDays++;
  }
  return {
    startIdx: i,
    endIdx: i + length - 1,
    start: slice[0],
    end: slice[slice.length - 1],
    sum,
    fullCount,
    unavailableCount,
    blockedDays,
  };
}

/**
 * Orden de preferencia entre ventanas (negativo = `a` es mejor):
 *   1. menos días bloqueados por un imprescindible — esto va PRIMERO, por
 *      encima de la puntuación: si alguien sin quien no hay viaje ha dicho
 *      que no puede, da igual cuánta gente más pueda.
 *   2. más puntuación total
 *   3. más "full" (disponibilidades completas)
 *   4. menos "unavailable" explícitos
 *   5. la que empiece antes, para que el resultado sea estable
 */
function compareWindows(a, b) {
  if (a.blockedDays !== b.blockedDays) return a.blockedDays - b.blockedDays;
  if (b.sum !== a.sum) return b.sum - a.sum;
  if (b.fullCount !== a.fullCount) return b.fullCount - a.fullCount;
  if (a.unavailableCount !== b.unavailableCount) return a.unavailableCount - b.unavailableCount;
  return a.startIdx - b.startIdx;
}

const publicShape = ({ startIdx, endIdx, ...rest }) => rest;

/**
 * Busca, con una ventana deslizante de `length` días consecutivos, la mejor
 * según `compareWindows` (ver ahí el orden de criterios).
 *
 * Si TODAS las ventanas están bloqueadas por algún imprescindible, devuelve
 * igualmente la menos mala en vez de null: la UI avisa de que está
 * bloqueada, que es más útil que no proponer nada.
 *
 * @returns {{start:string,end:string,sum:number,fullCount:number,unavailableCount:number,blockedDays:number}|null}
 *   null solo si el rango es más corto que `length`.
 */
export function bestWindow(dates, scores, breakdown, length) {
  if (dates.length < length) return null;
  let best = null;
  for (let i = 0; i + length <= dates.length; i++) {
    const cand = windowStats(dates, scores, breakdown, i, length);
    if (!best || compareWindows(cand, best) < 0) best = cand;
  }
  return publicShape(best);
}

/**
 * Devuelve las `n` mejores ventanas de `length` días, sin solaparse entre
 * sí, ordenadas de mejor a peor con el mismo criterio que bestWindow.
 *
 * Estrategia: greedy — se calculan todas las ventanas candidatas, se
 * ordenan con `compareWindows` y se van aceptando las que no solapan en
 * fechas con ninguna ya aceptada.
 *
 * @returns {Array<{start:string,end:string,sum:number,fullCount:number,unavailableCount:number,blockedDays:number}>}
 */
export function topWindows(dates, scores, breakdown, length, n = 3) {
  if (dates.length < length || n < 1) return [];

  const candidates = [];
  for (let i = 0; i + length <= dates.length; i++) {
    candidates.push(windowStats(dates, scores, breakdown, i, length));
  }
  candidates.sort(compareWindows);

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

  return accepted.map(publicShape);
}
