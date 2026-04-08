'use strict';

/**
 * restore.js  —  Microsoft Ads Business Setup
 * ─────────────────────────────────────────────────────────────────
 * Flow:
 *  1. Load saved post-login session for an account
 *  2. Navigate to ads.microsoft.com
 *  3. Sign in → Continue with Microsoft → pick account from picker
 *  4. "Tell us about your business" → fill website, name, phone
 *  5. Check all checkboxes → Next
 *  6. "How can we help" → Create account
 *  7. "Create account without a campaign" (NOT the default campaign)
 *  8. Account Details form (address, city, state, ZIP)
 *  9. Payment page → "Set up payment later" → "Yes" → "Create Campaign"
 * 10. Session saved at every step
 * 11. Browser stays open — you visually confirm it's done, then tell me
 *
 * Usage:
 *   node restore.js              — show available accounts
 *   node restore.js 1            — process account #1
 *   node restore.js email@x.com  — process specific email
 * ─────────────────────────────────────────────────────────────────
 */

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const ROOT            = __dirname;
const MS_ADS_URL      = 'https://ads.microsoft.com';
const BUSINESS_FILE   = path.join(ROOT, 'business.json');
const INDEX_FILE      = path.join(ROOT, 'logs', 'account_index.json');
const SESSIONS_DIR    = path.join(ROOT, 'sessions');
const SCREENSHOTS_DIR = path.join(ROOT, 'logs', 'screenshots');
const RESTORE_LOG     = path.join(ROOT, 'logs', 'restore_log.json');

// ═══════════════════════════════════════════════════════════════
// STEP LOGGER
// ═══════════════════════════════════════════════════════════════

let _steps = [], _n = 0, _email = '';

function resetLog(email) { _steps = []; _n = 0; _email = email; }
const ts   = () => new Date().toISOString();
const step = (m) => { _n++; _steps.push({ n: _n, t: ts(), m }); console.log(`\n[STEP ${String(_n).padStart(2,'0')}] ${m}`); };
const ok   = (m) => { _steps.push({ n: _n, t: ts(), m: `✅ ${m}` }); console.log(`       ✅ ${m}`); };
const warn = (m) => { _steps.push({ n: _n, t: ts(), m: `⚠  ${m}` }); console.log(`       ⚠  ${m}`); };
const info = (m) => { _steps.push({ n: _n, t: ts(), m: `→ ${m}` });  console.log(`          ${m}`); };
const fail = (m) => { _steps.push({ n: _n, t: ts(), m: `✗ ${m}` });  console.log(`       ✗  ${m}`); };

async function pageInfo(page) {
  try {
    const url   = page.url();
    const title = await page.title().catch(() => '?');
    info(`URL  : ${url}`);
    info(`Title: ${title}`);
    return { url, title };
  } catch { return { url:'', title:'' }; }
}

async function shot(page, label) {
  try {
    if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const p = path.join(SCREENSHOTS_DIR, `${_email.replace(/[@.]/g,'_')}_restore_${label}_${ts().replace(/[:.]/g,'-')}.png`);
    await page.screenshot({ path: p, fullPage: false });
    info(`Screenshot: logs/screenshots/${path.basename(p)}`);
  } catch(e) { info(`(screenshot failed: ${e.message})`); }
}

