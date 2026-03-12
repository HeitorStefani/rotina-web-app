import React, { useState } from 'react';
import TodayView from './TodayView';
import EventsView from './EventsView';
import SettingsView from './SettingsView';

const NAV = [
  { id: 'today', label: 'Hoje', icon: '☀️' },
  { id: 'events', label: 'Eventos', icon: '📅' },
  { id: 'settings', label: 'Configurações', icon: '⚙️' },
];

export default function Dashboard({ user, token, onLogout }) {
  const [view, setView] = useState('today');

  const api = (url, options = {}) => {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers };
    return fetch(url, { ...options, headers });
  };

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="sidebar-logo">◈ Rotina<span>App</span></div>

        <nav className="sidebar-nav">
          {NAV.map(n => (
            <button
              key={n.id}
              className={`nav-item ${view === n.id ? 'active' : ''}`}
              onClick={() => setView(n.id)}
            >
              <span className="icon">{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div style={{ padding: '12px', borderTop: '1px solid var(--border)', marginBottom: '8px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Conectado como</div>
            <div style={{ fontSize: '14px', fontWeight: 500 }}>{user?.username}</div>
          </div>
          <button className="btn btn-ghost btn-full btn-sm" onClick={onLogout}>
            Sair
          </button>
        </div>
      </aside>

      <main className="main-content">
        {view === 'today' && <TodayView token={token} />}
        {view === 'events' && <EventsView token={token} />}
        {view === 'settings' && <SettingsView token={token} user={user} />}
      </main>
    </div>
  );
}
