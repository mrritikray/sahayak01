import React, { createContext, useContext, useState, useEffect } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Patients from './pages/Patients.jsx';
import Family from './pages/Family.jsx';
import Schedules from './pages/Schedules.jsx';
import Templates from './pages/Templates.jsx';
import History from './pages/History.jsx';
import Settings from './pages/Settings.jsx';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export async function api(path, options = {}) {
  const token = localStorage.getItem('sahayak_token');
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    localStorage.removeItem('sahayak_token');
    if (!path.startsWith('/auth/')) window.location.href = '/login';
    throw new Error('Not logged in');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/patients', label: 'Patients' },
  { to: '/family', label: 'Family Members' },
  { to: '/schedules', label: 'Medicines & Schedules' },
  { to: '/templates', label: 'Message Templates' },
  { to: '/history', label: 'Reminder History' },
  { to: '/settings', label: 'Settings & Integrations' },
];

export function Confirm({ open, title, message, onConfirm, onCancel, danger = true }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>{title}</h3>
        <p style={{ marginBottom: 16 }}>{message}</p>
        <div className="btn-group">
          <button className={danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={onConfirm}>Confirm</button>
          <button className="btn" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function Modal({ open, title, children, onClose }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(!!localStorage.getItem('sahayak_token'));
  const [mode, setMode] = useState('demo');
  const location = useLocation();

  useEffect(() => {
    if (!authed) return;
    api('/settings').then(s => setMode(s.mode)).catch(() => {});
  }, [authed, location.pathname]);

  const value = {
    authed, setAuthed, mode,
    logout: async () => {
      try { await api('/auth/logout', { method: 'POST' }); } catch {}
      localStorage.removeItem('sahayak_token');
      setAuthed(false);
    },
  };

  if (!authed) {
    return (
      <AuthCtx.Provider value={value}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AuthCtx.Provider>
    );
  }

  return (
    <AuthCtx.Provider value={value}>
      <div className="app-layout">
        <aside className="sidebar">
          <div className="logo">SAHAYAK</div>
          <nav>
            {NAV.map(n => (
              <NavLink key={n.to} to={n.to} end={n.to === '/'}
                className={({ isActive }) => (isActive ? 'active' : '')}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div style={{ padding: '0 24px' }}>
            <span className={`badge badge-${mode}`}>{mode} mode</span>
            <button className="btn btn-sm" style={{ marginTop: 10, width: '100%' }} onClick={value.logout}>
              Log out
            </button>
          </div>
        </aside>
        <main className="main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/patients" element={<Patients />} />
            <Route path="/family" element={<Family />} />
            <Route path="/schedules" element={<Schedules />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="/history" element={<History />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </AuthCtx.Provider>
  );
}
