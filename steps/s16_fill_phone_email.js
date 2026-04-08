'use strict';
// STEP 16: Fill phone and contact email on Ads form
const { runStep, hd } = require('./shared');

runStep(16, 'Fill Phone & Contact Email', async ({ page, state, shot, fillVisible, pageInfo, saveSession }) => {
  await shot('s16_before');
  const biz = state.biz;

  await fillVisible(page, [
    'input[name="phone"]',
    'input[type="tel"]',
    'input[aria-label*="phone" i]',
    'input[placeholder*="phone" i]',
  ], biz.phone || '', 'phone');

  await hd(300, 600);

  await fillVisible(page, [
    'input[name="email"]',
    'input[type="email"]',
    'input[aria-label*="email" i]',
    'input[placeholder*="email" i]',
  ], biz.email || state.account, 'contact email');

  await hd(600, 1200);
  await shot('s16_after');
  await saveSession('s16');
});
