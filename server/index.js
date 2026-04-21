const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

let usersDb = [];
try {
  usersDb = JSON.parse(fs.readFileSync(path.join(__dirname, 'users.json'), 'utf8'));
} catch(e) {
  console.error('No auth db found:', e);
}

let adminsDb = [];
try {
  adminsDb = JSON.parse(fs.readFileSync(path.join(__dirname, 'admins.json'), 'utf8'));
} catch(e) {
  console.error('No admins db found:', e);
}

// In-memory audit log (persists while server runs)
const auditLog = [];
const addAudit = (action, target, actor = 'Sistema') => {
  auditLog.unshift({ ts: new Date().toISOString(), action, target, actor });
  if (auditLog.length > 200) auditLog.pop();
};

let dataset = [];
let mockInventory = {};
let lastUpdateTimestamp = Date.now();

// ─── SUBSCRIPTION HELPERS ─────────────────────────────────────
function daysBetween(d1, d2) {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((new Date(d2) - new Date(d1)) / msPerDay);
}

function checkSubscriptions() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];

  usersDb.forEach(u => {
    if (!u.subscriptionExpiry) return;
    const expiry = new Date(u.subscriptionExpiry);
    expiry.setHours(0, 0, 0, 0);

    // Active → Grace (expired but within 90 days)
    if (u.subscriptionStatus === 'active' && expiry < today) {
      u.subscriptionStatus = 'grace';
      u.suspendedAt = todayStr;
      addAudit('AUTO-SUSPENDIDO', u.name);
      console.log(`⚠️  Auto-suspendido: ${u.name} (suscripción vencida ${u.subscriptionExpiry})`);
    }
    // Grace → Expired (90 days grace exceeded)
    if (u.subscriptionStatus === 'grace' && u.suspendedAt) {
      const daysSince = daysBetween(u.suspendedAt, todayStr);
      if (daysSince >= 90) {
        u.subscriptionStatus = 'expired';
        addAudit('CUENTA-EXPIRADA', u.name);
        console.log(`❌ Cuenta expirada: ${u.name} (${daysSince} días de gracia)`);
      }
    }
  });
}

// Run at startup
checkSubscriptions();

// Pre-built product catalog per companyId — avoids O(n) filter on every request
const productsByCompany = {};

try {
  const data = fs.readFileSync(path.join(__dirname, '../dataset.json'), 'utf8');
  dataset = JSON.parse(data);
  
  let barcodeCounter = 79000001;
  dataset.forEach(entry => {
    if (!mockInventory[entry.productName]) {
      mockInventory[entry.productName] = {
        name:      entry.productName,
        category:  entry.category,
        companyId: entry.companyId,
        stock:     Math.floor(Math.random() * 500),
        barcode:   String(barcodeCounter++)
      };
    }
  });

  // Build per-company product index at startup — O(1) lookup at request time
  Object.values(mockInventory).forEach(p => {
    if (!productsByCompany[p.companyId]) productsByCompany[p.companyId] = [];
    productsByCompany[p.companyId].push(p);
  });
  // Sort each company's list alphabetically once
  Object.keys(productsByCompany).forEach(cid =>
    productsByCompany[cid].sort((a, b) => a.name.localeCompare(b.name, 'es'))
  );
  console.log(`✅ Catálogo listo: ${Object.keys(productsByCompany).map(k => `${k}: ${productsByCompany[k].length} productos`).join(' | ')}`);

} catch (error) {
  console.error('No dataset found:', error);
}

const holidays = [
  "01-01", "04-18", "05-01", "05-21", "06-21", "06-29", 
  "07-16", "08-15", "09-18", "09-19", "10-12", "10-31",
  "11-01", "12-08", "12-25"
];

function getDayType(dateString) {
  const date = new Date(dateString);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const formattedDate = `${month}-${day}`;

  if (holidays.includes(formattedDate)) return 'holiday';
  if (date.getDay() === 0 || date.getDay() === 6) return 'weekend';
  return 'weekday';
}

app.get('/', (req, res) => res.json({ message: 'SaaS Analytics Engine Running 🚀' }));

// REAL-TIME CHANGE DETECTION — lightweight ping endpoint
// Frontend polls this every 20s; if timestamp changed it triggers a full refresh
app.get('/api/last-update', (req, res) => {
  res.json({ timestamp: lastUpdateTimestamp });
});

