'use strict';
/**
 * full_flow.js — Microsoft Ads Account Creator (Full Pipeline)
 * ─────────────────────────────────────────────────────────────
 * Stage 1 — Login (same as index.js but uses Rambler for OTP):
 *   1. Pick next unused Hotmail email from emails.json
 *   2. Pick next available Rambler account from rambler.txt
 *   3. Sign in to ads.microsoft.com with the Hotmail account
 *   4. When secondary email is requested, enter the Rambler address
 *   5. Read the OTP from Rambler inbox via IMAP
 *   6. Click "Stay signed in" → save session
 *
 * Stage 2 — Ads Setup (continues in the same browser context):
 *   7.  Navigate to ads.microsoft.com → sign in → pick account tile
 *   8.  "Tell us about your business" → website, name, phone
 *   9.  "How can we help you" → Create account
 *   10. "Create account only" (not create + campaign)
 *   11. Account Details form (address, city, state, ZIP)
 *   12. Payment page → "Set up payment later" → "Yes" → "Create Campaign"
 *   13. Mark account as success in emails.json + account_index.json
 *
 * Usage:
 *   node full_flow.js                      — run next unused account
 *   node full_flow.js --dry                — show which account would be picked
 *   node full_flow.js --resume user@hotmail.com — skip Stage 1, load session from account_index
 * ─────────────────────────────────────────────────────────────
 */

const { chromium }  = require('playwright');
const fs            = require('fs');
const path          = require('path');
const { waitForOtp, parseRamblerFile } = require('./imap_otp');

const ROOT            = __dirname;
const EMAILS_FILE     = path.join(ROOT, 'emails.json');
const BUSINESS_FILE   = path.join(ROOT, 'business.json');
const RAMBLER_FILE    = path.join(ROOT, 'rambler.txt');
const PROXIES_FILE    = path.join(ROOT, 'proxies.txt');
const INDEX_FILE      = path.join(ROOT, 'logs', 'account_index.json');
const RUN_LOG_FILE    = path.join(ROOT, 'logs', 'full_flow_runs.jsonl');
const SESSIONS_DIR    = path.join(ROOT, 'sessions');
const SCREENSHOTS_DIR = path.join(ROOT, 'logs', 'screenshots');

// Start from the Ads signup page — it will redirect to MS login with fresh params
const MS_ADS_LOGIN_URL = 'https://ads.microsoft.com/PMaxLite/Signup/?idP=MSA&s_cid=acq-pmaxlanding-src_default';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

const sleep   = (ms) => new Promise(r => setTimeout(r, ms));
const hd      = (min = 800, max = 2000) => sleep(Math.floor(Math.random() * (max - min + 1)) + min);
const ts      = () => new Date().toISOString();
const safeStr = (s) => s.replace(/[@.]/g, '_');

function ensureDirs() {
  for (const d of ['logs', 'sessions', 'logs/screenshots']) {
    const full = path.join(ROOT, d);
    if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
  }
}

