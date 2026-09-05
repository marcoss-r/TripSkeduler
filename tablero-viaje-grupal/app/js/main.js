// Bootstrap + router.
//
// Fase 3: solo el flujo de tablero suelto.
//   - sin ?b=          -> crear tablero
//   - ?b=<id> inválido -> "tablero no encontrado"
//   - ?b=<id> válido, sin respuesta propia -> pedir nombre
//   - ?b=<id> válido, con respuesta propia -> tablero
//
// Las Fases 8-9 añadirán ?g=<groupId> y la pantalla de inicio ("mis
// viajes" / "mis grupos"); el router se ampliará entonces.

import { getStore } from './data/store.js';
import { renderSetup } from './ui/view-setup.js';
import { renderJoin } from './ui/view-join.js';
import { renderBoard } from './ui/view-board.js';
import { renderLoading, el } from './ui/components.js';

const app = document.getElementById('app');

async function main() {
  const params = new URLSearchParams(location.search);
  const boardId = params.get('b');

  if (!boardId) {
    renderSetup(app);
    return;
  }

  renderLoading(app, 'Cargando tablero…');

  const store = getStore();
  let board = null;
  try {
    board = await store.getBoard(boardId);
  } catch (err) {
    console.error(err);
    renderNotFound(app, { networkError: true });
    return;
  }

  if (!board) {
    renderNotFound(app, { networkError: false });
    return;
  }
  board = { ...board, boardId };

  const myUid = await store.getMyId();
  const responses = await getResponsesOnce(store, boardId);
  const alreadyJoined = responses.some((r) => r.uid === myUid);

  if (alreadyJoined) {
    renderBoard(app, board);
  } else {
    renderJoin(app, board, { onJoined: () => renderBoard(app, board) });
  }
}

function getResponsesOnce(store, boardId) {
  // ⚠️ local-store.js emite el primer valor de forma SÍNCRONA dentro de
  // subscribeResponses (antes de que la llamada devuelva la función
  // `unsubscribe`), así que no se puede referenciar `unsubscribe` dentro
  // del propio callback de esa primera llamada (temporal dead zone /
  // "is not a function" según el caso). Se aplaza la desuscripción a un
  // microtask, momento en el que la asignación ya se ha completado; esto
  // también es válido para un backend que emita de forma asíncrona
  // (Firestore's onSnapshot, Fase 5).
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe = () => {};
    unsubscribe = store.subscribeResponses(boardId, (responses) => {
      if (settled) return;
      settled = true;
      resolve(responses);
      queueMicrotask(() => unsubscribe());
    });
  });
}

function renderNotFound(app, { networkError }) {
  app.innerHTML = '';
  app.appendChild(
    el(`
    <div class="wrap">
      <div class="notFoundBox panel">
        <div class="eyebrow">${networkError ? 'ERROR DE CONEXIÓN' : 'TABLERO NO ENCONTRADO'}</div>
        <h1 style="font-size:28px;">${networkError ? 'No se pudo cargar el tablero' : 'Este enlace no existe'}</h1>
        <p class="sub" style="margin:0 auto;">${
          networkError
            ? 'Revisa tu conexión e inténtalo de nuevo.'
            : 'Puede que el enlace esté mal copiado o que el tablero se haya borrado.'
        }</p>
        <a href="${location.pathname}" style="display:inline-block;margin-top:16px;">Crear un tablero nuevo</a>
      </div>
    </div>`)
  );
}

window.addEventListener('popstate', () => location.reload());

main().catch((err) => {
  console.error(err);
  renderNotFound(app, { networkError: true });
});
