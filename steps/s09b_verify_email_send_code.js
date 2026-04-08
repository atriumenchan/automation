'use strict';
// STEP 9b: "Verify your email" screen — enter Rambler email and click Send code
const { runStep, hd } = require('./shared');

runStep('9b', 'Verify Email — Send Code', async ({ page, state, shot, pageInfo, saveSession }) => {
  await shot('s09b_before');

  // Fill the email field with Rambler email
  await page.evaluate((email) => {
    const inputs = [...document.querySelectorAll('input[type="email"], input[type="text"], input[name="DisplayEmail"]')];
    const visible = inputs.find(i =>
      i.offsetWidth > 0 && i.offsetHeight > 0 &&
      !i.classList.contains('moveOffScreen') &&
      i.getAttribute('aria-hidden') !== 'true'
    );
    if (visible) {
      visible.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(visible, email); else visible.value = email;
      visible.dispatchEvent(new Event('input',  { bubbles: true }));
      visible.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, state.rambler.email);

  console.log(`  ✅ Filled Rambler email: ${state.rambler.email}`);
  await hd(600, 1200);

  // Click "Send code" in-page
  await page.evaluate(() => {
    const btn =
      document.querySelector('input[type="submit"]') ||
      document.querySelector('button[type="submit"]') ||
      [...document.querySelectorAll('button')].find(b => /send code/i.test(b.innerText));
    if (btn) btn.click();
  });
  console.log('  ✅ Clicked Send code');

  await hd(5000, 8000);
  await pageInfo();
  await shot('s09b_after');
  await saveSession('s09b');
});
