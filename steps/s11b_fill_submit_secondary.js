'use strict';
// STEP 11b: Fill Rambler email AND click Next in one step (avoids reload clearing the field)
const { runStep, hd } = require('./shared');

runStep('11b', 'Fill Secondary Email + Submit', async ({ page, state, shot, pageInfo, saveSession }) => {
  await shot('s11b_before');

  const rEmail = state.rambler.email;

  // Fill email field
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

  console.log(filled ? `  ✅ Filled: ${rEmail}` : '  ⚠  Field not found');
  await hd(600, 1200);

  // Click Next WITHOUT leaving the page (so field isn't cleared)
  await page.evaluate(() => {
    const btn = document.querySelector('input[type="submit"], button[type="submit"]') ||
                [...document.querySelectorAll('button')].find(b => /next|submit|continue/i.test(b.innerText));
    if (btn) btn.click();
  });
  console.log('  ✅ Clicked Next via JS (in-page, no reload)');

  await hd(5000, 8000);
  await pageInfo();
  await shot('s11b_after');
  await saveSession('s11b');
});
