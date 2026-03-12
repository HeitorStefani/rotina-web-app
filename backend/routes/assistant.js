const axios = require('axios');
const { getDB } = require('../db');
const { sendTelegramMessage } = require('./telegram');

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// ─── Session helpers ──────────────────────────────────────────────────────────
function getSession(chatId) {
  const db = getDB();
  let session = db.prepare('SELECT * FROM conversation_sessions WHERE chat_id = ?').get(String(chatId));
  if (!session) {
    db.prepare('INSERT INTO conversation_sessions (chat_id, state, context) VALUES (?, ?, ?)').run(String(chatId), 'idle', '{}');
    session = db.prepare('SELECT * FROM conversation_sessions WHERE chat_id = ?').get(String(chatId));
  }
  return { ...session, context: JSON.parse(session.context || '{}') };
}

function saveSession(chatId, state, context) {
  const db = getDB();
  db.prepare(`
    INSERT INTO conversation_sessions (chat_id, state, context, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(chat_id) DO UPDATE SET state=excluded.state, context=excluded.context, updated_at=excluded.updated_at
  `).run(String(chatId), state, JSON.stringify(context));
}

function resetSession(chatId) {
  saveSession(chatId, 'idle', {});
}

// ─── Groq ─────────────────────────────────────────────────────────────────────
async function callGroq(systemPrompt, userPrompt) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY não configurada no .env');

  const response = await axios.post(GROQ_API, {
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.2,
    max_tokens: 2000
  }, {
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }
  });

  return response.data.choices[0].message.content;
}

