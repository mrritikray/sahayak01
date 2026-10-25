import React, { useEffect, useState } from 'react';
import { api } from '../App.jsx';

function Stat({ value, label }) {
  return (
    <div className="card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/dashboard').then(setData).catch(e => setError(e.message));
    const t = setInterval(() => api('/dashboard').then(setData).catch(() => {}), 15000);
    return () => clearInterval(t);
  }, []);

  if (error) return <div><h1 className="page-title">Dashboard</h1><div className="error">{error}</div></div>;
  if (!data) return <div><h1 className="page-title">Dashboard</h1><div className="loading">Loading…</div></div>;

  const wa = data.whatsapp || {};
  return (
    <div>
      <h1 className="page-title">Dashboard</h1>
      <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
        <span className={`badge badge-${data.mode}`}>{data.mode} mode</span>
        <span className={`badge badge-${data.schedulerRunning ? 'active' : 'inactive'}`}>
          Scheduler {data.schedulerRunning ? 'running' : 'stopped'}
        </span>
        <span className={`badge badge-${wa.accessTokenPresent ? 'live' : 'demo'}`}>
          WhatsApp {wa.accessTokenPresent ? 'configured' : 'not configured (demo)'}
        </span>
      </div>

      <div className="grid grid-4">
        <Stat value={data.activePatients} label="Active patients" />
        <Stat value={data.linkedFamily} label="Linked family members" />
        <Stat value={data.medicinesTaken} label="Medicines marked taken" />
        <Stat value={data.missedOrUnconfirmed} label="Missed / unconfirmed doses" />
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card" style={{ marginBottom: 0 }}>
          <h3 style={{ marginBottom: 12, fontSize: 15 }}>Upcoming medicine reminders</h3>
          {data.upcomingReminders.length === 0 ? (
            <div className="empty-state">No upcoming reminders right now.</div>
          ) : (
            <table>
              <thead><tr><th>Patient</th><th>Medicine</th><th>Time</th><th>Status</th></tr></thead>
              <tbody>
                {data.upcomingReminders.map(d => (
                  <tr key={d.id}>
                    <td>{d.patient_name}</td>
                    <td>{d.medicine_name} ({d.dosage})</td>
                    <td>{new Date(d.scheduled_at_utc).toLocaleString()}</td>
                    <td><span className={`badge badge-${d.status}`}>{d.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card" style={{ marginBottom: 0 }}>
          <h3 style={{ marginBottom: 12, fontSize: 15 }}>Recent WhatsApp notifications</h3>
          {data.recentNotifications.length === 0 ? (
            <div className="empty-state">No notifications yet.</div>
          ) : (
            <table>
              <thead><tr><th>Kind</th><th>To</th><th>Status</th><th>Mode</th><th>When</th></tr></thead>
              <tbody>
                {data.recentNotifications.map(n => (
                  <tr key={n.id}>
                    <td>{n.kind}</td>
                    <td>{n.recipient_phone}</td>
                    <td><span className={`badge badge-${n.status}`}>{n.status}</span></td>
                    <td>{n.mode}</td>
                    <td>{new Date(n.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <strong>Safety note:</strong> SAHAYAK is a prototype. Delivery depends on WhatsApp and network
        availability. It is <strong>not an emergency monitoring service</strong> and not a medical device.
        A NO_RESPONSE status means the patient did not confirm — it is not a medically verified missed dose.
      </div>
    </div>
  );
}
