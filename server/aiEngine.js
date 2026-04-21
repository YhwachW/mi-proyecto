/**
 * Módulo de predicción estadística local (El "Cerebro Matemático").
 * Procesa el dataset histórico bruto para entregarle tendencias pulidas y
 * consolidadas al agente IA de Gemini, evitando enviar cientos de miles de filas crudas.
 */

// Extrae el tipo de día basado en el formato mm-dd
function getDayTypeInfo(dateStr) {
  const d = new Date(dateStr);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const mmdd = `${month}-${day}`;
  const holidays = [
    "01-01", "04-18", "05-01", "05-21", "06-21", "06-29",
    "07-16", "08-15", "09-18", "09-19", "10-12", "10-31",
    "11-01", "12-08", "12-25"
  ];

  let type = 'weekday';
  if (holidays.includes(mmdd)) type = 'holiday';
  else if (d.getDay() === 0 || d.getDay() === 6) type = 'weekend';

  return { type, mmdd, dayOfWeek: d.getDay() };
}

/**
 * Recibe un array bruto de transacciones de un mismo producto 
 * y calcula su tendencia de crecimiento real comparando semestres o promedios móviles.
 */
function buildProductModel(transactions) {
  if (transactions.length === 0) return { trendPct: 0, status: 'Sin datos', monthlyAvg: 0 };

  // Agrupar cantidades por "Año-Mes" (ej: "2023-05")
  const monthlyVolumes = {};
  transactions.forEach(tx => {
    const d = new Date(tx.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthlyVolumes[key] = (monthlyVolumes[key] || 0) + tx.quantity;
  });

  const sortedMonths = Object.keys(monthlyVolumes).sort();
  const values = sortedMonths.map(m => monthlyVolumes[m]);

  if (values.length < 2) {
    return { trendPct: 0, status: 'Plano', monthlyAvg: values[0] };
  }

  // Dividimos la historia en primera mitad y segunda mitad para ver si sube o baja
  const mid = Math.floor(values.length / 2);
  const firstHalf = values.slice(0, mid);
  const secondHalf = values.slice(mid);

  const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

  let trendPct = 0;
  if (avgFirst > 0) {
    trendPct = ((avgSecond - avgFirst) / avgFirst) * 100;
  }

  let status = 'Estable';
  if (trendPct > 10) status = 'En Crecimiento';
  if (trendPct < -10) status = 'En Caída';

  return {
    trendPct: Math.round(trendPct),
    status,
    monthlyAvg: Math.round(avgSecond) // El volumen mensual más reciente
  };
}

/**
 * Calcula índices de estacionalidad por día de la semana a nivel general de la empresa
 * para saber si venden más los viernes o los lunes, etc.
 */
function analyzeGlobalSeasonality(allTransactions) {
  const dayStats = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  let total = 0;

  allTransactions.forEach(tx => {
    const d = new Date(tx.date);
    dayStats[d.getDay()] += tx.quantity;
    total += tx.quantity;
  });

  const avgPerDay = total / 7;
  const dayMultipliers = {};
  
  if (avgPerDay > 0) {
    for (let i = 0; i < 7; i++) {
        // Cuánto más o menos que el promedio general vende este día:
        // ej: si vende el doble, el índice es 2.0
        dayMultipliers[i] = (dayStats[i] / avgPerDay);
    }
  }

  return dayMultipliers;
}

module.exports = {
  getDayTypeInfo,
  buildProductModel,
  analyzeGlobalSeasonality
};
