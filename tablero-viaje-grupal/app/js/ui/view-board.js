// Vista del tablero: heatmap + rejilla de disponibilidad + mejor ventana.
//
// Basada en el prototipo, con las mejoras obligatorias de la Fase 3:
//   - rejilla transpuesta en móvil (filas = días, columnas = participantes)
//   - celdas editables como <button> reales con aria-label
//   - estados de carga / error / vacío / guardando
//   - debounce de 400ms en las escrituras
//
// Las acciones de creador (editar fechas, borrar participante, borrar
// tablero) llegan en la Fase 5, junto con el backend real.

import { getStore } from '../data/store.js';
import { dateRangeArray, weekdayShort, monthShort, dayNum } from '../core/dates.js';
import { computeScores, bestWindow } from '../core/scoring.js';
import { el, debounce, isMobileViewport, renderErrorBanner } from './components.js';

const STATUS_ORDER = ['none', 'partial', 'full'];
const STATUS_LABEL = { none: 'No disponible', partial: 'Parcial', full: 'Disponible' };

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
  const loadingNode = el('<div class="loading">Cargando tablero…</div>');
  app.appendChild(loadingNode);

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

  let resizeTimer = null;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(draw, 150);
  }
  window.addEventListener('resize', onResize);

  const unsubscribe = store.subscribeResponses(boardId, (r) => {
    responses = r;
    gotFirstSnapshot = true;
    draw();
  });

  // Si el router vuelve a renderizar el tablero sobre el mismo #app (no
  // debería pasar en el flujo normal de main.js, pero es una salvaguarda
  // barata), se limpia la suscripción y el listener de 'resize' anteriores
  // antes de dejar activos los nuevos.
  const previousCleanup = app._viewBoardCleanup;
  if (previousCleanup) previousCleanup();
  app._viewBoardCleanup = () => {
    window.removeEventListener('resize', onResize);
    unsubscribe();
  };

  function draw() {
    if (!gotFirstSnapshot) return; // se queda con el "Cargando tablero…" hasta el primer snapshot

    const { scores, breakdown } = computeScores(dates, mergeMine(responses));
    const best = bestWindow(dates, scores, breakdown, board.tripLength);
    const maxScore = Math.max(1, ...dates.map((d) => scores[d]));
    const transposed = isMobileViewport();

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
        <span><i class="dot none"></i>No disponible</span>
      </div>
      <div class="scrollx">
        <div class="heat ${transposed ? 'transposed' : ''}"></div>
        <div class="grid ${transposed ? 'transposed' : ''}"></div>
      </div>
      <div class="bestBox"></div>
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

    const bestBox = container.querySelector('.bestBox');
    if (best) {
      bestBox.innerHTML = `
        <div class="eyebrow">MEJOR VENTANA · ${board.tripLength} DÍAS</div>
        <div class="bestDates">${monthShort(best.start)} ${dayNum(best.start)} — ${monthShort(best.end)} ${dayNum(best.end)}</div>
        <div class="bestMeta">Puntuación ${best.sum.toFixed(1)} de ${(board.tripLength * mergeMine(responses).length).toFixed(1)} máx. · ${best.fullCount} disponibilidades completas</div>`;
    } else {
      bestBox.innerHTML = `<p class="sub" style="margin:0;">El rango de fechas es más corto que la duración del viaje.</p>`;
    }

    if (transposed) {
      drawTransposed(container, { dates, responses: mergeMine(responses), scores, breakdown, best, maxScore });
    } else {
      drawStandard(container, { dates, responses: mergeMine(responses), scores, breakdown, best, maxScore });
    }
  }

  function mergeMine(list) {
    if (pendingDays === null) return list;
    const mine = list.find((r) => r.uid === myUid);
    if (!mine) return list;
    return list.map((r) => (r.uid === myUid ? { ...r, days: pendingDays } : r));
  }

  function onCycle(day) {
    const order = STATUS_ORDER;
    const current = myDays()[day] || 'none';
    const next = order[(order.indexOf(current) + 1) % order.length];
    const updated = { ...myDays(), [day]: next };
    pendingDays = updated;
    draw();
    scheduleSave(myResponse().name, updated);
  }

  function drawStandard(container, { dates, responses, scores, breakdown, best, maxScore }) {
    const heat = container.querySelector('.heat');
    const grid = container.querySelector('.grid');

    heat.appendChild(el('<div class="rowLabel">Total</div>'));
    for (const d of dates) {
      const inBest = best && d >= best.start && d <= best.end;
      const bg = lerpColor('#1B2A3D', '#F2A93B', scores[d] / maxScore);
      const title = `${breakdown[d].full} completa · ${breakdown[d].partial} parcial · ${breakdown[d].none} no disponible`;
      heat.appendChild(
        el(
          `<div class="tile heatTile ${inBest ? 'inBest' : ''}" style="background:${bg}" title="${title}"><span class="wd">${weekdayShort(d)}</span><span class="dn">${dayNum(d)}</span></div>`
        )
      );
    }

    grid.appendChild(el('<div class="rowLabel head">Fecha</div>'));
    for (const d of dates) {
      grid.appendChild(el(`<div class="tile head">${monthShort(d)} ${dayNum(d)}</div>`));
    }

    for (const r of responses) {
      const isMine = r.uid === myUid;
      grid.appendChild(
        el(`<div class="rowLabel ${isMine ? 'mine' : ''}">${escapeHtml(r.name)}${isMine ? ' (tú)' : ''}</div>`)
      );
      for (const d of dates) {
        grid.appendChild(makeCell(r, d, isMine));
      }
    }

    grid.style.gridTemplateColumns = `140px repeat(${dates.length}, 64px)`;
    heat.style.gridTemplateColumns = `140px repeat(${dates.length}, 64px)`;
  }

  function drawTransposed(container, { dates, responses, scores, breakdown, best, maxScore }) {
    // Filas = días, columnas = participantes. Pensado para móvil: con un
    // grupo pequeño (pocos participantes) y un rango largo, esto evita el
    // scroll horizontal de 64px por día, que es inusable en pantallas
    // estrechas con 60+ días.
    const heat = container.querySelector('.heat');
    const grid = container.querySelector('.grid');
    heat.remove(); // el heatmap de "total" no aporta tanto en la vista transpuesta; se omite

    grid.appendChild(el('<div class="rowLabel head">Fecha</div>'));
    for (const r of responses) {
      const isMine = r.uid === myUid;
      grid.appendChild(
        el(
          `<div class="tile head participantHead ${isMine ? 'mine' : ''}" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}${isMine ? ' (tú)' : ''}</div>`
        )
      );
    }

    for (const d of dates) {
      const inBest = best && d >= best.start && d <= best.end;
      grid.appendChild(
        el(
          `<div class="rowLabel ${inBest ? 'mine' : ''}">${weekdayShort(d)} ${dayNum(d)} ${monthShort(d)}</div>`
        )
      );
      for (const r of responses) {
        const isMine = r.uid === myUid;
        grid.appendChild(makeCell(r, d, isMine));
      }
    }

    grid.style.gridTemplateColumns = `90px repeat(${responses.length}, minmax(56px, 1fr))`;
  }

  function makeCell(r, day, isMine) {
    const st = (r.days && r.days[day]) || 'none';
    const label = `${dayNum(day)} de ${monthLongEs(day)}: ${STATUS_LABEL[st]}`;
    if (!isMine) {
      return el(`<div class="tile ${st}" title="${STATUS_LABEL[st]}" aria-label="${label}"></div>`);
    }
    const btn = el(
      `<button type="button" class="tile ${st} editable" aria-label="${label}, toca para cambiar" title="${STATUS_LABEL[st]}"></button>`
    );
    btn.addEventListener('click', () => onCycle(day));
    return btn;
  }

  draw();
}

// --- utilidades locales de esta vista ---------------------------------------

function hexToRgb(hex) {
  hex = hex.replace('#', '');
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpColor(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const r = Math.round(A[0] + (B[0] - A[0]) * t);
  const g = Math.round(A[1] + (B[1] - A[1]) * t);
  const bl = Math.round(A[2] + (B[2] - A[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

const MONTHS_LONG_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
function monthLongEs(dateStr) {
  const [, m] = dateStr.split('-').map(Number);
  return MONTHS_LONG_ES[m - 1];
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = String(s);
  return div.innerHTML;
}
