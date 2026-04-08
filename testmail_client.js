'use strict';

/**
 * tigrmail.com API client — disposable inboxes + OTP polling.
 * https://docs.tigrmail.com
 *
 * POST /v1/inboxes → { inbox: "xxx@den.tigrmail.com" }
 * GET  /v1/messages?inbox=xxx@den.tigrmail.com → { message: { body, subject, ... } }
 */

const axios = require('axios');

const API_KEY =
  process.env.TIGRMAIL_API_KEY ||
  'mngesxbew4kpz20l5lm89sy0jvgi1gs9t34mjohbk0z6b53sl59zh404wu7oqrtf';

const BASE_URL = 'https://api.tigrmail.com';
const INBOX_DOMAIN = 'tigrmail.com';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const headers = () => ({
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
});

async function createInbox() {
  const { data } = await axios.post(
    `${BASE_URL}/v1/inboxes`,
    {},
    { headers: headers(), timeout: 30000 }
  );
  if (!data || !data.inbox) {
    throw new Error('tigrmail: createInbox returned no inbox address');
  }
  console.log(`📬 Tigrmail inbox created: ${data.inbox}`);
  return data.inbox;
}

function extractOtpFromPlainText(plainText) {
  const patterns = [
    /Security code[:\s]+(\d{4,8})/i,
    /verification code[:\s]+(\d{4,8})/i,
    /your code[:\s]+(\d{4,8})/i,
    /OTP[:\s]+(\d{4,8})/i,
    /code is[:\s]+(\d{4,8})/i,
    /enter[:\s]+(\d{4,8})/i,
    /one[-\s]?time code[:\s]+(\d{4,8})/i,
    /single[-\s]?use code[:\s]+(\d{4,8})/i,
    /\b(\d{6})\b/,
    /\b(\d{4})\b/,
  ];
  for (const pattern of patterns) {
    const match = plainText.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Poll tigrmail for the next message on the given inbox.
 * The API blocks for up to 3 minutes per call; we retry a few times.
 */
async function getOTP(inbox, options = {}) {
  const maxAttempts = options.maxAttempts ?? 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`🔍 Attempt ${attempt}/${maxAttempts} — polling ${inbox}`);

    try {
      const { data } = await axios.get(`${BASE_URL}/v1/messages`, {
        headers: headers(),
        params: { inbox },
        timeout: 200000,
      });

      if (!data || !data.message) {
        console.log('📭 No message returned, retrying...');
        await sleep(3000);
        continue;
      }

      const msg = data.message;
      console.log(`\n========== EMAIL RECEIVED ==========`);
      console.log(`📧 From    : ${msg.from || 'unknown'}`);
      console.log(`📌 Subject : ${msg.subject || '(no subject)'}`);
      console.log(`📄 Body    :\n${String(msg.body || '').slice(0, 800)}`);
      console.log(`====================================\n`);

      const plainText = String(msg.body || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ');

      const otp = extractOtpFromPlainText(plainText);
      if (otp) {
        console.log(`\n${'═'.repeat(56)}`);
        console.log(`  OTP (tigrmail):  ${otp}`);
        console.log(`${'═'.repeat(56)}\n`);
        return otp;
      }

      console.log('⚠️ No OTP pattern found in this email, retrying...');
    } catch (err) {
      const errMsg =
        err.response?.data?.error || err.response?.data?.code || err.message;
      if (errMsg === 'no new messages' || errMsg === 'no_message') {
        console.log('📭 No new messages yet, retrying...');
      } else {
        console.log(`⚠️ tigrmail API error: ${errMsg}`);
      }
    }

    if (attempt < maxAttempts) await sleep(5000);
  }

  throw new Error('OTP not found after ' + maxAttempts + ' attempts');
}

module.exports = {
  INBOX_DOMAIN,
  createInbox,
  extractOtpFromPlainText,
  getOTP,
};
