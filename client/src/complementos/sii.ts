// ─── MÓDULO INFORMES SII ─────────────────────────────────────
// Genera y permite imprimir documentos tributarios compatibles
// con las exigencias del SII Chile:
//   - Libro de Ventas Mensual (Resolución Ex. SII N° 45/2003)
//   - Resumen de IVA debitado (Crédito Fiscal / Débito Fiscal)
//   - Vista previa orientativa del Formulario 29

import { $ }    from './helpers';
import { api }  from './api';

// ─── TIPOS ───────────────────────────────────────────────────
interface SIIRow {
  folio: number;
  fecha: string;
  tipoDoc: string;
  cantidad: number;
  bruto: number;
  neto: number;
  iva: number;
  exento: number;
}
interface SIIData {
  periodo: string;
  empresa: {
    rut: string; razonSocial: string;
    giro: string; direccion: string; ciudad: string;
  };
  rows: SIIRow[];
  totals: { bruto: number; neto: number; iva: number; exento: number };
}

// ─── FORMATO PESOS CHILENOS ───────────────────────────────────
const clp = (v: number) =>
  new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(v);

// ─── GENERAR HTML DEL LIBRO DE VENTAS ────────────────────────
const buildLibroVentasHTML = (data: SIIData): string => {
  const rows = data.rows.map((r, i) => `
    <tr class="${i % 2 === 0 ? 'sii-row-even' : ''}">
      <td class="text-center">${r.folio}</td>
      <td class="text-center">${r.fecha}</td>
      <td>${r.tipoDoc}</td>
      <td class="text-right">${r.cantidad.toLocaleString('es-CL')}</td>
      <td class="text-right">${clp(r.exento)}</td>
      <td class="text-right">${clp(r.neto)}</td>
      <td class="text-right text-iva">${clp(r.iva)}</td>
      <td class="text-right text-total"><strong>${clp(r.bruto)}</strong></td>
    </tr>
  `).join('');

  return `
    <div class="sii-doc" id="sii-print-area">
      <!-- Encabezado oficial -->
      <div class="sii-header">
        <div class="sii-logo-area">
          <div class="sii-logo-box">SII</div>
          <div>
            <div class="sii-doc-title">LIBRO DE VENTAS Y SERVICIOS</div>
            <div class="sii-doc-subtitle">Servicio de Impuestos Internos — Chile</div>
          </div>
        </div>
        <div class="sii-periodo-box">
          <div class="sii-periodo-label">PERÍODO TRIBUTARIO</div>
          <div class="sii-periodo-value">${data.periodo}</div>
        </div>
      </div>

      <!-- Datos empresa -->
      <table class="sii-empresa-table">
        <tr>
          <td class="sii-field-label">RUT Empresa:</td>
          <td class="sii-field-value"><strong>${data.empresa.rut}</strong></td>
          <td class="sii-field-label">Razón Social:</td>
          <td class="sii-field-value">${data.empresa.razonSocial}</td>
        </tr>
        <tr>
          <td class="sii-field-label">Giro:</td>
          <td class="sii-field-value" colspan="3">${data.empresa.giro}</td>
        </tr>
        <tr>
          <td class="sii-field-label">Dirección:</td>
          <td class="sii-field-value">${data.empresa.direccion}</td>
          <td class="sii-field-label">Ciudad:</td>
          <td class="sii-field-value">${data.empresa.ciudad}</td>
        </tr>
      </table>

      <!-- Tabla de ventas -->
      <table class="sii-table">
        <thead>
          <tr class="sii-thead">
            <th>N°</th>
            <th>Fecha</th>
            <th>Tipo Documento</th>
            <th>Cant.</th>
            <th>Exento ($)</th>
            <th>Neto ($)</th>
            <th>IVA 19% ($)</th>
            <th>Total ($)</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
        <tfoot>
          <tr class="sii-totals-row">
            <td colspan="4"><strong>TOTALES DEL PERÍODO ${data.periodo}</strong></td>
            <td class="text-right">${clp(data.totals.exento)}</td>
            <td class="text-right"><strong>${clp(data.totals.neto)}</strong></td>
            <td class="text-right text-iva"><strong>${clp(data.totals.iva)}</strong></td>
            <td class="text-right text-total"><strong>${clp(data.totals.bruto)}</strong></td>
          </tr>
        </tfoot>
      </table>

      <!-- Resumen IVA -->
      <div class="sii-resumen-grid">
        <div class="sii-resumen-box">
          <div class="sii-resumen-title">RESUMEN IVA DÉBITO FISCAL</div>
          <table class="sii-resumen-table">
            <tr><td>Base Imponible (Neto):</td><td class="text-right"><strong>${clp(data.totals.neto)}</strong></td></tr>
            <tr><td>IVA Débito Fiscal (19%):</td><td class="text-right text-iva"><strong>${clp(data.totals.iva)}</strong></td></tr>
            <tr class="sii-resumen-total"><td>Total Ventas Período:</td><td class="text-right"><strong>${clp(data.totals.bruto)}</strong></td></tr>
            <tr><td>Ventas Exentas:</td><td class="text-right">${clp(data.totals.exento)}</td></tr>
          </table>
        </div>
        <div class="sii-resumen-box sii-f29-box">
          <div class="sii-resumen-title">REFERENCIA FORM. 29 (ORIENTATIVO)</div>
          <table class="sii-resumen-table">
            <tr><td>Línea 1 — Débito Fiscal (IVA Ventas):</td><td class="text-right text-iva"><strong>${clp(data.totals.iva)}</strong></td></tr>
            <tr><td>Rem. Base imponible afecta:</td><td class="text-right">${clp(data.totals.neto)}</td></tr>
            <tr><td>Rem. Ventas exentas / no afectas:</td><td class="text-right">${clp(data.totals.exento)}</td></tr>
            <tr class="sii-resumen-note"><td colspan="2">* Valores referenciales. Verificar con contador.</td></tr>
          </table>
        </div>
      </div>

      <!-- Firma y fecha -->
      <div class="sii-footer">
        <div class="sii-firma-box">
          <div class="sii-firma-line"></div>
          <div>Firma Responsable / Contador</div>
        </div>
        <div class="sii-fecha-emision">
          Emitido el: ${new Date().toLocaleDateString('es-CL', { day:'2-digit', month:'2-digit', year:'numeric' })}
          &nbsp;|&nbsp; Sistema: OmniAnalytics Cloud ERP
        </div>
      </div>
    </div>
  `;
};

// ─── INICIALIZAR VISTA SII ────────────────────────────────────
export const initSIIView = (companyId: string, fiscal: Record<string, string>) => {
  // Populate default period (current month)
  const now = new Date();
  const selYear  = $('sii-year')  as HTMLSelectElement;
  const selMonth = $('sii-month') as HTMLSelectElement;

  // Build year options (last 3 years)
  for (let y = now.getFullYear(); y >= now.getFullYear() - 2; y--) {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = String(y);
    selYear.appendChild(opt);
  }
  selYear.value  = String(now.getFullYear());
  selMonth.value = String(now.getMonth() + 1);

  $('btn-generate-sii')?.addEventListener('click', async () => {
    const btn = $('btn-generate-sii') as HTMLButtonElement;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generando…';

    try {
      const data: SIIData = await api.siiVentas(companyId, selYear.value, selMonth.value);
      $('sii-preview').innerHTML = buildLibroVentasHTML(data);
      $('sii-preview').style.display = 'block';
      $('btn-print-sii').style.display = 'inline-flex';
    } catch (e) {
      console.error('SII error:', e);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-file-invoice"></i> Generar Libro de Ventas';
    }
  });

  $('btn-print-sii')?.addEventListener('click', () => {
    window.print();
  });
};
