import React, { useState, useEffect } from 'react';

const TYPE_LABELS = { daily: 'Diário', weekly: 'Semanal', unique: 'Único', deadline: 'Prazo' };
const TYPE_CLASS = { daily: 'badge-daily', weekly: 'badge-weekly', unique: 'badge-unique', deadline: 'badge-deadline' };
const DAY_NAMES_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTH_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

export default function TodayView({ token }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const now = new Date();

  useEffect(() => {
    fetch('/api/events/today', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => { setEvents(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [token]);

  const getEventTime = e => e.time || e.deadline_time;
  const isPast = e => {
    const t = getEventTime(e);
    if (!t) return false;
    const [h, m] = t.split(':').map(Number);
    const eventTime = new Date(); eventTime.setHours(h, m, 0, 0);
    return eventTime < now;
  };

  const upcoming = events.filter(e => !isPast(e));
  const past = events.filter(e => isPast(e));

  return (
    <div style={{ animation: 'fadeUp 0.3s ease' }}>
      <div className="page-header">
        <div>
          <div className="page-title">
            {DAY_NAMES_SHORT[now.getDay()]}, {now.getDate()} de {MONTH_NAMES[now.getMonth()]}
          </div>
          <div className="page-subtitle">
            {events.length === 0 ? 'Nenhum evento hoje' : `${events.length} evento${events.length > 1 ? 's' : ''} agendado${events.length > 1 ? 's' : ''}`}
          </div>
        </div>
      </div>

      <div className="today-grid">
        <div className="stat-card">
          <div className="stat-label">Total hoje</div>
          <div className="stat-value">{events.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Próximos</div>
          <div className="stat-value" style={{ color: 'var(--success)' }}>{upcoming.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Concluídos</div>
          <div className="stat-value" style={{ color: 'var(--text-muted)' }}>{past.length}</div>
        </div>
      </div>

      {loading ? (
        <div className="empty-state"><div className="empty-icon">⏳</div><div className="empty-title">Carregando...</div></div>
      ) : events.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🎉</div>
          <div className="empty-title">Dia livre!</div>
          <div className="empty-desc">Nenhum evento agendado para hoje.</div>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <div style={{ marginBottom: 32 }}>
              <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 16, fontWeight: 600 }}>
                Próximos eventos
              </div>
              <div className="timeline">
                {upcoming.map(e => <TimelineItem key={e.id} event={e} />)}
              </div>
            </div>
          )}

          {past.length > 0 && (
            <div>
              <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 16, fontWeight: 600 }}>
                Anteriores
              </div>
              <div className="timeline" style={{ opacity: 0.5 }}>
                {past.map(e => <TimelineItem key={e.id} event={e} />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TimelineItem({ event }) {
  const time = event.time || event.deadline_time;
  return (
    <div className="timeline-item">
      <div className="timeline-time">{time || '—'}</div>
      <div className="timeline-dot" />
      <div className="timeline-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div className="timeline-card-title">{event.title}</div>
          <span className={`event-type-badge ${TYPE_CLASS[event.type]}`} style={{ fontSize: 10 }}>
            {TYPE_LABELS[event.type]}
          </span>
        </div>
        <div className="timeline-card-meta">
          {event.description && <span>📝 {event.description}</span>}
          {event.deadline_date && <span>⏰ Prazo: {event.deadline_date}</span>}
          <span>🔔 Aviso: {event.notify_minutes_before}min antes</span>
        </div>
      </div>
    </div>
  );
}