function saveStepLog(status) {
  if (!fs.existsSync(path.join(ROOT,'logs'))) fs.mkdirSync(path.join(ROOT,'logs'),{recursive:true});
  const p = path.join(ROOT,'logs',`restore_steps_${_email.replace(/[@.]/g,'_')}_${ts().replace(/[:.]/g,'-')}.json`);
  fs.writeFileSync(p, JSON.stringify({ email: _email, status, steps: _steps }, null, 2));
  console.log(`\n📋 Step log: ${p}`);
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

const sleep = (ms) => new Promise(r => setTimeout(r,ms));
const hd    = (lo=700, hi=2000) => sleep(Math.floor(Math.random()*(hi-lo+1))+lo);

function parseProxy(str) {
  const [host,port,user,pass] = str.split(':');
  return { server:`http://${host}:${port}`, username:user, password:pass };
}

async function hType(page, sel, text) {
  const loc = page.locator(sel).first();
  await loc.waitFor({ state:'visible', timeout:12000 });
  await loc.click();
  try { await loc.clear(); } catch {
    await page.evaluate(s => {
      const el = document.querySelector(s);
      if (el) { el.value=''; el.dispatchEvent(new Event('input',{bubbles:true})); }
    }, sel).catch(()=>{});
  }
  await hd(200,500);
  for (const ch of String(text)) {
    await page.keyboard.type(ch);
    await sleep(Math.floor(Math.random()*90)+35);
  }
}

async function firstVisible(page, sels, timeout=10000) {
  try {
    return await Promise.race(sels.map(async s => {
      await page.locator(s).first().waitFor({ state:'visible', timeout });
      return s;
    }));
  } catch { return null; }
}

async function tryClick(page, sels, label, timeout=6000) {
  for (const s of sels) {
    try {
      await page.locator(s).first().waitFor({ state:'visible', timeout });
      await hd(400,900);
      await page.locator(s).first().click();
      ok(`Clicked "${label}" [${s}]`);
      return true;
    } catch {}
  }
  warn(`"${label}" not found`);
  return false;
}

// ═══════════════════════════════════════════════════════════════
// SESSION SAVE
// ═══════════════════════════════════════════════════════════════

async function saveSession(context, label) {
  if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  const safe = _email.replace(/[@.]/g,'_');
  const t    = ts().replace(/[:.]/g,'-');
  const sp   = path.join(SESSIONS_DIR, `${safe}_RESTORE_${label}_${t}.json`);
  const cp   = path.join(SESSIONS_DIR, `${safe}_RESTORE_${label}_${t}_cookies.json`);
  await context.storageState({ path: sp });
  const cookies = await context.cookies();
  fs.writeFileSync(cp, JSON.stringify(cookies, null, 2));
  ok(`Session saved: sessions/${path.basename(sp)} (${cookies.length} cookies)`);
  return { sp, cp };
}

// ═══════════════════════════════════════════════════════════════
// ACCOUNT INDEX
// ═══════════════════════════════════════════════════════════════

function readIndex() {
  if (!fs.existsSync(INDEX_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(INDEX_FILE,'utf8')); } catch { return {}; }
}

function writeIndex(patch) {
  const dir = path.join(ROOT,'logs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
  const db = readIndex();
  db[_email] = { ...db[_email], ...patch };
  fs.writeFileSync(INDEX_FILE, JSON.stringify(db, null, 2));
}

function appendRestoreLog(entry) {
  let log = [];
  if (fs.existsSync(RESTORE_LOG)) try { log = JSON.parse(fs.readFileSync(RESTORE_LOG,'utf8')); } catch {}
  log.push(entry);
  fs.writeFileSync(RESTORE_LOG, JSON.stringify(log, null, 2));
}

// ═══════════════════════════════════════════════════════════════
// FIND ACCOUNTS THAT NEED RESTORE
// ═══════════════════════════════════════════════════════════════

function findRestoreAccounts() {
  const db = readIndex();
  // Include: success + any account that has a post_login session file (even if already_used)
  const result = [];
  for (const [email, data] of Object.entries(db)) {
    // Already fully restored — skip
    if (data.restore_status === 'success') continue;

    // Find the best available session file
    const sessionFile = findBestSession(email);
    if (sessionFile) {
      result.push({ email, data, sessionFile });
    }
  }
  return result;
}

function findBestSession(email) {
  if (!fs.existsSync(SESSIONS_DIR)) return null;
  const safe = email.replace(/[@.]/g,'_');

  // Prefer post_login session, then final, then any
  const all = fs.readdirSync(SESSIONS_DIR)
    .filter(f => f.startsWith(safe) && f.endsWith('.json') && !f.includes('cookies'))
    .sort()
    .reverse(); // newest first

  const postLogin = all.find(f => f.includes('post_login'));
  const final_    = all.find(f => f.includes('final'));
  const fallback  = all[0];

  return postLogin || final_ || fallback || null;
}

// ═══════════════════════════════════════════════════════════════
// LOAD BUSINESS DATA (round-robin)
// ═══════════════════════════════════════════════════════════════

function loadBusiness(index = 0) {
  if (!fs.existsSync(BUSINESS_FILE)) {
    console.error('❌ business.json not found'); process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(BUSINESS_FILE,'utf8'));
  const arr = Array.isArray(raw) ? raw : [raw];
  const biz = arr[index % arr.length];
  return biz;
}

// ═══════════════════════════════════════════════════════════════
// MAIN RESTORE FLOW
// ═══════════════════════════════════════════════════════════════

async function restoreAccount(email, data, sessionFile, biz) {
  resetLog(email);

  console.log('\n' + '═'.repeat(62));
  console.log(`  🔧  Restoring : ${email}`);
  console.log(`  💾  Session   : ${sessionFile}`);
  console.log(`  🌐  Proxy     : ${data.proxy || 'none'}`);
  console.log(`  📋  Business  : ${biz.businessName}  /  ${biz.website}`);
  console.log('═'.repeat(62));

  step('Launch browser (windowed, maximised)');
  const launchOpts = {
    headless: false,
    slowMo: 60,
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
    ],
  };
  // Try proxy first; fall back to no-proxy if it fails
  if (data.proxy) {
    launchOpts.proxy = parseProxy(data.proxy);
    info(`Using proxy: ${data.proxy.split(':').slice(0,2).join(':')}`);
  } else {
    info('No proxy — connecting directly');
  }

  const browser = await chromium.launch(launchOpts);

  const sessionPath = path.join(SESSIONS_DIR, sessionFile);
  const contextOpts = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: null,           // null = use full window size (maximised)
    locale: 'en-US',
    timezoneId: 'America/New_York',
  };

  step('Load saved session');
  if (fs.existsSync(sessionPath)) {
    contextOpts.storageState = sessionPath;
    ok(`Loaded: ${sessionFile}`);
  } else {
    warn(`Session file not found: ${sessionFile} — starting fresh`);
  }

  const context = await browser.newContext(contextOpts);
  const page    = await context.newPage();

  let lastSession = { sp: null, cp: null };
  let outcome     = 'failed';

  try {
    // ── Navigate to MS Ads ──────────────────────────────────────
    step('Navigate to Microsoft Ads');
    // Try twice; if proxy fails, reload without it
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await page.goto(MS_ADS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
        const navUrl = page.url();
        if (navUrl.includes('chrome-error')) throw new Error('chrome-error page');
        break; // success
      } catch (navErr) {
        warn(`Nav attempt ${attempt}: ${navErr.message.slice(0,80)}`);
        if (attempt === 1) { info('Waiting 8s then retrying...'); await hd(8000, 9000); }
        else throw navErr;
      }
    }
    await hd(3000, 5000);
    await pageInfo(page);
    await shot(page, '01_landing');

    // ── Sign In button ──────────────────────────────────────────
    step('Click Sign in');
    const signInClicked = await tryClick(page, [
      'a:has-text("Sign in")',
      'button:has-text("Sign in")',
      'a[href*="signin"]',
    ], 'Sign in', 8000);
    if (signInClicked) {
      await hd(3000, 5000);
      await pageInfo(page);
      await shot(page, '02_after_signin_btn');
    }

    // ── Continue with Microsoft ────────────────────────────────
    step('Click Continue with Microsoft');
    const contClicked = await tryClick(page, [
      'button:has-text("Continue with Microsoft")',
      'a:has-text("Continue with Microsoft")',
      'button:has-text("Microsoft")',
    ], 'Continue with Microsoft', 8000);
    if (contClicked) {
      await hd(3000, 5000);
      await pageInfo(page);
      await shot(page, '03_after_continue_ms');
    }

    // ── Account picker ─────────────────────────────────────────
    // Microsoft shows "We found an account you can use" with the email at the bottom
    step('Handle account picker');
    await hd(2000, 3000);
    await pageInfo(page);
    await shot(page, '04_account_picker');

    const pickerHandled = await (async () => {
      // Wait for the page to settle — account picker may take a moment
      await hd(2000, 3000);

      // Use JavaScript eval to find the exact clickable tile in the DOM
      // Microsoft renders account tiles as [role="button"] or div[tabindex="0"]
      // that contain the "Signed in" status text
      const jsResult = await page.evaluate((targetEmail) => {
        const candidates = [
          ...Array.from(document.querySelectorAll('[role="button"]')),
          ...Array.from(document.querySelectorAll('div[tabindex="0"]')),
          ...Array.from(document.querySelectorAll('.table-row')),
          ...Array.from(document.querySelectorAll('[data-bind]')),
        ];
        // Find the tile that contains "Signed in" (the pre-authenticated account)
        for (const el of candidates) {
          const txt = el.textContent || '';
          if (txt.includes('Signed in') && txt.includes(targetEmail.split('@')[0])) {
            el.click();
            return `JS click: ${txt.trim().replace(/\s+/g,' ').slice(0, 80)}`;
          }
        }
        // Fallback: any element with "Signed in"
        for (const el of candidates) {
          const txt = el.textContent || '';
          if (txt.includes('Signed in')) {
            el.click();
            return `JS click fallback: ${txt.trim().replace(/\s+/g,' ').slice(0, 80)}`;
          }
        }
        return null;
      }, email);

      if (jsResult) {
        ok(`Account tile clicked via JS: "${jsResult}"`);
        await hd(3000, 5000);
        return true;
      }

      // If JS eval didn't find it, check if we're already past the picker
      const titleNow = await page.title().catch(() => '');
      const urlNow   = page.url();
      if (!urlNow.includes('login') && !urlNow.includes('microsoftonline')) {
        info('Already past login — no picker needed');
        return true;
      }

      info('No account picker visible — will try standard login flow');
      return false;
    })();

    await pageInfo(page);
    await shot(page, '05_after_picker');

    // ── Wait for redirect and handle whatever screen appears ──
    // After clicking the account tile, Microsoft may show:
    //   a) "Stay signed in?" → click Yes
    //   b) Password prompt → enter password
    //   c) Direct redirect to ads.microsoft.com → nothing to do
    step('Handle post-picker screen');
    await hd(3000, 4000);
    let loginAttempts = 0;
    while (loginAttempts < 4) {
      loginAttempts++;
      const curUrl   = page.url();
      const curTitle = await page.title().catch(() => '');
      info(`[${loginAttempts}] URL: ${curUrl.split('?')[0]}  Title: ${curTitle}`);

      // ✅ Successfully landed on ads.microsoft.com
      if (curUrl.includes('ads.microsoft.com') && !curUrl.includes('Login')) {
        ok('Redirected to Microsoft Ads — signed in!');
        break;
      }

      // Handle "Stay signed in?"
      if (curTitle.toLowerCase().includes('stay signed in')) {
        info('Handling "Stay signed in?" → clicking Yes');
        await tryClick(page, ['#idSIButton9','input[value="Yes"]','button:has-text("Yes")'], 'Yes', 6000);
        await hd(4000, 6000);
        await shot(page, `0${5+loginAttempts}_stay_signed_in`);
        continue;
      }

      // Handle password prompt
      const passSel = await firstVisible(page, ['input[name="passwd"]','#i0118','input[type="password"]'], 3000);
      if (passSel) {
        info('Password prompt detected — entering password');
        const emailsFile = path.join(ROOT, 'emails.json');
        let pwd = null;
        if (fs.existsSync(emailsFile)) {
          const list = JSON.parse(fs.readFileSync(emailsFile,'utf8'));
          pwd = list.find(e => e.email === email)?.password || null;
        }
        if (pwd) {
          await hType(page, passSel, pwd);
          await tryClick(page, ['input[type="submit"]','button:has-text("Sign in")','#idSIButton9'], 'Sign in', 5000);
          await hd(5000, 7000);
          await shot(page, `0${5+loginAttempts}_after_password`);
          continue;
        } else {
          warn('No password found — waiting 30s for manual sign-in');
          await hd(30000, 30000);
          break;
        }
      }

      // Handle email entry (if picker didn't auto-fill)
      const emailSel = await firstVisible(page, ['input[name="loginfmt"]','#i0116'], 2000);
      if (emailSel) {
        const val = await page.locator(emailSel).first().inputValue().catch(()=>'');
        if (!val) {
          info('Email field empty — filling it');
          await hType(page, emailSel, email);
        }
        await tryClick(page, ['input[type="submit"]','#idSIButton9','button:has-text("Next")'], 'Next', 5000);
        await hd(4000, 6000);
        continue;
      }

      // Not on login, not on ads — wait for redirect
      info('Waiting for redirect...');
      await hd(4000, 5000);
    }

    await pageInfo(page);
    await shot(page, '06_after_signin_flow');

    // ── Save session after sign-in ─────────────────────────────
    step('Save session after sign-in');
    lastSession = await saveSession(context, 'post_signin');
    writeIndex({ restore_session: lastSession.sp, restore_time: ts() });

    // ── Wait for MS Ads to fully load ──────────────────────────
    step('Wait for Microsoft Ads dashboard to load');
    try { await page.waitForLoadState('networkidle', { timeout: 25000 }); } catch {}
    await hd(3000, 5000);
    await pageInfo(page);
    await shot(page, '06_ads_loaded');

    // ── Business form ──────────────────────────────────────────
    step('Wait for "Tell us about your business" (up to 90s for slow connections)');
    // Wait for page to settle first
    try { await page.waitForLoadState('networkidle', { timeout: 20000 }); } catch {}
    await hd(2000, 3000);
    await pageInfo(page);

    const bizSel = await firstVisible(page, [
      'text=Tell us about your business',
      'text=tell us about your business',
      'text=About your business',
      'text=Business information',
      'input[placeholder*="https://" i]',
      'input[placeholder*="website" i]',
    ], 90000);

    if (bizSel) {
      ok(`Business form found: ${bizSel}`);
      await shot(page, '07_biz_form');
      await hd(1500, 2500);
      await fillBusinessForm(page, biz, context);
    } else {
      warn('Business form not found — may already be on another screen');
      await shot(page, '07_no_biz_form');
      await pageInfo(page);
    }

    // ── Save after business form ───────────────────────────────
    step('Save session after business form');
    lastSession = await saveSession(context, 'post_biz');
    writeIndex({ restore_session: lastSession.sp });

    // ── How can we help ────────────────────────────────────────
    step('Wait for "How can we help you" screen');
    const helpSel = await firstVisible(page, [
      'text=How can we help',
      'text=how can we help',
      'text=What is your goal',
      'text=get started',
    ], 20000);

    if (helpSel) {
      ok(`"How can we help" screen found`);
      await shot(page, '08_how_help');
      await hd(1500, 2500);
      // Use JS eval to find the "Create account" option (could be a card/tile/button)
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
            return `clicked: "${el.textContent.trim().replace(/\s+/g,' ').slice(0,60)}"`;
          }
        }
        // Broader: any element with "create account"
        for (const el of candidates) {
          if ((el.textContent || '').toLowerCase().includes('create account')) {
            el.click();
            return `clicked broad: "${el.textContent.trim().replace(/\s+/g,' ').slice(0,60)}"`;
          }
        }
        return null;
      });
      if (createResult) { ok(`Create account: ${createResult}`); }
      else { await shot(page, '08_create_account_missing'); warn('Create account not found'); }
      await hd(3000, 5000);
      await pageInfo(page);
      await shot(page, '08_after_create_account');
    } else {
      info('"How can we help" not found — may be on next screen already');
    }

    // ── Save after how-can-we-help ─────────────────────────────
    lastSession = await saveSession(context, 'post_help');
    writeIndex({ restore_session: lastSession.sp });

    // ── Create account WITHOUT campaign ────────────────────────
    step('Select "Create account without a campaign"');
    await hd(2000, 3500);
    await pageInfo(page);
    await shot(page, '09_campaign_choice');

    await hd(2000, 3000);
    // The page shows two cards:
    //   Left:  "Create account and campaign"  (default selected)
    //   Right: "Create account only"          ← we want this one
    // After selecting the card, click the "Next" button.
    step('Click "Create account only" card');
    const createOnlyResult = await page.evaluate(() => {
      // Find every element whose direct text includes "Create account only"
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (/create account only/i.test(node.textContent)) {
          // Walk up to find the clickable card container
          let el = node.parentElement;
          while (el && el !== document.body) {
            // Card is likely a div/label with role or a direct parent of the title text
            const style = window.getComputedStyle(el);
            const tag   = el.tagName.toLowerCase();
            if (tag === 'label' || el.getAttribute('role') === 'radio' ||
                el.getAttribute('role') === 'button' || el.getAttribute('tabindex') === '0' ||
                (style.cursor === 'pointer') || tag === 'div' && el.children.length >= 1) {
              el.click();
              return `card clicked: "${el.textContent.trim().replace(/\s+/g,' ').slice(0,80)}"`;
            }
            el = el.parentElement;
          }
          // Fallback: click the text node's parent
          node.parentElement.click();
          return `parent clicked: "${node.parentElement.textContent.trim().slice(0,60)}"`;
        }
      }
      return null;
    });

    if (createOnlyResult) {
      ok(`"Create account only" selected: ${createOnlyResult}`);
      await hd(1500, 2500);
      await shot(page, '09_create_account_only_selected');

      // Now click the Next button to confirm the selection
      step('Click Next to confirm "Create account only"');
      const nextDone = await clickNextButton(page, '09_next_after_account_only');
      if (nextDone) {
        await hd(4000, 6000);
        try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}
        await pageInfo(page);
        await shot(page, '09_after_account_only_next');
      }
    } else {
      warn('"Create account only" card not found — check browser');
      await shot(page, '09_create_account_only_missing');
      await pageInfo(page);
    }

    // ── Account Details form (Address, VAT, etc.) ──────────────
    // This form appears after "Create account only" is selected
    step('Check for Account Details form');
    await hd(2000, 3000);
    const acctDetailsVisible = await page.locator([
      'text=Account details',
      'text=Legal business name',
      'text=Address line 1',
    ].join(',')).first().isVisible({ timeout: 15000 }).catch(() => false);

    if (acctDetailsVisible) {
      ok('Account Details form found — filling address fields');
      await shot(page, '10_account_details_form');
      await fillAccountDetailsForm(page, biz, context);
    } else {
      info('Account Details form not visible — skipping');
    }

    // ── Payment Page: Set up payment later → Yes → Create Campaign ──
    step('Check for Payment page');
    await hd(2000, 3000);
    const paymentVisible = await page.locator([
      'text=How would you like to pay',
      'text=Set up payment later',
      'text=Enter your payment method',
    ].join(',')).first().isVisible({ timeout: 15000 }).catch(() => false);

    if (paymentVisible) {
      ok('Payment page detected — clicking "Set up payment later"');
      await shot(page, '11_payment_page');

      // Click "Set up payment later" link
      let payLater = false;
      for (const sel of ['text=Set up payment later','a:has-text("Set up payment later")','button:has-text("Set up payment later")']) {
        try {
          const el = page.locator(sel).first();
          await el.waitFor({ state: 'visible', timeout: 8000 });
          await el.scrollIntoViewIfNeeded();
          await hd(600, 1000);
          await el.click();
          ok(`Clicked "Set up payment later" via: ${sel}`);
          payLater = true;
          break;
        } catch {}
      }
      if (!payLater) {
        const r = await page.evaluate(() => {
          for (const el of document.querySelectorAll('a,button,[role="button"]')) {
            if (/set\s+up\s+payment\s+later/i.test(el.innerText||'') && el.offsetParent) { el.click(); return el.innerText.trim(); }
          }
          return null;
        });
        if (r) { ok(`JS clicked: ${r}`); payLater = true; }
      }
      if (!payLater) warn('"Set up payment later" not found');

      // Wait for confirmation dialog
      await hd(2000, 3000);
      await shot(page, '11_payment_dialog');

      // Click "Yes" on "Are you sure?" dialog
      let yesClicked = false;
      for (const sel of ['button:has-text("Yes")','input[value="Yes"]','[role="button"]:has-text("Yes")']) {
        try {
          const el = page.locator(sel).first();
          await el.waitFor({ state: 'visible', timeout: 8000 });
          await hd(500, 800);
          await el.click();
          ok(`Clicked "Yes" via: ${sel}`);
          yesClicked = true;
          break;
        } catch {}
      }
      if (!yesClicked) {
        const r = await page.evaluate(() => {
          for (const el of document.querySelectorAll('button,[role="button"]')) {
            if (/^yes$/i.test((el.innerText||'').trim())) { el.click(); return 'yes'; }
          }
          return null;
        });
        if (r) { ok('JS clicked Yes'); yesClicked = true; }
      }
      if (!yesClicked) warn('"Yes" button not found on payment dialog');

      // Wait for dialog to close
      try { await page.locator('button:has-text("Yes")').waitFor({ state: 'hidden', timeout: 8000 }); } catch {}
      await hd(3000, 5000);
      await shot(page, '11_after_yes');

      // Click "Create Campaign" button (finalises account creation)
      step('Click "Create Campaign" to finalise account');
      let createClicked = false;
      for (const sel of [
        'button:has-text("Create Campaign")',
        'button:has-text("Create campaign")',
        'a:has-text("Create Campaign")',
        '[role="button"]:has-text("Create Campaign")',
      ]) {
        try {
          const el = page.locator(sel).first();
          await el.waitFor({ state: 'visible', timeout: 10000 });
          await el.scrollIntoViewIfNeeded();
          await hd(800, 1200);
          await el.click();
          ok(`Clicked "Create Campaign" via: ${sel}`);
          createClicked = true;
          break;
        } catch {}
      }
      if (!createClicked) {
        const r = await page.evaluate(() => {
          for (const el of document.querySelectorAll('button,a,[role="button"]')) {
            const t = (el.innerText||'').trim();
            if (/create\s+campaign/i.test(t) && el.offsetParent) { el.scrollIntoView(); el.click(); return t; }
          }
          return null;
        });
        if (r) { ok(`JS clicked: ${r}`); createClicked = true; }
      }
      if (!createClicked) warn('"Create Campaign" button not found');

      await hd(5000, 8000);
      try { await page.waitForLoadState('networkidle', { timeout: 20000 }); } catch {}
      await pageInfo(page);
      await shot(page, '11_after_create_campaign');
      if (context) { await saveSession(context, 'post_payment'); }
    } else {
      info('Payment page not detected — skipping payment step');
    }

    // ── Final session save ─────────────────────────────────────
    step('Save final session');
    lastSession = await saveSession(context, 'final');
    const { url: finalUrl } = await pageInfo(page);
    await shot(page, '12_final');

    // Mark as pending confirmation — NOT success yet
    writeIndex({
      restore_status: 'pending_confirm',
      restore_session: lastSession.sp,
      restore_cookie_file: lastSession.cp,
      restore_time: ts(),
      restore_final_url: finalUrl,
      restore_note: 'Completed setup steps — awaiting user visual confirmation',
    });
    appendRestoreLog({
      email,
      status: 'pending_confirm',
      session: lastSession.sp,
      final_url: finalUrl,
      time: ts(),
    });

    outcome = 'pending_confirm';

    console.log('\n' + '═'.repeat(62));
    console.log('  ⏳  SETUP STEPS COMPLETE — browser is open');
    console.log('  👁   Please check the browser visually.');
    console.log('  ✅  When you confirm the account is created,');
    console.log('      close the browser and tell me "done".');
    console.log('  💾  Session saved — nothing will be lost.');
    console.log('═'.repeat(62) + '\n');

  } catch (err) {
    outcome = 'failed';
    step('ERROR — capturing diagnostics');
    fail(`${err.message}`);
    if (err.stack) info('Stack: ' + err.stack.split('\n').slice(0,5).join(' | '));

    try {
      await pageInfo(page);
      await shot(page, 'error');
      const body = (await page.innerText('body').catch(()=>'')).replace(/\s+/g,' ').slice(0,400);
      info(`Page body: ${body}`);
    } catch {}

    // Still save whatever session we have
    try { lastSession = await saveSession(context, 'error'); } catch {}

    writeIndex({
      restore_status: 'failed',
      restore_error: err.message,
      restore_session: lastSession.sp,
      restore_time: ts(),
    });

    console.log(`\n  ✗  RESTORE FAILED: ${err.message}`);
    console.log(`     See logs/restore_steps_* and logs/screenshots/ for details.\n`);

  } finally {
    saveStepLog(outcome);
    console.log('💡 Browser staying open — close it manually when finished.\n');
    await new Promise(resolve => browser.on('disconnected', resolve));
    console.log(`👋 Browser closed.\n`);
  }
}

