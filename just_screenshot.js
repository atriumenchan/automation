'use strict';
const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const ROOT = __dirname;
const sessDir = path.join(ROOT, 'sessions');

const success = fs.readdirSync(sessDir)
  .filter(f => f.startsWith('sangdierdorfdu2580') && f.includes('SUCCESS_v2') && !f.includes('cookie'))
  .sort().reverse();

const sessionFile = path.join(sessDir, success[0]);
console.log('Session:', success[0]);

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 80, args: ['--start-maximized'] });
  const ctx  = await browser.newContext({ storageState: sessionFile, viewport: null });
  const page = await ctx.newPage();

  await page.goto('https://ads.microsoft.com/', { waitUntil: 'domcontentloaded', timeout: 40000 });
  try { await page.waitForLoadState('networkidle', { timeout: 25000 }); } catch {}
  await page.waitForTimeout(5000);

  const url   = page.url();
  const title = await page.title();
  const txt   = await page.evaluate(() => document.body.innerText.replace(/\s+/g,' ').slice(0,600)).catch(()=>'');
  console.log('URL:  ', url);
  console.log('Title:', title);
  console.log('Text: ', txt);

  const t = new Date().toISOString().replace(/[:.]/g,'-');
  const p = path.join(ROOT, 'logs', 'screenshots', `verify_final_${t}.png`);
  await page.screenshot({ path: p, fullPage: true });
  console.log('📸 Screenshot:', p);

  console.log('\nBrowser open — close when done.');
  await new Promise(r => browser.on('disconnected', r));
})().catch(e => console.error('ERROR:', e.message));
