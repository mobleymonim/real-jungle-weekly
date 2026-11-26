// Next week's matchup projection (added 2026-11-26 at the user's request).
// For each team: roster on the week's first day, each player's per-game averages (Yahoo: season and last
// month, 50/50), and the NBA schedule (ESPN, US Eastern days). Each day, the players with a game fill the
// league's starting slots (PG, SG, G, SF, PF, F, C, Util x3), best players first and only where their positions
// allow; IL/IL+/NA slots and players marked out don't play.
// The projected weekly totals decide each category (TO: fewer wins); FG%/FT% from projected makes/attempts.
// Usage (standalone): node project.mjs <week>   → prints the projection as JSON
import { pathToFileURL } from 'node:url';
import { api, items, merge } from './yahoo.mjs';

const LK = 'nba.l.42428';
const CATS = ['FG%', 'FT%', '3PTM', 'PTS', 'REB', 'AST', 'ST', 'BLK', 'TO'];
const SID = { fgma: '9004003', ftma: '9007006', '3PTM': '10', PTS: '12', REB: '15', AST: '16', ST: '17', BLK: '18', TO: '19' };
const COUNT = ['3PTM', 'PTS', 'REB', 'AST', 'ST', 'BLK', 'TO'];
const BENCH = new Set(['IL', 'IL+', 'NA']);
const OUT = new Set(['O', 'INJ', 'SUSP', 'NA']); // Yahoo player status: out / injured / suspended / not active
const ESPN_TO_YAHOO = { NO: 'NOP', UTAH: 'UTA', SA: 'SAS', GS: 'GSW', NY: 'NYK', WSH: 'WAS' };

