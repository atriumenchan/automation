'use strict';
// STEP 25: Click "Sign up for a new Microsoft Advertising account" on the "username already exists" page
const { runStep, hd } = require('./shared');

runStep(25, 'Sign up for new Advertising Account', async ({ page, shot, tryClick, pageInfo, saveSession }) => {
  await shot('s25_before');
  await tryClick(page, [
    'button:has-text("Sign up for a new Microsoft Advertising account")',
    'a:has-text("Sign up for a new Microsoft Advertising account")',
    'input[value*="Sign up"]',
  ], 'Sign up for new account');
  await hd(4000, 7000);
  await pageInfo();
  await shot('s25_after');
  await saveSession('s25');
});
