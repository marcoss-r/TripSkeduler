// Pantalla de inicio (Fase 8): "mis viajes" + "mis grupos" + crear.
//
// Los índices `users/{uid}/boards` y `users/{uid}/groups` son denormalizados
// (ver PLAN-DESARROLLO.md, sección 3): se escriben al crear/unirse, y pueden
// quedar desincronizados si el original se borró. Para los tableros sí hay
// forma de limpiarlo (`forgetBoard`); para grupos no existe un `forgetGroup`
// en la interfaz (los grupos no se borran en este plan), así que una entrada
// rota simplemente se omite al listar, sin tocar el índice.

import { getStore } from '../data/store.js';
import { el, renderErrorBanner, escapeHtml, appUrl } from './components.js';

export async function renderHome(app) {
  app.innerHTML = '';
  app.appendChild(el('<div class="loading">Cargando…</div>'));

  const store = await getStore();
  const profile = await store.getProfile().catch(() => null);

  const [boards, groups] = await Promise.all([loadMyBoards(store), loadMyGroups(store)]);

  const view = el(`
    <div class="wrap">
      <div class="eyebrow">TABLERO DE SALIDAS</div>
      <h1>Tus viajes</h1>
      <p class="sub">Crea un tablero suelto o un grupo permanente para no volver a escribir los nombres de siempre.</p>
      <div class="homeActions">
        <button type="button" id="newBoardBtn">Crear viaje</button>
        <button type="button" class="ghost" id="newGroupBtn">Crear grupo</button>
      </div>
      <div id="createGroupSlot"></div>
      <div id="bannerSlot"></div>

      <section class="listSection">
        <h2>Mis viajes</h2>
        <div class="listRows" id="boardRows"></div>
      </section>

      <section class="listSection">
        <h2>Mis grupos</h2>
        <div class="listRows" id="groupRows"></div>
      </section>

      <p class="footNote">Estos viajes se guardan en este navegador. Entra con Google para tenerlos en todos tus dispositivos (próximamente).</p>
    </div>`);
  app.innerHTML = '';
  app.appendChild(view);

  view.querySelector('#newBoardBtn').addEventListener('click', () => {
    location.href = appUrl('crear=1');
  });
  view.querySelector('#newGroupBtn').addEventListener('click', () => {
    renderCreateGroupForm(view.querySelector('#createGroupSlot'), store, profile);
  });

  const boardRows = view.querySelector('#boardRows');
  if (boards.length === 0) {
    boardRows.appendChild(el('<p class="emptyState">Todavía no tienes ningún viaje. Crea uno arriba.</p>'));
  } else {
    for (const b of boards) {
      boardRows.appendChild(
        el(`<a class="listRow" href="${appUrl(`b=${encodeURIComponent(b.boardId)}`)}">
          <span class="listRowTitle">${escapeHtml(b.tripName || 'Viaje')}</span>
          <span class="listRowMeta">${b.groupId ? 'De grupo' : 'Suelto'} · ${b.role === 'owner' ? 'creador' : 'participante'}</span>
        </a>`)
      );
    }
  }

  const groupRows = view.querySelector('#groupRows');
  if (groups.length === 0) {
    groupRows.appendChild(el('<p class="emptyState">Todavía no perteneces a ningún grupo.</p>'));
  } else {
    for (const g of groups) {
      groupRows.appendChild(
        el(`<a class="listRow" href="${appUrl(`g=${encodeURIComponent(g.groupId)}`)}">
          <span class="listRowTitle">${escapeHtml(g.name || 'Grupo')}</span>
          <span class="listRowMeta">Ver grupo →</span>
        </a>`)
      );
    }
  }
}

function renderCreateGroupForm(slot, store, profile) {
  slot.innerHTML = '';
  const form = el(`
    <form class="panel" id="createGroupForm">
      <label>Nombre del grupo
        <input type="text" name="groupName" placeholder="Los de siempre" required maxlength="60">
      </label>
      <label>Tu nombre
        <input type="text" name="displayName" placeholder="Ana" required maxlength="40" value="${escapeHtml(profile?.displayName || '')}">
      </label>
      <div class="ownerBarActions">
        <button type="submit">Crear grupo</button>
        <button type="button" class="ghost" id="cancelCreateGroup">Cancelar</button>
      </div>
    </form>`);
  slot.appendChild(form);

  form.querySelector('#cancelCreateGroup').addEventListener('click', () => {
    slot.innerHTML = '';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const groupName = f.groupName.value.trim();
    const displayName = f.displayName.value.trim();
    if (!groupName || !displayName) return;

    const submitBtn = form.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creando…';

    try {
      await store.saveProfile({ displayName });
      const groupId = await store.createGroup({ name: groupName });
      await store.joinGroup(groupId, { name: displayName });
      location.href = appUrl(`g=${encodeURIComponent(groupId)}`);
    } catch (err) {
      console.error(err);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Crear grupo';
      form.prepend(renderErrorBanner('No se pudo crear el grupo. Inténtalo de nuevo.'));
    }
  });
}

async function loadMyBoards(store) {
  let boards = [];
  try {
    boards = await store.listMyBoards();
  } catch (err) {
    console.error(err);
    return [];
  }

  const checked = await Promise.all(
    boards.map(async (b) => {
      try {
        const exists = await store.getBoard(b.boardId);
        return { ...b, exists: Boolean(exists) };
      } catch {
        return { ...b, exists: true }; // error de red: no lo damos por borrado
      }
    })
  );

  for (const b of checked) {
    if (!b.exists) store.forgetBoard(b.boardId).catch(() => {});
  }

  return checked
    .filter((b) => b.exists)
    .sort((a, b) => (b.savedAt?.toMillis?.() ?? b.savedAt ?? 0) - (a.savedAt?.toMillis?.() ?? a.savedAt ?? 0));
}

async function loadMyGroups(store) {
  let groups = [];
  try {
    groups = await store.listMyGroups();
  } catch (err) {
    console.error(err);
    return [];
  }

  const checked = await Promise.all(
    groups.map(async (g) => {
      try {
        const exists = await store.getGroup(g.groupId);
        return { ...g, exists: Boolean(exists) };
      } catch {
        return { ...g, exists: true };
      }
    })
  );

  return checked
    .filter((g) => g.exists)
    .sort((a, b) => (b.savedAt?.toMillis?.() ?? b.savedAt ?? 0) - (a.savedAt?.toMillis?.() ?? a.savedAt ?? 0));
}
