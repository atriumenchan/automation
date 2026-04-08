'use strict';
// STEP 26: Click the account tile on the Microsoft account picker page (shows "Signed in")
const { runStep, hd } = require('./shared');

runStep(26, 'Click Account Tile (Signed In)', async ({ page, state, shot, pageInfo, saveSession }) => {
  await shot('s26_before');

  // Strategy: look for "Signed in" text (appears only on account tiles, not the form)
  let clicked = false;

  // Try Playwright locator for "Signed in" text
  try {
    const signedInEl = page.locator('text=Signed in').first();
    if (await signedInEl.isVisible({ timeout: 3000 })) {
      // Click the parent tile
      await signedInEl.click();
      console.log('  ✅ Clicked via "Signed in" text');
      clicked = true;
    }
  } catch {}

  // Try clicking the avatar/tile container below "We found an account"
  if (!clicked) {
    try {
      const tile = page.locator('[class*="identity"], [class*="account"], [class*="tile"], [class*="user"]').first();
      if (await tile.isVisible({ timeout: 3000 })) {
        await tile.click();
        console.log('  ✅ Clicked identity tile');
        clicked = true;
      }
    } catch {}
  }

  if (!clicked) {
    // JS fallback: find element with "Signed in" text
    clicked = await page.evaluate(() => {
      const all = [...document.querySelectorAll('*')];
      const el = all.find(e => (e.innerText || '').trim() === 'Signed in' || (e.innerText || '').includes('Signed in'));
      if (el) {
        const clickable = el.closest('[role="button"], button, a, li, [tabindex]') || el.parentElement;
        if (clickable) { clickable.click(); return true; }
      }
      return false;
    });
    if (clicked) console.log('  ✅ Clicked via JS "Signed in" fallback');
    else console.log('  ⚠  No tile found');
  }

  await hd(4000, 7000);
  await pageInfo();
  await shot('s26_after');
  await saveSession('s26');
});
