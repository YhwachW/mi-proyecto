const fs = require('fs');

const holidays = [
  "01-01", "04-18", "05-01", "05-21", "06-21", "06-29", 
  "07-16", "08-15", "09-18", "09-19", "10-12", "10-31",
  "11-01", "12-08", "12-25"
];

function getDayType(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const formattedDate = `${month}-${day}`;

  if (holidays.includes(formattedDate)) return 'holiday';
  if (date.getDay() === 0 || date.getDay() === 6) return 'weekend';
  return 'weekday';
}

const botilleria = [
  "Pisco", "Ron", "Vodka", "Cerveza Lager", "Cerveza IPA", "Vino Tinto", "Vino Blanco",
  "Whisky 12 Años", "Tequila Añejo", "Gin", "Bebida Cola", "Bebida Naranja", "Agua Mineral sin Gas",
  "Agua Mineral con Gas", "Jugo de Naranja", "Jugo de Piña", "Tónica", "Ginger Ale", "Espumante",
  "Licor de Café", "Licor de Naranja", "Vermouth Rosso", "Vermouth Bianco", "Campari", "Amaretto",
  "Pisco Sour (Botella)", "Bebida Limón", "Energy Drink", "Cerveza Stout", "Cerveza sin alcohol",
  "Sidra", "Vino Rosé", "Baileys"
].map(name => ({ name, category: 'Botillería', companyId: 'COMP-BOTILLERIA-101', price: Math.floor(Math.random() * 15000) + 1500 }));

const supermercado = [
  "Arroz", "Fideos", "Aceite Maravilla", "Aceite de Oliva", "Harina", "Azúcar", "Sal",
  "Pan de Molde", "Leche Entera", "Leche Descremada", "Mantequilla", "Huevos (12 un)", "Queso Laminado",
  "Jamón de Pavo", "Mermelada", "Manjar", "Galletas Dulces", "Galletas Saladas", "Papas Fritas (Snack)",
  "Mayonesa", "Ketchup", "Salsa de Tomate", "Atún en Conserva", "Lentejas", "Porotos",
  "Café Instantáneo", "Té en bolsitas", "Detergente Líquido", "Lavaloza", "Papel Higiénico",
  "Pasta de Dientes", "Jabón en Barra", "Shampoo", "Acondicionador"
].map(name => ({ name, category: 'Supermercado', companyId: 'COMP-SUPER-202', price: Math.floor(Math.random() * 8000) + 800 }));

const platosComida = [
  "Hamburguesa Completa", "Pizza Pepperoni", "Pizza Margarita", "Sushi Rolls (10 un)",
  "Completo Italiano", "Churrasco Italiano", "Lomo a lo Pobre", "Pollo con Papas Fritas",
  "Ensalada César", "Tacos de Carne (3 un)", "Pad Thai", "Ceviche Mixto", "Empanada de Pino",
  "Empanada de Queso", "Cazuela de Vacuno", "Pastel de Choclo", "Porotos con Riendas", "Lasagna",
  "Spaghetti a la Boloñesa", "Pollo Teriyaki", "Burrito Mixto", "Sopaipillas (10 un)", "Papas Fritas (Porción)",
  "Aros de Cebolla", "Alitas de Pollo (6 un)", "Sandwich de Pescado", "Shawarma", "Quiche de Verduras",
  "Machas a la Parmesana", "Chorrillana", "Milanesa con puré", "Filete Mignon", "Ravioli de Espinaca"
].map(name => ({ name, category: 'Platos de Comida', companyId: 'COMP-RESTO-303', price: Math.floor(Math.random() * 12000) + 3500 }));

const catalog = [...botilleria, ...supermercado, ...platosComida];

const dataset = [];
let idCounter = 1;

// Simulate exactly 1 year backward from today
const endDate = new Date();
const startDate = new Date();
startDate.setFullYear(startDate.getFullYear() - 1);

