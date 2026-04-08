'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

// ================= CONFIG =================
const BUSINESS_DATA_FILE = path.join(ROOT, 'business.json');
const EMAILS_FILE = path.join(ROOT, 'emails.json');
const MS_ADS_URL = 'https://ads.microsoft.com';
const SCREENSHOTS_DIR = path.join(ROOT, 'logs', 'screenshots');

// ================= STEP TRACKER =================
// Every meaningful action is logged with step number, URL, title, what happened.

let _stepLog = [];
let _stepNum = 0;
let _currentEmail = '';

function step(msg) {
  _stepNum++;
  const entry = { step: _stepNum, time: new Date().toISOString(), msg };
  _stepLog.push(entry);
  console.log(`\n[STEP ${String(_stepNum).padStart(2, '0')}] ${msg}`);
  return entry;
}

function stepInfo(msg) {
  const entry = { step: _stepNum, time: new Date().toISOString(), msg: `  ↳ ${msg}` };
  _stepLog.push(entry);
  console.log(`          ${msg}`);
}

function stepOk(msg) {
  const entry = { step: _stepNum, time: new Date().toISOString(), msg: `  ✅ ${msg}` };
  _stepLog.push(entry);
  console.log(`       ✅ ${msg}`);
}

function stepWarn(msg) {
  const entry = { step: _stepNum, time: new Date().toISOString(), msg: `  ⚠️  ${msg}` };
  _stepLog.push(entry);
  console.log(`       ⚠️  ${msg}`);
}

function stepFail(msg) {
  const entry = { step: _stepNum, time: new Date().toISOString(), msg: `  ❌ ${msg}` };
  _stepLog.push(entry);
  console.log(`       ❌ ${msg}`);
}

function resetLog(email) {
  _stepLog = [];
  _stepNum = 0;
  _currentEmail = email;
}

async function pageContext(page) {
  try {
    const url = page.url();
    const title = await page.title().catch(() => '(no title)');
    stepInfo(`URL   : ${url}`);
    stepInfo(`Title : ${title}`);
    return { url, title };
  } catch (e) {
    stepInfo(`(could not read URL/title: ${e.message})`);
    return { url: '', title: '' };
  }
}

async function screenshot(page, label) {
  try {
    if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const safe = _currentEmail.replace(/[@.]/g, '_');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const fname = `${safe}_${label}_${ts}.png`;
    const fpath = path.join(SCREENSHOTS_DIR, fname);
    await page.screenshot({ path: fpath, fullPage: false });
    stepInfo(`Screenshot: logs/screenshots/${fname}`);
    return fpath;
  } catch (e) {
    stepInfo(`(screenshot failed: ${e.message})`);
    return null;
  }
}

function saveStepLog(email, status) {
  if (!fs.existsSync(path.join(ROOT, 'logs'))) fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
  const safe = email.replace(/[@.]/g, '_');
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const p = path.join(ROOT, 'logs', `restore_steps_${safe}_${ts}.json`);
  fs.writeFileSync(
    p,
    JSON.stringify({ email, status, time: new Date().toISOString(), steps: _stepLog }, null, 2)
  );
  console.log(`\n📋 Full step log: ${p}`);
}

// ================= HELPERS =================

function parseProxy(proxyStr) {
  const [host, port, user, pass] = proxyStr.split(':');
  return { server: `http://${host}:${port}`, username: user, password: pass };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const humanDelay = (min = 800, max = 2000) =>
  sleep(Math.floor(Math.random() * (max - min + 1)) + min);

async function humanType(page, selector, text) {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'visible', timeout: 10000 });
  await loc.click();
  try {
    await loc.clear();
  } catch {
    await page
      .evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) {
          el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, selector)
      .catch(() => {});
  }
  await humanDelay(300, 600);
  for (const char of String(text)) {
    await page.keyboard.type(char);
    await sleep(Math.floor(Math.random() * 100) + 40);
  }
}

// ================= LOAD BUSINESS DATA =================

function normalizeBusinessRow(row) {
  if (!row || typeof row !== 'object') return null;
  const phone = row.phone ?? row.Phone;
  return {
    website: row.website || row.Website || '',
    businessName: row.businessName || row['Business Name'] || '',
    email: row.email || row.Email || '',
    phone: phone != null ? String(phone) : '',
    country: row.country || row.Country || 'Netherlands',
  };
}

