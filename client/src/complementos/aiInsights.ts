import { $ } from './helpers';
import { api } from './api';

export const renderAIInsights = async () => {
  const tendEl = $('ai-tendencia');
  const estEl = $('ai-estrella');
  const recEl = $('ai-recomendacion');

  if (!tendEl || !estEl || !recEl) return;

  try {
    const insights = await api.getAIInsights();
    
    if (insights.success && insights.data) {
      tendEl.innerText = insights.data.tendenciaGeneral || "Sin datos";
      estEl.innerText = insights.data.productoEstrella || "Sin datos";
      recEl.innerText = insights.data.recomendacionStock || "Sin datos";
    } else {
      tendEl.innerText = "Error consultando IA. " + (insights.data?.tendenciaGeneral || '');
      estEl.innerText = "Revisa la configuración or espera unos minutos.";
      recEl.innerText = "";
    }
  } catch (error) {
    tendEl.innerText = "No se pudo conectar con el motor de IA.";
    estEl.innerText = "Servicio no disponible.";
    recEl.innerText = "";
  }
};

export const initAIChat = () => {
  const btn = $('btn-ai-chat');
  const input = $('ai-chat-input') as HTMLInputElement;
  const responseEl = $('ai-chat-response');

  if (!btn || !input || !responseEl) return;

  btn.addEventListener('click', async () => {
    const question = input.value.trim();
    if (!question) return;

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.setAttribute('disabled', 'true');
    responseEl.style.display = 'block';
    responseEl.innerText = 'Analizando tu pregunta y el contexto de tu empresa...';

    try {
      const res = await api.askAI(question);
      responseEl.innerText = res.answer || 'No hubo respuesta.';
    } catch (err) {
      responseEl.innerText = 'Hubo un error de conexión al procesar la respuesta.';
    } finally {
      btn.innerHTML = '<i class="fas fa-paper-plane"></i>';
      btn.removeAttribute('disabled');
      input.value = '';
    }
  });

  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') btn.click();
  });
};
