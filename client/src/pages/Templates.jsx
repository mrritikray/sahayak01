import React, { useEffect, useState } from 'react';
import { api, Modal } from '../App.jsx';

const KINDS = [
  { value: 'reminder', label: 'Patient medicine reminder' },
  { value: 'alert_not_taken', label: 'Family alert — NOT TAKEN' },
  { value: 'alert_no_response', label: 'Family alert — NO RESPONSE' },
  { value: 'delivery_failure', label: 'Delivery-failure warning' },
];

const VARS = ['patient_name', 'medicine_name', 'dosage', 'scheduled_time', 'response_status', 'response_time'];

const EMPTY = { name: '', kind: 'reminder', body: '', active: true };

export default function Templates() {
  const [list, setList] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = async () => {
    try { setList(await api('/templates')); } catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); }, []);

  const save = async e => {
    e.preventDefault(); setError(''); setMsg('');
    try {
      if (editing) {
        await api(`/templates/${editing}`, { method: 'PUT', body: JSON.stringify(form) });
        setMsg('Template updated.');
      } else {
        await api('/templates', { method: 'POST', body: JSON.stringify(form) });
        setMsg('Template created.');
      }
      setOpen(false); setForm(EMPTY); setEditing(null); load();
    } catch (err) { setError(err.message); }
  };

  const doPreview = async () => {
    try { setPreview(await api('/templates/preview', { method: 'POST', body: JSON.stringify({ body: form.body }) })); }
    catch (err) { setError(err.message); }
  };

  return (
    <div>
      <h1 className="page-title">Message Templates</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="success">{msg}</div>}
      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => { setForm(EMPTY); setEditing(null); setOpen(true); }}>
          + Add template
        </button>
      </div>

      <div className="card">
        <p style={{ fontSize: 13, color: 'var(--text-light)', marginBottom: 12 }}>
          Safe variables: {VARS.map(v => <code key={v} style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 4, marginRight: 6 }}>{`{{${v}}}`}</code>)}
          <br />Unknown variables are rejected on save. Values are escaped to prevent injection.
          <br /><strong>WhatsApp note:</strong> in LIVE mode, free-form messages are only allowed within the
          24-hour customer-service window after the patient's last message. Outside that window, Meta requires
          approved template messages — template approval status is managed in your Meta Business dashboard.
        </p>
        {list.length === 0 ? (
          <div className="empty-state">No templates yet.</div>
        ) : (
          <table>
            <thead><tr><th>ID</th><th>Name</th><th>Kind</th><th>Active</th><th>Body</th><th>Actions</th></tr></thead>
            <tbody>
              {list.map(t => (
                <tr key={t.id}>
                  <td>{t.id}</td>
                  <td>{t.name}</td>
                  <td style={{ fontSize: 12 }}>{KINDS.find(k => k.value === t.kind)?.label || t.kind}</td>
                  <td><span className={`badge badge-${t.active ? 'active' : 'inactive'}`}>{t.active ? 'Active' : 'Off'}</span></td>
                  <td style={{ fontSize: 12, maxWidth: 320 }}>{t.body.slice(0, 80)}…</td>
                  <td>
                    <button className="btn btn-sm" onClick={() => {
                      setEditing(t.id);
                      setForm({ name: t.name, kind: t.kind, body: t.body, active: !!t.active });
                      setOpen(true);
                    }}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={open} title={editing ? 'Edit template' : 'Add template'} onClose={() => setOpen(false)}>
        <form onSubmit={save}>
          {error && <div className="error">{error}</div>}
          <div className="form-row">
            <div className="form-group">
              <label>Name *</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>Kind *</label>
              <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>
                {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>Body *</label>
            <textarea rows={5} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} required />
          </div>
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />
              Active (used as the default for its kind)
            </label>
          </div>
          {preview && (
            <div className="form-group">
              <label>Preview (with sample data)</label>
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 12, fontSize: 13 }}>
                {preview.rendered}
              </div>
            </div>
          )}
          <div className="btn-group">
            <button type="button" className="btn" onClick={doPreview}>Preview</button>
            <button className="btn btn-primary">{editing ? 'Save changes' : 'Create template'}</button>
            <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
