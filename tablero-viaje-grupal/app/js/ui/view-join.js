// Vista de "¿cómo te llamas?" — se muestra cuando el visitante todavía no
// tiene una fila de respuesta en este tablero. El nombre se recuerda en el
// perfil local para prerrellenarlo la próxima vez (en este u otro tablero).

import { getStore } from '../data/store.js';
import { el, renderErrorBanner } from './components.js';

export async function renderJoin(app, board, { onJoined }) {
  app.innerHTML = '';
  const store = getStore();
  let prefill = '';
  try {
    const profile = await store.getProfile();
    prefill = profile?.displayName || '';
  } catch {
    // sin perfil guardado todavía; se pide el nombre desde cero
  }

  const view = el(`
    <div class="wrap">
      <div class="eyebrow">${escapeHtml(board.tripName.toUpperCase())}</div>
      <h1>¿Cómo te llamas?</h1>
      <p class="sub">Tu nombre aparecerá en el tablero para que el grupo vea tu disponibilidad.</p>
      <form id="joinForm" class="panel">
        <label>Tu nombre<input type="text" name="name" placeholder="Ana" required maxlength="40" value="${escapeHtml(prefill)}"></label>
        <button type="submit">Entrar al tablero</button>
      </form>
    </div>`);
  app.appendChild(view);

  const form = view.querySelector('#joinForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;

    const submitBtn = form.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Entrando…';

    try {
      await store.saveProfile({ displayName: name });
      await store.saveMyResponse(board.boardId, { name, days: {} });
      onJoined(name);
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Entrar al tablero';
      form.prepend(renderErrorBanner('No se pudo entrar al tablero. Inténtalo de nuevo.'));
      console.error(err);
    }
  });
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = String(s);
  return div.innerHTML;
}
