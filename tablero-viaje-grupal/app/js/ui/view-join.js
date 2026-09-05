// Vista de "¿cómo te llamas?" — se muestra cuando el visitante todavía no
// tiene una fila de respuesta en este tablero. El nombre se recuerda en el
// perfil local para prerrellenarlo la próxima vez (en este u otro tablero).
//
// Fase 10: junto al formulario de nombre, un botón "Continuar con Google"
// (solo si el backend es Firestore). Es la prevención de la que habla
// PLAN-DESARROLLO.md sección 1.1: quien ya tiene cuenta entra con ella
// ANTES de crear una fila anónima, así nunca hay nada que fusionar. Si aun
// así la cuenta de Google resulta estar ya vinculada a otro uid (el "caso
// feo"), se avisa y se continúa con esa cuenta existente sin más.

import { getStore } from '../data/store.js';
import { el, renderErrorBanner, renderInfoBanner } from './components.js';

export async function renderJoin(app, board, { onJoined }) {
  app.innerHTML = '';
  const store = await getStore();
  let prefill = '';
  try {
    const profile = await store.getProfile();
    prefill = profile?.displayName || '';
  } catch {
    // sin perfil guardado todavía; se pide el nombre desde cero
  }

  const showGoogle = store.kind === 'firestore';

  // Si el botón de Google de una visita anterior cayó al fallback de
  // `linkWithRedirect` (popup bloqueado), el resultado real llega recién
  // ahora, al volver de Google y recargar la página — puede que hayamos
  // vuelto aquí en vez de a "mis viajes". Se resuelve igual que el caso de
  // popup, ver el manejador de #googleBtn más abajo.
  const redirectOutcome = showGoogle ? store.consumeGoogleRedirectOutcome() : null;

  const view = el(`
    <div class="wrap">
      <div class="eyebrow">${escapeHtml(board.tripName.toUpperCase())}</div>
      <h1>¿Cómo te llamas?</h1>
      <p class="sub">Tu nombre aparecerá en el tablero para que el grupo vea tu disponibilidad.</p>
      <div id="bannerSlot"></div>
      <form id="joinForm" class="panel">
        <label>Tu nombre<input type="text" name="name" placeholder="Ana" required maxlength="40" value="${escapeHtml(prefill)}"></label>
        <button type="submit">Entrar al tablero</button>
        ${showGoogle ? '<button type="button" class="ghost" id="googleBtn">Continuar con Google</button>' : ''}
      </form>
    </div>`);
  app.appendChild(view);

  const form = view.querySelector('#joinForm');
  const bannerSlot = view.querySelector('#bannerSlot');

  async function joinWithName(name) {
    await store.saveProfile({ displayName: name });
    await store.saveMyResponse(board.boardId, { name, days: {} });
    onJoined(name);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;

    const submitBtn = form.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Entrando…';

    try {
      await joinWithName(name);
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Entrar al tablero';
      form.prepend(renderErrorBanner('No se pudo entrar al tablero. Inténtalo de nuevo.'));
      console.error(err);
    }
  });

  const googleBtn = view.querySelector('#googleBtn');

  function resetGoogleBtn() {
    if (googleBtn) {
      googleBtn.disabled = false;
      googleBtn.textContent = 'Continuar con Google';
    }
  }

  async function handleGoogleResult(result) {
    if (result.cancelled) {
      resetGoogleBtn();
      return;
    }
    if (result.pending) {
      // linkWithRedirect: la página va a navegar a Google y volver; no hay
      // nada más que hacer aquí.
      return;
    }
    if (!result.ok) {
      resetGoogleBtn();
      bannerSlot.appendChild(renderErrorBanner('No se pudo conectar con Google. Inténtalo de nuevo o escribe tu nombre.'));
      return;
    }
    if (result.merged) {
      bannerSlot.appendChild(
        renderInfoBanner('Esa cuenta de Google ya estaba vinculada en otro dispositivo. Has entrado con ella.')
      );
    }
    // Si el perfil (posiblemente el de la cuenta ya existente, tras un
    // merge) ya tiene nombre, se respeta — nunca se pisa en silencio con el
    // nombre de la cuenta de Google (PLAN-DESARROLLO.md, Fase 10).
    const profile = await store.getProfile().catch(() => null);
    const name = profile?.displayName || result.displayName || '';
    if (name) {
      form.name.value = name;
      await joinWithName(name);
    } else {
      resetGoogleBtn();
    }
  }

  if (googleBtn) {
    googleBtn.addEventListener('click', async () => {
      googleBtn.disabled = true;
      googleBtn.textContent = 'Conectando con Google…';
      try {
        await handleGoogleResult(await store.linkGoogleAccount());
      } catch (err) {
        console.error(err);
        resetGoogleBtn();
        bannerSlot.appendChild(renderErrorBanner('No se pudo conectar con Google. Inténtalo de nuevo o escribe tu nombre.'));
      }
    });
  }

  if (redirectOutcome) {
    handleGoogleResult(redirectOutcome).catch((err) => {
      console.error(err);
      bannerSlot.appendChild(renderErrorBanner('No se pudo completar la conexión con Google.'));
    });
  }
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = String(s);
  return div.innerHTML;
}
