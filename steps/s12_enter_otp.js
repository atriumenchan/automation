'use strict';
// STEP 12: Retrieve OTP from Rambler IMAP and enter it
const { runStep, hd } = require('./shared');
const { waitForOtp } = require('../imap_otp');

runStep(12, 'Enter OTP from Rambler', async ({ page, state, shot, pageInfo, saveSession }) => {
  await shot('s12_before');

  console.log(`  📧 Fetching OTP for ${state.rambler.email} via IMAP...`);
  const since = new Date(Date.now() - 10 * 60 * 1000);
  const otp   = await waitForOtp(state.rambler.email, state.rambler.password, since, 120000);

  if (!otp) throw new Error('OTP not received within 2 minutes');
  console.log(`  ✅ OTP received: ${otp}`);

  const filled = await page.evaluate((code) => {
    const inputs = [...document.querySelectorAll('input[type="tel"], input[type="text"], input[name="otc"], input[autocomplete="one-time-code"]')];
    const visible = inputs.find(i =>
      i.offsetWidth > 0 && i.offsetHeight > 0 &&
      !i.classList.contains('moveOffScreen') &&
      i.getAttribute('aria-hidden') !== 'true'
    );
    if (!visible) return false;
    visible.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(visible, code); else visible.value = code;
    visible.dispatchEvent(new Event('input',  { bubbles: true }));
    visible.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, otp);

  console.log(filled ? '  ✅ OTP filled' : '  ⚠  OTP field not found');
  await hd(500, 1000);
  await shot('s12_after');
  await saveSession('s12');
});
