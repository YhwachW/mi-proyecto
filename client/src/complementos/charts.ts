// ─── MÓDULO DE GRÁFICOS ──────────────────────────────────────
// Contiene la lógica de renderizado de los dos gráficos Chart.js:
//   1. Donut — Mix de ingresos por tipo de jornada
//   2. Barras Horizontales — Top 10 productos por volumen vendido

declare const Chart: any;

import { $, formatCLP, formatNum, PALETTE, chartDefaults } from './helpers';

// Instancias reutilizables (se destruyen antes de redibujar)
let chartDonut: any    = null;
let chartTopProds: any = null;

/**
 * Renderiza el gráfico Donut de mix de ingresos.
 * Muestra la distribución porcentual de facturación por tipo de día.
 */
export function renderDonut(demographics: any) {
  const data = [
    demographics.weekday.revenue,
    demographics.weekend.revenue,
    demographics.holiday.revenue,
  ];
  const total  = data.reduce((a, b) => a + b, 0);
  const labels = ['Día Laboral', 'Fin de Semana', 'Feriado'];
  const colors = [PALETTE.blue, PALETTE.purple, PALETTE.red];

  if (chartDonut) chartDonut.destroy();
  const ctx = ($('dayTypeChart') as HTMLCanvasElement).getContext('2d')!;

  chartDonut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }],
    },
    options: {
      responsive: true,
      cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx: any) =>
              ` ${formatCLP(ctx.raw)} (${((ctx.raw / total) * 100).toFixed(1)}%)`,
          },
        },
      },
    },
  });

  // Leyenda personalizada con porcentajes reales
  const legend = $('donut-legend');
  legend.innerHTML = labels.map((lbl, i) => `
    <div class="donut-legend-item">
      <span class="donut-legend-label">
        <span class="donut-dot" style="background:${colors[i]}"></span>
        ${lbl}
      </span>
      <span class="donut-value">${((data[i] / total) * 100).toFixed(1)}%</span>
    </div>
  `).join('');
}

/**
 * Renderiza el gráfico de barras horizontales con el ranking de
 * los 10 productos más vendidos por volumen (unidades).
 */
export function renderTopProducts(topProducts: any[]) {
  const labels = topProducts.map((p: any) =>
    p.name.length > 16 ? p.name.slice(0, 14) + '…' : p.name
  );
  const data      = topProducts.map((p: any) => p.sold);
  const barColors = [
    PALETTE.purple, PALETTE.blue, PALETTE.cyan, PALETTE.green,
    PALETTE.amber,  PALETTE.pink, PALETTE.red,
    '#a78bfa', '#60a5fa', '#34d399',
  ];

  if (chartTopProds) chartTopProds.destroy();
  const ctx = ($('topProductsChart') as HTMLCanvasElement).getContext('2d')!;

  chartTopProds = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Unidades Vendidas',
        data,
        backgroundColor: barColors.slice(0, data.length),
        borderRadius: 5,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (ctx: any) => ` ${formatNum(ctx.raw)} unidades` },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: chartDefaults().color, font: { family: 'Inter' } },
          border: { color: 'transparent' },
        },
        y: {
          grid: { display: false },
          ticks: { color: chartDefaults().color, font: { family: 'Inter', size: 11 } },
          border: { color: 'transparent' },
        },
      },
    },
  });
}

/** Destruye ambas instancias de gráficos (para uso en logout) */
export function destroyCharts() {
  if (chartDonut)    { chartDonut.destroy();    chartDonut    = null; }
  if (chartTopProds) { chartTopProds.destroy(); chartTopProds = null; }
}
