// Player scoring for the weekly recap.
// Score = sum of 9-category z-scores across every player who played that week.
// Counting cats: z of the weekly total (TO inverted). FG%/FT%: Yahoo's matchup page has no
// per-player attempts, so the impact is (pct - league pct) x PTS, using points as the volume proxy.
import fs from 'fs';

export function loadPlayers(csvPath) {
  const players = [];
  let team = null;
  for (const line of fs.readFileSync(csvPath, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('# ')) continue;
    if (line.startsWith('#')) { team = line.slice(1); continue; }
    const f = line.split(',');
    const [name, nba] = f[1].split('~');
    const num = x => (x === '-' ? null : Number(x));
    const st = f.slice(2, 11).map(num);
    players.push({ team, slot: f[0], name, nba, st });
  }
  return players;
}

export function loadAdds(csvPath) {
  const [, ...rows] = fs.readFileSync(csvPath, 'utf8').trim().split(/\r?\n/);
  return rows.map(r => { const [date, player, team, bid] = r.split(','); return { date, player, team, bid: Number(bid) }; });
}

const played = p => p.st[3] != null && p.st.slice(2).some(v => v > 0);

export function scorePlayers(players, teams) {
  // League-wide FG% / FT% from team makes/attempts.
  let fm = 0, fa = 0, tm = 0, ta = 0;
  for (const t of Object.values(teams)) {
    const [a, b] = t.fgma.split('/').map(Number); fm += a; fa += b;
    const [c, d] = t.ftma.split('/').map(Number); tm += c; ta += d;
  }
  const lgFG = fm / fa, lgFT = tm / ta;
  const pool = players.filter(played);
  const raw = p => [
    p.st[0] == null ? 0 : (p.st[0] - lgFG) * p.st[3],
    p.st[1] == null ? 0 : (p.st[1] - lgFT) * p.st[3],
    ...p.st.slice(2),
  ];
  const vals = pool.map(raw);
  const mean = [], sd = [];
  for (let i = 0; i < 9; i++) {
    const col = vals.map(v => v[i]);
    const m = col.reduce((a, b) => a + b, 0) / col.length;
    mean[i] = m;
    sd[i] = Math.sqrt(col.reduce((a, b) => a + (b - m) ** 2, 0) / col.length) || 1;
  }
  for (const p of players) {
    p.played = played(p);
    if (!p.played) { p.score = null; continue; }
    const r = raw(p);
    p.z = r.map((v, i) => ((i === 8 ? -1 : 1) * (v - mean[i])) / sd[i]);
    p.score = p.z.reduce((a, b) => a + b, 0);
  }
  return { lgFG, lgFT, poolSize: pool.length };
}

// Players' weekly lines for a team, best first.
export const teamPlayers = (players, team) => players.filter(p => p.team === team && p.played).sort((a, b) => b.score - a.score);
