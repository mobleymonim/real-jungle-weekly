#!/usr/bin/env node
// Collect one week of Real Jungle data from the Yahoo Fantasy API (replaces the Chrome steps 2a–2f).
// Usage: node collect.mjs [week] [--out=<dir>]   (default: the last completed week = current week - 1, data/)
// Writes data/weekN.json, data/weekN-players.csv, data/weekN-adds.csv and downloads missing team logos.
// Player photos are fetched later by photos.mjs, only for the players the page picks.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, items, merge } from './yahoo.mjs';
import { projectWeek } from './project.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const LK = 'nba.l.42428';
const LEAGUE = 'Real Jungle';
const CATS = ['FG%', 'FT%', '3PTM', 'PTS', 'REB', 'AST', 'ST', 'BLK', 'TO'];
// Yahoo stat ids: FGM/A, FTM/A (display only), then the 9 categories.
const SID = { fgma: '9004003', ftma: '9007006', 'FG%': '5', 'FT%': '8', '3PTM': '10', PTS: '12', REB: '15', AST: '16', ST: '17', BLK: '18', TO: '19' };
const COUNT = ['3PTM', 'PTS', 'REB', 'AST', 'ST', 'BLK', 'TO'];
const INACTIVE = new Set(['BN', 'IL', 'IL+', 'NA']);
const PHOTO_CACHE = path.join(DIR, 'data', 'player-photos.json');

// --out=<dir> writes the data files somewhere else (for comparing with an existing week).
const OUT_DIR = (process.argv.find((a) => a.startsWith('--out=')) || '').slice(6) || path.join(DIR, 'data');
const ARGS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const fc = async (r) => (await api(r)).fantasy_content;
const num = (v) => (v === '' || v == null || v === '-' || Number.isNaN(Number(v)) ? null : Number(v));
const ma = (v) => { const m = String(v ?? '').match(/^(\d+)\/(\d+)$/); return m ? [Number(m[1]), Number(m[2])] : [0, 0]; };
const statsOf = (arr) => Object.fromEntries((arr || []).map((s) => [String(s.stat.stat_id), s.stat.value]));
const kstNow = () => new Date(Date.now() + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 16);
const etDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const md = (iso) => `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const pct = (m, a) => (a ? (m / a).toFixed(3).replace(/^0/, '') : '-');

// Run async jobs with a small concurrency limit (Yahoo is fine with a handful at once).
async function pool(jobs, n = 6) {
  const out = new Array(jobs.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < jobs.length) { const k = i++; out[k] = await jobs[k](); }
  }));
  return out;
}

function daysBetween(a, b) {
  const out = [];
  for (let d = new Date(`${a}T12:00:00Z`); d <= new Date(`${b}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}
const datesLabel = (a, b) => (a.slice(5, 7) === b.slice(5, 7) ? `${md(a)} - ${Number(b.slice(8, 10))}, ${b.slice(0, 4)}` : `${md(a)} - ${md(b)}, ${b.slice(0, 4)}`);

// scoreboard → [{status, start, end, pairs:[{a:{id,name,stats,gp}, b:{…}, winners:{statId: teamId|'tie'}}]}]
function parseScoreboard(f) {
  const ms = items(f.league[1].scoreboard['0'].matchups).map((x) => x.matchup);
  return {
    status: ms[0]?.status,
    start: ms[0]?.week_start,
    end: ms[0]?.week_end,
    pairs: ms.map((m) => {
      const [a, b] = items(m['0'].teams).map((x) => x.team).map((t) => {
        const meta = merge(t[0]);
        const extra = merge(t.slice(1));
        return { id: String(meta.team_id), name: meta.name, stats: statsOf(extra.team_stats?.stats), gp: num(extra.team_remaining_games?.total?.completed_games) };
      });
      const winners = {};
      for (const w of m.stat_winners || []) {
        const s = w.stat_winner;
        winners[String(s.stat_id)] = s.is_tied === 1 || s.is_tied === '1' ? 'tie' : String(s.winner_team_key).split('.t.')[1];
      }
      return { a, b, winners };
    }),
  };
}

