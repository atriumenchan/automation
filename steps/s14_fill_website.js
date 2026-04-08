'use strict';
// STEP 14: Fill website/URL field on Ads initial business form
const { runStep, hd } = require('./shared');

runStep(14, 'Fill Website', async ({ page, state, shot, fillVisible, pageInfo, saveSession }) => {
  await shot('s14_before');
  const url = state.biz.website || 'https://example.com';
  await fillVisible(page, [
    'input[name="url"]',
    'input[placeholder*="website"]',
    'input[placeholder*="URL"]',
    'input[aria-label*="website"]',
    'input[aria-label*="URL"]',
    'input[type="url"]',
    'input[type="text"]',
  ], url, 'website');
  await hd(800, 1500);
  await shot('s14_after');
  await saveSession('s14');
});
