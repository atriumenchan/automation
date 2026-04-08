'use strict';
// STEP 14b: Re-fill website (if empty) + wait for info to load + click Next — all in one session
const { runStep, hd, sleep } = require('./shared');

runStep('14b', 'Fill Website + Next', async ({ page, state, shot, pageInfo, saveSession }) => {
  await shot('s14b_before');

  const url = state.biz.website || 'https://example.com';

  // Fill the website field (may be empty after reload)
  await page.evaluate((website) => {
    const inputs = [...document.querySelectorAll('input[type="url"], input[type="text"]')];
    const visible = inputs.find(i => i.offsetWidth > 0 && i.offsetHeight > 0);
    if (visible) {
      visible.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(visible, website); else visible.value = website;
      visible.dispatchEvent(new Event('input',  { bubbles: true }));
      visible.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, url);
  console.log(`  ✅ Filled: ${url}`);

  // Wait for "Getting information..." to finish loading (up to 15 seconds)
  for (let i = 0; i < 10; i++) {
    const loading = await page.evaluate(() =>
      !!document.querySelector('[class*="loading"], [class*="spinner"]') ||
      document.body.innerText.includes('Getting information')
    ).catch(()=>false);
    if (!loading) break;
    console.log(`  ⏳ Waiting for info to load (${i+1}/10)...`);
    await sleep(2000);
  }
  await hd(1000, 2000);
  await shot('s14b_loaded');

  // Click Next in-page
  await page.evaluate(() => {
    const btn = document.querySelector('button[type="submit"]') ||
                [...document.querySelectorAll('button')].find(b => /next/i.test(b.innerText));
    if (btn) btn.click();
  });
  console.log('  ✅ Clicked Next');

  await hd(4000, 7000);
  await pageInfo();
  await shot('s14b_after');
  await saveSession('s14b');
});
