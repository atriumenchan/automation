'use strict';
// STEP 22: Click "Yes" on the confirmation dialog (after payment later)
const { runStep, hd } = require('./shared');

runStep(22, 'Click Yes (Confirm Payment Later)', async ({ page, shot, tryClick, pageInfo, saveSession }) => {
  await shot('s22_before');
  await tryClick(page, [
    'button:has-text("Yes")',
    'a:has-text("Yes")',
    '[data-bi-id*="yes"]',
    'button:has-text("OK")',
    'button:has-text("Confirm")',
  ], 'Yes / Confirm');
  await hd(3000, 5000);
  await pageInfo();
  await shot('s22_after');
  await saveSession('s22');
});
