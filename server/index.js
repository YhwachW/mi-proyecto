const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors());
app.use(express.json());

// Rutas
app.get('/', (req, res) => {
  res.json({ message: '¡Backend funcionando! 🚀' });
});

app.get('/api/saludo', (req, res) => {
  res.json({ mensaje: 'Hola desde el servidor Express 👋', fecha: new Date().toISOString() });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});
