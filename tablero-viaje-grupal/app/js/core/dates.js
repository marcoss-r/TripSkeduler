// Utilidades de fechas — módulo puro, sin dependencias del DOM ni de Firebase.
//
// Todas las fechas de la aplicación se representan como strings "YYYY-MM-DD"
// en hora LOCAL del navegador. `parseDate` construye un Date en hora local
// (new Date(y, m-1, d)), así que fmtDate debe serializar también en hora
// local — nunca con toISOString(), que convierte a UTC y puede desplazar
// el día (ver PLAN-DESARROLLO.md, sección "Bug conocido").

const MAX_RANGE_DAYS = 120;

const WEEKDAYS_SHORT = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
const MONTHS_SHORT = [
  'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN',
  'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC',
];

/**
 * Formatea un Date como "YYYY-MM-DD" usando sus componentes LOCALES.
 * Corrige el bug del prototipo (toISOString() convierte a UTC y puede
 * devolver el día anterior según la zona horaria del navegador).
 */
export function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parsea "YYYY-MM-DD" a un Date en hora local (medianoche local). */
export function parseDate(s) {
  const [y, m, day] = s.split('-').map(Number);
  return new Date(y, m - 1, day);
}

/** Devuelve un nuevo Date desplazado `n` días (n puede ser negativo). */
export function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/**
 * Genera el array de fechas "YYYY-MM-DD" entre startStr y endStr, ambos
 * incluidos. Se corta en MAX_RANGE_DAYS para acotar el tamaño del tablero.
 */
export function dateRangeArray(startStr, endStr) {
  const start = parseDate(startStr);
  const end = parseDate(endStr);
  const arr = [];
  let cur = start;
  while (cur <= end && arr.length < MAX_RANGE_DAYS) {
    arr.push(fmtDate(cur));
    cur = addDays(cur, 1);
  }
  return arr;
}

export function weekdayShort(dateStr) {
  return WEEKDAYS_SHORT[parseDate(dateStr).getDay()];
}

export function dayNum(dateStr) {
  return parseDate(dateStr).getDate();
}

export function monthShort(dateStr) {
  return MONTHS_SHORT[parseDate(dateStr).getMonth()];
}

/**
 * Valida un rango de fechas para crear un tablero:
 * - ambas fechas tienen formato válido y son fechas reales
 * - endDate >= startDate
 * - el rango no supera MAX_RANGE_DAYS
 * Devuelve { ok: true } o { ok: false, reason: string }.
 */
export function isValidRange(startStr, endStr) {
  if (!isDateString(startStr) || !isDateString(endStr)) {
    return { ok: false, reason: 'invalid-format' };
  }
  const start = parseDate(startStr);
  const end = parseDate(endStr);
  if (end < start) {
    return { ok: false, reason: 'end-before-start' };
  }
  // dateRangeArray corta en MAX_RANGE_DAYS; si el rango real es más largo,
  // lo detectamos comparando la diferencia de días directamente.
  const diffDays = Math.round((end - start) / 86400000) + 1;
  if (diffDays > MAX_RANGE_DAYS) {
    return { ok: false, reason: 'range-too-long' };
  }
  return { ok: true };
}

function isDateString(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseDate(s);
  return fmtDate(d) === s; // rechaza fechas imposibles como 2026-02-30
}

export { MAX_RANGE_DAYS };
