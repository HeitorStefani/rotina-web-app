const express = require('express');
const axios = require('axios');
const { getDB } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

async function sendTelegramMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN não configurado');

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const response = await axios.post(url, {
    chat_id: chatId,
    text,
    parse_mode: 'HTML'
  });
  return response.data;
}

// Test telegram connection
router.post('/test', authMiddleware, async (req, res) => {
  const { chat_id } = req.body;
  if (!chat_id) return res.status(400).json({ error: 'chat_id obrigatório' });

  try {
    await sendTelegramMessage(chat_id, '✅ <b>Rotina App conectado!</b>\n\nSuas notificações chegarão aqui. 🎯');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get bot info / instructions
router.get('/setup', authMiddleware, async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return res.status(500).json({ error: 'Bot não configurado no servidor' });

  try {
    const r = await axios.get(`https://api.telegram.org/bot${token}/getMe`);
    const bot = r.data.result;
    res.json({
      bot_username: bot.username,
      bot_name: bot.first_name,
      instructions: [
        `1. Abra o Telegram e pesquise por @${bot.username}`,
        `2. Clique em "Iniciar" ou envie /start`,
        `3. Envie /id para obter seu Chat ID`,
        `4. Cole o Chat ID acima e clique em Testar`
      ]
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar info do bot' });
  }
});

// Webhook — handles all incoming Telegram messages
router.post('/webhook', async (req, res) => {
  const update = req.body;
  res.json({ ok: true }); // Always respond fast to Telegram

  if (!update.message) return;

  const chatId = update.message.chat.id;
  const text = (update.message.text || '').trim();

  // Find user linked to this chat_id
  const db = require('../db').getDB();
  const user = db.prepare('SELECT * FROM users WHERE telegram_chat_id = ?').get(String(chatId));

  try {
    // ── Built-in commands ──
    if (text === '/start') {
      await sendTelegramMessage(chatId,
        `👋 <b>Olá! Sou o assistente do Rotina App.</b>\n\n` +
        `Comandos disponíveis:\n\n` +
        `🆔 /id — Ver seu Chat ID\n` +
        `🤖 /assistente — Montar rotina com IA\n` +
        `📅 /hoje — Ver agenda de hoje\n` +
        `❌ /cancelar — Cancelar assistente`
      );
      return;
    }

    if (text === '/id') {
      await sendTelegramMessage(chatId,
        `🆔 <b>Seu Chat ID é:</b>\n\n<code>${chatId}</code>\n\nCopie esse número e cole nas Configurações do Rotina App.`
      );
      return;
    }

    if (text === '/hoje') {
      if (!user) {
        await sendTelegramMessage(chatId, '⚠️ Vincule seu Chat ID no app primeiro.');
        return;
      }
      const events = db.prepare('SELECT * FROM events WHERE user_id = ? AND active = 1').all(user.id);
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const dayOfWeek = now.getDay();
      const DAY_NAMES_LOCAL = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

      const today = events.filter(e => {
        if (e.type === 'daily') return true;
        if (e.type === 'weekly') return (JSON.parse(e.days_of_week || '[]')).includes(dayOfWeek);
        if (e.type === 'unique') return e.date === todayStr;
        if (e.type === 'deadline') return e.deadline_date >= todayStr;
        return false;
      }).sort((a,b) => (a.time||'23:59').localeCompare(b.time||'23:59'));

      if (!today.length) {
        await sendTelegramMessage(chatId, '🎉 Nenhum evento hoje!');
        return;
      }
      let msg = `☀️ <b>Sua agenda de hoje (${DAY_NAMES_LOCAL[dayOfWeek]}):</b>\n\n`;
      for (const e of today) {
        const t = e.time || e.deadline_time || '';
        msg += `${t ? `🕐 <b>${t}</b> — ` : '📌 '}${e.title}\n`;
      }
      await sendTelegramMessage(chatId, msg);
      return;
    }

    // ── Assistant flow ──
    const { handleAssistantMessage, getSession } = require('./assistant');
    const session = getSession(chatId);

    // Route to assistant if in active flow or starting one
    if (session.state !== 'idle' || text === '/assistente' || text === '/montar' || text === '/cancelar') {
      await handleAssistantMessage(update, user?.id);
      return;
    }

    // Unrecognized message outside of flow
    await sendTelegramMessage(chatId,
      `💬 Não entendi. Use um dos comandos:\n\n/id · /hoje · /assistente`
    );

  } catch (err) {
    console.error('Webhook error:', err.message);
    try {
      await sendTelegramMessage(chatId, '❌ Ocorreu um erro interno. Tente novamente.');
    } catch {}
  }
});

module.exports = router;
module.exports.sendTelegramMessage = sendTelegramMessage;
