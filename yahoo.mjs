#!/usr/bin/env node
// Yahoo Fantasy Sports API helper (no dependencies, Node 18+).
//
// Usage:
//   node yahoo.mjs auth-url              Print the URL to approve access in your browser
//   node yahoo.mjs auth <code>           Exchange the approval code for tokens (one time)
//   node yahoo.mjs leagues               List your NBA leagues and their league keys
//   node yahoo.mjs fetch <leagueKey> [week]
//                                        Save settings, scoreboard, standings and
//                                        transactions for a week (default: current week
//                                        minus 1, i.e. the last completed week) to data/

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CRED_FILE = path.join(DIR, 'credentials.json');
const TOKEN_FILE = path.join(DIR, 'tokens.json');
const DATA_DIR = path.join(DIR, 'data');
const AUTH_BASE = 'https://api.login.yahoo.com/oauth2';
const API_BASE = 'https://fantasysports.yahooapis.com/fantasy/v2';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}

function loadCredentials() {
  if (!fs.existsSync(CRED_FILE)) {
    writeJson(CRED_FILE, {
      client_id: 'PASTE_CLIENT_ID_HERE',
      client_secret: 'PASTE_CLIENT_SECRET_HERE',
      redirect_uri: 'https://localhost:8080',
    });
    throw new Error(`Created ${CRED_FILE}. Fill in client_id and client_secret, then rerun.`);
  }
  const c = readJson(CRED_FILE);
  if (!c.client_id || c.client_id.startsWith('PASTE_')) {
    throw new Error(`Fill in client_id in ${CRED_FILE}, then rerun.`);
  }
  // Public Client apps have no secret and use PKCE instead.
  if (!c.client_secret || c.client_secret.startsWith('PASTE_')) delete c.client_secret;
  return c;
}

const PKCE_FILE = path.join(DIR, 'pkce.json');

async function tokenRequest(params) {
  const c = loadCredentials();
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const form = { redirect_uri: c.redirect_uri, ...params };
  if (c.client_secret) {
    headers.Authorization = `Basic ${Buffer.from(`${c.client_id}:${c.client_secret}`).toString('base64')}`;
  } else {
    form.client_id = c.client_id;
    if (params.grant_type === 'authorization_code') {
      if (!fs.existsSync(PKCE_FILE)) throw new Error('Missing PKCE verifier. Run: node yahoo.mjs auth-url, then approve again.');
      form.code_verifier = readJson(PKCE_FILE).code_verifier;
    }
  }
  const res = await fetch(`${AUTH_BASE}/get_token`, {
    method: 'POST',
    headers,
    body: new URLSearchParams(form),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Token request failed (${res.status}): ${body.error_description || body.error || JSON.stringify(body)}`);
  }
  const tokens = {
    access_token: body.access_token,
    refresh_token: body.refresh_token || params.refresh_token,
    expires_at: Date.now() + (body.expires_in - 60) * 1000,
  };
  writeJson(TOKEN_FILE, tokens);
  return tokens;
}

async function accessToken() {
  if (!fs.existsSync(TOKEN_FILE)) {
    throw new Error('Not authorized yet. Run: node yahoo.mjs auth-url');
  }
  let t = readJson(TOKEN_FILE);
  if (Date.now() >= t.expires_at) {
    t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
  }
  return t.access_token;
}

export async function api(resource) {
  const url = `${API_BASE}/${resource}${resource.includes('?') ? '&' : '?'}format=json`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  const text = await res.text();
  if (!res.ok) throw new Error(`API ${resource} failed (${res.status}): ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

// Yahoo wraps lists as {"0": {...}, "1": {...}, "count": N}. Return the items as an array.
export function items(obj) {
  if (!obj) return [];
  return Object.keys(obj).filter((k) => k !== 'count').map((k) => obj[k]);
}

// Yahoo splits an entity's fields across an array of single-key objects. Merge them.
export function merge(arr) {
  return Object.assign({}, ...(Array.isArray(arr) ? arr.flat() : [arr]).filter((x) => x && typeof x === 'object'));
}

async function cmdAuthUrl() {
  const c = loadCredentials();
  const q = new URLSearchParams({ client_id: c.client_id, redirect_uri: c.redirect_uri, response_type: 'code', language: 'en-us', scope: c.scope || 'fspt-r' });
  if (!c.client_secret) {
    const code_verifier = crypto.randomBytes(48).toString('base64url');
    writeJson(PKCE_FILE, { code_verifier });
    q.set('code_challenge', crypto.createHash('sha256').update(code_verifier).digest('base64url'));
    q.set('code_challenge_method', 'S256');
  }
  console.log(`${AUTH_BASE}/request_auth?${q}`);
}

async function cmdAuth(code) {
  if (!code) throw new Error('Usage: node yahoo.mjs auth <code>');
  await tokenRequest({ grant_type: 'authorization_code', code });
  fs.rmSync(PKCE_FILE, { force: true });
  console.log(`Authorized. Tokens saved to ${TOKEN_FILE}`);
}

async function cmdLeagues() {
  const data = await api('users;use_login=1/games;game_keys=nba/leagues');
  const user = data.fantasy_content.users['0'].user;
  const games = items(user[1].games);
  let found = 0;
  for (const g of games) {
    const game = g.game;
    const leagues = items(game[1]?.leagues);
    for (const l of leagues) {
      const lg = merge(l.league);
      found++;
      console.log(`${lg.league_key}\t${lg.name}\tseason ${lg.season}\tweek ${lg.current_week}/${lg.end_week}\t${lg.scoring_type}`);
    }
  }
  if (!found) console.log('No NBA leagues found for this Yahoo account.');
}

async function cmdFetch(leagueKey, weekArg) {
  if (!leagueKey) throw new Error('Usage: node yahoo.mjs fetch <leagueKey> [week]');
  const settings = await api(`league/${leagueKey}/settings`);
  const meta = merge(settings.fantasy_content.league[0]);
  const current = Number(meta.current_week);
  const week = weekArg ? Number(weekArg) : Math.max(Number(meta.start_week) || 1, current - 1);

  const [scoreboard, standings, transactions, gameWeeks] = await Promise.all([
    api(`league/${leagueKey}/scoreboard;week=${week}`),
    api(`league/${leagueKey}/standings`),
    api(`league/${leagueKey}/transactions`),
    api(`game/${leagueKey.split('.')[0]}/game_weeks`),
  ]);

  const out = path.join(DATA_DIR, `${leagueKey}-week${week}.json`);
  writeJson(out, {
    fetched_at: new Date().toISOString(),
    league_key: leagueKey,
    week,
    current_week: current,
    settings,
    scoreboard,
    standings,
    transactions,
    game_weeks: gameWeeks,
  });
  console.log(`Saved week ${week} (current week ${current}) to ${out}`);
}

// CLI only when run directly (collect.mjs imports api/items/merge from here).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, ...args] = process.argv.slice(2);
  const commands = { 'auth-url': cmdAuthUrl, auth: cmdAuth, leagues: cmdLeagues, fetch: cmdFetch };
  if (!commands[cmd]) {
    console.log('Commands: auth-url | auth <code> | leagues | fetch <leagueKey> [week]');
    process.exit(1);
  }
  commands[cmd](...args).catch((e) => {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  });
}
