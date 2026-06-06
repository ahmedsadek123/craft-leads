const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, '../data/leads.json');

function load() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ leads: [], stats: { scraped: 0, sent: 0, failed: 0 } }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function getAll() {
  return load().leads;
}

function getStats() {
  const db = load();
  const leads = db.leads;
  return {
    total: leads.length,
    pending: leads.filter(l => l.status === 'pending').length,
    sent: leads.filter(l => l.status === 'sent').length,
    failed: leads.filter(l => l.status === 'failed').length,
    replied: leads.filter(l => l.status === 'replied').length,
  };
}

function addLeads(newLeads) {
  const db = load();
  let added = 0;
  for (const lead of newLeads) {
    // Avoid duplicates by phone
    const exists = db.leads.find(l => l.phone === lead.phone);
    if (!exists && lead.phone) {
      db.leads.push({ id: uuidv4(), ...lead, status: 'pending', addedAt: new Date().toISOString() });
      added++;
    }
  }
  save(db);
  return added;
}

function updateStatus(id, status) {
  const db = load();
  const lead = db.leads.find(l => l.id === id);
  if (lead) {
    lead.status = status;
    lead.updatedAt = new Date().toISOString();
    save(db);
  }
}

function deleteLead(id) {
  const db = load();
  db.leads = db.leads.filter(l => l.id !== id);
  save(db);
}

function clearAll() {
  save({ leads: [] });
}

module.exports = { getAll, getStats, addLeads, updateStatus, deleteLead, clearAll };
