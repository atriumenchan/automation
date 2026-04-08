'use strict';
// STEP 21: Click "Set up payment later" on payment screen
const { runStep, hd } = require('./shared');

runStep(21, 'Click Set Up Payment Later', async ({ page, shot, tryClick, pageInfo, saveSession }) => {
  await shot('s21_before');

  // Try text match first
  let clicked = await tryClick(page, [
    'button:has-text("Set up payment later")',
    'a:has-text("Set up payment later")',
    'button:has-text("payment later")',
    'a:has-text("payment later")',
  ], 'Set up payment later');

  if (!clicked) {
    // JS fallback
    clicked = await page.evaluate(() => {
      const els = [...document.querySelectorAll('button, a, [role="button"], span')];
      const match = els.find(e => /payment later/i.test(e.innerText || e.textContent));
      if (match) { match.click(); return true; }
      return false;
    });
    console.log(clicked ? '  ✅ Clicked via JS fallback' : '  ⚠  Payment later not found — check screenshot');
  }

  await hd(3000, 5000);
  await pageInfo();
  await shot('s21_after');
  await saveSession('s21');
});
