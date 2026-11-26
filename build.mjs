// Build the weekly recap page from data/weekN.json.
// Usage: node build.mjs data/week1.json  ->  reports/real-jungle-week1.html
import fs from 'fs';
import path from 'path';
import { loadPlayers, loadAdds, scorePlayers, teamPlayers } from './players.mjs';
import { closeCalls, categoryRanks, seasonPower } from './insights.mjs';

const src = process.argv[2];
if (!src) { console.error('usage: node build.mjs data/weekN.json'); process.exit(1); }
const d = JSON.parse(fs.readFileSync(src, 'utf8'));
const C = d.cats;
const T = d.teams;

// Exact percentages from makes/attempts so ties and edges are compared correctly.
for (const t of Object.values(T)) {
  const [fm, fa] = t.fgma.split('/').map(Number);
  const [tm, ta] = t.ftma.split('/').map(Number);
  t.v = [fm / fa, tm / ta, ...t.s.slice(2)];
}
const better = (a, b, i) => (i === 8 ? Math.sign(b - a) : Math.sign(a - b)); // TO: lower wins
const fmt = (x, i) => (i < 2 ? x.toFixed(3).replace(/^0/, '') : String(x));
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function h2h(a, b) {
  let w = 0, l = 0, t = 0; const res = [];
  for (let i = 0; i < 9; i++) { const r = better(T[a].v[i], T[b].v[i], i); res.push(r); r > 0 ? w++ : r < 0 ? l++ : t++; }
  return { w, l, t, res };
}

// All-play: each team vs every other team on the week's category totals.
const names = Object.keys(T);
const allPlay = {};
for (const a of names) {
  let w = 0, l = 0, t = 0;
  for (const b of names) { if (a === b) continue; const r = h2h(a, b); r.w > r.l ? w++ : r.l > r.w ? l++ : t++; }
  allPlay[a] = [w, l, t];
}

// Category best / worst of the week.
const leaders = C.map((c, i) => {
  const vals = names.map(n => T[n].v[i]);
  const best = i === 8 ? Math.min(...vals) : Math.max(...vals);
  const worst = i === 8 ? Math.max(...vals) : Math.min(...vals);
  return { c, best, worst, bestBy: names.filter(n => T[n].v[i] === best), worstBy: names.filter(n => T[n].v[i] === worst) };
});

const results = d.matchups.map(([a, b]) => ({ a, b, ...h2h(a, b) }));
const blowout = results.reduce((m, r) => (Math.abs(r.w - r.l) > Math.abs(m.w - m.l) ? r : m));
const closest = results.filter(r => Math.abs(r.w - r.l) === Math.min(...results.map(x => Math.abs(x.w - x.l))));
const luck = names.map(n => {
  const won = results.some(r => (r.a === n && r.w > r.l) || (r.b === n && r.l > r.w));
  const lost = results.some(r => (r.a === n && r.l > r.w) || (r.b === n && r.w > r.l));
  return { n, won, lost, ap: allPlay[n] };
});
const unlucky = luck.filter(x => x.lost && x.ap[0] >= 9);
const lucky = luck.filter(x => x.won && x.ap[0] <= 3);

const mgr = n => T[n]?.mgr ?? '';
const team = n => `<span class="tm">${esc(n)}</span>`;

