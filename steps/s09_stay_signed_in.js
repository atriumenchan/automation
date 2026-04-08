'use strict';
// STEP 9: Click "Yes" on "Stay signed in?" prompt
const { runStep, hd } = require('./shared');

runStep(9, 'Stay Signed In — Click Yes', async ({ page, shot, tryClick, pageInfo, saveSession }) => {
  await shot('s09_before');
  await tryClick(page, [
    '#idSIButton9',
    'button:has-text("Yes")',
    'input[value="Yes"]',
  ], 'Yes button');
  await hd(3000, 5000);
  await pageInfo();
  await shot('s09_after');
  await saveSession('s09_post_login');
});
