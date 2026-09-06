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
// v3 (tras feedback de uso real). Tres cambios, los tres sobre lo mismo:
// que marcar disponibilidad deje de dar saltos y se pueda hacer con el
// dedo.
//
// 1. NADA DE REDIBUJAR LA PÁGINA ENTERA AL MARCAR. Antes, cada pulsación
//    disparaba tres `draw()` seguidos (marcar → guardando → guardado) y
//    `draw()` hace `app.innerHTML = ''`: se rehacía el <h1> (repitiendo su
//    animación de entrada, de ahí que el título "subiera y bajara") y el
//    indicador "Guardando…" aparecía y desaparecía, cambiando el ancho de
//    la cabecera hasta hacerla saltar a dos líneas con flex-wrap y
//    empujando el calendario entero arriba y abajo. Ahora el estado de
//    guardado vive en un hueco de tamaño FIJO que siempre está ahí
//    ("Guardando…" / "Cambios guardados"), y marcar días solo actualiza en
//    el sitio lo que cambia (`refreshLive`), sin destruir el DOM.
//
// 2. ARRASTRE CON EL DEDO. El arrastre para marcar un rango era solo de
//    ratón (`mouseenter` no existe al arrastrar el dedo). Ahora va con
//    eventos de puntero, que unifican ratón y táctil, resolviendo la
//    casilla bajo el dedo con `elementFromPoint` — `pointermove` no
//    dispara nada al entrar en otro elemento, así que hay que preguntarlo.
//    Dos detalles imprescindibles: `touch-action: none` en la rejilla (si
//    no, el navegador se queda el gesto para hacer scroll y no llega ni un
//    solo evento) y soltar la captura implícita del puntero táctil (si no,
//    todos los `pointermove` van a la casilla donde empezó el gesto).
//
// 3bis. EL TABLERO SE ESCUCHA, NO SOLO SUS RESPUESTAS. `getBoard` se leía
//    una vez al entrar y nunca más, así que lo que tocaba el creador
//    (nombre, fechas, quién es imprescindible) el resto del grupo no lo
//    veía —ni entraba en sus puntuaciones— hasta recargar. Ahora hay un
//    `subscribeBoard`. Cuidado con él: `expiresAt` se reescribe cada vez
//    que alguien guarda una respuesta, así que salta continuamente; solo
//    se repinta si ha cambiado alguno de los campos que se muestran.
//
// 3. SELECTOR DE MES. Con rangos largos el calendario era una tira
//    vertical enorme que obligaba a hacer scroll, y el scroll es
//    justamente lo que compite con el arrastre en móvil. Se muestra un mes
//    cada vez, con un desplegable (y flechas) para cambiar de mes; queda
//    la opción "Todos los meses" para quien quiera la vista completa. La
//    puntuación, la mejor ventana y las alternativas se siguen calculando
//    sobre TODO el rango, no sobre el mes visible.
//
// Backlog (Fase 12), añadido a petición explícita:
// - "Marcar rango" arrastrando: pointerdown en un día + arrastrar + soltar
//   pinta todo el rango recorrido con el mismo estado (el siguiente en el
//   ciclo respecto al día donde empezó el arrastre). Un simple clic sin
//   arrastrar es un caso particular (rango de un solo día) — es el mismo
//   mecanismo de antes, no un modo aparte.
// - Participante imprescindible (`board.essentials[uid] = true`, sustituye
//   al "cuenta doble" que había antes): quien pone la casa, quien conduce…
//   gente sin la que no hay viaje. No es que su voto puntúe más — es un
//   veto: un día que un imprescindible marca "no disponible" queda
//   bloqueado, y una ventana con algún día bloqueado va siempre por detrás
//   de cualquier ventana limpia, puntúe lo que puntúe (ver scoring.js).
//   Ponderar la puntuación no valía para esto: con bastante gente
//   disponible la suma tapaba el veto.
// - Top-3 ventanas alternativas (topWindows, ya existía en scoring.js):
//   se muestran las dos siguientes mejores ventanas no solapadas con la
//   principal.

import { getStore } from '../data/store.js';
import { dateRangeArray, isValidRange, MAX_RANGE_DAYS, monthShort, dayNum, groupByMonth, mondayIndex, fmtDate } from '../core/dates.js';
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