function readJson(file, def = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function updateIndex(email, patch) {
  const db = readJson(INDEX_FILE, {});
  db[email] = { ...db[email], ...patch };
  writeJson(INDEX_FILE, db);
}

/** Append one JSON line per run so you can audit what was consumed and never double-book by mistake. */
function appendRunLog(entry) {
  try {
    const line = JSON.stringify({ ...entry, ts: ts() }) + '\n';
    fs.appendFileSync(RUN_LOG_FILE, line, 'utf8');
    console.log(`   📝 Logged run event → ${path.basename(RUN_LOG_FILE)}`);
  } catch (e) {
    console.log(`   ⚠  Could not write run log: ${e.message}`);
  }
}

async function shot(page, email, label) {
  try {
    const p = path.join(SCREENSHOTS_DIR, `${safeStr(email)}_${label}_${ts().replace(/[:.]/g,'-')}.png`);
    await page.screenshot({ path: p, fullPage: false, timeout: 0 });
    console.log(`   📸 ${label} → ${path.basename(p)}`);
  } catch {}
}

async function fillVisibleEmail(page, emailStr, loginOnly = false) {
  return page.evaluate(({ em, loginOnly: lo }) => {
    let inputs = [...document.querySelectorAll('input[type="email"], input[name="loginfmt"], input[type="text"], #i0116')];
    if (lo) {
      inputs = inputs.filter(i =>
        i.name === 'loginfmt' || i.id === 'i0116' || i.type === 'email'
      );
    }
    const visible = inputs.find(i =>
      i.offsetWidth > 0 && i.offsetHeight > 0 &&
      !i.classList.contains('moveOffScreen') &&
      i.getAttribute('aria-hidden') !== 'true' &&
      i.getAttribute('maxlength') !== '1'
    );
    if (!visible) return false;
    visible.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(visible, em); else visible.value = em;
    visible.dispatchEvent(new Event('input', { bubbles: true }));
    visible.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, { em: emailStr, loginOnly });
}

async function fillVisiblePassword(page, pwd) {
  return page.evaluate((p) => {
    const inp = [...document.querySelectorAll('input[type="password"]')]
      .find(i => i.offsetWidth > 0 && i.offsetHeight > 0 && !i.classList.contains('moveOffScreen') && i.getAttribute('aria-hidden') !== 'true');
    if (!inp) return false;
    inp.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(inp, p); else inp.value = p;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, pwd);
}

async function clickJsSubmitOrSendCode(page) {
  return page.evaluate(() => {
    const btn = document.querySelector('input[type="submit"], button[type="submit"]') ||
      [...document.querySelectorAll('button')].find(b => /send code|next|verify|sign in/i.test(b.innerText || ''));
    if (btn) { btn.click(); return true; }
    return false;
  });
}

/** After website entry, wait for Microsoft to finish scraping the URL. */
async function waitForAdsDom(page, maxMs = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const len = await page.evaluate(() => (document.body && document.body.innerText ? document.body.innerText.trim().length : 0)).catch(() => 0);
    if (len > 60) return;
    await sleep(2000);
  }
}

async function waitForWebsiteScrapeDone(page, maxMs = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const busy = await page.evaluate(() => {
      const t = (document.body.innerText || '').toLowerCase();
      return t.includes('getting information') || t.includes('loading');
    }).catch(() => false);
    if (!busy) return;
    await sleep(2000);
  }
}

/** Host only — never use substring match on full URL (query strings can contain login.microsoftonline). */
function pageHost(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

const MS_EMAIL_HOSTS = new Set(['login.live.com', 'login.microsoftonline.com']);

/**
 * account.live.com proofs / verify — use Rambler + OTP, never primary Hotmail in the Email field.
 * otpState: { t: number|null } set when Send code is clicked.
 */
async function handleAccountLiveSecurity(page, account, rambler, otpState) {
  const h = pageHost(page.url());
  if (h !== 'account.live.com') return false;

  const curUrl   = page.url();
  const curTitle = await page.title().catch(() => '');
  const curBody  = await page.evaluate(() => document.body.innerText || '').catch(() => '');

  // OTP entry — include proofs/Verify and "Enter the code we sent…" (not only "Enter your code")
  const onProofsVerify = /\/proofs\/verify/i.test(curUrl);
  const onCode =
    /enter your code/i.test(curTitle) ||
    /enter the code/i.test(curTitle) ||
    /code we sent/i.test(curTitle) ||
    onProofsVerify ||
    (/enter.*code/i.test(curBody) && await page.locator('input[maxlength="1"]').first().isVisible({ timeout: 1500 }).catch(() => false));
  if (onCode) {
    console.log('   [account.live] OTP entry — IMAP...');
    const sinceMs = otpState.t ? otpState.t - 90 * 1000 : Date.now() - 8 * 60 * 1000;
    const otp = await waitForOtp(rambler.email, rambler.password, sinceMs, 4 * 60 * 1000);
    console.log(`   ✅ OTP: ${otp}`);
    await fillOtpIntoPage(page, otp);
    await hd(800, 1500);
    try { await clickJsSubmitOrSendCode(page); } catch {}
    await hd(4000, 7000);
    return true;
  }

  if (/verify your email/i.test(curBody) && /enter it here/i.test(curBody)) {
    console.log(`   [account.live] Confirm recovery email → ${rambler.email}`);
    await page.evaluate((email) => {
      const inputs = [...document.querySelectorAll('input[type="email"], input[type="text"]')];
      const v = inputs.find(i => i.offsetWidth > 0 && i.offsetHeight > 0 && i.getAttribute('maxlength') !== '1');
      if (!v) return;
      v.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(v, email); else v.value = email;
      v.dispatchEvent(new Event('input', { bubbles: true }));
      v.dispatchEvent(new Event('change', { bubbles: true }));
    }, rambler.email);
    await hd(500, 900);
    await clickJsSubmitOrSendCode(page);
    otpState.t = Date.now();
    await hd(5000, 8000);
    return true;
  }

  // Add proof / alternate email only — never proofs/Verify (that is OTP, handled above)
  if (
    !/\/proofs\/verify/i.test(curUrl) &&
    (/protect your account/i.test(curBody) || /add another way/i.test(curBody) || /\/proofs\/add/i.test(curUrl))
  ) {
    console.log(`   [account.live] Security / alternate email → ${rambler.email}`);
    const did = await page.evaluate((email) => {
      const inputs = [...document.querySelectorAll('input[type="email"], input[type="text"]')];
      const v = inputs.find(i =>
        i.offsetWidth > 0 && i.offsetHeight > 0 &&
        i.getAttribute('maxlength') !== '1' &&
        i.name !== 'loginfmt'
      );
      if (!v) return false;
      v.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(v, email); else v.value = email;
      v.dispatchEvent(new Event('input', { bubbles: true }));
      v.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, rambler.email);
    if (did) {
      await hd(400, 800);
      await tryClick(page, ['input[type="submit"]', 'button:has-text("Next")', '#idSIButton9', 'button:has-text("Send code")']);
      otpState.t = Date.now();
      await hd(4000, 7000);
    }
    return true;
  }

  return false;
}

async function fillOtpIntoPage(page, otp) {
  const digits = String(otp).replace(/\D/g, '').split('');
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll('input[maxlength="1"]')].filter(i => i.offsetWidth > 0 && i.offsetHeight > 0).length
  ).catch(() => 0);

  if (boxes >= 4 && digits.length >= 4) {
    const inputs = page.locator('input[maxlength="1"]').filter({ visible: true });
    const n = await inputs.count();
    for (let i = 0; i < n && i < digits.length; i++) {
      try {
        await inputs.nth(i).click();
        await inputs.nth(i).fill(digits[i]);
        await hd(50, 120);
      } catch {}
    }
    return true;
  }

  await page.evaluate((code) => {
    const inp = [...document.querySelectorAll('input[name="otc"], input[type="tel"], input[autocomplete="one-time-code"]')]
      .find(i => i.offsetWidth > 0 && i.offsetHeight > 0);
    if (!inp) return;
    inp.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(inp, code); else inp.value = code;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }, otp);
  return true;
}

async function hType(page, selector, text) {
  await page.click(selector);
  await hd(200, 500);
  for (const c of text) {
    await page.keyboard.type(c);
    await sleep(Math.floor(Math.random() * 100) + 40);
  }
}

async function tryClick(page, selectors) {
  for (const s of selectors) {
    try {
      const el = page.locator(s).first();
      await el.waitFor({ state: 'visible', timeout: 6000 });
      await hd(300, 700);
      await el.click();
      return true;
    } catch {}
  }
  return false;
}

// ── Proxy parsing ────────────────────────────────────────────────
function parseProxy(str) {
  const [host, port, user, pass] = str.split(':');
  return { server: `http://${host}:${port}`, username: user, password: pass };
}

function pickProxy(email) {
  const db  = readJson(INDEX_FILE, {});
  const raw = fs.readFileSync(PROXIES_FILE, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
  if (db[email]?.proxy) return db[email].proxy;
  const used = new Set(Object.values(db).map(v => v.proxy).filter(Boolean));
  const fresh = raw.filter(p => !used.has(p));
  return fresh.length ? fresh[0] : raw[Math.floor(Math.random() * raw.length)];
}

// ── Rambler account picker ───────────────────────────────────────
function loadRamblerAccounts() {
  const raw = fs.readFileSync(RAMBLER_FILE, 'utf8').trim();
  // JSON array format: [{"email":"...","password":"..."},...]
  if (raw.startsWith('[') || raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {}
  }
  // Fallback: try the imap_otp parser (markdown/CSV format)
  return parseRamblerFile(RAMBLER_FILE);
}

function pickRambler() {
  const accounts = loadRamblerAccounts();
  const db = readJson(INDEX_FILE, {});
  const usedSecondaries = new Set(Object.values(db).map(v => v.secondary_email).filter(Boolean));
  const reserved = new Set(
    Object.values(db)
      .filter(v => v.status === 'in_progress' && v.reserved_rambler)
      .map(v => v.reserved_rambler)
  );
  const available = accounts.filter(a => !usedSecondaries.has(a.email) && !reserved.has(a.email));
  if (!available.length) {
    console.log('⚠  No free Rambler (all used or reserved) — using first pool entry');
    return accounts[0];
  }
  return available[0];
}

// ═══════════════════════════════════════════════════════════════
// STAGE 2 HELPERS (Ads Setup)
// ═══════════════════════════════════════════════════════════════

async function clickNextButton(page) {
  for (const s of [
    'button:has-text("Next")',
    'button:has-text("Save and continue")',
    'button:has-text("Continue")',
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Done")',
    '[data-testid*="next" i]',
  ]) {
    try {
      const el = page.locator(s).first();
      await el.waitFor({ state: 'visible', timeout: 8000 });
      await el.scrollIntoViewIfNeeded();
      await hd(500, 900);
      await el.click();
      console.log(`   ✅ Clicked Next: [${s}]`);
      return true;
    } catch {}
  }
  console.log('   ⚠  Next button not found');
  return false;
}

async function fillBusinessForm(page, biz) {
  console.log('\n[STAGE 2] Filling business form...');

  // Dump inputs
  const inputs = await page.evaluate(() =>
    [...document.querySelectorAll('input,select,textarea')].filter(e => e.offsetWidth).map(e => ({
      type: e.type, id: e.id, name: e.name, ph: e.placeholder, val: e.value
    }))
  ).catch(() => []);
  console.log('   Visible inputs:', JSON.stringify(inputs));

  // Website
  for (const s of ['input[placeholder*="https://" i]','input[placeholder*="website" i]','input[type="url"]','input[id*="website" i]','input[name*="url" i]']) {
    try {
      const el = page.locator(s).first();
      if (await el.isVisible({ timeout: 4000 })) {
        await el.click(); await hd(200,400);
        await el.fill(''); await hd(100,200);
        await el.type(biz.website, { delay: 60 });
        console.log(`   ✅ Website: ${biz.website}`);
        break;
      }
    } catch {}
  }
  await hd(800, 1200);
  await waitForWebsiteScrapeDone(page);
  await hd(600, 1200);

  // Is this a single page or page 1 of 2?
  const hasBizName = await page.locator([
    'input[placeholder*="business name" i]',
    'input[id*="business" i]',
    'input[name*="business" i]',
  ].join(',')).first().isVisible({ timeout: 3000 }).catch(() => false);

  if (!hasBizName) {
    console.log('   → Page 1 only (website). Clicking Next...');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await hd(600, 1000);
    await clickNextButton(page);
    await hd(3000, 5000);
    try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}
    await hd(1000, 2000);
  }

  // Business Name
  const bizNameFilled = await page.evaluate((name) => {
    for (const inp of document.querySelectorAll('input')) {
      const ph = (inp.placeholder||'').toLowerCase();
      const id = (inp.id||'').toLowerCase();
      const nm = (inp.name||'').toLowerCase();
      if ((ph.includes('business') || ph.includes('company') || id.includes('business') || nm.includes('business')) && (inp.offsetWidth||inp.offsetHeight)) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
        if (setter) { setter.call(inp,name); inp.dispatchEvent(new Event('input',{bubbles:true})); inp.dispatchEvent(new Event('change',{bubbles:true})); }
        else { inp.value = name; inp.dispatchEvent(new Event('input',{bubbles:true})); }
        return `id="${inp.id}" ph="${inp.placeholder}"`;
      }
    }
    return null;
  }, biz.businessName);
  if (bizNameFilled) {
    console.log(`   ✅ Business name (JS): ${bizNameFilled}`);
    try {
      const el = page.locator(['input[placeholder*="business name" i]','input[id*="business" i]'].join(',')).first();
      await el.click({ timeout: 3000 }); await hd(100,200); await el.fill(biz.businessName);
    } catch {}
  }
  await hd(600, 1000);

  // Country — Netherlands
  try {
    for (const s of ['select[id*="location" i]','select[id*="country" i]','select[name*="location" i]','select[name*="country" i]']) {
      try {
        if (await page.locator(s).first().isVisible({ timeout: 2000 })) {
          await page.locator(s).first().selectOption({ label: 'Netherlands' });
          console.log('   ✅ Country → Netherlands');
          break;
        }
      } catch {}
    }
  } catch {}
  await hd(400, 800);

  // Phone
  const phoneFilled = await page.evaluate((phone) => {
    for (const inp of document.querySelectorAll('input')) {
      const tp = (inp.type||'').toLowerCase();
      const ph = (inp.placeholder||'').toLowerCase();
      const id = (inp.id||'').toLowerCase();
      if ((tp==='tel'||ph.includes('phone')||id.includes('phone')) && (inp.offsetWidth||inp.offsetHeight)) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
        if (setter) { setter.call(inp,phone); inp.dispatchEvent(new Event('input',{bubbles:true})); inp.dispatchEvent(new Event('change',{bubbles:true})); }
        return `id="${inp.id}" type="${inp.type}"`;
      }
    }
    return null;
  }, biz.phone);
  if (phoneFilled) {
    console.log(`   ✅ Phone (JS): ${phoneFilled}`);
    try {
      const el = page.locator(['input[type="tel"]','input[placeholder*="phone" i]'].join(',')).first();
      await el.click({ timeout: 2000 }); await hd(100,200); await el.fill(biz.phone);
    } catch {}
  }
  await hd(600, 1000);

  // Email field on form
  try {
    const emailEls = page.locator('input[type="email"]');
    const cnt = await emailEls.count();
    for (let i = 0; i < cnt; i++) {
      const el = emailEls.nth(i);
      if (!(await el.inputValue().catch(()=>''))) { await el.fill(biz.email); console.log(`   ✅ Form email: ${biz.email}`); break; }
    }
  } catch {}
  await hd(500, 800);

  // Checkboxes
  try {
    const boxes = page.locator('input[type="checkbox"]');
    const cnt = await boxes.count();
    for (let i = 0; i < cnt; i++) {
      try { if (!(await boxes.nth(i).isChecked())) { await hd(200,400); await boxes.nth(i).click(); } } catch {}
    }
    if (cnt) console.log(`   ✅ Checked ${cnt} checkbox(es)`);
  } catch {}
  await hd(800, 1200);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await hd(600, 900);
  await clickNextButton(page);
  await hd(3000, 5000);
}

