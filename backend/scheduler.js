const cron = require('node-cron');
const { getDB } = require('./db');
const { sendTelegramMessage } = require('./routes/telegram');

const DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const TYPE_EMOJI = { daily: '🔄', weekly: '📅', unique: '📌', deadline: '⏰' };

// ─── Horário de Brasília ──────────────────────────────────────────────────────
function getBrasiliaDate() {
  const now = new Date();
  const brasiliaOffset = -3 * 60;
  const utcMinutes = now.getTime() / 1000 / 60 + now.getTimezoneOffset();
  return new Date((utcMinutes + brasiliaOffset) * 60 * 1000);
}

function formatEventMessage(event, minutesBefore) {
  const emoji = TYPE_EMOJI[event.type] || '📌';
  const when = minutesBefore === 0 ? 'AGORA' : `em ${minutesBefore} minuto${minutesBefore > 1 ? 's' : ''}`;
  let msg = `${emoji} <b>${event.title}</b> — ${when}`;
  if (event.description) msg += `\n📝 ${event.description}`;
  if (event.time) msg += `\n🕐 Horário: ${event.time}`;
  if (event.deadline_date) msg += `\n📆 Prazo: ${event.deadline_date}`;
  return msg;
}

function shouldNotifyToday(event, brasiliaDate) {
  const todayStr = brasiliaDate.toISOString().split('T')[0];
  const dayOfWeek = brasiliaDate.getDay();

  if (event.type === 'daily') return true;
  if (event.type === 'weekly') {
    const days = event.days_of_week ? JSON.parse(event.days_of_week) : [];
    return days.includes(dayOfWeek);
  }
  if (event.type === 'unique') return event.date === todayStr;
  if (event.type === 'deadline') return event.deadline_date >= todayStr;
  return false;
}

function getEventTime(event) {
  if (event.type === 'deadline') return event.deadline_time;
  return event.time;
}

function wasRecentlyNotified(db, eventId, userId, scheduledFor) {
  const recent = db.prepare(`
    SELECT id FROM notification_log
    WHERE event_id = ? AND user_id = ? AND scheduled_for = ?
    AND sent_at > datetime('now', '-2 minutes')
  `).get(eventId, userId, scheduledFor);
  return !!recent;
}

function logNotification(db, eventId, userId, scheduledFor) {
  db.prepare(`INSERT INTO notification_log (event_id, user_id, scheduled_for) VALUES (?, ?, ?)`)
    .run(eventId, userId, scheduledFor);
}