function loadBusinessData() {
  if (!fs.existsSync(BUSINESS_DATA_FILE)) {
    console.log(`❌ business.json not found at ${BUSINESS_DATA_FILE}`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(BUSINESS_DATA_FILE, 'utf8'));
  let picked;
  if (Array.isArray(raw)) {
    if (!raw.length) {
      console.log('❌ business.json is an empty array.');
      process.exit(1);
    }
    const bizIdx = process.argv[3];
    const i =
      bizIdx && !Number.isNaN(parseInt(bizIdx, 10))
        ? Math.max(0, parseInt(bizIdx, 10) - 1)
        : Math.floor(Math.random() * raw.length);
    const idx = i >= 0 && i < raw.length ? i : 0;
    picked = raw[idx];
    console.log(`📋 Using business row ${idx + 1} of ${raw.length}`);
  } else {
    picked = raw;
  }
  const data = normalizeBusinessRow(picked);
  console.log(`📋 Business : ${data.businessName}`);
  console.log(`📋 Website  : ${data.website}`);
  console.log(`📋 Phone    : ${data.phone}`);
  console.log(`📋 Country  : ${data.country}`);
  return data;
}

function loadPasswordForEmail(email) {
  if (!fs.existsSync(EMAILS_FILE)) return null;
  try {
    const list = JSON.parse(fs.readFileSync(EMAILS_FILE, 'utf8'));
    if (!Array.isArray(list)) return null;
    const row = list.find(
      (e) => e && e.email && String(e.email).toLowerCase() === String(email).toLowerCase()
    );
    return row?.password || null;
  } catch {
    return null;
  }
}

function resolveSessionPath(sessionFile) {
  if (!sessionFile) return null;
  return path.isAbsolute(sessionFile) ? sessionFile : path.join(ROOT, sessionFile);
}

// ================= LOAD ACCOUNTS =================

function listAccounts() {
  const indexPath = path.join(ROOT, 'logs', 'account_index.json');
  if (!fs.existsSync(indexPath)) {
    console.log('❌ No account_index.json found. Run index.js first to create accounts.');
    process.exit(1);
  }
  const db = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const accounts = Object.entries(db).filter(([_, v]) => v.status === 'success');
  if (!accounts.length) {
    console.log('❌ No accounts with status=success in account_index.json.');
    console.log('   Run index.js to create Microsoft Ads accounts first.\n');
    process.exit(1);
  }
  return accounts;
}

// ================= LOGGING =================

function saveSessionAfterRestore(email, data, sessionPath, cookiePath, result) {
  const indexPath = path.join(ROOT, 'logs', 'account_index.json');
  let db = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath)) : {};
  db[email] = {
    ...db[email],
    restore_session: sessionPath,
    restore_cookie_file: cookiePath,
    restore_time: new Date().toISOString(),
    restore_status: result.status,
    restore_final_url: result.finalUrl,
    restore_note: result.note || '',
  };
  fs.writeFileSync(indexPath, JSON.stringify(db, null, 2));

  const logPath = path.join(ROOT, 'logs', 'restore_log.json');
  let log = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath)) : [];
  log.push({ email, session: sessionPath, cookie_file: cookiePath, time: new Date().toISOString(), ...result });
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));

  const txtPath = path.join(ROOT, 'logs', 'restore_log.txt');
  const icon = result.status === 'success' ? '✅' : result.status === 'partial' ? '⚠️' : '❌';
  const line = [
    '─'.repeat(70),
    `${icon} ${result.status.toUpperCase()} — ${email}`,
    `   Session    : ${sessionPath || 'N/A'}`,
    `   Final URL  : ${result.finalUrl || 'N/A'}`,
    `   Time       : ${new Date().toISOString()}`,
    result.note ? `   Note       : ${result.note}` : null,
    '─'.repeat(70),
    '',
  ]
    .filter(Boolean)
    .join('\n');
  fs.appendFileSync(txtPath, line);
}

