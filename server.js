require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const QRCode = require('qrcode');
const { scrapeGoogleMaps } = require('./src/scraper');
const { initWhatsApp, disconnectWhatsApp, clearSession, sendBatch, getStatus, onStatusChange } = require('./src/sender');
const db = require('./src/db');

// Prevent unhandled errors from crashing the server
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (server kept alive):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection (server kept alive):', reason);
});

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// SSE clients for real-time updates to dashboard
let sseClients = [];

function broadcastSSE(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  sseClients = sseClients.filter(res => {
    try { res.write(payload); return true; }
    catch (_) { return false; }
  });
}

// WhatsApp status changes → broadcast to dashboard
onStatusChange((event) => broadcastSSE({ channel: 'whatsapp', ...event }));

// ── SSE endpoint ──────────────────────────────────────────────
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sseClients.push(res);
  req.on('close', () => { sseClients = sseClients.filter(c => c !== res); });
});

// ── Leads CRUD ────────────────────────────────────────────────
app.get('/api/leads', (req, res) => {
  const leads = db.getAll();
  res.json(leads);
});

app.get('/api/stats', (req, res) => {
  res.json(db.getStats());
});

app.patch('/api/leads/:id', (req, res) => {
  db.updateStatus(req.params.id, req.body.status);
  res.json({ ok: true });
});

app.delete('/api/leads/:id', (req, res) => {
  db.deleteLead(req.params.id);
  res.json({ ok: true });
});

app.delete('/api/leads', (req, res) => {
  db.clearAll();
  res.json({ ok: true });
});

// ── Scraper ───────────────────────────────────────────────────
app.post('/api/scrape', async (req, res) => {
  const { category, city, maxResults } = req.body;
  if (!category || !city) return res.status(400).json({ error: 'category and city are required' });

  res.json({ ok: true, message: 'Scraping started...' });

  try {
    const leads = await scrapeGoogleMaps(
      { category, city, maxResults: maxResults || 50 },
      (event) => broadcastSSE({ channel: 'scraper', ...event })
    );

    const added = db.addLeads(leads);
    broadcastSSE({ channel: 'scraper', type: 'saved', added, total: leads.length });
    broadcastSSE({ channel: 'refresh' });
  } catch (err) {
    broadcastSSE({ channel: 'scraper', type: 'error', message: err.message });
  }
});

// ── WhatsApp ──────────────────────────────────────────────────
app.post('/api/whatsapp/connect', (req, res) => {
  initWhatsApp();
  res.json({ ok: true, message: 'Starting — wait for QR' });
});

app.post('/api/whatsapp/disconnect', async (req, res) => {
  await disconnectWhatsApp();
  clearSession();
  res.json({ ok: true });
});

app.get('/api/whatsapp/status', (req, res) => {
  res.json(getStatus());
});

// Serve QR as a PNG image — avoids all client-side canvas/library issues
app.get('/api/whatsapp/qr-image', async (req, res) => {
  const { qr } = getStatus();
  if (!qr) return res.status(404).send('No QR available');
  try {
    const png = await QRCode.toBuffer(qr, { width: 260, margin: 2 });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(png);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

app.post('/api/whatsapp/send', async (req, res) => {
  const { leadIds, minDelay, maxDelay, messageTemplate } = req.body;
  const { status } = getStatus();
  if (status !== 'ready') return res.status(400).json({ error: 'WhatsApp not connected' });

  res.json({ ok: true, message: 'Sending started...' });

  sendBatch(
    { leadIds, minDelaySec: minDelay || 35, maxDelaySec: maxDelay || 65, messageTemplate },
    (event) => {
      broadcastSSE({ channel: 'sender', ...event });
      if (event.type === 'done') broadcastSSE({ channel: 'refresh' });
    }
  ).catch(err => broadcastSSE({ channel: 'sender', type: 'error', message: err.message }));
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3737;
app.listen(PORT, () => {
  console.log(`\n🚀 Craft Leads Dashboard: http://localhost:${PORT}\n`);

  // Auto-reconnect WhatsApp on server boot when MongoDB session is available
  if (process.env.MONGODB_URI) {
    console.log('🔄 Auto-connecting WhatsApp (MongoDB session detected)...');
    initWhatsApp();
  }
});
