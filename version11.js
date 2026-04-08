'use strict';

/**
 * version11.js  —  Microsoft Ads Full Automation (One Shot)
 * ─────────────────────────────────────────────────────────────────
 * Combines index.js (Microsoft login + Rambler IMAP secondary email)
 * with restore.js (full Microsoft Ads business setup).
 *
 * Flow per account:
 *   1.  Read ALL logs — skip accounts already completed
 *   2.  Pick fresh proxy + fresh Rambler account (never reuse)
 *   3.  Open browser → navigate to Microsoft login OAuth URL
 *   4.  Enter email → Next
 *   5.  Enter password → Sign in
 *   6.  Detect "already_used" (existing secondary) → log + skip
 *   7.  Enter Rambler email as secondary → Send code
 *   8.  Fetch OTP from Rambler inbox via IMAP (ImapFlow, imap.rambler.ru)
 *   9.  Enter OTP → Verify
 *  10.  Click "Stay signed in"
 *  11.  Save post_login session
 *  12.  Navigate to ads.microsoft.com
 *  13.  Handle sign-in flow: Sign in → Continue with Microsoft →
 *        account picker → Stay signed in (again if needed)
 *  14.  Wait for "Tell us about your business" form
 *       - Fill website (from business.json, round-robin)
 *       - Next
 *       - Fill business name + phone
 *       - Check all checkboxes
 *       - Next
 *  15.  "How can we help" → select "Create account"
 *  16.  Select "Create account only" card → Next
 *  17.  Account details form: address1, city, state dropdown, postal code → Next
 *  18.  Payment page → "Set up payment later" → Yes
 *  19.  Wait 3 minutes
 *  20.  Screenshot → screenshots_accounts/ folder
 *  21.  Save final session + mark success in all log files
 * ─────────────────────────────────────────────────────────────────
 * Usage:  node version11.js
 * ─────────────────────────────────────────────────────────────────
 */

const { chromium }                    = require('playwright');
const fs                              = require('fs');
const path                            = require('path');
const { waitForOtp, parseRamblerFile } = require('./imap_otp');

// ═══════════════════════════════════════════════════════════════
// PATHS
// ═══════════════════════════════════════════════════════════════

const ROOT              = __dirname;
const EMAILS_FILE       = path.join(ROOT, 'emails.json');
const PROXIES_FILE      = path.join(ROOT, 'proxies.txt');
const RAMBLER_FILE      = path.join(ROOT, 'rambler.txt');
const BUSINESS_FILE     = path.join(ROOT, 'business.json');
const SESSIONS_DIR      = path.join(ROOT, 'sessions');
const SCREENSHOTS_FINAL = path.join(ROOT, 'screenshots_accounts'); // final dashboard shots
const LOG_DIR           = path.join(ROOT, 'logs');
const LOG_SCREENSHOTS   = path.join(LOG_DIR, 'screenshots');       // step screenshots
const INDEX_FILE        = path.join(LOG_DIR, 'account_index.json');
const SESSIONS_LOG      = path.join(LOG_DIR, 'sessions.json');
const DETAILS_JSON      = path.join(LOG_DIR, 'details.json');
const DETAILS_TXT       = path.join(LOG_DIR, 'details.txt');
const ALREADY_USED_JSON = path.join(LOG_DIR, 'already_used.json');
const ALREADY_USED_TXT  = path.join(LOG_DIR, 'already_used.txt');

// Microsoft login OAuth URL (same as index.js)
const MS_LOGIN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
  + '?client_id=5e68f16e-b58b-4a8e-b33c-4f737f1c7ace'
  + '&response_type=code%20id_token'
  + '&scope=openid%20profile'
  + '&state=OpenIdConnect.AuthenticationProperties%3DpiyGGSnTAo0APgfvk4embDHBQtjsu8EhZHJ3F_mVHbXPXIvPItKhAfDLQh6izZ7r2exBcDY41h7HFpkJcM-ejaJKcNrUybC795b_bds0THGpJLCAOe7WKbykwd5jRjPXc0qRSZeoPW5IWEcj1mMcK2Q_sGyC-L24AoW0KTtc84EF926Ve4tpjIzju6vYd9XABxTR0lC4xQ7vj09zwWe199UkHtybjqo2fcW4Jyqr5pDMkQ_9pKTztJ3-Na7UWLWRPL3sIJgMWVS-VJD6BNafLGNRjZthUuVqEa80L1P4QsRi56B9iGaQAwQxkuOZGTaMLv0iVw'
  + '&response_mode=form_post'
  + '&nonce=639106624034175985.ZmRjNGRhZGItOTJjZi00NjY2LTgyODgtZGViNjM2ZDZhNzJiYjE1YmQxNTYtOWJjOS00NTFiLThhOWQtY2U0MThmOThhMjhk'
  + '&prompt=select_account'
  + '&lc=1033'
  + '&uaid=dfb2ea0436af4370bd18c9952bbe8329'
  + '&redirect_uri=https%3A%2F%2Fads.microsoft.com%2FLogin%2FMsa'
  + '&x-client-SKU=ID_NET461'
  + '&x-client-ver=6.6.0.0'
  + '&sso_reload=true';

// ═══════════════════════════════════════════════════════════════
// STEP LOGGER
// ═══════════════════════════════════════════════════════════════

let _steps = [], _n = 0, _email = '';

function resetLog(email) { _steps = []; _n = 0; _email = email; }
const ts   = () => new Date().toISOString();
const step = (m) => { _n++; _steps.push({ n: _n, t: ts(), m }); console.log(`\n[STEP ${String(_n).padStart(2,'0')}] ${m}`); };
const ok   = (m) => { _steps.push({ n: _n, t: ts(), ok: m }); console.log(`       ✅ ${m}`); };
const warn = (m) => { _steps.push({ n: _n, t: ts(), warn: m }); console.log(`       ⚠  ${m}`); };
const info = (m) => { _steps.push({ n: _n, t: ts(), info: m }); console.log(`          ${m}`); };
const fail = (m) => { _steps.push({ n: _n, t: ts(), fail: m }); console.log(`       ✗  ${m}`); };

async function pageInfo(page) {
  try {
    const url   = page.url();
    const title = await page.title().catch(() => '?');
    info(`URL  : ${url.split('?')[0]}`);
    info(`Title: ${title}`);
    return { url, title };
  } catch { return { url: '', title: '' }; }
}

// ═══════════════════════════════════════════════════════════════
// DIRECTORIES
// ═══════════════════════════════════════════════════════════════