// ═══════════════════════════════════════════════════════════════
// BUSINESS FORM FILLER
// ═══════════════════════════════════════════════════════════════

async function fillBusinessForm(page, biz, context) {
  // ── Dump all inputs for debugging ───────────────────────────
  const inputInfo = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input, select, textarea')).map(el => ({
      tag: el.tagName, type: el.type || '', id: el.id || '', name: el.name || '',
      placeholder: el.placeholder || '', value: el.value || '',
      visible: !!(el.offsetWidth || el.offsetHeight),
    }));
  }).catch(() => []);
  info(`Inputs on page: ${JSON.stringify(inputInfo.filter(i => i.visible))}`);

  // ── Page 1: Website field only ───────────────────────────────
  step('Fill Website (Page 1)');
  const websiteSels = [
    'input[placeholder*="https://" i]',
    'input[placeholder*="website" i]',
    'input[name*="website" i]',
    'input[name*="url" i]',
    'input[type="url"]',
    'input[id*="website" i]',
  ];
  let websiteFilled = false;
  for (const s of websiteSels) {
    try {
      const el = page.locator(s).first();
      if (await el.isVisible({ timeout: 4000 })) {
        await el.click();
        await hd(200, 400);
        await el.fill('');
        await hd(200, 300);
        await el.type(biz.website, { delay: 60 });
        ok(`Website: ${biz.website}`);
        websiteFilled = true;
        break;
      }
    } catch {}
  }
  if (!websiteFilled) warn('Website field not found');
  await hd(800, 1200);

  // Check if this is page 1 (website only) or a single combined page
  const bizNameVisible = await page.locator([
    'input[placeholder*="business name" i]',
    'input[placeholder="Enter your business name"]',
    'input[id*="business" i]',
  ].join(',')).first().isVisible({ timeout: 3000 }).catch(() => false);

  if (!bizNameVisible) {
    // Multi-step: page 1 only has website → click Next to go to page 2
    step('Click Next on website page (Page 1 → Page 2)');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await hd(600, 1000);
    const n1Clicked = await clickNextButton(page, '07_p1_next');
    if (n1Clicked) {
      info('Navigated to Page 2 of business form');
      await hd(3000, 5000);
      try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}
      await hd(1000, 2000);
      // Re-dump inputs on page 2
      const p2Inputs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('input, select')).map(el => ({
          type: el.type || '', id: el.id || '', name: el.name || '',
          placeholder: el.placeholder || '', value: el.value || '',
          visible: !!(el.offsetWidth || el.offsetHeight),
        }));
      }).catch(() => []);
      info(`Page 2 inputs: ${JSON.stringify(p2Inputs.filter(i => i.visible))}`);
    }
  }

  await shot(page, '07_biz_p2');

  // ── Page 2 (or combined): Fill details ─────────────────────
  step('Fill Business Name (Page 2)');
  // Use JS eval to find and fill by placeholder — most reliable
  const bizNameResult = await page.evaluate((name) => {
    const inputs = Array.from(document.querySelectorAll('input'));
    for (const inp of inputs) {
      const ph = (inp.placeholder || '').toLowerCase();
      const id = (inp.id || '').toLowerCase();
      const nm = (inp.name || '').toLowerCase();
      if (ph.includes('business name') || ph.includes('company name') ||
          id.includes('business') || nm.includes('business') || nm.includes('company')) {
        if (inp.offsetWidth || inp.offsetHeight) { // visible
          inp.focus();
          inp.value = '';
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          // Also try setting via native input setter
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (nativeSetter) {
            nativeSetter.call(inp, name);
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return `filled: placeholder="${inp.placeholder}" id="${inp.id}"`;
        }
      }
    }
    return null;
  }, biz.businessName);

  if (bizNameResult) {
    ok(`Business name via JS eval: ${bizNameResult}`);
    // Also type it via Playwright to trigger React/Angular events
    try {
      const el = page.locator([
        'input[placeholder*="business name" i]',
        'input[placeholder="Enter your business name"]',
        'input[id*="business" i]',
        'input[name*="business" i]',
      ].join(',')).first();
      await el.click({ timeout: 3000 });
      await hd(200, 400);
      await el.fill(biz.businessName);
      ok(`Business name also typed: ${biz.businessName}`);
    } catch {}
  } else {
    warn('Business name field not found by JS eval');
  }
  await hd(700, 1200);

  // ── Location / Country ───────────────────────────────────────
  step('Set Country → Netherlands');
  try {
    const locResult = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('select'));
      for (const sel of selects) {
        const id = (sel.id || '').toLowerCase();
        const nm = (sel.name || '').toLowerCase();
        if (id.includes('location') || id.includes('country') ||
            nm.includes('location') || nm.includes('country')) {
          const opts = Array.from(sel.options).map(o => o.text);
          return `found: id="${sel.id}" options=${opts.slice(0,5).join(',')}`;
        }
      }
      // Also check if Netherlands is already shown anywhere
      const body = document.body.innerText;
      return body.includes('Netherlands') ? 'netherlands_visible' : 'no_country_select';
    });
    info(`Country check: ${locResult}`);
    if (locResult !== 'netherlands_visible' && locResult !== 'no_country_select') {
      // Try selecting Netherlands
      for (const s of ['select[id*="location" i]','select[id*="country" i]','select[name*="location" i]','select[name*="country" i]']) {
        try {
          if (await page.locator(s).first().isVisible({ timeout: 2000 })) {
            await page.locator(s).first().selectOption({ label: 'Netherlands' });
            ok('Country → Netherlands');
            await hd(500, 1000);
            break;
          }
        } catch {}
      }
    } else {
      info('Netherlands already shown or no dropdown');
    }
  } catch(e) { warn(`Country: ${e.message}`); }

  // ── Phone ────────────────────────────────────────────────────
  step('Fill Phone');
  const phoneResult = await page.evaluate((phone) => {
    const inputs = Array.from(document.querySelectorAll('input'));
    for (const inp of inputs) {
      const ph  = (inp.placeholder || '').toLowerCase();
      const id  = (inp.id || '').toLowerCase();
      const nm  = (inp.name || '').toLowerCase();
      const tp  = (inp.type || '').toLowerCase();
      if (tp === 'tel' || ph.includes('phone') || ph.includes('number') ||
          id.includes('phone') || nm.includes('phone')) {
        if (inp.offsetWidth || inp.offsetHeight) {
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (nativeSetter) {
            nativeSetter.call(inp, phone);
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return `filled: type="${inp.type}" placeholder="${inp.placeholder}" id="${inp.id}"`;
        }
      }
    }
    return null;
  }, biz.phone);

  if (phoneResult) {
    ok(`Phone via JS eval: ${phoneResult}`);
    // Also type via Playwright
    try {
      const el = page.locator(['input[type="tel"]','input[placeholder*="phone" i]','input[id*="phone" i]','input[name*="phone" i]'].join(',')).first();
      await el.click({ timeout: 3000 });
      await hd(200, 400);
      await el.fill(biz.phone);
      ok(`Phone also typed: ${biz.phone}`);
    } catch {}
  } else {
    // Final fallback: find any unfilled number-looking input
    try {
      const inputs = page.locator('input:not([type="email"]):not([type="checkbox"]):not([type="hidden"]):not([type="url"])');
      const cnt = await inputs.count();
      for (let i = 0; i < cnt; i++) {
        const el  = inputs.nth(i);
        const val = await el.inputValue().catch(() => '');
        const ph  = await el.getAttribute('placeholder').catch(() => '');
        if (!val && ph && /phone|number|tel/i.test(ph)) {
          await el.fill(biz.phone);
          ok(`Phone fallback (placeholder="${ph}"): ${biz.phone}`);
          break;
        }
      }
    } catch(e) { warn(`Phone fallback: ${e.message}`); }
  }
  await hd(700, 1200);

  // ── Address fields (shown on Account Details form) ──────────
  step('Fill Address fields');
  const addrFields = [
    { id: 'address-formLine1',     name: 'Line1',      val: biz.address1 },
    { id: 'address-formLine2',     name: 'Line2',      val: biz.address2 || '' },
    { id: 'address-formCity',      name: 'City',       val: biz.city },
    { id: 'address-formPostalCode',name: 'PostalCode', val: biz.zip },
  ];
  for (const { id, name, val } of addrFields) {
    if (!val) continue;
    try {
      const el = page.locator(`#${id}, input[name="${name}"]`).first();
      if (await el.isVisible({ timeout: 3000 })) {
        const cur = await el.inputValue().catch(() => '');
        if (!cur) {
          await el.click();
          await hd(100, 200);
          await el.fill(val);
          ok(`${id}: ${val}`);
        } else { info(`${id} already has: ${cur}`); }
      }
    } catch {}
    await hd(200, 400);
  }

  // State / Province dropdown
  step('Set State → North Holland');
  try {
    const stateSel = page.locator('#address-formStateOrProvince, select[name="address-StateOrProvince"]').first();
    if (await stateSel.isVisible({ timeout: 3000 })) {
      // Try to select by label matching biz.state or "North Holland"
      const target = biz.state || 'North Holland';
      const opts = await stateSel.locator('option').all();
      let matched = false;
      for (const opt of opts) {
        const txt = await opt.textContent().catch(() => '');
        if (txt.toLowerCase().includes(target.toLowerCase()) || target.toLowerCase().includes(txt.toLowerCase())) {
          const val = await opt.getAttribute('value');
          await stateSel.selectOption(val);
          ok(`State → ${txt}`);
          matched = true;
          break;
        }
      }
      if (!matched) {
        // Fallback: try value "NH" for North Holland
        await stateSel.selectOption({ value: 'NH' }).catch(() => {});
        ok('State → NH (North Holland fallback)');
      }
      await hd(400, 700);
    }
  } catch(e) { warn(`State dropdown: ${e.message}`); }

  // ── Email ────────────────────────────────────────────────────
  step('Fill Email on form');
  try {
    const emailInputs = page.locator('input[type="email"]');
    const cnt = await emailInputs.count();
    for (let i = 0; i < cnt; i++) {
      const el  = emailInputs.nth(i);
      const val = await el.inputValue().catch(() => '');
      if (!val) { await el.fill(biz.email); ok(`Form email: ${biz.email}`); break; }
      else       { info(`Form email already filled: ${val}`); break; }
    }
  } catch(e) { warn(`Email: ${e.message}`); }
  await hd(700, 1200);

  // ── Checkboxes ───────────────────────────────────────────────
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
          info(`Checked box ${i+1}`);
        }
      } catch {}
    }
  } catch(e) { warn(`Checkbox: ${e.message}`); }
  await hd(900, 1500);

  await shot(page, '07_biz_form_filled');
  if (context) { step('Save session mid-form'); await saveSession(context, 'mid_biz'); }

  // ── Click Next ───────────────────────────────────────────────
  step('Scroll + click Next on details page');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await hd(800, 1200);
  await shot(page, '07_biz_scrolled_bottom');
  await clickNextButton(page, '07_details_next');
  await hd(3000, 5000);
}