async function saveSession(context, email, label = '') {
  const sessionsDir = path.join(ROOT, 'sessions');
  if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });
  const safeEmail = email.replace(/[@.]/g, '_');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = label ? `_${label}` : '';
  const sessionPath = path.join(sessionsDir, `${safeEmail}_RESTORE${suffix}_${timestamp}.json`);
  const cookiePath = path.join(sessionsDir, `${safeEmail}_RESTORE${suffix}_${timestamp}_cookies.json`);
  await context.storageState({ path: sessionPath });
  const cookies = await context.cookies();
  fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));
  stepOk(`Session saved: ${path.relative(ROOT, sessionPath)} (${cookies.length} cookies)`);
  return { sessionPath, cookiePath };
}

// ================= CLICK HELPERS =================

async function clickNextBtn(page) {
  const selectors = ['input[type="submit"]', 'button:has-text("Next")', 'button:has-text("Sign in")', '#idSIButton9'];
  for (const sel of selectors) {
    try {
      if (await page.locator(sel).first().isVisible({ timeout: 3000 })) {
        await page.locator(sel).first().click();
        stepOk(`Clicked Next: ${sel}`);
        return true;
      }
    } catch {}
  }
  stepWarn('No Next/Sign-in button found');
  return false;
}

async function clickAny(page, selectors, label, timeoutMs = 5000) {
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: timeoutMs })) {
        await humanDelay(600, 1200);
        await el.click();
        stepOk(`Clicked "${label}" via: ${sel}`);
        return true;
      }
    } catch {}
  }
  stepWarn(`"${label}" not found — skipping`);
  return false;
}

// ================= HANDLE LOGIN =================

async function handleLogin(page, email, password) {
  step('Handle Microsoft login');
  await pageContext(page);

  if (!password) {
    stepFail(
      'No password available for this account. Add password to emails.json or sign in manually in the browser.'
    );
    await screenshot(page, 'no_password');
    return false;
  }

  try {
    step('Enter email on login page');
    const emailSel = await (async () => {
      for (const s of ['input[name="loginfmt"]', 'input[type="email"]', '#i0116']) {
        try {
          if (await page.locator(s).first().isVisible({ timeout: 5000 })) return s;
        } catch {}
      }
      return null;
    })();

    if (!emailSel) {
      stepFail('Email input not found on login page');
      await screenshot(page, 'email_field_missing');
      return false;
    }

    stepInfo(`Email field found: ${emailSel}`);
    await humanDelay(600, 1200);
    await humanType(page, emailSel, email);
    stepOk(`Typed email: ${email}`);
    await humanDelay(500, 1000);
    await clickNextBtn(page);
    await humanDelay(2000, 3500);
    await pageContext(page);

    step('Enter password');
    const passSel = await (async () => {
      for (const s of ['input[name="passwd"]', '#i0118', 'input[type="password"]']) {
        try {
          if (await page.locator(s).first().isVisible({ timeout: 8000 })) return s;
        } catch {}
      }
      return null;
    })();

    if (!passSel) {
      stepFail('Password field did not appear after entering email');
      await screenshot(page, 'password_field_missing');
      await pageContext(page);
      return false;
    }

    stepInfo(`Password field: ${passSel}`);
    await humanDelay(500, 1000);
    await humanType(page, passSel, password);
    stepOk('Password typed');
    await humanDelay(500, 1000);
    await clickNextBtn(page);
    await humanDelay(3000, 5000);
    await pageContext(page);

    step('Handle Stay signed in prompt');
    try {
      const stayBtn = page.locator('#idSIButton9');
      if (await stayBtn.isVisible({ timeout: 5000 })) {
        const html = await page.content();
        if (/stay signed in/i.test(html)) {
          await humanDelay(800, 1500);
          await stayBtn.click();
          stepOk('Clicked Yes on Stay signed in');
          await humanDelay(2000, 3000);
        }
      } else {
        stepInfo('No Stay signed in prompt');
      }
    } catch (e) {
      stepInfo(`Stay signed in check: ${e.message}`);
    }

    return true;
  } catch (err) {
    stepFail(`Login error: ${err.message}`);
    await screenshot(page, 'login_error');
    await pageContext(page);
    return false;
  }
}

// ================= HANDLE ACCOUNT PICKER =================

