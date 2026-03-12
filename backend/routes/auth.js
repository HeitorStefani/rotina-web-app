const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDB } = require('../db');
const { authMiddleware, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username e senha obrigatórios' });

  const db = getDB();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Usuário já existe' });

  const hashed = await bcrypt.hash(password, 10);
  const result = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hashed);

  const token = jwt.sign({ userId: result.lastInsertRowid, username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username });
});

// Login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const db = getDB();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }

  const token = jwt.sign({ userId: user.id, username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({
    token,
    username,
    telegram_chat_id: user.telegram_chat_id,
    notify_minutes_before: user.notify_minutes_before
  });
});

// Get profile
router.get('/profile', authMiddleware, (req, res) => {
  const db = getDB();
  const user = db.prepare('SELECT id, username, telegram_chat_id, notify_minutes_before, timezone FROM users WHERE id = ?').get(req.userId);
  res.json(user);
});

// Update profile (telegram chat id, settings)
router.put('/profile', authMiddleware, (req, res) => {
  const { telegram_chat_id, notify_minutes_before, timezone } = req.body;
  const db = getDB();
  db.prepare(`
    UPDATE users SET
      telegram_chat_id = COALESCE(?, telegram_chat_id),
      notify_minutes_before = COALESCE(?, notify_minutes_before),
      timezone = COALESCE(?, timezone)
    WHERE id = ?
  `).run(telegram_chat_id, notify_minutes_before, timezone, req.userId);
  res.json({ success: true });
});

module.exports = router;
