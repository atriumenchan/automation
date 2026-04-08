'use strict';
// STEP 17: Check all unchecked checkboxes on the current form
const { runStep, hd } = require('./shared');

runStep(17, 'Check All Checkboxes', async ({ page, shot, pageInfo, saveSession }) => {
  await shot('s17_before');

  const checked = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('input[type="checkbox"]:not(:checked)')];
    boxes.forEach(b => b.click());
    return boxes.length;
  });

  console.log(`  ✅ Checked ${checked} checkbox(es)`);
  await hd(500, 1000);
  await shot('s17_after');
  await saveSession('s17');
});
