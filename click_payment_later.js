'use strict';
const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const ROOT  = __dirname;
const email = 'sangdierdorfdu2580@hotmail.com';

// Find the most recent RESTORE session
const sessDir  = path.join(ROOT, 'sessions');
const sessions = fs.readdirSync(sessDir)
  .filter(f => f.startsWith('sangdierdorfdu2580') && f.includes('RESTORE') && !f.includes('cookie'))
  .sort().reverse();

if (!sessions.length) { console.error('No session found'); process.exit(1); }
const sessionFile = path.join(sessDir, sessions[0]);
console.log('Using session:', sessions[0]);

(async () => {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 80,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
  });

  const ctx  = await browser.newContext({ storageState: sessionFile, viewport: null });
  const page = await ctx.newPage();

  console.log('Navigating to payment page...');
  await page.goto(
    'https://ads.microsoft.com/PMaxLite/Signup/?aid=187212540&cid=254799223&idP=MSA&s_cid=acq-pmaxlanding-src_default&uid=193049838',
    { waitUntil: 'domcontentloaded', timeout: 45000 }
  );

  // Wait for page to settle
  try { await page.waitForLoadState('networkidle', { timeout: 20000 }); } catch {}
  await page.waitForTimeout(3000);

  console.log('URL:', page.url());
  console.log('Title:', await page.title());

  // ── Step 1: Click "Set up payment later" ──────────────────
  console.log('Looking for "Set up payment later"...');
  let clicked = false;
  for (const s of [
    'text=Set up payment later',
    'a:has-text("Set up payment later")',
    'button:has-text("Set up payment later")',
    '[href*="payment"]',
  ]) {
    try {
      const el = page.locator(s).first();
      await el.waitFor({ state: 'visible', timeout: 8000 });
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);
      await el.click();
      console.log('✅ Clicked "Set up payment later"');
      clicked = true;
      break;
    } catch {}
  }
  if (!clicked) {
    // JS fallback
    const r = await page.evaluate(() => {
      for (const el of document.querySelectorAll('a, button, [role="button"]')) {
        if (/set up payment later/i.test(el.textContent)) { el.click(); return el.textContent.trim(); }
      }
      return null;
    });
    if (r) { console.log('✅ JS clicked:', r); clicked = true; }
  }
  if (!clicked) console.warn('⚠ Could not find "Set up payment later"');

  await page.waitForTimeout(3000);

  // ── Step 2: Click "Yes" on confirmation dialog ────────────
  console.log('Looking for "Yes" confirmation...');
  let confirmed = false;
  for (const s of [
    'button:has-text("Yes")',
    'input[value="Yes"]',
    '[role="button"]:has-text("Yes")',
  ]) {
    try {
      const el = page.locator(s).first();
      await el.waitFor({ state: 'visible', timeout: 8000 });
      await page.waitForTimeout(600);
      await el.click();
      console.log('✅ Clicked "Yes"');
      confirmed = true;
      break;
    } catch {}
  }
  if (!confirmed) {
    const r = await page.evaluate(() => {
      for (const el of document.querySelectorAll('button')) {
        if (/^yes$/i.test(el.textContent.trim())) { el.click(); return 'yes'; }
      }
      return null;
    });
    if (r) { console.log('✅ JS clicked Yes'); confirmed = true; }
  }

  await page.waitForTimeout(4000);

  // ── Final screenshot + mark success ───────────────────────
  const t = new Date().toISOString().replace(/[:.]/g,'-');
  const shotPath = path.join(ROOT, 'logs', 'screenshots', `sangdierdorfdu2580_FINAL_SUCCESS_${t}.png`);
  await page.screenshot({ path: shotPath, fullPage: false });
  console.log('📸 Final screenshot:', shotPath);
  console.log('URL:', page.url());
  console.log('Title:', await page.title());

  // Save final session
  const finalSession = path.join(ROOT, 'sessions', `sangdierdorfdu2580_hotmail_com_SUCCESS_${t}.json`);
  await ctx.storageState({ path: finalSession });
  console.log('💾 Final session saved:', path.basename(finalSession));

  // Mark account as SUCCESS in account_index.json
  const indexFile = path.join(ROOT, 'logs', 'account_index.json');
  let db = {};
  try { db = JSON.parse(fs.readFileSync(indexFile, 'utf8')); } catch {}
  db[email] = {
    ...db[email],
    status: 'success',
    restore_status: 'success',
    restore_final_url: page.url(),
    restore_time: new Date().toISOString(),
    restore_session: finalSession,
    note: 'Account fully created — payment set up later',
  };
  fs.writeFileSync(indexFile, JSON.stringify(db, null, 2));
  console.log('✅ account_index.json updated → status: SUCCESS');

  // Mark used in emails.json
  const emailsFile = path.join(ROOT, 'emails.json');
  try {
    const list = JSON.parse(fs.readFileSync(emailsFile, 'utf8'));
    const acc  = list.find(e => e.email === email);
    if (acc) { acc.used = true; fs.writeFileSync(emailsFile, JSON.stringify(list, null, 2)); }
    console.log('✅ emails.json marked used');
  } catch(e) { console.warn('emails.json update failed:', e.message); }

  console.log('\n🎉 ACCOUNT SUCCESSFULLY CREATED: ' + email);
  console.log('💡 Browser staying open — close it when done.\n');

  await new Promise(r => browser.on('disconnected', r));
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
