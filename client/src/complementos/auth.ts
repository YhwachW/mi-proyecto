// ─── MÓDULO DE AUTENTICACIÓN Y SIDEBAR ───────────────────────
// Gestiona el flujo de login / logout y la construcción
// dinámica del menú lateral según la empresa autenticada.
// Incluye rutas hacia el panel de Admin y control de suscripciones.

import { $, formatCLP, formatNum } from './helpers';
import { api } from './api';
import {
  setCurrentModule, setCompanyId, setCompanyName, setFiscalContext,
  setAuthToken,
  currentModule, companyNameContext,
} from './state';
import { renderDonut, renderTopProducts, destroyCharts } from './charts';
import { renderRestockTable } from './restock';
import { renderCalendar } from './calendar';
import { renderAIInsights } from './aiInsights';
import { startChangeWatcher, stopChangeWatcher } from './watcher';
import { initProductsView, destroyProductsView } from './products';
import { initSIIView } from './sii';
import { initAdminPanel, destroyAdminPanel } from './admin';
import { initSubscriptionView, setSuspensionOverlay, clearSuspensionOverlay } from './subscription';

// Referencia al intervalo de polling de 5 min
let pollingIntervalId: ReturnType<typeof setInterval> | null = null;

// ─── DASHBOARD UPDATE ─────────────────────────────────────────
export const updateDashboard = async () => {
  try {
    const data = await api.metrics();
    if (!data) return;

    $('kpi-revenue').innerText     = formatCLP(data.kpis.revenue);
    $('kpi-tx').innerText          = formatNum(data.kpis.transactions);
    $('kpi-avg-holiday').innerText = formatCLP(data.demographics.holiday.avgTicket);
    $('kpi-avg-weekday').innerText = formatCLP(data.demographics.weekday.avgTicket);

    renderDonut(data.demographics);
    renderTopProducts(data.topProducts);
    if (data.restockAlerts) renderRestockTable(data.restockAlerts);
    renderAIInsights();
  } catch (err) {
    console.error('Dashboard update failed:', err);
  }
};

// ─── SIDEBAR ──────────────────────────────────────────────────

/** Alterna entre las cuatro vistas principales de la app */
const showView = (view: 'dashboard' | 'products' | 'sii' | 'subscription') => {
  $('dashboard-view').style.display    = view === 'dashboard'    ? '' : 'none';
  $('products-view').style.display     = view === 'products'     ? '' : 'none';
  $('sii-view').style.display          = view === 'sii'          ? '' : 'none';
  $('subscription-view').style.display = view === 'subscription' ? '' : 'none';
  document.querySelectorAll('.nav-main-btn').forEach(b => b.classList.remove('active'));
  $(`nav-${view}`)?.classList.add('active');
};

/** Construye el menú lateral dinámicamente una vez autenticado */
const buildSidebar = () => {
  const iconMap: Record<string, string> = {
    'Botillería':       'fa-wine-bottle',
    'Supermercado':     'fa-basket-shopping',
    'Platos de Comida': 'fa-utensils',
    'all':              'fa-chart-pie',
  };
  const icon  = iconMap[currentModule] ?? 'fa-briefcase';
  const label = currentModule === 'all' ? 'Panel General' : `Panel — ${currentModule}`;

  $('sidebar-menu').innerHTML = `
    <button class="nav-btn nav-main-btn active" id="nav-dashboard">
      <i class="fas ${icon}"></i> ${label}
    </button>
    <button class="nav-btn nav-main-btn" id="nav-products">
      <i class="fas fa-barcode"></i> Ingreso de Stock
    </button>
    <button class="nav-btn nav-main-btn" id="nav-sii">
      <i class="fas fa-file-invoice"></i> Informes SII
    </button>
    <div class="nav-divider"></div>
    <button class="nav-btn nav-main-btn nav-subscription" id="nav-subscription">
      <i class="fas fa-crown"></i> Mi Suscripción
    </button>
  `;

  $('nav-dashboard')?.addEventListener('click',    () => showView('dashboard'));
  $('nav-products')?.addEventListener('click',     () => showView('products'));
  $('nav-sii')?.addEventListener('click',          () => showView('sii'));
  $('nav-subscription')?.addEventListener('click', () => showView('subscription'));

  // Iniciales de la empresa
  const initials = (companyNameContext ?? '?')
    .split(/\s+/).map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
  $('company-avatar').innerText = initials;
  ($('company-name-sidebar') as HTMLElement).innerText = companyNameContext ?? '';
};

