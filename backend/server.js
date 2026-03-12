require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDB } = require('./db');
const authRoutes = require('./routes/auth');
const eventRoutes = require('./routes/events');
const telegramRoutes = require('./routes/telegram');
const { startScheduler } = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ],
  credentials: true
}));
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});

// ── API Routes (sempre antes do static) ──
app.use('/api/auth', authRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/telegram', telegramRoutes);
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ── Static frontend (depois das rotas /api) ──
app.use(express.static(path.join(__dirname, '../frontend/build')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/build/index.html'));
});

initDB();
startScheduler();

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📅 Agendador de notificações ativo`);
});