// ─── CAPA DE API ─────────────────────────────────────────────
// Todas las llamadas HTTP al backend están aquí centralizadas.
// Importa el estado de sesión desde state.ts para construir
// las URLs con los parámetros de autenticación multi-inquilino.

import { currentModule, companyIdContext } from './state';

const BASE = 'http://localhost:3001';

export const api = {
  /** Métricas mensuales del módulo activo para el tenant autenticado */
  metrics: () =>
    fetch(`${BASE}/api/metrics/${encodeURIComponent(currentModule)}?companyId=${companyIdContext}`)
      .then(r => r.json()),

  /** Pronóstico de demanda para una fecha específica */
  forecast: (date: string) =>
    fetch(`${BASE}/api/forecast/${encodeURIComponent(currentModule)}?companyId=${companyIdContext}&date=${date}`)
      .then(r => r.json()),

  /** Calendario mensual con scores de tráfico por día */
  calendar: (year: number, month: number) =>
    fetch(`${BASE}/api/calendar/${year}/${month}?companyId=${companyIdContext}`)
      .then(r => r.json()),

  /** Autenticación de usuario corporativo */
  login: (email: string, password: string) =>
    fetch(`${BASE}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }).then(r => r.json()),

  /** Timestamp de la última modificación de datos (para el change watcher) */
  lastUpdate: () =>
    fetch(`${BASE}/api/last-update`).then(r => r.json()),

  /** Registra una compra: descuenta stock y dispara actualización */
  purchase: (companyId: string, productName: string, quantity: number) =>
    fetch(`${BASE}/api/purchase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId, productName, quantity }),
    }).then(r => r.json()),

  /** Obtiene el catálogo de productos del tenant con barcodes y stock actual */
  products: (companyId: string) =>
    fetch(`${BASE}/api/products?companyId=${companyId}`).then(r => r.json()),

  /** Ingresa stock (recepción de mercadería) — suma al inventario */
  stockEntry: (companyId: string, entries: { barcode: string; quantity: number }[]) =>
    fetch(`${BASE}/api/stock-entry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId, entries }),
    }).then(r => r.json()),

  /** Libro de Ventas SII — agrupado por día con IVA 19% */
  siiVentas: (companyId: string, year: string, month: string) =>
    fetch(`${BASE}/api/sii/ventas?companyId=${companyId}&year=${year}&month=${month}`)
      .then(r => r.json()),

  // ─── ADMIN ──────────────────────────────────────────────
  adminLogin: (email: string, password: string) =>
    fetch(`${BASE}/api/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }).then(r => r.json()),

  // ─── SUBSCRIPTION ───────────────────────────────────────
  subscription: (companyId: string) =>
    fetch(`${BASE}/api/subscription?companyId=${companyId}`).then(r => r.json()),
};