async function handleAccountPicker(page, email) {
  step('Check for Microsoft account picker');
  await humanDelay(2000, 3500);
  await pageContext(page);

  const accountSelectors = [
    `div[data-test-id="${email}"]`,
    `div[aria-label*="${email}"]`,
    `[data-optimizely-email="${email}"]`,
    `.tile:has-text("${email}")`,
    `div.account-item:has-text("${email}")`,
    `div:has-text("${email}")`,
  ];

  for (const sel of accountSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 3000 })) {
        stepInfo(`Found account tile via: ${sel}`);
        await humanDelay(800, 1500);
        await el.click();
        await humanDelay(2000, 4000);
        stepOk('Clicked account in picker');
        return;
      }
    } catch {}
  }

  try {
    const emailEl = page.getByText(email, { exact: false }).first();
    if (await emailEl.isVisible({ timeout: 5000 })) {
      stepInfo(`Found email text on page`);
      await humanDelay(800, 1500);
      await emailEl.click();
      await humanDelay(2000, 4000);
      stepOk('Clicked email text in account picker');
      return;
    }
  } catch {}

  stepInfo('No account picker found — proceeding');
}

// ================= HANDLE BUSINESS FORM =================

async function handleBusinessForm(page, biz) {
  step('Look for business form (Tell us about your business)');
  await pageContext(page);

  const detected = await (async () => {
    for (const s of [
      'text=Tell us about your business',
      'text=tell us about your business',
      'text=About your business',
      'text=Business information',
    ]) {
      try {
        if (await page.locator(s).first().isVisible({ timeout: 8000 })) return s;
      } catch {}
    }
    return null;
  })();

  if (!detected) {
    stepInfo('Business form not found — may already be filled or screen not reached');
    return false;
  }

  stepOk(`Business form detected via: ${detected}`);
  await screenshot(page, 'business_form');
  await humanDelay(1500, 2500);

  // WEBSITE
  step('Fill Website field');
  const websiteSels = [
    'input[placeholder*="website" i]',
    'input[name*="website" i]',
    'input[name*="url" i]',
    'input[type="url"]',
    'input[id*="website" i]',
  ];
  let websiteFilled = false;
  for (const sel of websiteSels) {
    try {
      if (await page.locator(sel).first().isVisible({ timeout: 3000 })) {
        await humanType(page, sel, biz.website);
        stepOk(`Website filled: ${biz.website} (selector: ${sel})`);
        websiteFilled = true;
        break;
      }
    } catch {}
  }
  if (!websiteFilled) stepWarn(`Website field not found. Tried: ${websiteSels.join(', ')}`);
  await humanDelay(800, 1500);

  // BUSINESS NAME
  step('Fill Business Name field');
  const bizNameSels = [
    'input[placeholder*="business name" i]',
    'input[name*="businessName" i]',
    'input[name*="companyName" i]',
    'input[id*="businessName" i]',
    'input[name*="business" i]',
  ];
  let bizFilled = false;
  for (const sel of bizNameSels) {
    try {
      if (await page.locator(sel).first().isVisible({ timeout: 3000 })) {
        await humanType(page, sel, biz.businessName);
        stepOk(`Business name filled: ${biz.businessName} (selector: ${sel})`);
        bizFilled = true;
        break;
      }
    } catch {}
  }
  if (!bizFilled) stepWarn(`Business name field not found. Tried: ${bizNameSels.join(', ')}`);
  await humanDelay(800, 1500);

  // EMAIL
  step('Fill Email field');
  const emailSels = [
    'input[type="email"]:not([name*="login" i])',
    'input[placeholder*="email" i]',
    'input[name*="email" i]:not([name*="login" i])',
  ];
  let emailFilled = false;
  for (const sel of emailSels) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 3000 })) {
        const val = await el.inputValue().catch(() => '');
        if (!val) {
          await humanType(page, sel, biz.email);
          stepOk(`Email filled: ${biz.email} (selector: ${sel})`);
        } else {
          stepInfo(`Email already filled: ${val}`);
        }
        emailFilled = true;
        break;
      }
    } catch {}
  }
  if (!emailFilled) stepWarn(`Email field not found. Tried: ${emailSels.join(', ')}`);
  await humanDelay(800, 1500);

  // PHONE
  step('Fill Phone field');
  const phoneSels = [
    'input[type="tel"]',
    'input[placeholder*="phone" i]',
    'input[name*="phone" i]',
  ];
  let phoneFilled = false;
  for (const sel of phoneSels) {
    try {
      if (await page.locator(sel).first().isVisible({ timeout: 3000 })) {
        await humanType(page, sel, biz.phone);
        stepOk(`Phone filled: ${biz.phone} (selector: ${sel})`);
        phoneFilled = true;
        break;
      }
    } catch {}
  }
  if (!phoneFilled) stepWarn(`Phone field not found. Tried: ${phoneSels.join(', ')}`);
  await humanDelay(800, 1500);

  // COUNTRY / LOCATION
  step('Set Country/Location');
  const countrySels = [
    'select[name*="location" i]',
    'select[name*="country" i]',
    'select[id*="location" i]',
    'select[id*="country" i]',
  ];
  let countrySet = false;
  for (const sel of countrySels) {
    try {
      if (await page.locator(sel).first().isVisible({ timeout: 3000 })) {
        await page.locator(sel).first().selectOption({ label: biz.country || 'Netherlands' });
        stepOk(`Country set: ${biz.country} (selector: ${sel})`);
        countrySet = true;
        break;
      }
    } catch {}
  }
  if (!countrySet) stepWarn(`Country selector not found. Tried: ${countrySels.join(', ')}`);
  await humanDelay(800, 1500);

  // CHECKBOXES
  step('Check all unchecked checkboxes');
  try {
    const checkboxes = page.locator('input[type="checkbox"]');
    const count = await checkboxes.count();
    stepInfo(`Found ${count} checkboxes`);
    let checked = 0;
    for (let i = 0; i < count; i++) {
      try {
        const cb = checkboxes.nth(i);
        const isChecked = await cb.isChecked();
        if (!isChecked) {
          await humanDelay(300, 600);
          await cb.click();
          checked++;
          stepInfo(`Checked checkbox ${i + 1}`);
        }
      } catch (e) {
        stepWarn(`Checkbox ${i + 1} failed: ${e.message}`);
      }
    }
    stepOk(`Checked ${checked} new checkbox(es)`);
  } catch (e) {
    stepWarn(`Checkbox handling error: ${e.message}`);
  }
  await humanDelay(1000, 2000);

  await screenshot(page, 'business_form_filled');

  // CLICK NEXT
  step('Click Next on business form');
  const nextSels = [
    'button:has-text("Save and continue")',
    'button:has-text("Next")',
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Continue")',
    'button:has-text("Done")',
  ];
  const clicked = await clickAny(page, nextSels, 'Next/Continue on business form', 5000);
  if (!clicked) {
    await screenshot(page, 'next_button_missing');
    await pageContext(page);
  }
  await humanDelay(3000, 5000);
  return true;
}

