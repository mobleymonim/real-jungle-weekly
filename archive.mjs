// Build the archive page that lists every weekly report.
// Usage: node archive.mjs [--pages]  ->  reports/archive.html
// Reads data/report-links.json ({week: artifact URL}) and reports/real-jungle-weekN.summary.json.
import fs from 'fs';
import path from 'path';

// --pages: the GitHub Pages site, where every week's report sits next to the archive (relative links).
// Without it: the Claude Artifact URLs in data/report-links.json.
const PAGES = process.argv.includes('--pages');
const links = PAGES
  ? Object.fromEntries(fs.readdirSync('data').map((f) => f.match(/^week(\d+)\.json$/)?.[1]).filter(Boolean).map((w) => [w, `real-jungle-week${w}.html`]))
  : JSON.parse(fs.readFileSync('data/report-links.json', 'utf8'));
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const weeks = Object.keys(links).map(Number).sort((a, b) => b - a);
const entries = weeks.map(w => {
  const f = path.join('reports', `real-jungle-week${w}.summary.json`);
  const s = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { week: w, dates: '', summary: [] };
  const df = path.join('data', `week${w}.json`);
  const provisional = fs.existsSync(df) && !!JSON.parse(fs.readFileSync(df, 'utf8')).provisional;
  return { ...s, url: links[w], provisional };
});
const latest = entries[0];

const card = (e, i) => `<article class="wk${i === 0 ? ' latest' : ''}">
  <div class="wk-head">
    <div><span class="wk-n">Week ${e.week}</span>${i === 0 ? '<span class="pill">최신</span>' : ''}<div class="wk-dates">${esc(e.dates)}${e.provisional ? ' · 진행 중 (잠정)' : ''}</div></div>
    <a class="open" href="${esc(e.url)}" ${PAGES ? '' : 'target="_blank" rel="noopener"'}>리포트 열기 <span aria-hidden="true">→</span></a>
  </div>
  ${e.top3 ? `<div class="scroll"><table class="t3">
    <thead><tr><th class="num">순위</th><th colspan="2">시즌 랭킹</th><th colspan="2">파워랭킹 <small>(계산)</small></th></tr></thead>
    <tbody>${[0, 1, 2].map(i => `<tr class="r${i + 1}"><td class="num rk">${i + 1}</td><td>${esc(e.top3.standings[i].team)}</td><td class="num rec">${e.top3.standings[i].rec}</td><td class="pw">${esc(e.top3.power[i].team)}</td><td class="num rec">${e.top3.power[i].rec}</td></tr>`).join('')}</tbody>
  </table></div>` : ''}
  ${e.mvps?.length ? `<p class="mvp"><span>주간 MVP</span> ${e.mvps.map(m => `${esc(m.name)} <small>(${esc(m.team)})</small>`).join(' · ')}</p>` : ''}
</article>`;

const html = `<title>Real Jungle 리포트 모음</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;800&family=IBM+Plex+Sans+KR:wght@400;600&display=swap">
<style>
/* Layout: one column of week cards, newest first; same look as the weekly report. */
:root{
  --bg:#f3f5f8; --surface:#ffffff; --ink:#152231; --muted:#5d6b7a; --line:#d9dfe7; --accent:#d4561f;
  --display:"Barlow Condensed","Arial Narrow",Arial,sans-serif;
  --body:"IBM Plex Sans KR","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --bg:#0f1720; --surface:#16212d; --ink:#e6ecf2; --muted:#93a2b2; --line:#2a3949; --accent:#f0804a; color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#0f1720; --surface:#16212d; --ink:#e6ecf2; --muted:#93a2b2; --line:#2a3949; --accent:#f0804a; color-scheme:dark}
body{background:var(--bg);color:var(--ink);font-family:var(--body);font-size:15px;line-height:1.6}
.wrap{max-width:760px;margin:0 auto;padding-block:28px 56px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:grid;gap:24px}
.eyebrow{font-family:var(--display);font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);font-size:15px}
h1{font-family:var(--display);font-weight:800;font-size:clamp(36px,7vw,56px);line-height:1.05;margin:0;text-wrap:balance}
.meta{color:var(--muted);margin:6px 0 0}
.list{display:grid;gap:12px}
.wk{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:16px 18px;display:grid;gap:12px;min-width:0}
.wk.latest{border-color:var(--accent)}
.wk-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
.wk-n{font:800 30px var(--display);line-height:1}
.wk-dates{color:var(--muted);font-size:13px;margin-top:4px}
.pill{font:600 11px var(--body);letter-spacing:.06em;padding:2px 8px;border-radius:999px;border:1px solid var(--accent);color:var(--accent);margin-left:8px;vertical-align:middle}
.open{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:6px;background:var(--accent);color:#fff;font-weight:600;text-decoration:none;white-space:nowrap}
.open:hover{filter:brightness(1.08)}
.open:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.wk:not(.latest) .open{background:transparent;color:var(--ink);border:1px solid var(--line)}
.scroll{overflow-x:auto}
.t3{border-collapse:collapse;width:100%;min-width:440px;font-size:14px}
.t3 th,.t3 td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left}
.t3 tr:last-child td{border-bottom:0}
.t3 thead th{font-size:12px;color:var(--muted);font-weight:600}
.t3 thead th small{font-weight:400}
.t3 .num{text-align:right;font-variant-numeric:tabular-nums}
.t3 .rk{font:800 18px var(--display);color:var(--muted);text-align:center;width:44px}
.t3 tr.r1 .rk{color:var(--accent)}
.t3 tr.r1 td:not(.rk){font-weight:600}
.t3 .rec{font:800 15px var(--display)}
.t3 th:nth-child(3),.t3 td.pw{border-left:1px solid var(--line);padding-left:12px}
.mvp{margin:0;font-size:14px;font-weight:600}
.mvp span{font-size:12px;font-weight:400;color:var(--muted);margin-right:6px}
.mvp small{font-weight:400;color:var(--muted);font-size:12px}
.next{font-size:13px;color:var(--muted);margin:0}
footer{font-size:12px;color:var(--muted);border-top:1px solid var(--line);padding-top:14px}
</style>
<div class="wrap">
<div>
  <div class="eyebrow">Real Jungle · Fantasy Basketball</div>
  <h1>주간 리포트 모음</h1>
  <p class="meta">리그 ID 42428 · 9-cat H2H · 리포트 ${entries.length}개 · 최신 Week ${latest.week}</p>
</div>
<div class="list">${entries.map(card).join('')}</div>
<p class="next">Week ${latest.week + 1} 리포트는 그 주 경기가 모두 끝나면(한국 시간 월요일 오후 이후) 이 목록 맨 위에 추가됩니다.</p>
<footer>각 리포트는 Yahoo Fantasy Basketball 기록으로 만들었습니다. "계산" 표시 값은 직접 계산한 값입니다. 커미셔너 Soohyup.</footer>
</div>`;

fs.writeFileSync(path.join('reports', 'archive.html'), html);
console.log('wrote reports/archive.html with', entries.length, 'week(s)');
