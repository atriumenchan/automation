'use strict';
// STEP 3: Click "Continue with Microsoft" on the Ads sign-in page
const { runStep, hd } = require('./shared');

runStep(3, 'Continue with Microsoft', async ({ page, shot, tryClick, pageInfo, saveSession }) => {
  await shot('s03_before');
  await tryClick(page, [
    'a:has-text("Continue with Microsoft")',
    'button:has-text("Continue with Microsoft")',
    'a:has-text("Sign in with Microsoft")',
    'button:has-text("Sign in with Microsoft")',
  ], 'Continue with Microsoft');
  await hd(3000, 5000);
  await pageInfo();
  await shot('s03_after');
  await saveSession('s03');
});