// ================= HANDLE HOW CAN WE HELP =================

async function handleHowCanWeHelp(page) {
  step('Look for "How can we help you" screen');
  await pageContext(page);

  const detected = await (async () => {
    for (const s of ['text=how can we help', 'text=How can we help', 'text=What is your goal']) {
      try {
        if (await page.locator(s).first().isVisible({ timeout: 10000 })) return s;
      } catch {}
    }
    return null;
  })();

  if (!detected) {
    stepInfo('"How can we help" not found — skipping');
    return false;
  }

  stepOk(`Screen detected via: ${detected}`);
  await screenshot(page, 'how_can_we_help');
  await humanDelay(1500, 2500);

  const createSels = [
    'text=Create account',
    'button:has-text("Create account")',
    '[aria-label="Create account"]',
    'div:has-text("Create account")',
  ];

  const clicked = await clickAny(page, createSels, 'Create account', 6000);
  if (!clicked) {
    await screenshot(page, 'create_account_missing');
    await pageContext(page);
  }
  await humanDelay(3000, 5000);
  return clicked;
}

// ================= HANDLE CAMPAIGN CHOICE =================

async function handleCampaignChoice(page) {
  step('Look for campaign choice screen');
  await pageContext(page);
  await humanDelay(2000, 3000);

  const skipSels = [
    'text=Create an account without a campaign',
    'text=Skip campaign creation',
    'text=without a campaign',
    'text=without campaign',
    'button:has-text("Skip")',
    'a:has-text("Skip")',
    'text=create an account',
  ];

  const clicked = await clickAny(page, skipSels, 'Skip campaign', 8000);
  if (clicked) {
    await humanDelay(3000, 5000);
    await pageContext(page);
  }
  return clicked;
}

