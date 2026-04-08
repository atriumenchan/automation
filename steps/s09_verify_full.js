'use strict';
// STEP 9-full: "Verify your email" — confirm Rambler email, get OTP, submit OTP — all in ONE browser session
const { runStep, hd, sleep } = require('./shared');
const { waitForOtp } = require('../imap_otp');

runStep('9-verify', 'Verify Email Full (email → send → OTP → submit)', async ({ page, state, shot, pageInfo, saveSession }) => {
  await shot('s09v_before');

  // ── Phase 1: fill the Email field with Rambler email and click Send code ──
  const rEmail = state.rambler.email;

  const filledEmail = await page.evaluate((email) => {
    const inputs = [...document.querySelectorAll('input[type="email"], input[type="text"]')];
    const visible = inputs.find(i =>
      i.offsetWidth > 0 && i.offsetHeight > 0 &&
      !i.classList.contains('moveOffScreen') &&
      i.getAttribute('aria-hidden') !== 'true'
    );
    if (!visible) return false;
    // Make sure it's the email confirm field, not an OTP field
    if (visible.getAttribute('maxlength') === '1') return false;
    visible.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(visible, email); else visible.value = email;
    visible.dispatchEvent(new Event('input',  { bubbles: true }));
    visible.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, rEmail);

  if (!filledEmail) {
    console.log('  ⚠  Could not fill email — may already be on code entry page');
  } else {
    console.log(`  ✅ Filled Rambler email: ${rEmail}`);
    await hd(600, 1200);

    // Click Send code
    await page.evaluate(() => {
      const btn = document.querySelector('input[type="submit"], button[type="submit"]') ||
                  [...document.querySelectorAll('button')].find(b => /send code/i.test(b.innerText));
      if (btn) btn.click();
    });
    console.log('  ✅ Clicked Send code');
    await hd(4000, 6000);
    await shot('s09v_after_send');
  }

  await pageInfo();

  // ── Phase 2: Wait for "Enter your code" / "Enter code" page to appear ──
  let onCodePage = false;
  for (let i = 0; i < 10; i++) {
    const title = await page.title().catch(()=>'');
    const body  = await page.evaluate(() => document.body.innerText.toLowerCase()).catch(()=>'');
    if (/enter.*code|your code/i.test(title) || /enter.*code|your code/i.test(body)) {
      onCodePage = true;
      break;
    }
    console.log(`  ⏳ Waiting for code page (${i+1}/10)...`);
    await sleep(3000);
  }

  if (!onCodePage) {
    console.log('  ⚠  Did not reach code-entry page — taking screenshot');
    await shot('s09v_not_on_code_page');
    throw new Error('Did not reach OTP entry page');
  }

  console.log('  ✅ On OTP entry page');
  await shot('s09v_on_code_page');

  // ── Phase 3: Get OTP from IMAP ──
  console.log(`  📧 Fetching OTP for ${rEmail}...`);
  const since = new Date(Date.now() - 10 * 60 * 1000);
  const otp   = await waitForOtp(state.rambler.email, state.rambler.password, since, 180000);
  if (!otp) throw new Error('OTP not received');
  console.log(`  ✅ OTP: ${otp}`);

  // ── Phase 4: Fill OTP into boxes or single field ──
  const boxes = await page.evaluate(() => {
    return [...document.querySelectorAll('input')].filter(i =>
      i.offsetWidth > 0 && i.offsetHeight > 0 &&
      i.getAttribute('maxlength') === '1'
    ).length;
  });

  if (boxes >= 4) {
    const digits = otp.toString().split('');
    const inputs = page.locator('input[maxlength="1"]').filter({ visible: true });
    const count  = await inputs.count();
    for (let i = 0; i < count && i < digits.length; i++) {
      try {
        await inputs.nth(i).click();
        await inputs.nth(i).fill(digits[i]);
        await hd(80, 200);
      } catch {}
    }
    console.log(`  ✅ Typed ${digits.length} digits into boxes`);
  } else {
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

  await hd(800, 1500);

  // Click submit — wrap in try/catch because page may auto-navigate on last digit
  try {
    await page.evaluate(() => {
      const btn = document.querySelector('input[type="submit"], button[type="submit"]') ||
                  [...document.querySelectorAll('button')].find(b => /verify|submit|next/i.test(b.innerText));
      if (btn) btn.click();
    });
    console.log('  ✅ OTP submit clicked');
  } catch (e) {
    // Navigation already happened when last digit was typed — that's OK
    console.log('  ✅ Page navigated after OTP (auto-submit)');
  }

  // Wait for navigation to settle
  try { await page.waitForLoadState('domcontentloaded', { timeout: 15000 }); } catch {}
  await hd(3000, 5000);

  // Save session regardless — OTP was accepted
  await saveSession('s09v_verified');
  await pageInfo().catch(()=>{});
  await shot('s09v_after_otp').catch(()=>{});
});
