const { Client, LocalAuth, NoAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { generateMessage } = require('./templates');
const db = require('./db');

let client = null;
let clientStatus = 'disconnected'; // disconnected | qr | ready | error
let qrData = null;
let statusListeners = [];

function onStatusChange(fn) {
  statusListeners.push(fn);
}

function emit(event) {
  statusListeners.forEach(fn => fn(event));
}

function getStatus() {
  return { status: clientStatus, qr: clientStatus === 'qr' ? qrData : null };
}

async function initWhatsApp() {
  if (client) return;

  clientStatus = 'connecting';
  emit({ type: 'status', status: 'connecting' });

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: './data/whatsapp-session' }),
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    },
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--disable-gpu',
      ],
    },
  });

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
    console.log('✅ WhatsApp جاهز للإرسال');
  });

  client.on('disconnected', () => {
    clientStatus = 'disconnected';
    client = null;
    emit({ type: 'status', status: 'disconnected' });
  });

  client.on('auth_failure', () => {
    clientStatus = 'error';
    client = null;
    emit({ type: 'status', status: 'error', message: 'فشل التوثيق — امسح الـ QR تاني' });
  });

  await client.initialize();
}

async function disconnectWhatsApp() {
  if (client) {
    await client.destroy();
    client = null;
    clientStatus = 'disconnected';
    emit({ type: 'status', status: 'disconnected' });
  }
}

// Random delay between min and max seconds
function delay(minSec, maxSec) {
  const ms = (Math.random() * (maxSec - minSec) + minSec) * 1000;
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Send to one lead
async function sendToLead(lead, messageTemplate) {
  if (!client || clientStatus !== 'ready') {
    throw new Error('WhatsApp مش متوصل');
  }

  const message = messageTemplate || generateMessage(lead.name, lead.type);
  // Format phone: must be international without +, followed by @c.us
  const phone = lead.phone.replace(/^\+/, '') + '@c.us';

  try {
    // Check if number exists on WhatsApp
    const isRegistered = await client.isRegisteredUser(phone);
    if (!isRegistered) {
      db.updateStatus(lead.id, 'not_on_whatsapp');
      return { success: false, reason: 'مش على واتساب' };
    }

    await client.sendMessage(phone, message);
    db.updateStatus(lead.id, 'sent');
    return { success: true, message };
  } catch (err) {
    db.updateStatus(lead.id, 'failed');
    return { success: false, reason: err.message };
  }
}

// Send to multiple pending leads with rate limiting
async function sendBatch({ leadIds, minDelaySec = 30, maxDelaySec = 60, messageTemplate }, onProgress) {
  if (!client || clientStatus !== 'ready') {
    throw new Error('WhatsApp مش متوصل — وصّل الأول');
  }

  const allLeads = db.getAll();
  const targets = allLeads.filter(l =>
    leadIds ? leadIds.includes(l.id) : l.status === 'pending'
  );

  let sent = 0, failed = 0;

  for (let i = 0; i < targets.length; i++) {
    const lead = targets[i];
    onProgress?.({ type: 'sending', index: i + 1, total: targets.length, name: lead.name });

    const result = await sendToLead(lead, messageTemplate);

    if (result.success) {
      sent++;
      onProgress?.({ type: 'sent', name: lead.name, phone: lead.phone });
    } else {
      failed++;
      onProgress?.({ type: 'failed', name: lead.name, reason: result.reason });
    }

    // Don't delay after last message
    if (i < targets.length - 1) {
      const waitSec = Math.round(Math.random() * (maxDelaySec - minDelaySec) + minDelaySec);
      onProgress?.({ type: 'waiting', seconds: waitSec });
      await delay(minDelaySec, maxDelaySec);
    }
  }

  onProgress?.({ type: 'done', sent, failed });
  return { sent, failed };
}

module.exports = { initWhatsApp, disconnectWhatsApp, sendBatch, getStatus, onStatusChange };
