'use strict';

/**
 * version11.js  —  Microsoft Ads One-Shot Automation
 * ─────────────────────────────────────────────────────────────────
 * ONE browser session, no closing, no re-navigation, no mid-flow saves.
 *
 * PHASE 1 — LOGIN
 *   Navigate to OAuth URL → email → password
 *   Detect already_used → skip if found
 *   Enter Rambler secondary email → OTP via IMAP → Stay Signed In (Yes)
 *   → OAuth redirect drops us directly on ads.microsoft.com website page
 *
 * PHASE 2 — WEBSITE ENTRY
 *   Fill website URL → wait for page to expand
 *
 * PHASE 3 — COMPANY INFO + CHECKBOXES (same page after expansion)
 *   Location = Netherlands, Company Name, Phone (Netherlands + number)
 *   Check all 3 checkboxes → Next
 *
 * PHASE 4 — HOW CAN WE HELP
 *   Click "Create account" tile → (no Next, it navigates)
 *
 * PHASE 5 — CHOOSE EXPERIENCE
 *   Click "Create account only" card → Next
 *
 * PHASE 6 — ACCOUNT DETAILS
 *   Address line 1, City, State or province (dropdown), Postal code → Next
 *
 * PHASE 7 — PAYMENT
 *   Click "Set up payment later" → Yes on popup
 *
 * PHASE 8 — FINAL
 *   Wait exactly 3 minutes → screenshot to screenshots_accounts/
 *   Save session → mark success in all log files
 * ─────────────────────────────────────────────────────────────────
 * Usage:  node version11.js
 */

const { chromium }                     = require('playwright');
const fs                               = require('fs');
const path                             = require('path');
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
const SCREENSHOTS_DIR   = path.join(ROOT, 'screenshots_accounts');
const LOG_DIR           = path.join(ROOT, 'logs');
const INDEX_FILE        = path.join(LOG_DIR, 'account_index.json');
const SESSIONS_LOG      = path.join(LOG_DIR, 'sessions.json');
const DETAILS_JSON      = path.join(LOG_DIR, 'details.json');
const DETAILS_TXT       = path.join(LOG_DIR, 'details.txt');
const ALREADY_USED_JSON = path.join(LOG_DIR, 'already_used.json');
const ALREADY_USED_TXT  = path.join(LOG_DIR, 'already_used.txt');

// OAuth URL — redirect_uri points to ads.microsoft.com, so after "Stay signed in"
// the browser lands directly on the Ads website-entry page. No second goto() needed.
const MS_LOGIN_URL =
  'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
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
// LOGGER
// ═══════════════════════════════════════════════════════════════

let _steps = [], _stepN = 0, _curEmail = '';

function resetLog(email) { _steps = []; _stepN = 0; _curEmail = email; }
const ts   = () => new Date().toISOString();
const step = (m) => { _stepN++; console.log(`\n[STEP ${String(_stepN).padStart(2,'0')}] ${m}`); _steps.push({ n: _stepN, t: ts(), m }); };
const ok   = (m) => { console.log(`       ✅ ${m}`); _steps.push({ t: ts(), ok: m }); };
const warn = (m) => { console.log(`       ⚠  ${m}`); _steps.push({ t: ts(), warn: m }); };
const info = (m) => { console.log(`          ${m}`); _steps.push({ t: ts(), info: m }); };
const fail = (m) => { console.log(`       ✗  ${m}`); _steps.push({ t: ts(), fail: m }); };

async function logPage(page) {
  try {
    const u = page.url();
    const t = await page.title().catch(() => '?');
    info(`URL: ${u.split('?')[0]}`);
    info(`Title: ${t}`);
    return { url: u, title: t };
  } catch { return { url: '', title: '' }; }
}

// ═══════════════════════════════════════════════════════════════
// DIRS
// ═══════════════════════════════════════════════════════════════

