// Vista de grupo (Fase 9): nombre, miembros, viajes del grupo, unirse.
//
// Los miembros se suscriben en tiempo real (subscribeMembers) igual que las
// respuestas de un tablero, para que un tercero vea entrar a alguien nuevo
// sin recargar. Los viajes del grupo (listGroupBoards) se piden una sola vez
// al entrar: la interfaz de la Fase 2 no define un `subscribeGroupBoards`, y
// no hace falta tiempo real ahí (crear un viaje nuevo navega a otra URL).

import { getStore } from '../data/store.js';
import {
  el,
  renderErrorBanner,
  renderMessageScreen,
  escapeHtml,
  appUrl,
  renderShareBox,
  shareableUrl,
} from './components.js';

export async function renderGroup(app, groupId) {
  app.innerHTML = '';
  app.appendChild(el('<div class="loading">Cargando grupo…</div>'));

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
    renderMessageScreen(app, {
      eyebrow: 'GRUPO NO ENCONTRADO',
      title: 'Este enlace no existe',
      message: 'Puede que el enlace esté mal copiado.',
      linkHref: appUrl(),
      linkLabel: 'Ir al inicio',
    });
    return;
  }

  const myUid = await store.getMyId();
  const isOwner = group.ownerUid === myUid;
  const groupUrl = shareableUrl(`g=${encodeURIComponent(groupId)}`);

  let members = [];
  let gotFirstSnapshot = false;
  let editingName = false;
  let busy = false;
  let transientError = null;

  const unsubscribe = store.subscribeMembers(groupId, (m) => {
    members = m;
    gotFirstSnapshot = true;
    draw();
  });
  const previousCleanup = app._viewGroupCleanup;
  if (previousCleanup) previousCleanup();
  app._viewGroupCleanup = () => unsubscribe();

  async function onJoinSubmit(e) {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    const submitBtn = e.target.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Entrando…';
    try {
      await store.saveProfile({ displayName: name });
      await store.joinGroup(groupId, { name });
    } catch (err) {
      console.error(err);
      transientError = 'No se pudo entrar al grupo. Inténtalo de nuevo.';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Entrar al grupo';
      draw();
    }
  }

  async function onLeaveGroup() {
    if (!confirm(`¿Salir de "${group.name}"?`)) return;
    busy = true;
    draw();
    try {
      await store.leaveGroup(groupId);
      location.href = appUrl();
    } catch (err) {
      console.error(err);
      transientError = 'No se pudo salir del grupo. Inténtalo de nuevo.';
      busy = false;
      draw();
    }
  }

  async function onRemoveMember(uid, name) {
    if (!confirm(`¿Expulsar a ${name} del grupo?`)) return;
    busy = true;
    draw();
    try {
      await store.removeMember(groupId, uid);
      transientError = null;
    } catch (err) {
      console.error(err);
      transientError = `No se pudo expulsar a ${name}. Inténtalo de nuevo.`;
    } finally {
      busy = false;
      draw();
    }
  }

  function toggleEditName() {
    editingName = !editingName;
    draw();
  }

  async function onRenameSubmit(e) {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    busy = true;
    draw();
    try {
      await store.updateGroup(groupId, { name });
      group.name = name;
      editingName = false;
      transientError = null;
    } catch (err) {
      console.error(err);
      transientError = 'No se pudo renombrar el grupo. Inténtalo de nuevo.';
    } finally {
      busy = false;
      draw();
    }
  }

  function draw() {
    if (!gotFirstSnapshot) return;

    const myMembership = members.find((m) => m.uid === myUid);

    app.innerHTML = '';
    const view = el(`
      <div class="wrap">
        <div class="eyebrow">GRUPO</div>
        <div id="titleSlot"></div>
        <div id="bannerSlot"></div>
        ${myMembership ? '<div id="shareSlot" style="margin-bottom:24px;"></div>' : ''}
        <div id="bodySlot"></div>
      </div>`);
    app.appendChild(view);

    if (myMembership) {
      view.querySelector('#shareSlot').appendChild(renderShareBox(groupUrl));
    }

    if (transientError) {
      view.querySelector('#bannerSlot').appendChild(renderErrorBanner(transientError));
    }

    const titleSlot = view.querySelector('#titleSlot');
    if (isOwner && myMembership) {
      if (editingName) {
        const form = el(`<form class="row2" id="renameForm" style="margin-bottom:16px;align-items:flex-end;">
          <label style="grid-column:1/2;">Nombre del grupo<input type="text" name="name" value="${escapeHtml(group.name)}" required maxlength="60"></label>
          <div style="display:flex;gap:8px;">
            <button type="submit" ${busy ? 'disabled' : ''}>Guardar</button>
            <button type="button" class="ghost" id="cancelRename" ${busy ? 'disabled' : ''}>Cancelar</button>
          </div>
        </form>`);
        form.addEventListener('submit', onRenameSubmit);
        form.querySelector('#cancelRename').addEventListener('click', () => {
          transientError = null;
          toggleEditName();
        });
        titleSlot.appendChild(form);
      } else {
        const h = el(`<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <h1 style="margin-bottom:0;">${escapeHtml(group.name)}</h1>
          <button type="button" class="ghost small" id="editNameBtn">Renombrar</button>
        </div>`);
        h.querySelector('#editNameBtn').addEventListener('click', toggleEditName);
        titleSlot.appendChild(h);
      }
    } else {
      titleSlot.appendChild(el(`<h1>${escapeHtml(group.name)}</h1>`));
    }

    const bodySlot = view.querySelector('#bodySlot');
    if (!myMembership) {
      bodySlot.appendChild(el(`<p class="sub">Únete a este grupo para ver sus viajes y aparecer en la lista de miembros.</p>`));
      const form = el(`<form class="panel" id="joinGroupForm">
        <label>Tu nombre<input type="text" name="name" placeholder="Ana" required maxlength="40"></label>
        <button type="submit">Entrar al grupo</button>
      </form>`);
      form.addEventListener('submit', onJoinSubmit);
      bodySlot.appendChild(form);
      return;
    }

    bodySlot.appendChild(renderBoardsSection(store, groupId));
    bodySlot.appendChild(
      renderMembersSection(members, { myUid, isOwner, busy, onRemove: onRemoveMember })
    );

    const leaveBtn = el(`<button type="button" class="ghost small" style="margin-top:20px;" ${busy ? 'disabled' : ''}>Salir del grupo</button>`);
    leaveBtn.addEventListener('click', onLeaveGroup);
    bodySlot.appendChild(leaveBtn);
  }
}

