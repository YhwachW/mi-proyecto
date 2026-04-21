// ─── MÓDULO DE TABLA DE REPOSICIÓN ───────────────────────────
// Renderiza la tabla de "Sugerencias de Reposición Inteligente"
// con barras de cobertura de stock y badges de urgencia.

import { $, formatNum, PALETTE } from './helpers';

/**
 * Renderiza las filas de la tabla de reposición a partir del array
 * de alertas devuelto por /api/metrics.
 *
 * Columnas: Producto | Bodega | Demanda Mensual | A Comprar | Cobertura | Estado
 */
export function renderRestockTable(alerts: any[]) {
  const tbody = $('restock-table-body');
  tbody.innerHTML = '';

  alerts.forEach((a: any) => {
    const coveragePct = a.monthlyDemand > 0
      ? Math.min(Math.round((a.currentStock / a.monthlyDemand) * 100), 100)
      : 100;

    // Color y badge según estado de urgencia
    let barColor   = PALETTE.green;
    let badgeClass = 'badge-success';

    if (a.status === 'Agotado' || a.status === 'Crítico') {
      barColor = PALETTE.red; badgeClass = 'badge-urgent';
    } else if (a.status === 'Moderado') {
      barColor = PALETTE.amber; badgeClass = 'badge-warning';
    }

    const orderCell = a.suggestedOrder > 0
      ? `<span style="color:${PALETTE.amber};font-weight:700">+${formatNum(a.suggestedOrder)} u.</span>`
      : `<span style="color:var(--text-muted)">—</span>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong style="color:var(--text-primary)">${a.product}</strong></td>
      <td>${formatNum(a.currentStock)} u.</td>
      <td>${formatNum(a.monthlyDemand)} u.</td>
      <td>${orderCell}</td>
      <td>
        <div class="coverage-bar-wrap">
          <div class="coverage-bar">
            <div class="coverage-fill" style="width:${coveragePct}%;background:${barColor}"></div>
          </div>
          <span class="coverage-label" style="color:${barColor}">${coveragePct}%</span>
        </div>
      </td>
      <td><span class="badge ${badgeClass}">${a.status}</span></td>
    `;
    tbody.appendChild(tr);
  });
}
