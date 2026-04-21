const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const helmet = require('helmet');
const { getDayTypeInfo, buildProductModel, analyzeGlobalSeasonality } = require('./aiEngine');
const { generateBusinessInsights, answerQuestion } = require('./aiAgent');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');

// Se oculta que es un servidor Express y se bloquean sniffers (Security Headers)
app.use(helmet());

// Se asegura origen específico, se bloquea el origin '*' (CORS Exploit Patch)
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

// Middlewares de Seguridad
const verifyToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(403).json({ error: "Token JWT requerido faltante" });
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ error: "Token inválido o expirado" });
    req.user = decoded;
    next();
  });
};

const verifyAdmin = (req, res, next) => {
  verifyToken(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: "Acceso denegado. Privilegios de administrador requeridos." });
    next();
  });
};

const aiLimiter = rateLimit({
  windowMs: 60 * 1000, 
  max: 10,
  message: { error: "Límite de consultas a IA por minuto superado para evitar fuerza bruta. Espera un momento." }
});

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

let inventoryState = {};
try {
  inventoryState = JSON.parse(fs.readFileSync(path.join(__dirname, 'inventoryState.json'), 'utf8'));
} catch (e) {
  console.log('No prev inventory state found, it will be mapped at runtime');
}

try {
  const data = fs.readFileSync(path.join(__dirname, '../dataset.json'), 'utf8');
  dataset = JSON.parse(data);
  
  let barcodeCounter = 79000001;
  dataset.forEach(entry => {
    if (!mockInventory[entry.productName]) {
      mockInventory[entry.productName] = inventoryState[entry.productName] || {
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

// ─── TAREA PROGRAMADA: Tabla de Estadísticas Resumidas ─────────
let dailyStatsSummary = [];

function aggregateDailyStats() {
  console.log('🔄 [CRON] Ejecutando tarea programada: Resumiendo ventas crudas a tabla diaria...');
  const grouped = {};
  dataset.forEach(d => {
    const key = `${d.companyId}_${d.date}_${d.productName}`;
    if (!grouped[key]) {
      grouped[key] = {
        companyId: d.companyId,
        date: d.date,
        productName: d.productName,
        totalQuantity: 0,
        totalRevenue: 0
      };
    }
    grouped[key].totalQuantity += d.quantity;
    grouped[key].totalRevenue += d.amount;
  });
  
  dailyStatsSummary = Object.values(grouped);
  console.log(`✅ [CRON] Dataset consolidado. De ${dataset.length} txs crudas a ${dailyStatsSummary.length} estadísticas diarias listas para la IA.`);
}

// Ejecutar al iniciar, y planificar tarea recurrente cada 1 hora
aggregateDailyStats();
setInterval(aggregateDailyStats, 60 * 60 * 1000);
// ───────────────────────────────────────────────────────────────

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
  if (!companyId || !productName || quantity === undefined || typeof quantity !== 'number' || quantity <= 0 || !Number.isInteger(quantity)) {
    return res.status(400).json({ error: 'Datos inválidos. La cantidad debe ser un entero positivo numérico estricto mayor a 0.' });
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

  // Persistir de forma ASÍNCRONA (Non-blocking I/O) para evitar caída de Event Loop en horas pico
  fs.writeFile(path.join(__dirname, 'inventoryState.json'), JSON.stringify(mockInventory, null, 2), err => {
    if (err) console.error('Error asíncrono guardando inventory:', err);
  });
  fs.writeFile(path.join(__dirname, '../dataset.json'), JSON.stringify(dataset, null, 2), err => {
    if (err) console.error('Error asíncrono guardando dataset:', err);
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
    
    // Parche: Validación aritmética contra inyecciones negativas o Corrupción NaN
    if (quantity === undefined || typeof quantity !== 'number' || quantity <= 0 || !Number.isInteger(quantity)) {
      errors.push({ barcode, productName, error: 'Cantidad inválida. Debe ser numérico entero positivo estricto.' });
      return;
    }

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

  // Persistir estado de inventario Async para máxima disponibilidad HTTP
  fs.writeFile(path.join(__dirname, 'inventoryState.json'), JSON.stringify(mockInventory, null, 2), err => {
    if (err) console.error('Error asíncrono inventoryState:', err);
  });

  lastUpdateTimestamp = Date.now();
  res.json({ success: true, results, errors, timestamp: lastUpdateTimestamp });
});

// AUTHENTICATION LOGIN ENDPOINT
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    
    // Mitigación de DoS: Validar que `password` es String genuino
    if (!email || !password || typeof password !== 'string') {
      return res.status(400).json({ success: false, error: 'Credenciales ausentes o mal formadas' });
    }

    const user = usersDb.find(u => u.email === email);
    if(!user) return res.status(401).json({ success: false, error: 'Credenciales inválidas' });
    
    const isMatch = await bcrypt.compare(password, user.password);
    if(!isMatch) return res.status(401).json({ success: false, error: 'Credenciales inválidas' });

    const token = jwt.sign({ id: user.id, role: 'user' }, JWT_SECRET, { expiresIn: '12h' });

    return res.json({
        success: true,
        token:         token,          // Secure JWT token
        companyId:     user.id,        // Company UUID for context
        company:       user.name,
        defaultModule: user.category,
        fiscal: {
          rut:        user.rut,
          razonSocial: user.razonSocial,
          giro:       user.giro,
          direccion:  user.direccion,
          ciudad:     user.ciudad,
          region:     user.region
        }
    });
});

// ─── MIDDLEWARES GLOBALES DE SEGURIDAD ─────────────────────────
app.use('/api/admin', (req, res, next) => {
  if (req.path === '/login') return next();
  verifyAdmin(req, res, next);
});

app.use('/api', (req, res, next) => {
  if (req.path === '/login' || req.path.startsWith('/admin') || req.path === '/last-update') return next();

  verifyToken(req, res, () => {
    const targetCompanyId = req.method === 'GET' ? req.query.companyId : req.body.companyId;
    // Si viene un companyId y no coincide con el del token, es un ataque IDOR
    if (targetCompanyId && req.user.id !== targetCompanyId) {
      console.warn(`Alerta de Seguridad (IDOR): Usuario ${req.user.id} intentó acceder a datos de ${targetCompanyId}`);
      return res.status(403).json({ error: "Acceso denegado. Violación de IDOR detectada." });
    }
    next();
  });
});
app.use('/api/ai-chat', aiLimiter);
// ───────────────────────────────────────────────────────────────

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
  
  const { type: specificDayType, dayOfWeek } = getDayTypeInfo(queryDate);
  
  // Extract ONLY transactions corresponding to the authorized tenant
  let filteredData = dataset.filter(d => d.companyId === companyId);
  const globalSeasonality = analyzeGlobalSeasonality(filteredData);
  const dayMultiplier = globalSeasonality[dayOfWeek] || 1;

  const { realTimeKpis } = computeCoreMetrics(filteredData);
  const forecastedNeeds = [];

  Object.keys(realTimeKpis.topProducts).forEach(productName => {
    const productTx = filteredData.filter(d => d.productName === productName);
    const model = buildProductModel(productTx);
    
    // Uses the calculated monthly average based on most recent months for better accuracy
    const activeMonthlyDemand = model.monthlyAvg; 
    const baseDaily = activeMonthlyDemand / 30;
    
    let mult = specificDayType === 'holiday' ? 3 : dayMultiplier;
    
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
      status,
      confidence: model.status === 'Sin datos' ? 'Baja' : (model.status === 'En Crecimiento' ? 'Alta' : 'Media')
    });
  });

  forecastedNeeds.sort((a, b) => b.dailyDemand - a.dailyDemand);

  res.json({
    date: queryDate,
    dayType: specificDayType,
    forecast: forecastedNeeds.slice(0, 50)
  });
});

