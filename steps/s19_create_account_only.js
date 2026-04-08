'use strict';
// STEP 19: Select "Create account only" card (not "Create account and campaign")
const { runStep, hd } = require('./shared');

runStep(19, 'Select Create Account Only', async ({ page, shot, pageInfo, saveSession }) => {
  await shot('s19_before');

  const clicked = await page.evaluate(() => {
    // Find all cards/options and look for one that contains "account only"
    const candidates = [...document.querySelectorAll('[role="button"], .card, button, a, li, [class*="option"], [class*="choice"]')];
    const match = candidates.find(el =>
      /account only/i.test(el.innerText) || /only account/i.test(el.innerText) || /skip campaign/i.test(el.innerText)
    );
    if (match) { match.click(); return match.innerText.slice(0,80); }
    return null;
  });

  if (clicked) {
    console.log(`  ✅ Clicked: ${clicked}`);
  } else {
    console.log('  ⚠  "Create account only" not found — take a screenshot with s08_look.js to check');
  }

  await hd(2000, 4000);
  await pageInfo();
  await shot('s19_after');
  await saveSession('s19');
});
