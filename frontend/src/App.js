import React, { useState, useEffect } from 'react';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import './styles.css';

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (token) {
      const stored = localStorage.getItem('user');
      if (stored) setUser(JSON.parse(stored));
    }
  }, [token]);

  const handleLogin = (data) => {
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data));
    setToken(data.token);
    setUser(data);
  };

  const handleLogout = () => {
    localStorage.clear();
    setToken(null);
    setUser(null);
  };

  if (!token) return <Login onLogin={handleLogin} />;
  return <Dashboard user={user} token={token} onLogout={handleLogout} />;
}