// NEW AI INSIGHTS API
app.get('/api/ai-insights', async (req, res) => {
  const companyId = req.query.companyId;
  if(!companyId) return res.status(403).json({error: "Secure CompanyId Context Missing"});

  const user = usersDb.find(u => u.id === companyId);
  const companyName = user ? user.name : "Empresa";

  let filteredData = dataset.filter(d => d.companyId === companyId);
  const { realTimeKpis } = computeCoreMetrics(filteredData);
  
  // Prepare a small summary of top products and their trend
  const statsSummary = [];
  Object.keys(realTimeKpis.topProducts).slice(0, 7).forEach(productName => {
    const productTx = filteredData.filter(d => d.productName === productName);
    const model = buildProductModel(productTx);
    statsSummary.push({
      producto: productName,
      volumenMensualActual: model.monthlyAvg,
      tendenciaCrecimiento: `${model.trendPct}%`,
      estado: model.status
    });
  });

  // EXTRAER LAS ESTADÍSTICAS RECIENTES (Últimos 14 días resumidos) PARA AHORRAR TOKENS
  const companyDailyStats = dailyStatsSummary
    .filter(d => d.companyId === companyId)
    .slice(-30); // Acotamos a 30 días para enviar a la IA

  // También se le envía el KPI base (10 líneas que ya calculamos de tendencia)
  const finalAiPayload = {
    tendenciasProducto: statsSummary,
    ultimos30DiasAgrupados: companyDailyStats
  };

  const insights = await generateBusinessInsights(companyName, finalAiPayload);
  res.json(insights);
});

