// ─── ENTRY POINT ─────────────────────────────────────────────
// main.ts actúa únicamente como orquestador:
// inicializa los módulos y registra los event listeners globales.
// Toda la lógica de negocio vive en client/src/complementos/.

import './style.css';

import { $                        } from './complementos/helpers';
import { registerPurchase         } from './complementos/watcher';
import { initLogin, initLogout    } from './complementos/auth';
import { prevMonth, nextMonth, closeModal } from './complementos/calendar';
import { initAIChat } from './complementos/aiInsights';

// ─── INICIALIZAR MÓDULOS ──────────────────────────────────────
initLogin();
initLogout();
initAIChat();

// ─── EVENT LISTENERS GLOBALES ─────────────────────────────────
$('prev-month')?.addEventListener('click', prevMonth);
$('next-month')?.addEventListener('click', nextMonth);
$('close-modal')?.addEventListener('click', closeModal);

// ─── EXPONER API DE COMPRAS EN WINDOW (desarrollo) ────────────
// Permite llamar desde la consola del navegador:
//   await registerPurchase('Pisco', 3)
(window as any).registerPurchase = registerPurchase;