// ─── Parse grade from free text via Groq ─────────────────────────────────────
async function parseGradeFromText(gradeText) {
  const text = await callGroq(
    'Você extrai grades horárias de texto livre e retorna SOMENTE JSON válido, sem markdown, sem explicações.',
    `Extraia as disciplinas e horários deste texto de grade universitária.

TEXTO:
${gradeText}

Retorne SOMENTE este JSON (sem backticks, sem texto extra):
{"curso":null,"semestre":null,"aulas":[{"disciplina":"nome","dias":[1,3],"horario_inicio":"HH:MM","horario_fim":"HH:MM","local":null}]}
dias: 0=Dom 1=Seg 2=Ter 3=Qua 4=Qui 5=Sex 6=Sáb
Se não encontrar aulas retorne: {"erro":"não foi possível identificar aulas"}`
  );
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

// ─── Format grade ─────────────────────────────────────────────────────────────
function formatGradeMessage(grade) {
  if (grade.erro) return `❌ ${grade.erro}`;
  let msg = `📚 <b>Grade detectada!</b>\n`;
  if (grade.curso) msg += `🎓 ${grade.curso}\n`;
  if (grade.semestre) msg += `📅 ${grade.semestre}\n`;
  msg += '\n';
  for (const aula of grade.aulas) {
    const dias = aula.dias.map(d => DAY_NAMES[d]).join(', ');
    msg += `📖 <b>${aula.disciplina}</b>\n   ${dias} · ${aula.horario_inicio}–${aula.horario_fim}`;
    if (aula.local) msg += ` · ${aula.local}`;
    msg += '\n\n';
  }
  return msg;
}

// ─── Generate routine ─────────────────────────────────────────────────────────
async function generateRoutine(context) {
  const { grade, preferences } = context;
  const gradeStr = grade.aulas.map(a =>
    `${a.disciplina}: ${a.dias.map(d => DAY_NAMES[d]).join('/')} das ${a.horario_inicio} às ${a.horario_fim}`
  ).join('\n');

  const text = await callGroq(
    `Você é um especialista em produtividade para estudantes universitários. Monta rotinas realistas, inteligentes e personalizadas. Retorna SOMENTE JSON válido, sem markdown, sem explicações, sem backticks.`,
    `Monte uma rotina DETALHADA e REALISTA para este estudante universitário.

═══ GRADE DE AULAS PRESENCIAIS ═══
${gradeStr}

Atenção: os dias acima são FIXOS e IMUTÁVEIS. Não mova nenhuma aula de dia ou horário.

═══ PREFERÊNCIAS DO ESTUDANTE ═══
- Acorda: ${preferences.wake}
- Dorme: ${preferences.sleep}
- Refeições: ${preferences.meals}
- Estudo/revisão: ${preferences.study}
- Academia/exercícios: ${preferences.gym}
- Cursos extras: ${preferences.courses}
- Lazer/descanso: ${preferences.leisure}

═══ REGRAS OBRIGATÓRIAS ═══
1. NUNCA agende nada no horário de uma aula presencial
2. Academia: máximo 3x por semana, respeite o que o estudante disse. Se disse "não faço", não inclua
3. Estudo/revisão: distribua nos dias em que há aulas, preferencialmente logo após elas
4. Refeições: use os horários exatos que o estudante informou
5. Lazer: reserve o horário que o estudante pediu, não preencha tudo com tarefas
6. Inclua pelo menos 1 bloco semanal para cada disciplina EaD (Metodologia de Pesquisa, Certificadora da Competência, Inteligência Artificial, Redes de Computadores) — coloque nos dias sem muitas aulas presenciais
7. Sono: inclua horário de dormir baseado no que o estudante informou
8. Seja ESPECÍFICO nos títulos: "Revisão de POO 2" em vez de "Estudo", "Academia" apenas nos dias corretos
9. Notificações: aulas = 30min antes, refeições = 10min antes, academia = 30min antes, lazer/sono = 5min antes

Retorne SOMENTE este JSON (sem backticks, sem texto extra):
{"resumo":"descrição personalizada da rotina montada","eventos":[{"title":"nome específico","description":null,"type":"daily|weekly","time":"HH:MM","days_of_week":[1,2,3],"notify_minutes_before":15}]}

type "daily" = acontece todo dia (ex: acordar, refeições)
type "weekly" = dias específicos da semana (ex: aulas, academia, revisões)`
  );

  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

// ─── Save events ──────────────────────────────────────────────────────────────
function saveEventsForUser(userId, eventos) {
  const db = getDB();
  const user = db.prepare('SELECT notify_minutes_before FROM users WHERE id = ?').get(userId);
  let count = 0;
  for (const e of eventos) {
    try {
      db.prepare(`
        INSERT INTO events (user_id, title, description, type, time, days_of_week, notify_minutes_before)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId, e.title, e.description || null, e.type, e.time || null,
        e.days_of_week ? JSON.stringify(e.days_of_week) : null,
        e.notify_minutes_before ?? user?.notify_minutes_before ?? 30
      );
      count++;
    } catch (err) {
      console.error('Erro ao salvar evento:', e.title, err.message);
    }
  }
  return count;
}

// ─── Guided mode — add one subject at a time ─────────────────────────────────
function formatGuidedAulas(aulas) {
  if (!aulas.length) return '';
  return '\n\n📋 <b>Adicionadas até agora:</b>\n' + aulas.map(a =>
    `• ${a.disciplina} — ${a.dias.map(d => DAY_NAMES[d]).join('/')} ${a.horario_inicio}–${a.horario_fim}`
  ).join('\n');
}

// ─── Main handler ─────────────────────────────────────────────────────────────
async function handleAssistantMessage(update, userId) {
  const msg = update.message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const session = getSession(chatId);
  const { state, context } = session;

  // ── Start ──
  if (text === '/assistente' || text === '/montar') {
    saveSession(chatId, 'choosing_mode', {});
    await sendTelegramMessage(chatId,
      `🤖 <b>Assistente de Rotina!</b>\n\n` +
      `Como prefere informar sua grade?\n\n` +
      `📝 /livre — Colar tudo de uma vez em texto\n` +
      `🧭 /guiado — Adicionar disciplina por disciplina\n\n` +
      `/cancelar para sair.`
    );
    return;
  }

  if (text === '/cancelar') {
    resetSession(chatId);
    await sendTelegramMessage(chatId, '❌ Cancelado. /assistente para recomeçar.');
    return;
  }

  // ── Mode selection ──
  if (state === 'choosing_mode' || text === '/livre' || text === '/guiado') {
    if (text === '/livre' || (state === 'choosing_mode' && text.toLowerCase().includes('livre'))) {
      saveSession(chatId, 'waiting_grade_text', {});
      await sendTelegramMessage(chatId,
        `📝 <b>Modo texto livre</b>\n\n` +
        `Cole sua grade em qualquer formato. Exemplos:\n\n` +
        `<i>Segunda e quarta 8h-10h Cálculo\n` +
        `Terça e quinta 10h-12h POO\n` +
        `Sexta 14h-16h Banco de Dados</i>\n\n` +
        `Ou copie direto do site da faculdade. Pode mandar tudo de uma vez!`
      );
      return;
    }
    if (text === '/guiado' || (state === 'choosing_mode' && text.toLowerCase().includes('guiado'))) {
      saveSession(chatId, 'guided_adding', { grade: { aulas: [] } });
      await sendTelegramMessage(chatId,
        `🧭 <b>Modo guiado</b>\n\nVamos adicionar uma disciplina por vez.\n\n` +
        `Digite no formato:\n<code>Nome da disciplina | dias | início | fim</code>\n\n` +
        `Exemplos:\n` +
        `<code>Cálculo | seg,qua | 08:00 | 10:00</code>\n` +
        `<code>POO | ter,qui | 10:00 | 12:00</code>\n\n` +
        `Quando terminar, envie <b>pronto</b>.`
      );
      return;
    }
  }

  switch (state) {

    // ── Free text mode ──
    case 'waiting_grade_text': {
      await sendTelegramMessage(chatId, '⏳ Interpretando sua grade...');
      try {
        const grade = await parseGradeFromText(text);
        if (grade.erro || !grade.aulas?.length) {
          await sendTelegramMessage(chatId,
            `❌ Não consegui identificar aulas no texto.\n\nTente ser mais específico, ex:\n<i>Segunda 8h-10h Cálculo\nTerça e quinta 10h-12h POO</i>`
          );
          return;
        }
        await sendTelegramMessage(chatId,
          formatGradeMessage(grade) + `\nEstá correto? Responda <b>sim</b> ou <b>não</b> para digitar novamente.`
        );
        saveSession(chatId, 'confirming_grade', { grade });
      } catch (err) {
        const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        await sendTelegramMessage(chatId, `❌ Erro: ${detail}`);
      }
      break;
    }

    // ── Guided mode ──
    case 'guided_adding': {
      if (/^(pronto|fim|ok|done|terminar)$/i.test(text)) {
        if (!context.grade.aulas.length) {
          await sendTelegramMessage(chatId, '⚠️ Nenhuma disciplina adicionada ainda! Digite pelo menos uma.');
          return;
        }
        await sendTelegramMessage(chatId,
          formatGradeMessage(context.grade) + `\nEstá correto? Responda <b>sim</b> ou <b>não</b>.`
        );
        saveSession(chatId, 'confirming_grade', context);
        return;
      }

      // Parse "Disciplina | dias | inicio | fim"
      const parts = text.split('|').map(s => s.trim());
      if (parts.length < 4) {
        await sendTelegramMessage(chatId,
          `⚠️ Formato inválido. Use:\n<code>Nome | dias | início | fim</code>\n\nEx: <code>Cálculo | seg,qua | 08:00 | 10:00</code>\n\nOu envie <b>pronto</b> para finalizar.`
        );
        return;
      }

      const [disciplina, daysStr, inicio, fim] = parts;
      const dayMap = { dom:0, seg:1, ter:2, qua:3, qui:4, sex:5, sab:6, sáb:6 };
      const dias = daysStr.toLowerCase().split(/[,\s]+/)
        .map(d => dayMap[d.substring(0,3)])
        .filter(d => d !== undefined);

      if (!dias.length) {
        await sendTelegramMessage(chatId, `⚠️ Dias inválidos. Use: seg, ter, qua, qui, sex, sab`);
        return;
      }

      context.grade.aulas.push({ disciplina, dias, horario_inicio: inicio, horario_fim: fim, local: null });
      saveSession(chatId, 'guided_adding', context);
      await sendTelegramMessage(chatId,
        `✅ <b>${disciplina}</b> adicionada!` +
        formatGuidedAulas(context.grade.aulas) +
        `\n\nAdicione outra ou envie <b>pronto</b> para continuar.`
      );
      break;
    }

    // ── Confirm grade ──
    case 'confirming_grade': {
      if (/^(sim|s|yes|ok|correto|certo|isso|perfeito)$/i.test(text)) {
        saveSession(chatId, 'asking_wake', context);
        await sendTelegramMessage(chatId, `✅ Ótimo!\n\n⏰ <b>Que horas você costuma acordar?</b>\nEx: <i>6:30</i>`);
      } else if (/^(n[aã]o|no|n|errado)$/i.test(text)) {
        saveSession(chatId, 'waiting_grade_text', {});
        await sendTelegramMessage(chatId, '📝 Ok! Cole sua grade novamente com as correções.');
      } else {
        await sendTelegramMessage(chatId, 'Responda <b>sim</b> ou <b>não</b>.');
      }
      break;
    }

    case 'asking_wake': {
      context.preferences = { wake: text };
      saveSession(chatId, 'asking_sleep', context);
      await sendTelegramMessage(chatId, `😴 <b>Que horas você dorme?</b>\nEx: <i>23h</i>`);
      break;
    }

    case 'asking_sleep': {
      context.preferences.sleep = text;
      saveSession(chatId, 'asking_meals', context);
      await sendTelegramMessage(chatId, `🍽️ <b>Horários de refeição?</b>\nEx: <i>café 7h, almoço 12h, jantar 19h</i>`);
      break;
    }

    case 'asking_meals': {
      context.preferences.meals = text;
      saveSession(chatId, 'asking_study', context);
      await sendTelegramMessage(chatId, `📖 <b>Como organiza seus estudos?</b>\nEx: <i>1h depois de cada aula</i> ou <i>não precisa</i>`);
      break;
    }

    case 'asking_study': {
      context.preferences.study = text;
      saveSession(chatId, 'asking_gym', context);
      await sendTelegramMessage(chatId, `🏋️ <b>Faz academia ou exercícios?</b>\nEx: <i>seg/qua/sex às 6h</i> ou <i>não faço</i>`);
      break;
    }

    case 'asking_gym': {
      context.preferences.gym = text;
      saveSession(chatId, 'asking_courses', context);
      await sendTelegramMessage(chatId, `💻 <b>Faz cursos extras?</b>\nEx: <i>1h por dia</i> ou <i>não faço</i>`);
      break;
    }

    case 'asking_courses': {
      context.preferences.courses = text;
      saveSession(chatId, 'asking_leisure', context);
      await sendTelegramMessage(chatId, `🎮 <b>Tempo de lazer?</b>\nEx: <i>noite após 21h</i>`);
      break;
    }

    case 'asking_leisure': {
      context.preferences.leisure = text;
      saveSession(chatId, 'confirming_routine', context);
      await sendTelegramMessage(chatId, `⏳ <b>Gerando sua rotina personalizada...</b> ✨`);
      try {
        const routine = await generateRoutine(context);
        let preview = `🎉 <b>Rotina pronta!</b>\n\n${routine.resumo}\n\n<b>${routine.eventos.length} eventos:</b>\n\n`;
        for (const e of routine.eventos.slice(0, 12)) {
          const days = e.days_of_week ? e.days_of_week.map(d => DAY_NAMES[d]).join('/') : 'Diário';
          preview += `• ${e.title} — ${e.time || ''} ${days}\n`;
        }
        if (routine.eventos.length > 12) preview += `... e mais ${routine.eventos.length - 12}.\n`;
        preview += `\nDigite <b>confirmar</b> para salvar ou <b>cancelar</b> para descartar.`;
        context.routine = routine;
        saveSession(chatId, 'confirming_routine', context);
        await sendTelegramMessage(chatId, preview);
      } catch (err) {
        const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        console.error('Erro rotina:', detail);
        await sendTelegramMessage(chatId, `❌ Erro: ${detail}\n\n/assistente para tentar novamente.`);
        resetSession(chatId);
      }
      break;
    }

    case 'confirming_routine': {
      if (/^(confirmar|confirma|sim|s|yes|cadastrar|salvar)$/i.test(text)) {
        if (!userId) {
          await sendTelegramMessage(chatId, `⚠️ Telegram não vinculado.\n\nApp → Configurações → cole seu Chat ID → salve. Depois /assistente.`);
          resetSession(chatId);
          return;
        }
        const count = saveEventsForUser(userId, context.routine.eventos);
        await sendTelegramMessage(chatId, `✅ <b>${count} eventos cadastrados!</b>\n\nRotina ativa! Você receberá notificações antes de cada evento.\n\n📱 Abra o app para ver os detalhes.`);
        resetSession(chatId);
      } else if (/^(cancelar|cancel|n[aã]o|descartar)$/i.test(text)) {
        resetSession(chatId);
        await sendTelegramMessage(chatId, '❌ Rotina descartada. /assistente para recomeçar.');
      } else {
        await sendTelegramMessage(chatId, 'Digite <b>confirmar</b> ou <b>cancelar</b>.');
      }
      break;
    }

    default: break;
  }
}

module.exports = { handleAssistantMessage, getSession };