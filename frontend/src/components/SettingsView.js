import React, { useState, useEffect } from 'react';

export default function SettingsView({ token, user }) {
  const [chatId, setChatId] = useState('');
  const [notifyMin, setNotifyMin] = useState(30);
  const [botInfo, setBotInfo] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => {
    // Load profile
    fetch('/api/auth/profile', { headers })
      .then(r => r.json())
      .then(data => {
        setChatId(data.telegram_chat_id || '');
        setNotifyMin(data.notify_minutes_before || 30);
      });

    // Load bot info
    fetch('/api/telegram/setup', { headers })
      .then(r => r.json())
      .then(data => setBotInfo(data))
      .catch(() => {});
  }, []);

  const save = async () => {
    setLoading(true); setError(''); setStatus('');
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ telegram_chat_id: chatId, notify_minutes_before: Number(notifyMin) })
      });
      if (!res.ok) throw new Error('Erro ao salvar');
      setStatus('✅ Configurações salvas com sucesso!');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const testTelegram = async () => {
    if (!chatId) return setError('Informe o Chat ID primeiro');
    setTesting(true); setError(''); setStatus('');
    try {
      const res = await fetch('/api/telegram/test', {
        method: 'POST',
        headers,
        body: JSON.stringify({ chat_id: chatId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setStatus('✅ Mensagem de teste enviada! Verifique seu Telegram.');
    } catch (e) {
      setError(`❌ ${e.message}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{ animation: 'fadeUp 0.3s ease', maxWidth: 600 }}>
      <div className="page-header">
        <div>
          <div className="page-title">Configurações</div>
          <div className="page-subtitle">Configure suas notificações e preferências</div>
        </div>
      </div>

      {/* Telegram Setup */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="settings-title">🤖 Configurar Telegram</div>
        <div className="settings-desc">
          Configure seu bot do Telegram para receber notificações no celular
        </div>

        {botInfo ? (
          <>
            <div className="alert alert-info" style={{ marginBottom: 20 }}>
              Bot configurado: <strong>@{botInfo.bot_username}</strong> ({botInfo.bot_name})
            </div>

            <div className="telegram-steps">
              <div className="telegram-step">
                <div className="step-num">1</div>
                <div className="step-text">
                  Abra o Telegram e pesquise por <code>@{botInfo.bot_username}</code>
                </div>
              </div>
              <div className="telegram-step">
                <div className="step-num">2</div>
                <div className="step-text">
                  Clique em <strong>Iniciar</strong> ou envie <code>/start</code>
                </div>
              </div>
              <div className="telegram-step">
                <div className="step-num">3</div>
                <div className="step-text">
                  Envie o comando <code>/id</code> — o bot vai responder com seu Chat ID
                </div>
              </div>
              <div className="telegram-step">
                <div className="step-num">4</div>
                <div className="step-text">
                  Cole o número abaixo e clique em Testar
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="alert alert-error" style={{ marginBottom: 20 }}>
            ⚠️ Token do bot Telegram não configurado no servidor. Verifique a variável <code>TELEGRAM_BOT_TOKEN</code> no arquivo <code>.env</code>
          </div>
        )}

        <div className="field">
          <label>Seu Chat ID do Telegram</label>
          <div style={{ display: 'flex', gap: 12 }}>
            <input
              type="text"
              placeholder="Ex: 123456789"
              value={chatId}
              onChange={e => setChatId(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="btn btn-secondary" onClick={testTelegram} disabled={testing}>
              {testing ? '...' : '📤 Testar'}
            </button>
          </div>
        </div>
      </div>

      {/* Notification Preferences */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="settings-title">🔔 Preferências de Notificação</div>
        <div className="settings-desc">
          Padrão de antecedência para avisos (pode ser configurado por evento)
        </div>

        <div className="field">
          <label>Avisar por padrão quantos minutos antes?</label>
          <select value={notifyMin} onChange={e => setNotifyMin(e.target.value)}>
            <option value={5}>5 minutos antes</option>
            <option value={10}>10 minutos antes</option>
            <option value={15}>15 minutos antes</option>
            <option value={30}>30 minutos antes</option>
            <option value={60}>1 hora antes</option>
            <option value={120}>2 horas antes</option>
          </select>
        </div>

        <div className="alert alert-info">
          ☀️ Você também recebe um <strong>resumo matinal</strong> todo dia às 07:00 com todos os eventos do dia.
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {status && <div className="alert alert-success">{status}</div>}

      <button className="btn btn-primary" onClick={save} disabled={loading}>
        {loading ? 'Salvando...' : 'Salvar configurações'}
      </button>

      {/* Deploy instructions */}
      <div className="card" style={{ marginTop: 32 }}>
        <div className="settings-title">🚀 Como criar seu Bot Telegram</div>
        <div className="settings-desc">Siga esses passos uma única vez</div>
        <div className="telegram-steps">
          <div className="telegram-step">
            <div className="step-num">1</div>
            <div className="step-text">No Telegram, pesquise por <code>@BotFather</code></div>
          </div>
          <div className="telegram-step">
            <div className="step-num">2</div>
            <div className="step-text">Envie <code>/newbot</code> e siga as instruções</div>
          </div>
          <div className="telegram-step">
            <div className="step-num">3</div>
            <div className="step-text">O BotFather vai te dar um <strong>token</strong> — copie-o</div>
          </div>
          <div className="telegram-step">
            <div className="step-num">4</div>
            <div className="step-text">Configure <code>TELEGRAM_BOT_TOKEN=seu_token</code> no arquivo <code>.env</code> do servidor</div>
          </div>
        </div>
      </div>
    </div>
  );
}
