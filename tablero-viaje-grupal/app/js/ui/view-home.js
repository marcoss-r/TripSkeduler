// Pantalla de inicio (Fase 8): "mis viajes" + "mis grupos" + crear.
//
// Los índices `users/{uid}/boards` y `users/{uid}/groups` son denormalizados
// (ver PLAN-DESARROLLO.md, sección 3): se escriben al crear/unirse, y pueden
// quedar desincronizados si el original se borró. Para los tableros sí hay
// forma de limpiarlo (`forgetBoard`); para grupos no existe un `forgetGroup`
// en la interfaz (los grupos no se borran en este plan), así que una entrada
// rota simplemente se omite al listar, sin tocar el índice.

import { getStore } from '../data/store.js';
import { el, renderErrorBanner, renderInfoBanner, escapeHtml, appUrl } from './components.js';

export async function renderHome(app) {
  app.innerHTML = '';
  app.appendChild(el('<div class="loading">Cargando…</div>'));

  const store = await getStore();
  const profile = await store.getProfile().catch(() => null);
  const isFirestore = store.kind === 'firestore';
  const authInfo = isFirestore ? store.getAuthInfo() : null;

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

      <div id="accountSlot"></div>
    </div>`);
  app.innerHTML = '';
  app.appendChild(view);

  view.querySelector('#newBoardBtn').addEventListener('click', () => {
    location.href = appUrl('crear=1');
  });
  view.querySelector('#newGroupBtn').addEventListener('click', () => {
    renderCreateGroupForm(view.querySelector('#createGroupSlot'), store, profile);
  });

  renderAccountSection(view.querySelector('#accountSlot'), store, { isFirestore, authInfo });

  // Si el botón de Google cayó al fallback de `linkWithRedirect` (popup
  // bloqueado) mientras se estaba en otra pantalla, el resultado real llega
  // aquí, al volver de Google — inicio es el sitio más probable donde
  // aterriza esa vuelta. Ver también view-join.js, que hace lo mismo por si
  // el redirect se disparó desde la pantalla de "¿cómo te llamas?".
  if (isFirestore) {
    const redirectOutcome = store.consumeGoogleRedirectOutcome();
    if (redirectOutcome && redirectOutcome.ok) {
      view
        .querySelector('#bannerSlot')
        .appendChild(
          renderInfoBanner(
            redirectOutcome.merged
              ? 'Esa cuenta de Google ya estaba vinculada en otro dispositivo. Has entrado con ella.'
              : 'Cuenta de Google vinculada.'
          )
        );
    } else if (redirectOutcome && !redirectOutcome.ok) {
      view.querySelector('#bannerSlot').appendChild(renderErrorBanner('No se pudo completar la conexión con Google.'));
    }
  }

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

function renderAccountSection(slot, store, { isFirestore, authInfo }) {
  slot.innerHTML = '';

  if (!isFirestore) {
    slot.appendChild(
      el('<p class="footNote">Estos viajes se guardan en este navegador (modo local de desarrollo).</p>')
    );
    return;
  }

  if (!authInfo.isAnonymous) {
    const box = el(`<div class="panel" style="margin-top:24px;">
      <div class="sub" style="margin:0;">Sesión iniciada con Google${authInfo.email ? `: <strong>${escapeHtml(authInfo.email)}</strong>` : ''}. Tus viajes están disponibles en todos tus dispositivos.</div>
      <button type="button" class="ghost small" id="signOutBtn" style="align-self:flex-start;">Cerrar sesión</button>
    </div>`);
    box.querySelector('#signOutBtn').addEventListener('click', async () => {
      if (!confirm('¿Cerrar sesión? Volverás a un perfil anónimo nuevo en este navegador.')) return;
      try {
        await store.signOutToAnonymous();
        location.reload();
      } catch (err) {
        console.error(err);
        slot.appendChild(renderErrorBanner('No se pudo cerrar sesión. Inténtalo de nuevo.'));
      }
    });
    slot.appendChild(box);
    return;
  }

  const box = el(`<div class="panel" style="margin-top:24px;">
    <div class="sub" style="margin:0;">Estos viajes se guardan en este navegador. Entra con Google para tenerlos en todos tus dispositivos.</div>
    <button type="button" class="ghost small" id="linkGoogleBtn" style="align-self:flex-start;">Continuar con Google</button>
  </div>`);
  box.querySelector('#linkGoogleBtn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Conectando con Google…';
    try {
      const result = await store.linkGoogleAccount();
      if (result.pending) return; // linkWithRedirect: vuelve tras navegar a Google
      if (result.cancelled) {
        btn.disabled = false;
        btn.textContent = 'Continuar con Google';
        return;
      }
      if (!result.ok) throw new Error('linkGoogleAccount failed');
      location.reload(); // uid puede haber cambiado (caso "merged"); recarga limpia mis viajes/grupos
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      btn.textContent = 'Continuar con Google';
      slot.appendChild(renderErrorBanner('No se pudo conectar con Google. Inténtalo de nuevo.'));
    }
  });
  slot.appendChild(box);
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