const num = (v) => (v === '' || v == null || v === '-' || Number.isNaN(Number(v)) ? null : Number(v));
const pair = (v) => { const m = String(v ?? '').match(/^([\d.]+)\/([\d.]+)$/); return m ? [Number(m[1]), Number(m[2])] : null; };
const statsOf = (arr) => Object.fromEntries((arr || []).map((s) => [String(s.stat.stat_id), s.stat.value]));
const days = (a, b) => { const out = []; for (let d = new Date(`${a}T12:00:00Z`); d <= new Date(`${b}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10)); return out; };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const md = (iso) => `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const datesLabel = (a, b) => (a.slice(5, 7) === b.slice(5, 7) ? `${md(a)} - ${Number(b.slice(8, 10))}, ${b.slice(0, 4)}` : `${md(a)} - ${md(b)}, ${b.slice(0, 4)}`);

// Per-game line from a Yahoo average_* stats block, or null when the player has no games in it.
function perGame(st) {
  const fg = pair(st[SID.fgma]);
  const ft = pair(st[SID.ftma]);
  const c = Object.fromEntries(COUNT.map((k) => [k, num(st[SID[k]])]));
  if (!fg || c.PTS == null) return null;
  return { fgm: fg[0], fga: fg[1], ftm: ft?.[0] ?? 0, fta: ft?.[1] ?? 0, ...c };
}
const blend = (a, b) => (a && b ? Object.fromEntries(Object.keys(a).map((k) => [k, (a[k] + (b[k] ?? a[k])) / 2])) : a || b);
// Rough per-game value, only to choose who starts when more players have games than there are slots.
const value = (g) => g.PTS + 1.2 * g.REB + 1.5 * g.AST + 3 * g.ST + 3 * g.BLK + 2 * g['3PTM'] - g.TO;

async function nbaGames(dayList) {
  const out = {};
  for (const day of dayList) {
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${day.replace(/-/g, '')}`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`ESPN schedule ${day}: HTTP ${r.status}`);
    const j = await r.json();
    out[day] = new Set((j.events || []).flatMap((e) => e.competitions?.[0]?.competitors || []).map((c) => ESPN_TO_YAHOO[c.team?.abbreviation] || c.team?.abbreviation));
  }
  return out;
}

// Fill the day's starting slots: players in value order, each placed by augmenting paths (max matching that
// keeps better players in), using Yahoo's eligible positions.
function startersFor(players, slots) {
  const owner = new Array(slots.length).fill(-1);
  const fits = (p, si) => p.elig.includes(slots[si]);
  const tryPlace = (pi, seen) => {
    for (let si = 0; si < slots.length; si++) {
      if (seen[si] || !fits(players[pi], si)) continue;
      seen[si] = true;
      if (owner[si] < 0 || tryPlace(owner[si], seen)) { owner[si] = pi; return true; }
    }
    return false;
  };
  players.forEach((_, pi) => tryPlace(pi, new Array(slots.length).fill(false)));
  return owner.filter((pi) => pi >= 0).map((pi) => players[pi]);
}

export async function projectWeek(week) {
  const settings = merge((await api(`league/${LK}/settings`)).fantasy_content.league[1].settings);
  const slots = (settings.roster_positions || []).map((r) => r.roster_position).filter((r) => r.is_starting_position === 1 || r.is_starting_position === '1').flatMap((r) => Array(Number(r.count) || 1).fill(r.position));
  const activeSlots = slots.length;
  const sb = (await api(`league/${LK}/scoreboard;week=${week}`)).fantasy_content.league[1].scoreboard['0'].matchups;
  const ms = items(sb).map((x) => x.matchup);
  const start = ms[0].week_start;
  const end = ms[0].week_end;
  const pairs = ms.map((m) => items(m['0'].teams).map((t) => merge(t.team[0])).map((t) => ({ id: String(t.team_id), name: t.name })));
  const weekDays = days(start, end);
  const games = await nbaGames(weekDays);

  const teams = {};
  for (const t of pairs.flat()) {
    const roster = (type) => api(`team/${LK}.t.${t.id}/roster;date=${start}/players/stats;type=${type}`).then((r) => items(r.fantasy_content.team[1].roster['0'].players).map((x) => x.player));
    const [season, month] = await Promise.all([roster('average_season'), roster('average_lastmonth')]);
    const monthById = Object.fromEntries(month.map((p) => [merge(p[0]).player_id, perGame(statsOf(merge(p.slice(2)).player_stats?.stats))]));
    const players = season.map((p) => {
      const b = merge(p[0]);
      const slot = merge(p[1]?.selected_position).position || 'BN';
      const g = blend(perGame(statsOf(merge(p.slice(2)).player_stats?.stats)), monthById[b.player_id]);
      const elig = (b.eligible_positions || []).map((e) => e.position);
      return { name: b.name?.full, nba: String(b.editorial_team_abbr || '').toUpperCase(), slot, status: b.status || null, elig, g };
    });
    const avail = players.filter((p) => p.g && !BENCH.has(p.slot) && !OUT.has(p.status));
    const tot = { fgm: 0, fga: 0, ftm: 0, fta: 0, ...Object.fromEntries(COUNT.map((k) => [k, 0])) };
    let gp = 0;
    for (const day of weekDays) {
      const today = startersFor(avail.filter((p) => games[day].has(p.nba)).sort((x, y) => value(y.g) - value(x.g)), slots);
      for (const p of today) { for (const k of Object.keys(tot)) tot[k] += p.g[k]; gp++; }
    }
    teams[t.name] = {
      gp,
      out: players.filter((p) => BENCH.has(p.slot) || OUT.has(p.status)).map((p) => p.name),
      s: [tot.fga ? tot.fgm / tot.fga : null, tot.fta ? tot.ftm / tot.fta : null, ...COUNT.map((k) => Math.round(tot[k]))],
    };
  }

  // Category winners; "close" = within .010 for FG%/FT%, within 5% (or 3) for counting categories.
  const results = pairs.map(([a, b]) => {
    const A = teams[a.name].s, B = teams[b.name].s;
    const cats = CATS.map((c, i) => {
      const x = A[i], y = B[i];
      const lowWins = c === 'TO';
      const win = x === y ? 't' : (x > y) !== lowWins ? 'a' : 'b';
      const close = i < 2 ? Math.abs(x - y) <= 0.01 : Math.abs(x - y) <= Math.max(3, 0.05 * Math.max(x, y));
      return { c, a: x, b: y, win, close };
    });
    const w = cats.filter((x) => x.win === 'a').length, l = cats.filter((x) => x.win === 'b').length;
    return { a: a.name, b: b.name, cats, score: [w, l, CATS.length - w - l] };
  });
  return { week, dates: datesLabel(start, end), start, end, activeSlots, basis: 'Yahoo average_season + average_lastmonth (50/50), ESPN schedule', teams, results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const w = Number(process.argv[2]);
  if (!w) { console.error('usage: node project.mjs <week>'); process.exit(1); }
  const p = await projectWeek(w);
  for (const r of p.results) console.log(`${r.a} ${r.score[0]}-${r.score[1]}${r.score[2] ? `-${r.score[2]}` : ''} ${r.b}  (games ${p.teams[r.a].gp} vs ${p.teams[r.b].gp})`);
}
