// Vista del tablero: calendario + mejor ventana + lista de participantes.
//
// v2 (tras feedback): la v1 mostraba una única tira horizontal de casillas
// de 64px, una por día — ilegible en cuanto el rango pasaba de 2-3 semanas
// y directamente inusable en móvil. Se sustituye por un calendario real:
// un bloque por mes, semanas de lunes a domingo en una rejilla de 7
// columnas. Al ser siempre 7 columnas, cabe en cualquier ancho de pantalla
// sin scroll horizontal, tanto con 5 días como con 180 (el máximo).
//
// Cada casilla del calendario es a la vez la superficie de edición de MI
// disponibilidad (color = mi estado, clic para ciclar) y un vistazo rápido
// al grupo (badge con la puntuación agregada, borde si cae en la mejor
// ventana). El detalle por persona se ofrece aparte en una lista compacta
// (roster), porque un calendario completo por participante no escala con
// grupos grandes ni con rangos largos.
//
// Acciones de creador (Fase 5): visibles solo si `ownerUid === miUid`.
// Editar nombre/fechas y borrar un participante reutilizan updateBoard /
// deleteResponse de la interfaz de store; borrar el tablero pide
// confirmación doble (dos `confirm()` con mensajes distintos) por ser
// irreversible y afectar a todo el grupo, no solo a quien pulsa el botón.
//
// Backlog (Fase 12), añadido a petición explícita:
// - "Marcar rango" arrastrando: mousedown en un día + arrastrar + soltar
//   pinta todo el rango recorrido con el mismo estado (el siguiente en el
//   ciclo respecto al día donde empezó el arrastre). Un simple clic sin
//   arrastrar es un caso particular (rango de un solo día) — es el mismo
//   mecanismo de antes, no un modo aparte. Solo con ratón: en móvil no hay
//   `mouseenter` al arrastrar el dedo, así que ahí se sigue tocando día a
//   día (los eventos de ratón "sintéticos" que sí dispara un tap dan un
//   rango de 1 día, o sea el ciclo normal).
// - Ponderar participantes: el dueño puede marcar a alguien como "cuenta
//   doble" (`board.weights[uid] = 2`); solo afecta a la puntuación de
//   `computeScores`, nunca al desglose de disponibilidad por persona.
// - Top-3 ventanas alternativas (topWindows, ya existía en scoring.js):
//   se muestran las dos siguientes mejores ventanas no solapadas con la
//   principal.

import { getStore } from '../data/store.js';
import { dateRangeArray, isValidRange, MAX_RANGE_DAYS, monthShort, dayNum, groupByMonth, mondayIndex } from '../core/dates.js';
import { computeScores, bestWindow, topWindows } from '../core/scoring.js';
import { el, debounce, renderErrorBanner, appUrl } from './components.js';