function ensureDirs() {
  for (const d of [LOG_DIR, SESSIONS_DIR, SCREENSHOTS_FINAL, LOG_SCREENSHOTS,
                   path.join(ROOT, 'accounts'), path.join(ROOT, 'inboxes')]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

// ═══════════════════════════════════════════════════════════════
// LOG READ / WRITE  (reads BEFORE doing anything each run)
// ═══════════════════════════════════════════════════════════════

function readIndex() {
  if (!fs.existsSync(INDEX_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); } catch { return {}; }
}

function writeIndex(email, patch) {
  const db      = readIndex();
  db[email]     = { ...db[email], ...patch };
  fs.writeFileSync(INDEX_FILE, JSON.stringify(db, null, 2));
}

function isCompleted(email) {
  return ['success', 'already_used'].includes(readIndex()[email]?.status);
}

function getUsedRamblers() {
  const used = new Set();
  for (const e of Object.values(readIndex())) {
    if (e.secondary_email) used.add(e.secondary_email.toLowerCase());
  }
  return used;
}

function getUsedProxies() {
  return new Set(Object.values(readIndex()).filter(v => v.proxy).map(v => v.proxy));
}

function getStats() {
  const entries = Object.values(readIndex());
  return {
    total:       entries.length,
    success:     entries.filter(e => e.status === 'success').length,
    failed:      entries.filter(e => e.status === 'failed').length,
    already_used: entries.filter(e => e.status === 'already_used').length,
  };
}

function appendSessionLog(entry) {
  let data = [];
  if (fs.existsSync(SESSIONS_LOG)) try { data = JSON.parse(fs.readFileSync(SESSIONS_LOG, 'utf8')); } catch {}
  data.push(entry);
  fs.writeFileSync(SESSIONS_LOG, JSON.stringify(data, null, 2));
}

function saveDetails(entry) {
  const icon = entry.status === 'success' ? '✅' : entry.status === 'already_used' ? '⚠️' : '❌';
  const line = [
    '─'.repeat(60),
    `${icon} Status     : ${entry.status.toUpperCase()}`,
    `📧 Account   : ${entry.email}`,
    `📮 Secondary : ${entry.secondary_email || 'N/A'}`,
    `🌐 Proxy     : ${entry.proxy}`,
    `💾 Session   : ${entry.session_file || 'N/A'}`,
    `🕐 Time      : ${entry.time}`,
    entry.note ? `📝 Note      : ${entry.note}` : null,
    '─'.repeat(60), '',
  ].filter(Boolean).join('\n');
  fs.appendFileSync(DETAILS_TXT, line);
  let data = [];
  if (fs.existsSync(DETAILS_JSON)) try { data = JSON.parse(fs.readFileSync(DETAILS_JSON, 'utf8')); } catch {}
  data.push(entry);
  fs.writeFileSync(DETAILS_JSON, JSON.stringify(data, null, 2));
}

function logAlreadyUsed(entry) {
  let data = [];
  if (fs.existsSync(ALREADY_USED_JSON)) try { data = JSON.parse(fs.readFileSync(ALREADY_USED_JSON, 'utf8')); } catch {}
  if (!data.find(e => e.email === entry.email)) data.push(entry);
  fs.writeFileSync(ALREADY_USED_JSON, JSON.stringify(data, null, 2));
  const line = ['─'.repeat(60), `⚠️  ALREADY USED: ${entry.email}`,
    `   Secondary : ${entry.secondary_seen || 'unknown'}`,
    `   Proxy     : ${entry.proxy}`, `   Time      : ${entry.time}`,
    '─'.repeat(60), ''].join('\n');
  fs.appendFileSync(ALREADY_USED_TXT, line);
}

function saveStepLog(email, status) {
  const fname = `steps_${email.replace(/[@.]/g,'_')}_${ts().replace(/[:.]/g,'-')}.json`;
  const p     = path.join(LOG_DIR, fname);
  fs.writeFileSync(p, JSON.stringify({ email, status, steps: _steps }, null, 2));
  info(`Step log saved: ${fname}`);
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const hd    = (lo = 700, hi = 2000) => sleep(Math.floor(Math.random() * (hi - lo + 1)) + lo);

function parseProxy(str) {
  const [host, port, user, pass] = str.split(':');
  return { server: `http://${host}:${port}`, username: user, password: pass };
}

function safeEmail(email) { return email.replace(/[@.]/g, '_'); }

// Human-style typing into the first matching visible element from a CSS selector list
async function hType(page, cssSelectorList, text) {
  const loc = page.locator(cssSelectorList).first();
  await loc.waitFor({ state: 'visible', timeout: 14000 });
  await loc.click();
  try { await loc.clear(); } catch {
    // Fallback: clear via JS for the first matching element
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
    }, cssSelectorList).catch(() => {});
  }
  await hd(200, 500);
  for (const ch of String(text)) {
    await page.keyboard.type(ch);
    await sleep(Math.floor(Math.random() * 90) + 35);
  }
}

// Return the first selector (from array) whose element is visible within timeout
async function firstVisible(page, selArray, timeout = 10000) {
  try {
    return await Promise.race(selArray.map(async (s) => {
      await page.locator(s).first().waitFor({ state: 'visible', timeout });
      return s;
    }));
  } catch { return null; }
}

// Try clicking the first visible selector from a list
async function tryClick(page, selArray, label, timeout = 8000) {
  for (const s of selArray) {
    try {
      await page.locator(s).first().waitFor({ state: 'visible', timeout });
      await hd(400, 900);
      await page.locator(s).first().click();
      ok(`Clicked "${label}" [${s}]`);
      return true;
    } catch {}
  }
  warn(`"${label}" not found`);
  return false;
}

// Click Next / Continue / Submit button
async function clickNext(page) {
  const sels = [
    'button:has-text("Next")',
    'button:has-text("Save and continue")',
    'button:has-text("Continue")',
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Done")',
    '[data-testid*="next" i]',
    '[aria-label*="Next" i]',
  ];
  for (const s of sels) {
    try {
      const el = page.locator(s).first();
      await el.waitFor({ state: 'visible', timeout: 8000 });
      await el.scrollIntoViewIfNeeded();
      await hd(500, 900);
      await el.click();
      ok(`Clicked Next: [${s}]`);
      return true;
    } catch {}
  }
  warn('Next button not found');
  return false;
}

// ═══════════════════════════════════════════════════════════════
// SCREENSHOT & SESSION SAVE
// ═══════════════════════════════════════════════════════════════

async function shot(page, label, dir) {
  const d     = dir || LOG_SCREENSHOTS;
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  const fname = `${safeEmail(_email)}_${label}_${ts().replace(/[:.]/g,'-')}.png`;
  const p     = path.join(d, fname);
  try {
    await page.screenshot({ path: p, fullPage: false });
    info(`Screenshot: ${path.basename(p)}`);
    return p;
  } catch (e) {
    info(`(screenshot failed: ${e.message})`);
    return null;
  }
}

async function saveSession(context, label) {
  const safe = safeEmail(_email);
  const t    = ts().replace(/[:.]/g, '-');
  const sp   = path.join(SESSIONS_DIR, `${safe}_${label}_${t}.json`);
  const cp   = path.join(SESSIONS_DIR, `${safe}_${label}_${t}_cookies.json`);
  await context.storageState({ path: sp });
  const cookies = await context.cookies();
  fs.writeFileSync(cp, JSON.stringify(cookies, null, 2));
  ok(`Session saved: ${path.basename(sp)} (${cookies.length} cookies)`);
  return { sp, cp, cookies };
}

// ═══════════════════════════════════════════════════════════════
// ALREADY-USED DETECTOR  (checks page after password sign-in)
// ═══════════════════════════════════════════════════════════════

async function checkAlreadyUsed(page) {
  try {
    const content = await page.content();
    // Microsoft shows "We'll send a code to ****@***.com" when account already has secondary
    if (
      (content.includes("We'll send a code to") || content.includes('We will send a code to')) &&
      content.includes('*')
    ) {
      const match =
        content.match(/send a code to\s*<[^>]*>([^<]+)/i) ||
        content.match(/send a code to\s+([^\s<]+\*+[^\s<]+)/i);
      const maskedEmail = match ? match[1].replace(/<[^>]*>/g, '').trim() : 'unknown';
      return { alreadyUsed: true, maskedEmail };
    }
    if (content.includes('Verify your identity') && content.includes('*@')) {
      return { alreadyUsed: true, maskedEmail: 'unknown' };
    }
  } catch {}
  return { alreadyUsed: false };
}

// ═══════════════════════════════════════════════════════════════
// BUSINESS FORM FILLER  (Tell us about your business)
// ═══════════════════════════════════════════════════════════════

async function fillBusinessForm(page, biz, context) {
  // Dump visible inputs for debugging
  const inputInfo = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input, select, textarea'))
      .filter(el => el.offsetWidth || el.offsetHeight)
      .map(el => ({ tag: el.tagName, type: el.type, id: el.id, name: el.name, placeholder: el.placeholder }))
  ).catch(() => []);
  info(`Visible inputs: ${JSON.stringify(inputInfo)}`);

  // ── Page 1: website field ─────────────────────────────────────
  step('Fill website (Page 1)');
  let websiteFilled = false;
  for (const s of [
    'input[placeholder*="https://" i]',
    'input[placeholder*="website" i]',
    'input[name*="website" i]',
    'input[name*="url" i]',
    'input[type="url"]',
    'input[id*="website" i]',
  ]) {
    try {
      const el = page.locator(s).first();
      if (await el.isVisible({ timeout: 4000 })) {
        await el.click();
        await hd(200, 400);
        await el.fill('');
        await hd(100, 200);
        await el.type(biz.website, { delay: 60 });
        ok(`Website: ${biz.website}`);
        websiteFilled = true;
        break;
      }
    } catch {}
  }
  if (!websiteFilled) warn('Website field not found');
  await hd(800, 1200);

  // Check if business name field also visible (single-page form vs multi-page)
  const bizNameNow = await page.locator(
    'input[placeholder*="business name" i], input[placeholder="Enter your business name"], input[id*="business" i]'
  ).first().isVisible({ timeout: 3000 }).catch(() => false);

  if (!bizNameNow) {
    // Multi-step: click Next to go from website page to business details page
    step('Click Next → Page 2 (business name)');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await hd(600, 1000);
    await clickNext(page);
    await hd(3000, 5000);
    try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}
    await hd(1000, 2000);
  }
  await shot(page, '07_biz_p2');

  // ── Page 2: business name ─────────────────────────────────────
  step('Fill business name (Page 2)');
  // Try via JS eval first (handles React-controlled inputs)
  const bizNameJS = await page.evaluate((name) => {
    for (const inp of Array.from(document.querySelectorAll('input'))) {
      const ph = (inp.placeholder || '').toLowerCase();
      const id = (inp.id || '').toLowerCase();
      const nm = (inp.name || '').toLowerCase();
      if ((ph.includes('business name') || ph.includes('company name') ||
           id.includes('business')      || nm.includes('business')     || nm.includes('company'))
          && (inp.offsetWidth || inp.offsetHeight)) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(inp, name);
        else inp.value = name;
        inp.dispatchEvent(new Event('input',  { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return `id="${inp.id}" placeholder="${inp.placeholder}"`;
      }
    }
    return null;
  }, biz.businessName);

  if (bizNameJS) {
    ok(`Business name (JS): ${bizNameJS}`);
    // Also type through Playwright to trigger framework events
    try {
      const el = page.locator(
        'input[placeholder*="business name" i], input[placeholder="Enter your business name"], input[id*="business" i], input[name*="business" i]'
      ).first();
      await el.click({ timeout: 3000 });
      await hd(200, 400);
      await el.fill(biz.businessName);
      ok(`Business name typed: ${biz.businessName}`);
    } catch {}
  } else {
    warn('Business name field not found via JS — trying Playwright selector');
    try {
      await hType(page,
        'input[placeholder*="business name" i], input[placeholder="Enter your business name"], input[id*="business" i]',
        biz.businessName);
      ok(`Business name: ${biz.businessName}`);
    } catch { warn('Business name field unreachable'); }
  }
  await hd(700, 1200);

  // ── Phone ─────────────────────────────────────────────────────
  step('Fill phone number');
  const phoneJS = await page.evaluate((phone) => {
    for (const inp of Array.from(document.querySelectorAll('input'))) {
      const ph = (inp.placeholder || '').toLowerCase();
      const id = (inp.id || '').toLowerCase();
      const nm = (inp.name || '').toLowerCase();
      const tp = (inp.type || '').toLowerCase();
      if ((tp === 'tel' || ph.includes('phone') || ph.includes('number') ||
           id.includes('phone') || nm.includes('phone'))
          && (inp.offsetWidth || inp.offsetHeight)) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(inp, phone);
        else inp.value = phone;
        inp.dispatchEvent(new Event('input',  { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return `type="${inp.type}" id="${inp.id}" placeholder="${inp.placeholder}"`;
      }
    }
    return null;
  }, biz.phone);

  if (phoneJS) {
    ok(`Phone (JS): ${phoneJS}`);
    try {
      const el = page.locator('input[type="tel"], input[placeholder*="phone" i], input[id*="phone" i], input[name*="phone" i]').first();
      await el.click({ timeout: 3000 });
      await hd(200, 400);
      await el.fill(biz.phone);
      ok(`Phone typed: ${biz.phone}`);
    } catch {}
  } else {
    warn('Phone field not found');
  }
  await hd(700, 1200);

  // ── Checkboxes ────────────────────────────────────────────────
  step('Check all checkboxes');
  try {
    const boxes = page.locator('input[type="checkbox"]');
    const cnt   = await boxes.count();
    info(`Found ${cnt} checkbox(es)`);
    for (let i = 0; i < cnt; i++) {
      try {
        if (!(await boxes.nth(i).isChecked())) {
          await hd(200, 500);
          await boxes.nth(i).click();
          info(`Checked box ${i + 1}`);
        }
      } catch {}
    }
  } catch (e) { warn(`Checkbox error: ${e.message}`); }
  await hd(900, 1500);

  await shot(page, '07_biz_form_filled');
  if (context) { step('Save session (mid-form)'); await saveSession(context, 'mid_biz'); }

  // ── Click Next on business details page ───────────────────────
  step('Scroll + click Next on business details page');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await hd(800, 1200);
  await shot(page, '07_biz_scrolled');
  await clickNext(page);
  await hd(3000, 5000);
}

// ═══════════════════════════════════════════════════════════════
// ACCOUNT DETAILS FORM  (Address, City, State, Postal Code)
// ═══════════════════════════════════════════════════════════════

async function fillAccountDetailsForm(page, biz, context) {
  info(`Address fields: ${biz.address1} | ${biz.city} | ${biz.state} | ${biz.zip}`);

  // Fill via JS eval (handles React/Angular controlled inputs)
  const filled = await page.evaluate((data) => {
    const results = [];

    function setVal(el, value) {
      if (!value || !el) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    function findNear(labelText) {
      for (const lbl of document.querySelectorAll('label, [class*="label"], strong, span')) {
        if ((lbl.textContent || '').toLowerCase().includes(labelText.toLowerCase())) {
          if (lbl.htmlFor) { const el = document.getElementById(lbl.htmlFor); if (el) return el; }
          let sib = lbl.nextElementSibling;
          while (sib) {
            if (sib.tagName === 'INPUT' || sib.tagName === 'SELECT') return sib;
            const inp = sib.querySelector('input, select');
            if (inp) return inp;
            sib = sib.nextElementSibling;
          }
          const par = lbl.parentElement;
          if (par) { const inp = par.querySelector('input, select'); if (inp && inp.offsetWidth) return inp; }
        }
      }
      return null;
    }

    const inputs = Array.from(document.querySelectorAll('input, select'));

    const addr1 = findNear('address line 1') ||
      inputs.find(i => /address.?line.?1|address1/i.test(i.placeholder + i.id + i.name));
    if (setVal(addr1, data.address1)) results.push(`address1: ${data.address1}`);

    const city = findNear('city') ||
      inputs.find(i => /\bcity\b/i.test(i.placeholder + i.id + i.name));
    if (setVal(city, data.city)) results.push(`city: ${data.city}`);

    const zip = findNear('postal') || findNear('zip') ||
      inputs.find(i => /zip|postal/i.test(i.placeholder + i.id + i.name));
    if (setVal(zip, data.zip)) results.push(`zip: ${data.zip}`);

    // State / Province dropdown
    for (const sel of document.querySelectorAll('select')) {
      const id = (sel.id + sel.name + (sel.getAttribute('aria-label') || '')).toLowerCase();
      if (/state|province|region/i.test(id)) {
        const opts   = Array.from(sel.options);
        const target = data.state.toLowerCase();
        const match  = opts.find(o => o.text.toLowerCase().includes(target) || target.includes(o.text.toLowerCase()));
        if (match) {
          sel.value = match.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          results.push(`state: ${match.text}`);
        }
        break;
      }
    }

    return results;
  }, { address1: biz.address1 || '', city: biz.city || '', state: biz.state || '', zip: biz.zip || '' });

  if (filled && filled.length) {
    ok(`Filled via JS: ${filled.join(' | ')}`);
  } else {
    warn('JS fill returned nothing — using Playwright selectors');
    const map = [
      { sel: 'input[placeholder*="Address line 1" i]', val: biz.address1 },
      { sel: 'input[placeholder*="City" i]',           val: biz.city },
      { sel: 'input[placeholder*="ZIP" i]',            val: biz.zip },
      { sel: 'input[placeholder*="postal" i]',         val: biz.zip },
    ];
    for (const { sel, val } of map) {
      if (!val) continue;
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 2000 })) {
          if (!(await el.inputValue().catch(() => ''))) {
            await el.click();
            await hd(100, 200);
            await el.fill(val);
            ok(`Playwright filled: ${sel} = ${val}`);
          }
        }
      } catch {}
    }
  }

  // State dropdown via Playwright (fallback)
  try {
    const stateSel = page.locator(
      '#address-formStateOrProvince, select[name*="state" i], select[name*="province" i], select[id*="state" i], select[id*="province" i]'
    ).first();
    if (await stateSel.isVisible({ timeout: 3000 })) {
      const target = (biz.state || 'North Holland').toLowerCase();
      const opts   = await stateSel.locator('option').all();
      let matched  = false;
      for (const opt of opts) {
        const txt = (await opt.textContent().catch(() => '')).toLowerCase();
        if (txt.includes(target) || target.includes(txt)) {
          await stateSel.selectOption({ value: await opt.getAttribute('value') });
          ok(`State dropdown → ${await opt.textContent().catch(() => biz.state)}`);
          matched = true;
          break;
        }
      }
      if (!matched) {
        await stateSel.selectOption({ value: 'NH' }).catch(() => {});
        ok('State → NH (North Holland fallback)');
      }
    }
  } catch (e) { warn(`State dropdown: ${e.message}`); }

  await hd(700, 1200);
  await shot(page, '10_acct_details_filled');
  if (context) await saveSession(context, 'post_acct_details');

  step('Scroll + click Next on account details form');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await hd(800, 1200);
  await clickNext(page);
  await hd(4000, 6000);
  await pageInfo(page);
  await shot(page, '10_after_acct_details_next');
  if (context) await saveSession(context, 'post_acct_details_next');
}

