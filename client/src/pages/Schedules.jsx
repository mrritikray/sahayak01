import React, { useEffect, useState } from 'react';
import { api, Confirm, Modal } from '../App.jsx';

const TZ = ['UTC', 'Asia/Kolkata', 'Asia/Dubai', 'Europe/London', 'America/New_York', 'America/Los_Angeles'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const EMPTY = {
  patient_id: '', medicine_name: '', dosage: '', reminder_times: ['08:00'],
  days_of_week: [0, 1, 2, 3, 4, 5, 6], start_date: new Date().toISOString().slice(0, 10),
  end_date: '', timezone: 'Asia/Kolkata', reminder_template_id: '',
  no_response_minutes: 30, notify_family_ids: [], active: true,
};

export default function Schedules() {
  const [list, setList] = useState([]);
  const [patients, setPatients] = useState([]);
  const [family, setFamily] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [doses, setDoses] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setList(await api('/schedules'));
      setDoses(await api('/doses'));
    } catch (e) { setError(e.message); }
    setLoading(false);
  };
  useEffect(() => {
    load();
    api('/patients').then(setPatients).catch(() => {});
    api('/family').then(setFamily).catch(() => {});
    api('/templates').then(setTemplates).catch(() => {});
  }, []);

  const save = async e => {
    e.preventDefault(); setError(''); setMsg('');
    try {
      const body = {
        ...form,
        patient_id: Number(form.patient_id),
        reminder_template_id: form.reminder_template_id ? Number(form.reminder_template_id) : null,
        no_response_minutes: Number(form.no_response_minutes),
        end_date: form.end_date || null,
        notify_family_ids: form.notify_family_ids.map(Number),
      };
      if (editing) {
        await api(`/schedules/${editing}`, { method: 'PUT', body: JSON.stringify(body) });
        setMsg('Schedule updated. Changes affect future reminders only.');
      } else {
        await api('/schedules', { method: 'POST', body: JSON.stringify(body) });
        setMsg('Schedule created.');
      }
      setOpen(false); setForm(EMPTY); setEditing(null); load();
    } catch (err) { setError(err.message); }
  };

  const toggleActive = async s => {
    try {
      await api(`/schedules/${s.id}/active`, { method: 'PATCH', body: JSON.stringify({ active: !s.active }) });
      setMsg(s.active ? 'Schedule paused. Pending reminders cancelled.' : 'Schedule activated.');
      load();
    } catch (err) { setError(err.message); }
  };

  const remove = async () => {
    try {
      await api(`/schedules/${confirmId}`, { method: 'DELETE' });
      setMsg('Schedule removed.');
      setConfirmId(null); load();
    } catch (err) { setError(err.message); }
  };

  const simulateDose = async s => {
    setError(''); setMsg('');
    try {
      const r = await api('/simulator/confirm-dose', { method: 'POST', body: JSON.stringify({ schedule_id: s.id }) });
      setMsg(`Test dose #${r.doseId} created and reminder sent (${r.status}, mode: ${r.mode}). Check Reminder History for the link, then use the Patient Response Simulator in Settings or History.`);
      load();
    } catch (err) { setError(err.message); }
  };

  const toggleDay = d => {
    setForm(f => ({
      ...f,
      days_of_week: f.days_of_week.includes(d)
        ? f.days_of_week.filter(x => x !== d)
        : [...f.days_of_week, d].sort(),
    }));
  };

  const toggleFamily = fid => {
    setForm(f => ({
      ...f,
      notify_family_ids: f.notify_family_ids.map(Number).includes(fid)
        ? f.notify_family_ids.map(Number).filter(x => x !== fid)
        : [...f.notify_family_ids.map(Number), fid],
    }));
  };

  const setTime = (i, v) => {
    setForm(f => {
      const times = [...f.reminder_times];
      times[i] = v;
      return { ...f, reminder_times: times };
    });
  };

  return (
    <div>
      <h1 className="page-title">Medicines & Schedules</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="success">{msg}</div>}
      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => { setForm(EMPTY); setEditing(null); setOpen(true); }}>
          + Add medicine schedule
        </button>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 12, fontSize: 15 }}>Schedules</h3>
        {loading ? <div className="loading">Loading…</div> : list.length === 0 ? (
          <div className="empty-state">No schedules yet. Click "Add medicine schedule".</div>
        ) : (
          <table>
            <thead>
              <tr><th>ID</th><th>Patient</th><th>Medicine</th><th>Times</th><th>Days</th><th>Timeout</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {list.map(s => (
                <tr key={s.id}>
                  <td>{s.id}</td>
                  <td>{s.patient_name}</td>
                  <td>{s.medicine_name} ({s.dosage})</td>
                  <td>{s.reminder_times}</td>
                  <td style={{ fontSize: 12 }}>{s.days_of_week.map(d => DAYS[d]).join(', ')}</td>
                  <td>{s.no_response_minutes} min</td>
                  <td><span className={`badge badge-${s.active ? 'active' : 'inactive'}`}>{s.active ? 'Active' : 'Paused'}</span></td>
                  <td>
                    <button className="btn btn-sm" onClick={() => {
                      setEditing(s.id);
                      setForm({
                        patient_id: String(s.patient_id), medicine_name: s.medicine_name, dosage: s.dosage,
                        reminder_times: JSON.parse(s.reminder_times || '["08:00"]'),
                        days_of_week: JSON.parse(s.days_of_week || '[]'),
                        start_date: s.start_date, end_date: s.end_date || '',
                        timezone: s.timezone, reminder_template_id: s.reminder_template_id ? String(s.reminder_template_id) : '',
                        no_response_minutes: s.no_response_minutes,
                        notify_family_ids: JSON.parse(s.notify_family_ids || '[]'),
                        active: !!s.active,
                      });
                      setOpen(true);
                    }}>Edit</button>{' '}
                    <button className="btn btn-sm" onClick={() => toggleActive(s)}>
                      {s.active ? 'Pause' : 'Activate'}
                    </button>{' '}
                    <button className="btn btn-sm" onClick={() => simulateDose(s)}>Send test dose</button>{' '}
                    <button className="btn btn-sm btn-danger" onClick={() => setConfirmId(s.id)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 12, fontSize: 15 }}>Recent doses</h3>
        {doses.length === 0 ? <div className="empty-state">No doses recorded yet.</div> : (
          <table>
            <thead><tr><th>Patient</th><th>Medicine</th><th>Scheduled</th><th>Status</th><th>Responded</th><th>Alert sent</th></tr></thead>
            <tbody>
              {doses.slice(0, 25).map(d => (
                <tr key={d.id}>
                  <td>{d.patient_name}</td>
                  <td>{d.medicine_name}</td>
                  <td>{new Date(d.scheduled_at_utc).toLocaleString()}</td>
                  <td><span className={`badge badge-${d.status}`}>{d.status}</span></td>
                  <td>{d.responded_at_utc ? new Date(d.responded_at_utc).toLocaleString() : '—'}</td>
                  <td>{d.alerted ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={open} title={editing ? 'Edit medicine schedule' : 'Add medicine schedule'} onClose={() => setOpen(false)}>
        <form onSubmit={save}>
          {error && <div className="error">{error}</div>}
          <div className="form-row">
            <div className="form-group">
              <label>Patient *</label>
              <select value={form.patient_id} onChange={e => setForm({ ...form, patient_id: e.target.value })} required>
                <option value="">Select patient…</option>
                {patients.map(p => <option key={p.id} value={p.id}>{p.full_name} ({p.phone})</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Medicine name *</label>
              <input value={form.medicine_name} onChange={e => setForm({ ...form, medicine_name: e.target.value })} required />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Dosage text</label>
              <input value={form.dosage} onChange={e => setForm({ ...form, dosage: e.target.value })} placeholder="500 mg" />
            </div>
            <div className="form-group">
              <label>No-response timeout (minutes)</label>
              <input type="number" min="1" max="720" value={form.no_response_minutes}
                onChange={e => setForm({ ...form, no_response_minutes: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label>Reminder times per day *</label>
            {form.reminder_times.map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                <input type="time" value={t} onChange={e => setTime(i, e.target.value)} required />
                {form.reminder_times.length > 1 && (
                  <button type="button" className="btn btn-sm"
                    onClick={() => setForm(f => ({ ...f, reminder_times: f.reminder_times.filter((_, j) => j !== i) }))}>
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="btn btn-sm"
              onClick={() => setForm(f => ({ ...f, reminder_times: [...f.reminder_times, '12:00'] }))}>
              + Add time
            </button>
          </div>
          <div className="form-group">
            <label>Days of week *</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {DAYS.map((name, d) => (
                <label key={d} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.days_of_week.includes(d)} onChange={() => toggleDay(d)} />
                  {name}
                </label>
              ))}
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Start date *</label>
              <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>End date (optional)</label>
              <input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Time zone</label>
              <select value={form.timezone} onChange={e => setForm({ ...form, timezone: e.target.value })}>
                {TZ.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Reminder message template</label>
              <select value={form.reminder_template_id}
                onChange={e => setForm({ ...form, reminder_template_id: e.target.value })}>
                <option value="">Default reminder template</option>
                {templates.filter(t => t.kind === 'reminder').map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>Family members to notify (empty = all linked active family)</label>
            <div className="checkbox-list">
              {family.length === 0 && <span style={{ color: 'var(--text-light)' }}>No family members yet.</span>}
              {family.map(f => (
                <label key={f.id}>
                  <input type="checkbox" checked={form.notify_family_ids.map(Number).includes(f.id)} onChange={() => toggleFamily(f.id)} />
                  {f.name} ({f.phone})
                </label>
              ))}
            </div>
          </div>
          <div className="btn-group">
            <button className="btn btn-primary">{editing ? 'Save changes' : 'Create schedule'}</button>
            <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      </Modal>

      <Confirm
        open={!!confirmId}
        title="Remove schedule"
        message="This removes the schedule. Doses already recorded remain in history. Continue?"
        onConfirm={remove} onCancel={() => setConfirmId(null)}
      />
    </div>
  );
}