// REGISTER NEW PURCHASE — updates stock and bumps the timestamp so all
// connected clients detect the change and refresh their dashboards immediately
app.post('/api/purchase', (req, res) => {
  const { companyId, productName, quantity } = req.body;
  if (!companyId || !productName || !quantity) {
    return res.status(400).json({ error: 'companyId, productName and quantity are required' });
  }

  const inv = mockInventory[productName];
  if (!inv) return res.status(404).json({ error: 'Product not found' });
  if (inv.companyId !== companyId) return res.status(403).json({ error: 'Unauthorized' });

  // Deduct stock
  inv.stock = Math.max(0, inv.stock - quantity);

  // Record transaction into in-memory dataset
  dataset.push({
    id: dataset.length + 1,
    date: new Date().toISOString(),
    companyId,
    productName,
    category: inv.category,
    unitPrice: 0, // unknown at purchase endpoint level
    quantity,
    totalPrice: 0
  });

  // Bump the change timestamp — clients polling /api/last-update will detect this
  lastUpdateTimestamp = Date.now();

  console.log(`🛒 Venta registrada: ${quantity}x ${productName} → Stock: ${inv.stock}`);
  res.json({ success: true, newStock: inv.stock, timestamp: lastUpdateTimestamp });
});

// GET PRODUCT CATALOG — O(1) from pre-built index, with cache headers
app.get('/api/products', (req, res) => {
  const { companyId } = req.query;
  if (!companyId) return res.status(403).json({ error: 'companyId required' });

  const products = (productsByCompany[companyId] || []).map(p => ({
    name:     p.name,
    category: p.category,
    barcode:  p.barcode,
    stock:    p.stock
  }));

  // Allow browser to cache for 10s; revalidate using lastUpdateTimestamp as ETag
  res.set('Cache-Control', 'no-cache');
  res.set('ETag', String(lastUpdateTimestamp));
  res.json({ products, total: products.length });
});

// POST STOCK ENTRY — ADDS stock (receiving inventory), opposite of /api/purchase
app.post('/api/stock-entry', (req, res) => {
  const { companyId, entries } = req.body;
  // entries = [{ barcode?, productName?, quantity }]
  if (!companyId || !Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'companyId and entries[] are required' });
  }

  const results = [];
  const errors  = [];

  entries.forEach(entry => {
    const { barcode, productName, quantity } = entry;
    // Find product by barcode or name
    const inv = barcode
      ? Object.values(mockInventory).find(p => p.barcode === barcode && p.companyId === companyId)
      : mockInventory[productName];

    if (!inv) {
      errors.push({ barcode, productName, error: 'Producto no encontrado' });
      return;
    }
    if (inv.companyId !== companyId) {
      errors.push({ barcode, productName, error: 'No autorizado' });
      return;
    }

    inv.stock += Number(quantity);
    results.push({ productName: inv.name, newStock: inv.stock, added: quantity });
    console.log(`📦 Ingreso stock: +${quantity}x ${inv.name} → Stock: ${inv.stock}`);
  });

  lastUpdateTimestamp = Date.now();
  res.json({ success: true, results, errors, timestamp: lastUpdateTimestamp });
});

// AUTHENTICATION LOGIN ENDPOINT
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const user = usersDb.find(u => u.email === email && u.password === password);
    if(user) {
        return res.json({
          success: true,
          token:         user.id,
          company:       user.name,
          defaultModule: user.category,
          // Fiscal data for SII reports
          fiscal: {
            rut:        user.rut,
            razonSocial: user.razonSocial,
            giro:       user.giro,
            direccion:  user.direccion,
            ciudad:     user.ciudad,
            region:     user.region
          }
        });
    }
    return res.status(401).json({ success: false, error: 'Credenciales inválidas' });
});