// ═══════════════════════════════════════════════════════════════
// MAIN ACCOUNT PROCESSOR
// ═══════════════════════════════════════════════════════════════

async function processAccount(acc, proxyStr, rambler, biz, attemptNumber) {
  resetLog(acc.email);
  _email = acc.email;

  console.log('\n' + '═'.repeat(64));
  console.log(`  🚀  Account    : ${acc.email}`);
  console.log(`  📮  Secondary  : ${rambler.email}  (Rambler IMAP)`);
  console.log(`  🌐  Proxy      : ${proxyStr}`);
  console.log(`  📋  Business   : ${biz.businessName} / ${biz.website}`);
  console.log('═'.repeat(64));

  step('Launch browser');
  const browser = await chromium.launch({
    headless: false,
    slowMo: 60,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
    proxy: parseProxy(proxyStr),
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: null,
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  const page   = await context.newPage();
  let outcome  = 'failed';

  try {

    // ════════════════════════════════════════════════════════════
    // PHASE 1 — MICROSOFT ACCOUNT LOGIN + SECONDARY EMAIL SETUP
    // ════════════════════════════════════════════════════════════

    step('Navigate to Microsoft login');
    await page.goto(MS_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await hd(2000, 3500);
    await pageInfo(page);
    await shot(page, '01_login_page');

    step('Enter Microsoft account email');
    await hType(page,
      'input[type="email"], input[name="loginfmt"], #i0116',
      acc.email);
    await hd(600, 1400);
    await tryClick(page,
      ['input[type="submit"]', 'button:has-text("Next")', '#idSIButton9'],
      'Next', 8000);
    await hd(2000, 3500);
    await pageInfo(page);

    step('Enter password');
    await hType(page,
      'input[type="password"], input[name="passwd"], #i0118',
      acc.password);
    await hd(700, 1500);
    await tryClick(page,
      ['input[type="submit"]', 'button:has-text("Sign in")', 'button:has-text("Next")', '#idSIButton9'],
      'Sign in', 8000);
    await hd(3000, 5000);
    await pageInfo(page);
    await shot(page, '02_after_password');

    step('Detect page after password');
    const already = await checkAlreadyUsed(page);
    if (already.alreadyUsed) {
      warn(`ALREADY USED — existing secondary: ${already.maskedEmail}`);
      const auEntry = {
        email: acc.email, secondary_seen: already.maskedEmail, proxy: proxyStr,
        time: ts(), status: 'already_used',
        note: 'Microsoft shows existing secondary — account previously set up',
      };
      logAlreadyUsed(auEntry);
      saveDetails({ ...auEntry, secondary_email: already.maskedEmail, session_file: null });
      appendSessionLog(auEntry);
      writeIndex(acc.email, {
        status: 'already_used', proxy: proxyStr, secondary_seen: already.maskedEmail,
        detected_at: ts(), attempt_number: attemptNumber,
      });
      saveStepLog(acc.email, 'already_used');
      await browser.close();
      return { outcome: 'already_used' };
    }
    ok('No already-used screen → proceeding to add secondary email');

    step(`Enter Rambler email as secondary: ${rambler.email}`);
    await hType(page,
      'input[type="email"], input[type="text"], input[name="Email"], input[name="SessionStateInput"]',
      rambler.email);
    await hd(800, 1600);
    await tryClick(page,
      ['input[type="submit"]', 'button:has-text("Send code")', 'button:has-text("Next")', '#idSIButton9'],
      'Send code', 8000);
    await hd(2000, 3000);
    await shot(page, '03_secondary_sent');

    step(`Fetch OTP from ${rambler.email} via Rambler IMAP`);
    const otpStartedAt = Date.now();
    const otp = await waitForOtp(rambler.email, rambler.password, otpStartedAt, 3 * 60 * 1000);
    ok(`OTP received: ${otp}`);

    step('Enter OTP');
    await hType(page,
      'input[name="otc"], input[aria-label*="code" i], input[placeholder*="code" i], input[type="tel"], input[type="number"], input[type="text"]',
      otp);
    await hd(800, 1500);
    await tryClick(page,
      ['input[type="submit"]', 'button:has-text("Verify")', 'button:has-text("Next")', 'button:has-text("Sign in")', '#idSIButton9'],
      'Verify OTP', 8000);
    await hd(3000, 5000);
    await shot(page, '04_after_otp');

    step('Handle "Stay signed in" (Phase 1)');
    for (let i = 0; i < 3; i++) {
      const visible = await page.locator('#idSIButton9').isVisible({ timeout: 5000 }).catch(() => false);
      if (visible) {
        await hd(800, 1500);
        await page.locator('#idSIButton9').click();
        ok('Clicked "Stay signed in"');
        await hd(4000, 6000);
        break;
      }
      await hd(2000, 3000);
    }
    await pageInfo(page);
    await shot(page, '05_after_stay_signed_in');

    step('Save post-login session');
    const postLogin = await saveSession(context, 'post_login');
    writeIndex(acc.email, {
      proxy: proxyStr, secondary_email: rambler.email,
      post_login_session: postLogin.sp, post_login_time: ts(),
      status: 'post_login', attempt_number: attemptNumber,
    });

    // ════════════════════════════════════════════════════════════
    // PHASE 2 — MICROSOFT ADS SETUP
    // ════════════════════════════════════════════════════════════

    step('Navigate to Microsoft Ads');
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await page.goto('https://ads.microsoft.com', { waitUntil: 'domcontentloaded', timeout: 45000 });
        if (page.url().includes('chrome-error')) throw new Error('chrome-error page');
        break;
      } catch (navErr) {
        warn(`Nav attempt ${attempt}: ${navErr.message.slice(0, 80)}`);
        if (attempt < 2) await hd(8000, 9000); else throw navErr;
      }
    }
    await hd(3000, 5000);
    await pageInfo(page);
    await shot(page, '06_ads_landing');

    step('Handle Ads sign-in flow (up to 10 iterations)');
    for (let iter = 0; iter < 10; iter++) {
      const curUrl   = page.url();
      const curTitle = (await page.title().catch(() => '')).toLowerCase();
      const bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
      info(`[${iter + 1}] ${curUrl.split('?')[0]}  |  ${curTitle}`);

      // ✅ Already on Ads dashboard
      if (new URL(curUrl).hostname === 'ads.microsoft.com' && !curUrl.includes('/Login')) {
        ok('On Microsoft Ads — signed in!');
        break;
      }

      // Username already exists → sign up for new account
      if (curUrl.includes('ads.microsoft.com') && /username already exists/i.test(bodyText)) {
        info('Username already exists → sign up new account');
        await tryClick(page, [
          'a:has-text("Sign up for a new Microsoft Advertising account")',
          'button:has-text("Sign up for a new Microsoft Advertising account")',
        ], 'Sign up new account', 6000);
        await hd(4000, 7000);
        continue;
      }

      // Public Ads homepage → click Sign in
      if (curUrl.includes('ads.microsoft.com') &&
          (bodyText.toLowerCase().includes('grow your business') || bodyText.toLowerCase().includes('create your account'))) {
        info('Public Ads homepage → Sign in');
        await tryClick(page, ['a:has-text("Sign in")', 'button:has-text("Sign in")'], 'Sign in', 6000);
        await hd(3000, 5000);
        continue;
      }

      // Continue with Microsoft button
      const contBtn = await firstVisible(page, [
        'button:has-text("Continue with Microsoft")',
        'a:has-text("Continue with Microsoft")',
      ], 3000);
      if (contBtn) {
        await tryClick(page, [contBtn], 'Continue with Microsoft', 6000);
        await hd(3000, 5000);
        continue;
      }

      // Stay signed in
      if (curTitle.includes('stay signed in')) {
        await tryClick(page, ['#idSIButton9', 'input[value="Yes"]', 'button:has-text("Yes")'], 'Stay signed in (Yes)', 6000);
        await hd(4000, 6000);
        continue;
      }

      // Account picker → click the tile with "Signed in"
      const pickerClicked = await page.evaluate((targetEmail) => {
        const candidates = [
          ...Array.from(document.querySelectorAll('[role="button"]')),
          ...Array.from(document.querySelectorAll('div[tabindex="0"]')),
          ...Array.from(document.querySelectorAll('.table-row')),
          ...Array.from(document.querySelectorAll('[data-bind]')),
        ];
        for (const el of candidates) {
          const txt = el.textContent || '';
          if (txt.includes('Signed in') && txt.toLowerCase().includes(targetEmail.split('@')[0].toLowerCase())) {
            el.click();
            return `${txt.trim().replace(/\s+/g,' ').slice(0, 60)}`;
          }
        }
        for (const el of candidates) {
          if ((el.textContent || '').includes('Signed in')) {
            el.click();
            return `fallback: ${(el.textContent || '').trim().slice(0, 60)}`;
          }
        }
        return null;
      }, acc.email);

      if (pickerClicked) {
        ok(`Account picker clicked: ${pickerClicked}`);
        await hd(4000, 6000);
        continue;
      }

      // Password prompt
      const passSel = await firstVisible(page, ['input[name="passwd"]', '#i0118', 'input[type="password"]'], 3000);
      if (passSel) {
        info('Password prompt → entering password');
        await hType(page, passSel, acc.password);
        await tryClick(page, ['input[type="submit"]', 'button:has-text("Sign in")', '#idSIButton9'], 'Sign in', 5000);
        await hd(5000, 7000);
        continue;
      }

      // Email field (if session expired fully)
      const emailSel = await firstVisible(page, ['input[name="loginfmt"]', '#i0116'], 2000);
      if (emailSel) {
        const val = await page.locator(emailSel).first().inputValue().catch(() => '');
        if (!val) await hType(page, emailSel, acc.email);
        await tryClick(page, ['input[type="submit"]', '#idSIButton9', 'button:has-text("Next")'], 'Next', 5000);
        await hd(4000, 6000);
        continue;
      }

      // Nothing matched — wait for redirect
      info('Waiting for redirect...');
      await hd(4000, 5000);
    }

    await pageInfo(page);
    await shot(page, '06_after_ads_signin');
    step('Save session after Ads sign-in');
    await saveSession(context, 'post_ads_signin');
    writeIndex(acc.email, { ads_signin_time: ts() });

    step('Wait for Microsoft Ads to fully load');
    try { await page.waitForLoadState('networkidle', { timeout: 25000 }); } catch {}
    await hd(3000, 5000);

    // ── "Tell us about your business" form ────────────────────────
    step('Wait for "Tell us about your business" form (up to 90s)');
    try { await page.waitForLoadState('networkidle', { timeout: 20000 }); } catch {}
    await hd(2000, 3000);
    await pageInfo(page);

    const bizSel = await firstVisible(page, [
      'text=Tell us about your business',
      'text=About your business',
      'text=Business information',
      'input[placeholder*="https://" i]',
      'input[placeholder*="website" i]',
    ], 90000);

    if (bizSel) {
      ok(`Business form visible: ${bizSel}`);
      await shot(page, '07_biz_form');
      await hd(1500, 2500);
      await fillBusinessForm(page, biz, context);
    } else {
      warn('Business form not found — continuing');
      await shot(page, '07_no_biz_form');
      await pageInfo(page);
    }

    step('Save session after business form');
    await saveSession(context, 'post_biz');
    writeIndex(acc.email, { post_biz_time: ts() });

    // ── "How can we help you" → Create account ────────────────────
    step('Wait for "How can we help you" screen');
    const helpSel = await firstVisible(page, [
      'text=How can we help',
      'text=What is your goal',
      'text=get started',
    ], 20000);

    if (helpSel) {
      ok('"How can we help" screen found');
      await shot(page, '08_how_help');
      await hd(1500, 2500);
      const createResult = await page.evaluate(() => {
        const candidates = [
          ...Array.from(document.querySelectorAll('[role="button"]')),
          ...Array.from(document.querySelectorAll('button')),
          ...Array.from(document.querySelectorAll('label')),
          ...Array.from(document.querySelectorAll('div[class*="card"]')),
          ...Array.from(document.querySelectorAll('div[tabindex]')),
        ];
        for (const el of candidates) {
          const txt = (el.textContent || '').toLowerCase();
          if (txt.includes('create account') && !txt.includes('campaign')) {
            el.click();
            return el.textContent.trim().replace(/\s+/g,' ').slice(0, 60);
          }
        }
        for (const el of candidates) {
          if ((el.textContent || '').toLowerCase().includes('create account')) {
            el.click();
            return `broad: ${el.textContent.trim().replace(/\s+/g,' ').slice(0, 60)}`;
          }
        }
        return null;
      });
      if (createResult) { ok(`"Create account" selected: ${createResult}`); }
      else { warn('"Create account" not found'); await shot(page, '08_create_account_missing'); }
      await hd(3000, 5000);
      await pageInfo(page);
      await shot(page, '08_after_create_account');
    } else {
      info('"How can we help" not found — may already be on next screen');
    }

    await saveSession(context, 'post_help');

    // ── "Create account only" card ────────────────────────────────
    step('Select "Create account only" card');
    await hd(2000, 3500);
    await pageInfo(page);
    await shot(page, '09_campaign_choice');

    const createOnlyResult = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (/create account only/i.test(node.textContent)) {
          let el = node.parentElement;
          while (el && el !== document.body) {
            const style = window.getComputedStyle(el);
            const tag   = el.tagName.toLowerCase();
            if (tag === 'label' || el.getAttribute('role') === 'radio' ||
                el.getAttribute('role') === 'button' || el.getAttribute('tabindex') === '0' ||
                style.cursor === 'pointer') {
              el.click();
              return el.textContent.trim().replace(/\s+/g,' ').slice(0, 80);
            }
            el = el.parentElement;
          }
          node.parentElement.click();
          return `parent: ${node.parentElement.textContent.trim().slice(0, 60)}`;
        }
      }
      return null;
    });

    if (createOnlyResult) {
      ok(`"Create account only" selected: ${createOnlyResult}`);
      await hd(1500, 2500);
      await shot(page, '09_create_account_only_selected');
      step('Click Next to confirm "Create account only"');
      await clickNext(page);
      await hd(4000, 6000);
      try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}
      await pageInfo(page);
      await shot(page, '09_after_create_account_only_next');
    } else {
      warn('"Create account only" not found');
      await shot(page, '09_create_account_only_missing');
      await pageInfo(page);
    }

    // ── Account Details form (Address, City, State, ZIP) ──────────
    step('Check for Account Details form');
    await hd(2000, 3000);
    const acctDetailsVisible = await page.locator(
      'text=Account details, text=Address line 1'
    ).first().isVisible({ timeout: 15000 }).catch(() => false);

    if (acctDetailsVisible) {
      ok('Account Details form found');
      await shot(page, '10_account_details_form');
      await fillAccountDetailsForm(page, biz, context);
    } else {
      info('Account Details form not visible — skipping');
    }

    // ── Payment page ──────────────────────────────────────────────
    step('Check for Payment page');
    await hd(2000, 3000);
    const paymentVisible = await page.locator(
      'text=How would you like to pay, text=Set up payment later, text=Enter your payment method'
    ).first().isVisible({ timeout: 15000 }).catch(() => false);

    if (paymentVisible) {
      ok('Payment page detected');
      await shot(page, '11_payment_page');

      // Click "Set up payment later"
      let payLater = false;
      for (const sel of [
        'text=Set up payment later',
        'a:has-text("Set up payment later")',
        'button:has-text("Set up payment later")',
      ]) {
        try {
          const el = page.locator(sel).first();
          await el.waitFor({ state: 'visible', timeout: 8000 });
          await el.scrollIntoViewIfNeeded();
          await hd(600, 1000);
          await el.click();
          ok(`Clicked "Set up payment later" [${sel}]`);
          payLater = true;
          break;
        } catch {}
      }
      if (!payLater) {
        // JS fallback
        const r = await page.evaluate(() => {
          for (const el of document.querySelectorAll('a,button,[role="button"]')) {
            if (/set\s+up\s+payment\s+later/i.test(el.innerText || '') && el.offsetParent) {
              el.click(); return el.innerText.trim();
            }
          }
          return null;
        });
        if (r) { ok(`JS clicked: ${r}`); payLater = true; }
      }
      if (!payLater) warn('"Set up payment later" not found');

      await hd(2000, 3000);
      await shot(page, '11_payment_dialog');

      // Click Yes on confirmation dialog
      let yesClicked = false;
      for (const sel of ['button:has-text("Yes")', 'input[value="Yes"]', '[role="button"]:has-text("Yes")']) {
        try {
          const el = page.locator(sel).first();
          await el.waitFor({ state: 'visible', timeout: 8000 });
          await hd(500, 800);
          await el.click();
          ok(`Clicked "Yes" [${sel}]`);
          yesClicked = true;
          break;
        } catch {}
      }
      if (!yesClicked) {
        const r = await page.evaluate(() => {
          for (const el of document.querySelectorAll('button,[role="button"]')) {
            if (/^yes$/i.test((el.innerText || '').trim())) { el.click(); return 'yes'; }
          }
          return null;
        });
        if (r) { ok('JS clicked Yes'); yesClicked = true; }
      }
      if (!yesClicked) warn('"Yes" not found on payment dialog');

      try { await page.locator('button:has-text("Yes")').waitFor({ state: 'hidden', timeout: 8000 }); } catch {}
      await hd(3000, 5000);
      await shot(page, '11_after_yes');

      // Click "Create Campaign" button to finalise (if it appears)
      let campaignClicked = false;
      for (const sel of [
        'button:has-text("Create Campaign")',
        'button:has-text("Create campaign")',
        'a:has-text("Create Campaign")',
        '[role="button"]:has-text("Create Campaign")',
      ]) {
        try {
          const el = page.locator(sel).first();
          await el.waitFor({ state: 'visible', timeout: 8000 });
          await el.scrollIntoViewIfNeeded();
          await hd(800, 1200);
          await el.click();
          ok(`Clicked "Create Campaign" [${sel}]`);
          campaignClicked = true;
          break;
        } catch {}
      }
      if (!campaignClicked) {
        const r = await page.evaluate(() => {
          for (const el of document.querySelectorAll('button,a,[role="button"]')) {
            const t = (el.innerText || '').trim();
            if (/create\s+campaign/i.test(t) && el.offsetParent) { el.scrollIntoView(); el.click(); return t; }
          }
          return null;
        });
        if (r) { ok(`JS clicked: ${r}`); campaignClicked = true; }
      }
      if (!campaignClicked) info('"Create Campaign" button not visible — continuing');

      await saveSession(context, 'post_payment');

    } else {
      info('Payment page not detected — skipping payment step');
    }

    // ── Wait 3 minutes → screenshot ───────────────────────────────
    step('Waiting 3 minutes for page to fully load');
    await pageInfo(page);
    await shot(page, '12_pre_3min_wait');
    info('Sleeping 180 seconds (3 minutes)...');
    await sleep(180_000);
    ok('3-minute wait complete');

    step('Take final screenshot → screenshots_accounts/');
    await pageInfo(page);
    const finalShotPath = await shot(page, 'FINAL_DASHBOARD', SCREENSHOTS_FINAL);
    ok(`Final screenshot saved: ${finalShotPath}`);

    step('Save final session');
    const finalSession = await saveSession(context, 'FINAL');
    const { url: finalUrl } = await pageInfo(page);

    // Update all log files
    writeIndex(acc.email, {
      status:             'success',
      proxy:              proxyStr,
      secondary_email:    rambler.email,
      session:            finalSession.sp,
      cookie_file:        finalSession.cp,
      final_url:          finalUrl,
      final_screenshot:   finalShotPath,
      completed_at:       ts(),
      attempt_number:     attemptNumber,
    });

    saveDetails({
      email:           acc.email,
      secondary_email: rambler.email,
      proxy:           proxyStr,
      session_file:    finalSession.sp,
      time:            ts(),
      status:          'success',
      attempt_number:  attemptNumber,
    });

    appendSessionLog({
      email:           acc.email,
      secondary_email: rambler.email,
      proxy:           proxyStr,
      session:         finalSession.sp,
      time:            ts(),
      status:          'success',
    });

    saveStepLog(acc.email, 'success');
    outcome = 'success';

    console.log(`\n  🎉  SUCCESS : ${acc.email}`);
    console.log(`       Secondary  : ${rambler.email}`);
    console.log(`       Screenshot : ${finalShotPath}`);
    console.log(`       Session    : ${finalSession.sp}\n`);

  } catch (err) {
    outcome = 'failed';
    fail(err.message);
    if (err.stack) info('Stack: ' + err.stack.split('\n').slice(0, 4).join(' | '));

    try { await pageInfo(page); await shot(page, 'ERROR'); } catch {}
    try { await saveSession(context, 'error'); } catch {}

    writeIndex(acc.email, {
      status: 'failed', error: err.message, proxy: proxyStr,
      secondary_email: rambler.email, last_attempt: ts(), attempt_number: attemptNumber,
    });
    saveDetails({
      email: acc.email, secondary_email: rambler.email, proxy: proxyStr,
      session_file: null, time: ts(), status: 'failed',
      note: err.message, attempt_number: attemptNumber,
    });
    appendSessionLog({
      email: acc.email, proxy: proxyStr, time: ts(), status: 'failed', error: err.message,
    });
    saveStepLog(acc.email, 'failed');
    console.log(`\n  ✗  FAILED: ${acc.email}\n     Error: ${err.message}\n`);

  } finally {
    await browser.close().catch(() => {});
  }

  return { outcome };
}

