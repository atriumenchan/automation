'use strict';
/**
 * shared.js — Common helpers for all step scripts
 */
const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const ROOT      = path.join(__dirname, '..');
const STATE_FILE = path.join(__dirname, 'state.json');
const SHOTS_DIR  = path.join(__dirname, 'screenshots');

// ── State management ─────────────────────────────────────────────
function getState() {
  if (!fs.existsSync(STATE_FILE)) throw new Error('state.json not found — run: node steps/init.js first');
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

function saveState(patch) {
  const cur = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
  const next = { ...cur, ...patch, updated_at: new Date().toISOString() };
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  return next;
}

// ── Browser ───────────────────────────────────────────────────────
async function openBrowser(state) {
  const proxy = state.proxy ? (() => {
    const [host, port, user, pass] = state.proxy.split(':');
    return { server: `http://${host}:${port}`, username: user, password: pass };
  })() : undefined;

  const browser = await chromium.launch({
    headless: false,
    slowMo: 80,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
    ...(proxy ? { proxy } : {}),
  });

  const ctx = await browser.newContext({
    storageState: state.session || undefined,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: null,
    locale: 'en-US',
  });

  const page = await ctx.newPage();

  // Navigate to last known URL so each step resumes where the previous left off
  if (state.last_url && !state.last_url.startsWith('about:')) {
    try {
      await page.goto(state.last_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      try { await page.waitForLoadState('load', { timeout: 20000 }); } catch {}
    } catch (e) {
      console.log(`  ⚠  Could not navigate to last_url: ${e.message.slice(0,60)}`);
    }
  }

  return { browser, ctx, page };
}

// ── Screenshot ───────────────────────────────────────────────────
async function shot(page, stepName) {
  if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const t = new Date().toISOString().replace(/[:.]/g, '-');
  const p = path.join(SHOTS_DIR, `${stepName}_${t}.png`);
  await page.screenshot({ path: p, fullPage: false, timeout: 0 });
  console.log(`  📸 ${path.basename(p)}`);
  saveState({ last_screenshot: p });
  return p;
}

// ── Save session ──────────────────────────────────────────────────
async function saveSession(ctx, state, label) {
  const t  = new Date().toISOString().replace(/[:.]/g, '-');
  const sp = path.join(ROOT, 'sessions', `${state.account.replace(/[@.]/g,'_')}_step_${label}_${t}.json`);
  await ctx.storageState({ path: sp });
  console.log(`  💾 Session: ${path.basename(sp)}`);
  saveState({ session: sp });
  return sp;
}

// ── Page info ─────────────────────────────────────────────────────
async function pageInfo(page) {
  const url   = page.url();
  const title = await page.title().catch(()=>'?');
  const body  = await page.evaluate(() => document.body.innerText.replace(/\s+/g,' ').slice(0,200)).catch(()=>'');
  console.log(`  URL  : ${url.slice(0,100)}`);
  console.log(`  Title: ${title}`);
  console.log(`  Text : ${body.slice(0,100)}`);
  saveState({ last_url: url, last_title: title });
  return { url, title, body };
}

// ── Helpers ───────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const hd    = (min=600, max=1500) => sleep(Math.floor(Math.random()*(max-min+1))+min);

async function tryClick(page, selectors, label='element') {
  for (const s of selectors) {
    try {
      const el = page.locator(s).first();
      await el.waitFor({ state: 'visible', timeout: 6000 });
      await hd(300, 700);
      await el.click();
      console.log(`  ✅ Clicked [${label}]: ${s}`);
      return true;
    } catch {}
  }
  console.log(`  ⚠  Could not click [${label}]`);
  return false;
}

async function fillVisible(page, selectors, value, label='field') {
  for (const s of selectors) {
    try {
      const el = page.locator(s).first();
      if (await el.isVisible({ timeout: 3000 })) {
        await el.click(); await hd(100, 300);
        await el.fill(value);
        console.log(`  ✅ Filled [${label}]: "${value.slice(0,30)}"`);
        return true;
      }
    } catch {}
  }
  console.log(`  ⚠  Could not fill [${label}]`);
  return false;
}

// ── Step wrapper ──────────────────────────────────────────────────
async function runStep(stepNum, stepName, fn) {
  console.log(`\n${'━'.repeat(55)}`);
  console.log(`  STEP ${stepNum}: ${stepName}`);
  console.log('━'.repeat(55));

  const state = getState();
  console.log(`  Account : ${state.account}`);
  console.log(`  Session : ${state.session ? path.basename(state.session) : 'none'}\n`);

  const { browser, ctx, page } = await openBrowser(state);

  try {
    await fn({ page, ctx, browser, state, shot: (n) => shot(page, n||`step${stepNum}_${stepName.replace(/\s+/g,'_')}`), hd, tryClick, fillVisible, saveSession: (l) => saveSession(ctx, state, l||stepNum), pageInfo: () => pageInfo(page) });
    saveState({ last_step: stepNum, last_step_name: stepName, last_step_status: 'ok' });
    console.log(`\n  ✅ Step ${stepNum} complete.\n`);
  } catch (err) {
    console.error(`\n  ✗ Step ${stepNum} failed: ${err.message}`);
    await shot(page, `step${stepNum}_ERROR`).catch(()=>{});
    saveState({ last_step: stepNum, last_step_name: stepName, last_step_status: 'failed', last_error: err.message });
    throw err;
  } finally {
    console.log('  Browser staying open — close when done.\n');
    await new Promise(r => browser.on('disconnected', r));
  }
}

module.exports = { getState, saveState, openBrowser, shot, saveSession, pageInfo, runStep, tryClick, fillVisible, sleep, hd, ROOT };