function ensureDirs() {
  for (const d of [LOG_DIR, SESSIONS_DIR, SCREENSHOTS_DIR,
                   path.join(ROOT, 'accounts'), path.join(ROOT, 'inboxes')]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

// ═══════════════════════════════════════════════════════════════
// LOG HELPERS  (read ALL logs before doing anything)
// ═══════════════════════════════════════════════════════════════

function readIndex() {
  if (!fs.existsSync(INDEX_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); } catch { return {}; }
}

function writeIndex(email, patch) {
  const db  = readIndex();
  db[email] = { ...db[email], ...patch };
  fs.writeFileSync(INDEX_FILE, JSON.stringify(db, null, 2));
}

function isCompleted(email) {
  return ['success', 'already_used'].includes(readIndex()[email]?.status);
}

function getUsedRamblers() {
  const used = new Set();
  for (const e of Object.values(readIndex()))
    if (e.secondary_email) used.add(e.secondary_email.toLowerCase());
  return used;
}

function getUsedProxies() {
  return new Set(Object.values(readIndex()).filter(v => v.proxy).map(v => v.proxy));
}

function getStats() {
  const entries = Object.values(readIndex());
  return {
    total:        entries.length,
    success:      entries.filter(e => e.status === 'success').length,
    failed:       entries.filter(e => e.status === 'failed').length,
    already_used: entries.filter(e => e.status === 'already_used').length,
  };
}

function appendLog(entry) {
  let d = [];
  if (fs.existsSync(SESSIONS_LOG)) try { d = JSON.parse(fs.readFileSync(SESSIONS_LOG, 'utf8')); } catch {}
  d.push(entry);
  fs.writeFileSync(SESSIONS_LOG, JSON.stringify(d, null, 2));
}

function saveDetails(entry) {
  const icon = entry.status === 'success' ? '✅' : entry.status === 'already_used' ? '⚠️' : '❌';
  fs.appendFileSync(DETAILS_TXT, [
    '─'.repeat(60),
    `${icon} ${entry.status.toUpperCase()} : ${entry.email}`,
    `   Secondary : ${entry.secondary_email || 'N/A'}`,
    `   Proxy     : ${entry.proxy}`,
    `   Time      : ${entry.time}`,
    entry.note ? `   Note      : ${entry.note}` : null,
    '─'.repeat(60), '',
  ].filter(Boolean).join('\n'));

  let d = [];
  if (fs.existsSync(DETAILS_JSON)) try { d = JSON.parse(fs.readFileSync(DETAILS_JSON, 'utf8')); } catch {}
  d.push(entry);
  fs.writeFileSync(DETAILS_JSON, JSON.stringify(d, null, 2));
}

function logAlreadyUsed(entry) {
  let d = [];
  if (fs.existsSync(ALREADY_USED_JSON)) try { d = JSON.parse(fs.readFileSync(ALREADY_USED_JSON, 'utf8')); } catch {}
  if (!d.find(e => e.email === entry.email)) d.push(entry);
  fs.writeFileSync(ALREADY_USED_JSON, JSON.stringify(d, null, 2));
  fs.appendFileSync(ALREADY_USED_TXT,
    `${'─'.repeat(60)}\n⚠️  ALREADY USED: ${entry.email}\n   Secondary: ${entry.secondary_seen || 'unknown'}\n   Time: ${entry.time}\n${'─'.repeat(60)}\n\n`);
}

function saveStepLog(email, status) {
  const p = path.join(LOG_DIR, `steps_${email.replace(/[@.]/g,'_')}_${ts().replace(/[:.]/g,'-')}.json`);
  fs.writeFileSync(p, JSON.stringify({ email, status, steps: _steps }, null, 2));
  info(`Step log: ${path.basename(p)}`);
}

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const hd    = (lo = 600, hi = 1800) => sleep(Math.floor(Math.random() * (hi - lo + 1)) + lo);

function parseProxy(str) {
  const [host, port, user, pass] = str.split(':');
  return { server: `http://${host}:${port}`, username: user, password: pass };
}

function safeEmail(e) { return e.replace(/[@.]/g, '_'); }

// Human-like typing into first matching visible element (CSS selector list)
async function hType(page, cssSels, text, timeoutMs = 15000) {
  const loc = page.locator(cssSels).first();
  await loc.waitFor({ state: 'visible', timeout: timeoutMs });
  await loc.click();
  // Clear existing value
  await loc.fill('').catch(async () => {
    // Fallback clear
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
    }, cssSels.split(',')[0].trim()).catch(() => {});
  });
  await hd(150, 350);
  for (const ch of String(text)) {
    await page.keyboard.type(ch);
    await sleep(Math.floor(Math.random() * 80) + 30);
  }
}

// Click the first visible selector in an array
async function tryClick(page, selArray, label, timeoutMs = 8000) {
  for (const s of selArray) {
    try {
      await page.locator(s).first().waitFor({ state: 'visible', timeout: timeoutMs });
      await hd(300, 700);
      await page.locator(s).first().click();
      ok(`Clicked: ${label}`);
      return true;
    } catch {}
  }
  warn(`Not found: ${label}`);
  return false;
}

// Return first visible selector from array, or null
async function firstVisible(page, selArray, timeoutMs = 8000) {
  try {
    return await Promise.race(selArray.map(async (s) => {
      await page.locator(s).first().waitFor({ state: 'visible', timeout: timeoutMs });
      return s;
    }));
  } catch { return null; }
}

// Click Next / Continue / Submit
async function clickNext(page, timeoutMs = 10000) {
  const sels = [
    'button:has-text("Next")',
    'input[type="submit"][value="Next"]',
    'button:has-text("Save and continue")',
    'button:has-text("Continue")',
    'button[type="submit"]',
    '[data-testid*="next" i]',
  ];
  for (const s of sels) {
    try {
      const el = page.locator(s).first();
      await el.waitFor({ state: 'visible', timeout: timeoutMs });
      await el.scrollIntoViewIfNeeded();
      await hd(400, 800);
      await el.click();
      ok(`Clicked Next [${s}]`);
      return true;
    } catch {}
  }
  warn('Next button not found');
  return false;
}

// Screenshot helper
async function shot(page, label, dir) {
  const d = dir || path.join(LOG_DIR, 'screenshots');
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  const fname = `${safeEmail(_curEmail)}_${label}_${ts().replace(/[:.]/g,'-')}.png`;
  const p = path.join(d, fname);
  try { await page.screenshot({ path: p, fullPage: false }); info(`Screenshot: ${fname}`); return p; }
  catch (e) { info(`(screenshot failed: ${e.message})`); return null; }
}

// Save session to sessions/
async function saveSession(context, label) {
  const safe = safeEmail(_curEmail);
  const t    = ts().replace(/[:.]/g, '-');
  const sp   = path.join(SESSIONS_DIR, `${safe}_${label}_${t}.json`);
  const cp   = path.join(SESSIONS_DIR, `${safe}_${label}_${t}_cookies.json`);
  await context.storageState({ path: sp });
  const cookies = await context.cookies();
  fs.writeFileSync(cp, JSON.stringify(cookies, null, 2));
  ok(`Session saved: ${path.basename(sp)} (${cookies.length} cookies)`);
  return { sp, cp };
}

// Force-select Netherlands in a native <select> dropdown
async function selectNetherlandsDropdown(page, selectors) {
  for (const s of selectors) {
    try {
      const el = page.locator(s).first();
      if (await el.isVisible({ timeout: 3000 })) {
        await el.selectOption({ label: 'Netherlands' }).catch(async () => {
          // Try value-based selection
          const opts = await el.locator('option').all();
          for (const opt of opts) {
            const txt = await opt.textContent().catch(() => '');
            if (/netherlands/i.test(txt)) {
              await el.selectOption({ value: await opt.getAttribute('value') });
              break;
            }
          }
        });
        ok(`Location/Country → Netherlands [${s}]`);
        await hd(400, 700);
        return true;
      }
    } catch {}
  }
  return false;
}

