// Bootstrap + router.
//
//   sin parámetros        -> inicio ("mis viajes" / "mis grupos")
//   ?crear=1               -> crear tablero suelto
//   ?g=<id>&crear=1         -> crear tablero dentro de ese grupo
//   ?g=<id>                -> pantalla de grupo (unirse si no soy miembro)
//   ?b=<id> inválido       -> "tablero no encontrado"
//   ?b=<id> válido, grupo, ya soy miembro del grupo, sin fila -> auto-entra
//     con mi nombre de grupo, sin pantalla de "¿cómo te llamas?"
//   ?b=<id> válido, sin fila -> pedir nombre
//   ?b=<id> válido, con fila -> tablero

import { getStore } from './data/store.js';
import { renderSetup } from './ui/view-setup.js';
import { renderJoin } from './ui/view-join.js';
import { renderBoard } from './ui/view-board.js';
import { renderHome } from './ui/view-home.js';
import { renderGroup } from './ui/view-group.js';
import { renderLoading, renderMessageScreen, appUrl } from './ui/components.js';

const app = document.getElementById('app');

async function main() {
  const params = new URLSearchParams(location.search);
  const boardId = params.get('b');
  const groupId = params.get('g');
  const creating = params.get('crear') === '1';

  if (boardId) {
    await handleBoard(boardId);
  } else if (groupId && creating) {
    await handleCreateGroupBoard(groupId);
  } else if (groupId) {
    await renderGroup(app, groupId);
  } else if (creating) {
    renderSetup(app);
  } else {
    await renderHome(app);
  }
}

async function handleBoard(boardId) {
  renderLoading(app, 'Cargando tablero…');

  const store = await getStore();
  let board = null;
  try {
    board = await store.getBoard(boardId);
  } catch (err) {
    console.error(err);
    renderBoardNotFound({ networkError: true });
    return;
  }

  if (!board) {
    renderBoardNotFound({ networkError: false });
    return;
  }
  board = { ...board, boardId };

  const myUid = await store.getMyId();
  const responses = await once((cb) => store.subscribeResponses(boardId, cb));
  const alreadyJoined = responses.some((r) => r.uid === myUid);

  if (alreadyJoined) {
    renderBoard(app, board);
    return;
  }

  // Tablero de grupo + ya soy miembro de ese grupo -> me uno directamente
  // con mi nombre de grupo, sin pasar por la pantalla de "¿cómo te llamas?"
  // (Fase 9: "el segundo viaje del grupo es un clic").
  if (board.groupId) {
    const group = await store.getGroup(board.groupId).catch(() => null);
    if (group) {
      const members = await once((cb) => store.subscribeMembers(board.groupId, cb));
      const myMembership = members.find((m) => m.uid === myUid);
      if (myMembership) {
        try {
          await store.saveMyResponse(boardId, { name: myMembership.name, days: {} });
          await store.rememberBoard(boardId, {
            tripName: board.tripName,
            groupId: board.groupId,
            role: 'participant',
          });
        } catch (err) {
          console.error(err);
        }
        renderBoard(app, board);
        return;
      }
    }
  }

  renderJoin(app, board, {
    onJoined: async (name) => {
      try {
        await store.rememberBoard(boardId, {
          tripName: board.tripName,
          groupId: board.groupId,
          role: 'participant',
        });
      } catch (err) {
        console.error(err);
      }
      renderBoard(app, board);
    },
  });
}

async function handleCreateGroupBoard(groupId) {
  renderLoading(app, 'Cargando grupo…');
  const store = await getStore();
  let group = null;
  try {
    group = await store.getGroup(groupId);
  } catch (err) {
    console.error(err);
    renderMessageScreen(app, {
      eyebrow: 'ERROR DE CONEXIÓN',
      title: 'No se pudo cargar el grupo',
      message: 'Revisa tu conexión e inténtalo de nuevo.',
      linkHref: appUrl(),
      linkLabel: 'Ir al inicio',
    });
    return;
  }
  if (!group) {
    renderGroupNotFound();
    return;
  }
  renderSetup(app, { group: { ...group, groupId } });
}

/** once(subscribe) espera el primer valor de un subscribe*(cb) -> unsubscribe() y se desuscribe.
 *  ⚠️ tanto local-store (síncrono) como firestore-store (onSnapshot, asíncrono) emiten el primer
 *  valor DESPUÉS de que se registre el callback pero potencialmente antes de que `subscribe(...)`
 *  termine de devolver la función unsubscribe, así que no se puede referenciar `unsubscribe` dentro
 *  del propio callback de esa primera llamada. Se aplaza la desuscripción a un microtask. */
function once(subscribe) {
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe = () => {};
    unsubscribe = subscribe((value) => {
      if (settled) return;
      settled = true;
      resolve(value);
      queueMicrotask(() => unsubscribe());
    });
  });
}

function renderBoardNotFound({ networkError }) {
  renderMessageScreen(app, {
    eyebrow: networkError ? 'ERROR DE CONEXIÓN' : 'TABLERO NO ENCONTRADO',
    title: networkError ? 'No se pudo cargar el tablero' : 'Este enlace no existe',
    message: networkError
      ? 'Revisa tu conexión e inténtalo de nuevo.'
      : 'Puede que el enlace esté mal copiado o que el tablero se haya borrado.',
    linkHref: location.pathname,
    linkLabel: 'Ir al inicio',
  });
}

function renderGroupNotFound() {
  renderMessageScreen(app, {
    eyebrow: 'GRUPO NO ENCONTRADO',
    title: 'Este enlace no existe',
    message: 'Puede que el enlace esté mal copiado.',
    linkHref: location.pathname,
    linkLabel: 'Ir al inicio',
  });
}

window.addEventListener('popstate', () => location.reload());

main().catch((err) => {
  console.error(err);
  renderMessageScreen(app, {
    eyebrow: 'ERROR DE CONEXIÓN',
    title: 'No se pudo cargar la app',
    message: 'Revisa tu conexión e inténtalo de nuevo.',
    linkHref: location.pathname,
    linkLabel: 'Ir al inicio',
  });
});
