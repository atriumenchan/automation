'use strict';
// STEP 23: Click "Create Campaign" — the FINAL button to complete account creation
const { runStep, hd } = require('./shared');

runStep(23, 'Click Create Campaign (FINAL)', async ({ page, shot, tryClick, pageInfo, saveSession }) => {
  await shot('s23_before');

  let clicked = await tryClick(page, [
    'button:has-text("Create campaign")',
    'button:has-text("Create Campaign")',
    'a:has-text("Create campaign")',
    'a:has-text("Create Campaign")',
  ], 'Create Campaign');

  if (!clicked) {
    clicked = await page.evaluate(() => {
      const els = [...document.querySelectorAll('button, a, [role="button"]')];
      const match = els.find(e => /create campaign/i.test(e.innerText || e.textContent));
      if (match) { match.click(); return true; }
      return false;
    });
    console.log(clicked ? '  ✅ Clicked via JS fallback' : '  ⚠  Create Campaign not found — check screenshot');
  }

  await hd(5000, 8000);
  await pageInfo();
  await shot('s23_after');
  await saveSession('s23_FINAL');
});
