const express = require('express');
const { getDB } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// List events
router.get('/', authMiddleware, (req, res) => {
  const db = getDB();
  const events = db.prepare('SELECT * FROM events WHERE user_id = ? AND active = 1 ORDER BY created_at DESC').all(req.userId);
  res.json(events.map(e => ({
    ...e,
    days_of_week: e.days_of_week ? JSON.parse(e.days_of_week) : []
  })));
});

// Get today's agenda
router.get('/today', authMiddleware, (req, res) => {
  const db = getDB();
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon...

  const events = db.prepare('SELECT * FROM events WHERE user_id = ? AND active = 1').all(req.userId);

  const todayEvents = events.filter(e => {
    if (e.type === 'daily') return true;
    if (e.type === 'weekly') {
      const days = e.days_of_week ? JSON.parse(e.days_of_week) : [];
      return days.includes(dayOfWeek);
    }
    if (e.type === 'unique') return e.date === todayStr;
    if (e.type === 'deadline') return e.deadline_date >= todayStr;
    return false;
  }).map(e => ({
    ...e,
    days_of_week: e.days_of_week ? JSON.parse(e.days_of_week) : []
  }));

  // Sort by time
  todayEvents.sort((a, b) => {
    const timeA = a.time || a.deadline_time || '23:59';
    const timeB = b.time || b.deadline_time || '23:59';
    return timeA.localeCompare(timeB);
  });

  res.json(todayEvents);
});

// Create event
router.post('/', authMiddleware, (req, res) => {
  const {
    title, description, type, time, date,
    days_of_week, deadline_date, deadline_time,
    notify_minutes_before
  } = req.body;

  if (!title || !type) return res.status(400).json({ error: 'Título e tipo são obrigatórios' });

  const db = getDB();
  const user = db.prepare('SELECT notify_minutes_before FROM users WHERE id = ?').get(req.userId);

  const result = db.prepare(`
    INSERT INTO events (user_id, title, description, type, time, date, days_of_week, deadline_date, deadline_time, notify_minutes_before)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.userId, title, description, type, time, date,
    days_of_week ? JSON.stringify(days_of_week) : null,
    deadline_date, deadline_time,
    notify_minutes_before ?? user.notify_minutes_before
  );

  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid);
  res.json({ ...event, days_of_week: event.days_of_week ? JSON.parse(event.days_of_week) : [] });
});

// Update event
router.put('/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const {
    title, description, type, time, date,
    days_of_week, deadline_date, deadline_time,
    notify_minutes_before, active
  } = req.body;

  const db = getDB();
  const event = db.prepare('SELECT * FROM events WHERE id = ? AND user_id = ?').get(id, req.userId);
  if (!event) return res.status(404).json({ error: 'Evento não encontrado' });

  db.prepare(`
    UPDATE events SET
      title = COALESCE(?, title),
      description = COALESCE(?, description),
      type = COALESCE(?, type),
      time = ?,
      date = ?,
      days_of_week = ?,
      deadline_date = ?,
      deadline_time = ?,
      notify_minutes_before = COALESCE(?, notify_minutes_before),
      active = COALESCE(?, active)
    WHERE id = ? AND user_id = ?
  `).run(
    title, description, type,
    time ?? event.time,
    date ?? event.date,
    days_of_week ? JSON.stringify(days_of_week) : event.days_of_week,
    deadline_date ?? event.deadline_date,
    deadline_time ?? event.deadline_time,
    notify_minutes_before, active,
    id, req.userId
  );

  const updated = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  res.json({ ...updated, days_of_week: updated.days_of_week ? JSON.parse(updated.days_of_week) : [] });
});

// Delete (soft)
router.delete('/:id', authMiddleware, (req, res) => {
  const db = getDB();
  db.prepare('UPDATE events SET active = 0 WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  res.json({ success: true });
});

module.exports = router;