// Force-select Netherlands on a CUSTOM phone country dropdown (click-based)
async function selectNetherlandsPhoneDropdown(page) {
  // Strategy 1: native select near phone input
  const nativeResult = await page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll('select'));
    for (const sel of selects) {
      // Is it near a phone input?
      const id   = (sel.id + sel.name + (sel.getAttribute('aria-label') || '')).toLowerCase();
      const rect = sel.getBoundingClientRect();
      if (rect.width < 200) { // country code dropdowns are narrow
        const opts = Array.from(sel.options);
        const nl   = opts.find(o => /netherlands/i.test(o.text));
        if (nl) {
          sel.value = nl.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return `native select: value=${nl.value}`;
        }
      }
    }
    return null;
  });
  if (nativeResult) { ok(`Phone country dropdown → Netherlands (${nativeResult})`); return true; }

  // Strategy 2: click the custom dropdown button, then click Netherlands
  const dropBtns = [
    'button[aria-label*="country" i]',
    'button[aria-label*="phone" i]',
    '[class*="phone"][class*="country"]',
    '[class*="country-select"]',
    '[class*="PhoneInput"] select',
    '[class*="phone"] select',
  ];
  for (const sel of dropBtns) {
    try {
      if (await page.locator(sel).first().isVisible({ timeout: 2000 })) {
        await page.locator(sel).first().click();
        await hd(500, 1000);
        // Now try to click Netherlands in the open dropdown list
        const nlClicked = await tryClick(page,
          ['li:has-text("Netherlands")', '[role="option"]:has-text("Netherlands")', 'div:has-text("Netherlands")'],
          'Netherlands option', 3000);
        if (nlClicked) return true;
      }
    } catch {}
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════
// ALREADY-USED DETECTOR
// ═══════════════════════════════════════════════════════════════

async function checkAlreadyUsed(page) {
  try {
    const html = await page.content();
    // Microsoft shows "We'll send a code to ****@***.com" when account already has secondary
    if ((html.includes("We'll send a code to") || html.includes('We will send a code to'))
        && html.includes('*')) {
      const m = html.match(/send a code to[^<]{0,30}<[^>]+>([^<]+)/i)
             || html.match(/send a code to\s+([^\s<]{3,})/i);
      return { alreadyUsed: true, maskedEmail: m ? m[1].replace(/<[^>]*>/g,'').trim() : 'unknown' };
    }
    if (html.includes('Verify your identity') && html.includes('@')) {
      return { alreadyUsed: true, maskedEmail: 'unknown' };
    }
  } catch {}
  return { alreadyUsed: false };
}

// ═══════════════════════════════════════════════════════════════
// MAIN ACCOUNT PROCESSOR
// ═══════════════════════════════════════════════════════════════

async function processAccount(acc, proxyStr, rambler, biz, attemptNumber) {
  resetLog(acc.email);
  _curEmail = acc.email;

  console.log('\n' + '═'.repeat(64));
  console.log(`  🚀  Email      : ${acc.email}`);
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

  const page  = await context.newPage();
  let outcome = 'failed';

  try {

    // ══════════════════════════════════════════════════════════
    // PHASE 1 — LOGIN
    // ══════════════════════════════════════════════════════════

    step('Navigate to Microsoft login (OAuth URL)');
    await page.goto(MS_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await hd(2000, 3500);
    await logPage(page);

    // ── Step 1: Enter primary email ───────────────────────────
    step('Enter primary email');
    await hType(page,
      'input[type="email"], input[name="loginfmt"], #i0116',
      acc.email);
    await hd(600, 1200);
    await tryClick(page,
      ['input[type="submit"]', '#idSIButton9', 'button:has-text("Next")'],
      'Next (after email)', 8000);
    await hd(2000, 3500);
    await logPage(page);

    // ── Step 2: Enter password ────────────────────────────────
    step('Enter password');
    await hType(page,
      'input[type="password"], input[name="passwd"], #i0118',
      acc.password);
    await hd(600, 1400);
    await tryClick(page,
      ['input[type="submit"]', '#idSIButton9', 'button:has-text("Sign in")', 'button:has-text("Next")'],
      'Sign in (after password)', 8000);
    await hd(3000, 5000);
    await logPage(page);
    await shot(page, '02_after_password');

    // ── Check already_used ────────────────────────────────────
    step('Check for already-used secondary email');
    const alreadyCheck = await checkAlreadyUsed(page);
    if (alreadyCheck.alreadyUsed) {
      warn(`ALREADY USED — existing secondary: ${alreadyCheck.maskedEmail}`);
      const entry = {
        email: acc.email, secondary_seen: alreadyCheck.maskedEmail,
        proxy: proxyStr, time: ts(), status: 'already_used',
        note: 'Account already has secondary email configured',
      };
      logAlreadyUsed(entry);
      saveDetails({ ...entry, secondary_email: alreadyCheck.maskedEmail, session_file: null });
      appendLog(entry);
      writeIndex(acc.email, { status: 'already_used', proxy: proxyStr,
        secondary_seen: alreadyCheck.maskedEmail, detected_at: ts(), attempt_number: attemptNumber });
      saveStepLog(acc.email, 'already_used');
      await browser.close();
      return { outcome: 'already_used' };
    }
    ok('No existing secondary found — proceeding');

    // ── Step 3: Enter Rambler as secondary email ──────────────
    step(`Enter Rambler secondary: ${rambler.email}`);
    await hType(page,
      'input[type="email"], input[type="text"], input[name="Email"], input[name="SessionStateInput"]',
      rambler.email);
    await hd(700, 1400);
    await tryClick(page,
      ['input[type="submit"]', '#idSIButton9', 'button:has-text("Send code")', 'button:has-text("Next")'],
      'Send code', 8000);
    await hd(2000, 3000);
    await shot(page, '03_secondary_email_sent');

    // ── Step 4: OTP via Rambler IMAP ─────────────────────────
    step(`Fetch OTP from ${rambler.email} via IMAP (up to 3 min)`);
    info('Adding 8s delay before connecting to IMAP...');
    await sleep(8000); // let the email arrive before polling
    const otpStart = Date.now();
    const otp = await waitForOtp(rambler.email, rambler.password, otpStart, 3 * 60 * 1000);
    ok(`OTP: ${otp}`);

    step('Enter OTP');
    await hType(page,
      'input[name="otc"], input[aria-label*="code" i], input[placeholder*="code" i], input[type="tel"], input[type="number"], input[type="text"]',
      otp);
    await hd(700, 1400);
    await tryClick(page,
      ['input[type="submit"]', '#idSIButton9', 'button:has-text("Verify")', 'button:has-text("Next")', 'button:has-text("Sign in")'],
      'Verify OTP', 8000);
    await hd(3000, 5000);
    await shot(page, '04_after_otp');

    // ── Step 5: Stay Signed In ────────────────────────────────
    step('Click Yes / Stay signed in');
    // Wait up to 10s for the prompt to appear
    let stayClicked = false;
    for (let i = 0; i < 5; i++) {
      const vis = await page.locator('#idSIButton9').isVisible({ timeout: 3000 }).catch(() => false);
      if (vis) {
        await hd(700, 1400);
        await page.locator('#idSIButton9').click();
        ok('Clicked Stay signed in / Yes');
        stayClicked = true;
        break;
      }
      await hd(1500, 2500);
    }
    if (!stayClicked) {
      // Try alternative selectors
      await tryClick(page,
        ['button:has-text("Yes")', 'input[value="Yes"]', '[role="button"]:has-text("Yes")'],
        'Yes (stay signed in fallback)', 5000);
    }

    // ── Wait for OAuth redirect to ads.microsoft.com ──────────
    step('Wait for redirect to ads.microsoft.com after stay signed in');
    info('OAuth redirect in progress — waiting up to 30s for ads.microsoft.com...');
    try {
      await page.waitForURL(/ads\.microsoft\.com/, { timeout: 30000 });
      ok(`Redirected to: ${page.url().split('?')[0]}`);
    } catch {
      warn('Redirect timeout — checking current URL');
      await logPage(page);
    }
    await hd(3000, 5000);
    await logPage(page);
    await shot(page, '05_after_stay_signed_in');

    // ══════════════════════════════════════════════════════════
    // PHASE 2 — WEBSITE ENTRY
    // After the OAuth redirect, ads.microsoft.com shows a single
    // "Website you want customers to visit" field.
    // ══════════════════════════════════════════════════════════

    step('Wait for website input field');
    const websiteSel = await firstVisible(page, [
      'input[placeholder*="https://" i]',
      'input[placeholder*="website" i]',
      'input[name*="website" i]',
      'input[type="url"]',
      'input[id*="website" i]',
    ], 60000);

    if (!websiteSel) throw new Error('Website input field did not appear within 60s');
    ok(`Website field found: ${websiteSel}`);
    await shot(page, '06_website_field');

    step(`Fill website: ${biz.website}`);
    const websiteEl = page.locator(websiteSel).first();
    await websiteEl.click();
    await hd(200, 400);
    // Clear placeholder "https://" and type website
    await websiteEl.fill('');
    await hd(150, 300);
    await websiteEl.type(biz.website, { delay: 60 });
    ok(`Typed: ${biz.website}`);
    await hd(500, 800);

    // Wait for the page to start loading website info (spinner appears)
    // Then wait for the full company form to expand on same page
    step('Wait for company info form to expand on same page (up to 20s)');
    info('Waiting for "Getting information from your website..." to finish...');
    // Wait for either company name field or location dropdown to appear
    const expandedSel = await firstVisible(page, [
      'input[placeholder*="business name" i]',
      'input[placeholder="Enter your business name"]',
      'input[aria-label*="company name" i]',
      'input[aria-label*="business name" i]',
      'select[aria-label*="location" i]',
      'select[id*="location" i]',
      'input[id*="business" i]',
    ], 20000);

    if (expandedSel) {
      ok(`Company form expanded (found: ${expandedSel})`);
      await hd(1000, 2000);
      await shot(page, '07_company_form_expanded');
      await fillCompanyForm(page, biz);
    } else {
      // Form didn't expand — maybe it's a Next-first flow
      warn('Company form did not auto-expand — clicking Next to advance');
      await clickNext(page);
      await hd(3000, 5000);
      await logPage(page);
      await shot(page, '07b_after_website_next');
      // Now fill the company details page
      await fillCompanyForm(page, biz);
    }

    // ── Click Next after filling company form ─────────────────
    step('Click Next to submit company info');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await hd(600, 1000);
    await shot(page, '07_company_form_filled');
    await clickNext(page);
    await hd(3000, 5000);
    await logPage(page);
    await shot(page, '08_after_company_next');

    // ══════════════════════════════════════════════════════════
    // PHASE 4 — HOW CAN WE HELP  ("Hello X, how can we help")
    // Three cards: Create account | Importing from Google Ads | Importing from Meta Ads
    // Click: Create account
    // ══════════════════════════════════════════════════════════

    step('Handle "How can we help" — click "Create account"');
    await hd(1500, 2500);
    // Look for the Create account card/tile
    const createAccClicked = await tryClick(page, [
      'div:has-text("Create account"):not(:has-text("campaign")):not(:has-text("Google")):not(:has-text("Meta"))',
      '[role="button"]:has-text("Create account")',
      'button:has-text("Create account")',
      'a:has-text("Create account")',
    ], 'Create account tile', 15000);

    if (!createAccClicked) {
      // JS fallback — find the tile with exactly "Create account" text
      const r = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('div, button, a, [role="button"]'));
        for (const el of els) {
          const txt = (el.textContent || '').trim().replace(/\s+/g,' ');
          if (/^create account$/i.test(txt) && el.offsetParent) {
            el.click();
            return txt;
          }
        }
        // Broader: any clickable element whose text starts with "Create account"
        for (const el of els) {
          const txt = (el.textContent || '').trim();
          if (/create account/i.test(txt) && !/campaign|google|meta|import/i.test(txt) && el.offsetParent) {
            el.click();
            return txt;
          }
        }
        return null;
      });
      if (r) { ok(`Create account (JS): ${r.slice(0,60)}`); }
      else    { warn('Create account tile not found — may already be past this screen'); }
    }
    await hd(3000, 5000);
    await logPage(page);
    await shot(page, '09_after_create_account_tile');

    // ══════════════════════════════════════════════════════════
    // PHASE 5 — CHOOSE EXPERIENCE
    // Two cards: "Create account and campaign" (default selected, left)
    //            "Create account only" (right) ← we click this
    // Then click Next
    // ══════════════════════════════════════════════════════════

    step('Select "Create account only" card');
    await hd(2000, 3000);
    await logPage(page);
    await shot(page, '10_choose_experience');

    const createOnlyClicked = await page.evaluate(() => {
      // Walk all text nodes, find "Create account only"
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (/create\s+account\s+only/i.test(node.textContent)) {
          let el = node.parentElement;
          // Walk up to find the clickable card container
          while (el && el !== document.body) {
            const tag   = el.tagName.toLowerCase();
            const role  = el.getAttribute('role') || '';
            const style = window.getComputedStyle(el);
            if (tag === 'label' || role === 'radio' || role === 'button' ||
                el.getAttribute('tabindex') === '0' || style.cursor === 'pointer') {
              el.click();
              return `clicked: "${el.textContent.trim().replace(/\s+/g,' ').slice(0,80)}"`;
            }
            el = el.parentElement;
          }
          // Fallback: click text node's parent directly
          node.parentElement.click();
          return `parent click: "${node.parentElement.textContent.trim().slice(0,60)}"`;
        }
      }
      return null;
    });

    if (createOnlyClicked) {
      ok(`"Create account only" selected: ${createOnlyClicked}`);
      await hd(1000, 2000);
      await shot(page, '10_create_account_only_selected');
    } else {
      warn('"Create account only" text not found on this page');
      await shot(page, '10_create_account_only_missing');
    }

    step('Click Next to confirm "Create account only"');
    await clickNext(page);
    await hd(4000, 6000);
    try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}
    await logPage(page);
    await shot(page, '10_after_create_account_only_next');

    // ══════════════════════════════════════════════════════════
    // PHASE 6 — ACCOUNT DETAILS
    // Fields visible from screenshot:
    //   Legal business name (auto-filled — leave or update)
    //   Phone number: Netherlands dropdown + number
    //   Location: Netherlands (greyed out, auto-set)
    //   Address line 1  ← fill
    //   Address line 2  ← optional
    //   City            ← fill
    //   State or province (dropdown) ← select matching state
    //   Postal code / ZIP code ← fill
    //   VAT, Time zone, Currency ← leave
    // ══════════════════════════════════════════════════════════

    step('Fill Account Details form');
    await hd(2000, 3000);
    await logPage(page);
    await shot(page, '11_account_details_form');

    await fillAccountDetails(page, biz);

    step('Click Next on Account Details');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await hd(600, 1000);
    await shot(page, '11_account_details_filled');
    await clickNext(page);
    await hd(4000, 6000);
    try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}
    await logPage(page);
    await shot(page, '11_after_account_details_next');

    // ══════════════════════════════════════════════════════════
    // PHASE 7 — PAYMENT PAGE
    // Page shows "Enter your payment method" with a "Set up payment later" link
    // at the bottom right. Click it → popup → click Yes.
    // ══════════════════════════════════════════════════════════

    step('Click "Set up payment later"');
    await hd(2000, 3000);
    await shot(page, '12_payment_page');

    let payLaterDone = false;
    for (const sel of [
      'text=Set up payment later',
      'a:has-text("Set up payment later")',
      'button:has-text("Set up payment later")',
      '[role="button"]:has-text("Set up payment later")',
    ]) {
      try {
        const el = page.locator(sel).first();
        await el.waitFor({ state: 'visible', timeout: 10000 });
        await el.scrollIntoViewIfNeeded();
        await hd(500, 900);
        await el.click();
        ok(`Clicked "Set up payment later" [${sel}]`);
        payLaterDone = true;
        break;
      } catch {}
    }
    if (!payLaterDone) {
      const r = await page.evaluate(() => {
        for (const el of document.querySelectorAll('a, button, [role="button"]')) {
          if (/set\s+up\s+payment\s+later/i.test(el.innerText || '') && el.offsetParent) {
            el.click(); return el.innerText.trim();
          }
        }
        return null;
      });
      if (r) { ok(`JS clicked "Set up payment later"`); payLaterDone = true; }
    }
    if (!payLaterDone) throw new Error('"Set up payment later" not found on payment page');

    // ── Yes on popup ──────────────────────────────────────────
    step('Click Yes on "Are you sure you want to set up payment later?" popup');
    await hd(1500, 2500);
    await shot(page, '12_payment_popup');

    let yesClicked = false;
    for (const sel of [
      'button:has-text("Yes")',
      'input[value="Yes"]',
      '[role="button"]:has-text("Yes")',
    ]) {
      try {
        const el = page.locator(sel).first();
        await el.waitFor({ state: 'visible', timeout: 8000 });
        await hd(400, 700);
        await el.click();
        ok(`Clicked Yes [${sel}]`);
        yesClicked = true;
        break;
      } catch {}
    }
    if (!yesClicked) {
      const r = await page.evaluate(() => {
        for (const el of document.querySelectorAll('button, [role="button"]')) {
          if (/^yes$/i.test((el.innerText || '').trim()) && el.offsetParent) {
            el.click(); return 'yes';
          }
        }
        return null;
      });
      if (r) { ok('JS clicked Yes'); yesClicked = true; }
    }
    if (!yesClicked) warn('Yes button not found on popup — may have auto-closed');

    // Wait for popup to close
    try { await page.locator('button:has-text("Yes")').waitFor({ state: 'hidden', timeout: 8000 }); } catch {}
    await hd(2000, 4000);
    await logPage(page);
    await shot(page, '12_after_yes');

    // ══════════════════════════════════════════════════════════
    // PHASE 8 — WAIT 3 MINUTES + FINAL SCREENSHOT + SAVE SESSION
    // The campaign creation page should now be loading.
    // We wait exactly 3 minutes, then screenshot and save.
    // ══════════════════════════════════════════════════════════

    step('Waiting 3 minutes for final page to fully load');
    await logPage(page);
    await shot(page, '13_before_3min_wait');
    info('Sleeping 180 seconds (3 minutes)...');
    await sleep(180_000);
    ok('3-minute wait complete');

    step('Take final screenshot → screenshots_accounts/');
    const finalUrl = page.url();
    await logPage(page);
    const finalShot = await shot(page, `FINAL_${Date.now()}`, SCREENSHOTS_DIR);
    ok(`Final screenshot: ${finalShot}`);

    // ── Save session (ONLY NOW, at the very end) ──────────────
    step('Save session (end of run)');
    const { sp, cp } = await saveSession(context, 'FINAL');

    // ── Mark success in all log files ─────────────────────────
    writeIndex(acc.email, {
      status:           'success',
      proxy:            proxyStr,
      secondary_email:  rambler.email,
      session:          sp,
      cookie_file:      cp,
      final_url:        finalUrl,
      final_screenshot: finalShot,
      completed_at:     ts(),
      attempt_number:   attemptNumber,
    });
    saveDetails({
      email:           acc.email,
      secondary_email: rambler.email,
      proxy:           proxyStr,
      session_file:    sp,
      time:            ts(),
      status:          'success',
      attempt_number:  attemptNumber,
    });
    appendLog({ email: acc.email, secondary_email: rambler.email, proxy: proxyStr,
      session: sp, time: ts(), status: 'success' });
    saveStepLog(acc.email, 'success');

    outcome = 'success';
    console.log(`\n  🎉  SUCCESS: ${acc.email}`);
    console.log(`       Screenshot : ${finalShot}`);
    console.log(`       Session    : ${sp}\n`);

  } catch (err) {
    outcome = 'failed';
    fail(err.message);
    if (err.stack) info('Stack: ' + err.stack.split('\n').slice(0,4).join(' | '));
    try { await logPage(page); await shot(page, 'ERROR'); } catch {}
    writeIndex(acc.email, {
      status: 'failed', error: err.message, proxy: proxyStr,
      secondary_email: rambler.email, last_attempt: ts(), attempt_number: attemptNumber,
    });
    saveDetails({ email: acc.email, secondary_email: rambler.email, proxy: proxyStr,
      session_file: null, time: ts(), status: 'failed',
      note: err.message, attempt_number: attemptNumber });
    appendLog({ email: acc.email, proxy: proxyStr, time: ts(), status: 'failed', error: err.message });
    saveStepLog(acc.email, 'failed');
    console.log(`\n  ✗  FAILED: ${acc.email}\n     ${err.message}\n`);
  } finally {
    await browser.close().catch(() => {});
  }

  return { outcome };
}

