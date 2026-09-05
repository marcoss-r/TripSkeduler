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
// Las acciones de creador (editar fechas, borrar participante, borrar
// tablero) llegan en la Fase 5, junto con el backend real.

import { getStore } from '../data/store.js';
import { dateRangeArray, monthShort, dayNum, groupByMonth, mondayIndex } from '../core/dates.js';
import { computeScores, bestWindow } from '../core/scoring.js';
import { el, debounce, renderErrorBanner } from './components.js';

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
  const store = getStore();
  const boardId = board.boardId;
  const dates = dateRangeArray(board.startDate, board.endDate);
  const myUid = await store.getMyId();

  let responses = [];
  let pendingDays = null; // override optimista de mis propios días mientras el guardado está en curso
  let saving = false;
  let gotFirstSnapshot = false;
  let transientError = null;

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

  const unsubscribe = store.subscribeResponses(boardId, (r) => {
    responses = r;
    gotFirstSnapshot = true;
    draw();
  });

  // Si el router vuelve a renderizar el tablero sobre el mismo #app (no
  // debería pasar en el flujo normal de main.js, pero es una salvaguarda
  // barata), se limpia la suscripción anterior antes de dejar activa la
  // nueva.
  const previousCleanup = app._viewBoardCleanup;
  if (previousCleanup) previousCleanup();
  app._viewBoardCleanup = () => unsubscribe();

  function onCycle(day) {
    const order = STATUS_ORDER;
    const current = myDays()[day] || 'none';
    const next = order[(order.indexOf(current) + 1) % order.length];
    const updated = { ...myDays(), [day]: next };
    pendingDays = updated;
    draw();
    scheduleSave(myResponse().name, updated);
  }

  function draw() {
    if (!gotFirstSnapshot) return; // se queda con el "Cargando tablero…" hasta el primer snapshot

    const currentResponses = effectiveResponses();
    const { scores, breakdown } = computeScores(dates, currentResponses);
    const best = bestWindow(dates, scores, breakdown, board.tripLength);

    app.innerHTML = '';
    const container = el(`<div class="wrap wide">
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
      <div id="bannerSlot"></div>
      <div class="legend">
        <span><i class="dot full"></i>Disponible</span>
        <span><i class="dot partial"></i>Parcial</span>
        <span><i class="dot unavailable"></i>No disponible</span>
        <span><i class="dot none"></i>No definido</span>
        <span>· el número bajo cada día es la puntuación del grupo</span>
      </div>
      <div class="calendar"></div>
      <div class="bestBox"></div>
      <div class="roster"></div>
      <p class="footNote">Estos datos se guardan en este navegador (modo local de desarrollo) mientras no se conecte un backend real.</p>
    </div>`);
    app.appendChild(container);

    if (transientError) {
      container.querySelector('#bannerSlot').appendChild(renderErrorBanner(transientError));
    }
    if (responses.length === 0) {
      container
        .querySelector('#bannerSlot')
        .appendChild(el('<div class="banner info">Aún no hay ninguna respuesta en este tablero.</div>'));
    }

    drawCalendar(container.querySelector('.calendar'), { dates, scores, breakdown, best });
    drawBestBox(container.querySelector('.bestBox'), { best, responses: currentResponses });
    drawRoster(container.querySelector('.roster'), { dates, responses: currentResponses, myUid });
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
    btn.addEventListener('click', () => onCycle(day));
    return btn;
  }

  function drawBestBox(bestBox, { best, responses: currentResponses }) {
    if (best) {
      bestBox.innerHTML = `
        <div class="eyebrow">MEJOR VENTANA · ${board.tripLength} DÍAS</div>
        <div class="bestDates">${monthShort(best.start)} ${dayNum(best.start)} — ${monthShort(best.end)} ${dayNum(best.end)}</div>
        <div class="bestMeta">Puntuación ${formatScore(best.sum)} de ${board.tripLength * currentResponses.length} máx. · ${best.fullCount} disponibilidades completas</div>`;
    } else {
      bestBox.innerHTML = `<p class="sub" style="margin:0;">El rango de fechas es más corto que la duración del viaje.</p>`;
    }
  }

  function drawRoster(rosterEl, { dates, responses: currentResponses, myUid }) {
    for (const r of currentResponses) {
      const isMine = r.uid === myUid;
      let full = 0;
      let partial = 0;
      let unavailable = 0;
      for (const d of dates) {
        const st = (r.days && r.days[d]) || 'none';
        if (st === 'full') full++;
        else if (st === 'partial') partial++;
        else if (st === 'unavailable') unavailable++;
      }
      rosterEl.appendChild(
        el(`<div class="rosterRow ${isMine ? 'mine' : ''}">
          <span class="rosterName ${isMine ? 'mine' : ''}">${escapeHtml(r.name)}${isMine ? ' (tú)' : ''}</span>
          <span class="rosterStats">${full} disponible${full === 1 ? '' : 's'} · ${partial} parcial${partial === 1 ? '' : 'es'} · ${unavailable} no disponible${unavailable === 1 ? '' : 's'}</span>
        </div>`)
      );
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
