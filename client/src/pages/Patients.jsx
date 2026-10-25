import React, { useEffect, useState } from 'react';
import { api, Confirm, Modal } from '../App.jsx';

const TZ = ['UTC', 'Asia/Kolkata', 'Asia/Dubai', 'Europe/London', 'America/New_York', 'America/Los_Angeles'];

const EMPTY = { full_name: '', phone: '', timezone: 'Asia/Kolkata', active: true, notes: '', family_ids: [] };

export default function Patients() {
  const [list, setList] = useState([]);
  const [family, setFamily] = useState([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setList(await api(`/patients?search=${encodeURIComponent(search)}`));
    } catch (e) { setError(e.message); }
    setLoading(false);
  };
  useEffect(() => { load(); }, [search]);
  useEffect(() => { api('/family').then(setFamily).catch(() => {}); }, []);

  const save = async e => {
    e.preventDefault(); setError(''); setMsg('');
    try {
      const body = { ...form, family_ids: form.family_ids.map(Number) };
      if (editing) {
        await api(`/patients/${editing}`, { method: 'PUT', body: JSON.stringify(body) });
        setMsg('Patient updated.');
      } else {
        await api('/patients', { method: 'POST', body: JSON.stringify(body) });
        setMsg('Patient added.');
      }
      setOpen(false); setForm(EMPTY); setEditing(null); load();
    } catch (err) { setError(err.message); }
  };

  const toggleActive = async p => {
    try {
      await api(`/patients/${p.id}/active`, { method: 'PATCH', body: JSON.stringify({ active: !p.active }) });
      load();
    } catch (err) { setError(err.message); }
  };

  const remove = async () => {
    try {
      await api(`/patients/${confirmId}`, { method: 'DELETE' });
      setMsg('Patient removed. Audit history is retained.');
      setConfirmId(null); load();
    } catch (err) { setError(err.message); }
  };

  const view = async p => {
    try { setDetail(await api(`/patients/${p.id}`)); } catch (err) { setError(err.message); }
  };

  const toggleFamily = fid => {
    setForm(f => ({
      ...f,
      family_ids: f.family_ids.map(Number).includes(fid)
        ? f.family_ids.map(Number).filter(x => x !== fid)
        : [...f.family_ids.map(Number), fid],
    }));
  };

  return (
    <div>
      <h1 className="page-title">Patients</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="success">{msg}</div>}
      <div className="toolbar">
        <input placeholder="Search by name or phone…" value={search} onChange={e => setSearch(e.target.value)} />
        <button className="btn btn-primary" onClick={() => { setForm(EMPTY); setEditing(null); setOpen(true); }}>
          + Add patient
        </button>
      </div>

      <div className="card">
        {loading ? <div className="loading">Loading…</div> : list.length === 0 ? (
          <div className="empty-state">No patients yet. Click "Add patient" to create one.</div>
        ) : (
          <table>
            <thead>
              <tr><th>ID</th><th>Name</th><th>Phone</th><th>Time zone</th><th>Family</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {list.map(p => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td>{p.full_name}</td>
                  <td>{p.phone}</td>
                  <td>{p.timezone}</td>
                  <td>{p.family_count}</td>
                  <td><span className={`badge badge-${p.active ? 'active' : 'inactive'}`}>{p.active ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <button className="btn btn-sm" onClick={() => view(p)}>View</button>{' '}
                    <button className="btn btn-sm" onClick={() => {
                      setEditing(p.id);
                      setForm({
                        full_name: p.full_name, phone: p.phone, timezone: p.timezone,
                        active: !!p.active, notes: p.notes || '', family_ids: [],
                      });
                      api(`/patients/${p.id}`).then(d =>
                        setForm(f => ({ ...f, family_ids: d.family.map(x => x.id) }))).catch(() => {});
                      setOpen(true);
                    }}>Edit</button>{' '}
                    <button className="btn btn-sm" onClick={() => toggleActive(p)}>
                      {p.active ? 'Deactivate' : 'Activate'}
                    </button>{' '}
                    <button className="btn btn-sm btn-danger" onClick={() => setConfirmId(p.id)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={open} title={editing ? 'Edit patient' : 'Add patient'} onClose={() => setOpen(false)}>
        <form onSubmit={save}>
          {error && <div className="error">{error}</div>}
          <div className="form-group">
            <label>Full name *</label>
            <input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} required />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Phone with country code *</label>
              <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                placeholder="+919812345678" required />
            </div>
            <div className="form-group">
              <label>Time zone</label>
              <select value={form.timezone} onChange={e => setForm({ ...form, timezone: e.target.value })}>
                {TZ.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>Linked family members</label>
            <div className="checkbox-list">
              {family.length === 0 && <span style={{ color: 'var(--text-light)' }}>No family members yet — add them in the Family Members page.</span>}
              {family.map(f => (
                <label key={f.id}>
                  <input type="checkbox" checked={form.family_ids.map(Number).includes(f.id)} onChange={() => toggleFamily(f.id)} />
                  {f.name} ({f.phone})
                </label>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label>Notes</label>
            <textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="btn-group">
            <button className="btn btn-primary">{editing ? 'Save changes' : 'Add patient'}</button>
            <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!detail} title={detail?.full_name || ''} onClose={() => setDetail(null)}>
        {detail && (
          <div>
            <p><strong>Phone:</strong> {detail.phone} &nbsp; <strong>Time zone:</strong> {detail.timezone}</p>
            <p><strong>Status:</strong> {detail.active ? 'Active' : 'Inactive'}</p>
            {detail.notes && <p><strong>Notes:</strong> {detail.notes}</p>}
            <h4 style={{ margin: '14px 0 6px' }}>Linked family members</h4>
            {detail.family.length === 0 ? <p style={{ color: 'var(--text-light)' }}>None</p> : (
              <ul style={{ paddingLeft: 20 }}>{detail.family.map(f => <li key={f.id}>{f.name} ({f.phone})</li>)}</ul>
            )}
            <h4 style={{ margin: '14px 0 6px' }}>Medicine schedules</h4>
            {detail.schedules.length === 0 ? <p style={{ color: 'var(--text-light)' }}>None</p> : (
              <ul style={{ paddingLeft: 20 }}>{detail.schedules.map(s => (
                <li key={s.id}>{s.medicine_name} — times {s.reminder_times} ({s.active ? 'active' : 'paused'})</li>
              ))}</ul>
            )}
            <h4 style={{ margin: '14px 0 6px' }}>Response history (last 100)</h4>
            {detail.doseHistory.length === 0 ? <p style={{ color: 'var(--text-light)' }}>None</p> : (
              <table>
                <thead><tr><th>Medicine</th><th>Scheduled</th><th>Status</th><th>Responded</th></tr></thead>
                <tbody>{detail.doseHistory.slice(0, 20).map(d => (
                  <tr key={d.id}>
                    <td>{d.medicine_name}</td>
                    <td>{new Date(d.scheduled_at_utc).toLocaleString()}</td>
                    <td><span className={`badge badge-${d.status}`}>{d.status}</span></td>
                    <td>{d.responded_at_utc ? new Date(d.responded_at_utc).toLocaleString() : '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        )}
      </Modal>

      <Confirm
        open={!!confirmId}
        title="Remove patient"
        message="This permanently removes the patient and their schedules/doses. Audit and notification logs are retained for history. Continue?"
        onConfirm={remove} onCancel={() => setConfirmId(null)}
      />
    </div>
  );
}