// Orden del ciclo al hacer clic: empieza en "no definido" (el estado por
// defecto de un día sin marcar) y va de más a menos disponible, terminando
// en "no disponible" explícito antes de volver a "no definido" — así se
// puede tanto marcar un día como "des-marcarlo" del todo.
const STATUS_ORDER = ['none', 'full', 'partial', 'unavailable'];
const STATUS_LABEL = {
  none: 'No definido',
  full: 'Disponible',
  partial: 'Parcial',
  unavailable: 'No disponible',
};
const WEEKDAYS_MON_FIRST = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const MONTHS_LONG_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export async function renderBoard(app, board) {
  const store = await getStore();
  const boardId = board.boardId;
  let dates = dateRangeArray(board.startDate, board.endDate); // recalculada si el creador edita las fechas
  const myUid = await store.getMyId();
  const isOwner = board.ownerUid === myUid;

  let responses = [];
  let groupMembers = null; // solo si board.groupId; sirve para "quién falta por responder" (Fase 9)
  let weights = { ...(board.weights || {}) }; // uid -> 2 si "cuenta doble" (backlog Fase 12); ausente = 1
  let pendingDays = null; // override optimista de mis propios días mientras el guardado está en curso
  let saving = false;
  let gotFirstSnapshot = false;
  let transientError = null;
  let editingBoard = false;
  let boardBusy = false; // deshabilita las acciones de creador mientras hay una escritura en curso

  // Estado del arrastre "marcar rango" (backlog Fase 12) — ver la nota del
  // encabezado del fichero.
  let dragging = false;
  let dragBaseDays = null; // mis días ANTES de empezar el arrastre actual
  let dragStartIdx = null;
  let dragCurrentIdx = null;
  let dragStatus = null;

  app.innerHTML = '';
  app.appendChild(el('<div class="loading">Cargando tablero…</div>'));

  const scheduleSave = debounce(async (name, days) => {
    saving = true;
    draw();
    try {
      await store.saveMyResponse(boardId, { name, days });
      transientError = null;
    } catch (err) {
      console.error(err);
      transientError = 'No se pudo guardar tu disponibilidad. Vuelve a marcar el último día.';
    } finally {
      saving = false;
      pendingDays = null; // ya coincide con lo persistido, o se reintentará con el próximo clic
      draw();
    }
  }, 400);

  function myResponse() {
    return responses.find((r) => r.uid === myUid) || { uid: myUid, name: '', days: {} };
  }

  function myDays() {
    return pendingDays ?? myResponse().days ?? {};
  }

  function effectiveResponses() {
    if (pendingDays === null) return responses;
    const mine = responses.find((r) => r.uid === myUid);
    if (!mine) return responses;
    return responses.map((r) => (r.uid === myUid ? { ...r, days: pendingDays } : r));
  }

  /** `currentResponses` con el campo `weight` añadido, solo para pasar a computeScores (backlog: ponderar participantes). */
  function weightedResponses(currentResponses) {
    return currentResponses.map((r) => ({ ...r, weight: weights[r.uid] || 1 }));
  }

  const unsubscribe = store.subscribeResponses(boardId, (r) => {
    responses = r;
    gotFirstSnapshot = true;
    draw();
  });
  const unsubscribeMembers = board.groupId
    ? store.subscribeMembers(board.groupId, (m) => {
        groupMembers = m;
        draw();
      })
    : null;

  // Si el router vuelve a renderizar el tablero sobre el mismo #app (no
  // debería pasar en el flujo normal de main.js, pero es una salvaguarda
  // barata), se limpia la suscripción anterior antes de dejar activa la
  // nueva.
  window.addEventListener('mouseup', onDragEnd);

  const previousCleanup = app._viewBoardCleanup;
  if (previousCleanup) previousCleanup();
  app._viewBoardCleanup = () => {
    unsubscribe();
    if (unsubscribeMembers) unsubscribeMembers();
    window.removeEventListener('mouseup', onDragEnd);
  };

  // --- "marcar rango" arrastrando (backlog Fase 12) --------------------------
  //
  // dragStart fija, sobre el día donde empieza el arrastre, cuál es el
  // "siguiente estado" a aplicar (mismo ciclo que un clic normal) y lo
  // recuerda en dragStatus para todo el arrastre — así se pinta el rango
  // entero con UN estado, no se re-cicla casilla a casilla. dragEnter va
  // recalculando el rango [inicio, actual] sobre el índice en `dates` (no
  // sobre el orden en que el ratón disparó los eventos), para no perder
  // días si el cursor se mueve rápido y se salta alguna casilla. Un clic
  // simple es el caso degenerado: mousedown+mouseup sin ningún mouseenter
  // de por medio, rango de longitud 1 — el mismo resultado que el ciclo de
  // toda la vida.

  function dragRangeDates() {
    const lo = Math.min(dragStartIdx, dragCurrentIdx);
    const hi = Math.max(dragStartIdx, dragCurrentIdx);
    return dates.slice(lo, hi + 1);
  }

  function applyDragPreview() {
    const updated = { ...dragBaseDays };
    for (const d of dragRangeDates()) updated[d] = dragStatus;
    pendingDays = updated;
  }

  function onDragStart(day) {
    if (dragging) return;
    dragging = true;
    dragBaseDays = { ...myDays() };
    dragStartIdx = dates.indexOf(day);
    dragCurrentIdx = dragStartIdx;
    const current = dragBaseDays[day] || 'none';
    dragStatus = STATUS_ORDER[(STATUS_ORDER.indexOf(current) + 1) % STATUS_ORDER.length];
    applyDragPreview();
    draw();
  }

  function onDragEnter(day) {
    if (!dragging) return;
    const idx = dates.indexOf(day);
    // Guarda importante: draw() destruye y reconstruye todas las casillas,
    // así que el navegador vuelve a disparar `mouseenter` sobre la casilla
    // recién creada que queda bajo un cursor que ni se ha movido — sin este
    // corte de caso ("misma casilla que ya teníamos") eso realimenta un
    // draw() tras otro sin fin (comprobado con Playwright: el calendario
    // quedaba redibujándose para siempre en cuanto empezaba un arrastre).
    if (idx === dragCurrentIdx) return;
    dragCurrentIdx = idx;
    applyDragPreview();
    draw();
  }

  function onDragEnd() {
    if (!dragging) return;
    dragging = false;
    const finalDays = pendingDays;
    dragBaseDays = null;
    dragStartIdx = null;
    dragCurrentIdx = null;
    dragStatus = null;
    scheduleSave(myResponse().name, finalDays);
  }

  function toggleEditBoard() {
    editingBoard = !editingBoard;
    draw();
  }

  async function onEditBoardSubmit(e) {
    e.preventDefault();
    const f = e.target;
    const tripName = f.tripName.value.trim() || board.tripName;
    const startDate = f.startDate.value;
    const endDate = f.endDate.value;

    const rangeCheck = isValidRange(startDate, endDate);
    if (!rangeCheck.ok) {
      transientError =
        rangeCheck.reason === 'end-before-start'
          ? 'La fecha "Hasta" debe ser posterior (o igual) a "Desde".'
          : `El rango de fechas es demasiado largo (máximo ${MAX_RANGE_DAYS} días).`;
      draw();
      return;
    }
    const newRangeLength = dateRangeArray(startDate, endDate).length;
    if (newRangeLength < board.tripLength) {
      transientError = `El nuevo rango (${newRangeLength} días) es más corto que la duración del viaje (${board.tripLength} días).`;
      draw();
      return;
    }

    boardBusy = true;
    draw();
    try {
      await store.updateBoard(boardId, { tripName, startDate, endDate });
      board.tripName = tripName;
      board.startDate = startDate;
      board.endDate = endDate;
      dates = dateRangeArray(startDate, endDate);
      transientError = null;
      editingBoard = false;
    } catch (err) {
      console.error(err);
      transientError = 'No se pudo guardar el cambio. Inténtalo de nuevo.';
    } finally {
      boardBusy = false;
      draw();
    }
  }

  async function onDeleteBoard() {
    if (!confirm(`¿Seguro que quieres borrar "${board.tripName}"? Se perderán todas las respuestas del grupo.`)) return;
    if (!confirm('Esta acción no se puede deshacer. ¿Borrar el tablero definitivamente?')) return;

    boardBusy = true;
    draw();
    try {
      await store.deleteBoard(boardId);
      location.href = appUrl();
    } catch (err) {
      console.error(err);
      transientError = 'No se pudo borrar el tablero. Inténtalo de nuevo.';
      boardBusy = false;
      draw();
    }
  }

  /** Ponderar participantes (backlog Fase 12): alterna entre peso 1 y 2 ("cuenta doble") para un participante. */
  async function onToggleWeight(uid) {
    const next = (weights[uid] || 1) === 2 ? 1 : 2;
    const updated = { ...weights };
    if (next === 1) delete updated[uid]; // no acumular basura: ausente == 1
    else updated[uid] = next;

    const previous = weights;
    weights = updated;
    boardBusy = true;
    draw();
    try {
      await store.updateBoard(boardId, { weights: updated });
      transientError = null;
    } catch (err) {
      console.error(err);
      weights = previous;
      transientError = 'No se pudo actualizar la ponderación. Inténtalo de nuevo.';
    } finally {
      boardBusy = false;
      draw();
    }
  }

  async function onRemoveParticipant(uid, name) {
    if (!confirm(`¿Quitar a ${name} del tablero? Perderá su disponibilidad marcada.`)) return;

    boardBusy = true;
    draw();
    try {
      await store.deleteResponse(boardId, uid);
      transientError = null;
    } catch (err) {
      console.error(err);
      transientError = `No se pudo quitar a ${name}. Inténtalo de nuevo.`;
    } finally {
      boardBusy = false;
      draw();
    }
  }

  function draw() {
    if (!gotFirstSnapshot) return; // se queda con el "Cargando tablero…" hasta el primer snapshot

    const currentResponses = effectiveResponses();
    const { scores, breakdown } = computeScores(dates, weightedResponses(currentResponses));
    const best = bestWindow(dates, scores, breakdown, board.tripLength);
    const top = topWindows(dates, scores, breakdown, board.tripLength, 3);

    app.innerHTML = '';
    const container = el(`<div class="wrap wide">
      <div class="boardNav">
        <a href="${appUrl()}">← Mis viajes</a>
        ${board.groupId ? `<a href="${appUrl(`g=${encodeURIComponent(board.groupId)}`)}">← Grupo</a>` : ''}
      </div>
      <div class="boardHeader">
        <div>
          <div class="eyebrow">${escapeHtml(board.tripName.toUpperCase())}</div>
          <h1>Tablero de disponibilidad</h1>
        </div>
        <div>
          <div class="sub" style="margin-bottom:4px;">Eres <strong>${escapeHtml(myResponse().name)}</strong></div>
          <span class="savingIndicator ${saving ? 'visible' : ''}">${saving ? 'Guardando…' : ''}</span>
        </div>
      </div>
      ${isOwner ? '<div id="ownerSlot"></div>' : ''}
      <div id="bannerSlot"></div>
      <div id="pendingSlot"></div>
      <div class="legend">
        <span><i class="dot full"></i>Disponible</span>
        <span><i class="dot partial"></i>Parcial</span>
        <span><i class="dot unavailable"></i>No disponible</span>
        <span><i class="dot none"></i>No definido</span>
        <span>· el número bajo cada día es la puntuación del grupo · arrastra sobre varios días para marcarlos a la vez</span>
      </div>
      <div class="calendar"></div>
      <div class="bestBox"></div>
      <div class="altWindows"></div>
      <div class="roster"></div>
      ${store.kind === 'local'
        ? '<p class="footNote">Estos datos se guardan en este navegador (modo local de desarrollo) mientras no se conecte un backend real.</p>'
        : ''}
    </div>`);
    app.appendChild(container);

    if (isOwner) {
      drawOwnerBar(container.querySelector('#ownerSlot'));
    }
    if (transientError) {
      container.querySelector('#bannerSlot').appendChild(renderErrorBanner(transientError));
    }
    if (responses.length === 0) {
      container
        .querySelector('#bannerSlot')
        .appendChild(el('<div class="banner info">Aún no hay ninguna respuesta en este tablero.</div>'));
    }

    if (board.groupId && groupMembers) {
      const missing = groupMembers.filter((m) => !currentResponses.some((r) => r.uid === m.uid));
      if (missing.length > 0) {
        container
          .querySelector('#pendingSlot')
          .appendChild(
            el(
              `<div class="banner info">Pendientes de responder: ${missing.map((m) => escapeHtml(m.name)).join(', ')}.</div>`
            )
          );
      }
    }

    drawCalendar(container.querySelector('.calendar'), { dates, scores, breakdown, best });
    drawBestBox(container.querySelector('.bestBox'), { best, responses: currentResponses });
    drawAlternatives(container.querySelector('.altWindows'), { top });
    drawRoster(container.querySelector('.roster'), { dates, responses: currentResponses, myUid });
  }

  function drawOwnerBar(ownerSlot) {
    if (editingBoard) {
      const form = el(`<form class="panel ownerEditForm">
        <label>Nombre del viaje
          <input type="text" name="tripName" value="${escapeHtml(board.tripName)}" required maxlength="80">
        </label>
        <div class="row2">
          <label>Desde<input type="date" name="startDate" value="${board.startDate}" required></label>
          <label>Hasta<input type="date" name="endDate" value="${board.endDate}" required></label>
        </div>
        <div class="ownerBarActions">
          <button type="submit" ${boardBusy ? 'disabled' : ''}>${boardBusy ? 'Guardando…' : 'Guardar cambios'}</button>
          <button type="button" class="ghost" id="cancelEditBtn" ${boardBusy ? 'disabled' : ''}>Cancelar</button>
        </div>
      </form>`);
      form.addEventListener('submit', onEditBoardSubmit);
      form.querySelector('#cancelEditBtn').addEventListener('click', () => {
        transientError = null;
        toggleEditBoard();
      });
      ownerSlot.appendChild(form);
      return;
    }

    const bar = el(`<div class="ownerBar">
      <span class="ownerBarLabel">Eres el creador de este tablero</span>
      <div class="ownerBarActions">
        <button type="button" class="ghost small" id="editBoardBtn" ${boardBusy ? 'disabled' : ''}>Editar tablero</button>
        <button type="button" class="ghost small danger" id="deleteBoardBtn" ${boardBusy ? 'disabled' : ''}>Borrar tablero</button>
      </div>
    </div>`);
    bar.querySelector('#editBoardBtn').addEventListener('click', toggleEditBoard);
    bar.querySelector('#deleteBoardBtn').addEventListener('click', onDeleteBoard);
    ownerSlot.appendChild(bar);
  }

  function drawCalendar(calendarEl, { dates, scores, breakdown, best }) {
    const totalResponses = effectiveResponses().length;
    for (const { year, month, dates: monthDates } of groupByMonth(dates)) {
      const monthBlock = el(`<div class="calMonth">
        <div class="calMonthTitle">${MONTHS_LONG_ES[month].toUpperCase()} ${year}</div>
        <div class="calWeekdays">${WEEKDAYS_MON_FIRST.map((w) => `<span>${w}</span>`).join('')}</div>
        <div class="calDays"></div>
      </div>`);
      calendarEl.appendChild(monthBlock);

      const daysEl = monthBlock.querySelector('.calDays');
      const leadingEmpty = mondayIndex(monthDates[0]);
      for (let i = 0; i < leadingEmpty; i++) {
        daysEl.appendChild(el('<div class="calDay empty"></div>'));
      }
      for (const d of monthDates) {
        daysEl.appendChild(makeDayCell(d, { scores, breakdown, best, totalResponses }));
      }
    }
  }

  function makeDayCell(day, { scores, breakdown, best, totalResponses }) {
    const myStatus = myDays()[day] || 'none';
    const inBest = best && day >= best.start && day <= best.end;
    const score = scores[day] || 0;
    const badge = totalResponses > 0 ? `${formatScore(score)}/${totalResponses}` : '';
    const bd = breakdown[day];
    const tooltip = `${dayNum(day)} de ${MONTHS_LONG_ES[monthOf(day)]}: tú — ${STATUS_LABEL[myStatus]}. Grupo: ${bd.full} disponible · ${bd.partial} parcial · ${bd.unavailable} no disponible · ${bd.none} sin marcar.`;
    const label = `${tooltip} Toca para cambiar tu disponibilidad.`;

    const btn = el(
      `<button type="button" class="calDay ${myStatus} ${inBest ? 'inBest' : ''}" title="${escapeHtml(tooltip)}" aria-label="${escapeHtml(label)}">
        <span class="calDayNum">${dayNum(day)}</span>
        ${badge ? `<span class="calDayBadge">${badge}</span>` : ''}
      </button>`
    );
    // mousedown+mouseenter+mouseup(global), no click: así un arrastre pinta
    // todo el rango con un solo estado en vez de ciclar casilla a casilla.
    // Un clic normal (sin arrastrar) es un rango de 1 día — mismo resultado
    // de siempre. Ver la nota de cabecera del fichero sobre por qué no hay
    // soporte de arrastre táctil.
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // evita selección de texto nativa al arrastrar
      onDragStart(day);
    });
    btn.addEventListener('mouseenter', () => onDragEnter(day));
    return btn;
  }

  function drawBestBox(bestBox, { best, responses: currentResponses }) {
    if (best) {
      const totalWeight = currentResponses.reduce((sum, r) => sum + (weights[r.uid] || 1), 0);
      bestBox.innerHTML = `
        <div class="eyebrow">MEJOR VENTANA · ${board.tripLength} DÍAS</div>
        <div class="bestDates">${monthShort(best.start)} ${dayNum(best.start)} — ${monthShort(best.end)} ${dayNum(best.end)}</div>
        <div class="bestMeta">Puntuación ${formatScore(best.sum)} de ${board.tripLength * totalWeight} máx. · ${best.fullCount} disponibilidades completas</div>`;
    } else {
      bestBox.innerHTML = `<p class="sub" style="margin:0;">El rango de fechas es más corto que la duración del viaje.</p>`;
    }
  }

  /** Top-3 ventanas alternativas (backlog Fase 12): se omite la [0], que ya se muestra en drawBestBox. */
  function drawAlternatives(altBox, { top }) {
    const alternatives = top.slice(1);
    if (alternatives.length === 0) {
      altBox.innerHTML = '';
      return;
    }
    altBox.innerHTML = '<div class="eyebrow" style="margin-top:20px;">OTRAS VENTANAS POSIBLES</div>';
    for (const w of alternatives) {
      altBox.appendChild(
        el(`<div class="altRow">
          <span>${monthShort(w.start)} ${dayNum(w.start)} — ${monthShort(w.end)} ${dayNum(w.end)}</span>
          <span class="altScore">Puntuación ${formatScore(w.sum)}</span>
        </div>`)
      );
    }
  }

  function drawRoster(rosterEl, { dates, responses: currentResponses, myUid }) {
    for (const r of currentResponses) {
      const isMine = r.uid === myUid;
      const weight = weights[r.uid] || 1;
      let full = 0;
      let partial = 0;
      let unavailable = 0;
      for (const d of dates) {
        const st = (r.days && r.days[d]) || 'none';
        if (st === 'full') full++;
        else if (st === 'partial') partial++;
        else if (st === 'unavailable') unavailable++;
      }
      const row = el(`<div class="rosterRow ${isMine ? 'mine' : ''}">
          <span class="rosterName ${isMine ? 'mine' : ''}">${escapeHtml(r.name)}${isMine ? ' (tú)' : ''}${
            weight === 2 ? ' <span class="weightBadge" title="Cuenta doble en la puntuación">×2</span>' : ''
          }</span>
          <span class="rosterRight">
            <span class="rosterStats">${full} disponible${full === 1 ? '' : 's'} · ${partial} parcial${partial === 1 ? '' : 'es'} · ${unavailable} no disponible${unavailable === 1 ? '' : 's'}</span>
            ${isOwner ? `<button type="button" class="ghost small weightBtn" ${boardBusy ? 'disabled' : ''}>${weight === 2 ? 'Cuenta doble ✓' : 'Cuenta doble'}</button>` : ''}
            ${isOwner && !isMine ? '<button type="button" class="ghost small danger removeBtn">Quitar</button>' : ''}
          </span>
        </div>`);
      if (isOwner) {
        row.querySelector('.weightBtn').addEventListener('click', () => onToggleWeight(r.uid));
      }
      if (isOwner && !isMine) {
        row.querySelector('.removeBtn').addEventListener('click', () => onRemoveParticipant(r.uid, r.name));
      }
      rosterEl.appendChild(row);
    }
  }

  draw();
}

// --- utilidades locales de esta vista ---------------------------------------

function monthOf(dateStr) {
  return Number(dateStr.split('-')[1]) - 1;
}

/** Formatea una puntuación (puede tener .5) sin decimales sobrantes: 3 en vez de 3.0, 3.5 tal cual. */
function formatScore(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = String(s);
  return div.innerHTML;
}