// Shared Next-button clicker
async function clickNextButton(page, shotLabel) {
  const nextSels = [
    'button:has-text("Next")',
    'button:has-text("Save and continue")',
    'button:has-text("Continue")',
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Done")',
    '[data-testid*="next" i]',
    '[aria-label*="Next" i]',
  ];
  for (const s of nextSels) {
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
  if (shotLabel) await shot(page, shotLabel + '_missing');
  warn('Next button not found');
  return false;
}

// ═══════════════════════════════════════════════════════════════
// ACCOUNT DETAILS FORM FILLER (Address, VAT, etc.)
// ═══════════════════════════════════════════════════════════════

async function fillAccountDetailsForm(page, biz, context) {
  // Dump inputs for debugging
  const inputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input,select')).map(el => ({
      type: el.type, id: el.id, name: el.name,
      placeholder: el.placeholder, value: el.value,
      visible: !!(el.offsetWidth || el.offsetHeight),
    }))
  ).catch(() => []);
  info(`Account details inputs: ${JSON.stringify(inputs.filter(i=>i.visible))}`);

  // Use JS eval to fill each field by placeholder / label proximity
  const filled = await page.evaluate((data) => {
    const results = [];
    const inputs = Array.from(document.querySelectorAll('input, select'));

    function fillInput(el, value) {
      if (!value) return false;
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(el, value);
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      el.value = value;
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    function findByLabel(labelText) {
      // Find label element containing the text, then find associated input
      const labels = Array.from(document.querySelectorAll('label, [class*="label"], h3, h4, strong, span'));
      for (const lbl of labels) {
        if ((lbl.textContent || '').toLowerCase().includes(labelText.toLowerCase())) {
          // Try for= attribute
          if (lbl.htmlFor) {
            const el = document.getElementById(lbl.htmlFor);
            if (el) return el;
          }
          // Try next sibling input
          let sib = lbl.nextElementSibling;
          while (sib) {
            if (sib.tagName === 'INPUT' || sib.tagName === 'SELECT') return sib;
            const inp = sib.querySelector('input, select');
            if (inp) return inp;
            sib = sib.nextElementSibling;
          }
          // Try parent's inputs
          const parent = lbl.parentElement;
          if (parent) {
            const inp = parent.querySelector('input, select');
            if (inp && inp.offsetWidth) return inp;
          }
        }
      }
      return null;
    }

    // Address line 1
    const addr1 = findByLabel('address line 1') ||
      inputs.find(i => /address.?line.?1|address1/i.test(i.placeholder + i.id + i.name));
    if (addr1 && fillInput(addr1, data.address1)) results.push(`address1: ${data.address1}`);

    // Address line 2 (optional)
    if (data.address2) {
      const addr2 = findByLabel('address line 2') ||
        inputs.find(i => /address.?line.?2|address2/i.test(i.placeholder + i.id + i.name));
      if (addr2 && fillInput(addr2, data.address2)) results.push(`address2: ${data.address2}`);
    }

    // City
    const city = findByLabel('city') ||
      inputs.find(i => /city/i.test(i.placeholder + i.id + i.name));
    if (city && fillInput(city, data.city)) results.push(`city: ${data.city}`);

    // ZIP
    const zip = findByLabel('zip') ||
      inputs.find(i => /zip|postal/i.test(i.placeholder + i.id + i.name));
    if (zip && fillInput(zip, data.zip)) results.push(`zip: ${data.zip}`);

    // State / Province (select)
    const selects = Array.from(document.querySelectorAll('select'));
    for (const sel of selects) {
      const id = (sel.id + sel.name + (sel.getAttribute('aria-label') || '')).toLowerCase();
      if (/state|province|region/i.test(id) || findByLabel('state or province') === sel) {
        // Try to find option matching state
        const opts = Array.from(sel.options);
        const match = opts.find(o => o.text.toLowerCase().includes(data.state.toLowerCase()) ||
                                     data.state.toLowerCase().includes(o.text.toLowerCase()));
        if (match) {
          sel.value = match.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          results.push(`state: ${match.text}`);
        }
        break;
      }
    }

    return results;
  }, { address1: biz.address1 || '', address2: biz.address2 || '', city: biz.city || '',
       state: biz.state || '', zip: biz.zip || '' });

  if (filled && filled.length) { ok(`Filled via JS: ${filled.join(' | ')}`); }
  else { warn('JS eval fill returned nothing — trying Playwright selectors'); }

  // Playwright fallback for any unfilled fields
  await hd(500, 800);
  const fieldMap = [
    { sel: 'input[placeholder*="Address line 1" i]', val: biz.address1 },
    { sel: 'input[placeholder*="Address line 2" i]', val: biz.address2 },
    { sel: 'input[placeholder*="City" i]',            val: biz.city },
    { sel: 'input[placeholder*="ZIP" i]',             val: biz.zip },
    { sel: 'input[placeholder*="postal" i]',          val: biz.zip },
  ];
  for (const { sel, val } of fieldMap) {
    if (!val) continue;
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 })) {
        const cur = await el.inputValue().catch(() => '');
        if (!cur) {
          await el.click();
          await hd(100, 200);
          await el.fill(val);
          ok(`Playwright filled: ${sel} = ${val}`);
        }
      }
    } catch {}
  }
  await hd(700, 1200);

  await shot(page, '10_account_details_filled');
  if (context) { await saveSession(context, 'post_acct_details'); }

  // Scroll and click Next
  step('Scroll + click Next on account details form');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await hd(800, 1200);
  await shot(page, '10_account_details_scrolled');
  await clickNextButton(page, '10_account_details_next');
  await hd(4000, 6000);
  await pageInfo(page);
  await shot(page, '10_after_account_details_next');
  if (context) { await saveSession(context, 'post_acct_details_next'); }
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

