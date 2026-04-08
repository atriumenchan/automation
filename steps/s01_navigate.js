'use strict';
// STEP 1: Open Microsoft Ads signup URL — see what page appears
const { runStep, hd } = require('./shared');

runStep(1, 'Navigate to Ads Signup', async ({ page, shot, pageInfo, saveSession }) => {
  await page.goto('https://ads.microsoft.com/PMaxLite/Signup/?idP=MSA&s_cid=acq-pmaxlanding-src_default',
    { waitUntil: 'domcontentloaded', timeout: 45000 });
  try { await page.waitForLoadState('networkidle', { timeout: 20000 }); } catch {}
  await hd(2000, 4000);
  await pageInfo();
  await shot('s01_navigate');
  await saveSession('s01');
});
