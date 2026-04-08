'use strict';
// STEP 15: Fill business name on Ads form
const { runStep, hd } = require('./shared');

runStep(15, 'Fill Business Name', async ({ page, state, shot, pageInfo, saveSession }) => {
  await shot('s15_before');
  const name = state.biz.businessName;

  const filled = await page.evaluate((bizName) => {
    const selectors = [
      'input[name="businessName"]',
      'input[aria-label*="business name" i]',
      'input[placeholder*="business name" i]',
      'input[aria-label*="company" i]',
      'input[placeholder*="company" i]',
    ];
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el && el.offsetWidth > 0) {
        el.focus();
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
        if (setter) setter.call(el, bizName); else el.value = bizName;
        el.dispatchEvent(new Event('input', {bubbles:true}));
        el.dispatchEvent(new Event('change', {bubbles:true}));
        return s;
      }
    }
    return null;
  }, name);

  console.log(filled ? `  ✅ Business name filled via: ${filled}` : '  ⚠  Business name field not found');
  await hd(600, 1200);
  await shot('s15_after');
  await saveSession('s15');
});
