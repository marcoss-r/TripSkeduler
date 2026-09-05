// Utilidades de UI compartidas entre vistas.

/** Crea un nodo DOM a partir de una cadena HTML (debe tener un único nodo raíz). */
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
}

/** Referencia usada por Fase 3 para decidir cuándo transponer la rejilla en móvil. */
export const MOBILE_BREAKPOINT_PX = 640;

export function isMobileViewport() {
  return typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT_PX;
}

/** Debounce simple: agrupa llamadas rápidas en una sola, `wait` ms después de la última. */
export function debounce(fn, wait) {
  let timer = null;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  debounced.cancel = () => clearTimeout(timer);
  debounced.flush = (...args) => {
    clearTimeout(timer);
    fn(...args);
  };
  return debounced;
}

export function renderLoading(container, message = 'Cargando…') {
  container.innerHTML = `<div class="loading">${escapeHtml(message)}</div>`;
}

export function renderErrorBanner(message) {
  return el(`<div class="banner error" role="alert">⚠️ ${escapeHtml(message)}</div>`);
}

export function renderInfoBanner(message) {
  return el(`<div class="banner info">${escapeHtml(message)}</div>`);
}

export function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = String(s);
  return div.innerHTML;
}
