'use strict';
// STEP 2: Click "Sign in" on the public homepage
const { runStep, hd } = require('./shared');

runStep(2, 'Click Sign In', async ({ page, shot, tryClick, pageInfo, saveSession }) => {
  await shot('s02_before');
  await tryClick(page, ['a:has-text("Sign in")','button:has-text("Sign in")','text=Sign in'], 'Sign in button');
  await hd(2000, 4000);
  await pageInfo();
  await shot('s02_after');
  await saveSession('s02');
});
