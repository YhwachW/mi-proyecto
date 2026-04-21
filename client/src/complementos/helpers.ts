// ─── HELPERS Y CONSTANTES ────────────────────────────────────

/** Alias para getElementById con tipado automático */
export const $ = (id: string) => document.getElementById(id) as HTMLElement;

/** Formatea un número como peso chileno (CLP) */
export const formatCLP = (v: number) =>
  new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(v);

/** Formatea un número con separadores de miles en español */
export const formatNum = (v: number) =>
  new Intl.NumberFormat('es-CL').format(v);

/** Paleta de colores compartida por todos los gráficos */
export const PALETTE = {
  blue:   '#3b82f6',
  purple: '#8b5cf6',
  amber:  '#f59e0b',
  green:  '#10b981',
  red:    '#ef4444',
  cyan:   '#06b6d4',
  pink:   '#ec4899',
};

/** Opciones tipográficas y de color base para Chart.js */
export function chartDefaults() {
  return {
    color: '#94a3b8',
    font: { family: 'Inter, sans-serif', size: 12 },
    borderColor: 'rgba(255,255,255,0.06)',
  };
}
