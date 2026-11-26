#!/usr/bin/env node
// GitHub Actions entry point (.github/workflows/weekly.yml).
// 1. Target week = the newest week whose last day (US Eastern) is today or earlier, so the Monday 13:00 KST
//    run (Sunday night US) already reports the week that just ended. The user treats data collected Monday
//    13:00–18:00 KST as final even before Yahoo marks it final: such a collection is published without the
//    "잠정" banner (collectedLive: true), and each hourly run in that window re-collects it in place.
//    A week collected after Yahoo marked it final is left alone.
// 2. Rebuild every week's page and the archive into site/ for GitHub Pages.
// The workflow then commits the new data, deploys site/ and sends the Telegram message.
// Usage: node ci.mjs [week] [--rebuild]   (--rebuild: rebuild and redeploy the site even with no new week)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { api, merge } from './yahoo.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
process.chdir(DIR);
const args = process.argv.slice(2);
const forcedWeek = args.find((a) => /^\d+$/.test(a)) || null;
const rebuild = args.includes('--rebuild');
const run = (script, ...a) => execFileSync(process.execPath, [script, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const out = (k, v) => process.env.GITHUB_OUTPUT && fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const weekFiles = (w) => [`data/week${w}.json`, `data/week${w}-players.csv`, `data/week${w}-adds.csv`];

const meta = merge((await api('league/nba.l.42428/settings')).fantasy_content.league[0]);
const current = Number(meta.current_week);
const etToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const sbCur = (await api(`league/nba.l.42428/scoreboard;week=${current}`)).fantasy_content.league[1].scoreboard['0'].matchups['0'].matchup;
const week = Number(forcedWeek || (sbCur.week_end <= etToday ? current : current - 1));
const existing = readJson(`data/week${week}.json`);
const wasPublished = !!existing && existing.source === 'yahoo-api';
const done = wasPublished && !existing.provisional && !existing.collectedLive;

let published = false;
if (week >= 1 && (forcedWeek || !done)) {
  const backup = Object.fromEntries(weekFiles(week).filter((f) => fs.existsSync(f)).map((f) => [f, fs.readFileSync(f)]));
  process.stdout.write(run('weekly.mjs', String(week)));
  const fresh = readJson(`data/week${week}.json`);
  if (!fresh) {
    for (const f of weekFiles(week)) { if (backup[f]) fs.writeFileSync(f, backup[f]); }
    throw new Error(`week ${week}: collect wrote no data`);
  }
  const ended = week < current || sbCur.week_end <= etToday; // the week's games are over (US Eastern date)
  if (fresh.provisional && ended) {
    // Collected before Yahoo marked the week final: publish it as the result (no 잠정 banner).
    // A week still in progress (manual run mid-week) keeps the 잠정 banner.
    delete fresh.provisional;
    fresh.collectedLive = true;
    fs.writeFileSync(`data/week${week}.json`, JSON.stringify(fresh, null, 1));
    run('build.mjs', `data/week${week}.json`);
    console.log(`week ${week}: collected at ${fresh.asOf} KST before Yahoo's final mark; published as the result`);
  }
  published = true;
} else {
  console.log(`week ${week} is already published`);
}

if (published || rebuild) {
  // Rebuild every week (each page reads only weeks <= its own), then the archive with relative links.
  const weeks = fs.readdirSync('data').map((f) => f.match(/^week(\d+)\.json$/)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b);
  for (const w of weeks) if (w !== week || !published) run('build.mjs', `data/week${w}.json`);
  run('archive.mjs', '--pages');
  fs.rmSync('site', { recursive: true, force: true });
  fs.mkdirSync('site');
  // The pages are body fragments (the Claude Artifact viewer added the document shell); add it here.
  const shell = (body) => `<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>\n${body}\n</body></html>\n`;
  for (const w of weeks) fs.writeFileSync(`site/real-jungle-week${w}.html`, shell(fs.readFileSync(`reports/real-jungle-week${w}.html`, 'utf8')));
  fs.writeFileSync('site/index.html', shell(fs.readFileSync('reports/archive.html', 'utf8')));
  fs.writeFileSync('site/.nojekyll', '');
  console.log(`site/: ${weeks.length} weekly pages + index.html`);
}
out('published', String(published));
out('notify', String(published && !wasPublished));
out('deploy', String(published || rebuild));
out('week', String(week));

out('dates', readJson(`data/week${week}.json`)?.dates || '');