async function main() {
  const settings = await fc(`league/${LK}/settings`);
  const meta = merge(settings.league[0]);
  const current = Number(meta.current_week);
  const week = ARGS[0] ? Number(ARGS[0]) : current - 1;
  if (!(week >= 1 && week <= current)) throw new Error(`week ${week} is out of range (current week ${current})`);

  // Teams: names, managers, logos.
  const teamsFc = await fc(`league/${LK}/teams`);
  const teams = items(teamsFc.league[1].teams).map((x) => merge(x.team[0])).map((t) => ({
    id: String(t.team_id),
    name: t.name,
    mgr: (t.managers || []).map((m) => m.manager).find(Boolean)?.nickname || '',
    commissioner: (t.managers || []).some((m) => m.manager?.is_commissioner === '1'),
    logo: t.team_logos?.[0]?.team_logo?.url || null,
  }));
  const nameOf = Object.fromEntries(teams.map((t) => [t.id, t.name]));

  // Scoreboards for weeks 1..N (standings are rebuilt from category wins so any past week works).
  const boards = await pool(Array.from({ length: week }, (_, i) => () => fc(`league/${LK}/scoreboard;week=${i + 1}`).then(parseScoreboard)));
  const sb = boards[week - 1];
  const provisional = sb.status !== 'postevent';

  // Season W-L-T after week N from each week's category winners.
  const rec = Object.fromEntries(teams.map((t) => [t.id, { W: 0, L: 0, T: 0 }]));
  for (const b of boards) for (const p of b.pairs) for (const c of CATS) {
    const w = p.winners[SID[c]];
    if (!w) continue;
    for (const side of [p.a, p.b]) {
      const r = rec[side.id];
      if (w === 'tie') r.T++; else if (w === side.id) r.W++; else r.L++;
    }
  }
  const pctOf = (r) => (r.W + r.T / 2) / Math.max(1, r.W + r.L + r.T);
  let standings = Object.entries(rec).sort(([, x], [, y]) => pctOf(y) - pctOf(x) || y.W - x.W).map(([id, r]) => [nameOf[id], `${r.W}-${r.L}-${r.T}`]);
  let standingsComputed = false;
  // For the last completed week, prefer Yahoo's own standings (its tie-break order) once they include the week.
  if (!provisional && week === current - 1) {
    const st = await fc(`league/${LK}/standings`);
    const ys = items(st.league[1].standings['0'].teams).map((x) => x.team).map((t) => ({ name: merge(t[0]).name, o: merge(t.slice(1)).team_standings?.outcome_totals || {} }));
    const games = ys.map((t) => Number(t.o.wins) + Number(t.o.losses) + Number(t.o.ties));
    if (games.every((g) => g === CATS.length * week)) standings = ys.map((t) => [t.name, `${t.o.wins}-${t.o.losses}-${t.o.ties}`]);
    else standingsComputed = true;
  }

  // Team totals for the week.
  const teamData = {};
  for (const p of sb.pairs) for (const s of [p.a, p.b]) {
    teamData[s.name] = {
      mgr: teams.find((t) => t.id === s.id)?.mgr || '',
      fgma: s.stats[SID.fgma],
      ftma: s.stats[SID.ftma],
      gp: s.gp,
      s: CATS.map((c) => num(s.stats[SID[c]])),
    };
  }

  // Daily rosters with that day's stats: what counted for each fantasy team (active slots only).
  const days = daysBetween(sb.start, sb.end);
  const jobs = [];
  for (const t of teams) for (const day of days) jobs.push(() => fc(`team/${LK}.t.${t.id}/roster;date=${day}/players/stats;type=date;date=${day}`).then((f) => ({ t, day, f })));
  const rosters = await pool(jobs);
  const photoCache = fs.existsSync(PHOTO_CACHE) ? JSON.parse(fs.readFileSync(PHOTO_CACHE, 'utf8')) : {};
  const players = {}; // teamId → Map(playerId → acc)
  const photos = {};
  for (const { t, day, f } of rosters.sort((x, y) => x.day.localeCompare(y.day))) {
    const list = (players[t.id] ||= new Map());
    items(f.team[1].roster['0'].players).map((x) => x.player).forEach((p, order) => {
      const b = merge(p[0]);
      const id = String(b.player_id);
      const slot = merge(p[1]?.selected_position).position || 'BN';
      const st = statsOf(merge(p.slice(2)).player_stats?.stats);
      const name = b.name?.full || id;
      photos[name] = Number(id);
      const cut = String(b.headshot?.url || b.image_url || '').match(/https:\/\/s\.yimg\.com\/xe\/i\/us\/sp\/v\/nba_cutout\/[^?]+/);
      if (cut) photoCache[id] = cut[0];
      const acc = list.get(id) || { id, name, nba: String(b.editorial_team_abbr || '').toUpperCase(), fgm: 0, fga: 0, ftm: 0, fta: 0, c: Object.fromEntries(COUNT.map((k) => [k, 0])), gp: 0, slot: null, lastDay: null, order: 0 };
      acc.slot = slot;
      acc.lastDay = day;
      acc.order = order;
      acc.nba = String(b.editorial_team_abbr || acc.nba).toUpperCase();
      const [fm, fa] = ma(st[SID.fgma]);
      const [tm, ta] = ma(st[SID.ftma]);
      const counts = Object.fromEntries(COUNT.map((k) => [k, num(st[SID[k]])]));
      const hasStats = counts.PTS !== null;
      const dnp = fa === 0 && COUNT.every((k) => !counts[k]);
      if (!INACTIVE.has(slot) && hasStats && !dnp) {
        acc.fgm += fm; acc.fga += fa; acc.ftm += tm; acc.fta += ta;
        for (const k of COUNT) acc.c[k] += counts[k] || 0;
        acc.gp++;
      }
      list.set(id, acc);
    });
  }
  fs.writeFileSync(PHOTO_CACHE, JSON.stringify(photoCache, null, 1));

  // players CSV + playerGp, and a check that player lines add up to the team totals.
  const lastDay = days[days.length - 1];
  const lines = [
    `# Week ${week} player stats as counted for each fantasy team (Yahoo Fantasy API, daily rosters, active slots only). Collected ${kstNow()} KST${provisional ? ', before Yahoo marked the week final (provisional)' : ' after Yahoo marked the week final'}.`,
    '# slot,player~nbaTeam,FG%,FT%,3PTM,PTS,REB,AST,ST,BLK,TO',
  ];
  const playerGp = {};
  const problems = [];
  for (const [name] of standings) {
    const t = teams.find((x) => x.name === name);
    lines.push(`#${name}`);
    const onLast = (a) => a.lastDay === lastDay;
    const accs = [...(players[t.id]?.values() || [])].sort((x, y) => (onLast(x) !== onLast(y) ? (onLast(x) ? -1 : 1) : onLast(x) ? x.order - y.order : y.lastDay.localeCompare(x.lastDay)));
    const sum = Object.fromEntries(COUNT.map((k) => [k, 0]));
    for (const a of accs) {
      const slot = a.lastDay === lastDay ? a.slot : '--';
      const stats = a.gp ? [pct(a.fgm, a.fga), pct(a.ftm, a.fta), ...COUNT.map((k) => a.c[k])] : Array(9).fill('-');
      if (!a.gp && slot === '--') continue; // dropped before playing a counted game
      lines.push([slot, `${a.name}~${a.nba}`, ...stats].join(','));
      if (a.gp) playerGp[`${a.name}|${name}`] = a.gp;
      for (const k of COUNT) sum[k] += a.c[k];
    }
    const tot = teamData[name];
    for (const k of COUNT) if (sum[k] !== tot.s[CATS.indexOf(k)]) problems.push(`${name} ${k}: players ${sum[k]} vs team ${tot.s[CATS.indexOf(k)]}`);
  }

  // Adds made during the week (US Eastern dates, the NBA game days).
  const adds = [];
  for (let start = 0; start < 1000; start += 25) {
    const f = await fc(`league/${LK}/transactions;count=25;start=${start}`);
    const txs = items(f.league[1].transactions).map((x) => x.transaction);
    if (!txs.length) break;
    let older = false;
    for (const x of txs) {
      const t = merge(x[0]);
      if (t.status && t.status !== 'successful') continue;
      const day = etDate(Number(t.timestamp) * 1000);
      if (day < sb.start) { older = true; continue; }
      if (day > sb.end) continue;
      for (const pp of items(x[1]?.players).map((y) => y.player)) {
        const d = merge(pp[1]?.transaction_data);
        if (d.type !== 'add') continue;
        adds.push({ date: md(day), player: merge(pp[0]).name.full, team: d.destination_team_name, bid: num(t.faab_bid) ?? 0 });
      }
    }
    if (older) break;
  }

  // Missing team logos.
  fs.mkdirSync(path.join(DIR, 'assets', 'logos'), { recursive: true });
  for (const t of teams) {
    const have = ['png', 'jpg'].some((x) => fs.existsSync(path.join(DIR, 'assets', 'logos', `${t.id}.${x}`)));
    if (have || !t.logo) continue;
    const ext = /\.png(\?|$)/i.test(t.logo) ? 'png' : 'jpg';
    const r = await fetch(t.logo);
    if (r.ok) { fs.writeFileSync(path.join(DIR, 'assets', 'logos', `${t.id}.${ext}`), Buffer.from(await r.arrayBuffer())); console.log('logo saved:', t.name); }
  }

  // Next week's matchup projection (project.mjs). A failure here only drops that section.
  let nextWeek = null;
  if (week < Number(meta.end_week || 99)) {
    try { nextWeek = await projectWeek(week + 1); } catch (e) { console.log(`next-week projection skipped: ${e.message}`); }
  }

  const out = {
    league: LEAGUE,
    leagueId: 42428,
    week,
    dates: datesLabel(sb.start, sb.end),
    cats: CATS,
    teams: teamData,
    matchups: sb.pairs.map((p) => [p.a.name, p.b.name]),
    standings,
    teamIds: Object.fromEntries(teams.map((t) => [t.name, Number(t.id)])),
    photos,
    playerGp,
    ...(provisional ? { provisional: true, asOf: kstNow() } : {}),
    ...(standingsComputed ? { standingsComputed: true } : {}),
    collected: kstNow().slice(0, 10),
    commissioner: teams.find((t) => t.commissioner)?.mgr || 'Soohyup',
    source: 'yahoo-api',
    ...(nextWeek ? { nextWeek } : {}),
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const base = path.join(OUT_DIR, `week${week}`);
  fs.writeFileSync(`${base}.json`, JSON.stringify(out, null, 1));
  fs.writeFileSync(`${base}-players.csv`, lines.join('\n') + '\n');
  fs.writeFileSync(`${base}-adds.csv`, ['date,player,team,bid', ...adds.map((a) => [a.date, a.player, a.team, a.bid].join(','))].join('\n') + '\n');
  console.log(`week ${week} (${out.dates}) ${provisional ? 'PROVISIONAL' : 'final'}: ${Object.keys(teamData).length} teams, ${Object.keys(playerGp).length} players with games, ${adds.length} adds, ${rosters.length} daily rosters`);
  if (problems.length) console.log('CHECK FAILED (player lines vs team totals):\n  ' + problems.join('\n  '));
  else console.log('check ok: player lines add up to team totals');
}

main().catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
