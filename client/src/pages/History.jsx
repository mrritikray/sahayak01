import React, { useEffect, useState } from 'react';
import { api } from '../App.jsx';

const STATUSES = ['', 'PENDING', 'AWAITING_RESPONSE', 'TAKEN', 'NOT_TAKEN', 'NO_RESPONSE', 'SEND_FAILED', 'CANCELLED'];
const MSG_STATUSES = ['', 'simulated', 'sent', 'delivered', 'read', 'failed'];

export default function History() {
  const [rows, setRows] = useState([]);
  const [patients, setPatients] = useState([]);
  const [family, setFamily] = useState([]);
  const [filters, setFilters] = useState({
    patient: '', family: '', medicine: '', from: '', to: '',
    dose_status: '', message_status: '', mode: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
      setRows(await api(`/history?${qs}`));
    } catch (e) { setError(e.message); }
    setLoading(false);
  };
  useEffect(() => { load(); }, [filters]);
  useEffect(() => {
    api('/patients').then(setPatients).catch(() => {});
    api('/family').then(setFamily).catch(() => {});
  }, []);

  const set = (k, v) => setFilters(f => ({ ...f, [k]: v }));

  return (
    <div>
      <h1 className="page-title">Reminder History</h1>
      {error && <div className="error">{error}</div>}

      <div className="card">
        <div className="filters">
          <select value={filters.patient} onChange={e => set('patient', e.target.value)}>
            <option value="">All patients</option>
            {patients.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
          <select value={filters.family} onChange={e => set('family', e.target.value)}>
            <option value="">All family members</option>
            {family.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <input placeholder="Medicine…" value={filters.medicine} onChange={e => set('medicine', e.target.value)} />
          <input type="date" value={filters.from} onChange={e => set('from', e.target.value)} />
          <input type="date" value={filters.to} onChange={e => set('to', e.target.value)} />
          <select value={filters.dose_status} onChange={e => set('dose_status', e.target.value)}>
            <option value="">All dose statuses</option>
            {STATUSES.filter(Boolean).map(s => <option key={s}>{s}</option>)}
          </select>
          <select value={filters.message_status} onChange={e => set('message_status', e.target.value)}>
            <option value="">All message statuses</option>
            {MSG_STATUSES.filter(Boolean).map(s => <option key={s}>{s}</option>)}
          </select>
          <select value={filters.mode} onChange={e => set('mode', e.target.value)}>
            <option value="">Demo & live</option>
            <option value="demo">Demo only</option>
            <option value="live">Live only</option>
          </select>
        </div>

        {loading ? <div className="loading">Loading…</div> : rows.length === 0 ? (
          <div className="empty-state">No history records match these filters.</div>
        ) : (
          <table>
            <thead>
              <tr><th>When</th><th>Kind</th><th>Patient</th><th>Medicine</th><th>Dose status</th><th>Recipient</th><th>Msg status</th><th>Mode</th></tr>
            </thead>
            <tbody>
              {rows.map(n => (
                <tr key={n.id}>
                  <td>{new Date(n.created_at).toLocaleString()}</td>
                  <td style={{ fontSize: 12 }}>{n.kind}</td>
                  <td>{n.patient_name || '—'}</td>
                  <td>{n.medicine_name || '—'}</td>
                  <td>{n.dose_status ? <span className={`badge badge-${n.dose_status}`}>{n.dose_status}</span> : '—'}</td>
                  <td>{n.family_name || n.recipient_phone || '—'}</td>
                  <td><span className={`badge badge-${n.status}`}>{n.status}</span></td>
                  <td>{n.mode}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
