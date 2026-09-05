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

/** Pantalla de mensaje a página completa (no encontrado, error de red, etc.), compartida entre vistas. */
export function renderMessageScreen(app, { eyebrow, title, message, linkHref, linkLabel }) {
  app.innerHTML = '';
  app.appendChild(
    el(`
    <div class="wrap">
      <div class="notFoundBox panel">
        <div class="eyebrow">${escapeHtml(eyebrow)}</div>
        <h1 style="font-size:28px;">${escapeHtml(title)}</h1>
        <p class="sub" style="margin:0 auto;">${escapeHtml(message)}</p>
        ${linkHref ? `<a href="${linkHref}" style="display:inline-block;margin-top:16px;">${escapeHtml(linkLabel)}</a>` : ''}
      </div>
    </div>`)
  );
}

/**
 * Construye una URL de navegación INTERNA (enlaces/redirecciones dentro de la
 * propia app) preservando `?store=local` si estaba presente — de lo
 * contrario, cualquier navegación de página completa (`location.href = ...`)
 * lo pierde y la app cambia de golpe al backend de `config.js`. NO usar para
 * enlaces pensados para compartir con otras personas (esos van con
 * `location.pathname` a secas: nadie más debe heredar tu flag de depuración).
 */
export function appUrl(query = '') {
  const store = new URLSearchParams(location.search).get('store');
  const parts = [query, store ? `store=${store}` : ''].filter(Boolean);
  return parts.length ? `${location.pathname}?${parts.join('&')}` : location.pathname;
}

export function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = String(s);
  return div.innerHTML;
}
