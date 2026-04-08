const { chromium } = require('playwright');
const fs = require('fs');

// ================= HELPERS =================

function parseProxy(proxyStr) {
  const [host, port, user, pass] = proxyStr.split(':');
  return {
    server: `http://${host}:${port}`,
    username: user,
    password: pass
  };
}

function listAccounts() {
  const indexPath = 'logs/account_index.json';
  if (!fs.existsSync(indexPath)) {
    console.log('❌ No accounts found. Run the main script first.');
    process.exit(1);
  }

  const db = JSON.parse(fs.readFileSync(indexPath));

  // ✅ include ALL accounts
  const accounts = Object.entries(db);

  if (!accounts.length) {
    console.log('❌ No accounts found.');
    process.exit(1);
  }

  return accounts;
}

// ================= MAIN =================

(async () => {

  const accounts = listAccounts();

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║         Session Restore Tool (ALL)           ║');
  console.log('╚══════════════════════════════════════════════╝\n');
  console.log('Available accounts:\n');

  accounts.forEach(([email, data], i) => {
    console.log(`  [${i + 1}] ${email}`);
    console.log(`       📊 Status    : ${data.status || 'unknown'}`);
    console.log(`       📮 Secondary : ${data.secondary_email || 'N/A'}`);
    console.log(`       🌐 Proxy     : ${data.proxy || 'N/A'}`);
    console.log(`       💾 Session   : ${data.session || 'N/A'}`);
    console.log(`       🕐 Created   : ${data.created_at || 'N/A'}`);
    console.log();
  });

  const arg = process.argv[2];

  if (!arg) {
    console.log('Usage: node restore.js <number>');
    console.log('Example: node restore.js 1');
    console.log('\nOr to open ALL accounts one by one:');
    console.log('  node restore.js all\n');
    process.exit(0);
  }

  // ================= OPEN ALL =================
  if (arg.toLowerCase() === 'all') {
    console.log(`\n🚀 Opening all ${accounts.length} accounts one by one...\n`);

    for (const [email, data] of accounts) {
      await openSession(email, data);
      console.log('\n⏳ Press Ctrl+C to stop, or wait 3s for next...\n');
      await new Promise(r => setTimeout(r, 3000));
    }

    return;
  }

  // ================= OPEN ONE =================
  const index = parseInt(arg) - 1;

  if (isNaN(index) || index < 0 || index >= accounts.length) {
    console.log(`❌ Invalid number. Pick between 1 and ${accounts.length}`);
    process.exit(1);
  }

  const [email, data] = accounts[index];
  await openSession(email, data);

})();

// ================= OPEN SESSION =================

async function openSession(email, data) {
  let sessionFile = data.session;

  // 🔥 fallback: find latest session (even FAILED ones)
  if (!sessionFile || !fs.existsSync(sessionFile)) {
    const safe = email.replace(/[@.]/g, '_');

    if (fs.existsSync('sessions')) {
      const files = fs.readdirSync('sessions');

      const matches = files
        .filter(f => f.includes(safe))
        .sort()
        .reverse();

      if (matches.length > 0) {
        sessionFile = `sessions/${matches[0]}`;
        console.log(`⚠️ Using fallback session: ${sessionFile}`);
      }
    }
  }

  if (!sessionFile || !fs.existsSync(sessionFile)) {
    console.log(`❌ No session found for ${email} (even fallback)`);
    return;
  }

  if (!data.proxy) {
    console.log(`⚠️  No proxy found for ${email}, opening without proxy`);
  }

  console.log(`\n🔓 Restoring session for: ${email}`);
  console.log(`   💾 Session : ${sessionFile}`);
  console.log(`   🌐 Proxy   : ${data.proxy || 'none'}`);

  const launchOptions = {
    headless: false,
    slowMo: 50,
  };

  if (data.proxy) {
    launchOptions.proxy = parseProxy(data.proxy);
  }

  const browser = await chromium.launch(launchOptions);

  const contextOptions = {
    storageState: sessionFile,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
    locale: 'en-US',
    timezoneId: 'America/New_York'
  };

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  console.log('🌐 Opening Microsoft Ads...');
  await page.goto('https://ads.microsoft.com', { waitUntil: 'domcontentloaded' });

  await new Promise(r => setTimeout(r, 3000));

  const currentUrl = page.url();
  console.log(`📍 Landed on: ${currentUrl}`);

  if (currentUrl.includes('login') || currentUrl.includes('microsoftonline')) {
    console.log('⚠️  Session may have expired — redirected to login page');
  } else {
    console.log('✅ Session restored — you are logged in!');
  }

  console.log('\n💡 Browser is open. Do your work manually.');
  console.log('   Close the browser window when done.\n');

  await new Promise(resolve => {
    browser.on('disconnected', resolve);
  });

  console.log(`👋 Browser closed for: ${email}\n`);
}