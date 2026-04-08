'use strict';
// STEP 8: LOOK — Just screenshot the current page and report what's visible
// Use this whenever you need to see what's on screen without clicking anything.
const { runStep, hd } = require('./shared');

runStep(8, 'Look at current page', async ({ page, shot, pageInfo, hd }) => {
  // Wait up to 20s for the page to have visible content
  for (let i = 0; i < 10; i++) {
    const txt = await page.evaluate(() => document.body.innerText.trim()).catch(()=>'');
    if (txt.length > 20) break;
    console.log(`  ⏳ Waiting for content (${i+1}/10)...`);
    await hd(2000, 2000);
  }
  const info = await pageInfo();
  const allText = await page.evaluate(() => document.body.innerText.replace(/\s+/g,' ').slice(0,600)).catch(()=>'');
  console.log('\n  Full text preview:\n  ' + allText.slice(0,400));
  await shot('s08_look');
  console.log('\n  ✅ Look complete — check screenshot to decide next step.');
});
