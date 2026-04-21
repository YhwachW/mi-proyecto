// ─── MÓDULO DE CALENDARIO PREDICTIVO + MODAL ─────────────────
// Gestiona el calendario mensual de tráfico y el modal flotante
// de pronóstico de materiales por día (fecha seleccionada).

import { $, formatNum, PALETTE } from './helpers';
import { api } from './api';

// Estado interno del calendario
let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth() + 1;
let selectedDate: string | null = null;

// ─── MODAL ───────────────────────────────────────────────────

const dayTypeLabel = (t: string) =>
  ({ holiday: '🎉 Festivo', weekend: '📅 Fin de Semana', weekday: '💼 Día Laboral' })[t] ?? t;

/**
 * Abre el modal de pronóstico para la fecha indicada.
 * Llama a /api/forecast y rellena la tabla con las necesidades del día.
 */
export const openModal = async (dateStr: string) => {
  const modal      = $('forecast-modal');
  const modalTitle = $('modal-title');
  const modalSub   = $('modal-subtitle');
  const modalBody  = $('modal-table-body');

  modal.classList.remove('hidden');
  modalTitle.innerText = `Pronóstico — ${dateStr}`;
  modalSub.innerText   = 'Calculando inteligencia de negocio…';
  modalBody.innerHTML  = '<tr><td colspan="5" class="table-loading">Analizando demanda histórica…</td></tr>';

  try {
    const d = await api.forecast(dateStr);
    modalSub.innerText = `${dayTypeLabel(d.dayType)} · ${d.forecast.length} productos analizados`;
    modalBody.innerHTML = '';

    d.forecast.forEach((a: any) => {
      let bdg = 'badge-success';
      if (a.status === 'Agotado') bdg = 'badge-urgent';
      if (a.status === 'Faltará Material') bdg = 'badge-warning';

      const orderCell = a.suggestedOrder > 0
        ? `<span style="color:${PALETTE.amber};font-weight:700">+${formatNum(a.suggestedOrder)} u.</span>`
        : '<span style="color:var(--text-muted)">—</span>';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${a.product}</strong></td>
        <td>${formatNum(a.currentStock)} u.</td>
        <td>~${formatNum(a.dailyDemand)} u.</td>
        <td>${orderCell}</td>
        <td><span class="badge ${bdg}">${a.status}</span></td>
      `;
      modalBody.appendChild(tr);
    });
  } catch (e) { console.error('Error en modal:', e); }
};

/** Cierra el modal y deselecciona el día activo */
export const closeModal = () => {
  $('forecast-modal').classList.add('hidden');
  selectedDate = null;
  document.querySelectorAll('.exec-day').forEach(el => el.classList.remove('selected'));
};

// ─── CALENDARIO ───────────────────────────────────────────────

/**
 * Solicita los datos del mes al backend y renderiza la grilla
 * del calendario con scores de tráfico y vol. esperado por día.
 */
export const renderCalendar = async () => {
  try {
    const d = await api.calendar(calYear, calMonth);

    // Encabezado del mes
    const lbl = new Date(calYear, calMonth - 1, 1)
      .toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
      .replace(/^\w/, c => c.toUpperCase());
    $('current-month-label').innerText = lbl;

    // Limpiar celdas antiguas (mantener encabezados de días)
    document.querySelectorAll('.exec-day').forEach(el => el.remove());
    const grid = $('executive-grid');

    // Celdas vacías de offset inicial
    for (let i = 0; i < d.firstDayOffset; i++) {
      const blank = document.createElement('div');
      blank.className = 'exec-day empty';
      grid.appendChild(blank);
    }

    // Celdas de días con datos
    d.days.forEach((day: any) => {
      const cell = document.createElement('div');
      cell.className = `exec-day score-${day.score}${selectedDate === day.date ? ' selected' : ''}`;
      cell.innerHTML = `
        <span class="day-num">${day.day}</span>
        <div>
          <div class="vol-hint">📦 ~${day.expectedItems} u.</div>
          <div class="day-status">${day.label}</div>
        </div>
      `;
      cell.addEventListener('click', () => {
        selectedDate = day.date;
        document.querySelectorAll('.exec-day').forEach(el => el.classList.remove('selected'));
        cell.classList.add('selected');
        openModal(day.date);
      });
      grid.appendChild(cell);
    });
  } catch (e) { console.error('Error en calendar:', e); }
};

/** Navega al mes anterior */
export const prevMonth = () => {
  calMonth === 1 ? (calMonth = 12, calYear--) : calMonth--;
  renderCalendar();
};

/** Navega al mes siguiente */
export const nextMonth = () => {
  calMonth === 12 ? (calMonth = 1, calYear++) : calMonth++;
  renderCalendar();
};