function computeCoreMetrics(filteredData) {
    const realTimeKpis = {
      totalRevenue: 0,
      totalTransactions: filteredData.length,
      dayTypes: {
        holiday: { revenue: 0, itemsCount: 0, avgTicket: 0, count:0 },
        weekend: { revenue: 0, itemsCount: 0, avgTicket: 0, count:0 },
        weekday: { revenue: 0, itemsCount: 0, avgTicket: 0, count:0 }
      },
      topProducts: {} 
    };
  
    filteredData.forEach(entry => {
      realTimeKpis.totalRevenue += entry.totalPrice;
  
      const dType = getDayType(entry.date);
      realTimeKpis.dayTypes[dType].revenue += entry.totalPrice;
      realTimeKpis.dayTypes[dType].itemsCount += entry.quantity;
      realTimeKpis.dayTypes[dType].count += 1;
  
      if (!realTimeKpis.topProducts[entry.productName]) {
        realTimeKpis.topProducts[entry.productName] = { quantity: 0, revenue: 0 };
      }
      realTimeKpis.topProducts[entry.productName].quantity += entry.quantity;
      realTimeKpis.topProducts[entry.productName].revenue += entry.totalPrice;
    });
  
    ['holiday', 'weekend', 'weekday'].forEach(type => {
        let t = realTimeKpis.dayTypes[type];
        t.avgTicket = t.count > 0 ? Math.round(t.revenue / t.count) : 0;
    });
  
    const sortedProducts = Object.entries(realTimeKpis.topProducts)
      .sort((a, b) => b[1].quantity - a[1].quantity)
      .slice(0, 10)
      .map(p => ({ name: p[0], sold: p[1].quantity, revenue: p[1].revenue }));

    return { realTimeKpis, sortedProducts };
}

// MONTHLY METRICS API
app.get('/api/metrics/:module', (req, res) => {
  const companyId = req.query.companyId; 
  if(!companyId) return res.status(403).json({error: "Secure CompanyId Context Missing"});

  // Extract ONLY transactions corresponding to the authorized tenant
  let filteredData = dataset.filter(d => d.companyId === companyId);
  const { realTimeKpis, sortedProducts } = computeCoreMetrics(filteredData);

  const restockAlerts = [];
  Object.keys(realTimeKpis.topProducts).forEach(productName => {
    const totalSold = realTimeKpis.topProducts[productName].quantity;
    const monthlyDemand = Math.ceil(totalSold / 12); 
    
    let activeDemand = monthlyDemand;
    const currentStock = mockInventory[productName] ? mockInventory[productName].stock : 0;
    const suggestedOrder = Math.max(0, activeDemand - currentStock);
    
    let status = 'Suficiente';
    let urgencyLevel = 3;
    
    if (currentStock === 0) {
      status = 'Agotado'; urgencyLevel = 0;
    } else if (currentStock < (activeDemand * 0.25)) { 
      status = 'Crítico'; urgencyLevel = 1;
    } else if (currentStock < activeDemand) { 
      status = 'Moderado'; urgencyLevel = 2;
    }

    restockAlerts.push({
      product: productName, currentStock, 
      monthlyDemand: activeDemand, suggestedOrder, status, urgencyLevel
    });
  });

  restockAlerts.sort((a, b) => {
    if (a.urgencyLevel !== b.urgencyLevel) return a.urgencyLevel - b.urgencyLevel;
    return b.monthlyDemand - a.monthlyDemand; 
  });

  res.json({
    kpis: { revenue: realTimeKpis.totalRevenue, transactions: realTimeKpis.totalTransactions },
    demographics: realTimeKpis.dayTypes,
    topProducts: sortedProducts,
    restockAlerts: restockAlerts.slice(0, 25)
  });
});

