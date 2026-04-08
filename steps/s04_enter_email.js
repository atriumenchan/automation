'use strict';
// STEP 4: Enter email in the Microsoft login page
const { runStep, hd } = require('./shared');

runStep(4, 'Enter Email', async ({ page, state, shot, pageInfo, saveSession, hd }) => {
  await shot('s04_before');

  // Use JS to find and fill the VISIBLE email input (avoids hidden browser autofill fields)
  const filled = await page.evaluate((email) => {
    const inputs = [...document.querySelectorAll('input[type="email"], input[name="loginfmt"], input[type="text"]')];
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
  }, state.account);

  console.log(filled ? '  ✅ Email filled via JS' : '  ⚠  JS fill failed');
  await hd(800, 1500);
  await shot('s04_after');
  await saveSession('s04');
});
