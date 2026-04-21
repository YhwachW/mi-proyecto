// ─── PANEL DE ADMINISTRACIÓN SAAS ────────────────────────────
// Contiene toda la lógica del panel de admin: KPIs, gráfico de
// ingresos, gestión de cuentas y log de auditoría.

declare const Chart: any;
import { $ } from './helpers';

const BASE = 'http://localhost:3001';
const clp  = (v: number) =>
  new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(v);

let adminRevenueChart: any = null;

// ─── STATUS HELPERS ───────────────────────────────────────────
const statusBadge = (status: string, daysLeft: number | null) => {
  if (status === 'expired') return '<span class="admin-badge expired">Expirada</span>';
  if (status === 'grace')   return '<span class="admin-badge grace">En Gracia</span>';
  if (daysLeft !== null && daysLeft <= 7) return '<span class="admin-badge at-risk">Por Vencer</span>';
  return '<span class="admin-badge active">Activa</span>';
};

const daysBar = (daysLeft: number | null, graceDaysLeft: number | null, status: string) => {
  if (status === 'grace') {
    const pct = Math.max(0, Math.min(100, ((graceDaysLeft ?? 0) / 90) * 100));
    return `<div class="days-bar-wrap"><div class="days-bar grace-bar" style="width:${pct}%"></div></div>
            <span class="days-label">${graceDaysLeft ?? 0}d gracia</span>`;
  }
  if (daysLeft !== null) {
    const pct = Math.max(0, Math.min(100, (daysLeft / 30) * 100));
    const color = daysLeft <= 7 ? 'var(--amber)' : 'var(--green)';
    return `<div class="days-bar-wrap"><div class="days-bar" style="width:${pct}%;background:${color}"></div></div>
            <span class="days-label">${daysLeft}d restantes</span>`;
  }
  return '—';
};

// ─── RENDER ADMIN TABLE ───────────────────────────────────────
const renderAccountsTable = (accounts: any[], onAction: (id: string, action: string) => void) => {
  const tbody = $('admin-accounts-body');
  tbody.innerHTML = accounts.map(a => `
    <tr class="admin-account-row ${a.status}">
      <td>
        <div class="admin-company-name">${a.name}</div>
        <div class="admin-company-email">${a.email}</div>
      </td>
      <td><code>${a.rut}</code></td>
      <td><span class="plan-chip">${a.plan}</span></td>
      <td>${a.subscriptionExpiry ?? '—'}</td>
      <td>${daysBar(a.daysLeft, a.graceDaysLeft, a.status)}</td>
      <td>${statusBadge(a.status, a.daysLeft)}</td>
      <td>${clp(a.price ?? 0)}</td>
      <td class="admin-actions-cell">
        ${a.status !== 'active'
          ? `<button class="btn-admin-action activate" data-id="${a.id}" data-action="activate">
               <i class="fas fa-play"></i> Activar
             </button>`
          : `<button class="btn-admin-action suspend" data-id="${a.id}" data-action="suspend">
               <i class="fas fa-pause"></i> Suspender
             </button>`
        }
        <button class="btn-admin-action extend" data-id="${a.id}" data-action="extend">
          <i class="fas fa-calendar-plus"></i> +30d
        </button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.btn-admin-action').forEach(btn => {
    btn.addEventListener('click', () => {
      const id     = (btn as HTMLElement).dataset.id!;
      const action = (btn as HTMLElement).dataset.action!;
      onAction(id, action);
    });
  });
};

// ─── RENDER AUDIT LOG ─────────────────────────────────────────
const renderAuditLog = (log: any[]) => {
  const tbody = $('admin-audit-body');
  if (!log.length) { tbody.innerHTML = '<tr><td colspan="4" class="table-loading">Sin eventos recientes</td></tr>'; return; }
  tbody.innerHTML = log.map(e => {
    const d = new Date(e.ts);
    const timeStr = d.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const actionClass =
      e.action.includes('PAGO')        ? 'audit-pago'    :
      e.action.includes('SUSPEND')     ? 'audit-suspend' :
      e.action.includes('REACTIV')     ? 'audit-ok'      :
      e.action.includes('EXPIR')       ? 'audit-expired' : 'audit-neutral';
    return `<tr>
      <td class="audit-ts">${timeStr}</td>
      <td><span class="audit-badge ${actionClass}">${e.action}</span></td>
      <td>${e.target}</td>
      <td>${e.actor}</td>
    </tr>`;
  }).join('');
};

// ─── RENDER REVENUE CHART ─────────────────────────────────────
const renderRevenueChart = (history: { label: string; revenue: number }[]) => {
  if (adminRevenueChart) { adminRevenueChart.destroy(); adminRevenueChart = null; }
  const ctx = ($('admin-revenue-chart') as HTMLCanvasElement).getContext('2d')!;
  adminRevenueChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: history.map(h => h.label),
      datasets: [{
        label: 'MRR (CLP)',
        data: history.map(h => h.revenue),
        backgroundColor: history.map((_, i) => i === history.length - 1 ? '#6d28d9' : '#3b82f6'),
        borderRadius: 5,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c: any) => ` ${clp(c.raw)}` } }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', font: { family: 'Inter', size: 10 } }, border: { color: 'transparent' } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', font: { family: 'Inter', size: 10 }, callback: (v: number) => clp(v) }, border: { color: 'transparent' } }
      }
    }
  });
};

// ─── LOAD ADMIN DATA ──────────────────────────────────────────
const loadAdminData = async () => {
  const d = await fetch(`${BASE}/api/admin/accounts`).then(r => r.json());

  // KPIs
  $('admin-kpi-total').innerText  = String(d.kpis.total);
  $('admin-kpi-active').innerText = String(d.kpis.active);
  $('admin-kpi-mrr').innerText    = clp(d.kpis.mrr);
  $('admin-kpi-grace').innerText  = String(d.kpis.grace);
  $('admin-kpi-risk').innerText   = String(d.kpis.atRisk);

  renderRevenueChart(d.revenueHistory);
  renderAccountsTable(d.accounts, handleAdminAction);
  renderAuditLog(d.auditLog);
};

// ─── HANDLE ACTIONS ───────────────────────────────────────────
const handleAdminAction = async (companyId: string, action: string) => {
  if (action === 'extend') {
    await fetch(`${BASE}/api/admin/extend`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId })
    });
  } else {
    await fetch(`${BASE}/api/admin/toggle-status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId, action })
    });
  }
  await loadAdminData(); // Refresh table
};

// ─── INIT ADMIN PANEL ─────────────────────────────────────────
export const initAdminPanel = async () => {
  await loadAdminData();
  // Auto-refresh every 30s
  setInterval(loadAdminData, 30_000);
};

export const destroyAdminPanel = () => {
  if (adminRevenueChart) { adminRevenueChart.destroy(); adminRevenueChart = null; }
};
