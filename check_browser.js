'use strict';
const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const ROOT  = __dirname;
const email = 'sangdierdorfdu2580@hotmail.com';

const sessDir  = path.join(ROOT, 'sessions');
// Prefer SUCCESS session, then most-recent RESTORE, then post_login
const all = fs.readdirSync(sessDir).filter(f => f.startsWith('sangdierdorfdu2580') && !f.includes('cookie'));

// Prefer SUCCESS, then latest RESTORE by date, then post_login
const success  = all.filter(f => f.includes('SUCCESS')).sort().reverse();
const restores = all.filter(f => f.includes('RESTORE')).sort().reverse();
const others   = all.filter(f => !f.includes('SUCCESS') && !f.includes('RESTORE')).sort().reverse();
const sessions = [...success, ...restores, ...others];

console.log('All sessions found:');
sessions.slice(0, 5).forEach(s => console.log(' -', s));

if (!sessions.length) { console.error('No session found'); process.exit(1); }
const sessionFile = path.join(sessDir, sessions[0]);
console.log('\nUsing session:', sessions[0]);

const shot = (page, label) => {
  const t = new Date().toISOString().replace(/[:.]/g, '-');
  const p = path.join(ROOT, 'logs', 'screenshots', `check_${label}_${t}.png`);
  return page.screenshot({ path: p, fullPage: false }).then(() => { console.log('📸', label, p); });
};

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 80, args: ['--start-maximized'] });
  const ctx  = await browser.newContext({ storageState: sessionFile, viewport: null });
  const page = await ctx.newPage();

  console.log('\nNavigating to ads.microsoft.com...');
  await page.goto('https://ads.microsoft.com/', { waitUntil: 'domcontentloaded', timeout: 40000 });
  try { await page.waitForLoadState('networkidle', { timeout: 20000 }); } catch {}
  await page.waitForTimeout(3000);
  await shot(page, '01_initial');
  console.log('URL:', page.url(), '| Title:', await page.title());

  // ── If we hit the Microsoft sign-in page, click the pre-authed tile ──
  for (let attempt = 0; attempt < 10; attempt++) {
    const url = page.url();

    // Account picker: click the tile for our email
    if (url.includes('login.microsoftonline.com') || url.includes('login.live.com')) {
      console.log('Account picker detected, clicking tile...');
      const clicked = await page.evaluate((em) => {
        const all = document.querySelectorAll('[role="button"], [tabindex="0"], .tile, .account, [data-bind]');
        for (const el of all) {
          const txt = (el.innerText || el.textContent || '').toLowerCase();
          if (txt.includes('signed in') || txt.includes(em.toLowerCase().split('@')[0])) {
            el.click(); return el.innerText.trim().slice(0, 60);
          }
        }
        // fallback: any clickable with the email domain
        for (const el of document.querySelectorAll('div, li, a')) {
          if ((el.innerText || '').toLowerCase().includes(em.toLowerCase())) {
            el.click(); return 'fallback:' + el.innerText.trim().slice(0, 60);
          }
        }
        return null;
      }, email);
      console.log('Tile click result:', clicked);
      await page.waitForTimeout(3000);
      await shot(page, `02_after_tile_${attempt}`);
      continue;
    }

    // "Stay signed in?" prompt
    if (url.includes('login.microsoftonline.com') || url.includes('login.live.com')) {
      const yesBtn = page.locator('button:has-text("Yes"), input[value="Yes"], #idSIButton9').first();
      try {
        await yesBtn.waitFor({ state: 'visible', timeout: 5000 });
        await yesBtn.click();
        console.log('✅ Clicked Yes on stay signed in');
        await page.waitForTimeout(3000);
        await shot(page, `03_after_yes_${attempt}`);
        continue;
      } catch {}
    }

    // Already on ads.microsoft.com
    if (url.includes('ads.microsoft.com')) {
      console.log('\n✅ Reached ads.microsoft.com!');
      try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}
      await page.waitForTimeout(3000);
      await shot(page, '04_final_ads_page');
      const bodyText = await page.evaluate(() =>
        document.body.innerText.replace(/\s+/g, ' ').slice(0, 800)
      ).catch(() => '');
      console.log('Page text:', bodyText);
      console.log('\nFinal URL:', page.url());
      console.log('Final Title:', await page.title());
      break;
    }

    // Unknown page, wait and retry
    console.log('Unknown URL, waiting...', url.slice(0, 80));
    await page.waitForTimeout(4000);
    await shot(page, `unknown_${attempt}`);
  }

  console.log('\nBrowser staying open. Close when done.');
  await new Promise(r => browser.on('disconnected', r));
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
