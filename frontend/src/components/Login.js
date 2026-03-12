import React, { useState } from 'react';
import axios from 'axios';

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!username || !password) return setError('Preencha todos os campos');
    setError(''); setLoading(true);
    try {
      const res = await axios.post(`/api/auth/${mode}`, { username, password });
      onLogin(res.data);
    } catch (e) {
      setError(e.response?.data?.error || 'Erro ao conectar');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-bg-grid" />
      <div className="login-bg-glow" />
      <div className="login-card">
        <div className="login-logo">
          <span>◈</span> Rotina<span>App</span>
        </div>
        <p className="login-subtitle">Organize sua rotina. Receba no Telegram.</p>

        <div className="login-tabs">
          <button className={`login-tab ${mode === 'login' ? 'active' : ''}`} onClick={() => { setMode('login'); setError(''); }}>
            Entrar
          </button>
          <button className={`login-tab ${mode === 'register' ? 'active' : ''}`} onClick={() => { setMode('register'); setError(''); }}>
            Criar conta
          </button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="field">
          <label>Usuário</label>
          <input
            type="text"
            placeholder="seu_usuario"
            value={username}
            onChange={e => setUsername(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            autoFocus
          />
        </div>

        <div className="field">
          <label>Senha</label>
          <input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
          />
        </div>

        <button className="btn btn-primary btn-full" onClick={submit} disabled={loading}>
          {loading ? 'Aguarde...' : mode === 'login' ? 'Entrar →' : 'Criar conta →'}
        </button>
      </div>
    </div>
  );
}
