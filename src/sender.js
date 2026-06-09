const { Client, LocalAuth, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const qrcode = require('qrcode-terminal');
const { generateMessage } = require('./templates');
const db = require('./db');

let client = null;
let initializing = false; // guard against race condition
let clientStatus = 'disconnected'; // disconnected | qr | ready | error
let qrData = null;
let statusListeners = [];
let manualDisconnect = false; // blocks auto-reconnect when user presses Disconnect

function onStatusChange(fn) {
  statusListeners.push(fn);
}

function emit(event) {
  statusListeners.forEach(fn => fn(event));
}

function getStatus() {
  return { status: clientStatus, qr: clientStatus === 'qr' ? qrData : null };
}

async function buildAuthStrategy() {
  if (process.env.MONGODB_URI) {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI);
    }
    const store = new MongoStore({ mongoose });
    return new RemoteAuth({ store, backupSyncIntervalMs: 300000 });
  }
  return new LocalAuth({ dataPath: './data/whatsapp-session' });
}

async function initWhatsApp() {
  manualDisconnect = false; // reset flag — this is a deliberate connect
  if (client || initializing) return;
  initializing = true;

  clientStatus = 'connecting';
  emit({ type: 'status', status: 'connecting' });

  let authStrategy;
  try {
    authStrategy = await buildAuthStrategy();
  } catch (err) {
    console.error('Auth strategy error, falling back to LocalAuth:', err.message);
    authStrategy = new LocalAuth({ dataPath: './data/whatsapp-session' });
  }



  client = new Client({
    authStrategy,
    webVersionCache: {
      type: 'local',
      path: './.wwebjs_cache',
    },
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      protocolTimeout: 120000, // 2 min — Railway is slow, default 30s times out
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--disable-extensions',
        '--disable-default-apps',
        '--hide-scrollbars',
        '--mute-audio',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    },
  });
  initializing = false; // guard released after client is assigned

  client.on('qr', (qr) => {
    clientStatus = 'qr';
    qrData = qr;
    qrcode.generate(qr, { small: true });
    emit({ type: 'qr', qr });
  });

  client.on('authenticated', () => {
    clientStatus = 'authenticated';
    qrData = null;
    emit({ type: 'status', status: 'authenticated' });
  });

  client.on('ready', () => {
    clientStatus = 'ready';
    qrData = null;
    emit({ type: 'status', status: 'ready' });
    console.log('✅ WhatsApp ready to send');
  });

  client.on('disconnected', () => {
    clientStatus = 'disconnected';
    client = null;
    initializing = false;
    emit({ type: 'status', status: 'disconnected' });
    // Auto-reconnect only if it wasn't a manual disconnect
    if (process.env.MONGODB_URI && !manualDisconnect) {
      console.log('🔄 WhatsApp disconnected — reconnecting in 10s...');
      setTimeout(() => initWhatsApp(), 10000);
    }
  });

  client.on('auth_failure', () => {
    clientStatus = 'error';
    client = null;
    initializing = false;
    emit({ type: 'status', status: 'error', message: 'Auth failed — scan QR again' });
    if (process.env.MONGODB_URI && !manualDisconnect) {
      console.log('🔄 Auth failure — reconnecting in 15s...');
      setTimeout(() => initWhatsApp(), 15000);
    }
  });

  // Fire and forget — don't await, SSE handles all status updates
  client.initialize().catch(err => {
    console.error('WA init error:', err.message);
    clientStatus = 'error';
    client = null;
    initializing = false;
    emit({ type: 'status', status: 'error', message: err.message });
    if (process.env.MONGODB_URI && !manualDisconnect) {
      console.log('🔄 Init error — retrying in 20s...');
      setTimeout(() => initWhatsApp(), 20000);
    }
  });
}

