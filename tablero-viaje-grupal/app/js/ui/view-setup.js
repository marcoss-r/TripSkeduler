// Vista de creación de tablero: suelto (desde el inicio) o dentro de un
// grupo (Fase 9, `?g=<id>&crear=1` — `group` llega con `{groupId, name}`).
// Formulario tomado del prototipo, con validaciones y pantalla de
// "compartir enlace" al terminar.

import { getStore } from '../data/store.js';
import { el, renderErrorBanner, appUrl, renderShareBox, shareableUrl } from './components.js';
import { fmtDate, addDays, isValidRange, dateRangeArray, MAX_RANGE_DAYS } from '../core/dates.js';

export function renderSetup(app, { group } = {}) {
  app.innerHTML = '';
  const today = fmtDate(new Date());
  const in45 = fmtDate(addDays(new Date(), 45));

  const view = el(`
    <div class="wrap">
      <div class="eyebrow">${group ? `GRUPO · ${escapeForTitle(group.name).toUpperCase()}` : 'TABLERO DE SALIDAS'}</div>
      <h1>${group ? 'Nuevo viaje<br>del grupo' : '¿Cuándo hacemos<br>el viaje?'}</h1>
      <p class="sub">${
        group
          ? `Cada miembro de "${escapeForTitle(group.name)}" aparecerá en este tablero con el nombre que ya tiene en el grupo.`
          : 'Define una ventana de fechas, compártela con tu grupo y que cada uno marque su disponibilidad. El tablero calcula solo los mejores días.'
      }</p>
      <div id="formSlot"></div>
    </div>`);
  app.appendChild(view);

  const formSlot = view.querySelector('#formSlot');

  function renderForm() {
    formSlot.innerHTML = '';
    const form = el(`
      <form id="setupForm" class="panel">
        <label>Nombre del viaje
          <input type="text" name="tripName" placeholder="Escapada a Lisboa" required maxlength="80">
        </label>
        <div class="row2">
          <label>Desde<input type="date" name="startDate" value="${today}" required></label>
          <label>Hasta<input type="date" name="endDate" value="${in45}" required></label>
        </div>
        <label>Duración del viaje (días)
          <input type="number" name="tripLength" min="1" max="30" value="5" required>
        </label>
        <button type="submit">Crear tablero</button>
      </form>`);
    formSlot.appendChild(form);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      formSlot.querySelectorAll('.banner').forEach((b) => b.remove());

      const f = e.target;
      const tripName = f.tripName.value.trim() || 'Viaje en grupo';
      const startDate = f.startDate.value;
      const endDate = f.endDate.value;
      const tripLength = Math.max(1, parseInt(f.tripLength.value, 10) || 5);

      const rangeCheck = isValidRange(startDate, endDate);
      if (!rangeCheck.ok) {
        form.prepend(renderErrorBanner(rangeReasonMessage(rangeCheck.reason)));
        return;
      }
      const rangeLength = dateRangeArray(startDate, endDate).length;
      if (tripLength > rangeLength) {
        form.prepend(
          renderErrorBanner(
            `La duración del viaje (${tripLength} días) no puede ser mayor que el rango de fechas (${rangeLength} días).`
          )
        );
        return;
      }

      const submitBtn = form.querySelector('button[type=submit]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creando…';

      try {
        const store = await getStore();
        const groupId = group ? group.groupId : null;
        const boardId = await store.createBoard({ tripName, startDate, endDate, tripLength, groupId });
        await store.rememberBoard(boardId, { tripName, groupId, role: 'owner' });
        history.replaceState(null, '', appUrl(`b=${boardId}`));
        renderShareScreen(view, { boardId, tripName, group });
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Crear tablero';
        form.prepend(renderErrorBanner('No se pudo crear el tablero. Inténtalo de nuevo.'));
        console.error(err);
      }
    });
  }

  renderForm();
}

function rangeReasonMessage(reason) {
  switch (reason) {
    case 'end-before-start':
      return 'La fecha "Hasta" debe ser posterior (o igual) a "Desde".';
    case 'range-too-long':
      return `El rango de fechas es demasiado largo (máximo ${MAX_RANGE_DAYS} días).`;
    default:
      return 'Revisa las fechas introducidas.';
  }
}

function renderShareScreen(view, { boardId, tripName, group }) {
  const url = shareableUrl(`b=${encodeURIComponent(boardId)}`);
  view.innerHTML = `
    <div class="eyebrow">TABLERO CREADO</div>
    <h1>${escapeForTitle(tripName)}</h1>
    <p class="sub">${
      group
        ? `Ya aparece en los viajes de "${escapeForTitle(group.name)}". Cada miembro lo verá con su nombre ya puesto.`
        : 'Comparte este enlace con tu grupo. Cada persona lo abre y marca su disponibilidad. Si lo pierdes, lo tienes siempre dentro del tablero.'
    }</p>
    <div class="panel">
      <div id="shareSlot"></div>
      <button type="button" id="continueBtn" class="ghost">Ir al tablero</button>
      ${group ? `<a href="${appUrl(`g=${group.groupId}`)}" class="ghost small" style="text-align:center;">← Volver al grupo</a>` : ''}
    </div>`;

  view.querySelector('#shareSlot').appendChild(renderShareBox(url));

  view.querySelector('#continueBtn').addEventListener('click', () => {
    location.reload();
  });
}

function escapeForTitle(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
