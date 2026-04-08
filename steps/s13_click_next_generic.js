'use strict';
// STEP 13: Click Next / Submit / Send Code — generic "proceed" button
const { runStep, hd } = require('./shared');

runStep(13, 'Click Next (generic)', async ({ page, shot, tryClick, pageInfo, saveSession }) => {
  await shot('s13_before');
  await tryClick(page, [
    '#idSIButton9',
    'input[type="submit"]',
    'button:has-text("Next")',
    'button:has-text("Submit")',
    'button:has-text("Send code")',
    'button:has-text("Verify")',
    'button:has-text("Continue")',
  ], 'Next/Submit');
  await hd(3000, 5000);
  await pageInfo();
  await shot('s13_after');
  await saveSession('s13');
});
