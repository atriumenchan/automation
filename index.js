const { chromium } = require('playwright');
const { MailSlurp } = require('mailslurp-client');
const fs = require('fs');

// ================= CONFIG =================
const MAILSLURP_API_KEY = 'sk_if28GHqgWe0E3QRn_OzrLRv7RE273gNBq9D0JXZZ1ZMLqk3IYLhjtQYyd2Q6y5t1GgpBUPWkvEIvZHxch';

// ================= LOAD FILES =================
let emails = JSON.parse(fs.readFileSync('emails.json'));
const proxiesRaw = fs.readFileSync('proxies.txt', 'utf-8')
  .split('\n')
  .map(p => p.trim())
  .filter(Boolean);

// ================= MAILSLURP =================
const mailslurp = new MailSlurp({ apiKey: MAILSLURP_API_KEY });

// ================= HELPERS =================

function parseProxy(proxyStr) {
  const [host, port, user, pass] = proxyStr.split(':');
  return {
    server: `http://${host}:${port}`,
    username: user,
    password: pass
  };
}

function safeEmail(email) {
  return email.replace(/[@.]/g, '_');
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const humanDelay = (min = 800, max = 2000) =>
  sleep(Math.floor(Math.random() * (max - min + 1)) + min);

async function humanType(page, selector, text) {
  await page.click(selector);
  await humanDelay(300, 700);
  for (const char of text) {
    await page.keyboard.type(char);
    await sleep(Math.floor(Math.random() * 120) + 40);
  }
}

// ================= GET USED INBOXES =================

function getUsedInboxes() {
  const indexPath = 'logs/account_index.json';
  if (!fs.existsSync(indexPath)) return new Set();
  const db = JSON.parse(fs.readFileSync(indexPath));
  const used = new Set();
  for (const entry of Object.values(db)) {
    if (entry.secondary_email) used.add(entry.secondary_email);
  }
  return used;
}

// ================= OTP =================

async function getOTP(inboxId) {
  for (let i = 0; i < 15; i++) {
    console.log(`🔍 Attempt ${i + 1}/15 - Checking inbox...`);
    const emailList = await mailslurp.getEmails(inboxId);

    if (!emailList.length) {
      console.log('📭 No emails yet, waiting 6s...');
      await sleep(6000);
      continue;
    }

    emailList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    for (const e of emailList) {
      const full = await mailslurp.getEmail(e.id);

      console.log('\n========== EMAIL RECEIVED ==========');
      console.log('📧 From    :', full.from);
      console.log('📌 Subject :', full.subject);
      console.log('====================================\n');

      const body = full.body || full.html || '';
      const plainText = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

      console.log('📄 Body (stripped):\n', plainText, '\n');

      const patterns = [
        /Security code[:\s]+(\d{4,8})/i,
        /verification code[:\s]+(\d{4,8})/i,
        /your code[:\s]+(\d{4,8})/i,
        /OTP[:\s]+(\d{4,8})/i,
        /code is[:\s]+(\d{4,8})/i,
        /enter[:\s]+(\d{4,8})/i,
        /\b(\d{6})\b/,
        /\b(\d{4})\b/,
      ];

      for (const pattern of patterns) {
        const match = plainText.match(pattern);
        if (match) {
          console.log(`✅ OTP found: ${match[1]}`);
          return match[1];
        }
      }

      console.log('⚠️ No OTP found in this email');
    }

    await sleep(6000);
  }

  throw new Error('OTP not found after 15 attempts');
}

// ================= ENSURE DIRS =================

function ensureDirs() {
  ['logs', 'accounts', 'inboxes', 'sessions'].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  });
}

// ================= LOGGING =================

function appendLog(entry) {
  const path = 'logs/sessions.json';
  let data = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path)) : [];
  data.push(entry);
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

function appendMapping(primary, secondary) {
  const path = 'logs/email_mappings.json';
  let data = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path)) : [];
  data.push({ primary, secondary, time: new Date().toISOString() });
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

function updateAccountIndex(email, data) {
  const path = 'logs/account_index.json';
  let db = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path)) : {};
  db[email] = { ...db[email], ...data };
  fs.writeFileSync(path, JSON.stringify(db, null, 2));
}

