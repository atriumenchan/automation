'use strict';
// STEP 24: Mark account as successfully created in emails.json and account_index.json
const { runStep, getState, ROOT } = require('./shared');
const fs   = require('fs');
const path = require('path');

runStep(24, 'Mark Account as Success', async ({ page, state, shot, pageInfo }) => {
  const info = await pageInfo();
  await shot('s24_success');

  // Mark emails.json
  const emailsFile = path.join(ROOT, 'emails.json');
  const emails = JSON.parse(fs.readFileSync(emailsFile, 'utf8'));
  const acc = emails.find(e => e.email === state.account);
  if (acc) { acc.used = true; fs.writeFileSync(emailsFile, JSON.stringify(emails, null, 2)); }
  console.log(`  ✅ emails.json marked used: ${state.account}`);

  // Update account_index.json
  const idxFile = path.join(ROOT, 'logs', 'account_index.json');
  const idx = fs.existsSync(idxFile) ? JSON.parse(fs.readFileSync(idxFile, 'utf8')) : {};
  idx[state.account] = {
    ...(idx[state.account] || {}),
    status:          'success',
    secondary_email: state.rambler?.email,
    biz_email:       state.biz?.email,
    biz_name:        state.biz?.businessName,
    session:         state.session,
    final_url:       info.url,
    final_title:     info.title,
    completed_at:    new Date().toISOString(),
  };
  fs.writeFileSync(idxFile, JSON.stringify(idx, null, 2));
  console.log(`  ✅ account_index.json updated: status = success`);
  console.log(`\n  🎉 ACCOUNT CREATED SUCCESSFULLY: ${state.account}\n`);
});
