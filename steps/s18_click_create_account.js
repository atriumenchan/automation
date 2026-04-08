'use strict';
// STEP 18: Click "Create account" on "How can we help you?" screen
const { runStep, hd } = require('./shared');

runStep(18, 'Click Create Account', async ({ page, shot, tryClick, pageInfo, saveSession }) => {
  await shot('s18_before');
  await tryClick(page, [
    'button:has-text("Create account")',
    'a:has-text("Create account")',
    '[data-bi-id*="create"]',
    'button:has-text("Get started")',
  ], 'Create account');
  await hd(3000, 5000);
  await pageInfo();
  await shot('s18_after');
  await saveSession('s18');
});