for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
  const dayType = getDayType(d);
  const formattedDate = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  
  const isSeptember18thSeason = formattedDate >= '09-15' && formattedDate <= '09-19';
  const isNewYearSeason = formattedDate >= '12-28' || formattedDate <= '01-02';

  // Base multiplier
  let transactionMultiplier = 1;
  if (dayType === 'weekend') transactionMultiplier = 2; // +100%
  if (dayType === 'holiday') transactionMultiplier = 4; // +300%
  
  // Chilean cultural explosive peaks
  if (isSeptember18thSeason) transactionMultiplier = 6;
  if (isNewYearSeason) transactionMultiplier = 5;

  const transactionsThisDay = Math.floor((Math.random() * 30 + 10) * transactionMultiplier); 

  for (let i = 0; i < transactionsThisDay; i++) {
    // Determine random product base
    let candidateIndex = Math.floor(Math.random() * catalog.length);
    let randomProduct = catalog[candidateIndex];
    let qtyMultiplier = dayType === 'holiday' || dayType === 'weekend' ? 2 : 1;

    // Apply strict Chilean cultural probability biasing to product choice
    if (isSeptember18thSeason) {
      // 60% chance to overwrite with classic Fiestas Patrias items
      if (Math.random() < 0.6) {
        const patriotItems = catalog.filter(c => ["Pisco", "Cerveza Lager", "Empanada de Pino", "Churrasco Italiano", "Lomo a lo Pobre"].includes(c.name));
        randomProduct = patriotItems[Math.floor(Math.random() * patriotItems.length)];
        qtyMultiplier = Math.floor(Math.random() * 3) + 3; // buy huge volumes (3-5x)
      }
    } else if (isNewYearSeason) {
      if (Math.random() < 0.5) {
        const newYearItems = catalog.filter(c => ["Espumante", "Vodka", "Ron", "Cerveza IPA", "Papas Fritas (Snack)", "Bebida Cola"].includes(c.name));
        randomProduct = newYearItems[Math.floor(Math.random() * newYearItems.length)];
        qtyMultiplier = Math.floor(Math.random() * 3) + 2; 
      }
    }

    const maxQty = Math.floor(Math.random() * 4 * qtyMultiplier) + 1;
    const quantity = Math.max(1, maxQty);
    
    const txDate = new Date(d);
    txDate.setHours(Math.floor(Math.random() * 14) + 8, Math.floor(Math.random() * 60));

    dataset.push({
      id: idCounter++,
      date: txDate.toISOString(),
      companyId: randomProduct.companyId, // Assigned explicitly down to the SaaS company
      productName: randomProduct.name,
      category: randomProduct.category,
      unitPrice: randomProduct.price,
      quantity: quantity,
      totalPrice: Math.round(randomProduct.price * quantity)
    });
  }
}

// Ensure the array is sorted by date
dataset.sort((a, b) => new Date(a.date) - new Date(b.date));

fs.writeFileSync('server/users.json', JSON.stringify([
  { "id": "COMP-BOTILLERIA-101", "name": "BotiSaaS - El Manantial", "email": "boti@admin.cl", "password": "123", "category": "Botillería" },
  { "id": "COMP-SUPER-202", "name": "MarketSaaS - EcoMarket", "email": "supermercado@admin.cl", "password": "123", "category": "Supermercado" },
  { "id": "COMP-RESTO-303", "name": "RestoCloud - Sazón Fino", "email": "restaurante@admin.cl", "password": "123", "category": "Platos de Comida" }
], null, 2));

fs.writeFileSync('dataset.json', JSON.stringify(dataset, null, 2));

console.log(`✅ ¡Multitenant Dataset generado! 1 Año Histórico de Ventas Creado aplicando Cultura de Consumo Chilena (18 Sept / Año Nuevo).
Total de Ventas Globales: ${dataset.length} txs distribuidas entre Botillería, Supermercado y Resto.`);
