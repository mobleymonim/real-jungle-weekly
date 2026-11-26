#!/usr/bin/env node
// Collect Yahoo Fantasy Basketball pages with your installed Chrome (Playwright).
// Uses a dedicated Chrome profile in ./chrome-profile so your normal Chrome is untouched.
//
// Usage:
//   node browser.mjs login            Opens a visible Chrome window; log in to Yahoo yourself.
//                                     Closes on its own once your leagues are visible (max 10 min).
//   node browser.mjs leagues          (background) List your NBA leagues
//   node browser.mjs page <url> <name>
//                                     (background) Save the page's text and HTML to data/pages/<name>.*

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PROFILE = path.join(DIR, 'chrome-profile');
const PAGES = path.join(DIR, 'data', 'pages');
const HOME = 'https://basketball.fantasysports.yahoo.com/';
const LEAGUE_LINK = /basketball\.fantasysports\.yahoo\.com\/nba\/\d+\/?$/;

async function open(headless) {
  return chromium.launchPersistentContext(PROFILE, {
    channel: 'chrome',
    headless,
    viewport: { width: 1400, height: 1000 },
    locale: 'en-US',
  });
}

async function leagueLinks(page) {
  const links = await page.$$eval('a[href]', (as) => as.map((a) => ({ href: a.href, text: a.innerText.trim() })));
  const seen = new Map();
  for (const l of links) {
    const href = l.href.split('?')[0].replace(/\/$/, '');
    if (LEAGUE_LINK.test(href + '/') || LEAGUE_LINK.test(href)) {
      if (l.text && !seen.has(href)) seen.set(href, l.text.split('\n')[0]);
    }
  }
  return [...seen].map(([href, name]) => ({ href, name }));
}

async function cmdLogin() {
  const ctx = await open(false);
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(HOME, { waitUntil: 'commit', timeout: 60000 }).catch(() => {});
  console.log('Chrome is open. Log in to Yahoo in that window (waiting up to 10 minutes)...');
  const deadline = Date.now() + 10 * 60 * 1000;
  let leagues = [];
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    try {
      if (page.url().startsWith(HOME)) leagues = await leagueLinks(page);
    } catch {}
    if (leagues.length) break;
  }
  await ctx.close();
  if (!leagues.length) throw new Error('Did not detect a logged-in league list within 10 minutes.');
  console.log('Logged in. Leagues found:');
  for (const l of leagues) console.log(`${l.href}\t${l.name}`);
}

async function cmdLeagues() {
  const ctx = await open(true);
  const page = await ctx.newPage();
  await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const leagues = await leagueLinks(page);
  const url = page.url();
  await ctx.close();
  if (!leagues.length) throw new Error(`No leagues found (landed on ${url}). Session may have expired: run node browser.mjs login`);
  for (const l of leagues) console.log(`${l.href}\t${l.name}`);
}

async function cmdPage(url, name) {
  if (!url || !name) throw new Error('Usage: node browser.mjs page <url> <name>');
  const ctx = await open(true);
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  fs.mkdirSync(PAGES, { recursive: true });
  const text = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync(path.join(PAGES, `${name}.txt`), `URL: ${page.url()}\n\n${text}`);
  fs.writeFileSync(path.join(PAGES, `${name}.html`), await page.content());
  console.log(`Saved ${name} (${text.length} chars of text) from ${page.url()}`);
  await ctx.close();
}

const [cmd, ...args] = process.argv.slice(2);
const commands = { login: cmdLogin, leagues: cmdLeagues, page: cmdPage };
if (!commands[cmd]) {
  console.log('Commands: login | leagues | page <url> <name>');
  process.exit(1);
}
commands[cmd](...args).catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
