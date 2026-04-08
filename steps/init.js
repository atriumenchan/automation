'use strict';
/**
 * init.js — Pick next unused account and initialize state.json
 * Run this first before any step scripts.
 */
const fs   = require('fs');
const path = require('path');
const { saveState, ROOT } = require('./shared');

const emails  = JSON.parse(fs.readFileSync(path.join(ROOT,'emails.json'),'utf8'));
const db      = JSON.parse(fs.readFileSync(path.join(ROOT,'logs','account_index.json'),'utf8'));
const bizList = JSON.parse(fs.readFileSync(path.join(ROOT,'business.json'),'utf8'));
const rambler = JSON.parse(fs.readFileSync(path.join(ROOT,'rambler.txt'),'utf8'));

// Pick next unused hotmail account
const account = emails.find(e => !e.used && !['success','already_used'].includes(db[e.email]?.status));
if (!account) { console.log('❌ No unused accounts left.'); process.exit(0); }

// Pick next unused Rambler
const usedRambler = new Set(Object.values(db).map(v=>v.secondary_email).filter(Boolean));
const ramblerAcc  = rambler.find(r => !usedRambler.has(r.email)) || rambler[0];

// Pick business data
const usedBiz = new Set(Object.values(db).filter(v=>v.status==='success').map(v=>v.biz_email));
const biz = bizList.find(b => !usedBiz.has(b.email)) || bizList[0];

// Pick proxy
const usedProxies = new Set(Object.values(db).map(v=>v.proxy).filter(Boolean));
const proxies = fs.readFileSync(path.join(ROOT,'proxies.txt'),'utf8').split('\n').map(l=>l.trim()).filter(Boolean);
const proxy = db[account.email]?.proxy || proxies.find(p=>!usedProxies.has(p)) || proxies[0];

// Save state
const state = saveState({
  account: account.email,
  password: account.password,
  rambler: ramblerAcc,
  biz,
  proxy,
  session: null,
  last_step: 0,
  last_step_name: 'init',
  last_step_status: 'ok',
  started_at: new Date().toISOString(),
});

console.log('\n╔══════════════════════════════════════════╗');
console.log('║       State Initialized                  ║');
console.log('╚══════════════════════════════════════════╝');
console.log(`  Account  : ${state.account}`);
console.log(`  Password : ${state.password}`);
console.log(`  Rambler  : ${state.rambler.email}`);
console.log(`  Business : ${state.biz.businessName} — ${state.biz.website}`);
console.log(`  Proxy    : ${state.proxy.split(':').slice(0,2).join(':')}`);
console.log('\n  ✅ Ready. Now run: node steps/s01_navigate.js\n');