function renderBoardsSection(store, groupId) {
  const section = el(`<section class="listSection">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
      <h2>Viajes del grupo</h2>
      <button type="button" class="ghost small" id="newGroupBoardBtn">Crear viaje con este grupo</button>
    </div>
    <div class="listRows" id="groupBoardRows"><div class="loading" style="padding:16px 0;">Cargando viajes…</div></div>
  </section>`);

  section.querySelector('#newGroupBoardBtn').addEventListener('click', () => {
    location.href = appUrl(`g=${encodeURIComponent(groupId)}&crear=1`);
  });

  store
    .listGroupBoards(groupId)
    .then((boards) => {
      const rows = section.querySelector('#groupBoardRows');
      rows.innerHTML = '';
      if (boards.length === 0) {
        rows.appendChild(el('<p class="emptyState">Todavía no hay ningún viaje en este grupo.</p>'));
        return;
      }
      for (const b of boards) {
        rows.appendChild(
          el(`<a class="listRow" href="${appUrl(`b=${encodeURIComponent(b.boardId)}`)}">
            <span class="listRowTitle">${escapeHtml(b.tripName || 'Viaje')}</span>
            <span class="listRowMeta">${escapeHtml(b.startDate)} → ${escapeHtml(b.endDate)}</span>
          </a>`)
        );
      }
    })
    .catch((err) => {
      console.error(err);
      const rows = section.querySelector('#groupBoardRows');
      rows.innerHTML = '';
      rows.appendChild(renderErrorBanner('No se pudieron cargar los viajes del grupo.'));
    });

  return section;
}

function renderMembersSection(members, { myUid, isOwner, busy, onRemove }) {
  const section = el(`<section class="listSection">
    <h2>Miembros</h2>
    <div class="roster" id="memberRows"></div>
  </section>`);
  const rows = section.querySelector('#memberRows');
  for (const m of members) {
    const isMine = m.uid === myUid;
    const row = el(`<div class="rosterRow ${isMine ? 'mine' : ''}">
      <span class="rosterName ${isMine ? 'mine' : ''}">${escapeHtml(m.name)}${isMine ? ' (tú)' : ''}</span>
      ${isOwner && !isMine ? '<button type="button" class="ghost small danger removeBtn" ' + (busy ? 'disabled' : '') + '>Expulsar</button>' : ''}
    </div>`);
    if (isOwner && !isMine) {
      row.querySelector('.removeBtn').addEventListener('click', () => onRemove(m.uid, m.name));
    }
    rows.appendChild(row);
  }
  return section;
}
