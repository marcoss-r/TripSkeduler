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
 *
 * 🔒 El valor de `store` NO se propaga tal cual: se compara con el único
 * literal admitido ('local', que es también lo único que mira store.js).
 * Antes se reenviaba el parámetro en crudo y acababa dentro de un
 * `href="..."` sin escapar, así que un enlace preparado del tipo
 * `?store=x" onfocus="…" autofocus="` inyectaba atributos y ejecutaba
 * JavaScript en el origen de la app (XSS reflejado, reproducido con
 * Playwright). Al no reflejar nunca la entrada del usuario, el agujero
 * desaparece de raíz en vez de depender de escapar bien en cada plantilla.
 */
export function appUrl(query = '') {
  const isLocalStore = new URLSearchParams(location.search).get('store') === 'local';
  const parts = [query, isLocalStore ? 'store=local' : ''].filter(Boolean);
  return parts.length ? `${location.pathname}?${parts.join('&')}` : location.pathname;
}

/**
 * URL absoluta pensada para COMPARTIR con otra persona (WhatsApp, etc.).
 * Es la contraparte de `appUrl`: esta sí lleva origen completo y NUNCA
 * arrastra `?store=local`, porque nadie más debe heredar un flag de
 * depuración al abrir un enlace que le han pasado.
 */
export function shareableUrl(query) {
  return `${location.origin}${location.pathname}?${query}`;
}

/**
 * Caja "enlace + Copiar", compartida por la pantalla de creación, la vista
 * de grupo y la del tablero. Está aquí y no repetida en cada vista porque
 * el enlace de un tablero hay que poder verlo SIEMPRE, no solo el día que
 * se creó: si se pierde el mensaje donde se compartió, la única forma de
 * recuperarlo era volver a crear el tablero.
 *
 * El botón no da por hecho que exista el portapapeles: sin API o sin
 * permiso (navegadores antiguos, WebView, http sin TLS) deja el enlace
 * seleccionado para copiarlo a mano en vez de fallar en silencio.
 */
export function renderShareBox(url, { label = 'Copiar enlace', ghost = false } = {}) {
  const box = el(`<div class="shareBox">
    <input type="text" class="shareUrl" readonly value="${escapeHtml(url)}">
    <button type="button" class="copyBtn${ghost ? ' ghost' : ''}">${escapeHtml(label)}</button>
  </div>`);

  const input = box.querySelector('.shareUrl');
  const btn = box.querySelector('.copyBtn');
  let restore = null;

  // Tocar el campo selecciona el enlace entero: en móvil, colocar el cursor
  // a mano dentro de una URL larga es un suplicio.
  input.addEventListener('focus', () => input.select());

  btn.addEventListener('click', async () => {
    clearTimeout(restore);
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = 'Copiado ✓';
      restore = setTimeout(() => (btn.textContent = label), 1500);
    } catch {
      input.focus();
      input.select();
      btn.textContent = 'Cópialo a mano';
      restore = setTimeout(() => (btn.textContent = label), 3000);
    }
  });

  return box;
}

export function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = String(s);
  return div.innerHTML;
}
