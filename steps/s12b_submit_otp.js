'use strict';
// STEP 12b: Re-fetch OTP from Rambler and submit it (fill + click in same page load)
const { runStep, hd } = require('./shared');
const { waitForOtp } = require('../imap_otp');

runStep('12b', 'Fill OTP + Submit', async ({ page, state, shot, pageInfo, saveSession }) => {
  await shot('s12b_before');

  console.log(`  📧 Fetching OTP for ${state.rambler.email}...`);
  const since = new Date(Date.now() - 15 * 60 * 1000); // look back 15 min
  const otp   = await waitForOtp(state.rambler.email, state.rambler.password, since, 120000);
  if (!otp) throw new Error('OTP not received');
  console.log(`  ✅ OTP: ${otp}`);

  // Fill OTP field and immediately submit — all in one JS call
  await page.evaluate((code) => {
    const inputs = [...document.querySelectorAll('input[type="tel"], input[type="text"], input[name="otc"], input[autocomplete="one-time-code"]')];
    const visible = inputs.find(i =>
      i.offsetWidth > 0 && i.offsetHeight > 0 &&
      !i.classList.contains('moveOffScreen') &&
      i.getAttribute('aria-hidden') !== 'true'
    );
    if (visible) {
      visible.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(visible, code); else visible.value = code;
      visible.dispatchEvent(new Event('input',  { bubbles: true }));
      visible.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, otp);

  await hd(600, 1200);

  // Click Next in-page
  await page.evaluate(() => {
    const btn = document.querySelector('input[type="submit"], button[type="submit"]') ||
                [...document.querySelectorAll('button')].find(b => /next|verify|submit/i.test(b.innerText));
    if (btn) btn.click();
  });
  console.log('  ✅ OTP submitted');

  await hd(5000, 8000);
  await pageInfo();
  await shot('s12b_after');
  await saveSession('s12b');
});
