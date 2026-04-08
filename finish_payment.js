'use strict';
const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const ROOT  = __dirname;
const email = 'sangdierdorfdu2580@hotmail.com';
const sessDir = path.join(ROOT, 'sessions');

// Use SUCCESS session (has the most cookies)
// Prefer SUCCESS_v2, then SUCCESS, then latest RESTORE
const allSess = fs.readdirSync(sessDir).filter(f => f.startsWith('sangdierdorfdu2580') && !f.includes('cookie'));
// Prefer latest SUCCESS_v*, then SUCCESS, then RESTORE
const success = [
  ...allSess.filter(f => /SUCCESS_v\d/.test(f)).sort().reverse(),
  ...allSess.filter(f => f.includes('SUCCESS') && !/SUCCESS_v\d/.test(f)).sort().reverse(),
  ...allSess.filter(f => f.includes('RESTORE')).sort().reverse(),
];
const sessionFile = path.join(sessDir, success[0]);
console.log('Session:', success[0]);

const shot = async (page, label) => {
  const t = new Date().toISOString().replace(/[:.]/g, '-');
  const p = path.join(ROOT, 'logs', 'screenshots', `finish_${label}_${t}.png`);
  await page.screenshot({ path: p, fullPage: false });
  console.log('📸', label, '->', p);
  return p;
};

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 100, args: ['--start-maximized'] });
  const ctx  = await browser.newContext({ storageState: sessionFile, viewport: null });
  const page = await ctx.newPage();

  // Navigate to payment page
  console.log('Navigating to payment page...');
  await page.goto(
    'https://ads.microsoft.com/signup/?aid=187212540&cid=254799223&uid=193049838',
    { waitUntil: 'domcontentloaded', timeout: 45000 }
  );
  try { await page.waitForLoadState('networkidle', { timeout: 20000 }); } catch {}
  await page.waitForTimeout(3000);

  console.log('URL:', page.url());
  console.log('Title:', await page.title());
  await shot(page, '01_payment_page');

  // Dump visible text to confirm we're on the right page
  const txt = await page.evaluate(() => document.body.innerText.replace(/\s+/g,' ').slice(0,300)).catch(()=>'');
  console.log('Page text:', txt);

  // ── Click "Set up payment later" ──────────────────────────────────────
  console.log('\nLooking for "Set up payment later"...');
  let clicked = false;

  // Try Playwright locators first
  for (const sel of [
    'text=Set up payment later',
    'a:has-text("Set up payment later")',
    'button:has-text("Set up payment later")',
    '[href*="payment"]',
    'a[href*="later"]',
  ]) {
    try {
      const el = page.locator(sel).first();
      await el.waitFor({ state: 'visible', timeout: 6000 });
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);
      await el.click();
      console.log('✅ Clicked via selector:', sel);
      clicked = true;
      break;
    } catch {}
  }

  // JS fallback — scan all clickable elements
  if (!clicked) {
    const result = await page.evaluate(() => {
      const candidates = [...document.querySelectorAll('a, button, [role="button"], span, div')];
      for (const el of candidates) {
        const t = (el.innerText || el.textContent || '').trim();
        if (/set\s+up\s+payment\s+later/i.test(t) && el.offsetParent !== null) {
          el.click();
          return t;
        }
      }
      return null;
    });
    if (result) { console.log('✅ JS clicked:', result); clicked = true; }
  }

  if (!clicked) {
    console.warn('⚠ Could not find "Set up payment later" — taking screenshot to debug');
    await shot(page, '02_not_found');
    // List all links on page for debugging
    const links = await page.evaluate(() =>
      [...document.querySelectorAll('a, button')].map(e => e.innerText.trim()).filter(Boolean).slice(0,30)
    );
    console.log('Links/buttons on page:', links);
  } else {
    await page.waitForTimeout(3000);
    await shot(page, '02_after_payment_later_click');
    console.log('URL now:', page.url());
  }

  // ── Click "Yes" confirmation ───────────────────────────────────────────
  console.log('\nLooking for "Yes" confirmation dialog...');
  let confirmed = false;

  for (const sel of [
    'button:has-text("Yes")',
    'input[value="Yes"]',
    '[role="button"]:has-text("Yes")',
  ]) {
    try {
      const el = page.locator(sel).first();
      await el.waitFor({ state: 'visible', timeout: 8000 });
      await page.waitForTimeout(600);
      await el.click();
      console.log('✅ Clicked Yes via:', sel);
      confirmed = true;
      break;
    } catch {}
  }

  if (!confirmed) {
    const r = await page.evaluate(() => {
      for (const el of document.querySelectorAll('button, [role="button"]')) {
        if (/^yes$/i.test((el.innerText || '').trim())) { el.click(); return 'yes'; }
      }
      return null;
    });
    if (r) { console.log('✅ JS clicked Yes'); confirmed = true; }
  }

  // Wait for the dialog to fully close before proceeding
  console.log('Waiting for dialog to close...');
  try {
    await page.locator('button:has-text("Yes")').waitFor({ state: 'hidden', timeout: 8000 });
    console.log('✅ Dialog closed');
  } catch { console.log('Dialog may have closed (timeout waiting for hidden)'); }
  await page.waitForTimeout(3000);
  await shot(page, '03_after_yes');
  console.log('URL after Yes:', page.url());

  // ── Click "Create Campaign" button (main blue CTA on payment page) ────
  console.log('\nLooking for "Create Campaign" button...');
  let campaignClicked = false;

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
      await page.waitForTimeout(1000);
      await el.click();
      console.log('✅ Clicked "Create Campaign" via:', sel);
      campaignClicked = true;
      break;
    } catch {}
  }

  if (!campaignClicked) {
    const r = await page.evaluate(() => {
      for (const el of document.querySelectorAll('button, a, [role="button"]')) {
        const t = (el.innerText || '').trim();
        if (/create\s+campaign/i.test(t) && el.offsetParent !== null) {
          el.scrollIntoView();
          el.click();
          return t;
        }
      }
      return null;
    });
    if (r) { console.log('✅ JS clicked:', r); campaignClicked = true; }
  }

  if (!campaignClicked) {
    console.warn('⚠ "Create Campaign" not found — dumping buttons:');
    const btns = await page.evaluate(() =>
      [...document.querySelectorAll('button, a, [role="button"]')]
        .map(e => (e.innerText||'').trim()).filter(Boolean).slice(0,30)
    );
    console.log('Buttons on page:', btns);
    await shot(page, '03b_campaign_not_found');
  }

  // Wait for the page to navigate after clicking Create Campaign
  console.log('Waiting for page to load after Create Campaign...');
  await page.waitForTimeout(8000);
  await shot(page, '04_final');
  console.log('Final URL:', page.url());
  console.log('Final Title:', await page.title());

  const finalTxt = await page.evaluate(() =>
    document.body.innerText.replace(/\s+/g,' ').slice(0,400)
  ).catch(()=>'');
  console.log('Final page text:', finalTxt);

  // Save session
  const t2 = new Date().toISOString().replace(/[:.]/g,'-');
  const finalSession = path.join(sessDir, `sangdierdorfdu2580_hotmail_com_SUCCESS_v4_${t2}.json`);
  await ctx.storageState({ path: finalSession });
  console.log('💾 Session saved:', path.basename(finalSession));

  // Update account_index.json
  const idxFile = path.join(ROOT, 'logs', 'account_index.json');
  try {
    const db = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
    db[email] = {
      ...db[email],
      status: 'success',
      restore_status: 'success',
      restore_final_url: page.url(),
      restore_time: new Date().toISOString(),
      note: 'Account fully created — payment set up later',
    };
    fs.writeFileSync(idxFile, JSON.stringify(db, null, 2));
    console.log('✅ account_index.json → success');
  } catch(e) { console.warn('index update failed:', e.message); }

  console.log('\n🎉 DONE — browser staying open, close when ready.');
  await new Promise(r => browser.on('disconnected', r));
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