(async () => {
  if (!fs.existsSync(path.join(ROOT,'logs')))     fs.mkdirSync(path.join(ROOT,'logs'),    { recursive:true });
  if (!fs.existsSync(SESSIONS_DIR))               fs.mkdirSync(SESSIONS_DIR,              { recursive:true });
  if (!fs.existsSync(SCREENSHOTS_DIR))            fs.mkdirSync(SCREENSHOTS_DIR,           { recursive:true });

  const accounts = findRestoreAccounts();

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║     Microsoft Ads — Restore / Business Setup         ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  if (!accounts.length) {
    console.log('  No accounts with sessions found that need restoration.');
    console.log('  Run full_flow.js first to create accounts.\n');
    process.exit(0);
  }

  console.log('Accounts available for restore:\n');
  accounts.forEach(({email, data, sessionFile}, i) => {
    const restored = data.restore_status ? ` [${data.restore_status}]` : '';
    console.log(`  [${i+1}] ${email}${restored}`);
    console.log(`       Session  : ${sessionFile}`);
    console.log(`       Proxy    : ${data.proxy?.split(':').slice(0,2).join(':') || 'none'}`);
    console.log(`       Status   : ${data.status || 'unknown'}`);
    console.log();
  });

  const arg = process.argv[2];

  if (!arg) {
    console.log('Usage:');
    console.log('  node restore.js 1                  — account #1');
    console.log('  node restore.js email@hotmail.com  — specific email\n');
    process.exit(0);
  }

  let target;
  if (!isNaN(parseInt(arg))) {
    const idx = parseInt(arg) - 1;
    if (idx < 0 || idx >= accounts.length) {
      console.log(`❌ Invalid number. Pick 1–${accounts.length}`); process.exit(1);
    }
    target = accounts[idx];
  } else {
    target = accounts.find(a => a.email === arg);
    if (!target) {
      console.log(`❌ Email not found: ${arg}`); process.exit(1);
    }
  }

  // Load a random business entry (round-robin by position in list)
  const bizIndex = accounts.indexOf(target);
  const biz = loadBusiness(bizIndex);
  console.log(`\n📋 Business data: ${biz.businessName} / ${biz.website}\n`);

  await restoreAccount(target.email, target.data, target.sessionFile, biz);

})();