// ─── LOGIN (company) ──────────────────────────────────────────
export const initLogin = () => {
  $('btn-login')?.addEventListener('click', async () => {
    const email = ($('login-email') as HTMLInputElement).value.trim();
    const pass  = ($('login-pass')  as HTMLInputElement).value.trim();
    const errEl = $('login-error');

    try {
      const d = await api.login(email, pass);

      if (d.success) {
        errEl.style.display = 'none';
        setCompanyId(d.companyId);
        setAuthToken(d.token);
        setCompanyName(d.company);
        setCurrentModule(d.defaultModule);
        setFiscalContext(d.fiscal || null);

        // Check subscription status
        let subStatus = 'active';
        let graceDaysLeft = 90;
        let expiry = '';
        try {
          const sub = await api.subscription(d.token);
          subStatus     = sub.status;
          graceDaysLeft = sub.graceDaysLeft;
          expiry        = sub.subscriptionExpiry ?? '';

          // Block login if expired (>90 days grace)
          if (subStatus === 'expired') {
            errEl.innerHTML = '<i class="fas fa-lock"></i> Cuenta expirada. Contacta soporte@omnierp.cl';
            errEl.style.display = 'flex';
            return;
          }
        } catch (_) { /* if sub check fails, allow in */ }

        $('login-screen').classList.add('hidden');
        $('erp-app').classList.remove('hidden');
        $('tenant-name').innerText = d.company;

        buildSidebar();
        await updateDashboard();
        await renderCalendar();
        await initProductsView(d.companyId, updateDashboard);
        initSIIView(d.companyId, d.fiscal || {});
        initSubscriptionView(d.companyId, () => {
          clearSuspensionOverlay();
          updateDashboard();
        });

        // Apply suspension overlay if in grace
        if (subStatus === 'grace') {
          setSuspensionOverlay(subStatus, graceDaysLeft, expiry, async () => {
            const r = await fetch('http://localhost:3001/api/subscription/pay', {
              method: 'POST', 
              headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${d.token}`
              },
              body: JSON.stringify({ companyId: d.companyId })
            }).then(res => res.json());
            if (r.success) clearSuspensionOverlay();
          });
        }

        pollingIntervalId = setInterval(updateDashboard, 5 * 60 * 1000);
        startChangeWatcher(updateDashboard);
      } else {
        errEl.style.display = 'flex';
      }
    } catch (e) {
      console.error('Login error:', e);
      $('login-error').style.display = 'flex';
    }
  });

  // Admin login button (on the same login screen)
  $('btn-admin-login')?.addEventListener('click', async () => {
    const email = ($('login-email') as HTMLInputElement).value.trim();
    const pass  = ($('login-pass')  as HTMLInputElement).value.trim();
    try {
      const d = await api.adminLogin(email, pass);
      if (d.success) {
        setAuthToken(d.token);
        $('login-screen').classList.add('hidden');
        $('admin-panel').classList.remove('hidden');
        $('admin-name-display').innerText = d.adminName;
        initAdminPanel();
      } else {
        $('login-error').innerHTML = '<i class="fas fa-shield-xmark"></i> Credenciales de administrador inválidas';
        $('login-error').style.display = 'flex';
      }
    } catch (e) {
      console.error('Admin login error:', e);
    }
  });
};

// ─── LOGOUT ───────────────────────────────────────────────────
export const initLogout = () => {
  $('btn-logout')?.addEventListener('click', () => {
    if (pollingIntervalId) clearInterval(pollingIntervalId);
    stopChangeWatcher();
    pollingIntervalId = null;

    setCompanyId(null);
    setCompanyName(null);
    setCurrentModule('all');
    setFiscalContext(null);
    destroyCharts();
    destroyProductsView();
    clearSuspensionOverlay();
    $('sii-preview').innerHTML = '';
    $('sii-preview').style.display = 'none';
    $('btn-print-sii').style.display = 'none';

    ($('login-pass') as HTMLInputElement).value = '';
    $('login-screen').classList.remove('hidden');
    $('erp-app').classList.add('hidden');
  });

  // Admin logout
  $('btn-admin-logout')?.addEventListener('click', () => {
    destroyAdminPanel();
    $('admin-panel').classList.add('hidden');
    $('login-screen').classList.remove('hidden');
    ($('login-pass') as HTMLInputElement).value = '';
  });
};
