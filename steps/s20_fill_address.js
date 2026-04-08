'use strict';
// STEP 20: Fill address details (address1, address2, city, state, zip)
const { runStep, hd } = require('./shared');

runStep(20, 'Fill Address Details', async ({ page, state, shot, fillVisible, pageInfo, saveSession }) => {
  await shot('s20_before');
  const b = state.biz;

  const pairs = [
    [['input[name="address1"]','input[aria-label*="address 1" i]','input[placeholder*="address" i]'], b.address1 || '', 'address1'],
    [['input[name="address2"]','input[aria-label*="address 2" i]','input[placeholder*="apt" i]'],    b.address2 || '', 'address2'],
    [['input[name="city"]','input[aria-label*="city" i]','input[placeholder*="city" i]'],              b.city    || '', 'city'],
    [['input[name="zip"]','input[name="postalCode"]','input[aria-label*="zip" i]','input[aria-label*="postal" i]'], b.zip || '', 'zip'],
  ];

  for (const [sels, val, label] of pairs) {
    if (val) {
      await fillVisible(page, sels, val, label);
      await hd(300, 600);
    }
  }

  // State/Province — may be a dropdown
  if (b.state) {
    const stateSet = await page.evaluate((st) => {
      const sel = document.querySelector('select[name="state"], select[aria-label*="state" i], select[aria-label*="province" i]');
      if (sel) {
        const opt = [...sel.options].find(o => o.value === st || o.text.toLowerCase() === st.toLowerCase());
        if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change',{bubbles:true})); return opt.text; }
      }
      // Also try input
      const inp = [...document.querySelectorAll('input[name="state"],input[aria-label*="state" i]')].find(i=>i.offsetWidth>0);
      if (inp) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
        if (setter) setter.call(inp, st); else inp.value = st;
        inp.dispatchEvent(new Event('input',{bubbles:true}));
        inp.dispatchEvent(new Event('change',{bubbles:true}));
        return 'input:'+st;
      }
      return null;
    }, b.state);
    console.log(stateSet ? `  ✅ State set: ${stateSet}` : '  ⚠  State field not found');
    await hd(300, 600);
  }

  await shot('s20_after');
  await saveSession('s20');
});
