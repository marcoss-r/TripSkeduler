// Vista de creación de tablero (sin grupo — Fase 9 añadirá "crear dentro
// de un grupo"). Formulario tomado del prototipo, con validaciones y
// pantalla de "compartir enlace" al terminar.

import { getStore } from '../data/store.js';
import { el, renderErrorBanner } from './components.js';
import { fmtDate, addDays, isValidRange, dateRangeArray } from '../core/dates.js';

export function renderSetup(app) {
  app.innerHTML = '';
  const today = fmtDate(new Date());
  const in45 = fmtDate(addDays(new Date(), 45));

  const view = el(`
    <div class="wrap">
      <div class="eyebrow">TABLERO DE SALIDAS</div>
      <h1>¿Cuándo hacemos<br>el viaje?</h1>
      <p class="sub">Define una ventana de fechas, compártela con tu grupo y que cada uno marque su disponibilidad. El tablero calcula solo los mejores días.</p>
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
        const store = getStore();
        const boardId = await store.createBoard({ tripName, startDate, endDate, tripLength });
        history.replaceState(null, '', `?b=${boardId}`);
        renderShareScreen(view, { boardId, tripName });
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
      return 'El rango de fechas es demasiado largo (máximo 120 días).';
    default:
      return 'Revisa las fechas introducidas.';
  }
}

function renderShareScreen(view, { boardId, tripName }) {
  const url = `${location.origin}${location.pathname}?b=${boardId}`;
  view.innerHTML = `
    <div class="eyebrow">TABLERO CREADO</div>
    <h1>${escapeForTitle(tripName)}</h1>
    <p class="sub">Comparte este enlace con tu grupo. Cada persona lo abre y marca su disponibilidad.</p>
    <div class="panel">
      <div class="shareBox">
        <input type="text" id="shareUrl" readonly value="${url}">
        <button type="button" id="copyBtn">Copiar enlace</button>
      </div>
      <button type="button" id="continueBtn" class="ghost">Ir al tablero</button>
    </div>`;

  view.querySelector('#copyBtn').addEventListener('click', async () => {
    const input = view.querySelector('#shareUrl');
    const btn = view.querySelector('#copyBtn');
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = 'Copiado ✓';
      setTimeout(() => (btn.textContent = 'Copiar enlace'), 1500);
    } catch {
      input.select();
      btn.textContent = 'Selecciona y copia (Ctrl/Cmd+C)';
    }
  });

  view.querySelector('#continueBtn').addEventListener('click', () => {
    location.reload();
  });
}

function escapeForTitle(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
