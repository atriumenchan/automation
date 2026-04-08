'use strict';
// STEP 6: Enter password — uses JS to find VISIBLE password field only
const { runStep, hd } = require('./shared');

runStep(6, 'Enter Password', async ({ page, state, shot, pageInfo, saveSession }) => {
  await shot('s06_before');

  const filled = await page.evaluate((pwd) => {
    const inputs = [...document.querySelectorAll('input[type="password"]')];
    const visible = inputs.find(i =>
      i.offsetWidth > 0 && i.offsetHeight > 0 &&
      !i.classList.contains('moveOffScreen') &&
      i.getAttribute('aria-hidden') !== 'true'
    );
    if (!visible) return false;
    visible.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(visible, pwd); else visible.value = pwd;
    visible.dispatchEvent(new Event('input',  { bubbles: true }));
    visible.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, state.password);

  console.log(filled ? '  ✅ Password filled via JS' : '  ⚠  JS fill failed — wrong page?');
  await hd(800, 1500);
  await shot('s06_after');
  await saveSession('s06');
});
