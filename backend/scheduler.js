const cron = require('node-cron');
const { getDB } = require('./db');
const { sendTelegramMessage } = require('./routes/telegram');

const DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const TYPE_EMOJI = { daily: '🔄', weekly: '📅', unique: '📌', deadline: '⏰' };

function formatEventMessage(event, minutesBefore) {
  const emoji = TYPE_EMOJI[event.type] || '📌';
  const when = minutesBefore === 0 ? 'AGORA' : `em ${minutesBefore} minuto${minutesBefore > 1 ? 's' : ''}`;
  
  let msg = `${emoji} <b>${event.title}</b> — ${when}`;
  if (event.description) msg += `\n📝 ${event.description}`;
  if (event.time) msg += `\n🕐 Horário: ${event.time}`;
  if (event.deadline_date) msg += `\n📆 Prazo: ${event.deadline_date}`;
  return msg;
}

function shouldNotifyToday(event) {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const dayOfWeek = now.getDay();

  if (event.type === 'daily') return true;
  if (event.type === 'weekly') {
    const days = event.days_of_week ? JSON.parse(event.days_of_week) : [];
    return days.includes(dayOfWeek);
  }
  if (event.type === 'unique') return event.date === todayStr;
  if (event.type === 'deadline') {
    return event.deadline_date >= todayStr;
  }
  return false;
}

function getEventTime(event) {
  if (event.type === 'deadline') return event.deadline_time;
  return event.time;
}

function wasRecentlyNotified(db, eventId, userId, scheduledFor) {
  // Avoid duplicate notifications within 2 minutes
  const recent = db.prepare(`
    SELECT id FROM notification_log
    WHERE event_id = ? AND user_id = ? AND scheduled_for = ?
    AND sent_at > datetime('now', '-2 minutes')
  `).get(eventId, userId, scheduledFor);
  return !!recent;
}

function logNotification(db, eventId, userId, scheduledFor) {
  db.prepare(`
    INSERT INTO notification_log (event_id, user_id, scheduled_for)
    VALUES (?, ?, ?)
  `).run(eventId, userId, scheduledFor);
}

function startScheduler() {
  // Run every minute
  cron.schedule('* * * * *', async () => {
    const db = getDB();
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const currentTime = `${hours}:${minutes}`;

    // Get all active users with telegram configured
    const users = db.prepare(`
      SELECT * FROM users WHERE telegram_chat_id IS NOT NULL AND telegram_chat_id != ''
    `).all();

    for (const user of users) {
      const events = db.prepare(`
        SELECT * FROM events WHERE user_id = ? AND active = 1
      `).all(user.id);

      for (const event of events) {
        if (!shouldNotifyToday(event)) continue;

        const eventTime = getEventTime(event);
        if (!eventTime) continue;

        // Calculate notification time (event time - notify_minutes_before)
        const [evHour, evMin] = eventTime.split(':').map(Number);
        const notifyMinutes = event.notify_minutes_before ?? user.notify_minutes_before ?? 30;
        
        const eventDate = new Date();
        eventDate.setHours(evHour, evMin, 0, 0);
        const notifyDate = new Date(eventDate.getTime() - notifyMinutes * 60000);
        
        const notifyHour = notifyDate.getHours().toString().padStart(2, '0');
        const notifyMin = notifyDate.getMinutes().toString().padStart(2, '0');
        const notifyTime = `${notifyHour}:${notifyMin}`;

        if (currentTime !== notifyTime) continue;

        const todayStr = now.toISOString().split('T')[0];
        const scheduledFor = `${todayStr} ${eventTime}`;

        if (wasRecentlyNotified(db, event.id, user.id, scheduledFor)) continue;

        try {
          const message = formatEventMessage(event, notifyMinutes);
          await sendTelegramMessage(user.telegram_chat_id, message);
          logNotification(db, event.id, user.id, scheduledFor);
          console.log(`✅ Notificação enviada: [${user.username}] ${event.title} às ${eventTime}`);
        } catch (err) {
          console.error(`❌ Erro ao notificar [${user.username}] evento ${event.id}:`, err.message);
        }
      }

      // Deadline alert: also notify on the deadline day at the deadline time (or 08:00 if no time set)
      const deadlineEvents = events.filter(e => e.type === 'deadline');
      const todayStr = now.toISOString().split('T')[0];
      
      for (const event of deadlineEvents) {
        if (event.deadline_date !== todayStr) continue;
        
        const deadlineTime = event.deadline_time || '08:00';
        const [evHour, evMin] = deadlineTime.split(':').map(Number);
        const notifyMinutes = event.notify_minutes_before ?? user.notify_minutes_before ?? 30;
        
        const eventDate = new Date();
        eventDate.setHours(evHour, evMin, 0, 0);
        const notifyDate = new Date(eventDate.getTime() - notifyMinutes * 60000);
        
        const notifyHour = notifyDate.getHours().toString().padStart(2, '0');
        const notifyMin = notifyDate.getMinutes().toString().padStart(2, '0');
        const notifyTime = `${notifyHour}:${notifyMin}`;

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

  // Daily morning summary at 7:00 AM
  cron.schedule('0 7 * * *', async () => {
    const db = getDB();
    const users = db.prepare(`SELECT * FROM users WHERE telegram_chat_id IS NOT NULL`).all();
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const dayName = DAY_NAMES[now.getDay()];

    for (const user of users) {
      const events = db.prepare(`SELECT * FROM events WHERE user_id = ? AND active = 1`).all(user.id);
      const todayEvents = events.filter(shouldNotifyToday);

      if (todayEvents.length === 0) continue;

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

  console.log('⏰ Scheduler iniciado — verificando notificações a cada minuto');
  console.log('☀️ Resumo matinal configurado para 07:00');
}

module.exports = { startScheduler };
