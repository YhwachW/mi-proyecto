// ─── MÓDULO DE INGRESO DE PRODUCTOS ──────────────────────────
// Gestiona la vista de ingreso/recepción de stock.
// Permite identificar productos por código de barras (escáner USB
// o ingreso manual) y registrar el lote de entrada al servidor.

import { $ }       from './helpers';
import { api }     from './api';

// ─── TIPOS ────────────────────────────────────────────────────
interface Product { name: string; category: string; barcode: string; stock: number; }
interface CartItem { product: Product; quantity: number; }

// ─── ESTADO LOCAL ────────────────────────────────────────────
let allProducts: Product[] = [];
let cart: CartItem[]       = [];

// ─── HELPERS ─────────────────────────────────────────────────
const findByBarcode = (bc: string) =>
  allProducts.find(p => p.barcode === bc.trim());

const findByName = (name: string) =>
  allProducts.filter(p => p.name.toLowerCase().includes(name.toLowerCase()));

// Cache of pre-rendered <tr> elements so we never rebuild the DOM on search
let cachedRows: HTMLTableRowElement[] = [];

// Función para sanitizar Strings y prevenir XSS Stored (Cross Site Scripting)
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ─── RENDER CATÁLOGO ─────────────────────────────────────────
/** Builds all rows once using DocumentFragment (fast batch insert) */
const buildCatalogRows = () => {
  const body = $('catalog-body');
  const frag = document.createDocumentFragment();
  cachedRows = [];

  allProducts.forEach(p => {
    const tr = document.createElement('tr');
    tr.className = 'catalog-row';
    tr.dataset.barcode      = p.barcode;
    tr.dataset.searchTarget = p.name.toLowerCase(); // pre-lowercased for O(1) filter
    tr.innerHTML = `
      <td>
        <div class="barcode-chip">
          <span class="barcode-icon">⎙</span>
          <code>${escapeHtml(p.barcode)}</code>
        </div>
      </td>
      <td><strong>${escapeHtml(p.name)}</strong></td>
      <td><span class="category-tag">${escapeHtml(p.category)}</span></td>
      <td class="stock-cell" id="stock-${escapeHtml(p.barcode)}">${p.stock} u.</td>
      <td>
        <button class="btn-add-cart" data-barcode="${p.barcode}">
          <i class="fas fa-plus"></i> Agregar
        </button>
      </td>
    `;

    // Wire events once per row (not on every filter)
    tr.querySelector('.btn-add-cart')?.addEventListener('click', () => {
      const prod = findByBarcode(p.barcode);
      if (prod) addToCart(prod);
    });
    tr.addEventListener('dblclick', () => {
      const prod = findByBarcode(p.barcode);
      if (prod) addToCart(prod);
    });

    frag.appendChild(tr);
    cachedRows.push(tr);
  });

  body.innerHTML = '';
  body.appendChild(frag); // Single DOM mutation regardless of product count
};

/**
 * Filters visible rows using CSS display toggling — no DOM recreation.
 * Sub-millisecond on any dataset size.
 */
const filterCatalog = (query: string) => {
  const q = query.toLowerCase().trim();
  cachedRows.forEach(row => {
    const match = !q || (row.dataset.searchTarget ?? '').includes(q);
    (row as HTMLElement).style.display = match ? '' : 'none';
  });
};

/** Public: initial build or rebuild after stock update */
const renderCatalog = (filter = '') => {
  buildCatalogRows();
  if (filter) filterCatalog(filter);
};


// ─── CARRITO ─────────────────────────────────────────────────
const addToCart = (product: Product, qty = 1) => {
  const existing = cart.find(c => c.product.barcode === product.barcode);
  if (existing) {
    existing.quantity += qty;
  } else {
    cart.push({ product, quantity: qty });
  }
  renderCart();
  showCartFeedback(product.name);
};

const removeFromCart = (barcode: string) => {
  cart = cart.filter(c => c.product.barcode !== barcode);
  renderCart();
};

const showCartFeedback = (name: string) => {
  const fb = $('scan-feedback');
  fb.innerHTML = `<i class="fas fa-check-circle"></i> ${name} agregado al lote`;
  fb.classList.add('success');
  fb.style.display = 'flex';
  setTimeout(() => { fb.style.display = 'none'; fb.classList.remove('success'); }, 2500);
};

