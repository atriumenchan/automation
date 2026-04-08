'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function loadManualSkip() {
  const data = readJson(path.join(ROOT, 'logs', 'manual_skip.json'), []);
  return new Set(Array.isArray(data) ? data.filter(Boolean) : []);
}

function loadAccountIndex() {
  return readJson(path.join(ROOT, 'logs', 'account_index.json'), {});
}

function loadEmailsList() {
  return readJson(path.join(ROOT, 'emails.json'), []);
}

function emailsWithSuccessInDetails() {
  const details = readJson(path.join(ROOT, 'logs', 'details.json'), []);
  const out = new Set();
  if (!Array.isArray(details)) return out;
  for (const row of details) {
    if (row && row.email && row.status === 'success') out.add(row.email);
  }
  return out;
}

const SKIP_AUTOMATION_STATUSES = new Set([
  'success',
  'already_used',
  'signin_blocked',
  'manual_complete',
]);

function isSkippedForAutomation(email) {
  if (loadManualSkip().has(email)) {
    return { skip: true, reason: 'manual_skip.json' };
  }
  const list = loadEmailsList();
  const acc = list.find((e) => e.email === email);
  if (acc?.used) {
    return { skip: true, reason: 'emails.json used=true' };
  }
  const idx = loadAccountIndex()[email];
  if (idx && SKIP_AUTOMATION_STATUSES.has(idx.status)) {
    return { skip: true, reason: `account_index status=${idx.status}` };
  }
  if (emailsWithSuccessInDetails().has(email)) {
    return { skip: true, reason: 'logs/details.json success' };
  }
  return { skip: false, reason: null };
}

module.exports = {
  loadManualSkip,
  isSkippedForAutomation,
  SKIP_AUTOMATION_STATUSES,
};
