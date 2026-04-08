'use strict';
// STEP 9-fresh-otp: Request new code, fetch it from IMAP within 3 minutes, fill it
// Run this when the boxes show "That code is incorrect" or boxes are empty
const { runStep, hd, sleep } = require('./shared');
const { waitForOtp } = require('../imap_otp');

runStep('9-fresh-otp', 'Request Fresh OTP + Fill', async ({ page, state, shot, pageInfo, saveSession }) => {
  await shot('s09fo_start');

  // ── Step A: Request a new code by entering Rambler email if needed ──
  const pageText = await page.evaluate(() => document.body.innerText.toLowerCase()).catch(()=>'');

  if (/verify your email/i.test(pageText) || /send code/i.test(pageText)) {
    // We're on the "Verify your email" page — fill email and request code
    console.log('  ↳ On "Verify your email" — filling Rambler email and sending code');
    await page.evaluate((email) => {
      const inputs = [...document.querySelectorAll('input[type="email"], input[type="text"]')];
      const visible = inputs.find(i => i.offsetWidth > 0 && i.offsetHeight > 0 && !i.classList.contains('moveOffScreen'));
      if (visible && visible.getAttribute('maxlength') !== '1') {
        visible.focus();
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(visible, email); else visible.value = email;
        visible.dispatchEvent(new Event('input',  { bubbles: true }));
        visible.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, state.rambler.email);
    await hd(500, 900);
    await page.evaluate(() => {
      const btn = document.querySelector('input[type="submit"], button[type="submit"]') ||
                  [...document.querySelectorAll('button')].find(b => /send code/i.test(b.innerText));
      if (btn) btn.click();
    });
    console.log('  ✅ Send code clicked');
    await hd(3000, 5000);
  } else if (/enter your code|enter code/i.test(pageText)) {
    // Already on code entry page — just re-send
    console.log('  ↳ On "Enter code" page — clicking send again if available');
    // Some pages have a "Resend code" link
    await page.evaluate(() => {
      const link = [...document.querySelectorAll('a, button')].find(e => /resend|send.*again|new code/i.test(e.innerText));
      if (link) link.click();
    });
    await hd(3000, 5000);
  }

  // ── Step B: Record timestamp AFTER sending ──
  const codeSentAt = new Date();
  console.log(`  ⏱ Code requested at: ${codeSentAt.toISOString()}`);

  // ── Step C: Wait for "Enter your code" page ──
  for (let i = 0; i < 8; i++) {
    const title = await page.title().catch(()=>'');
    const body  = await page.evaluate(() => document.body.innerText.toLowerCase()).catch(()=>'');
    if (/enter.*code|your code/i.test(title) || (/enter/i.test(body) && /code/i.test(body))) {
      console.log('  ✅ On code entry page');
      break;
    }
    console.log(`  ⏳ Waiting for code page (${i+1}/8)...`);
    await sleep(3000);
  }

  await shot('s09fo_on_code_page');

  // ── Step D: Fetch fresh OTP (look back only 3 minutes) ──
  console.log(`  📧 Fetching OTP for ${state.rambler.email}...`);
  const since = new Date(codeSentAt.getTime() - 60 * 1000); // 1 min before send
  const otp   = await waitForOtp(state.rambler.email, state.rambler.password, since, 180000);
  if (!otp) throw new Error('OTP not received within 3 minutes');
  console.log(`  ✅ OTP: ${otp}`);

  // ── Step E: Fill OTP ──
  const boxes = await page.evaluate(() => {
    return [...document.querySelectorAll('input')].filter(i =>
      i.offsetWidth > 0 && i.offsetHeight > 0 && i.getAttribute('maxlength') === '1'
    ).length;
  });

  if (boxes >= 4) {
    const digits = otp.toString().split('');
    const inputs = page.locator('input[maxlength="1"]').filter({ visible: true });
    const count  = await inputs.count();
    for (let i = 0; i < count && i < digits.length; i++) {
      try { await inputs.nth(i).click(); await inputs.nth(i).fill(digits[i]); await hd(80, 180); } catch {}
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
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, otp);
    console.log('  ✅ OTP filled (single field)');
  }

  await hd(800, 1500);

  // ── Step F: Click submit (safe) ──
  try {
    await page.evaluate(() => {
      const btn = document.querySelector('input[type="submit"], button[type="submit"]') ||
                  [...document.querySelectorAll('button')].find(b => /verify|submit|next/i.test(b.innerText));
      if (btn) btn.click();
    });
    console.log('  ✅ Submit clicked');
  } catch { console.log('  ✅ Auto-navigated after last digit'); }

  try { await page.waitForLoadState('domcontentloaded', { timeout: 15000 }); } catch {}
  await hd(3000, 5000);
  await saveSession('s09fo_done');
  await pageInfo().catch(()=>{});
  await shot('s09fo_after').catch(()=>{});
});