// Images are embedded as data URIs so the page is one self-contained file.
const dataUri = file => {
  if (!fs.existsSync(file)) return null;
  const type = file.endsWith('.png') ? 'image/png' : 'image/jpeg';
  return `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
};
const logoCache = {};
const logoSrc = n => {
  if (n in logoCache) return logoCache[n];
  const id = d.teamIds?.[n];
  const file = id == null ? null : ['png', 'jpg'].map(x => `assets/logos/${id}.${x}`).find(f => fs.existsSync(f));
  return (logoCache[n] = file ? dataUri(file) : null);
};
// Each logo is embedded once as a CSS class; every place that shows it reuses the class.
const logo = (n, cls = 'logo') => (logoSrc(n) ? `<span class="${cls} tl-${d.teamIds[n]}" role="img" aria-hidden="true"></span>` : `<span class="${cls} none"></span>`);
const logoCss = () => Object.keys(d.teamIds || {}).filter(n => logoSrc(n)).map(n => `.tl-${d.teamIds[n]}{background-image:url(${logoSrc(n)})}`).join('\n');
const photoSrc = name => (d.photos?.[name] ? dataUri(`assets/players/${d.photos[name]}-sm.png`) : null);

const matchupCards = results.map(r => {
  const aWin = r.w > r.l, bWin = r.l > r.w;
  const cells = C.map((c, i) => {
    const res = r.res[i];
    return `<tr><th scope="row">${c}</th><td class="${res > 0 ? 'win' : ''}">${fmt(T[r.a].v[i], i)}</td><td class="${res < 0 ? 'win' : ''}">${fmt(T[r.b].v[i], i)}</td></tr>`;
  }).join('');
  // Games played this week (Yahoo's "Games Played"); the side that played more gets a "+N" note.
  const gpA = T[r.a].gp, gpB = T[r.b].gp;
  const gpTag = (mine, theirs) => (mine == null ? '' : `<span class="gp">${mine}경기${theirs != null && mine > theirs ? ` <em>+${mine - theirs}</em>` : ''}</span>`);
  const gpRow = gpA != null && gpB != null ? `<tr class="gp-row"><th scope="row">경기 수</th><td>${gpA}</td><td>${gpB}</td></tr>` : '';
  return `<article class="match">
  <header>
    <div class="side ${aWin ? 'w' : ''}">${logo(r.a)}<div><b>${esc(r.a)}</b><small>${esc(mgr(r.a))}</small>${gpTag(gpA, gpB)}</div></div>
    <div class="score"><span class="${aWin ? 'w' : ''}">${r.w}</span><i>–</i><span class="${bWin ? 'w' : ''}">${r.l}</span>${r.t ? `<em>${r.t} 무</em>` : ''}</div>
    <div class="side r ${bWin ? 'w' : ''}">${logo(r.b)}<div><b>${esc(r.b)}</b><small>${esc(mgr(r.b))}</small>${gpTag(gpB, gpA)}</div></div>
  </header>
  <details><summary>카테고리별 기록</summary>
    <div class="scroll"><table class="cat"><thead><tr><th></th><th>${esc(r.a)}</th><th>${esc(r.b)}</th></tr></thead><tbody>${gpRow}${cells}</tbody></table></div>
  </details>
</article>`;
}).join('\n');

// Games behind (승차) on category W-L-T: ((W_a - W_b) + (L_b - L_a)) / 2; ties count for neither side.
const wl = rec => rec.split('-').map(Number);
const gb = (a, b) => { const [wa, la] = wl(a), [wb, lb] = wl(b); return ((wa - wb) + (lb - la)) / 2; };
const fmtGb = g => g === 0 ? '–' : String(g);
const standRows = d.standings.map(([n, rec], i) => {
  const ap = allPlay[n];
  const gbCell = i === 0 ? '–' : fmtGb(gb(d.standings[0][1], rec));
  return `<tr><td class="num">${i + 1}</td><td><span class="prof-team">${logo(n, 'logo xs')}<span>${team(n)}<small>${esc(mgr(n))}</small></span></span></td><td class="num">${rec}</td><td class="num gb">${gbCell}</td><td class="num">${ap.join('-')}</td></tr>`;
}).join('');

// Rank history across all weeks up to this one, drawn as a bump chart (rank 1 on top).
const history = fs.readdirSync(path.dirname(src))
  .filter(f => /^week\d+\.json$/.test(f))
  .map(f => JSON.parse(fs.readFileSync(path.join(path.dirname(src), f), 'utf8')))
  .filter(w => w.week <= d.week)
  .sort((a, b) => a.week - b.week);
const sameTeam = (w, name, n) => (d.teamIds?.[name] != null && w.teamIds?.[n] != null ? w.teamIds[n] === d.teamIds[name] : n === name);
const rankRows = d.standings.map(([name]) => ({
  name,
  ranks: history.map(w => { const i = w.standings.findIndex(([n]) => sameTeam(w, name, n)); return i < 0 ? null : i + 1; }),
}));
// --- Season power ranking: all-play summed over every week so far.
const power = seasonPower(history, d);
const standRank = Object.fromEntries(d.standings.map(([n], i) => [n, i + 1]));
const powerRows = power.map((p, i) => {
  const diff = standRank[p.n] - (i + 1); // + means power rank is better than the standings say
  return `<tr><td class="num">${i + 1}</td><td><span class="prof-team">${logo(p.n, 'logo xs')}<span>${team(p.n)}<small>${esc(mgr(p.n))}</small></span></span></td><td class="num">${p.W}-${p.L}-${p.T}</td><td class="num">${p.pct.toFixed(3).replace(/^0/, '')}</td><td class="num">${standRank[p.n]}위${diff ? ` <span class="pdiff">${diff > 0 ? `▲${diff}` : `▼${-diff}`}</span>` : ''}</td></tr>`;
}).join('');

function bumpChart() {
  const N = d.standings.length, weeks = history.map(w => w.week);
  const cols = Math.max(weeks.length, 2);           // keep room for next week's column
  const VW = 760, padL = 36, padR = 240, top = 40, rowH = 26;
  const VH = top + N * rowH + 8, plotW = VW - padL - padR;
  const x = i => padL + 14 + (i * (plotW - 28)) / (cols - 1);
  const y = r => top + (r - 1) * rowH + rowH / 2;
  const last = weeks.length - 1;
  let s = '';
  for (let r = 1; r <= N; r++) s += `<line class="grid" x1="${padL}" x2="${padL + plotW}" y1="${y(r)}" y2="${y(r)}"/><text class="ax" x="${padL - 8}" y="${y(r)}" text-anchor="end" dominant-baseline="central">${r}</text>`;
  for (let i = 0; i < cols; i++) {
    const real = i < weeks.length;
    s += `<text class="ax wk${real ? '' : ' ghost'}" x="${x(i)}" y="${real ? top - 16 : top - 22}" text-anchor="middle">${real ? `W${weeks[i]}` : `W${weeks[last] + i - last}`}</text>`;
    if (!real) s += `<line class="ghostline" x1="${x(i)}" x2="${x(i)}" y1="${top - 4}" y2="${VH - 8}"/><text class="ax ghost" x="${x(i)}" y="${top - 4}" text-anchor="middle" dy="-1">확정 전</text>`;
  }
  const groups = rankRows.map(t => {
    const pts = t.ranks.map((r, i) => (r == null ? null : [x(i), y(r)])).filter(Boolean);
    const now = t.ranks[last], prev = last > 0 ? t.ranks[last - 1] : null;
    const move = prev == null || now == null ? '' : now < prev ? `▲${prev - now}` : now > prev ? `▼${now - prev}` : '–';
    const tip = `${t.name}: ${t.ranks.map((r, i) => `W${weeks[i]} ${r ?? '-'}위`).join(' → ')}`;
    return `<g class="bt" tabindex="0" aria-label="${esc(tip)}"><title>${esc(tip)}</title>
${pts.length > 1 ? `<polyline class="ln" points="${pts.map(p => p.join(',')).join(' ')}"/>` : ''}${pts.map(([px, py]) => `<circle class="dot" cx="${px}" cy="${py}" r="4.5"/>`).join('')}
<text class="lbl" x="${padL + plotW + 12}" y="${y(now)}" dominant-baseline="central">${esc(t.name)}${move ? `<tspan class="mv" dx="6">${move}</tspan>` : ''}</text>
<rect class="hit" x="${padL}" y="${y(now) - rowH / 2}" width="${VW - padL}" height="${rowH}"/></g>`;
  }).join('\n');
  return `<svg class="bump" viewBox="0 0 ${VW} ${VH}" role="img" aria-label="주차별 순위 변화">${s}${groups}</svg>`;
}

// --- Close calls: categories decided by a hair; the ones that could have flipped a result first.
const VAL = Object.fromEntries(names.map(n => [n, T[n].v]));
const calls = closeCalls(results, VAL, C);
const shownCalls = [...calls.filter(c => c.flips), ...calls.filter(c => !c.flips).slice(0, 5)];
// One table row per close call: both teams' stats sit in adjacent columns so they line up.
const callRow = c => {
  const tie = c.res === 0;
  const r = results.find(x => x.a === c.a && x.b === c.b);
  const gap = Math.abs(c.va - c.vb);
  const gapTxt = tie ? '동률' : c.i < 2 ? gap.toFixed(3).replace(/^0/, '') : String(gap);
  return `<tr class="${c.flips ? 'flip' : ''}">
  <th scope="row" class="cc-cat">${c.cat}</th>
  <td class="cc-team"><span class="prof-team">${logo(c.a, 'logo xs')}<span class="${c.res > 0 ? 'cw' : ''}">${esc(c.a)}</span></span></td>
  <td class="cc-v cc-a${c.res > 0 ? ' win' : ''}">${fmt(c.va, c.i)}</td>
  <td class="cc-v cc-b${c.res < 0 ? ' win' : ''}">${fmt(c.vb, c.i)}</td>
  <td class="cc-team"><span class="prof-team">${logo(c.b, 'logo xs')}<span class="${c.res < 0 ? 'cw' : ''}">${esc(c.b)}</span></span></td>
  <td class="num cc-gap">${gapTxt}</td>
  <td class="num cc-score">${r.w}-${r.l}-${r.t}</td>
</tr>`;
};
const callGroup = (rows, title) => (rows.length ? `<tbody><tr class="cc-group"><th colspan="7">${title}</th></tr>${rows.map(callRow).join('')}</tbody>` : '');
const callTable = () => `<div class="panel scroll"><table class="cc">
  <thead><tr><th>카테고리</th><th>팀</th><th class="cc-v">기록</th><th class="cc-v">기록</th><th>상대 팀</th><th class="num">차이</th><th class="num">매치업</th></tr></thead>
  ${callGroup(shownCalls.filter(c => c.flips), '결과가 바뀔 뻔한 카테고리 — 이 카테고리 하나만 반대로 갔어도 매치업 승패가 달라짐')}
  ${callGroup(shownCalls.filter(c => !c.flips), '그 밖에 근소하게 갈린 카테고리')}
</table></div>`;

// --- Team category profile: each team's rank (1-14) in every category this week.
const RANKS = categoryRanks(VAL);
const bucket = r => (r <= 3 ? 5 : r <= 6 ? 4 : r <= 9 ? 3 : r <= 12 ? 2 : 1);
const profileRows = d.standings.map(([n]) => {
  const rk = RANKS[n];
  const order = rk.map((r, i) => [r, i]).sort((a, b) => a[0] - b[0]);
  const strong = order.slice(0, 2).map(([, i]) => C[i]).join(', ');
  const weak = order.slice(-2).reverse().map(([, i]) => C[i]).join(', ');
  return `<tr><th scope="row"><span class="prof-team">${logo(n, 'logo xs')}${esc(n)}</span></th>${rk.map((r, i) => `<td class="h h${bucket(r)}" title="${esc(n)} · ${C[i]} ${fmt(T[n].v[i], i)} (${r}위)">${r}</td>`).join('')}<td class="sw"><span>강 ${strong}</span><span>약 ${weak}</span></td></tr>`;
}).join('');

const leadTeam = n => `<span class="prof-team">${logo(n, 'logo xs')}<span>${esc(n)}</span></span>`;
const leaderRows = leaders.map(l => `<tr><th scope="row">${l.c}${l.c === 'TO' ? '<small>적을수록 좋음</small>' : ''}</th>
<td><div class="lead-cell"><span class="val">${fmt(l.best, C.indexOf(l.c))}</span>${l.bestBy.map(leadTeam).join('')}</div></td>
<td class="muted"><div class="lead-cell"><span class="val">${fmt(l.worst, C.indexOf(l.c))}</span>${l.worstBy.map(leadTeam).join('')}</div></td></tr>`).join('');

// Players of the week: top 6 player scores, worst player on each team, best new adds.
const base = src.replace(/\.json$/, '');
const P = loadPlayers(`${base}-players.csv`);
const adds = loadAdds(`${base}-adds.csv`);
scorePlayers(P, T);
const MIN_GP_WORST = 2; // 역적 must have played at least this many games for the team (playerGp)
const statLine = p => {
  const s = p.st;
  const pct = (x, l) => (x == null ? null : `${l} ${x.toFixed(3).replace(/^0/, '')}`);
  return [`${s[3]}점`, `${s[4]}리바`, `${s[5]}어시`, s[2] ? `3점 ${s[2]}` : null, s[6] ? `스틸 ${s[6]}` : null, s[7] ? `블락 ${s[7]}` : null, `TO ${s[8]}`, pct(s[0], 'FG'), pct(s[1], 'FT')].filter(Boolean).join(' · ');
};
// Games that counted for the team this week (active slot, not BN/IL), from data.playerGp["name|team"].
const playerGp = p => d.playerGp?.[`${p.name}|${p.team}`] ?? null;
// Per-game line for counting stats; FG%/FT% are already rates and stay as they are.
const perGameLine = (p, gp) => {
  const s = p.st, f = x => (x / gp).toFixed(1).replace(/\.0$/, '');
  const pct = (x, l) => (x == null ? null : `${l} ${x.toFixed(3).replace(/^0/, '')}`);
  return [`${f(s[3])}점`, `${f(s[4])}리바`, `${f(s[5])}어시`, s[2] ? `3점 ${f(s[2])}` : null, s[6] ? `스틸 ${f(s[6])}` : null, s[7] ? `블락 ${f(s[7])}` : null, `TO ${f(s[8])}`, pct(s[0], 'FG'), pct(s[1], 'FT')].filter(Boolean).join(' · ');
};
const pCard = (p, label, cls) => `<article class="pc ${cls}">
  <div class="pc-top"><span class="pc-team">${esc(p.team)}</span><span class="pc-label">${label}</span></div>
  <b class="pc-name">${esc(p.name)} <small>${esc(p.nba)}</small></b>
  <p class="pc-line">${statLine(p)}</p>
  <span class="pc-score">${p.score >= 0 ? '+' : ''}${p.score.toFixed(1)}</span>
</article>`;
// 주간 MVP: the top 6 players of the week by player score, across all teams.
const mvps = P.filter(p => p.played).sort((a, b) => b.score - a.score).slice(0, 6).map((p, i) => ({ p, label: `주간 MVP ${i + 1}위`, rank: i + 1 }));
// Rain cloud drawn over the gloomy (아쉬운 선수) photos.
const CLOUD = `<svg class="cloud" viewBox="0 0 64 48" aria-hidden="true"><path d="M18 30a10 10 0 0 1 1-20 14 14 0 0 1 26 4 8 8 0 0 1 1 16z" fill="#c9d2dc"/><path d="M22 34l-3 7M32 34l-3 7M42 34l-3 7" stroke="#9fb3c8" stroke-width="2.5" stroke-linecap="round" fill="none"/></svg>`;
const photoCard = ({ p, opp, label }, gloom = false) => {
  const img = photoSrc(p.name);
  return `<article class="mvp${gloom ? ' gloom' : ''}">
  <div class="mvp-photo">${logo(p.team, 'mvp-mark')}${img ? `<img class="cut" src="${img}" alt="${esc(p.name)}" loading="lazy">` : `<span class="initials">${esc(p.name.split(' ').map(w => w[0]).join('').slice(0, 2))}</span>`}${gloom ? CLOUD : ''}<span class="mvp-score">${p.score >= 0 ? '+' : ''}${p.score.toFixed(1)}</span></div>
  <div class="mvp-body">
    <div class="pc-top"><span class="pc-team">${esc(p.team)}</span><span class="pc-label">${label ?? `vs ${esc(opp)} ${gloom ? '패' : '승'}`}</span></div>
    <b class="pc-name">${esc(p.name)} <small>${esc(p.nba)}</small></b>
    ${gloom && playerGp(p) ? `<p class="pc-line"><span class="pg-tag">경기당 · ${playerGp(p)}경기</span>${perGameLine(p, playerGp(p))}</p>` : `<p class="pc-line">${playerGp(p) ? `<span class="pg-tag">${playerGp(p)}경기</span>` : ''}${statLine(p)}</p>`}
  </div>
</article>`;
};
const mvpCards = mvps.map(m => photoCard(m)).join('');
// 각 팀의 이번주 역적: one pick per team (all 14, any result), in standings order, with that team's matchup result as the label.
const resultOf = team => {
  const r = results.find(r => r.a === team || r.b === team), me = r.a === team;
  const w = me ? r.w : r.l, l = me ? r.l : r.w;
  return { opp: me ? r.b : r.a, txt: `${w > l ? '승' : w < l ? '패' : '무'} ${w}-${l}${r.t ? `-${r.t}` : ''}` };
};
const flopPicks = d.standings.map(([team]) => ({ team, p: [...teamPlayers(P, team)].reverse().find(p => playerGp(p) == null || playerGp(p) >= MIN_GP_WORST), ...resultOf(team) }));
const flopSkipped = flopPicks.filter(f => !f.p).map(f => f.team);
const flops = flopPicks.filter(f => f.p).map(f => ({ p: f.p, opp: f.opp, label: `vs ${esc(f.opp)} · ${f.txt}` }));
const flopCards = flops.map(f => photoCard(f, true)).join('');
const missingPhotos = [...mvps, ...flops].filter(m => !photoSrc(m.p.name)).map(m => m.p.name);
const missingGp = flops.filter(f => !playerGp(f.p)).map(f => `${f.p.name}|${f.p.team}`);
const addPicks = adds.map(a => ({ a, p: P.find(p => p.name === a.player && p.team === a.team && p.played) })).filter(x => x.p).sort((x, y) => y.p.score - x.p.score);
const TOP_ADDS = 5;
const addRows = addPicks.slice(0, TOP_ADDS).map(({ a, p }, i) => `<li class="add-row">
  <span class="rank">${i + 1}</span>
  ${logo(p.team, 'logo sm')}
  <div class="add-main"><b>${esc(p.name)} <small>${esc(p.nba)}</small></b><span class="add-meta">${esc(p.team)} · ${a.date} 영입 · FAB $${a.bid}</span><span class="pc-line">${statLine(p)}</span></div>
  <span class="add-gp">${playerGp(p) ?? '–'}<small>경기</small></span>
  <span class="add-score">${p.score >= 0 ? '+' : ''}${p.score.toFixed(1)}</span>
</li>`).join('');

// Top-of-page summary: season standings top 3 next to power ranking top 3 (both cumulative).
const top3 = {
  standings: d.standings.slice(0, 3).map(([team, rec]) => ({ team, rec })),
  power: power.slice(0, 3).map(p => ({ team: p.n, rec: `${p.W}-${p.L}-${p.T}` })),
};
// The page's top table shows the top 6 of each (user request 2026-11-10); the summary JSON / archive keep top 3.
const TOP_TABLE_N = 6;
const topTable = {
  standings: d.standings.slice(0, TOP_TABLE_N).map(([team, rec]) => ({ team, rec })),
  power: power.slice(0, TOP_TABLE_N).map(p => ({ team: p.n, rec: `${p.W}-${p.L}-${p.T}` })),
};
const sc = d.standingsComputed ? ' (계산)' : ''; // season records computed from last week + this week (Yahoo standings not yet updated)
const scNote = d.standingsComputed ? ` 시즌 기록은 Yahoo 순위표가 아직 갱신되지 않아 Week ${d.week - 1} 기록에 Week ${d.week} 최종 점수를 더해 계산했습니다.` : '';
const weekSpan = d.week > 1 ? `Week 1–${d.week}` : 'Week 1';
const top3Cell = x => `<td><span class="prof-team">${logo(x.team, 'logo xs')}<span><b>${esc(x.team)}</b><small>${esc(mgr(x.team))}</small></span></span></td><td class="num t3-rec">${x.rec}</td>`;
const top3Table = `<div class="panel scroll"><table class="top3">
  <thead><tr><th class="num">순위</th><th colspan="2">시즌 랭킹 <small>카테고리 W-L-T${sc}</small></th><th colspan="2">파워랭킹 <small>전 팀 상대 W-L-T (계산)</small></th></tr></thead>
  <tbody>${Array.from({ length: TOP_TABLE_N }, (_, i) => `<tr class="r${i + 1}"><td class="num t3-rank">${i + 1}</td>${top3Cell(topTable.standings[i])}${top3Cell(topTable.power[i])}</tr>`).join('')}</tbody>
</table></div>
<p class="note">${weekSpan} 누적 기준입니다. 파워랭킹은 매주 나머지 13팀과 모두 붙었다고 치고 쌓은 기록으로, 대진 운을 뺀 순위입니다.${scNote}</p>`;
const summary = [
  `시즌 랭킹 Top 3: ${top3.standings.map((x, i) => `${i + 1}. ${x.team} ${x.rec}`).join(' / ')}`,
  `파워랭킹 Top 3: ${top3.power.map((x, i) => `${i + 1}. ${x.team} ${x.rec}`).join(' / ')}`,
];

const html = `<title>Real Jungle Week ${d.week}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;800&family=IBM+Plex+Sans+KR:wght@400;600&display=swap">
<style>
/* Layout: single scoreboard column; matchup cards like box scores, then tables. */
:root{
  --bg:#f3f5f8; --surface:#ffffff; --ink:#152231; --muted:#5d6b7a; --line:#d9dfe7;
  --accent:#d4561f; --win:#13784a; --winbg:#e3f3ea; --court:#3a5f8a; --court2:#14243a; --rain1:#66727f; --rain2:#2a313a; --track:#9aa6b4; --seq:#2f63a8; --seq-ink:#ffffff;
  --display:"Barlow Condensed","Arial Narrow",Arial,sans-serif;
  --body:"IBM Plex Sans KR","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --bg:#0f1720; --surface:#16212d; --ink:#e6ecf2; --muted:#93a2b2; --line:#2a3949;
  --accent:#f0804a; --win:#5fd39a; --winbg:#173a2a; --court:#2c4a6e; --court2:#0b1522; --rain1:#4a5562; --rain2:#12171d; --track:#5b6878; --seq:#6aa4e8; --seq-ink:#0f1720; color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#0f1720; --surface:#16212d; --ink:#e6ecf2; --muted:#93a2b2; --line:#2a3949;
  --accent:#f0804a; --win:#5fd39a; --winbg:#173a2a; --court:#2c4a6e; --court2:#0b1522; --rain1:#4a5562; --rain2:#12171d; --track:#5b6878; --seq:#6aa4e8; --seq-ink:#0f1720; color-scheme:dark}
body{background:var(--bg);color:var(--ink);font-family:var(--body);font-size:15px;line-height:1.6}
.wrap{max-width:860px;margin:0 auto;padding-block:28px 56px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:grid;gap:36px}
h1,h2{font-family:var(--display);font-weight:800;letter-spacing:.01em;text-wrap:balance;margin:0;line-height:1.05}
h1{font-size:clamp(40px,8vw,64px)}
h2{font-size:26px;text-transform:uppercase;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
h2 small{font-family:var(--body);font-size:13px;font-weight:400;text-transform:none;color:var(--muted)}
.eyebrow{font-family:var(--display);font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);font-size:15px}
.meta{color:var(--muted);margin:6px 0 0}
.top3-wrap{gap:8px}
.top3{min-width:520px}
.top3 thead th{font-size:13px;color:var(--ink);text-transform:none;letter-spacing:0}
.top3 thead th small{display:inline;margin-left:6px;font-weight:400;font-size:11px;color:var(--muted)}
.top3 thead th:nth-child(3),.top3 td:nth-child(4){border-left:1px solid var(--line);padding-left:14px}
.top3 td{vertical-align:middle}
.top3 .prof-team>span{display:grid;line-height:1.3}
.top3 .prof-team small{font-size:12px;color:var(--muted)}
.t3-rank{font:800 26px var(--display);color:var(--muted);width:56px;text-align:center}
.top3 tr.r1 .t3-rank{color:var(--accent)}
.t3-rec{font:800 18px var(--display);font-variant-numeric:tabular-nums}
section{display:grid;gap:14px;min-width:0}
.matches{display:grid;gap:10px}
.match{background:var(--surface);border:1px solid var(--line);border-radius:6px;min-width:0}
.match header{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px;padding:12px 14px}
.side{display:grid;min-width:0;color:var(--muted)}
.side b{color:var(--ink);font-weight:600;overflow-wrap:anywhere}
.side.w b{color:var(--win)}
.side small{font-size:12px}
.gp{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.gp em{font-style:normal;font-weight:600;color:var(--accent)}
.cat tr.gp-row th,.cat tr.gp-row td{color:var(--muted);font-size:13px;background:var(--bg)}
.side.r{text-align:right}
.score{font-family:var(--display);font-weight:800;font-size:34px;display:flex;align-items:center;gap:6px;font-variant-numeric:tabular-nums;color:var(--muted);position:relative}
.score .w{color:var(--ink)}
.score i{font-style:normal;font-weight:600}
.score em{position:absolute;bottom:-12px;left:50%;transform:translateX(-50%);font:600 11px var(--body);white-space:nowrap;color:var(--muted)}
details{border-top:1px solid var(--line)}
summary{cursor:pointer;padding:8px 14px;font-size:13px;color:var(--muted)}
summary:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{padding:7px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
thead th{font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.cat td{text-align:right}
.cat thead th:not(:first-child){text-align:right}
.cat td.win{color:var(--win);font-weight:600;background:var(--winbg)}
.num{text-align:right;white-space:nowrap}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:6px;overflow-x:auto}
.panel tr:last-child>*{border-bottom:0}
.tm{font-weight:600}
td small,th small{display:block;color:var(--muted);font-size:12px;font-weight:400}
.val{font-family:var(--display);font-weight:800;font-size:18px;margin-right:8px;font-variant-numeric:tabular-nums}
.muted{color:var(--muted)}
.note{font-size:13px;color:var(--muted);margin:0}
.pcs{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
.pcs.one{grid-template-columns:minmax(0,520px)}
.pc{background:var(--surface);border:1px solid var(--line);border-top:3px solid var(--line);border-radius:6px;padding:12px 14px;display:grid;gap:4px;position:relative;min-width:0}
.pc.up{border-top-color:var(--win)} .pc.down{border-top-color:var(--muted)} .pc.add{border-top-color:var(--accent)}
.pc-top{display:grid;font-size:12px;color:var(--muted);padding-right:56px}
.pc-team{font-weight:600;color:var(--ink);overflow-wrap:anywhere}
.pc-name{font-size:17px;padding-right:52px}
.pc-name small{font-weight:400;color:var(--muted);font-size:12px}
.pc-line{margin:0;font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}
.pc-score{position:absolute;top:10px;right:12px;font-family:var(--display);font-weight:800;font-size:24px;font-variant-numeric:tabular-nums}
.pc.up .pc-score{color:var(--win)} .pc.down .pc-score{color:var(--muted)} .pc.add .pc-score{color:var(--accent)}
.side{display:flex;align-items:center;gap:10px}
.side>div{display:grid;min-width:0}
.side.r{flex-direction:row-reverse}
.logo{display:inline-block;width:44px;height:44px;border-radius:50%;flex:none;background-color:var(--line);background-size:cover;background-position:center;border:1px solid var(--line)}
.logo.none{display:inline-block}
.logo.sm{width:32px;height:32px}
.mvps{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.mvps.six{grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
.mvp{background:var(--surface);border:1px solid var(--line);border-radius:8px;overflow:hidden;display:grid;min-width:0}
.mvp-photo{position:relative;aspect-ratio:3/2;max-width:100%;overflow:hidden;background:radial-gradient(120% 90% at 50% 100%,var(--court) 0%,var(--court2) 70%)}
.mvp-photo::after{content:"";position:absolute;inset:auto 0 0;height:30%;background:linear-gradient(transparent,rgba(0,0,0,.35))}
.cut{position:absolute;inset:auto 0 0;width:100%;height:100%;object-fit:contain;object-position:bottom center}
.initials{position:absolute;inset:0;display:grid;place-items:center;font:800 64px var(--display);color:rgba(255,255,255,.7)}
.mvp-mark{position:absolute;top:10px;left:10px;width:34px;height:34px;border-radius:50%;background-size:cover;background-position:center;border:2px solid rgba(255,255,255,.85);z-index:1}
.mvp-score{position:absolute;right:12px;bottom:8px;z-index:1;font:800 30px var(--display);color:#fff;font-variant-numeric:tabular-nums;text-shadow:0 1px 6px rgba(0,0,0,.4)}
.mvp-body{padding:12px 14px;display:grid;gap:4px;min-width:0}
.bump-wrap{margin:0;background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:12px 8px 8px}
.bump-wrap figcaption{font-weight:600;padding:0 8px 4px;display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline}
.bump-wrap figcaption small{font-weight:400;font-size:12px;color:var(--muted)}
.bump{display:block;width:100%;min-width:560px;height:auto;font-family:var(--body)}
.bump .grid{stroke:var(--line);stroke-width:1;stroke-dasharray:1 3}
.bump .ax{fill:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
.bump .wk{font-weight:600;fill:var(--ink)}
.bump .ghost{fill:var(--muted);font-weight:400;font-size:11px}
.bump .ghostline{stroke:var(--line);stroke-width:1.5;stroke-dasharray:3 4}
.bump .ln{fill:none;stroke:var(--track);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.bump .dot{fill:var(--track);stroke:var(--surface);stroke-width:2}
.bump .lbl{fill:var(--ink);font-size:13px}
.bump .mv{fill:var(--muted);font-size:11px}
.bump .hit{fill:transparent}
.bump .bt{cursor:pointer;outline:none}
.bump:hover .bt,.bump:focus-within .bt{opacity:.35}
.bump .bt:hover,.bump .bt:focus{opacity:1}
.bump .bt:hover .ln,.bump .bt:focus .ln{stroke:var(--accent);stroke-width:3}
.bump .bt:hover .dot,.bump .bt:focus .dot{fill:var(--accent)}
.bump .bt:hover .lbl,.bump .bt:focus .lbl{font-weight:600}
.bump .bt:focus-visible .lbl{text-decoration:underline}
.gloom .mvp-photo{background:linear-gradient(180deg,var(--rain1) 0%,var(--rain2) 100%)}
.gloom .cut{filter:grayscale(1) brightness(.78) contrast(1.08)}
.gloom .initials{color:rgba(255,255,255,.4)}
.rain{position:absolute;inset:0;z-index:1;pointer-events:none;
  background-image:repeating-linear-gradient(100deg,rgba(220,232,245,.22) 0 1px,transparent 1px 13px),repeating-linear-gradient(100deg,rgba(220,232,245,.12) 0 1px,transparent 1px 29px);
  background-size:100% 60px,100% 90px;animation:rain 1.1s linear infinite}
@keyframes rain{to{background-position:-10px 60px,-15px 90px}}
.cloud{position:absolute;top:8px;right:10px;width:46px;height:auto;z-index:2}
.gloom .mvp-score{color:#d6dee7}
.gloom .pc-label{color:var(--muted)}
.pg-tag{display:inline-block;margin-right:6px;padding:0 6px;border-radius:4px;font-size:11px;font-weight:600;color:var(--ink);background:var(--bg);border:1px solid var(--line)}
.gloom{border-top:3px solid var(--rain1)}
@media (prefers-reduced-motion:reduce){.rain{animation:none}}
.mvp-body .pc-top,.mvp-body .pc-name{padding-right:0}
.adds{list-style:none;margin:0;padding:0;background:var(--surface);border:1px solid var(--line);border-radius:6px}
.add-row{display:grid;grid-template-columns:28px 32px 1fr auto auto;gap:12px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line)}
.add-row:last-child{border-bottom:0}
.add-row:first-child .rank,.add-row:first-child .add-score{color:var(--accent)}
.rank{font:800 24px var(--display);color:var(--muted);text-align:center}
.add-main{display:grid;min-width:0}
.add-main b small{font-weight:400;color:var(--muted);font-size:12px}
.add-meta{font-size:12px;color:var(--muted);overflow-wrap:anywhere}
.add-score{font:800 22px var(--display);font-variant-numeric:tabular-nums}
.add-gp{font:800 18px var(--display);font-variant-numeric:tabular-nums;color:var(--muted);text-align:center;min-width:44px;display:grid;line-height:1.1}
.add-gp small{font:400 11px var(--body)}
.score-key{color:var(--ink);font-weight:600;margin-top:-6px}
.cc{min-width:640px}
.cc th,.cc td{vertical-align:middle}
.cc-cat{font:800 16px var(--display);color:var(--muted);white-space:nowrap}
.cc tr.flip .cc-cat{color:var(--accent)}
.cc-team{color:var(--muted);font-size:14px}
.cc-team .cw{color:var(--ink);font-weight:600}
.cc-v{text-align:center;width:72px;font:800 18px var(--display);font-variant-numeric:tabular-nums;color:var(--muted)}
thead .cc-v{font:600 12px var(--body);color:var(--muted)}
.cc td.cc-a{border-right:1px dashed var(--line)}
.cc td.win{color:var(--win);background:var(--winbg)}
.cc-gap{font-weight:600;font-variant-numeric:tabular-nums}
.cc-score{color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums}
.cc-group th{font-size:12px;font-weight:600;color:var(--muted);background:var(--bg);text-transform:none;letter-spacing:0;padding:6px 10px}
.cc tbody:first-of-type .cc-group th{color:var(--accent)}
.pdiff{font-size:11px;color:var(--muted)}
.prof-team{display:flex;align-items:center;gap:8px;min-width:0}
.prof-team>span{display:grid}
.lead-cell{display:flex;align-items:center;flex-wrap:wrap;gap:4px 12px}
.lead-cell .val{margin-right:0}
.logo.xs{width:24px;height:24px}
.prof{min-width:640px}
.prof th[scope=row]{font-weight:600;white-space:nowrap}
.prof td,.prof th{padding:6px 6px}
.prof td.h{text-align:center;font-variant-numeric:tabular-nums;font-weight:600;border:2px solid var(--surface);border-radius:4px}
.h1{background:color-mix(in oklab,var(--seq) 8%,var(--surface));color:var(--muted)}
.h2{background:color-mix(in oklab,var(--seq) 22%,var(--surface));color:var(--ink)}
.h3{background:color-mix(in oklab,var(--seq) 40%,var(--surface));color:var(--ink)}
.h4{background:color-mix(in oklab,var(--seq) 64%,var(--surface));color:var(--seq-ink)}
.h5{background:var(--seq);color:var(--seq-ink)}
.sw{display:grid;font-size:12px;color:var(--muted);white-space:nowrap}
.legend{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.legend .h{display:inline-block;padding:1px 8px;border-radius:4px;font-size:11px;font-weight:600}
footer{font-size:12px;color:var(--muted);border-top:1px solid var(--line);padding-top:14px;display:grid;gap:4px}
@media (max-width:520px){.score{font-size:28px}.match header{gap:8px;padding:10px 12px}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
${logoCss()}
</style>
<div class="wrap">
<div>
  <div class="eyebrow">${esc(d.league)} · Fantasy Basketball</div>
  <h1>Week ${d.week} 결과</h1>
  <p class="meta">${d.dates} · 9-cat H2H · ${d.provisional ? '진행 중 (잠정)' : '결과 확정'}</p>${d.provisional ? `
  <p class="meta"><b>잠정 결과:</b> 점수는 ${esc(d.asOf)} KST 기준이며 Yahoo가 결과를 확정하기 전에 바뀔 수 있습니다. 순위 기록은 Week ${d.week - 1} 기록에 이번 주 현재 점수를 더한 잠정치입니다 (계산).</p>` : ''}
</div>

<section class="top3-wrap">${top3Table}</section>

<section>
  <h2>매치업 결과 <small>이긴 카테고리 수와 이번 주 경기 수. 펼치면 카테고리별 기록</small></h2>
  <div class="matches">${matchupCards}</div>
</section>

<section>
  <h2>아깝게 갈린 카테고리 <small>동률이거나 차이가 아주 작았던 카테고리</small></h2>
  ${shownCalls.length ? callTable() : '<p class="note">이번 주에는 아슬아슬하게 갈린 카테고리가 없었습니다.</p>'}
  <p class="note">이긴 쪽 기록이 진하게 표시됩니다. TO는 적은 쪽이 이깁니다. FG%·FT%는 .008 이내, 나머지는 2개 또는 큰 쪽의 3% 이내 차이를 "아깝게 갈렸다"고 봤습니다 (계산). 이번 주 해당 ${calls.length}건${calls.length > shownCalls.length ? ` 중 ${shownCalls.length}건을 보여줍니다` : ''}.</p>
</section>

<section>
  <h2>순위 <small>Week ${d.week} 종료 기준</small></h2>
  <figure class="bump-wrap">
    <figcaption>순위 변화 <small>${history.length > 1 ? '팀 이름에 마우스를 올리거나 누르면 그 팀의 선이 강조됩니다.' : `Week ${d.week}부터 기록합니다. Week ${d.week + 1} 결과가 확정되면 주차별 선이 그려집니다.`}</small></figcaption>
    <div class="scroll">${bumpChart()}</div>
  </figure>
  <div class="panel"><table>
    <thead><tr><th class="num">#</th><th>팀</th><th class="num">카테고리 W-L-T${sc}</th><th class="num">승차 (계산)</th><th class="num">전 팀 상대 (계산)</th></tr></thead>
    <tbody>${standRows}</tbody></table></div>
  <p class="note">승차: 카테고리 W-L-T 기준으로 1위와 몇 경기 차이인지 계산한 값입니다. ((1위 승 − 승) + (패 − 1위 패)) ÷ 2이고, 동률(T)은 넣지 않습니다.</p>
  <p class="note">전 팀 상대: 이번 주 기록으로 나머지 13팀과 모두 붙었다면 몇 승 몇 패였을지 계산한 값입니다. 대진 운을 빼고 본 이번 주 실력입니다.${unlucky.length ? ` 운이 없었던 팀: ${unlucky.map(x => `${esc(x.n)} (${x.ap.join('-')}인데 패배)`).join(', ')}.` : ''}${lucky.length ? ` 운이 좋았던 팀: ${lucky.map(x => `${esc(x.n)} (${x.ap.join('-')}인데 승리)`).join(', ')}.` : ''}</p>
</section>

<section>
  <h2>시즌 파워 랭킹 <small>${d.week > 1 ? `Week 1–${d.week}` : `Week 1`} 전 팀 상대 기록 합계 (계산)</small></h2>
  <div class="panel"><table>
    <thead><tr><th class="num">#</th><th>팀</th><th class="num">전 팀 상대 누적</th><th class="num">승률</th><th class="num">실제 순위</th></tr></thead>
    <tbody>${powerRows}</tbody></table></div>
  <p class="note">매주 나머지 13팀과 모두 붙었다고 치고 쌓은 기록입니다. 대진 운이 빠져 있어서 시즌이 길어질수록 실제 실력에 가까워집니다. 실제 순위 옆 ▲는 파워 랭킹이 실제 순위보다 높다(그동안 운이 없었다), ▼는 낮다(운이 좋았다)는 뜻입니다.${history.length === 1 ? ' 지금은 Week 1 한 주치라 위 순위표의 전 팀 상대 기록과 같습니다.' : ''}</p>
</section>

<section>
  <h2>팀별 카테고리 순위 <small>이번 주 9개 카테고리에서 14팀 중 몇 위였는지</small></h2>
  <div class="panel scroll"><table class="prof">
    <thead><tr><th>팀</th>${C.map(c => `<th class="num">${c}</th>`).join('')}<th>강점 / 약점</th></tr></thead>
    <tbody>${profileRows}</tbody></table></div>
  <p class="note legend"><span class="h h5">1–3</span><span class="h h4">4–6</span><span class="h h3">7–9</span><span class="h h2">10–12</span><span class="h h1">13–14</span> 색이 진할수록 순위가 높습니다. TO는 적을수록 높은 순위입니다. 칸에 마우스를 올리면 실제 기록이 보입니다.</p>
</section>

<section>
  <h2>카테고리 1위·꼴찌</h2>
  <div class="panel"><table>
    <thead><tr><th>카테고리</th><th>최고</th><th>최저</th></tr></thead>
    <tbody>${leaderRows}</tbody></table></div>
</section>

<section>
  <h2>주간 MVP <small>이번 주 리그 전체 선수 중 선수 점수 1–6위</small></h2>
  <div class="mvps six">${mvpCards}</div>
  <p class="note">이번 주 판타지 팀 라인업에서 뛴 선수 전체 중 선수 점수(계산)가 가장 높은 6명입니다. 같은 팀에서 여러 명이 나올 수 있고, 매치업 승패와는 상관없습니다. 스탯은 주간 합계이고, "N경기"는 그 팀 라인업에서 뛴 경기 수입니다(벤치 제외).</p>
</section>

<section>
  <h2>이번 주 최고의 영입 Top ${Math.min(TOP_ADDS, addPicks.length)}</h2>
  <ol class="adds">${addRows}</ol>
  <p class="note score-key">오른쪽 숫자 = 선수 점수(0이 평균)</p>
  <p class="note">Week ${d.week} 기간(${d.dates})에 영입된 선수 ${adds.length}명 중, 영입한 팀에서 뛴 기록으로 순위를 매겼습니다. "경기"는 영입한 팀 라인업에서 뛴 경기 수입니다(벤치 제외).</p>
</section>

<section>
  <h2>각 팀의 이번주 역적 <small>각 팀에서 가장 부진했던 선수</small></h2>
  <div class="mvps">${flopCards}</div>
  <p class="note">한 경기만 뛴 선수가 뽑히지 않도록 이번 주 팀 라인업에서 ${MIN_GP_WORST}경기 이상 뛴 선수 중에서 골랐습니다. 카드의 스탯은 경기 수와 상관없이 비교할 수 있도록 1경기당 평균입니다(팀 라인업에서 뛴 경기 기준, 벤치 제외, FG%·FT%는 주간 기록). 매치업 결과와 상관없이 모든 팀에서 한 명씩 골랐고, 카드는 순위 순서입니다.${flopSkipped.length ? ` ${flopSkipped.map(esc).join(', ')}는 조건에 맞는 선수가 없어 뺐습니다.` : ''}</p>
</section>

<footer>
  <span>출처: Yahoo Fantasy Basketball, ${esc(d.league)} (League ID ${d.leagueId}) — Week ${d.week} 매치업 페이지, 순위 페이지, Transactions 페이지. ${d.collected} 수집. 팀 로고와 선수 사진: Yahoo Sports.</span>
  <span>선수 점수(카드 오른쪽 위 숫자, 계산): 이번 주 뛴 선수 전체와 비교한 9개 카테고리 z-score 합입니다. 0이 평균이고 클수록 잘했습니다. TO는 적을수록 좋게, FG%·FT%는 Yahoo가 선수별 시도 수를 주지 않아 득점을 슈팅 양 대신 써서 반영했습니다. 그 팀 소속으로 뛴 기록만 셉니다.</span>
  <span>“(계산)” 표시 값은 위 페이지의 숫자로 직접 계산했습니다. FG%·FT%는 성공/시도 개수로 다시 계산해 비교했습니다.</span>
  <span>커미셔너 ${esc(d.commissioner)}</span>
</footer>
</div>`;

const out = path.join('reports', `real-jungle-week${d.week}.html`);
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync(out, html);
// Summary for the archive page (archive.mjs).
fs.writeFileSync(path.join('reports', `real-jungle-week${d.week}.summary.json`), JSON.stringify({
  week: d.week, dates: d.dates, top3,
  mvps: mvps.map(m => ({ rank: m.rank, name: m.p.name, team: m.p.team })),
}, null, 1));
console.log('wrote', out, html.length, 'bytes');
console.log(summary.join('\n'));
const missingLogos = names.filter(n => !logoSrc(n));
if (missingLogos.length) console.log('MISSING LOGOS:', missingLogos.join(', '));
if (missingPhotos.length) console.log('MISSING MVP PHOTOS:', missingPhotos.join(', '));
const missingGpAll = [...missingGp, ...mvps.filter(m => !playerGp(m.p)).map(m => `${m.p.name}|${m.p.team}`), ...addPicks.slice(0, TOP_ADDS).filter(x => !playerGp(x.p)).map(x => `${x.p.name}|${x.p.team}`)];
if (missingGpAll.length) console.log("MISSING PLAYER GAMES (playerGp):", missingGpAll.join(", "));