// ═══════════════════════════════════════════════════════════════
// FILL COMPANY INFO FORM
// (same page as website — appears after website auto-loads)
// Fields: Location, Company/Business Name, Email (leave), Phone, Checkboxes
// ═══════════════════════════════════════════════════════════════

async function fillCompanyForm(page, biz) {
  await hd(1000, 2000);

  // ── Location dropdown → ensure Netherlands ────────────────
  step('Ensure Location = Netherlands');
  const locationSet = await selectNetherlandsDropdown(page, [
    'select[aria-label*="location" i]',
    'select[id*="location" i]',
    'select[name*="location" i]',
    'select[aria-label*="country" i]',
    'select[id*="country" i]',
  ]);
  if (!locationSet) {
    // Check if Netherlands is already shown (might be pre-selected and read-only)
    const isNl = await page.evaluate(() =>
      document.body.innerText.toLowerCase().includes('netherlands')
    );
    if (isNl) { ok('Netherlands already visible on page'); }
    else { warn('Location dropdown not found — proceeding'); }
  }

  // ── Company / Business Name ───────────────────────────────
  step(`Fill company name: ${biz.businessName}`);
  const nameResult = await page.evaluate((name) => {
    for (const inp of document.querySelectorAll('input')) {
      const ph = (inp.placeholder || '').toLowerCase();
      const id = (inp.id || '').toLowerCase();
      const nm = (inp.name || '').toLowerCase();
      const la = (inp.getAttribute('aria-label') || '').toLowerCase();
      if ((ph.includes('business name') || ph.includes('company name') ||
           id.includes('business')      || nm.includes('business')     ||
           nm.includes('company')       || la.includes('business')     || la.includes('company'))
          && (inp.offsetWidth || inp.offsetHeight)) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(inp, name);
        else inp.value = name;
        inp.dispatchEvent(new Event('input',  { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return `filled: id="${inp.id}" placeholder="${inp.placeholder}"`;
      }
    }
    return null;
  }, biz.businessName);

  if (nameResult) {
    ok(`Company name (JS): ${nameResult}`);
    // Re-type via Playwright to trigger React events
    try {
      const el = page.locator(
        'input[placeholder*="business name" i], input[placeholder="Enter your business name"], input[aria-label*="business name" i], input[aria-label*="company name" i], input[id*="business" i], input[name*="business" i]'
      ).first();
      await el.click({ timeout: 3000 });
      await hd(150, 300);
      await el.fill(biz.businessName);
    } catch {}
  } else {
    warn('Company name field not found by JS — trying Playwright');
    try {
      await hType(page,
        'input[placeholder*="business name" i], input[placeholder="Enter your business name"], input[aria-label*="business name" i]',
        biz.businessName, 5000);
    } catch { warn('Company name field not found'); }
  }
  await hd(500, 900);

  // ── Email field — leave as is (auto-filled with primary email) ─
  info('Email field: leaving as auto-filled');

  // ── Phone country → Netherlands ───────────────────────────
  step('Ensure phone country dropdown = Netherlands');
  await selectNetherlandsPhoneDropdown(page);

  // ── Phone number ──────────────────────────────────────────
  step(`Fill phone number: ${biz.phone}`);
  const phoneResult = await page.evaluate((phone) => {
    for (const inp of document.querySelectorAll('input')) {
      const ph = (inp.placeholder || '').toLowerCase();
      const id = (inp.id || '').toLowerCase();
      const nm = (inp.name || '').toLowerCase();
      const tp = (inp.type || '').toLowerCase();
      const la = (inp.getAttribute('aria-label') || '').toLowerCase();
      if ((tp === 'tel' || ph.includes('phone') || ph.includes('number') ||
           id.includes('phone') || nm.includes('phone') || la.includes('phone'))
          && (inp.offsetWidth || inp.offsetHeight)
          && !inp.value) { // not already filled
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(inp, phone);
        else inp.value = phone;
        inp.dispatchEvent(new Event('input',  { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return `id="${inp.id}" type="${inp.type}"`;
      }
    }
    return null;
  }, biz.phone);

  if (phoneResult) {
    ok(`Phone (JS): ${phoneResult}`);
    try {
      const el = page.locator(
        'input[type="tel"], input[placeholder*="phone" i], input[id*="phone" i], input[name*="phone" i]'
      ).first();
      await el.click({ timeout: 3000 });
      await hd(150, 300);
      await el.fill(biz.phone);
    } catch {}
  } else {
    warn('Phone field not found by JS — trying Playwright');
    try {
      await hType(page,
        'input[type="tel"], input[placeholder*="phone" i], input[id*="phone" i]',
        biz.phone, 5000);
    } catch { warn('Phone field not found'); }
  }
  await hd(500, 900);

  // ── Checkboxes: check ALL 3 ───────────────────────────────
  // 1. Marketing communication
  // 2. Terms & Conditions
  // 3. Non-political advertising confirmation
  step('Check all checkboxes (marketing, T&C, non-political)');
  try {
    const boxes = page.locator('input[type="checkbox"]');
    const cnt   = await boxes.count();
    info(`Found ${cnt} checkbox(es)`);
    for (let i = 0; i < cnt; i++) {
      try {
        const isChecked = await boxes.nth(i).isChecked();
        if (!isChecked) {
          await hd(200, 450);
          await boxes.nth(i).click();
          info(`Checked box ${i + 1}`);
        } else {
          info(`Box ${i + 1} already checked`);
        }
      } catch (e) { warn(`Box ${i + 1} error: ${e.message}`); }
    }
  } catch (e) { warn(`Checkboxes: ${e.message}`); }
  await hd(700, 1200);
}

// ═══════════════════════════════════════════════════════════════
// FILL ACCOUNT DETAILS FORM
// Fields from screenshot:
//   Legal business name (may be pre-filled — leave or update)
//   Phone number: Netherlands dropdown + number
//   Location: Netherlands (read-only)
//   Address line 1, Address line 2, City, State/province, Postal/ZIP, VAT (leave)
// ═══════════════════════════════════════════════════════════════

async function fillAccountDetails(page, biz) {
  await hd(1000, 2000);

  // ── Legal business name ───────────────────────────────────
  // This is pre-filled from the company info step. Leave it unless empty.
  step('Check/update legal business name');
  try {
    const nameEl = page.locator(
      'input[placeholder*="legal" i], input[aria-label*="legal business" i], input[id*="legal" i], input[name*="legal" i]'
    ).first();
    if (await nameEl.isVisible({ timeout: 3000 })) {
      const cur = await nameEl.inputValue().catch(() => '');
      if (!cur) {
        await nameEl.fill(biz.businessName);
        ok(`Legal business name filled: ${biz.businessName}`);
      } else {
        ok(`Legal business name already set: ${cur}`);
      }
    }
  } catch { info('Legal business name field not found — skipping'); }

  // ── Phone country → Netherlands ───────────────────────────
  step('Ensure phone country = Netherlands (Account Details)');
  await selectNetherlandsPhoneDropdown(page);

  // ── Phone number (if not already filled) ──────────────────
  try {
    const phoneSels = ['input[type="tel"]', 'input[placeholder*="phone" i]', 'input[id*="phone" i]'];
    for (const s of phoneSels) {
      const el = page.locator(s).first();
      if (await el.isVisible({ timeout: 2000 })) {
        const cur = await el.inputValue().catch(() => '');
        if (!cur) {
          await el.fill(biz.phone);
          ok(`Phone filled: ${biz.phone}`);
        } else {
          info(`Phone already set: ${cur}`);
        }
        break;
      }
    }
  } catch {}
  await hd(400, 700);

  // ── Address line 1 ────────────────────────────────────────
  step(`Fill Address line 1: ${biz.address1}`);
  await fillFieldByPlaceholderOrLabel(page, [
    'input[placeholder*="address line 1" i]',
    'input[aria-label*="address line 1" i]',
    'input[id*="line1" i]',
    'input[id*="address1" i]',
    'input[name*="address1" i]',
    'input[name*="line1" i]',
  ], biz.address1);

  // ── City ──────────────────────────────────────────────────
  step(`Fill City: ${biz.city}`);
  await fillFieldByPlaceholderOrLabel(page, [
    'input[placeholder="City"]',
    'input[placeholder*="city" i]',
    'input[aria-label*="city" i]',
    'input[id*="city" i]',
    'input[name*="city" i]',
  ], biz.city);

  // ── State or province dropdown ────────────────────────────
  step(`Select State/Province: ${biz.state}`);
  try {
    const stateSel = page.locator(
      'select[id*="state" i], select[id*="province" i], select[name*="state" i], select[name*="province" i], select[aria-label*="state" i], select[aria-label*="province" i], #address-formStateOrProvince'
    ).first();
    if (await stateSel.isVisible({ timeout: 5000 })) {
      const opts   = await stateSel.locator('option').all();
      const target = (biz.state || 'North Holland').toLowerCase();
      let matched  = false;
      for (const opt of opts) {
        const txt = (await opt.textContent().catch(() => '')).toLowerCase();
        if (txt.includes(target) || target.includes(txt.replace(/\s+/g,' ').trim())) {
          await stateSel.selectOption({ value: await opt.getAttribute('value') });
          ok(`State → ${await opt.textContent().catch(() => biz.state)}`);
          matched = true;
          break;
        }
      }
      if (!matched) {
        // Try NH (North Holland) or ZH (South Holland)
        const fallback = /north/i.test(biz.state) ? 'NH' : 'ZH';
        await stateSel.selectOption({ value: fallback }).catch(() => {});
        ok(`State → ${fallback} (fallback)`);
      }
      await hd(400, 700);
    }
  } catch (e) { warn(`State dropdown: ${e.message}`); }

  // ── Postal / ZIP code ─────────────────────────────────────
  step(`Fill Postal/ZIP code: ${biz.zip}`);
  await fillFieldByPlaceholderOrLabel(page, [
    'input[placeholder="Postal code"]',
    'input[placeholder="ZIP code"]',
    'input[placeholder*="postal" i]',
    'input[placeholder*="zip" i]',
    'input[aria-label*="postal" i]',
    'input[aria-label*="zip" i]',
    'input[id*="postal" i]',
    'input[id*="zip" i]',
    'input[name*="postal" i]',
    'input[name*="zip" i]',
  ], biz.zip);

  await hd(600, 1000);
}

// Helper: fill a field by trying selectors in order, only if currently empty
async function fillFieldByPlaceholderOrLabel(page, selectors, value) {
  if (!value) return;
  for (const s of selectors) {
    try {
      const el = page.locator(s).first();
      if (await el.isVisible({ timeout: 2000 })) {
        const cur = await el.inputValue().catch(() => '');
        if (!cur) {
          await el.click();
          await hd(100, 200);
          await el.fill(value);
          ok(`Filled [${s.split('[')[1]?.replace(']','') || s}] = ${value}`);
          return;
        } else {
          ok(`Already set: ${cur}`);
          return;
        }
      }
    } catch {}
  }
  warn(`Field not found for value: ${value}`);
}

// ═══════════════════════════════════════════════════════════════
// ENTRY POINT
// ═══════════════════════════════════════════════════════════════

(async () => {
  ensureDirs();

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║   Microsoft Ads One-Shot  —  version11.js           ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  // ── Read ALL logs before doing anything ──────────────────
  const stats = getStats();
  console.log('📊 Log stats:');
  console.log(`   ✅ Success      : ${stats.success}`);
  console.log(`   ❌ Failed       : ${stats.failed}`);
  console.log(`   ⚠️  Already used : ${stats.already_used}`);
  console.log(`   📊 Total        : ${stats.total}\n`);

  const usedRamblers = getUsedRamblers();
  const usedProxies  = getUsedProxies();
  console.log(`📬 ${usedRamblers.size} Rambler accounts already used — will not reuse`);

  // ── Load input files ──────────────────────────────────────
  const emails   = JSON.parse(fs.readFileSync(EMAILS_FILE, 'utf8'));
  const proxies  = fs.readFileSync(PROXIES_FILE, 'utf8').split('\n').map(p => p.trim()).filter(Boolean);
  const ramblers = parseRamblerFile(RAMBLER_FILE);
  const bizRaw   = JSON.parse(fs.readFileSync(BUSINESS_FILE, 'utf8'));
  const bizArr   = Array.isArray(bizRaw) ? bizRaw : [bizRaw];

  console.log(`📧 ${emails.length} Microsoft accounts`);
  console.log(`🌐 ${proxies.length} proxies`);
  console.log(`📮 ${ramblers.length} Rambler accounts`);
  console.log(`📋 ${bizArr.length} business entries\n`);

  // Fresh Ramblers = those not yet used as secondary
  let freshRamblers = ramblers.filter(r => !usedRamblers.has(r.email.toLowerCase()));
  if (!freshRamblers.length) {
    console.log('⚠️  All Rambler accounts already used — recycling all');
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

    if (isCompleted(acc.email)) {
      console.log(`⏭️  Skipping (done): ${acc.email}`);
      skipped++;
      continue;
    }

    attempted++;

    // ── Pick proxy ────────────────────────────────────────
    let proxyStr;
    const db = readIndex();
    if (db[acc.email]?.proxy) {
      proxyStr = db[acc.email].proxy;
      console.log(`♻️  Reusing proxy: ${proxyStr.split(':').slice(0,2).join(':')}`);
    } else {
      const avail = proxies.filter(p => !usedProxies.has(p));
      if (avail.length > 0) {
        proxyStr = avail[Math.floor(Math.random() * avail.length)];
        usedProxies.add(proxyStr);
        console.log(`🆕 Fresh proxy (${avail.length} available)`);
      } else {
        proxyStr = proxies[Math.floor(Math.random() * proxies.length)];
        console.log('⚠️  All proxies used — random fallback');
      }
    }

    // ── Pick fresh Rambler ────────────────────────────────
    if (ramblerIdx >= freshRamblers.length) {
      console.log('⚠️  Rambler list exhausted — recycling');
      ramblerIdx = 0;
    }
    const rambler = freshRamblers[ramblerIdx++];
    usedRamblers.add(rambler.email.toLowerCase());

    // ── Pick business (round-robin) ───────────────────────
    const biz = bizArr[i % bizArr.length];

    // ── Run ───────────────────────────────────────────────
    const { outcome } = await processAccount(acc, proxyStr, rambler, biz, attempted);

    if      (outcome === 'success')      successCount++;
    else if (outcome === 'already_used') alreadyUsedCount++;
    else                                 failCount++;

    const gap = Math.floor(Math.random() * 6000) + 8000;
    console.log(`\n⏳ Waiting ${(gap/1000).toFixed(1)}s before next account...\n`);
    await sleep(gap);
  }

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║                   RUN COMPLETE                      ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  ✅ Success       : ${String(successCount).padEnd(32)}║`);
  console.log(`║  ⚠️  Already used  : ${String(alreadyUsedCount).padEnd(32)}║`);
  console.log(`║  ❌ Failed        : ${String(failCount).padEnd(32)}║`);
  console.log(`║  ⏭️  Skipped       : ${String(skipped).padEnd(32)}║`);
  console.log(`║  📊 Attempted     : ${String(attempted).padEnd(32)}║`);
  console.log('╚══════════════════════════════════════════════════════╝\n');
  console.log('📁 screenshots_accounts/   — final dashboard screenshots');
  console.log('📁 logs/account_index.json — account status');
  console.log('📁 sessions/               — saved browser sessions\n');

})();
