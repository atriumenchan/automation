'use strict';
// STEP 10: On account picker page — click the account tile (if it appears)
const { runStep, hd } = require('./shared');

runStep(10, 'Pick Account Tile', async ({ page, state, shot, pageInfo, saveSession }) => {
  await shot('s10_before');

  // Try to click a tile matching the account email
  const clicked = await page.evaluate((email) => {
    const tiles = [...document.querySelectorAll('[data-test-id], .tile, [role="button"], li, [class*="account"]')];
    const match = tiles.find(t => t.innerText && t.innerText.toLowerCase().includes(email.toLowerCase().split('@')[0]));
    if (match) { match.click(); return 'matched ' + match.innerText.slice(0,40); }

    // fallback: click any visible tile-like element under the picker
    const picker = document.querySelector('#tilesHolder, #KmsiCheckboxField, .identityBanners, [class*="picker"]');
    if (picker) {
      const first = picker.querySelector('[role="button"], li, .tile, [tabindex]');
      if (first) { first.click(); return 'first tile'; }
    }
    return null;
  }, state.account);

  if (clicked) {
    console.log(`  ✅ Clicked tile: ${clicked}`);
  } else {
    console.log('  ⚠  No account tile found — may already be past account picker');
  }

  await hd(3000, 5000);
  await pageInfo();
  await shot('s10_after');
  await saveSession('s10');
});