// ================= PROCESS ACCOUNT =================

async function processAccount(email, data, businessData) {
  resetLog(email);

  step('Initialise account processing');
  const sessionFile = data.session;
  const sessionResolved = resolveSessionPath(sessionFile);
  const password = loadPasswordForEmail(email) || data.password || null;

  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`  🚀 Account    : ${email}`);
  console.log(`  🌐 Proxy      : ${data.proxy || 'none'}`);
  console.log(`  💾 Session    : ${sessionFile || 'none'}`);
  console.log(`  🔑 Password   : ${password ? '✅ loaded' : '❌ NOT FOUND in emails.json'}`);
  console.log(`  📋 Business   : ${businessData.businessName} / ${businessData.website}`);
  console.log(`╚══════════════════════════════════════════════╝`);

  const launchOptions = {
    headless: false,
    slowMo: 50,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
  };

  if (data.proxy) {
    launchOptions.proxy = parseProxy(data.proxy);
    stepInfo(`Proxy: ${data.proxy.split(':').slice(0, 2).join(':')}`);
  } else {
    stepInfo('No proxy configured');
  }

  step('Launch browser');
  const browser = await chromium.launch(launchOptions);

  const contextOptions = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    screen: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    isMobile: false,
    hasTouch: false,
    deviceScaleFactor: 1,
  };

  step('Load session file');
  if (sessionResolved && fs.existsSync(sessionResolved)) {
    contextOptions.storageState = sessionResolved;
    stepOk(`Loaded: ${sessionResolved}`);
  } else {
    stepWarn(
      `Session file not found: ${sessionFile || 'none'} → browser will start fresh (no cookies)`
    );
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  let result = { status: 'failed', finalUrl: '', note: '' };
  let savedSession = { sessionPath: null, cookiePath: null };

  try {
    step('Navigate to Microsoft Ads');
    await page.goto(MS_ADS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await humanDelay(2000, 4000);
    const { url: landingUrl } = await pageContext(page);
    await screenshot(page, 'landing');

    // ── LOGIN if needed ──────────────────────────────────────────
    if (landingUrl.includes('login') || landingUrl.includes('microsoftonline') || landingUrl.includes('live.com')) {
      step('Session expired / not logged in — starting login flow');
      const loginOk = await handleLogin(page, email, password);
      if (!loginOk) {
        result.note = 'Login failed — see steps above for exact reason';
        throw new Error(result.note);
      }
      await humanDelay(2000, 4000);
      await pageContext(page);
    } else {
      stepOk('Session valid — already authenticated');
    }

    // ── SIGN IN BUTTON ────────────────────────────────────────────
    step('Check for Sign In button on MS Ads landing page');
    await clickAny(
      page,
      ['a:has-text("Sign in")', 'button:has-text("Sign in")'],
      'Sign in',
      4000
    );
    await humanDelay(2000, 4000);

    // ── CONTINUE WITH MICROSOFT ───────────────────────────────────
    step('Check for Continue with Microsoft button');
    await clickAny(
      page,
      ['button:has-text("Continue with Microsoft")', 'a:has-text("Continue with Microsoft")'],
      'Continue with Microsoft',
      4000
    );
    await humanDelay(2000, 4000);

    // ── ACCOUNT PICKER ────────────────────────────────────────────
    await handleAccountPicker(page, email);

    // ── SAVE SESSION POST-LOGIN ───────────────────────────────────
    step('Save session post-login');
    savedSession = await saveSession(context, email, 'post_login');

    // ── WAIT FOR MS ADS DASHBOARD ─────────────────────────────────
    step('Wait for Microsoft Ads to fully load');
    await humanDelay(3000, 5000);
    await pageContext(page);
    await screenshot(page, 'after_login');

    // ── BUSINESS FORM ─────────────────────────────────────────────
    const bizFormShown = await handleBusinessForm(page, businessData);
    if (bizFormShown) {
      step('Save session post-business-form');
      savedSession = await saveSession(context, email, 'post_business');
    }

    // ── HOW CAN WE HELP ───────────────────────────────────────────
    await handleHowCanWeHelp(page);

    // ── CAMPAIGN CHOICE ───────────────────────────────────────────
    await handleCampaignChoice(page);

    // ── FINAL ─────────────────────────────────────────────────────
    step('Finalise');
    await humanDelay(3000, 5000);
    const { url: finalUrl } = await pageContext(page);
    await screenshot(page, 'final');
    savedSession = await saveSession(context, email, 'final');

    result = { status: 'success', finalUrl, note: 'Restore completed successfully' };

    console.log(`\n🎉 SUCCESS: ${email}`);
    console.log(`   🌐 Final URL: ${finalUrl}\n`);
  } catch (err) {
    // ── FULL ERROR REPORT ──────────────────────────────────────────
    step('ERROR — capturing diagnostic info');
    stepFail(`Error message : ${err.message}`);
    if (err.stack) {
      const shortStack = err.stack.split('\n').slice(0, 6).join('\n');
      stepInfo(`Stack trace:\n${shortStack}`);
    }

    try {
      const { url: errUrl, title: errTitle } = await pageContext(page);
      await screenshot(page, 'error');

      const bodyText = await page.innerText('body').catch(() => '');
      const snippet = bodyText.replace(/\s+/g, ' ').trim().slice(0, 400);
      stepInfo(`Page body snippet: ${snippet}`);

      result.note = `${err.message} | URL: ${errUrl} | Title: ${errTitle}`;
    } catch (diagErr) {
      stepInfo(`(diagnostics also failed: ${diagErr.message})`);
      result.note = err.message;
    }

    result.status = 'failed';
    result.finalUrl = page.url().catch ? '' : page.url();

    console.log(`\n❌ FAILED: ${email}`);
    console.log(`   Error: ${err.message}`);
    console.log(`   See step log + screenshots in logs/ for full details.\n`);

    try {
      savedSession = await saveSession(context, email, 'error');
    } catch {}
  } finally {
    if (savedSession.sessionPath) {
      saveSessionAfterRestore(email, data, savedSession.sessionPath, savedSession.cookiePath, result);
    }
    saveStepLog(email, result.status);

    console.log('\n💡 Browser staying open — close it manually when done.\n');
    await new Promise((resolve) => browser.on('disconnected', resolve));
    console.log(`👋 Browser closed for: ${email}\n`);
  }
}

// ================= MAIN =================

(async () => {
  if (!fs.existsSync(path.join(ROOT, 'logs'))) fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
  if (!fs.existsSync(path.join(ROOT, 'sessions'))) fs.mkdirSync(path.join(ROOT, 'sessions'), { recursive: true });

  const accounts = listAccounts();
  const businessData = loadBusinessData();

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║      Microsoft Ads — Restore / Setup Tool    ║');
  console.log('╚══════════════════════════════════════════════╝\n');
  console.log('Available accounts (status=success):\n');
  accounts.forEach(([email, data], i) => {
    const sessionOk = data.session && fs.existsSync(resolveSessionPath(data.session)) ? '✅' : '❌ missing';
    console.log(`  [${i + 1}] ${email}`);
    console.log(`       📮 Secondary : ${data.secondary_email || 'N/A'}`);
    console.log(`       🌐 Proxy     : ${data.proxy || 'N/A'}`);
    console.log(`       💾 Session   : ${data.session || 'N/A'}  ${sessionOk}`);
    console.log(`       🕐 Created   : ${data.created_at || 'N/A'}`);
    console.log();
  });

  const arg = process.argv[2];
  if (!arg) {
    console.log('Usage:');
    console.log('  node restore.js 1           — process account #1');
    console.log('  node restore.js all         — process all accounts');
    console.log('  node restore.js 1 3         — account #1, business row #3\n');
    process.exit(0);
  }

  if (arg.toLowerCase() === 'all') {
    console.log(`\n🚀 Processing all ${accounts.length} accounts...\n`);
    for (const [email, data] of accounts) {
      await processAccount(email, data, businessData);
      if (accounts.indexOf([email, data]) < accounts.length - 1) {
        console.log('\n⏳ Waiting 10s before next account...\n');
        await sleep(10000);
      }
    }
    return;
  }

  const index = parseInt(arg) - 1;
  if (isNaN(index) || index < 0 || index >= accounts.length) {
    console.log(`❌ Invalid account number. Pick between 1 and ${accounts.length}`);
    process.exit(1);
  }

  const [email, data] = accounts[index];
  await processAccount(email, data, businessData);
})();