function startScheduler() {
  // ── Roda a cada minuto ──
  cron.schedule('* * * * *', async () => {
    const db = getDB();
    const brasiliaDate = getBrasiliaDate();
    const hours = brasiliaDate.getHours().toString().padStart(2, '0');
    const minutes = brasiliaDate.getMinutes().toString().padStart(2, '0');
    const currentTime = `${hours}:${minutes}`;
    const todayStr = brasiliaDate.toISOString().split('T')[0];

    const users = db.prepare(`SELECT * FROM users WHERE telegram_chat_id IS NOT NULL AND telegram_chat_id != ''`).all();

    for (const user of users) {
      const events = db.prepare(`SELECT * FROM events WHERE user_id = ? AND active = 1`).all(user.id);

      for (const event of events) {
        if (!shouldNotifyToday(event, brasiliaDate)) continue;

        const eventTime = getEventTime(event);
        if (!eventTime) continue;

        const [evHour, evMin] = eventTime.split(':').map(Number);
        const notifyMinutes = event.notify_minutes_before ?? user.notify_minutes_before ?? 30;

        const eventDate = new Date(brasiliaDate);
        eventDate.setHours(evHour, evMin, 0, 0);
        const notifyDate = new Date(eventDate.getTime() - notifyMinutes * 60000);

        const notifyTime = `${notifyDate.getHours().toString().padStart(2, '0')}:${notifyDate.getMinutes().toString().padStart(2, '0')}`;

        if (currentTime !== notifyTime) continue;

        const scheduledFor = `${todayStr} ${eventTime}`;
        if (wasRecentlyNotified(db, event.id, user.id, scheduledFor)) continue;

        try {
          await sendTelegramMessage(user.telegram_chat_id, formatEventMessage(event, notifyMinutes));
          logNotification(db, event.id, user.id, scheduledFor);
          console.log(`✅ Notificação: [${user.username}] ${event.title} às ${eventTime}`);
        } catch (err) {
          console.error(`❌ Erro ao notificar [${user.username}] evento ${event.id}:`, err.message);
        }
      }

      // ── Deadlines ──
      const deadlineEvents = events.filter(e => e.type === 'deadline');
      for (const event of deadlineEvents) {
        if (event.deadline_date !== todayStr) continue;

        const deadlineTime = event.deadline_time || '08:00';
        const [evHour, evMin] = deadlineTime.split(':').map(Number);
        const notifyMinutes = event.notify_minutes_before ?? user.notify_minutes_before ?? 30;

        const eventDate = new Date(brasiliaDate);
        eventDate.setHours(evHour, evMin, 0, 0);
        const notifyDate = new Date(eventDate.getTime() - notifyMinutes * 60000);

        const notifyTime = `${notifyDate.getHours().toString().padStart(2, '0')}:${notifyDate.getMinutes().toString().padStart(2, '0')}`;

        if (currentTime !== notifyTime) continue;

        const scheduledFor = `${todayStr}_deadline_${event.id}`;
        if (wasRecentlyNotified(db, event.id, user.id, scheduledFor)) continue;

        try {
          const msg = `⚠️ <b>PRAZO HOJE: ${event.title}</b>\nVence às ${deadlineTime}${event.description ? '\n📝 ' + event.description : ''}`;
          await sendTelegramMessage(user.telegram_chat_id, msg);
          logNotification(db, event.id, user.id, scheduledFor);
        } catch (err) {
          console.error(`❌ Erro ao notificar deadline:`, err.message);
        }
      }
    }
  });

  // ── Resumo matinal às 7h horário de Brasília = 10h UTC ──
  cron.schedule('0 10 * * *', async () => {
    const db = getDB();
    const brasiliaDate = getBrasiliaDate();
    const todayStr = brasiliaDate.toISOString().split('T')[0];
    const dayName = DAY_NAMES[brasiliaDate.getDay()];

    const users = db.prepare(`SELECT * FROM users WHERE telegram_chat_id IS NOT NULL`).all();

    for (const user of users) {
      const events = db.prepare(`SELECT * FROM events WHERE user_id = ? AND active = 1`).all(user.id);
      const todayEvents = events.filter(e => shouldNotifyToday(e, brasiliaDate));

      if (!todayEvents.length) continue;

      todayEvents.sort((a, b) => {
        const ta = a.time || a.deadline_time || '23:59';
        const tb = b.time || b.deadline_time || '23:59';
        return ta.localeCompare(tb);
      });

      let msg = `☀️ <b>Bom dia! Sua agenda de ${dayName}:</b>\n\n`;
      for (const e of todayEvents) {
        const emoji = TYPE_EMOJI[e.type] || '📌';
        const time = e.time || e.deadline_time;
        msg += `${emoji} ${time ? `<b>${time}</b> — ` : ''}${e.title}\n`;
      }
      msg += `\n💪 Tenha um ótimo dia!`;

      try {
        await sendTelegramMessage(user.telegram_chat_id, msg);
      } catch (err) {
        console.error(`❌ Erro no resumo matinal:`, err.message);
      }
    }
  });

  console.log('⏰ Scheduler iniciado — verificando notificações a cada minuto (horário Brasília)');
  console.log('☀️ Resumo matinal configurado para 07:00 (Brasília)');
}

module.exports = { startScheduler };