// CALENDAR DAILY FORECAST MODAL API
app.get('/api/forecast/:module', (req, res) => {
  const queryDate = req.query.date;
  const companyId = req.query.companyId;
  
  if (!queryDate) return res.status(400).json({error: "Date parameter required"});
  if(!companyId) return res.status(403).json({error: "Secure CompanyId Context Missing"});
  
  const specificDayType = getDayType(queryDate);
  
  // Extract ONLY transactions corresponding to the authorized tenant
  let filteredData = dataset.filter(d => d.companyId === companyId);
  const { realTimeKpis } = computeCoreMetrics(filteredData);
  const forecastedNeeds = [];

  Object.keys(realTimeKpis.topProducts).forEach(productName => {
    const totalSold = realTimeKpis.topProducts[productName].quantity;
    
    // Average demand estimation 
    // Uses the Chilean specific historical volume mapped directly to the requested month.
    // We infer the raw volume historically recorded dynamically for realism.
    const monthlyDemand = Math.ceil(totalSold / 12); 
    const baseDaily = monthlyDemand / 30;
    
    let mult = 0.8; // weekday
    if (specificDayType === 'holiday') mult = 3.5;
    else if (specificDayType === 'weekend') mult = 1.8;
    
    // Check local exact date override for Chilean dates to force huge demand
    const isSept18 = queryDate.includes('-09-18') || queryDate.includes('-09-19');
    if (isSept18 && ["Pisco", "Empanada de Pino", "Cerveza Lager"].includes(productName)) {
        mult = 15.0; // Extreme surge
    }
    
    const singleDayActiveDemand = Math.max(1, Math.ceil(baseDaily * mult));
    const currentStock = mockInventory[productName] ? mockInventory[productName].stock : 0;
    const suggestedOrder = Math.max(0, singleDayActiveDemand - currentStock);
    
    let status = 'Suficiente';
    if (currentStock === 0) status = 'Agotado';
    else if (currentStock < singleDayActiveDemand) status = 'Faltará Material';
    
    forecastedNeeds.push({
      product: productName,
      currentStock,
      dailyDemand: singleDayActiveDemand,
      suggestedOrder,
      status
    });
  });

  forecastedNeeds.sort((a, b) => b.dailyDemand - a.dailyDemand);

  res.json({
    date: queryDate,
    dayType: specificDayType,
    forecast: forecastedNeeds.slice(0, 50)
  });
});