// Hueco de estado de guardado. Siempre visible y siempre del mismo tamaño
// (ver el punto 1 del encabezado): el texto cambia, la caja no.
const SAVE_LABEL = {
  idle: '',
  saving: 'Guardando…',
  saved: 'Cambios guardados',
  error: 'Sin guardar',
};

// Se guarda dos segundos después del último toque, no a cada toque: marcar
// varios días seguidos es un solo gesto y debe ser una sola escritura. Para
// que ese margen no pueda costar datos, `flushPendingSave` fuerza el guardado
// en cuanto la app pasa a segundo plano o se cierra la pestaña.
const SAVE_DELAY_MS = 2000;

const SAVE_ERROR_HINT =
  'No se ha podido guardar todavía. Lo que has marcado sigue aquí y se reintenta al tocar otro día.';

const ALL_MONTHS = 'all';

export async function renderBoard(app, board) {
  const store = await getStore();
  const boardId = board.boardId;
  let dates = dateRangeArray(board.startDate, board.endDate); // recalculada si el creador edita las fechas
  const myUid = await store.getMyId();
  const isOwner = board.ownerUid === myUid;

  let responses = [];
  let groupMembers = null; // solo si board.groupId; sirve para "quién falta por responder" (Fase 9)
  let essentials = { ...(board.essentials || {}) }; // uid -> true si es imprescindible; ausente = participante normal
  let pendingDays = null; // override optimista de mis propios días mientras el guardado está en curso
  let savingDays = null; // el objeto exacto que se está escribiendo ahora mismo, o null
  let saveState = 'idle'; // idle | saving | saved | error
  let gotFirstSnapshot = false;
  let transientError = null;
  let editingBoard = false;
  let boardBusy = false; // deshabilita las acciones de creador mientras hay una escritura en curso
  let container = null; // raíz de la última pintada completa; refreshLive actualiza dentro de ella
  let visibleMonth = null; // 'YYYY-MM' o ALL_MONTHS; se decide en la primera pintada

  // Estado del arrastre "marcar rango" (backlog Fase 12) — ver la nota del
  // encabezado del fichero.
  let dragging = false;
  let dragBaseDays = null; // mis días ANTES de empezar el arrastre actual
  let dragStartIdx = null;
  let dragCurrentIdx = null;
  let dragStatus = null;
  let activePointerId = null; // ignora punteros secundarios (segundo dedo) durante un arrastre

  app.innerHTML = '';
  app.appendChild(el('<div class="loading">Cargando tablero…</div>'));

  // Marcar días NUNCA toca la estructura de la página: el único sitio donde
  // se cuenta si está guardado o no es el hueco fijo de `#saveState`. Un
  // banner de error aquí sería justo lo contrario — aparece y desaparece
  // con cada toque, y al hacerlo empuja el calendario hacia abajo.
  const scheduleSave = debounce((name) => saveNow(name), SAVE_DELAY_MS);

  /**
   * Guarda `pendingDays`. Solo puede haber una escritura en vuelo: si llega
   * otra petición mientras tanto, se ignora y es la que está en curso la que
   * se reencadena al terminar, ya con el valor nuevo.
   *
   * ⚠️ `pendingDays` se limpia SOLO si sigue siendo exactamente el objeto que
   * se acaba de guardar. Antes se ponía a null a secas, y ese era el fallo de
   * "toco dos veces seguidas y vuelve el color de antes": el segundo toque
   * dejaba un `pendingDays` nuevo que el final del primer guardado borraba,
   * así que la casilla caía de vuelta al valor del servidor (el del primer
   * toque) hasta que el segundo guardado terminaba.
   */
  async function saveNow(name) {
    if (pendingDays === null || savingDays !== null) return;
    const snapshot = pendingDays;
    savingDays = snapshot;
    setSaveState('saving');
    try {
      await store.saveMyResponse(boardId, { name, days: snapshot });
      if (pendingDays === snapshot) pendingDays = null;
      setSaveState('saved');
    } catch (err) {
      console.error(err);
      // Sin banner: el hueco fijo ya dice "Sin guardar", y lo marcado se
      // queda en pantalla (no se limpia `pendingDays`) para no dar por
      // perdido lo que la persona acaba de hacer.
      setSaveState('error');
    } finally {
      savingDays = null;
      refreshLive();
      // Se tocó algo mientras se guardaba: va otra vuelta con lo último.
      // Tras un fallo esto es además el reintento natural.
      if (pendingDays !== null && pendingDays !== snapshot) saveNow(name);
    }
  }

  /** Fuerza el guardado pendiente sin esperar al debounce (al salir de la app). */
  function flushPendingSave() {
    scheduleSave.cancel();
    saveNow(myResponse().name);
  }

  function setSaveState(next) {
    saveState = next;
    const node = container && container.querySelector('#saveState');
    if (!node) return;
    node.className = `saveState ${next}`;
    node.textContent = SAVE_LABEL[next];
    // La explicación del fallo va en el tooltip y no en un banner: un banner
    // aquí cambiaría la altura de la cabecera y volvería a mover el
    // calendario con cada toque, que es justo lo que se quiere evitar.
    node.title = next === 'error' ? SAVE_ERROR_HINT : '';
  }

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

  /** `currentResponses` con el flag `essential` añadido, solo para pasar a computeScores. */
  function withEssential(currentResponses) {
    return currentResponses.map((r) => ({ ...r, essential: !!essentials[r.uid] }));
  }

  /**
   * Para cada día, los nombres de los imprescindibles que lo han marcado
   * como "no disponible" — o sea, quién bloquea qué. Se calcula de una vez
   * por repintado y se reparte a las casillas y a la caja de mejor ventana.
   */
  function blockersByDay(currentResponses) {
    const map = {};
    for (const r of currentResponses) {
      if (!essentials[r.uid]) continue;
      for (const d of dates) {
        if ((r.days && r.days[d]) === 'unavailable') (map[d] = map[d] || []).push(r.name);
      }
    }
    return map;
  }

  /** Nombres de imprescindibles que bloquean algún día de la ventana [start, end]. */
  function blockersInWindow(blockedBy, start, end) {
    const names = new Set();
    for (const d of dates) {
      if (d >= start && d <= end) for (const n of blockedBy[d] || []) names.add(n);
    }
    return [...names];
  }

  const unsubscribe = store.subscribeResponses(boardId, (r) => {
    responses = r;
    gotFirstSnapshot = true;
    draw();
  });
  // El documento del tablero también se escucha, no solo sus respuestas:
  // sin esto, lo que tocaba el creador (nombre, fechas, quién es
  // imprescindible) el resto del grupo no lo veía hasta recargar — y las
  // puntuaciones se seguían calculando con lo viejo.
  //
  // ⚠️ Este callback salta CONSTANTEMENTE: cada respuesta que alguien
  // guarda reescribe `expiresAt` del tablero (marcar actividad para el
  // TTL). Por eso se compara antes de repintar; si no, cada vez que otra
  // persona marcase un día se repintaría la página entera y volverían los
  // saltos que acabamos de quitar.
  const unsubscribeBoard = store.subscribeBoard(boardId, (fresh) => {
    const freshEssentials = fresh.essentials || {};
    const changed =
      fresh.tripName !== board.tripName ||
      fresh.startDate !== board.startDate ||
      fresh.endDate !== board.endDate ||
      !sameKeys(freshEssentials, essentials);
    if (!changed) return;

    board.tripName = fresh.tripName;
    board.startDate = fresh.startDate;
    board.endDate = fresh.endDate;
    dates = dateRangeArray(fresh.startDate, fresh.endDate);
    essentials = { ...freshEssentials };
    // No pisar el formulario del creador mientras lo tiene abierto ni una
    // escritura suya en curso: en ambos casos ya hay un draw() esperando al
    // final de la operación.
    if (editingBoard || boardBusy) return;
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
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerFinish);
  window.addEventListener('pointercancel', onPointerFinish);

  // Salvavidas del retardo de SAVE_DELAY_MS: si la app se va a segundo plano
  // o se cierra la pestaña con algo sin guardar, se escribe ya. En móvil
  // 'visibilitychange' es el único que se dispara de forma fiable al cambiar
  // de app o bloquear la pantalla; 'pagehide' cubre cerrar o navegar fuera.
  function onHide() {
    if (document.visibilityState === 'hidden') flushPendingSave();
  }
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flushPendingSave);

  const previousCleanup = app._viewBoardCleanup;
  if (previousCleanup) previousCleanup();
  app._viewBoardCleanup = () => {
    flushPendingSave();
    unsubscribe();
    unsubscribeBoard();
    if (unsubscribeMembers) unsubscribeMembers();
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerFinish);
    window.removeEventListener('pointercancel', onPointerFinish);
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', flushPendingSave);
  };

  // --- "marcar rango" arrastrando (backlog Fase 12) --------------------------
  //
  // dragStart fija, sobre el día donde empieza el arrastre, cuál es el
  // "siguiente estado" a aplicar (mismo ciclo que un clic normal) y lo
  // recuerda en dragStatus para todo el arrastre — así se pinta el rango
  // entero con UN estado, no se re-cicla casilla a casilla. dragEnter va
  // recalculando el rango [inicio, actual] sobre el índice en `dates` (no
  // sobre el orden en que el puntero disparó los eventos), para no perder
  // días si se mueve rápido y se salta alguna casilla. Un clic simple es el
  // caso degenerado: pointerdown+pointerup sin ningún movimiento de por
  // medio, rango de longitud 1 — el mismo resultado que el ciclo de toda la
  // vida.

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
    const idx = dates.indexOf(day);
    if (idx === -1) return;
    dragging = true;
    dragBaseDays = { ...myDays() };
    dragStartIdx = idx;
    dragCurrentIdx = idx;
    const current = dragBaseDays[day] || 'none';
    dragStatus = STATUS_ORDER[(STATUS_ORDER.indexOf(current) + 1) % STATUS_ORDER.length];
    applyDragPreview();
    // En cuanto se toca un día ya hay cambios sin guardar: decirlo aquí
    // evita que el hueco siga diciendo "Cambios guardados" durante los
    // SAVE_DELAY_MS de espera, que sería mentira.
    setSaveState('saving');
    refreshLive();
  }

  function onDragEnter(day) {
    if (!dragging) return;
    const idx = dates.indexOf(day);
    if (idx === -1 || idx === dragCurrentIdx) return; // misma casilla: nada que recalcular
    dragCurrentIdx = idx;
    applyDragPreview();
    refreshLive();
  }

  function onDragEnd() {
    if (!dragging) return;
    dragging = false;
    dragBaseDays = null;
    dragStartIdx = null;
    dragCurrentIdx = null;
    dragStatus = null;
    scheduleSave(myResponse().name);
  }

  // `pointermove` no avisa de que el puntero ha entrado en otro elemento
  // (no hay equivalente de `mouseenter` que sirva mientras se arrastra el
  // dedo), así que se resuelve a mano qué casilla hay debajo. Los
  // escuchadores van en `window` y no en la casilla: el gesto no debe
  // cortarse por salirse de la rejilla ni por un repintado.
  function onPointerMove(e) {
    if (!dragging || (activePointerId !== null && e.pointerId !== activePointerId)) return;
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const cell = under && under.closest ? under.closest('.calDay[data-day]') : null;
    if (cell) onDragEnter(cell.dataset.day);
  }

  function onPointerFinish(e) {
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    activePointerId = null;
    onDragEnd();
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

  /** Marca o desmarca a un participante como imprescindible (sin él/ella no hay viaje). */
  async function onToggleEssential(uid) {
    const updated = { ...essentials };
    if (updated[uid]) delete updated[uid]; // no acumular basura: ausente == participante normal
    else updated[uid] = true;

    const previous = essentials;
    essentials = updated;
    boardBusy = true;
    draw();
    try {
      await store.updateBoard(boardId, { essentials: updated });
      transientError = null;
    } catch (err) {
      console.error(err);
      essentials = previous;
      transientError = 'No se pudo cambiar quién es imprescindible. Inténtalo de nuevo.';
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

  // --- selector de mes -------------------------------------------------------

  function monthKey({ year, month }) {
    return `${year}-${String(month + 1).padStart(2, '0')}`;
  }

  /** Mes que conviene mostrar de entrada: el primero que aún tiene días por venir. */
  function defaultMonth(months) {
    if (months.length <= 1) return ALL_MONTHS;
    const today = fmtDate(new Date());
    const upcoming = months.find((m) => m.dates[m.dates.length - 1] >= today);
    return monthKey(upcoming || months[0]);
  }

  function setVisibleMonth(next) {
    visibleMonth = next;
    draw();
  }

  function drawMonthPicker(slot, months) {
    if (months.length <= 1) return; // un solo mes: el desplegable solo estorbaría

    const idx = months.findIndex((m) => monthKey(m) === visibleMonth);
    const picker = el(`<div class="monthPicker">
      <label for="monthSelect">MES</label>
      <select id="monthSelect">
        ${months
          .map((m) => {
            const key = monthKey(m);
            const label = `${MONTHS_LONG_ES[m.month]} ${m.year}`;
            return `<option value="${key}" ${key === visibleMonth ? 'selected' : ''}>${label}</option>`;
          })
          .join('')}
        <option value="${ALL_MONTHS}" ${visibleMonth === ALL_MONTHS ? 'selected' : ''}>Todos los meses</option>
      </select>
      <span class="monthNav">
        <button type="button" class="ghost small" id="prevMonthBtn" aria-label="Mes anterior" ${idx <= 0 ? 'disabled' : ''}>‹</button>
        <button type="button" class="ghost small" id="nextMonthBtn" aria-label="Mes siguiente" ${idx === -1 || idx >= months.length - 1 ? 'disabled' : ''}>›</button>
      </span>
    </div>`);

    picker.querySelector('#monthSelect').addEventListener('change', (e) => setVisibleMonth(e.target.value));
    picker.querySelector('#prevMonthBtn').addEventListener('click', () => setVisibleMonth(monthKey(months[idx - 1])));
    picker.querySelector('#nextMonthBtn').addEventListener('click', () => setVisibleMonth(monthKey(months[idx + 1])));
    slot.appendChild(picker);
  }

  // --- pintado ---------------------------------------------------------------

  function draw() {
    if (!gotFirstSnapshot) return; // se queda con el "Cargando tablero…" hasta el primer snapshot
    // Un snapshot remoto (otra persona marcando a la vez) no puede
    // destruir el DOM en mitad de un arrastre: se reconcilia en el sitio.
    if (dragging) return refreshLive();

    const months = groupByMonth(dates);
    // El mes elegido puede haber dejado de existir si el creador acaba de
    // recortar el rango de fechas.
    if (visibleMonth === null || (visibleMonth !== ALL_MONTHS && !months.some((m) => monthKey(m) === visibleMonth))) {
      visibleMonth = defaultMonth(months);
    }

    const currentResponses = effectiveResponses();
    const { scores, breakdown } = computeScores(dates, withEssential(currentResponses));
    const best = bestWindow(dates, scores, breakdown, board.tripLength);
    const top = topWindows(dates, scores, breakdown, board.tripLength, 3);
    const blockedBy = blockersByDay(currentResponses);

    app.innerHTML = '';
    container = el(`<div class="wrap wide boardView">
      <div class="boardNav">
        <a href="${appUrl()}">← Mis viajes</a>
        ${board.groupId ? `<a href="${appUrl(`g=${encodeURIComponent(board.groupId)}`)}">← Grupo</a>` : ''}
      </div>
      <div class="boardHeader">
        <div>
          <div class="eyebrow">${escapeHtml(board.tripName.toUpperCase())}</div>
          <h1>Tablero de disponibilidad</h1>
        </div>
        <div class="boardHeaderRight">
          <div class="sub" style="margin-bottom:4px;">Eres <strong>${escapeHtml(myResponse().name)}</strong></div>
          <span class="saveState ${saveState}" id="saveState" role="status" aria-live="polite">${SAVE_LABEL[saveState]}</span>
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
        <span><i class="dot blocked"></i>Bloqueado: no puede alguien imprescindible</span>
        <span>· el número bajo cada día es la puntuación del grupo · arrastra el dedo o el ratón sobre varios días para marcarlos de una vez</span>
      </div>
      <div id="monthSlot"></div>
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

    drawMonthPicker(container.querySelector('#monthSlot'), months);
    drawCalendar(container.querySelector('.calendar'), {
      months, scores, breakdown, best, blockedBy, totalResponses: currentResponses.length,
    });
    drawBestBox(container.querySelector('.bestBox'), { best, responses: currentResponses, blockedBy });
    drawAlternatives(container.querySelector('.altWindows'), { top });
    drawRoster(container.querySelector('.roster'), { dates, responses: currentResponses, myUid });
  }

  /**
   * Reconcilia en el sitio todo lo que depende de las respuestas (colores
   * de las casillas, puntuaciones, mejor ventana, alternativas y roster)
   * SIN tocar la estructura de la página. Es lo que se usa mientras se
   * marca: la alternativa era `draw()`, y rehacer el DOM entero en cada
   * casilla es exactamente lo que hacía saltar el título y el calendario.
   */
  function refreshLive() {
    if (!container) return draw();

    const currentResponses = effectiveResponses();
    const { scores, breakdown } = computeScores(dates, withEssential(currentResponses));
    const best = bestWindow(dates, scores, breakdown, board.tripLength);
    const top = topWindows(dates, scores, breakdown, board.tripLength, 3);
    const blockedBy = blockersByDay(currentResponses);
    const ctx = { scores, breakdown, best, blockedBy, totalResponses: currentResponses.length };

    for (const cell of container.querySelectorAll('.calDay[data-day]')) {
      updateDayCell(cell, cell.dataset.day, ctx);
    }
    drawBestBox(container.querySelector('.bestBox'), { best, responses: currentResponses, blockedBy });
    drawAlternatives(container.querySelector('.altWindows'), { top });
    const rosterEl = container.querySelector('.roster');
    rosterEl.innerHTML = '';
    drawRoster(rosterEl, { dates, responses: currentResponses, myUid });
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

  function drawCalendar(calendarEl, { months, scores, breakdown, best, blockedBy, totalResponses }) {
    const shown = visibleMonth === ALL_MONTHS ? months : months.filter((m) => monthKey(m) === visibleMonth);
    for (const { year, month, dates: monthDates } of shown) {
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
        daysEl.appendChild(makeDayCell(d, { scores, breakdown, best, blockedBy, totalResponses }));
      }
    }
  }

  function makeDayCell(day, ctx) {
    const btn = el(
      `<button type="button" class="calDay" data-day="${day}">
        <span class="calDayNum">${dayNum(day)}</span>
        <span class="calDayBadge"></span>
      </button>`
    );
    updateDayCell(btn, day, ctx);

    // pointerdown + pointermove global + pointerup, no click: así un
    // arrastre pinta todo el rango con un solo estado en vez de ciclar
    // casilla a casilla, y funciona igual con ratón que con el dedo.
    btn.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return; // botón derecho / central: no marca nada
      e.preventDefault(); // evita la selección de texto nativa al arrastrar
      // El navegador captura implícitamente el puntero TÁCTIL sobre la
      // casilla donde empieza el gesto: sin soltarlo, todos los
      // `pointermove` seguirían llegando a ESTA casilla y `elementFromPoint`
      // nunca vería las demás. Es la diferencia entre que el arrastre con el
      // dedo funcione o no.
      if (btn.hasPointerCapture && btn.hasPointerCapture(e.pointerId)) {
        btn.releasePointerCapture(e.pointerId);
      }
      activePointerId = e.pointerId;
      onDragStart(day);
    });

    // Teclado: `pointerdown` no lo dispara Intro/Espacio, así que sin esto
    // las casillas no se podían marcar sin ratón (lo mismo pasaba antes con
    // `mousedown`). Hay que distinguirlo del `click` que el navegador
    // sintetiza detrás de cada toque o clic real, o cada pulsación contaría
    // dos veces: en ese caso `pointerType` viene con 'touch'/'mouse', y en
    // el del teclado con la cadena vacía. `detail` es el respaldo para
    // navegadores donde `click` no llega como PointerEvent.
    btn.addEventListener('click', (e) => {
      const desdePuntero = typeof e.pointerType === 'string' ? e.pointerType !== '' : e.detail !== 0;
      if (desdePuntero) return;
      onDragStart(day);
      onDragEnd();
    });
    return btn;
  }

  /** Actualiza una casilla ya existente: color, marca de bloqueo, tooltip y puntuación del grupo. */
  function updateDayCell(btn, day, { scores, breakdown, best, blockedBy, totalResponses }) {
    const myStatus = myDays()[day] || 'none';
    const inBest = best && day >= best.start && day <= best.end;
    const blockers = blockedBy[day] || [];
    btn.className = `calDay ${myStatus}${inBest ? ' inBest' : ''}${blockers.length ? ' blocked' : ''}`;

    const bd = breakdown[day];
    const tooltip = `${dayNum(day)} de ${MONTHS_LONG_ES[monthOf(day)]}: tú — ${STATUS_LABEL[myStatus]}. Grupo: ${bd.full} disponible · ${bd.partial} parcial · ${bd.unavailable} no disponible · ${bd.none} sin marcar.${
      blockers.length ? ` Bloqueado: ${blockers.join(', ')} ${blockers.length === 1 ? 'es imprescindible y no puede' : 'son imprescindibles y no pueden'}.` : ''
    }`;
    btn.title = tooltip;
    btn.setAttribute('aria-label', `${tooltip} Actívalo para cambiar tu disponibilidad.`);

    const badge = btn.querySelector('.calDayBadge');
    badge.textContent = totalResponses > 0 ? `${formatScore(scores[day] || 0)}/${totalResponses}` : '';
  }

  function drawBestBox(bestBox, { best, responses: currentResponses, blockedBy }) {
    if (!best) {
      bestBox.innerHTML = `<p class="sub" style="margin:0;">El rango de fechas es más corto que la duración del viaje.</p>`;
      return;
    }
    const max = board.tripLength * currentResponses.length;
    // Si la MEJOR ventana sigue teniendo días bloqueados es que no queda
    // ninguna limpia en todo el rango: hay que decirlo, porque la propuesta
    // que se está enseñando no vale tal cual.
    const blockers = best.blockedDays > 0 ? blockersInWindow(blockedBy, best.start, best.end) : [];
    bestBox.innerHTML = `
      <div class="eyebrow">MEJOR VENTANA · ${board.tripLength} DÍAS</div>
      <div class="bestDates">${monthShort(best.start)} ${dayNum(best.start)} — ${monthShort(best.end)} ${dayNum(best.end)}</div>
      <div class="bestMeta">Puntuación ${formatScore(best.sum)} de ${max} máx. · ${best.fullCount} disponibilidades completas</div>
      ${blockers.length
        ? `<div class="bestBlocked">⚠️ No queda ninguna ventana libre: aquí ${blockers.length === 1 ? 'falla' : 'fallan'} ${blockers.map(escapeHtml).join(', ')} (${best.blockedDays} ${best.blockedDays === 1 ? 'día bloqueado' : 'días bloqueados'}).</div>`
        : ''}`;
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
        el(`<div class="altRow${w.blockedDays > 0 ? ' blocked' : ''}">
          <span>${monthShort(w.start)} ${dayNum(w.start)} — ${monthShort(w.end)} ${dayNum(w.end)}${
            w.blockedDays > 0 ? ' · bloqueada' : ''
          }</span>
          <span class="altScore">Puntuación ${formatScore(w.sum)}</span>
        </div>`)
      );
    }
  }

  function drawRoster(rosterEl, { dates, responses: currentResponses, myUid }) {
    for (const r of currentResponses) {
      const isMine = r.uid === myUid;
      const isEssential = !!essentials[r.uid];
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
            isEssential ? ' <span class="essentialBadge" title="Sin esta persona no hay viaje: los días que marque como no disponible quedan bloqueados">imprescindible</span>' : ''
          }</span>
          <span class="rosterRight">
            <span class="rosterStats">${full} disponible${full === 1 ? '' : 's'} · ${partial} parcial${partial === 1 ? '' : 'es'} · ${unavailable} no disponible${unavailable === 1 ? '' : 's'}</span>
            ${isOwner ? `<button type="button" class="ghost small essentialBtn" ${boardBusy ? 'disabled' : ''} title="Sin esta persona no hay viaje: los días que marque como no disponible quedan bloqueados">${isEssential ? 'Imprescindible ✓' : 'Imprescindible'}</button>` : ''}
            ${isOwner && !isMine ? '<button type="button" class="ghost small danger removeBtn">Quitar</button>' : ''}
          </span>
        </div>`);
      if (isOwner) {
        row.querySelector('.essentialBtn').addEventListener('click', () => onToggleEssential(r.uid));
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

/** Compara dos mapas "uid -> true" por su conjunto de claves. */
function sameKeys(a, b) {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => k in b);
}

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