function saveDetails(entry) {
  const path = 'logs/details.txt';
  const statusIcon = entry.status === 'success' ? '✅' :
                     entry.status === 'already_used' ? '⚠️' : '❌';
  const line = [
    '─'.repeat(60),
    `${statusIcon} Status      : ${entry.status.toUpperCase()}`,
    `📧 Account      : ${entry.email}`,
    `📮 Secondary    : ${entry.secondary_email || 'N/A'}`,
    `🌐 Proxy        : ${entry.proxy}`,
    `💾 Session file : ${entry.session_file || 'N/A'}`,
    `🕐 Time         : ${entry.time}`,
    `📊 Attempt #    : ${entry.attempt_number}`,
    entry.note ? `📝 Note        : ${entry.note}` : null,
    '─'.repeat(60),
    ''
  ].filter(Boolean).join('\n');
  fs.appendFileSync(path, line);

  const jsonPath = 'logs/details.json';
  let data = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath)) : [];
  data.push(entry);
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
}

function logAlreadyUsed(entry) {
  const path = 'logs/already_used.json';
  let data = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path)) : [];
  const exists = data.find(e => e.email === entry.email);
  if (!exists) data.push(entry);
  fs.writeFileSync(path, JSON.stringify(data, null, 2));

  const txtPath = 'logs/already_used.txt';
  const line = [
    '─'.repeat(60),
    `⚠️  ALREADY USED: ${entry.email}`,
    `   Secondary seen : ${entry.secondary_seen || 'unknown'}`,
    `   Proxy used     : ${entry.proxy}`,
    `   Detected at    : ${entry.time}`,
    '─'.repeat(60),
    ''
  ].join('\n');
  fs.appendFileSync(txtPath, line);
}

function getStats() {
  const indexPath = 'logs/account_index.json';
  if (!fs.existsSync(indexPath)) return { total: 0, success: 0, failed: 0, already_used: 0 };
  const db = JSON.parse(fs.readFileSync(indexPath));
  const entries = Object.values(db);
  return {
    total: entries.length,
    success: entries.filter(e => e.status === 'success').length,
    failed: entries.filter(e => e.status === 'failed').length,
    already_used: entries.filter(e => e.status === 'already_used').length
  };
}

function isAlreadyCompleted(email) {
  const acc = emails.find(e => e.email === email);
  if (acc?.used) return true;
  const indexPath = 'logs/account_index.json';
  if (!fs.existsSync(indexPath)) return false;
  const db = JSON.parse(fs.readFileSync(indexPath));
  return ['success', 'already_used'].includes(db[email]?.status);
}

// ================= WAIT HELPERS =================

async function waitAndType(page, selectors, text, label = 'field') {
  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, { state: 'visible', timeout: 8000 });
      console.log(`✏️  Typing into ${label}...`);
      await humanDelay(500, 1200);
      await humanType(page, selector, text);
      return true;
    } catch {
      // try next
    }
  }
  throw new Error(`Could not find ${label} with any selector`);
}

async function waitAndClick(page, selectors, label = 'button') {
  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, { state: 'visible', timeout: 8000 });
      console.log(`🖱️  Clicking ${label}...`);
      await humanDelay(400, 900);
      await page.click(selector);
      return true;
    } catch {
      // try next
    }
  }
  throw new Error(`Could not find ${label} with any selector`);
}

// ================= DETECT SCREEN =================

async function detectScreen(page) {
  await humanDelay(1500, 2500);
  const content = await page.content();
  const url = page.url();

  if (
    content.includes('Verify your email') &&
    content.includes("We'll send a code to") &&
    content.includes('*')
  ) {
    const match = content.match(/send a code to\s*<[^>]*>([^<]+)/i) ||
                  content.match(/send a code to\s+([^\s<.]+\*+[^\s<.]+)/i);
    const maskedEmail = match ? match[1].replace(/<[^>]*>/g, '').trim() : 'unknown';
    return { type: 'already_used', maskedEmail };
  }

  if (url.includes('ads.microsoft.com') && !url.includes('login')) {
    return { type: 'dashboard' };
  }

  return { type: 'secondary_email_entry' };
}

// ================= MAIN =================

