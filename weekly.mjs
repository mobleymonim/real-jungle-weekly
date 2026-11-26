#!/usr/bin/env node
// One command for the weekly data: collect from the Yahoo API, build the page, fetch the photos the
// page needs, then build again. Publishing (Artifact) and the archive stay in the fantasy-weekly skill.
// Usage: node weekly.mjs [week] [--skip-collect]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { api, items, merge } from './yahoo.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PHOTO_CACHE = path.join(DIR, 'data', 'player-photos.json');
const args = process.argv.slice(2);
const skipCollect = args.includes('--skip-collect');
let week = args.find((a) => /^\d+$/.test(a));

const node = (script, ...a) => execFileSync(process.execPath, [script, ...a], { cwd: DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

if (!skipCollect) {
  const out = node('collect.mjs', ...(week ? [week] : []));
  process.stdout.write(out);
  week ||= out.match(/^week (\d+) /m)?.[1];
} else if (!week) {
  throw new Error('--skip-collect needs a week number');
}
const json = path.join('data', `week${week}.json`);

function missingPhotos(buildOut) {
  const line = buildOut.split(/\r?\n/).find((l) => l.startsWith('MISSING MVP PHOTOS:'));
  return line ? line.slice('MISSING MVP PHOTOS:'.length).split(',').map((s) => s.trim()).filter(Boolean) : [];
}

// Yahoo's cutout headshots (background removed). The original is ~3500px; the page uses a 480px copy.
async function cutoutUrl(id, cache) {
  if (cache[id]) return cache[id];
  const f = (await api(`players;player_keys=nba.p.${id}`)).fantasy_content;
  const p = items(f.players).map((x) => x.player)[0];
  const b = merge(p?.[0]);
  const m = String(b.headshot?.url || b.image_url || '').match(/https:\/\/s\.yimg\.com\/xe\/i\/us\/sp\/v\/nba_cutout\/[^?]+/);
  return m ? (cache[id] = m[0]) : null;
}

// Windows: PowerShell System.Drawing (no image tools installed). Elsewhere (GitHub Actions): sharp.
async function shrink(src, dst, width = 480) {
  if (process.platform !== 'win32') {
    const sharp = (await import('sharp')).default;
    await sharp(src).resize({ width }).png().toFile(dst);
    return;
  }
  const ps = `Add-Type -AssemblyName System.Drawing
$src=[System.Drawing.Image]::FromFile('${src}'); $w=${width}; $h=[int]($src.Height*$w/$src.Width)
$bmp=New-Object System.Drawing.Bitmap $w,$h,([System.Drawing.Imaging.PixelFormat]::Format32bppArgb); $g=[System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode='HighQualityBicubic'; $g.DrawImage($src,0,0,$w,$h); $bmp.Save('${dst}',[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose(); $src.Dispose()`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'inherit' });
}

let built = node('build.mjs', json);
const need = missingPhotos(built);
if (need.length) {
  const d = JSON.parse(fs.readFileSync(path.join(DIR, json), 'utf8'));
  const cache = fs.existsSync(PHOTO_CACHE) ? JSON.parse(fs.readFileSync(PHOTO_CACHE, 'utf8')) : {};
  fs.mkdirSync(path.join(DIR, 'assets', 'players'), { recursive: true });
  for (const name of need) {
    const id = d.photos?.[name];
    if (!id) { console.log(`photo: no Yahoo id for ${name}`); continue; }
    const big = path.join(DIR, 'assets', 'players', `${id}.png`);
    const small = path.join(DIR, 'assets', 'players', `${id}-sm.png`);
    if (!fs.existsSync(big)) {
      const url = await cutoutUrl(id, cache);
      if (!url) { console.log(`photo: no cutout for ${name}`); continue; }
      const r = await fetch(url);
      if (!r.ok) { console.log(`photo: download failed for ${name} (HTTP ${r.status})`); continue; }
      fs.writeFileSync(big, Buffer.from(await r.arrayBuffer()));
    }
    if (!fs.existsSync(small)) await shrink(big, small);
    console.log(`photo saved: ${name} (${id})`);
  }
  fs.writeFileSync(PHOTO_CACHE, JSON.stringify(cache, null, 1));
  built = node('build.mjs', json);
}
process.stdout.write(built);
