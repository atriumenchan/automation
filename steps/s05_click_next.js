'use strict';
// STEP 5: Fill email (if empty) then click Next
const { runStep, hd } = require('./shared');

runStep(5, 'Fill Email + Click Next', async ({ page, state, shot, tryClick, pageInfo, saveSession }) => {
  await shot('s05_before');

  // Re-fill email in case it was cleared on page reload
  await page.evaluate((email) => {
    const inputs = [...document.querySelectorAll('input[type="email"], input[name="loginfmt"], input[type="text"]')];
    const visible = inputs.find(i =>
      i.offsetWidth > 0 && i.offsetHeight > 0 &&
      !i.classList.contains('moveOffScreen') &&
      i.getAttribute('aria-hidden') !== 'true'
    );
    if (!visible || visible.value.trim()) return; // skip if already filled
    visible.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(visible, email); else visible.value = email;
    visible.dispatchEvent(new Event('input',  { bubbles: true }));
    visible.dispatchEvent(new Event('change', { bubbles: true }));
  }, state.account);

  await hd(400, 800);
  await tryClick(page, [
    '#idSIButton9',
    'input[type="submit"]',
    'button:has-text("Next")',
    'button:has-text("Sign in")',
  ], 'Next button');
  await hd(3000, 5000);
  await pageInfo();
  await shot('s05_after');
  await saveSession('s05');
});
