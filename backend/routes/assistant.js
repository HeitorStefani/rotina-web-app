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

    REGRAS IMPORTANTES:
    - Cada combinação de disciplina + dia + horário vira um objeto SEPARADO no array.
    - NUNCA agrupe dois dias diferentes no mesmo objeto se eles tiverem horários diferentes.
    - Se "Cálculo" tem terça 13h50-15h30 e quarta 10h20-12h00, crie DOIS objetos: um com dias:[2] e outro com dias:[3], cada um com seu próprio horário.
    - Só agrupe dias no mesmo objeto se o horário de início E fim for IDÊNTICO.

    TEXTO:
    ${gradeText}

    Retorne SOMENTE este JSON (sem backticks, sem texto extra):
    {"curso":null,"semestre":null,"aulas":[{"disciplina":"nome","dias":[2],"horario_inicio":"HH:MM","horario_fim":"HH:MM","local":null}]}
    dias: 0=Dom 1=Seg 2=Ter 3=Qua 4=Qui 5=Sex 6=Sáb
    Se não encontrar aulas retorne: {"erro":"não foi possível identificar aulas"}`
    );
      return JSON.parse(text.replace(/```json|```/g, '').trim());
}


// ─── Format grade ─────────────────────────────────────────────────────────────
function formatGradeMessage(grade) {
  if (grade.erro) return `❌ ${grade.erro}`;
  let msg = `📚 <b>Grade Detectada!</b>\n`;
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
  const { grade, lifestyle_1, lifestyle_2, lifestyle_3 } = context;
  const gradeStr = grade.aulas.map(a =>
    `${a.disciplina}: ${a.dias.map(d => DAY_NAMES[d]).join('/')} das ${a.horario_inicio} às ${a.horario_fim}`
  ).join('\n');

  const raw = await callGroq(
    'Você monta rotinas para estudantes universitários e retorna SOMENTE JSON válido, sem markdown, sem explicações.',
    `Monte uma rotina completa e saudável para um estudante de Engenharia da Computação.

GRADE DE AULAS:
${gradeStr}

SOBRE O ESTUDANTE:
- Sono e horários: ${lifestyle_1}
- Hábitos e saúde atual: ${lifestyle_2}
- Objetivos e prioridades: ${lifestyle_3}

DIRETRIZES:
- Nunca conflite com as aulas.
- Priorize saúde física: inclua exercício, pausas ativas, hidratação.
- Priorize saúde mental: inclua descanso real, lazer, tempo offline.
- Para computação: inclua blocos de estudo/projetos pessoais nos horários livres mais produtivos.
- Respeite os horários de sono informados.
- Refeições em horários regulares e saudáveis.
- Seja realista: não encha todos os horários livres, deixe margem para imprevistos.
- Use nomes de eventos humanos e motivadores, não robóticos.

