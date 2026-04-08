'use strict';
// STEP 11: If prompted for secondary/additional email, enter Rambler email
const { runStep, hd } = require('./shared');

runStep(11, 'Enter Secondary Email (Rambler)', async ({ page, state, shot, pageInfo, saveSession }) => {
  await shot('s11_before');

  const rEmail = state.rambler.email;

  const filled = await page.evaluate((email) => {
    const inputs = [...document.querySelectorAll('input[type="email"], input[type="text"], input[name="DisplayEmail"]')];
    const visible = inputs.find(i =>
      i.offsetWidth > 0 && i.offsetHeight > 0 &&
      !i.classList.contains('moveOffScreen') &&
      i.getAttribute('aria-hidden') !== 'true'
    );
    if (!visible) return false;
    visible.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(visible, email); else visible.value = email;
    visible.dispatchEvent(new Event('input',  { bubbles: true }));
    visible.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, rEmail);

  console.log(filled
    ? `  ✅ Rambler email filled: ${rEmail}`
    : '  ⚠  No email input found — may not be on secondary-email prompt');

  await hd(800, 1500);
  await shot('s11_after');
  await saveSession('s11');
});