app.get('/api/calendar/:year/:month', (req, res) => {
  const year = parseInt(req.params.year);
  const month = parseInt(req.params.month); 
  const companyId = req.query.companyId;

  if(!companyId) return res.status(403).json({error: "Secure CompanyId Context Missing"});

  let filteredData = dataset.filter(d => d.companyId === companyId);
  
  const { realTimeKpis } = computeCoreMetrics(filteredData);
  const avgVolHoliday = Math.round(realTimeKpis.dayTypes['holiday'].itemsCount / holidays.length);
  const avgVolWeekend = Math.round(realTimeKpis.dayTypes['weekend'].itemsCount / 104);
  const avgVolWeekday = Math.round(realTimeKpis.dayTypes['weekday'].itemsCount / 246);

  const daysInMonth = new Date(year, month, 0).getDate();
  const calendarResponse = [];

  for (let i = 1; i <= daysInMonth; i++) {
    const d = new Date(year, month - 1, i);
    const type = getDayType(d.toISOString());
    const queryDateStr = `${year}-${String(month).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
    let score = 1;
    let label = 'Bajo';
    let expectedItems = avgVolWeekday;

    // Simulate huge UI warnings around specific cultural dates
    const isSept = queryDateStr.includes('-09-18');
    
    if (type === 'holiday') { score = 3; label = 'Alto'; expectedItems = avgVolHoliday; }
    if (type === 'weekend') { score = 2; label = 'Moderado'; expectedItems = avgVolWeekend; }
    if (isSept) { score = 3; label = '¡PICO!'; expectedItems = Math.round(avgVolHoliday * 4); }
    
    calendarResponse.push({
      date: queryDateStr,
      day: i,
      dayOfWeek: d.getDay() === 0 ? 7 : d.getDay(), 
      type,
      score,
      label,
      expectedItems
    });
  }
  
  const firstDay = new Date(year, month - 1, 1).getDay();
  res.json({
    year,
    month,
    firstDayOffset: firstDay === 0 ? 6 : firstDay - 1, 
    days: calendarResponse
  });
});

// ─── SII : LIBRO DE VENTAS ─────────────────────────────────────────────────
// Devuelve ventas del período agrupadas por día con cálculo de IVA (19%).
// Incluye totales mensuales para el F29.
app.get('/api/sii/ventas', (req, res) => {
  const { companyId, year, month } = req.query;
  if (!companyId || !year || !month) {
    return res.status(400).json({ error: 'companyId, year y month son requeridos' });
  }

  const y = parseInt(year), m = parseInt(month);
  const IVA_RATE = 0.19;

  // Filter transactions for company + period
  const filtered = dataset.filter(tx => {
    const d = new Date(tx.date);
    return tx.companyId === companyId
      && d.getFullYear() === y
      && d.getMonth() + 1 === m;
  });

  // Group by day (each day becomes one "resumen de boletas del día" line)
  const byDay = {};
  filtered.forEach(tx => {
    const d = new Date(tx.date);
    const key = String(d.getDate()).padStart(2, '0');
    if (!byDay[key]) byDay[key] = { date: key, transactions: 0, totalBruto: 0 };
    byDay[key].transactions += tx.quantity;
    byDay[key].totalBruto  += tx.totalPrice;
  });

  // Build rows sorted by day
  let folioCounter = 1;
  const rows = Object.keys(byDay).sort().map(day => {
    const row = byDay[day];
    const neto = Math.round(row.totalBruto / (1 + IVA_RATE));
    const iva  = row.totalBruto - neto;
    return {
      folio:       folioCounter++,
      fecha:       `${String(day).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`,
      tipoDoc:     'Boletas del Día',
      cantidad:    row.transactions,
      bruto:       row.totalBruto,
      neto,
      iva,
      exento:      0
    };
  });

  // Monthly totals
  const totals = rows.reduce((acc, r) => ({
    bruto:  acc.bruto  + r.bruto,
    neto:   acc.neto   + r.neto,
    iva:    acc.iva    + r.iva,
    exento: 0
  }), { bruto: 0, neto: 0, iva: 0, exento: 0 });

  const user = usersDb.find(u => u.id === companyId);
  res.json({
    periodo:    `${String(m).padStart(2,'0')}/${y}`,
    empresa:    user ? { rut: user.rut, razonSocial: user.razonSocial, giro: user.giro, direccion: user.direccion, ciudad: user.ciudad } : {},
    rows,
    totals
  });
});

// \u2500\u2500\u2500 ADMIN ENDPOINTS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

// POST /api/admin/login
app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body;
  const admin = adminsDb.find(a => a.email === email && a.password === password);
  if (!admin) return res.status(401).json({ success: false, error: 'Credenciales de administrador inválidas' });
  addAudit('LOGIN-ADMIN', admin.name, admin.name);
  res.json({ success: true, adminId: admin.id, adminName: admin.name, role: admin.role });
});

// GET /api/admin/accounts — all companies with subscription data
app.get('/api/admin/accounts', (req, res) => {
  checkSubscriptions(); // re-check on demand
  const today = new Date().toISOString().split('T')[0];
  const accounts = usersDb.map(u => {
    const daysLeft = u.subscriptionExpiry
      ? daysBetween(today, u.subscriptionExpiry)
      : null;
    const daysInGrace = u.suspendedAt
      ? daysBetween(u.suspendedAt, today)
      : null;
    return {
      id:               u.id,
      name:             u.name,
      rut:              u.rut,
      email:            u.email,
      plan:             u.subscriptionPlan,
      price:            u.subscriptionPrice,
      status:           u.subscriptionStatus,
      subscriptionExpiry: u.subscriptionExpiry,
      daysLeft,
      daysInGrace,
      graceDaysLeft:    daysInGrace !== null ? 90 - daysInGrace : null,
      lastPayment:      u.lastPayment,
      paymentHistory:   u.paymentHistory || [],
    };
  });

  // SaaS KPIs
  const active  = accounts.filter(a => a.status === 'active').length;
  const grace   = accounts.filter(a => a.status === 'grace').length;
  const atRisk  = accounts.filter(a => a.status === 'active' && a.daysLeft !== null && a.daysLeft <= 7).length;
  const mrr     = active * 14990;

  // Simulated 12-month revenue (for chart)
  const revenueHistory = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(); d.setMonth(d.getMonth() - (11 - i));
    const label = d.toLocaleDateString('es-CL', { month: 'short', year: 'numeric' });
    const base  = (2 + Math.floor(Math.random() * 2)) * 14990; // 2-3 accounts
    return { label, revenue: i === 11 ? mrr : base };
  });

  res.json({ accounts, kpis: { active, grace, atRisk, mrr, total: accounts.length }, revenueHistory, auditLog: auditLog.slice(0, 50) });
});

// POST /api/admin/toggle-status — suspend or reactivate
app.post('/api/admin/toggle-status', (req, res) => {
  const { companyId, action } = req.body; // action: 'suspend' | 'activate'
  const user = usersDb.find(u => u.id === companyId);
  if (!user) return res.status(404).json({ error: 'Empresa no encontrada' });

  const today = new Date().toISOString().split('T')[0];
  if (action === 'suspend') {
    user.subscriptionStatus = 'grace';
    user.suspendedAt = user.suspendedAt || today;
    addAudit('SUSPENDIDO-MANUAL', user.name, 'Admin');
  } else {
    user.subscriptionStatus = 'active';
    user.suspendedAt = null;
    // Extend 30 days from today on reactivation
    const exp = new Date(); exp.setDate(exp.getDate() + 30);
    user.subscriptionExpiry = exp.toISOString().split('T')[0];
    addAudit('REACTIVADO', user.name, 'Admin');
  }
  res.json({ success: true, status: user.subscriptionStatus });
});

// POST /api/admin/extend — add 30 free days to a company
app.post('/api/admin/extend', (req, res) => {
  const { companyId } = req.body;
  const user = usersDb.find(u => u.id === companyId);
  if (!user) return res.status(404).json({ error: 'Empresa no encontrada' });

  const base = user.subscriptionExpiry && new Date(user.subscriptionExpiry) > new Date()
    ? new Date(user.subscriptionExpiry)
    : new Date();
  base.setDate(base.getDate() + 30);
  user.subscriptionExpiry = base.toISOString().split('T')[0];
  if (user.subscriptionStatus !== 'active') {
    user.subscriptionStatus = 'active';
    user.suspendedAt = null;
  }
  addAudit('EXTENSI\u00d3N-30D', user.name, 'Admin');
  res.json({ success: true, newExpiry: user.subscriptionExpiry });
});

// \u2500\u2500\u2500 SUBSCRIPTION ENDPOINTS (for companies) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

// GET /api/subscription — company subscription info
app.get('/api/subscription', (req, res) => {
  checkSubscriptions();
  const { companyId } = req.query;
  const user = usersDb.find(u => u.id === companyId);
  if (!user) return res.status(404).json({ error: 'Empresa no encontrada' });

  const today  = new Date().toISOString().split('T')[0];
  const daysLeft    = user.subscriptionExpiry ? daysBetween(today, user.subscriptionExpiry) : 0;
  const daysInGrace = user.suspendedAt        ? daysBetween(user.suspendedAt, today)        : 0;

  res.json({
    plan:               user.subscriptionPlan,
    price:              user.subscriptionPrice,
    status:             user.subscriptionStatus,
    subscriptionExpiry: user.subscriptionExpiry,
    daysLeft,
    graceDaysLeft:      Math.max(0, 90 - daysInGrace),
    lastPayment:        user.lastPayment,
    paymentHistory:     user.paymentHistory || [],
  });
});

// POST /api/subscription/pay — register payment, extend 30 days
app.post('/api/subscription/pay', (req, res) => {
  const { companyId } = req.body;
  const user = usersDb.find(u => u.id === companyId);
  if (!user) return res.status(404).json({ error: 'Empresa no encontrada' });

  const base = (user.subscriptionExpiry && new Date(user.subscriptionExpiry) > new Date())
    ? new Date(user.subscriptionExpiry)
    : new Date();
  base.setDate(base.getDate() + 30);

  const newExpiry     = base.toISOString().split('T')[0];
  const today         = new Date().toISOString().split('T')[0];
  const periodMonth   = base.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });

  user.subscriptionExpiry  = newExpiry;
  user.subscriptionStatus  = 'active';
  user.suspendedAt         = null;
  user.lastPayment         = today;
  if (!user.paymentHistory) user.paymentHistory = [];
  user.paymentHistory.unshift({ date: today, amount: user.subscriptionPrice, period: periodMonth });

  lastUpdateTimestamp = Date.now();
  addAudit('PAGO-RECIBIDO', `${user.name} — $${user.subscriptionPrice.toLocaleString('es-CL')}`, user.name);
  console.log(`\ud83d\udcb0 Pago recibido: ${user.name} — nuevo vencimiento: ${newExpiry}`);
  res.json({ success: true, newExpiry, status: 'active' });
});

app.listen(PORT, () => {
  console.log(`\u2705 Servidor SaaS Analytics Multitenant en http://localhost:${PORT}`);
});