Retorne SOMENTE este JSON (sem backticks, sem texto extra):
{"resumo":"resumo curto e motivador da rotina","eventos":[{"title":"nome do evento","description":"dica curta e prática","type":"daily|weekly","time":"HH:MM","days_of_week":[1,2,3],"notify_minutes_before":15}]}`
  );

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Nenhum JSON encontrado na resposta do modelo');
  return JSON.parse(match[0]);
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
// ─── Main handler ─────────────────────────────────────────────────────────────
async function handleAssistantMessage(update, userId) {
  const msg = update.message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const session = getSession(chatId);
  const { state, context } = session;

  if (text === '/assistente' || text === '/montar') {
    saveSession(chatId, 'choosing_mode', {});
    await sendTelegramMessage(chatId,
      `⚡ <b>Vamos montar sua rotina!</b>\n\n` +
      `Antes de tudo, como quer informar sua grade?\n\n` +
      `📝 /livre — Cola tudo de uma vez\n` +
      `🧭 /guiado — Adiciona disciplina por disciplina\n\n` +
      `/cancelar para sair.`
    );
    return;
  }

  if (text === '/cancelar') {
    resetSession(chatId);
    await sendTelegramMessage(chatId, '❌ Cancelado. /assistente para recomeçar.');
    return;
  }

  if (state === 'choosing_mode' || text === '/livre' || text === '/guiado') {
    if (text === '/livre' || (state === 'choosing_mode' && text.toLowerCase().includes('livre'))) {
      saveSession(chatId, 'waiting_grade_text', {});
      await sendTelegramMessage(chatId,
        `📝 <b>Modo texto livre</b>\n\n` +
        `Cole sua grade em qualquer formato. Exemplos:\n\n` +
        `<i>Segunda e quarta 8h-10h Cálculo\n` +
        `Terça e quinta 10h-12h POO\n` +
        `Sexta 14h-16h Banco de Dados</i>\n\n` +
        `Pode mandar tudo de uma vez!`
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

    case 'waiting_grade_text': {
      await sendTelegramMessage(chatId, '⏳ Interpretando sua grade...');
      try {
        const grade = await parseGradeFromText(text);
        if (grade.erro || !grade.aulas?.length) {
          await sendTelegramMessage(chatId,
            `❌ Não consegui identificar aulas no texto.\n\nTente algo como:\n<i>Segunda 8h-10h Cálculo\nTerça e quinta 10h-12h POO</i>`
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

    case 'guided_adding': {
      if (/^(pronto|fim|ok|done|terminar)$/i.test(text)) {
        if (!context.grade.aulas.length) {
          await sendTelegramMessage(chatId, '⚠️ Nenhuma disciplina adicionada ainda!');
          return;
        }
        await sendTelegramMessage(chatId,
          formatGradeMessage(context.grade) + `\nEstá correto? Responda <b>sim</b> ou <b>não</b>.`
        );
        saveSession(chatId, 'confirming_grade', context);
        return;
      }

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

    case 'confirming_grade': {
      if (/^(sim|s|yes|ok|correto|certo|isso|perfeito)$/i.test(text)) {
        saveSession(chatId, 'asking_lifestyle', context);
        await sendTelegramMessage(chatId,
          `✅ Grade confirmada!\n\n` +
          `Agora me conta um pouco sobre você pra eu montar algo que realmente funcione.\n\n` +
          `🕐 <b>Que horas você costuma acordar e dormir?</b>\n\n` +
          `Pode responder naturalmente, tipo:\n` +
          `<i>"Acordo às 7h e durmo por volta da meia-noite"</i>`
        );
      } else if (/^(n[aã]o|no|n|errado)$/i.test(text)) {
        saveSession(chatId, 'waiting_grade_text', {});
        await sendTelegramMessage(chatId, '📝 Ok! Cole sua grade novamente com as correções.');
      } else {
        await sendTelegramMessage(chatId, 'Responda <b>sim</b> ou <b>não</b>.');
      }
      break;
    }

    case 'asking_lifestyle': {
      context.lifestyle_1 = text;
      saveSession(chatId, 'asking_habits', context);
      await sendTelegramMessage(chatId,
        `Legal! E no dia a dia, como você se sente atualmente?\n\n` +
        `🍕 Come bem? Faz exercício? Fica muito tempo na frente do PC?\n` +
        `Tem algo que quer mudar ou melhorar?\n\n` +
        `<i>Me conta à vontade, quanto mais detalhe melhor pra eu personalizar sua rotina.</i>`
      );
      break;
    }

    case 'asking_habits': {
      context.lifestyle_2 = text;
      saveSession(chatId, 'asking_goals', context);
      await sendTelegramMessage(chatId,
        `Entendido! Última coisa:\n\n` +
        `🎯 <b>O que você quer priorizar com essa rotina?</b>\n\n` +
        `Ex: <i>"Quero melhorar meu rendimento nas aulas, ter mais energia, dormir melhor, aprender programação além da faculdade..."</i>\n\n` +
        `Pode ser qualquer coisa, não precisa ser só acadêmico.`
      );
      break;
    }

    case 'asking_goals': {
      context.lifestyle_3 = text;
      saveSession(chatId, 'confirming_routine', context);
      await sendTelegramMessage(chatId, `⏳ <b>Montando sua rotina personalizada...</b> Isso pode levar alguns segundos ✨`);

      try {
        const routine = await generateRoutine(context);
        let preview = `🎉 <b>Sua rotina está pronta!</b>\n\n${routine.resumo}\n\n<b>${routine.eventos.length} eventos programados:</b>\n\n`;
        for (const e of routine.eventos.slice(0, 12)) {
          const days = e.days_of_week ? e.days_of_week.map(d => DAY_NAMES[d]).join('/') : 'Diário';
          preview += `• ${e.title} — ${e.time || ''} ${days}\n`;
        }
        if (routine.eventos.length > 12) preview += `... e mais ${routine.eventos.length - 12} eventos.\n`;
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
        await sendTelegramMessage(chatId, `✅ <b>${count} eventos cadastrados!</b>\n\nSua rotina está ativa! Você receberá notificações antes de cada evento. 💪\n\n📱 Abra o app para ver tudo.`);
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