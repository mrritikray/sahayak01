import React, { useEffect, useState } from 'react';
import { api, Confirm } from '../App.jsx';

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [doses, setDoses] = useState([]);
  const [testPhone, setTestPhone] = useState('');
  const [result, setResult] = useState(null);
  const [confirmTest, setConfirmTest] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = async () => {
    try {
      setSettings(await api('/settings'));
      setSchedules(await api('/schedules'));
      setDoses(await api('/doses'));
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); }, []);

  const testConnection = async () => {
    setError(''); setResult(null);
    try { setResult(await api('/settings/test-connection', { method: 'POST' })); }
    catch (e) { setError(e.message); }
  };

  const sendTestMessage = async () => {
    setConfirmTest(false); setError(''); setMsg('');
    try {
      const r = await api('/settings/test-message', { method: 'POST', body: JSON.stringify({ phone: testPhone }) });
      setMsg(`Test message result: status "${r.status}" (mode: ${r.mode}). ${r.error || ''}`);
      load();
    } catch (e) { setError(e.message); }
  };

  const forceTimeout = async doseId => {
    setError(''); setMsg('');
    try {
      await api('/simulator/force-timeout', { method: 'POST', body: JSON.stringify({ dose_id: doseId }) });
      setMsg('Timeout processed immediately — family NO_RESPONSE alert recorded. (In production this happens automatically after the configured 30-minute timeout.)');
      load();
    } catch (e) { setError(e.message); }
  };

  if (!settings) return <div><h1 className="page-title">Settings & Integrations</h1><div className="loading">Loading…</div></div>;

  const wa = settings.whatsapp;
  const awaiting = doses.filter(d => d.status === 'AWAITING_RESPONSE');

  const Check = ({ ok, label, hint }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
      <span className={`badge badge-${ok ? 'active' : 'inactive'}`}>{ok ? 'Present' : 'Missing'}</span>
      <div>
        <div style={{ fontWeight: 500 }}>{label}</div>
        {hint && <div style={{ fontSize: 12, color: 'var(--text-light)' }}>{hint}</div>}
      </div>
    </div>
  );

  return (
    <div>
      <h1 className="page-title">Settings & Integrations</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="success">{msg}</div>}

      <div className="card">
        <h3 style={{ marginBottom: 8, fontSize: 15 }}>WhatsApp integration — {settings.mode === 'live' ? 'LIVE mode' : 'DEMO mode'}</h3>
        <p style={{ fontSize: 13, color: 'var(--text-light)', marginBottom: 12 }}>
          Configure via environment variables in <code>server/.env</code> (see <code>.env.example</code>).
          Secret values are never shown or stored in logs. Restart the backend after changing them.
        </p>
        <Check ok={wa.accessTokenPresent} label="WHATSAPP_ACCESS_TOKEN" hint="Permanent token from your Meta WhatsApp Business app" />
        <Check ok={wa.phoneNumberIdPresent} label="WHATSAPP_PHONE_NUMBER_ID" hint="Phone number ID from the Meta dashboard" />
        <Check ok={wa.wabaIdPresent} label="WHATSAPP_BUSINESS_ACCOUNT_ID" hint="Needed for template management" />
        <Check ok={wa.webhookVerifyTokenPresent} label="WHATSAPP_WEBHOOK_VERIFY_TOKEN" hint="Any random string you invent; also entered in Meta's webhook screen" />
        <Check ok={wa.appSecretPresent} label="WHATSAPP_APP_SECRET" hint="Used to verify webhook payload signatures" />
        <p style={{ fontSize: 13, marginTop: 8 }}>Graph API version: <strong>{wa.graphVersion}</strong></p>
        <div className="btn-group">
          <button className="btn btn-primary" onClick={testConnection}>Test connection</button>
        </div>
        {result && (
          <div className={result.ok ? 'success' : 'error'} style={{ marginTop: 12 }}>
            {result.mode === 'live' ? '[LIVE] ' : '[DEMO] '}{result.detail}
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 8, fontSize: 15 }}>Send a test WhatsApp message</h3>
        <div className="form-row">
          <div className="form-group">
            <label>Recipient phone (with country code)</label>
            <input value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="+919812345678" />
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setConfirmTest(true)} disabled={!testPhone}>
          Send test message
        </button>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 8, fontSize: 15 }}>Scheduler</h3>
        <p style={{ fontSize: 13 }}>
          Status: <span className={`badge badge-${settings.scheduler.running ? 'active' : 'inactive'}`}>
            {settings.scheduler.running ? 'Running' : 'Stopped'}</span> &nbsp;·&nbsp;
          Polling every {(settings.scheduler.intervalMs / 1000).toFixed(0)} s &nbsp;·&nbsp;
          Max send attempts: {settings.scheduler.maxAttempts} &nbsp;·&nbsp;
          Retry backoff: {settings.scheduler.backoffSeconds} s × attempt number
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-light)', marginTop: 6 }}>
          The scheduler is backend-owned and persistent: pending doses and no-response deadlines are
          stored in the database, so a server restart does not lose or duplicate any job.
        </p>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 8, fontSize: 15 }}>Patient-response simulator & accelerated timeout test</h3>
        <p style={{ fontSize: 13, color: 'var(--text-light)', marginBottom: 12 }}>
          For local testing you can simulate the 30-minute no-response timeout immediately.
          The default production timeout (30 minutes, configured per schedule) is not changed.
          Note: a phone cannot normally open a <code>localhost</code> link — in DEMO mode use this
          simulator; for real phones on LIVE mode you need an HTTPS tunnel (see docs/WHATSAPP-LIVE-SETUP.md).
        </p>
        <h4 style={{ margin: '10px 0 6px' }}>Doses awaiting response</h4>
        {awaiting.length === 0 ? (
          <p style={{ color: 'var(--text-light)', fontSize: 13 }}>
            None. Create one with "Send test dose" on the Medicines & Schedules page.
          </p>
        ) : (
          <table>
            <thead><tr><th>Dose</th><th>Patient</th><th>Medicine</th><th>Respond as patient</th><th>Force timeout</th></tr></thead>
            <tbody>
              {awaiting.map(d => (
                <tr key={d.id}>
                  <td>#{d.id}</td>
                  <td>{d.patient_name}</td>
                  <td>{d.medicine_name}</td>
                  <td>
                    <button className="btn btn-sm" onClick={async () => {
                      try {
                        const r = await api('/simulator/respond', {
                          method: 'POST', body: JSON.stringify({ dose_id: d.id, action: 'TAKEN' }),
                        });
                        setMsg(`Dose #${d.id} marked TAKEN${r.late ? ' (late — previous alert preserved in history)' : ''}. No family alert sent.`);
                        load();
                      } catch (e) { setError(e.message); }
                    }}>TAKEN</button>{' '}
                    <button className="btn btn-sm" onClick={async () => {
                      try {
                        const r = await api('/simulator/respond', {
                          method: 'POST', body: JSON.stringify({ dose_id: d.id, action: 'NOT_TAKEN' }),
                        });
                        setMsg(`Dose #${d.id} marked NOT_TAKEN. Family members notified: ${r.familyNotified ?? 0}.`);
                        load();
                      } catch (e) { setError(e.message); }
                    }}>NOT TAKEN</button>
                  </td>
                  <td>
                    <button className="btn btn-sm btn-danger" onClick={() => forceTimeout(d.id)}>Force timeout now</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Confirm
        open={confirmTest}
        title="Send a real/simulated test message"
        message={`This will attempt to send a test message to ${testPhone} using the current mode (${settings.mode}). Continue?`}
        onConfirm={sendTestMessage} onCancel={() => setConfirmTest(false)} danger={false}
      />
    </div>
  );
}
