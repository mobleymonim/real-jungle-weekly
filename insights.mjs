// Extra weekly insights: close calls, season power ranking, per-team category ranks.
// Pure functions over a week's `teams` object ({name: {fgma, ftma, s:[...9]}}).

export const better = (a, b, i) => (i === 8 ? Math.sign(b - a) : Math.sign(a - b)); // TO: lower wins

// Exact category values, with FG%/FT% recomputed from makes/attempts.
export function teamValues(teams) {
  const v = {};
  for (const [n, t] of Object.entries(teams)) {
    const [fm, fa] = t.fgma.split('/').map(Number);
    const [tm, ta] = t.ftma.split('/').map(Number);
    v[n] = [fm / fa, tm / ta, ...t.s.slice(2)];
  }
  return v;
}

export function allPlayOf(values) {
  const names = Object.keys(values), out = {};
  for (const a of names) {
    let w = 0, l = 0, t = 0;
    for (const b of names) {
      if (a === b) continue;
      let cw = 0, cl = 0;
      for (let i = 0; i < 9; i++) { const r = better(values[a][i], values[b][i], i); if (r > 0) cw++; else if (r < 0) cl++; }
      cw > cl ? w++ : cl > cw ? l++ : t++;
    }
    out[a] = [w, l, t];
  }
  return out;
}

// A category is a close call when it tied, or the gap is tiny:
// FG%/FT% within .008, counting stats within max(2, 3% of the larger total).
export const CLOSE = { pct: 0.008, abs: 2, rel: 0.03 };
export function closeCalls(results, values, cats) {
  const out = [];
  for (const r of results) {
    const outcome = (w, l) => Math.sign(w - l);
    const before = outcome(r.w, r.l);
    for (let i = 0; i < 9; i++) {
      const a = values[r.a][i], b = values[r.b][i];
      const gap = Math.abs(a - b);
      const limit = i < 2 ? CLOSE.pct : Math.max(CLOSE.abs, CLOSE.rel * Math.max(a, b));
      if (gap > limit) continue;
      const res = r.res[i];
      // Would the matchup result change if this one category had gone the other way?
      let flips;
      if (res === 0) flips = before === 0; // a tie that, if won by either side, decides a drawn matchup
      else {
        const w = r.w - (res > 0 ? 1 : 0) + (res < 0 ? 1 : 0);
        const l = r.l - (res < 0 ? 1 : 0) + (res > 0 ? 1 : 0);
        flips = outcome(w, l) !== before;
      }
      const closeness = i < 2 ? gap / CLOSE.pct : gap / limit; // 0 = dead even, 1 = edge of "close"
      out.push({ a: r.a, b: r.b, cat: cats[i], i, va: a, vb: b, res, flips, closeness });
    }
  }
  return out.sort((x, y) => (y.flips - x.flips) || (x.closeness - y.closeness));
}

// Rank 1..N in each category (ties share the best rank).
export function categoryRanks(values) {
  const names = Object.keys(values), ranks = {};
  for (const n of names) ranks[n] = [];
  for (let i = 0; i < 9; i++) {
    for (const n of names) {
      const better_ = names.filter(m => better(values[m][i], values[n][i], i) > 0).length;
      ranks[n][i] = better_ + 1;
    }
  }
  return ranks;
}

// Season power ranking: all-play records summed over every week so far.
// `weeks` = week JSONs; teams matched across weeks by teamIds of the latest week when present.
export function seasonPower(weeks, latest) {
  const key = (w, n) => (w.teamIds?.[n] != null ? `id:${w.teamIds[n]}` : `n:${n}`);
  const latestName = {};
  for (const n of Object.keys(latest.teams)) latestName[key(latest, n)] = n;
  const tot = {};
  for (const w of weeks) {
    const ap = allPlayOf(teamValues(w.teams));
    for (const [n, [W, L, T]] of Object.entries(ap)) {
      const name = latestName[key(w, n)] ?? n;
      const t = (tot[name] ??= [0, 0, 0]);
      t[0] += W; t[1] += L; t[2] += T;
    }
  }
  return Object.entries(tot)
    .map(([n, [W, L, T]]) => ({ n, W, L, T, pct: (W + T / 2) / (W + L + T) }))
    .sort((a, b) => b.pct - a.pct || b.W - a.W);
}