(async () => {

  ensureDirs();

  let successCount = 0;
  let failCount = 0;
  let alreadyUsedCount = 0;
  let attempted = 0;
  let skipped = 0;

  console.log('\n╔══════════════════════════════════════╗');
  console.log('║     Microsoft Account Automator      ║');
  console.log('║         powered by MailSlurp         ║');
  console.log('╚══════════════════════════════════════╝\n');

  const stats = getStats();
  console.log(`📈 Previous stats:`);
  console.log(`   ✅ Success      : ${stats.success}`);
  console.log(`   ❌ Failed       : ${stats.failed}`);
  console.log(`   ⚠️  Already used : ${stats.already_used}`);
  console.log(`   📊 Total        : ${stats.total}\n`);

  const usedInboxes = getUsedInboxes();
  console.log(`📬 ${usedInboxes.size} secondary inboxes already used — will never reuse\n`);

  for (let i = 0; i < emails.length; i++) {

    const acc = emails[i];

    // ================= SKIP IF DONE =================
    if (isAlreadyCompleted(acc.email)) {
      console.log(`⏭️  Skipping (already done): ${acc.email}`);
      skipped++;
      continue;
    }

    attempted++;

    const indexPath = 'logs/account_index.json';
    let index = fs.existsSync(indexPath)
      ? JSON.parse(fs.readFileSync(indexPath))
      : {};

    // ================= PROXY ASSIGNMENT =================
    let proxyStr;

    if (index[acc.email]?.proxy) {
      proxyStr = index[acc.email].proxy;
      console.log('♻️  Reusing saved proxy for this account');
    } else {
      const usedProxies = new Set(
        Object.values(index)
          .filter(v => v.proxy)
          .map(v => v.proxy)
      );
      const availableProxies = proxiesRaw.filter(p => !usedProxies.has(p));

      if (availableProxies.length > 0) {
        proxyStr = availableProxies[Math.floor(Math.random() * availableProxies.length)];
        console.log(`🆕 Assigned fresh proxy (${availableProxies.length} available)`);
      } else {
        proxyStr = proxiesRaw[Math.floor(Math.random() * proxiesRaw.length)];
        console.log(`⚠️  All proxies used — falling back to random (add more proxies!)`);
      }
    }

    const proxy = parseProxy(proxyStr);

    // ================= CREATE MAILSLURP INBOX =================
    let inbox;
    try {
      inbox = await mailslurp.createInbox();

      // Ensure inbox is unique — never reuse a secondary email
      if (usedInboxes.has(inbox.emailAddress)) {
        console.log(`⚠️  Inbox collision, creating another...`);
        inbox = await mailslurp.createInbox();
      }

      usedInboxes.add(inbox.emailAddress);
      console.log(`📬 MailSlurp inbox created: ${inbox.emailAddress}`);
    } catch (err) {
      console.log(`❌ Failed to create MailSlurp inbox: ${err.message}`);
      failCount++;
      continue;
    }

    // Save inbox info
    fs.writeFileSync(
      `inboxes/${safeEmail(acc.email)}.json`,
      JSON.stringify(inbox, null, 2)
    );

    console.log(`\n╔══════════════════════════════════════╗`);
    console.log(`  🚀 Processing : ${acc.email}`);
    console.log(`  📮 Inbox      : ${inbox.emailAddress}`);
    console.log(`  🌐 Proxy      : ${proxyStr}`);
    console.log(`  📊 Progress   : ${attempted} attempted / ${successCount} success / ${alreadyUsedCount} already used`);
    console.log(`╚══════════════════════════════════════╝\n`);

    let browser;
    let sessionPath;

    try {
      // ================= BROWSER =================
      browser = await chromium.launch({
        headless: false,
        slowMo: 50,
        proxy
      });

      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
        locale: 'en-US',
        timezoneId: 'America/New_York'
      });

      const page = await context.newPage();

      // ================= NAVIGATE =================
      console.log('🌐 Opening Microsoft login...');
      await page.goto('https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=5e68f16e-b58b-4a8e-b33c-4f737f1c7ace&response_type=code%20id_token&scope=openid%20profile&state=OpenIdConnect.AuthenticationProperties%3DpiyGGSnTAo0APgfvk4embDHBQtjsu8EhZHJ3F_mVHbXPXIvPItKhAfDLQh6izZ7r2exBcDY41h7HFpkJcM-ejaJKcNrUybC795b_bds0THGpJLCAOe7WKbykwd5jRjPXc0qRSZeoPW5IWEcj1mMcK2Q_sGyC-L24AoW0KTtc84EF926Ve4tpjIzju6vYd9XABxTR0lC4xQ7vj09zwWe199UkHtybjqo2fcW4Jyqr5pDMkQ_9pKTztJ3-Na7UWLWRPL3sIJgMWVS-VJD6BNafLGNRjZthUuVqEa80L1P4QsRi56B9iGaQAwQxkuOZGTaMLv0iVw&response_mode=form_post&nonce=639106624034175985.ZmRjNGRhZGItOTJjZi00NjY2LTgyODgtZGViNjM2ZDZhNzJiYjE1YmQxNTYtOWJjOS00NTFiLThhOWQtY2U0MThmOThhMjhk&prompt=select_account&lc=1033&uaid=dfb2ea0436af4370bd18c9952bbe8329&redirect_uri=https%3A%2F%2Fads.microsoft.com%2FLogin%2FMsa&x-client-SKU=ID_NET461&x-client-ver=6.6.0.0&sso_reload=true', {
        waitUntil: 'domcontentloaded'
      });

      await humanDelay(1500, 3000);

      // ================= EMAIL STEP =================
      console.log('📧 Entering email...');
      await waitAndType(page, [
        'input[type="email"]',
        'input[name="loginfmt"]',
        '#i0116'
      ], acc.email, 'email field');

      await humanDelay(600, 1400);
      await waitAndClick(page, [
        'input[type="submit"]',
        'button:has-text("Next")',
        '#idSIButton9'
      ], 'Next button');

      await humanDelay(2000, 3500);

      // ================= PASSWORD STEP =================
      console.log('🔑 Entering password...');
      await waitAndType(page, [
        'input[type="password"]',
        'input[name="passwd"]',
        '#i0118'
      ], acc.password, 'password field');

      await humanDelay(700, 1500);
      await waitAndClick(page, [
        'input[type="submit"]',
        'button:has-text("Sign in")',
        'button:has-text("Next")',
        '#idSIButton9'
      ], 'Sign in button');

      await humanDelay(3000, 5000);

      // ================= DETECT SCREEN =================
      console.log('🔎 Detecting screen after login...');
      const screen = await detectScreen(page);
      console.log(`📺 Screen detected: ${screen.type}`);

      // ================= ALREADY USED =================
      if (screen.type === 'already_used') {
        console.log(`\n⚠️  ALREADY USED: ${acc.email}`);
        console.log(`   Existing secondary: ${screen.maskedEmail}\n`);

        acc.used = true;
        fs.writeFileSync('emails.json', JSON.stringify(emails, null, 2));

        const entry = {
          email: acc.email,
          secondary_seen: screen.maskedEmail,
          proxy: proxyStr,
          time: new Date().toISOString(),
          status: 'already_used',
          attempt_number: attempted,
          note: 'Microsoft showed existing secondary — account previously set up'
        };

        logAlreadyUsed(entry);
        saveDetails({ ...entry, secondary_email: screen.maskedEmail, session_file: null });
        appendLog(entry);
        updateAccountIndex(acc.email, {
          status: 'already_used',
          proxy: proxyStr,
          secondary_seen: screen.maskedEmail,
          detected_at: new Date().toISOString(),
          attempt_number: attempted
        });

        alreadyUsedCount++;
        if (browser) await browser.close();
        await humanDelay(3000, 6000);
        continue;
      }

      // ================= SECONDARY EMAIL STEP =================
      console.log('📮 Entering secondary email...');
      await waitAndType(page, [
        'input[type="email"]',
        'input[type="text"]',
        'input[name="Email"]',
        'input[name="SessionStateInput"]'
      ], inbox.emailAddress, 'secondary email field');

      await humanDelay(800, 1600);
      await waitAndClick(page, [
        'input[type="submit"]',
        'button:has-text("Send code")',
        'button:has-text("Next")',
        '#idSIButton9'
      ], 'Send code button');

      // ================= WAIT FOR OTP =================
      console.log('⏳ Waiting for OTP email...');
      await humanDelay(5000, 8000);

      const otp = await getOTP(inbox.id);

      // ================= ENTER OTP =================
      console.log(`🔢 Entering OTP: ${otp}`);
      await waitAndType(page, [
        'input[name="otc"]',
        'input[aria-label*="code"]',
        'input[aria-label*="Code"]',
        'input[placeholder*="code"]',
        'input[placeholder*="Code"]',
        'input[type="tel"]',
        'input[type="number"]',
        'input[type="text"]',
      ], otp, 'OTP field');

      await humanDelay(800, 1500);
      await waitAndClick(page, [
        'input[type="submit"]',
        'button:has-text("Verify")',
        'button:has-text("Next")',
        'button:has-text("Sign in")',
        '#idSIButton9'
      ], 'Verify button');

      // ================= STAY SIGNED IN =================
      await humanDelay(3000, 5000);

      try {
        const stayBtn = page.locator('#idSIButton9');
        if (await stayBtn.isVisible({ timeout: 5000 })) {
          console.log('💾 Clicking Stay signed in...');
          await humanDelay(800, 1500);
          await stayBtn.click();
          console.log('✅ Stay signed in clicked');
        }
      } catch {}

      // ================= LET PAGE SETTLE =================
      console.log('⏳ Letting page settle...');
      await humanDelay(5000, 8000);

      // ================= SAVE SESSION =================
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      sessionPath = `sessions/${safeEmail(acc.email)}_${timestamp}.json`;
      await context.storageState({ path: sessionPath });
      console.log(`💾 Session saved: ${sessionPath}`);

      const accountSessionPath = `accounts/${safeEmail(acc.email)}_${timestamp}.json`;
      await context.storageState({ path: accountSessionPath });

      const cookies = await context.cookies();
      const cookiePath = `sessions/${safeEmail(acc.email)}_${timestamp}_cookies.json`;
      fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));
      console.log(`🍪 Cookies saved: ${cookiePath} (${cookies.length} cookies)`);

      const finalUrl = page.url();
      console.log(`🌐 Final URL: ${finalUrl}`);

      // ================= MARK USED =================
      acc.used = true;
      fs.writeFileSync('emails.json', JSON.stringify(emails, null, 2));

      // ================= SAVE DETAILS =================
      const detailEntry = {
        email: acc.email,
        password: acc.password,
        secondary_email: inbox.emailAddress,
        proxy: proxyStr,
        session_file: sessionPath,
        cookie_file: cookiePath,
        final_url: finalUrl,
        inbox_id: inbox.id,
        time: new Date().toISOString(),
        attempt_number: attempted,
        status: 'success',
        cookies_count: cookies.length
      };

      saveDetails(detailEntry);
      appendLog({ ...detailEntry, accounts_session: accountSessionPath });
      appendMapping(acc.email, inbox.emailAddress);

      updateAccountIndex(acc.email, {
        proxy: proxyStr,
        session: sessionPath,
        cookie_file: cookiePath,
        secondary_email: inbox.emailAddress,
        inbox_id: inbox.id,
        created_at: new Date().toISOString(),
        status: 'success',
        attempt_number: attempted,
        final_url: finalUrl
      });

      successCount++;

      console.log(`\n🎉 SUCCESS #${successCount}: ${acc.email}`);
      console.log(`   📮 Secondary : ${inbox.emailAddress}`);
      console.log(`   🌐 Proxy     : ${proxyStr}`);
      console.log(`   🍪 Cookies   : ${cookies.length}`);
      console.log(`   💾 Session   : ${sessionPath}\n`);

      await humanDelay(4000, 7000);
      await browser.close();

      const gap = Math.floor(Math.random() * 6000) + 8000;
      console.log(`⏳ Waiting ${(gap / 1000).toFixed(1)}s before next account...\n`);
      await sleep(gap);

    } catch (err) {
      console.log(`\n❌ FAILED: ${acc.email}`);
      console.log(`   Error: ${err.message}\n`);

      if (browser) {
        try {
          const contexts = browser.contexts();
          if (contexts.length > 0) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const failSessionPath = `sessions/${safeEmail(acc.email)}_FAILED_${timestamp}.json`;
            await contexts[0].storageState({ path: failSessionPath });
            console.log(`   ⚠️  Partial session saved: ${failSessionPath}`);
          }
        } catch {}
      }

      const failEntry = {
        email: acc.email,
        secondary_email: inbox?.emailAddress || null,
        proxy: proxyStr,
        time: new Date().toISOString(),
        status: 'failed',
        error: err.message,
        attempt_number: attempted
      };

      saveDetails({ ...failEntry, session_file: null });
      appendLog(failEntry);

      updateAccountIndex(acc.email, {
        status: 'failed',
        error: err.message,
        proxy: proxyStr,
        last_attempt: new Date().toISOString(),
        attempt_number: attempted
      });

      failCount++;
      if (browser) await browser.close();
      await humanDelay(5000, 9000);
    }
  }

  // ================= FINAL SUMMARY =================
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║            RUN COMPLETE               ║');
  console.log('╠══════════════════════════════════════╣');
  console.log(`║  ✅ Success      : ${String(successCount).padEnd(18)}║`);
  console.log(`║  ⚠️  Already used : ${String(alreadyUsedCount).padEnd(18)}║`);
  console.log(`║  ❌ Failed       : ${String(failCount).padEnd(18)}║`);
  console.log(`║  ⏭️  Skipped      : ${String(skipped).padEnd(18)}║`);
  console.log(`║  📊 Attempted    : ${String(attempted).padEnd(18)}║`);
  console.log('╚══════════════════════════════════════╝\n');
  console.log('📁 logs/details.txt      — all account details');
  console.log('📁 logs/already_used.txt — accounts already set up');
  console.log('📁 logs/details.json     — structured JSON');
  console.log('📁 sessions/             — cookies and session files\n');

})();