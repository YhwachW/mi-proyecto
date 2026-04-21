// ─── MÓDULO DE WATCHER Y COMPRAS ─────────────────────────────
// Implementa dos funcionalidades independientes:
//
//  1. Change Watcher: detecta nuevas compras en el servidor mediante
//     un ping liviano a /api/last-update cada 20 segundos. Si el
//     timestamp cambió, dispara un refresh inmediato del dashboard.
//
//  2. registerPurchase: registra en el backend una compra puntual,
//     descuenta el stock y fuerza la actualización de la UI.

import { api } from './api';
import { companyIdContext } from './state';

let lastKnownTimestamp: number | null = null;
let watcherIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Inicia el watcher de cambios.
 * @param onChangeCallback Función a invocar cuando se detecta un cambio de datos.
 */
export const startChangeWatcher = (onChangeCallback: () => Promise<void>) => {
  if (watcherIntervalId) return; // ya está corriendo

  // Toma el timestamp actual como línea base
  api.lastUpdate()
    .then(d => { lastKnownTimestamp = d.timestamp; })
    .catch(() => {});

  watcherIntervalId = setInterval(async () => {
    if (!companyIdContext) return;
    try {
      const d = await api.lastUpdate();
      if (lastKnownTimestamp !== null && d.timestamp !== lastKnownTimestamp) {
        console.log('🔄 Cambio detectado — actualizando dashboard inmediatamente...');
        await onChangeCallback();
      }
      lastKnownTimestamp = d.timestamp;
    } catch {
      // Servidor reiniciando, ignorar silenciosamente
    }
  }, 20_000); // ping cada 20 segundos (muy liviano)
};

/** Detiene el watcher y limpia su estado */
export const stopChangeWatcher = () => {
  if (watcherIntervalId) clearInterval(watcherIntervalId);
  watcherIntervalId  = null;
  lastKnownTimestamp = null;
};

/**
 * Registra una compra en el servidor:
 * - Descuenta el stock del producto indicado.
 * - Fuerza un refresh inmediato del dashboard.
 *
 * También queda expuesto en `window.registerPurchase` para uso desde
 * la consola del navegador durante desarrollo.
 *
 * @example
 * // En consola del navegador (modo dev):
 * await registerPurchase('Pisco', 5)
 */
export const registerPurchase = async (
  productName: string,
  quantity: number,
  onSuccess?: () => Promise<void>
) => {
  if (!companyIdContext) {
    console.warn('registerPurchase: sesión no iniciada');
    return;
  }
  try {
    const d = await api.purchase(companyIdContext, productName, quantity);
    if (d.success) {
      console.log(`✅ Compra registrada — Stock restante: ${d.newStock} u.`);
      if (onSuccess) await onSuccess();
    } else {
      console.error('Purchase failed:', d);
    }
    return d;
  } catch (e) {
    console.error('registerPurchase error:', e);
  }
};
