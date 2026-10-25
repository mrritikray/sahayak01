import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { getDb, getSetting, setSetting } from './db.js';
import { ensureAdmin } from './auth.js';
import { buildRouter } from './routes.js';
import { startScheduler, stopScheduler } from './workflow.js';
import { seed } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 1. Database + migrations + demo admin + optional seed.
getDb();
ensureAdmin();
seed(); // no-op if data already present (use "npm run seed:reset" to re-seed)

const app = express();
app.disable('x-powered-by');
app.use('/api', buildRouter());

// 2. Serve the built frontend (production mode / VS Code single-server run).
const dist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.get('/', (req, res) => res.json({ app: 'SAHAYAK', api: '/api' }));

app.listen(config.port, () => {
  setSetting('scheduler_running', '1');
  startScheduler();
  console.log(`[sahayak] backend listening on http://localhost:${config.port}`);
});

process.on('SIGINT', () => { stopScheduler(); process.exit(0); });
process.on('SIGTERM', () => { stopScheduler(); process.exit(0); });