const renderCart = () => {
  const body = $('cart-body');
  const total = cart.reduce((s, c) => s + c.quantity, 0);
  $('cart-total').innerText = `${total} unidades · ${cart.length} productos`;

  if (cart.length === 0) {
    body.innerHTML = '<tr><td colspan="4" class="table-loading">El lote está vacío — escanea o agrega productos</td></tr>';
    ($('btn-confirm-entry') as HTMLButtonElement).disabled = true;
    return;
  }

  ($('btn-confirm-entry') as HTMLButtonElement).disabled = false;
  body.innerHTML = cart.map(c => `
    <tr>
      <td><code class="barcode-inline">${c.product.barcode}</code></td>
      <td><strong>${c.product.name}</strong></td>
      <td>
        <div class="qty-control">
          <button class="qty-btn" data-bc="${c.product.barcode}" data-op="dec">−</button>
          <span class="qty-value">${c.quantity}</span>
          <button class="qty-btn" data-bc="${c.product.barcode}" data-op="inc">+</button>
        </div>
      </td>
      <td>
        <button class="btn-remove-cart" data-bc="${c.product.barcode}">
          <i class="fas fa-trash"></i>
        </button>
      </td>
    </tr>
  `).join('');

  body.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const bc  = (btn as HTMLElement).dataset.bc!;
      const op  = (btn as HTMLElement).dataset.op!;
      const item = cart.find(c => c.product.barcode === bc);
      if (!item) return;
      item.quantity = op === 'inc' ? item.quantity + 1 : Math.max(1, item.quantity - 1);
      renderCart();
    });
  });

  body.querySelectorAll('.btn-remove-cart').forEach(btn => {
    btn.addEventListener('click', () => removeFromCart((btn as HTMLElement).dataset.bc!));
  });
};

// ─── ESCÁNER ─────────────────────────────────────────────────
let scanBuffer = '';
let scanTimer: ReturnType<typeof setTimeout> | null = null;

const handleScannerInput = (e: KeyboardEvent) => {
  if (e.key === 'Enter') {
    const code = scanBuffer.trim();
    scanBuffer = '';
    if (code.length >= 4) processScan(code);
    return;
  }
  scanBuffer += e.key;
  // Clear buffer after 100ms of inactivity (scanner sends chars very fast)
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = setTimeout(() => { scanBuffer = ''; }, 150);
};

const processScan = (code: string) => {
  const prod = findByBarcode(code);
  const fb   = $('scan-feedback');

  if (prod) {
    addToCart(prod);
    ($('barcode-input') as HTMLInputElement).value = '';
  } else {
    fb.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Código ${code} no encontrado`;
    fb.classList.add('error');
    fb.style.display = 'flex';
    setTimeout(() => { fb.style.display = 'none'; fb.classList.remove('error'); }, 2500);
  }
};

// ─── CONFIRMAR INGRESO ────────────────────────────────────────
const confirmEntry = async (companyId: string, onSuccess: () => void) => {
  if (cart.length === 0) return;

  const btn = $('btn-confirm-entry') as HTMLButtonElement;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando…';

  try {
    const entries = cart.map(c => ({
      barcode:  c.product.barcode,
      quantity: c.quantity,
    }));

    const d = await api.stockEntry(companyId, entries);

    if (d.success) {
      // Update local stock display
      d.results.forEach((r: any) => {
        const prod = allProducts.find(p => p.name === r.productName);
        if (prod) prod.stock = r.newStock;
      });

      cart = [];
      renderCart();
      renderCatalog(($('product-search') as HTMLInputElement).value);
      onSuccess();

      const fb = $('scan-feedback');
      fb.innerHTML = `<i class="fas fa-boxes-stacked"></i> Ingreso confirmado — ${entries.length} productos actualizados`;
      fb.classList.add('success');
      fb.style.display = 'flex';
      setTimeout(() => { fb.style.display = 'none'; fb.classList.remove('success'); }, 3500);
    }
  } catch (e) {
    console.error('Stock entry failed:', e);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-check"></i> Confirmar Ingreso de Stock';
  }
};

// ─── INICIALIZAR VISTA ────────────────────────────────────────

/**
 * Carga el catálogo de productos del tenant y prepara la vista de ingreso.
 * Debe llamarse después del login.
 */
export const initProductsView = async (companyId: string, onStockChange: () => void) => {
  // Preload catalog in background — doesn't block dashboard rendering
  api.products(companyId).then(d => {
    allProducts = d.products;
    renderCatalog(); // Build rows once via DocumentFragment
    renderCart();
  }).catch(e => console.error('Error cargando catálogo:', e));

  // Barcode input (manual)
  const barcodeInput = $('barcode-input') as HTMLInputElement;
  barcodeInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      processScan(barcodeInput.value);
      barcodeInput.value = '';
    }
  });

  // Product search — debounced 60ms, uses fast CSS filter (no DOM rebuild)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  $('product-search')?.addEventListener('input', (e) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      filterCatalog((e.target as HTMLInputElement).value);
    }, 60);
  });

  // Confirm button
  $('btn-confirm-entry')?.addEventListener('click', () => {
    confirmEntry(companyId, () => {
      onStockChange();
      renderCatalog(); // Rebuild rows to reflect updated stock numbers
    });
  });

  // Global keyboard scanner listener (captures USB scanner anywhere on the products view)
  document.addEventListener('keydown', handleScannerInput);
};

/** Libera los event listeners del escáner global cuando se sale de la vista */
export const destroyProductsView = () => {
  document.removeEventListener('keydown', handleScannerInput);
  cart = [];
  allProducts = [];
};