async function fillAccountDetailsForm(page, biz) {
  console.log('\n[STAGE 2] Filling Account Details form...');

  const filled = await page.evaluate((d) => {
    const results = [];
    function setVal(el, v) {
      if (!el || !v) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
      if (setter) { setter.call(el,v); } else { el.value = v; }
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      return true;
    }
    const inputs = [...document.querySelectorAll('input,select')];
    const byId  = (id) => document.getElementById(id);

    // Address line 1
    const a1 = byId('address-formLine1') || inputs.find(i=>/address.?line.?1|address1/i.test(i.placeholder+i.id+i.name));
    if (setVal(a1, d.address1)) results.push(`address1: ${d.address1}`);
    // Address line 2
    if (d.address2) {
      const a2 = byId('address-formLine2') || inputs.find(i=>/address.?line.?2|address2/i.test(i.placeholder+i.id+i.name));
      if (setVal(a2, d.address2)) results.push(`address2: ${d.address2}`);
    }
    // City
    const ci = byId('address-formCity') || inputs.find(i=>/city/i.test(i.placeholder+i.id+i.name));
    if (setVal(ci, d.city)) results.push(`city: ${d.city}`);
    // ZIP
    const zi = byId('address-formPostalCode') || inputs.find(i=>/zip|postal/i.test(i.placeholder+i.id+i.name));
    if (setVal(zi, d.zip)) results.push(`zip: ${d.zip}`);
    // State
    const stEl = byId('address-formStateOrProvince') || [...document.querySelectorAll('select')].find(s=>/state|province/i.test(s.id+s.name));
    if (stEl) {
      const opts = [...stEl.options];
      const m = opts.find(o=>o.text.toLowerCase().includes(d.state.toLowerCase())||d.state.toLowerCase().includes(o.text.toLowerCase()));
      if (m) { stEl.value = m.value; stEl.dispatchEvent(new Event('change',{bubbles:true})); results.push(`state: ${m.text}`); }
      else {
        const nh = opts.find(o=>o.value==='NH'||o.text.includes('North Holland'));
        if (nh) { stEl.value = nh.value; stEl.dispatchEvent(new Event('change',{bubbles:true})); results.push('state: NH fallback'); }
      }
    }
    return results;
  }, { address1: biz.address1||'', address2: biz.address2||'', city: biz.city||'', state: biz.state||'North Holland', zip: biz.zip||'' });

  if (filled?.length) console.log(`   ✅ Filled: ${filled.join(' | ')}`);
  else console.log('   ⚠  JS fill returned nothing');

  // Playwright fallback
  await hd(400, 700);
  const fm = [
    { s: 'input[placeholder*="Address line 1" i]', v: biz.address1 },
    { s: 'input[placeholder*="City" i]',           v: biz.city },
    { s: 'input[placeholder*="ZIP" i]',            v: biz.zip },
    { s: 'input[placeholder*="postal" i]',         v: biz.zip },
  ];
  for (const { s, v } of fm) {
    if (!v) continue;
    try {
      const el = page.locator(s).first();
      if (await el.isVisible({ timeout: 2000 }) && !(await el.inputValue().catch(()=>''))) {
        await el.click(); await hd(100,200); await el.fill(v);
        console.log(`   ✅ PW filled: ${s}`);
      }
    } catch {}
  }
  await hd(700, 1200);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await hd(600, 900);
  await clickNextButton(page);
  await hd(4000, 6000);
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

(async () => {
  ensureDirs();

  const emails   = readJson(EMAILS_FILE, []);
  const bizList  = readJson(BUSINESS_FILE, []);
  const db       = readJson(INDEX_FILE, {});

  const resumeIdx = process.argv.indexOf('--resume');
  const resumeArg = resumeIdx >= 0 ? (process.argv[resumeIdx + 1] || '').trim().toLowerCase() : '';
  let skipStage1       = false;
  let resumeSessionAbs = null;

  let account;
  if (resumeArg) {
    account = emails.find(e => e.email.toLowerCase() === resumeArg);
    if (!account) {
      console.log(`❌ --resume: ${resumeArg} not found in emails.json`);
      process.exit(1);
    }
    const sp = db[account.email]?.session;
    if (sp && fs.existsSync(sp)) {
      resumeSessionAbs = path.isAbsolute(sp) ? sp : path.join(ROOT, sp);
    }
    if (!resumeSessionAbs || !fs.existsSync(resumeSessionAbs)) {
      console.log('❌ --resume: no valid session file in account_index for this email');
      process.exit(1);
    }
    skipStage1 = true;
    console.log(`\n🔁 Resume mode: ${account.email}`);
    console.log(`   Session: ${resumeSessionAbs}\n`);
  } else {
    // Prefer never-touched index row; else any unused not already succeeded
    account = emails.find(e => !e.used && db[e.email] === undefined);
    if (!account) {
      account = emails.find(e => !e.used && !['success', 'already_used', 'manual_complete'].includes(db[e.email]?.status));
    }
    if (!account) {
      console.log('❌ No unused accounts available in emails.json');
      process.exit(0);
    }
  }

  // Rambler — on resume prefer the same secondary as last run (for OTP)
  let rambler;
  if (skipStage1 && db[account.email]?.secondary_email) {
    const sec = db[account.email].secondary_email;
    rambler = loadRamblerAccounts().find(a => a.email.toLowerCase() === sec.toLowerCase()) || pickRambler();
  } else {
    rambler = pickRambler();
  }

  // Pick business data (round-robin by account position)
  const accIdx = emails.indexOf(account);
  const usedBizEmails = new Set(Object.values(db).filter(v => v.status === 'success').map(v => v.biz_email));
  const biz = bizList.filter(b => !usedBizEmails.has(b.email))[accIdx % bizList.length] || bizList[accIdx % bizList.length];

  // Proxy
  const proxyStr = pickProxy(account.email);
  const proxy    = parseProxy(proxyStr);

  // Dry run
  if (process.argv.includes('--dry')) {
    console.log('\n── DRY RUN ──────────────────────────────────');
    console.log(`Account  : ${account.email}`);
    console.log(`Resume   : ${skipStage1 ? `yes → ${resumeSessionAbs}` : 'no'}`);
    console.log(`Rambler  : ${rambler.email}`);
    console.log(`Business : ${biz.businessName} / ${biz.website}`);
    console.log(`Proxy    : ${proxyStr}`);
    console.log('─────────────────────────────────────────────\n');
    process.exit(0);
  }

  console.log('\n╔═══════════════════════════════════════════════╗');
  console.log('║     Microsoft Ads — Full Account Creator       ║');
  console.log('╚═══════════════════════════════════════════════╝');
  console.log(`\n  🎯 Account  : ${account.email}`);
  console.log(`  📮 Rambler  : ${rambler.email}`);
  console.log(`  🏢 Business : ${biz.businessName}`);
  console.log(`  🌐 Proxy    : ${proxyStr.split(':').slice(0,2).join(':')}\n`);

  appendRunLog({
    event: 'run_start',
    primary: account.email,
    rambler: rambler.email,
    proxy: proxyStr,
    business_name: biz.businessName,
    business_site: biz.website,
    note: 'Resources reserved for this run; Rambler also blocked for other in_progress rows.',
  });

  updateIndex(account.email, {
    status: 'in_progress',
    proxy: proxyStr,
    started_at: ts(),
    reserved_rambler: rambler.email,
  });

  let browser;
  try {
    browser = await chromium.launch({
      headless: false,
      slowMo: 60,
      args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
      proxy,
    });

    const ctx  = await browser.newContext({
      ...(skipStage1 && resumeSessionAbs ? { storageState: resumeSessionAbs } : {}),
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: null,
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });
    const page = await ctx.newPage();

    const saveSession = async (label) => {
      const t  = ts().replace(/[:.]/g,'-');
      const sp = path.join(SESSIONS_DIR, `${safeStr(account.email)}_${label}_${t}.json`);
      await ctx.storageState({ path: sp });
      console.log(`   💾 Session saved: ${path.basename(sp)}`);
      return sp;
    };

    // ────────────────────────────────────────────────────────────
    // STAGE 1 — LOGIN
    // ────────────────────────────────────────────────────────────
    if (skipStage1) {
      console.log('\n━━━━━━━━━━━━━━ STAGE 1: SKIPPED (resume) ━━━━━━━━━━━━━━');
    } else {
    console.log('\n━━━━━━━━━━━━━━ STAGE 1: LOGIN ━━━━━━━━━━━━━━');

    // Loop through all login screens in sequence
    console.log('[1] Navigating to Microsoft Ads signup...');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await page.goto(MS_ADS_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
        break;
      } catch (e) {
        if (attempt === 2) throw e;
        console.log(`   ⚠  Nav timeout (attempt ${attempt+1}) — retrying...`);
        await hd(8000, 12000);
      }
    }
    try { await page.waitForLoadState('networkidle', { timeout: 20000 }); } catch {}
    await hd(2000, 4000);

    const otpStartedRef = { t: null };
    let loginDone  = false;

    for (let step = 0; step < 28 && !loginDone; step++) {
      const curUrl   = page.url();
      const curTitle = await page.title().catch(() => '');
      const curBody  = await page.evaluate(() => document.body.innerText.replace(/\s+/g,' ').slice(0,500)).catch(()=>'');
      const curHost  = pageHost(curUrl);
      console.log(`\n   [login step ${step+1}] ${curUrl.slice(0,70)}`);
      await shot(page, account.email, `login_step${step+1}`);

      if (await handleAccountLiveSecurity(page, account, rambler, otpStartedRef)) {
        continue;
      }

      // ── Already reached Ads dashboard or signup form ──────────
      if (curUrl.includes('ads.microsoft.com') && !curUrl.includes('/Login')) {
        console.log('   ✅ Reached Ads — login complete');
        loginDone = true; break;
      }

      // ── "Sign in to Microsoft Advertising" page ───────────────
      if (curBody.toLowerCase().includes('sign in to microsoft advertising') ||
          curBody.toLowerCase().includes('continue with microsoft')) {
        console.log('   → Clicking "Continue with Microsoft"...');
        await tryClick(page, ['a:has-text("Continue with Microsoft")','button:has-text("Continue with Microsoft")','a:has-text("Sign in with Microsoft")','button:has-text("Sign in")']);
        await hd(3000, 5000);
        continue;
      }

      // ── Email field — only real MS login hosts (not account.live proofs)
      const emailVis = MS_EMAIL_HOSTS.has(curHost) && await page.evaluate(() => {
        const inputs = [...document.querySelectorAll('input[name="loginfmt"],input[type="email"],#i0116')];
        return inputs.some(i => i && i.offsetWidth > 0 && i.offsetHeight > 0 && i.getAttribute('aria-hidden') !== 'true');
      }).catch(() => false);
      if (emailVis) {
        console.log('   → Entering email (visible field)...');
        await fillVisibleEmail(page, account.email, true);
        await hd(500, 1000);
        await tryClick(page, ['#idSIButton9','input[type="submit"]','button:has-text("Next")']);
        await hd(2000, 4000);
        continue;
      }

      // ── Password field (visible only) ─────────────────────────
      const s1PwdVisible = await page.evaluate(() => {
        const inputs = [...document.querySelectorAll('input[type="password"]')];
        return inputs.some(i => i.offsetWidth > 0 && i.offsetHeight > 0 && !i.classList.contains('moveOffScreen') && i.getAttribute('aria-hidden') !== 'true');
      }).catch(()=>false);
      if (s1PwdVisible) {
        console.log('   → Entering password...');
        await fillVisiblePassword(page, account.password);
        await hd(500, 1000);
        await tryClick(page, ['#idSIButton9','input[type="submit"]','button:has-text("Sign in")','button:has-text("Next")']);
        await hd(3000, 5000);
        continue;
      }

      // ── "Enter your code" / 6-box OTP (after Send code) ─────────
      const onCodePage = /enter your code/i.test(curTitle) ||
        (/enter.*code/i.test(curBody) && await page.locator('input[maxlength="1"]').first().isVisible({ timeout: 1500 }).catch(() => false));
      if (onCodePage) {
        console.log(`   → OTP page — IMAP ${rambler.email}...`);
        const sinceMs = otpStartedRef.t ? otpStartedRef.t - 90 * 1000 : Date.now() - 8 * 60 * 1000;
        const otp = await waitForOtp(rambler.email, rambler.password, sinceMs, 4 * 60 * 1000);
        console.log(`   ✅ OTP: ${otp}`);
        await fillOtpIntoPage(page, otp);
        await hd(800, 1500);
        try { await clickJsSubmitOrSendCode(page); } catch {}
        await hd(4000, 7000);
        continue;
      }

      // ── "Verify your email" — must type FULL recovery email, then Send code ──
      if (/verify your email/i.test(curBody) && /enter it here/i.test(curBody)) {
        console.log(`   → Confirm recovery email — typing ${rambler.email} + Send code...`);
        await page.evaluate((email) => {
          const inputs = [...document.querySelectorAll('input[type="email"], input[type="text"]')];
          const v = inputs.find(i => i.offsetWidth > 0 && i.offsetHeight > 0 && i.getAttribute('maxlength') !== '1');
          if (!v) return;
          v.focus();
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          if (setter) setter.call(v, email); else v.value = email;
          v.dispatchEvent(new Event('input', { bubbles: true }));
          v.dispatchEvent(new Event('change', { bubbles: true }));
        }, rambler.email);
        await hd(600, 1200);
        await clickJsSubmitOrSendCode(page);
        otpStartedRef.t = Date.now();
        await hd(5000, 8000);
        continue;
      }

      // ── Secondary / protect account (not the "enter it here" confirm screen) ──
      if ((curBody.includes("We'll send") || curBody.includes('send a code') ||
          curBody.includes('Add security') || curBody.includes('protect your account') ||
          curBody.includes('recovery email')) && !/enter it here/i.test(curBody)) {
        console.log(`   → Secondary / security email — ${rambler.email}...`);
        await page.evaluate((email) => {
          const inputs = [...document.querySelectorAll('input[type="email"], input[type="text"]')];
          const v = inputs.find(i => i.offsetWidth > 0 && i.offsetHeight > 0 && i.getAttribute('maxlength') !== '1');
          if (!v) return;
          v.focus();
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          if (setter) setter.call(v, email); else v.value = email;
          v.dispatchEvent(new Event('input', { bubbles: true }));
          v.dispatchEvent(new Event('change', { bubbles: true }));
        }, rambler.email);
        await hd(800, 1500);
        await tryClick(page, ['input[type="submit"]','button:has-text("Send code")','button:has-text("Next")','#idSIButton9']);
        otpStartedRef.t = Date.now();
        await hd(5000, 8000);
        continue;
      }

      // ── Single-field OTP (name=otc etc.) ──────────────────────
      if (curBody.includes('verification code') || curBody.includes('security code') ||
          curBody.includes('Check your email') ||
          await page.locator('input[name="otc"],input[aria-label*="code" i]').first().isVisible({ timeout: 2000 }).catch(()=>false)) {
        console.log(`   → Waiting for OTP at ${rambler.email}...`);
        const sinceMs = otpStartedRef.t ? otpStartedRef.t - 90 * 1000 : Date.now() - 8 * 60 * 1000;
        const otp = await waitForOtp(rambler.email, rambler.password, sinceMs, 4 * 60 * 1000);
        console.log(`   ✅ OTP: ${otp}`);
        await fillOtpIntoPage(page, otp);
        await hd(700, 1300);
        try { await clickJsSubmitOrSendCode(page); } catch {}
        await tryClick(page, ['input[type="submit"]','button:has-text("Verify")','button:has-text("Next")','#idSIButton9']);
        await hd(3000, 5000);
        continue;
      }

      // ── "Stay signed in?" — only if text matches (avoid false #idSIButton9) ──
      if (curBody.includes('Stay signed in') || curBody.includes('stay signed in')) {
        console.log('   → Clicking "Yes" on Stay signed in...');
        await tryClick(page, ['#idSIButton9','button:has-text("Yes")']);
        await hd(3000, 5000);
        continue;
      }

      // ── Account picker (not account.live — handled by handleAccountLiveSecurity)
      if (MS_EMAIL_HOSTS.has(curHost)) {
        console.log('   → Account picker...');
        try {
          const si = page.locator('text=Signed in').first();
          if (await si.isVisible({ timeout: 2500 })) {
            await si.click();
            console.log('   ✅ Clicked "Signed in" tile');
            await hd(3000, 5000);
            continue;
          }
        } catch {}
        const r = await page.evaluate((em) => {
          for (const el of document.querySelectorAll('[role="button"],[tabindex="0"],div,li,a')) {
            const t = (el.innerText||'').toLowerCase();
            if ((t.includes('signed in') || t.includes(em.split('@')[0].toLowerCase())) && el.offsetParent) {
              el.click(); return t.slice(0,50);
            }
          }
          return null;
        }, account.email);
        console.log(`   Tile: ${r}`);
        await hd(3000, 5000);
        continue;
      }

      console.log('   ⏳ Waiting for next screen...');
      await hd(3000, 5000);
    }

    await shot(page, account.email, '04_login_done');
    await hd(2000, 4000);

    const sessionFile = await saveSession('post_login');
    updateIndex(account.email, {
      secondary_email: rambler.email,
      proxy: proxyStr,
      session: sessionFile,
      login_time: ts(),
    });
    } // end Stage 1 (not resume)

    if (skipStage1) {
      updateIndex(account.email, {
        status: 'in_progress',
        secondary_email: rambler.email,
        proxy: proxyStr,
        session: resumeSessionAbs,
        resumed_at: ts(),
        reserved_rambler: rambler.email,
      });
    }

    // ────────────────────────────────────────────────────────────
    // STAGE 2 — ADS SETUP
    // ────────────────────────────────────────────────────────────
    console.log('\n━━━━━━━━━━━━━━ STAGE 2: ADS SETUP ━━━━━━━━━━━━━━');

    console.log('[S2-1] Navigating to Microsoft Ads signup...');
    // Go directly to the PMax signup URL — triggers the full account creation flow
    const ADS_SIGNUP_URL = 'https://ads.microsoft.com/PMaxLite/Signup/?idP=MSA&s_cid=acq-pmaxlanding-src_default';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await page.goto(ADS_SIGNUP_URL, { waitUntil: 'domcontentloaded', timeout: 40000 });
        break;
      } catch (e) {
        if (attempt === 2) throw e;
        console.log(`   ⚠  Nav failed (attempt ${attempt+1}): ${e.message} — retrying...`);
        await hd(8000, 12000);
      }
    }
    try { await page.waitForLoadState('networkidle', { timeout: 20000 }); } catch {}
    await hd(3000, 5000);
    await shot(page, account.email, '05_ads_landing');
    console.log(`   URL: ${page.url()}`);
    await waitForAdsDom(page);

    // ── Navigate through sign-in on ads.microsoft.com ───────────
    // Loop up to 10 times handling each screen in turn
    console.log('[S2-2] Handling ads.microsoft.com sign-in flow...');
    const s2OtpState = { t: null };
    for (let attempt = 0; attempt < 18; attempt++) {
      await hd(2000, 3500);
      const curUrl  = page.url();
      const curBody = await page.evaluate(() => document.body.innerText.replace(/\s+/g,' ').slice(0,400)).catch(()=>'');
      const curHost = pageHost(curUrl);
      console.log(`   [${attempt+1}] ${curHost} | ${curUrl.slice(0,75)}`);

      if (await handleAccountLiveSecurity(page, account, rambler, s2OtpState)) {
        continue;
      }

      // Ads: "username already exists" → new Advertising account under same MSA
      if (curUrl.includes('ads.microsoft.com') && /username already exists/i.test(curBody)) {
        console.log('   → Choosing "Sign up for a new Microsoft Advertising account"...');
        await tryClick(page, [
          'a:has-text("Sign up for a new Microsoft Advertising account")',
          'button:has-text("Sign up for a new Microsoft Advertising account")',
        ]);
        await hd(4000, 7000);
        continue;
      }

      // Already inside the signed-in Ads dashboard / signup (not public marketing)
      if (curUrl.includes('ads.microsoft.com') && !curUrl.includes('login') &&
          !curBody.toLowerCase().includes('create your account') && !curBody.toLowerCase().includes('sign in to') &&
          !/username already exists/i.test(curBody)) {
        console.log('   ✅ Signed into Ads — continuing setup');
        break;
      }

      // Public homepage with "Sign in" button
      if (curBody.toLowerCase().includes('create your account') || curBody.toLowerCase().includes('grow your business')) {
        console.log('   → Public homepage — clicking "Sign in"...');
        await tryClick(page, ['a:has-text("Sign in")','button:has-text("Sign in")']);
        await hd(2000, 4000);
        continue;
      }

      // "Sign in to Microsoft Advertising" / "Continue with Microsoft" page
      if (curBody.toLowerCase().includes('continue with microsoft') || curBody.toLowerCase().includes('sign in with microsoft')) {
        console.log('   → Clicking "Continue with Microsoft"...');
        await tryClick(page, [
          'a:has-text("Continue with Microsoft")',
          'button:has-text("Continue with Microsoft")',
          'a:has-text("Sign in with Microsoft")',
        ]);
        await hd(3000, 5000);
        continue;
      }

      // Email field — ONLY real MS login hosts (full URL can mention microsoftonline in query params)
      const s2EmailOk = MS_EMAIL_HOSTS.has(curHost) &&
        await fillVisibleEmail(page, account.email, true).catch(() => false);
      if (s2EmailOk) {
        console.log('   → Email prompt — filled');
        await hd(500, 1000);
        await tryClick(page, ['#idSIButton9','input[type="submit"]','button:has-text("Next")']);
        await hd(2000, 4000);
        continue;
      }

      // Password field (visible only — never use hidden #i0118)
      const pwdVisible = await page.evaluate(() => {
        const inputs = [...document.querySelectorAll('input[type="password"]')];
        return inputs.some(i => i.offsetWidth > 0 && i.offsetHeight > 0 && !i.classList.contains('moveOffScreen') && i.getAttribute('aria-hidden') !== 'true');
      }).catch(()=>false);
      if (pwdVisible) {
        console.log('   → Password prompt — entering password...');
        await fillVisiblePassword(page, account.password);
        await hd(500, 1000);
        await tryClick(page, ['#idSIButton9','input[type="submit"]','button:has-text("Sign in")','button:has-text("Next")']);
        await hd(3000, 5000);
        continue;
      }

      // "Stay signed in?" — require copy on page (avoid wrong #idSIButton9)
      if (curBody.includes('Stay signed in') || curBody.includes('stay signed in')) {
        await tryClick(page, ['#idSIButton9','button:has-text("Yes")']);
        console.log('   ✅ Stay signed in');
        await hd(3000, 5000);
        continue;
      }

      // Microsoft account picker — not account.live.com (handled above)
      if (MS_EMAIL_HOSTS.has(curHost)) {
        console.log('   → Account picker — clicking our tile...');
        try {
          const si = page.locator('text=Signed in').first();
          if (await si.isVisible({ timeout: 2500 })) {
            await si.click();
            console.log('   ✅ Clicked "Signed in"');
            await hd(3000, 5000);
            continue;
          }
        } catch {}
        const clicked = await page.evaluate((em) => {
          const all = [...document.querySelectorAll('[role="button"],[tabindex="0"],div,li,a')];
          for (const el of all) {
            const txt = (el.innerText||'').toLowerCase();
            if ((txt.includes('signed in') || txt.includes(em.split('@')[0].toLowerCase())) && el.offsetParent) {
              el.click(); return el.innerText.trim().slice(0,60);
            }
          }
          return 'no_tile_found';
        }, account.email);
        console.log(`   Tile: ${clicked}`);
        await hd(2000, 4000);
        continue;
      }

      // Signup flow already started (business form etc.) — break out
      if (curUrl.includes('ads.microsoft.com')) {
        console.log('   ✅ On ads.microsoft.com — proceeding');
        break;
      }

      console.log('   ⏳ Waiting for page to settle...');
    }

    await shot(page, account.email, '06_after_signin_flow');
    try { await page.waitForLoadState('networkidle', { timeout: 20000 }); } catch {}
    await hd(2000, 4000);
    console.log(`   URL: ${page.url()}`);
    await shot(page, account.email, '07_ads_signed_in');
    await saveSession('post_ads_signin');

    // ── Business form ────────────────────────────────────────────
    console.log('[S2-3] Waiting for business form...');
    const bizFormVisible = await page.locator([
      'text=Tell us about your business',
      'text=your business',
      'input[placeholder*="https://" i]',
      'input[placeholder*="website" i]',
    ].join(',')).first().isVisible({ timeout: 60000 }).catch(() => false);

    if (bizFormVisible) {
      await shot(page, account.email, '08_biz_form');
      await fillBusinessForm(page, biz);
      await shot(page, account.email, '08_biz_form_done');
      await saveSession('post_biz_form');
    } else {
      console.log('   ⚠  Business form not visible — skipping');
      await shot(page, account.email, '08_biz_form_missing');
    }

    try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}
    await hd(2000, 4000);
    console.log(`   URL: ${page.url()}`);

    // ── "How can we help you" → Create account ───────────────────
    console.log('[S2-4] Checking for "How can we help you" screen...');
    const howHelp = await page.locator(['text=How can we help you','text=What brings you to Microsoft Advertising','text=Create account'].join(',')).first().isVisible({ timeout: 20000 }).catch(()=>false);
    if (howHelp) {
      console.log('   → Clicking "Create account"...');
      const r = await page.evaluate(() => {
        for (const el of document.querySelectorAll('button,a,[role="button"]')) {
          if (/create\s+account/i.test((el.innerText||'').trim()) && el.offsetParent) { el.click(); return el.innerText.trim(); }
        }
        return null;
      });
      console.log(`   ✅ Create account clicked: ${r}`);
      await hd(3000, 5000);
      await shot(page, account.email, '09_after_create_account');
    }

    // ── "Create account only" card ───────────────────────────────
    console.log('[S2-5] Selecting "Create account only"...');
    await hd(2000, 3000);
    const cardResult = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (/create account only/i.test(node.textContent)) {
          let el = node.parentElement;
          while (el && el !== document.body) {
            if (el.tagName==='LABEL'||el.getAttribute('role')==='radio'||el.getAttribute('role')==='button'||
                el.getAttribute('tabindex')==='0'||window.getComputedStyle(el).cursor==='pointer') {
              el.click(); return `card: "${el.textContent.trim().slice(0,60)}"`;
            }
            el = el.parentElement;
          }
          node.parentElement.click(); return `parent: "${node.parentElement.textContent.trim().slice(0,40)}"`;
        }
      }
      return null;
    });
    if (cardResult) {
      console.log(`   ✅ ${cardResult}`);
      await hd(1500, 2500);
      await shot(page, account.email, '10_create_account_only');
      await clickNextButton(page);
      await hd(4000, 6000);
      try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}
      await shot(page, account.email, '10_after_next');
    } else {
      console.log('   ⚠  "Create account only" card not found');
    }

    // ── Account Details form ─────────────────────────────────────
    console.log('[S2-6] Checking for Account Details form...');
    await hd(2000, 3000);
    const acctDetails = await page.locator(['text=Account details','text=Address line 1','text=Legal business name'].join(',')).first().isVisible({ timeout: 15000 }).catch(()=>false);
    if (acctDetails) {
      await shot(page, account.email, '11_account_details');
      await fillAccountDetailsForm(page, biz);
      await shot(page, account.email, '11_account_details_done');
      await saveSession('post_acct_details');
      try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}
      await hd(2000, 4000);
    } else {
      console.log('   ⚠  Account Details form not found — skipping');
    }
    console.log(`   URL: ${page.url()}`);

    // ── Payment page ─────────────────────────────────────────────
    console.log('[S2-7] Checking for Payment page...');
    await hd(2000, 3000);
    const paymentPage = await page.locator(['text=How would you like to pay','text=Set up payment later','text=Enter your payment method'].join(',')).first().isVisible({ timeout: 20000 }).catch(()=>false);
    if (paymentPage) {
      await shot(page, account.email, '12_payment_page');
      console.log('   → Clicking "Set up payment later"...');

      let payLater = false;
      for (const s of ['text=Set up payment later','a:has-text("Set up payment later")','button:has-text("Set up payment later")']) {
        try {
          const el = page.locator(s).first();
          await el.waitFor({ state:'visible', timeout:8000 });
          await el.scrollIntoViewIfNeeded();
          await hd(600,1000); await el.click();
          console.log(`   ✅ "Set up payment later" clicked`);
          payLater = true; break;
        } catch {}
      }
      if (!payLater) {
        await page.evaluate(() => {
          for (const el of document.querySelectorAll('a,button,[role="button"]')) {
            if (/set\s+up\s+payment\s+later/i.test(el.innerText||'') && el.offsetParent) { el.click(); return; }
          }
        });
        payLater = true;
      }

      await hd(2000, 3000);
      await shot(page, account.email, '12_payment_dialog');

      // Click "Yes"
      let yesOk = false;
      for (const s of ['button:has-text("Yes")','input[value="Yes"]']) {
        try {
          const el = page.locator(s).first();
          await el.waitFor({ state:'visible', timeout:8000 });
          await hd(500,800); await el.click();
          console.log('   ✅ "Yes" clicked');
          yesOk = true; break;
        } catch {}
      }
      if (!yesOk) await page.evaluate(() => { for (const e of document.querySelectorAll('button')) { if (/^yes$/i.test((e.innerText||'').trim())) { e.click(); return; } } });

      // Wait for dialog to close
      try { await page.locator('button:has-text("Yes")').waitFor({ state:'hidden', timeout:8000 }); } catch {}
      await hd(3000, 5000);
      await shot(page, account.email, '12_after_yes');

      // Click "Create Campaign"
      console.log('   → Clicking "Create Campaign"...');
      let createOk = false;
      for (const s of ['button:has-text("Create Campaign")','button:has-text("Create campaign")','a:has-text("Create Campaign")']) {
        try {
          const el = page.locator(s).first();
          await el.waitFor({ state:'visible', timeout:10000 });
          await el.scrollIntoViewIfNeeded(); await hd(800,1200); await el.click();
          console.log('   ✅ "Create Campaign" clicked');
          createOk = true; break;
        } catch {}
      }
      if (!createOk) {
        await page.evaluate(() => {
          for (const el of document.querySelectorAll('button,a,[role="button"]')) {
            if (/create\s+campaign/i.test((el.innerText||'').trim()) && el.offsetParent) { el.scrollIntoView(); el.click(); return; }
          }
        });
        createOk = true;
      }

      await hd(6000, 10000);
      try { await page.waitForLoadState('networkidle', { timeout: 20000 }); } catch {}
      await shot(page, account.email, '12_after_create_campaign');
    } else {
      console.log('   ⚠  Payment page not detected — skipping');
    }

    // ────────────────────────────────────────────────────────────
    // FINAL SAVE
    // ────────────────────────────────────────────────────────────
    const finalUrl   = page.url();
    const finalTitle = await page.title().catch(()=>'');
    const finalSess  = await saveSession('FINAL');
    const finalHost  = pageHost(finalUrl);
    const onAdsApp =
      finalHost === 'ads.microsoft.com' &&
      !/\/Login\b/i.test(finalUrl) &&
      !/login\.microsoftonline/i.test(finalUrl);
    const stuckSecurity =
      finalHost === 'account.live.com' ||
      finalHost === 'login.live.com' ||
      finalHost === 'login.microsoftonline.com';

    console.log('\n━━━━━━━━━━━━━━ RESULT ━━━━━━━━━━━━━━');
    console.log(`   URL  : ${finalUrl}`);
    console.log(`   Title: ${finalTitle}`);

    if (!onAdsApp || stuckSecurity) {
      const msg = 'Flow finished outside Microsoft Ads (login or account.live security still open).';
      console.log(`\n⚠  INCOMPLETE: ${msg}`);
      console.log('   Fix the open browser tab if needed, then re-run with:');
      console.log(`   node full_flow.js --resume ${account.email}\n`);
      updateIndex(account.email, {
        status: 'failed',
        error: msg,
        secondary_email: rambler.email,
        proxy: proxyStr,
        session: finalSess,
        final_url: finalUrl,
        failed_at: ts(),
        reserved_rambler: null,
      });
      appendRunLog({
        event: 'run_incomplete',
        primary: account.email,
        rambler: rambler.email,
        proxy: proxyStr,
        final_url: finalUrl,
        note: msg,
      });
    } else {
      account.used = true;
      writeJson(EMAILS_FILE, emails);
      updateIndex(account.email, {
        status: 'success',
        restore_status: 'success',
        biz_email: biz.email,
        biz_name: biz.businessName,
        secondary_email: rambler.email,
        reserved_rambler: null,
        proxy: proxyStr,
        session: finalSess,
        final_url: finalUrl,
        completed_at: ts(),
      });

      console.log(`\n🎉 SUCCESS: ${account.email} — account fully created!\n`);
      appendRunLog({
        event: 'run_success',
        primary: account.email,
        rambler: rambler.email,
        proxy: proxyStr,
        business_name: biz.businessName,
        final_url: finalUrl,
        note: 'Primary marked used=true; Rambler stored as secondary_email — not reused for new successes.',
      });
    }
    console.log('💡 Browser staying open — close when done.\n');
    await new Promise(r => browser.on('disconnected', r));

  } catch (err) {
    console.error(`\n✗ FAILED: ${err.message}`);
    appendRunLog({
      event: 'run_failed',
      primary: account.email,
      rambler: rambler.email,
      error: err.message,
      note: 'Fix issue and re-run; reserved_rambler cleared so same Rambler can be picked again.',
    });
    if (err.stack) console.error(err.stack.split('\n').slice(0,5).join('\n'));
    try {
      const t  = ts().replace(/[:.]/g,'-');
      const sp = path.join(SESSIONS_DIR, `${safeStr(account.email)}_error_${t}.json`);
      const ctx2 = browser?.contexts()[0];
      if (ctx2) { await ctx2.storageState({ path: sp }); console.log(`   Error session saved: ${path.basename(sp)}`); }
    } catch {}
    updateIndex(account.email, { status: 'failed', error: err.message, failed_at: ts(), reserved_rambler: null });
    if (browser) await browser.close();
    process.exit(1);
  }
})();