async function disconnectWhatsApp() {
  manualDisconnect = true; // block auto-reconnect
  if (client) {
    try { await client.logout(); } catch (_) {}
    try { await client.destroy(); } catch (_) {}
    client = null;
  }
  // Clear MongoDB session so next connect shows fresh QR
  if (mongoose.connection.readyState === 1) {
    try {
      const db = mongoose.connection.db;
      await db.collection('whatsapp-RemoteAuth-default').drop();
      console.log('🗑️ MongoDB WA session cleared');
    } catch (_) {} // collection may not exist — that's fine
  }
  initializing = false;
  clientStatus = 'disconnected';
  emit({ type: 'status', status: 'disconnected' });
}

function clearSession() {
  const fs = require('fs');
  const sessionPath = require('path').join(__dirname, '../data/whatsapp-session');
  const cachePath = require('path').join(__dirname, '../.wwebjs_cache');
  try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(cachePath, { recursive: true, force: true }); } catch (_) {}
}

// Random delay between min and max seconds
function delay(minSec, maxSec) {
  const ms = (Math.random() * (maxSec - minSec) + minSec) * 1000;
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Send to one lead — always returns {success, reason}, never throws
async function sendToLead(lead, messageTemplate) {
  if (!client || clientStatus !== 'ready') {
    return { success: false, reason: 'WhatsApp not connected' };
  }

  const message = messageTemplate || generateMessage(lead.name, lead.type);
  const phone = lead.phone.replace(/^\+/, '') + '@c.us';

  try {
    // Fast check — skip numbers not on WhatsApp (10s timeout)
    const isRegistered = await Promise.race([
      client.isRegisteredUser(phone),
      new Promise(resolve => setTimeout(() => resolve(false), 10000)),
    ]);
    if (!isRegistered) {
      db.updateStatus(lead.id, 'not_on_whatsapp');
      return { success: false, reason: 'Not on WhatsApp' };
    }

    // Send with 30s timeout
    await Promise.race([
      client.sendMessage(phone, message),
      new Promise((_, reject) => setTimeout(() => reject(new Error('send timeout after 30s')), 30000)),
    ]);
    db.updateStatus(lead.id, 'sent');
    return { success: true, message };
  } catch (err) {
    const notOnWA = err.message?.includes('not a user') || err.message?.includes('invalid wid');
    db.updateStatus(lead.id, notOnWA ? 'not_on_whatsapp' : 'failed');
    return { success: false, reason: err.message };
  }
}

// Send to multiple pending leads with rate limiting
async function sendBatch({ leadIds, minDelaySec = 30, maxDelaySec = 60, messageTemplate }, onProgress) {
  if (!client || clientStatus !== 'ready') {
    onProgress?.({ type: 'error', message: 'WhatsApp not connected — connect first' });
    onProgress?.({ type: 'done', sent: 0, failed: 0 });
    return { sent: 0, failed: 0 };
  }

  const allLeads = db.getAll();
  const targets = allLeads.filter(l =>
    leadIds ? leadIds.includes(l.id) : l.status === 'pending'
  );

  let sent = 0, failed = 0;

  try {
    for (let i = 0; i < targets.length; i++) {
      // Re-check connection before every message
      if (!client || clientStatus !== 'ready') {
        onProgress?.({ type: 'error', message: 'WhatsApp disconnected during send' });
        break;
      }

      const lead = targets[i];
      onProgress?.({ type: 'sending', index: i + 1, total: targets.length, name: lead.name });

      const result = await sendToLead(lead, messageTemplate);

      if (result.success) {
        sent++;
        onProgress?.({ type: 'sent', name: lead.name, phone: lead.phone });
        if (i < targets.length - 1) {
          const waitSec = Math.round(Math.random() * (maxDelaySec - minDelaySec) + minDelaySec);
          onProgress?.({ type: 'waiting', seconds: waitSec });
          await delay(minDelaySec, maxDelaySec);
        }
      } else {
        failed++;
        onProgress?.({ type: 'failed', name: lead.name, reason: result.reason });
      }
    }
  } catch (err) {
    onProgress?.({ type: 'error', message: err.message });
  } finally {
    // Always fire done so the frontend button re-enables
    onProgress?.({ type: 'done', sent, failed });
  }

  return { sent, failed };
}

module.exports = { initWhatsApp, disconnectWhatsApp, clearSession, sendBatch, getStatus, onStatusChange };
