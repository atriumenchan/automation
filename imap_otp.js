'use strict';

/**
 * imap_otp.js
 * ─────────────────────────────────────────────────────────────────
 * Connects to Rambler via IMAP, fetches ALL recent messages,
 * prints every email to the terminal in full, then extracts OTP.
 *
 * Works for all Rambler domains:
 *   rambler.ru / rambler.ua / autorambler.ru
 *   lenta.ru / myrambler.ru / ro.ru
 *
 * IMAP: imap.rambler.ru:993 (SSL)
 * ─────────────────────────────────────────────────────────────────
 */

const { ImapFlow } = require('imapflow');
const fs   = require('fs');
const path = require('path');

const IMAP_HOST        = 'imap.rambler.ru';
const IMAP_PORT        = 993;
const DEFAULT_POLL_TIMEOUT_MS = 3 * 60 * 1000;   // 3 minutes default
const POLL_INTERVAL_MS = 8 * 1000;         // check every 8s

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── OTP extraction ───────────────────────────────────────────────

function extractOtp(text) {
  const clean = String(text)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ');

  const patterns = [
    /Security code[:\s]+(\d{4,8})/i,
    /verification code[:\s]+(\d{4,8})/i,
    /your code[:\s]+(\d{4,8})/i,
    /one[-\s]?time code[:\s]+(\d{4,8})/i,
    /single[-\s]?use code[:\s]+(\d{4,8})/i,
    /code is[:\s]+(\d{4,8})/i,
    /enter[:\s]+(\d{4,8})/i,
    /OTP[:\s]+(\d{4,8})/i,
    /\b(\d{6})\b/,
    /\b(\d{4})\b/,
  ];

  for (const p of patterns) {
    const m = clean.match(p);
    if (m) return m[1];
  }
  return null;
}

// ── Print a full email to terminal ──────────────────────────────

function printEmail(index, from, subject, date, body) {
  const divider = '═'.repeat(60);
  console.log(`\n${divider}`);
  console.log(`  📨  EMAIL #${index}`);
  console.log(`  From    : ${from}`);
  console.log(`  Subject : ${subject}`);
  console.log(`  Date    : ${date}`);
  console.log('  ─────────── BODY ───────────');
  // Print full body — strip HTML tags for readability but keep all text
  const readable = String(body)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#\d+;/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  console.log(readable);
  console.log(divider + '\n');
}

// ── Core: connect, poll, return OTP ─────────────────────────────

async function waitForOtp(email, password, since, maxWaitMs) {
  const startedAt = since ?? Date.now();
  const pollMs    = typeof maxWaitMs === 'number' && maxWaitMs > 0 ? maxWaitMs : DEFAULT_POLL_TIMEOUT_MS;
  const deadline  = Date.now() + pollMs;
  const sinceDate = new Date(startedAt - 60000); // 60s buffer to not miss edge cases

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: email, pass: password },
    logger: false,
    tls: { rejectUnauthorized: false },
  });

  console.log(`\n📬 IMAP connecting to ${email}...`);

  try {
    await client.connect();
    console.log(`   ✅ IMAP connected to ${email}`);
  } catch (err) {
    throw new Error(`IMAP connect failed for ${email}: ${err.message}`);
  }

  // Track which UIDs we already printed so we don't repeat them
  const printed = new Set();

  try {
    let pollCount = 0;
    while (Date.now() < deadline) {
      pollCount++;
      const remaining = Math.round((deadline - Date.now()) / 1000);

      await client.mailboxOpen('INBOX');

      // Search ALL messages since our start time — no from filter
      // This avoids Rambler IMAP server quirks with domain matching
      let uids = [];
      try {
        uids = await client.search({ since: sinceDate }, { uid: true }) || [];
      } catch (e) {
        console.log(`   ⚠  IMAP search error: ${e.message}`);
      }

      if (uids.length > 0) {
        // Fetch all messages we haven't seen yet, newest first
        const newUids = uids.filter((u) => !printed.has(u));

        if (newUids.length > 0) {
          console.log(`   📨 ${newUids.length} new message(s) found — reading...`);

          for (const uid of newUids.reverse()) {
            printed.add(uid);
            try {
              const msg = await client.fetchOne(uid, { source: true }, { uid: true });
              if (!msg?.source) continue;

              const raw = msg.source.toString();

              // Parse headers
              const from    = raw.match(/^From:\s*(.+)$/im)?.[1]?.trim()    || 'unknown';
              const subject = raw.match(/^Subject:\s*(.+)$/im)?.[1]?.trim() || '(no subject)';
              const date    = raw.match(/^Date:\s*(.+)$/im)?.[1]?.trim()    || 'unknown';

              // Extract body — handle quoted-printable and base64 loosely
              let body = raw;
              // Decode quoted-printable soft line breaks
              body = body.replace(/=\r?\n/g, '');
              // Replace =XX hex escapes
              body = body.replace(/=([0-9A-Fa-f]{2})/g, (_, h) => {
                try { return String.fromCharCode(parseInt(h, 16)); } catch { return ''; }
              });

              printEmail(uid, from, subject, date, body);

              // Try to extract OTP
              const otp = extractOtp(raw) || extractOtp(body);
              if (otp) {
                console.log(`\n${'★'.repeat(52)}`);
                console.log(`  OTP FOUND: ${otp}`);
                console.log(`  From     : ${from}`);
                console.log(`  Subject  : ${subject}`);
                console.log(`${'★'.repeat(52)}\n`);
                return otp;
              } else {
                console.log(`   ⚠  No OTP pattern found in this email — continuing to wait`);
              }
            } catch (fetchErr) {
              console.log(`   ⚠  Fetch error uid ${uid}: ${fetchErr.message}`);
            }
          }
        } else {
          console.log(`   📭 ${uids.length} message(s) in range but all already checked — ${remaining}s remaining`);
        }
      } else {
        console.log(`   📭 No messages since ${sinceDate.toISOString()} — ${remaining}s remaining`);
      }

      if (Date.now() < deadline) await sleep(POLL_INTERVAL_MS);
    }

    throw new Error(`OTP not received within ${pollMs / 1000}s for ${email}`);
  } finally {
    try { await client.logout(); } catch {}
  }
}

// ── Parse rambler.txt ────────────────────────────────────────────

function parseRamblerFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const lines = fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const accounts = [];

  for (const line of lines) {
    if (/^[\|\-\s:]+$/.test(line)) continue;
    if (/email/i.test(line) && /password/i.test(line)) continue;

    let email = null, password = null;

    // Markdown: | [email](mailto:email) | password |
    const md = line.match(/\[([^\]]+)\]\(mailto:[^\)]+\)\s*\|\s*(\S+)/i);
    if (md) { email = md[1].trim(); password = md[2].trim(); }

    // Markdown plain: | email | password |
    if (!email) {
      const parts = line.split('|').map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 2 && parts[0].includes('@')) {
        email = parts[0]; password = parts[1];
      }
    }

    // Tab-separated
    if (!email && line.includes('\t')) {
      const [e, p] = line.split('\t').map((s) => s.trim());
      if (e?.includes('@') && p) { email = e; password = p; }
    }

    // Colon-separated (not http://)
    if (!email && line.includes(':') && !line.startsWith('http')) {
      const idx = line.indexOf(':');
      const e = line.slice(0, idx).trim();
      const p = line.slice(idx + 1).trim();
      if (e.includes('@') && p) { email = e; password = p; }
    }

    if (email && password) accounts.push({ email, password });
  }

  return accounts;
}

module.exports = { waitForOtp, parseRamblerFile, extractOtp };
