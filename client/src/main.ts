import './style.css'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <!-- NAV -->
  <nav>
    <div class="nav-logo">mi<span>proyecto</span></div>
    <ul class="nav-links">
      <li><a href="#">Inicio</a></li>
      <li><a href="#">Acerca</a></li>
      <li><a href="#">Contacto</a></li>
    </ul>
  </nav>

  <!-- HERO -->
  <section class="hero">
    <div class="badge">✦ Full-Stack listo</div>
    <h1>Tu proyecto <span>full-stack</span><br>está en marcha</h1>
    <p>Frontend con React + Vite y backend con Node.js + Express. Todo configurado y listo para construir.</p>
    <div class="btn-group">
      <a class="btn btn-primary" href="http://localhost:3001/api/saludo" target="_blank">Probar API</a>
      <a class="btn btn-secondary" href="https://vitejs.dev" target="_blank">Ver docs</a>
    </div>
  </section>

  <!-- CARDS -->
  <div class="cards">
    <div class="card">
      <div class="card-icon">⚡</div>
      <h3>Vite + React</h3>
      <p>Frontend ultra-rápido con HMR y TypeScript listo para usar.</p>
    </div>
    <div class="card">
      <div class="card-icon">🟢</div>
      <h3>Node + Express</h3>
      <p>Backend en el puerto 3001 con CORS configurado y rutas de ejemplo.</p>
    </div>
    <div class="card">
      <div class="card-icon">🔌</div>
      <h3>API conectada</h3>
      <p>El frontend puede consumir la API del servidor sin configuración extra.</p>
    </div>
  </div>

  <!-- API STATUS -->
  <div class="api-status">
    <div>Respuesta en vivo desde el servidor:</div>
    <div id="api-response">cargando...</div>
  </div>

  <!-- FOOTER -->
  <footer>Hecho con ♥ · mi-proyecto · ${new Date().getFullYear()}</footer>
`

// Consulta a la API del backend
fetch('http://localhost:3001/api/saludo')
  .then(r => r.json())
  .then(data => {
    const el = document.getElementById('api-response')
    if (el) el.textContent = `${data.mensaje} — ${data.fecha}`
  })
  .catch(() => {
    const el = document.getElementById('api-response')
    if (el) el.textContent = '⚠️ Backend no disponible en este momento'
  })
