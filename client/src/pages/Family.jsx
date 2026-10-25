import React, { useEffect, useState } from 'react';
import { api, Confirm, Modal } from '../App.jsx';

const EMPTY = { name: '', phone: '', relationship: '', notify_preference: 'all', active: true, patient_ids: [] };

export default function Family() {
  const [list, setList] = useState([]);
  const [patients, setPatients] = useState([]);
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
    try { setList(await api(`/family?search=${encodeURIComponent(search)}`)); }
    catch (e) { setError(e.message); }
    setLoading(false);
  };
  useEffect(() => { load(); }, [search]);
  useEffect(() => { api('/patients').then(setPatients).catch(() => {}); }, []);

  const save = async e => {
    e.preventDefault(); setError(''); setMsg('');
    try {
      const body = { ...form, patient_ids: form.patient_ids.map(Number) };
      if (editing) {
        await api(`/family/${editing}`, { method: 'PUT', body: JSON.stringify(body) });
        setMsg('Family member updated.');
      } else {
        await api('/family', { method: 'POST', body: JSON.stringify(body) });
        setMsg('Family member added.');
      }
      setOpen(false); setForm(EMPTY); setEditing(null); load();
    } catch (err) { setError(err.message); }
  };

  const toggleActive = async f => {
    try {
      await api(`/family/${f.id}/active`, { method: 'PATCH', body: JSON.stringify({ active: !f.active }) });
      load();
    } catch (err) { setError(err.message); }
  };

  const remove = async () => {
    try {
      await api(`/family/${confirmId}`, { method: 'DELETE' });
      setMsg('Family member removed.');
      setConfirmId(null); load();
    } catch (err) { setError(err.message); }
  };

  const view = async f => {
    try { setDetail(await api(`/family/${f.id}`)); } catch (err) { setError(err.message); }
  };

  const togglePatient = pid => {
    setForm(f => ({
      ...f,
      patient_ids: f.patient_ids.map(Number).includes(pid)
        ? f.patient_ids.map(Number).filter(x => x !== pid)
        : [...f.patient_ids.map(Number), pid],
    }));
  };

  return (
    <div>
      <h1 className="page-title">Family Members</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="success">{msg}</div>}
      <div className="toolbar">
        <input placeholder="Search by name or phone…" value={search} onChange={e => setSearch(e.target.value)} />
        <button className="btn btn-primary" onClick={() => { setForm(EMPTY); setEditing(null); setOpen(true); }}>
          + Add family member
        </button>
      </div>

      <div className="card">
        {loading ? <div className="loading">Loading…</div> : list.length === 0 ? (
          <div className="empty-state">No family members yet. Click "Add family member" to create one.</div>
        ) : (
          <table>
            <thead>
              <tr><th>ID</th><th>Name</th><th>Phone</th><th>Relationship</th><th>Patients</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {list.map(f => (
                <tr key={f.id}>
                  <td>{f.id}</td>
                  <td>{f.name}</td>
                  <td>{f.phone}</td>
                  <td>{f.relationship || '—'}</td>
                  <td>{f.patient_count}</td>
                  <td><span className={`badge badge-${f.active ? 'active' : 'inactive'}`}>{f.active ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <button className="btn btn-sm" onClick={() => view(f)}>View</button>{' '}
                    <button className="btn btn-sm" onClick={() => {
                      setEditing(f.id);
                      setForm({ name: f.name, phone: f.phone, relationship: f.relationship || '',
                        notify_preference: f.notify_preference || 'all', active: !!f.active, patient_ids: [] });
                      api(`/family/${f.id}`).then(d =>
                        setForm(fm => ({ ...fm, patient_ids: d.patients.map(x => x.id) }))).catch(() => {});
                      setOpen(true);
                    }}>Edit</button>{' '}
                    <button className="btn btn-sm" onClick={() => toggleActive(f)}>
                      {f.active ? 'Deactivate' : 'Activate'}
                    </button>{' '}
                    <button className="btn btn-sm btn-danger" onClick={() => setConfirmId(f.id)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={open} title={editing ? 'Edit family member' : 'Add family member'} onClose={() => setOpen(false)}>
        <form onSubmit={save}>
          {error && <div className="error">{error}</div>}
          <div className="form-group">
            <label>Name *</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>WhatsApp phone with country code *</label>
              <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                placeholder="+919812345678" required />
            </div>
            <div className="form-group">
              <label>Relationship to patient (optional)</label>
              <input value={form.relationship} onChange={e => setForm({ ...form, relationship: e.target.value })}
                placeholder="Daughter, Son, Neighbour…" />
            </div>
          </div>
          <div className="form-group">
            <label>Notification preference</label>
            <select value={form.notify_preference} onChange={e => setForm({ ...form, notify_preference: e.target.value })}>
              <option value="all">All alerts</option>
              <option value="missed_only">Missed / unconfirmed only</option>
            </select>
          </div>
          <div className="form-group">
            <label>Linked patients (receives alerts only for these)</label>
            <div className="checkbox-list">
              {patients.length === 0 && <span style={{ color: 'var(--text-light)' }}>No patients yet.</span>}
              {patients.map(p => (
                <label key={p.id}>
                  <input type="checkbox" checked={form.patient_ids.map(Number).includes(p.id)} onChange={() => togglePatient(p.id)} />
                  {p.full_name} ({p.phone})
                </label>
              ))}
            </div>
          </div>
          <div className="btn-group">
            <button className="btn btn-primary">{editing ? 'Save changes' : 'Add family member'}</button>
            <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!detail} title={detail?.name || ''} onClose={() => setDetail(null)}>
        {detail && (
          <div>
            <p><strong>Phone:</strong> {detail.phone} &nbsp; <strong>Relationship:</strong> {detail.relationship || '—'}</p>
            <p><strong>Status:</strong> {detail.active ? 'Active' : 'Inactive'}</p>
            <h4 style={{ margin: '14px 0 6px' }}>Linked patients</h4>
            {detail.patients.length === 0 ? <p style={{ color: 'var(--text-light)' }}>None</p> : (
              <ul style={{ paddingLeft: 20 }}>{detail.patients.map(p => <li key={p.id}>{p.full_name}</li>)}</ul>
            )}
            <h4 style={{ margin: '14px 0 6px' }}>Notification history (last 100)</h4>
            {detail.notifications.length === 0 ? <p style={{ color: 'var(--text-light)' }}>None</p> : (
              <table>
                <thead><tr><th>Kind</th><th>Status</th><th>Mode</th><th>When</th></tr></thead>
                <tbody>{detail.notifications.slice(0, 20).map(n => (
                  <tr key={n.id}>
                    <td>{n.kind}</td>
                    <td><span className={`badge badge-${n.status}`}>{n.status}</span></td>
                    <td>{n.mode}</td>
                    <td>{new Date(n.created_at).toLocaleString()}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        )}
      </Modal>

      <Confirm
        open={!!confirmId}
        title="Remove family member"
        message="This removes the family member. Their past notification records remain in history. Continue?"
        onConfirm={remove} onCancel={() => setConfirmId(null)}
      />
    </div>
  );
}