// NEW AI CHAT API
app.post('/api/ai-chat', async (req, res) => {
  const { companyId, question } = req.body;
  if(!companyId || !question) return res.status(400).json({error: "Secure CompanyId Context and question Missing"});

  const user = usersDb.find(u => u.id === companyId);
  const companyName = user ? user.name : "Empresa";

  let filteredData = dataset.filter(d => d.companyId === companyId);
  const { realTimeKpis } = computeCoreMetrics(filteredData);
  
  const statsSummary = [];
  Object.keys(realTimeKpis.topProducts).slice(0, 10).forEach(productName => {
    const productTx = filteredData.filter(d => d.productName === productName);
    const model = buildProductModel(productTx);
    statsSummary.push({
      producto: productName,
      volumenMensualActual: model.monthlyAvg,
      tendenciaCrecimiento: `${model.trendPct}%`,
      estado: model.status
    });
  });

  const companyDailyStats = dailyStatsSummary
    .filter(d => d.companyId === companyId)
    .slice(-30);

  const finalAiPayload = {
    tendenciasProducto: statsSummary,
    historicoRecienteAgrupado: companyDailyStats
  };

  const answer = await answerQuestion(companyName, finalAiPayload, question);
  res.json({ answer });
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
app.post('/api/admin/login', async (req, res) => {
  const { email, password } = req.body;

  // Mitigación de DoS para modulo Admin
  if (!email || !password || typeof password !== 'string') {
    return res.status(400).json({ success: false, error: 'Credenciales de administrador ausentes' });
  }

  const admin = adminsDb.find(a => a.email === email);
  if (!admin) return res.status(401).json({ success: false, error: 'Credenciales de administrador inválidas' });

  const isMatch = await bcrypt.compare(password, admin.password);
  if (!isMatch) return res.status(401).json({ success: false, error: 'Credenciales de administrador inválidas' });

  const token = jwt.sign({ id: admin.id, role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });

  addAudit('LOGIN-ADMIN', admin.name, admin.name);
  res.json({ success: true, adminId: admin.id, adminName: admin.name, role: admin.role, token });
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
  console.log(`💰 Pago recibido: ${user.name} — nuevo vencimiento: ${newExpiry}`);
  res.json({ success: true, newExpiry, status: 'active' });
});

app.listen(PORT, () => {
  console.log(`✅ Servidor SaaS Analytics Multitenant en http://localhost:${PORT}`);
  console.log('🤖 Motor de IA de Gemini conectado');
});

// force restart

// final data reload check

// actual final data reload
