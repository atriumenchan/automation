'use strict';
// STEP 7: Re-fill password (if empty) then click Sign-In / Next
const { runStep, hd } = require('./shared');

runStep(7, 'Fill Password + Click Sign-In', async ({ page, state, shot, tryClick, pageInfo, saveSession }) => {
  await shot('s07_before');

  // Re-fill password in case the field was cleared on reload
  await page.evaluate((pwd) => {
    const inputs = [...document.querySelectorAll('input[type="password"]')];
    const visible = inputs.find(i =>
      i.offsetWidth > 0 && i.offsetHeight > 0 &&
      !i.classList.contains('moveOffScreen') &&
      i.getAttribute('aria-hidden') !== 'true'
    );
    if (!visible || visible.value.trim()) return;
    visible.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(visible, pwd); else visible.value = pwd;
    visible.dispatchEvent(new Event('input',  { bubbles: true }));
    visible.dispatchEvent(new Event('change', { bubbles: true }));
  }, state.password);

  await hd(400, 800);
  await tryClick(page, [
    '#idSIButton9',
    'input[type="submit"]',
    'button:has-text("Sign in")',
    'button:has-text("Next")',
  ], 'Sign-in button');
  await hd(5000, 8000);
  await pageInfo();
  await shot('s07_after');
  await saveSession('s07');
});
