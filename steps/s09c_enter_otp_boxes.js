'use strict';
// STEP 9c: Enter OTP into individual digit boxes (6-box code input)
const { runStep, hd } = require('./shared');
const { waitForOtp } = require('../imap_otp');

runStep('9c', 'Enter OTP (digit boxes)', async ({ page, state, shot, pageInfo, saveSession }) => {
  await shot('s09c_before');

  console.log(`  📧 Fetching fresh OTP for ${state.rambler.email}...`);
  const since = new Date(Date.now() - 5 * 60 * 1000); // look back 5 min for fresh code
  const otp   = await waitForOtp(state.rambler.email, state.rambler.password, since, 180000);
  if (!otp) throw new Error('OTP not received within 3 minutes');
  console.log(`  ✅ OTP: ${otp}`);

  // Try typing into individual boxes OR a single input
  const digits = otp.toString().split('');

  // First attempt: find all small inputs and type one digit per box
  const boxes = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input')].filter(i =>
      i.offsetWidth > 0 && i.offsetHeight > 0 &&
      !i.classList.contains('moveOffScreen') &&
      i.getAttribute('aria-hidden') !== 'true' &&
      (i.getAttribute('maxlength') === '1' || i.type === 'tel' || i.type === 'number')
    );
    return inputs.length;
  });

  if (boxes >= 4) {
    // Individual digit boxes
    const inputs = page.locator('input').filter({ visible: true });
    const count  = await inputs.count();
    let filled = 0;
    for (let i = 0; i < count && filled < digits.length; i++) {
      const el = inputs.nth(i);
      try {
        const ml = await el.getAttribute('maxlength').catch(()=>null);
        if (ml === '1') {
          await el.click();
          await el.fill(digits[filled]);
          filled++;
          await hd(80, 200);
        }
      } catch {}
    }
    console.log(`  ✅ Typed ${filled} digits into boxes`);
  } else {
    // Single OTP input
    await page.evaluate((code) => {
      const inp = [...document.querySelectorAll('input[type="tel"], input[type="text"], input[name="otc"]')]
        .find(i => i.offsetWidth > 0 && i.offsetHeight > 0);
      if (inp) {
        inp.focus();
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(inp, code); else inp.value = code;
        inp.dispatchEvent(new Event('input',  { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, otp);
    console.log('  ✅ OTP filled in single field');
  }

  await hd(1000, 2000);

  // Click submit/next if visible
  await page.evaluate(() => {
    const btn = document.querySelector('input[type="submit"], button[type="submit"]') ||
                [...document.querySelectorAll('button')].find(b => /verify|submit|next/i.test(b.innerText));
    if (btn) btn.click();
  });
  console.log('  ✅ Submitted OTP');

  await hd(5000, 8000);
  await pageInfo();
  await shot('s09c_after');
  await saveSession('s09c');
});