// ═══════════════════════════════════════════════════════════════
// ENTRY POINT
// ═══════════════════════════════════════════════════════════════

(async () => {
  ensureDirs();

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║   Microsoft Ads Full Automation  —  version11.js    ║');
  console.log('║   Login (Rambler IMAP) + Ads Setup in one shot      ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  // ── Read ALL logs before doing anything ──────────────────────
  const stats = getStats();
  console.log('📊 Previous run stats (from logs):');
  console.log(`   ✅ Success      : ${stats.success}`);
  console.log(`   ❌ Failed       : ${stats.failed}`);
  console.log(`   ⚠️  Already used : ${stats.already_used}`);
  console.log(`   📊 Total logged : ${stats.total}\n`);

  const usedRamblers = getUsedRamblers();
  const usedProxies  = getUsedProxies();
  console.log(`📬 ${usedRamblers.size} Rambler accounts already used as secondary — will not reuse`);

  // ── Load input files ──────────────────────────────────────────
  const emails    = JSON.parse(fs.readFileSync(EMAILS_FILE, 'utf8'));
  const proxies   = fs.readFileSync(PROXIES_FILE, 'utf8').split('\n').map(p => p.trim()).filter(Boolean);
  const ramblers  = parseRamblerFile(RAMBLER_FILE);
  const bizArr    = (() => { const r = JSON.parse(fs.readFileSync(BUSINESS_FILE, 'utf8')); return Array.isArray(r) ? r : [r]; })();

  console.log(`📧 ${emails.length} Microsoft accounts`);
  console.log(`🌐 ${proxies.length} proxies`);
  console.log(`📮 ${ramblers.length} Rambler accounts`);
  console.log(`📋 ${bizArr.length} business entries\n`);

  // Fresh Rambler accounts = those whose email is NOT already a secondary in logs
  let freshRamblers = ramblers.filter(r => !usedRamblers.has(r.email.toLowerCase()));
  if (freshRamblers.length === 0) {
    console.log('⚠️  All Rambler accounts already used — reusing all');
    freshRamblers = [...ramblers];
  }

  let successCount     = 0;
  let failCount        = 0;
  let alreadyUsedCount = 0;
  let skipped          = 0;
  let attempted        = 0;
  let ramblerIdx       = 0;

  for (let i = 0; i < emails.length; i++) {
    const acc = emails[i];

    // Skip if already done
    if (isCompleted(acc.email)) {
      console.log(`⏭️  Skipping (already completed): ${acc.email}`);
      skipped++;
      continue;
    }

    attempted++;

    // ── Pick proxy ──────────────────────────────────────────────
    let proxyStr;
    const db = readIndex();
    if (db[acc.email]?.proxy) {
      proxyStr = db[acc.email].proxy;
      console.log(`♻️  Reusing saved proxy for ${acc.email}`);
    } else {
      const available = proxies.filter(p => !usedProxies.has(p));
      if (available.length > 0) {
        proxyStr = available[Math.floor(Math.random() * available.length)];
        usedProxies.add(proxyStr);
        console.log(`🆕 Assigned fresh proxy (${available.length} available)`);
      } else {
        proxyStr = proxies[Math.floor(Math.random() * proxies.length)];
        console.log('⚠️  All proxies exhausted — using random fallback');
      }
    }

    // ── Pick fresh Rambler account ──────────────────────────────
    if (ramblerIdx >= freshRamblers.length) {
      console.log('⚠️  Ran out of fresh Rambler accounts — recycling from start');
      ramblerIdx = 0;
    }
    const rambler = freshRamblers[ramblerIdx++];
    usedRamblers.add(rambler.email.toLowerCase());

    // ── Pick business (round-robin by position) ─────────────────
    const biz = bizArr[i % bizArr.length];

    // ── Run the full combined flow ───────────────────────────────
    const { outcome } = await processAccount(acc, proxyStr, rambler, biz, attempted);

    if      (outcome === 'success')      successCount++;
    else if (outcome === 'already_used') alreadyUsedCount++;
    else                                 failCount++;

    // Human gap between accounts
    const gap = Math.floor(Math.random() * 6000) + 8000;
    console.log(`\n⏳ Waiting ${(gap / 1000).toFixed(1)}s before next account...\n`);
    await sleep(gap);
  }

  // ── Final summary ─────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║                   RUN COMPLETE                      ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  ✅ Success       : ${String(successCount).padEnd(32)}║`);
  console.log(`║  ⚠️  Already used  : ${String(alreadyUsedCount).padEnd(32)}║`);
  console.log(`║  ❌ Failed        : ${String(failCount).padEnd(32)}║`);
  console.log(`║  ⏭️  Skipped       : ${String(skipped).padEnd(32)}║`);
  console.log(`║  📊 Attempted     : ${String(attempted).padEnd(32)}║`);
  console.log('╚══════════════════════════════════════════════════════╝\n');
  console.log('📁 logs/account_index.json   — account status + sessions');
  console.log('📁 logs/details.txt          — human-readable run log');
  console.log('📁 logs/already_used.txt     — already-configured accounts');
  console.log('📁 sessions/                 — browser storage states');
  console.log('📁 screenshots_accounts/     — final dashboard screenshots\n');

})();
