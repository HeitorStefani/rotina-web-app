import React, { useState, useEffect } from 'react';

const TYPE_LABELS = { daily: 'Diário', weekly: 'Semanal', unique: 'Único', deadline: 'Prazo' };
const TYPE_CLASS = { daily: 'badge-daily', weekly: 'badge-weekly', unique: 'badge-unique', deadline: 'badge-deadline' };
const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const FILTERS = ['todos', 'daily', 'weekly', 'unique', 'deadline'];
const FILTER_LABELS = { todos: 'Todos', daily: 'Diários', weekly: 'Semanais', unique: 'Únicos', deadline: 'Prazos' };

const EMPTY_FORM = {
  title: '', description: '', type: 'daily', time: '',
  date: '', days_of_week: [], deadline_date: '', deadline_time: '',
  notify_minutes_before: 30
};

export default function EventsView({ token }) {
  const [events, setEvents] = useState([]);
  const [filter, setFilter] = useState('todos');
  const [showModal, setShowModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const load = () => {
    fetch('/api/events', { headers })
      .then(r => r.json())
      .then(data => setEvents(Array.isArray(data) ? data : []));
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditingEvent(null);
    setForm(EMPTY_FORM);
    setError('');
    setShowModal(true);
  };

  const openEdit = (e) => {
    setEditingEvent(e);
    setForm({
      title: e.title || '',
      description: e.description || '',
      type: e.type,
      time: e.time || '',
      date: e.date || '',
      days_of_week: e.days_of_week || [],
      deadline_date: e.deadline_date || '',
      deadline_time: e.deadline_time || '',
      notify_minutes_before: e.notify_minutes_before || 30
    });
    setError('');
    setShowModal(true);
  };

  const save = async () => {
    if (!form.title) return setError('Título obrigatório');
    if (form.type === 'weekly' && form.days_of_week.length === 0) return setError('Selecione ao menos um dia');
    if ((form.type === 'daily' || form.type === 'weekly') && !form.time) return setError('Horário obrigatório');
    if (form.type === 'unique' && (!form.date || !form.time)) return setError('Data e horário obrigatórios');
    if (form.type === 'deadline' && !form.deadline_date) return setError('Data do prazo obrigatória');

    setLoading(true); setError('');
    try {
      const url = editingEvent ? `/api/events/${editingEvent.id}` : '/api/events';
      const method = editingEvent ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers, body: JSON.stringify(form) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      load();
      setShowModal(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const del = async (id) => {
    if (!window.confirm('Remover este evento?')) return;
    await fetch(`/api/events/${id}`, { method: 'DELETE', headers });
    load();
  };

  const toggleDay = (day) => {
    setForm(f => ({
      ...f,
      days_of_week: f.days_of_week.includes(day)
        ? f.days_of_week.filter(d => d !== day)
        : [...f.days_of_week, day]
    }));
  };

  const filtered = filter === 'todos' ? events : events.filter(e => e.type === filter);

  const getEventMeta = (e) => {
    if (e.type === 'daily') return e.time ? `Todo dia às ${e.time}` : 'Todo dia';
    if (e.type === 'weekly') {
      const days = (e.days_of_week || []).map(d => DAY_NAMES[d]).join(', ');
      return `${days}${e.time ? ` às ${e.time}` : ''}`;
    }
    if (e.type === 'unique') return `${e.date || ''}${e.time ? ` às ${e.time}` : ''}`;
    if (e.type === 'deadline') return `Prazo: ${e.deadline_date}${e.deadline_time ? ` às ${e.deadline_time}` : ''}`;
    return '';
  };

  return (
    <div style={{ animation: 'fadeUp 0.3s ease' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Eventos</div>
          <div className="page-subtitle">{events.length} evento{events.length !== 1 ? 's' : ''} cadastrado{events.length !== 1 ? 's' : ''}</div>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ Novo evento</button>
      </div>

      <div className="filter-chips">
        {FILTERS.map(f => (
          <button key={f} className={`chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
            {FILTER_LABELS[f]}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📋</div>
          <div className="empty-title">Nenhum evento</div>
          <div className="empty-desc">Clique em "Novo evento" para começar.</div>
          <button className="btn btn-primary" onClick={openNew}>+ Criar primeiro evento</button>
        </div>
      ) : (
        <div className="events-grid">
          {filtered.map(e => (
            <div key={e.id} className="event-card">
              <span className={`event-type-badge ${TYPE_CLASS[e.type]}`}>{TYPE_LABELS[e.type]}</span>
              <div className="event-info">
                <div className="event-title">{e.title}</div>
                <div className="event-meta">
                  {getEventMeta(e)}
                  {e.description && ` · ${e.description}`}
                  {` · 🔔 ${e.notify_minutes_before}min antes`}
                </div>
              </div>
              <div className="event-actions">
                <button className="btn btn-ghost btn-sm btn-icon" onClick={() => openEdit(e)} title="Editar">✏️</button>
                <button className="btn btn-danger btn-sm btn-icon" onClick={() => del(e.id)} title="Remover">🗑️</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">{editingEvent ? 'Editar evento' : 'Novo evento'}</div>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>✕</button>
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            <div className="field">
              <label>Tipo de evento</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                <option value="daily">🔄 Rotina diária (todo dia)</option>
                <option value="weekly">📅 Semanal (dias específicos)</option>
                <option value="unique">📌 Compromisso único (data específica)</option>
                <option value="deadline">⏰ Tarefa com prazo</option>
              </select>
            </div>

            <div className="field">
              <label>Título</label>
              <input
                type="text"
                placeholder="Ex: Academia, Reunião, Entregar relatório..."
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                autoFocus
              />
            </div>

            <div className="field">
              <label>Descrição (opcional)</label>
              <input
                type="text"
                placeholder="Detalhes adicionais..."
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>

            {(form.type === 'daily' || form.type === 'weekly') && (
              <div className="field">
                <label>Horário</label>
                <input type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} />
              </div>
            )}

            {form.type === 'weekly' && (
              <div className="field">
                <label>Dias da semana</label>
                <div className="days-picker">
                  {DAY_NAMES.map((name, i) => (
                    <button
                      key={i}
                      className={`day-btn ${form.days_of_week.includes(i) ? 'selected' : ''}`}
                      onClick={() => toggleDay(i)}
                      type="button"
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {form.type === 'unique' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="field">
                  <label>Data</label>
                  <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                </div>
                <div className="field">
                  <label>Horário</label>
                  <input type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} />
                </div>
              </div>
            )}

            {form.type === 'deadline' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="field">
                  <label>Data do prazo</label>
                  <input type="date" value={form.deadline_date} onChange={e => setForm(f => ({ ...f, deadline_date: e.target.value }))} />
                </div>
                <div className="field">
                  <label>Horário (opcional)</label>
                  <input type="time" value={form.deadline_time} onChange={e => setForm(f => ({ ...f, deadline_time: e.target.value }))} />
                </div>
              </div>
            )}

            <div className="field">
              <label>Avisar quantos minutos antes?</label>
              <select value={form.notify_minutes_before} onChange={e => setForm(f => ({ ...f, notify_minutes_before: Number(e.target.value) }))}>
                <option value={5}>5 minutos antes</option>
                <option value={10}>10 minutos antes</option>
                <option value={15}>15 minutos antes</option>
                <option value={30}>30 minutos antes</option>
                <option value={60}>1 hora antes</option>
                <option value={120}>2 horas antes</option>
              </select>
            </div>

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={save} disabled={loading}>
                {loading ? 'Salvando...' : editingEvent ? 'Salvar alterações' : 'Criar evento'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
