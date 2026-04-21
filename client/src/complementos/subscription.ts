// ─── MÓDULO DE SUSCRIPCIÓN (empresa) ─────────────────────────
// Muestra el estado del plan de la empresa, días restantes,
// historial de pagos y permite renovar con un clic.

import { $ }   from './helpers';
import { api }  from './api';

const BASE = 'http://localhost:3001';

const clp = (v: number) =>
  new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(v);

// ─── SUSPENSION OVERLAY ───────────────────────────────────────
/**
 * Mounts or unmounts the suspension blur overlay.
 * When grace=true, blurs the ERP content and shows the payment banner.
 */
export const setSuspensionOverlay = (
  status: string,
  graceDaysLeft: number,
  expiry: string,
  onPay: () => void
) => {
  const overlay = $('suspension-overlay');
  const erpContent = $('erp-content');

  if (status === 'grace' || status === 'expired') {
    overlay.classList.remove('hidden');
    erpContent?.classList.add('blurred');

    $('suspension-expiry-date').innerText  = expiry;
    $('suspension-days-remaining').innerText = String(Math.max(0, graceDaysLeft));

    if (status === 'expired') {
      overlay.innerHTML = `
        <div class="suspension-card">
          <div class="suspension-icon">🔒</div>
          <h2 class="suspension-title">Cuenta Expirada</h2>
          <p class="suspension-sub">
            El período de gracia de 90 días ha concluido.<br>
            Contacta a soporte para recuperar tu cuenta.
          </p>
          <a href="mailto:soporte@omnierp.cl" class="btn-suspension-pay">
            <i class="fas fa-envelope"></i> Contactar Soporte
          </a>
        </div>`;
    } else {
      $('suspension-days-remaining').innerText = String(graceDaysLeft);
      $('btn-suspension-pay')?.addEventListener('click', onPay);
    }
  } else {
    overlay.classList.add('hidden');
    erpContent?.classList.remove('blurred');
  }
};

export const clearSuspensionOverlay = () => {
  $('suspension-overlay').classList.add('hidden');
  $('erp-content')?.classList.remove('blurred');
};

// ─── SUBSCRIPTION VIEW ────────────────────────────────────────
export const initSubscriptionView = async (companyId: string, onPaySuccess: () => void) => {
  try {
    const d = await api.subscription(companyId);
    renderSubscriptionInfo(d, companyId, onPaySuccess);
  } catch (e) {
    console.error('Subscription load error:', e);
  }
};

const renderSubscriptionInfo = (d: any, companyId: string, onPaySuccess: () => void) => {
  const statusLabel: Record<string, string> = {
    active:  '✅ Activa',
    grace:   '⚠️ En Período de Gracia',
    expired: '🔒 Expirada',
  };
  const statusClass: Record<string, string> = { active: 'sub-active', grace: 'sub-grace', expired: 'sub-expired' };

  // Progress bar: days left vs 30 total
  const pct = d.status === 'grace'
    ? Math.max(0, Math.min(100, (d.graceDaysLeft / 90) * 100))
    : Math.max(0, Math.min(100, (Math.max(0, d.daysLeft) / 30) * 100));

  const barColor = d.status === 'grace' ? 'var(--amber)' : d.daysLeft <= 7 ? 'var(--red)' : 'var(--green)';

  $('subscription-view').innerHTML = `
    <section class="card sub-plan-card">
      <div class="sub-header">
        <div>
          <h3><i class="fas fa-crown"></i> Suscripción OmniAnalytics</h3>
          <p class="chart-subtitle">Gestiona tu plan y pagos aquí</p>
        </div>
        <span class="sub-status-badge ${statusClass[d.status]}">${statusLabel[d.status] ?? d.status}</span>
      </div>

      <div class="sub-plan-grid">
        <div class="sub-info-block">
          <div class="sub-info-label">Plan</div>
          <div class="sub-info-value plan-chip">${d.plan ?? 'Pro'}</div>
        </div>
        <div class="sub-info-block">
          <div class="sub-info-label">Precio mensual</div>
          <div class="sub-info-value">${clp(d.price ?? 14990)}</div>
        </div>
        <div class="sub-info-block">
          <div class="sub-info-label">Vence el</div>
          <div class="sub-info-value">${d.subscriptionExpiry ?? '—'}</div>
        </div>
        <div class="sub-info-block">
          <div class="sub-info-label">${d.status === 'grace' ? 'Días de gracia restantes' : 'Días restantes'}</div>
          <div class="sub-info-value sub-days-big">${d.status === 'grace' ? d.graceDaysLeft : Math.max(0, d.daysLeft)}</div>
        </div>
      </div>

      <div class="sub-progress-wrap">
        <div class="sub-progress-bar">
          <div class="sub-progress-fill" style="width:${pct}%;background:${barColor}"></div>
        </div>
        <div class="sub-progress-labels">
          <span>${d.status === 'grace' ? `${d.graceDaysLeft} días de gracia de 90` : `${Math.max(0, d.daysLeft)} días restantes de 30`}</span>
          <span>${d.subscriptionExpiry}</span>
        </div>
      </div>

      ${(d.status === 'grace' || (d.status === 'active' && d.daysLeft <= 15))
        ? `<button id="btn-renew-sub" class="btn-renew">
             <i class="fas fa-credit-card"></i>
             Renovar Suscripción — ${clp(d.price ?? 14990)} / 30 días
           </button>` : ''
      }
    </section>

    <section class="card sub-history-card">
      <div class="sub-header">
        <h3><i class="fas fa-receipt"></i> Historial de Pagos</h3>
      </div>
      <div class="table-container">
        <table>
          <thead><tr><th>Fecha</th><th>Período</th><th>Monto</th><th>Estado</th></tr></thead>
          <tbody>
            ${(d.paymentHistory ?? []).map((p: any) => `
              <tr>
                <td>${p.date}</td>
                <td>${p.period}</td>
                <td><strong>${clp(p.amount)}</strong></td>
                <td><span class="badge badge-success">Pagado</span></td>
              </tr>
            `).join('') || '<tr><td colspan="4" class="table-loading">Sin pagos registrados</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `;

  $('btn-renew-sub')?.addEventListener('click', async () => {
    const btn = $('btn-renew-sub') as HTMLButtonElement;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando pago…';
    try {
      const r = await fetch(`${BASE}/api/subscription/pay`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId })
      }).then(res => res.json());
      if (r.success) {
        onPaySuccess();
        await initSubscriptionView(companyId, onPaySuccess); // refresh view
      }
    } catch (e) { console.error(e); }
    finally { btn.disabled = false; }
  });
};
