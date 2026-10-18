// Rasterizes sticker SVGs to PNG with sharp, and builds contact sheets. Plain Node on purpose: sharp's SVG text path hangs
// under Bun (libvips + Bun threads), so `bun test` and `scripts/stickers-sheet.ts` spawn this script.
//
// Usage: node scripts/stickers-raster.mjs <manifest.json>
// manifest: { fontconfig: "/path/fonts.conf", jobs: [{ svg, png, width?, golden? }],
//             compare?: { dir, update, maxDiffRatio, channelTolerance, results },
//             sheets: [{ out, cols, tileWidth, pad?, tiles: [{ png, label, transparent? }] }] }
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const manifest = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (manifest.fontconfig) process.env.FONTCONFIG_FILE = manifest.fontconfig;
const { default: sharp } = await import('sharp');

for (const job of manifest.jobs ?? []) {
  const svg = readFileSync(job.svg);
  const probe = await sharp(svg).metadata();
  const scale = job.width ? job.width / probe.width : 1;
  await sharp(svg, { density: 72 * scale })
    .png({ compressionLevel: 9 })
    .toFile(job.png);
}

/** Raw RGBA of a PNG. */
async function pixels(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

// Golden check: same size and at most `maxDiffRatio` of the pixels differ by more than `channelTolerance` in any channel
// (text anti-aliasing differs a little between libvips builds, layout and color do not).
if (manifest.compare) {
  const { dir, update, maxDiffRatio, channelTolerance, results } = manifest.compare;
  mkdirSync(dir, { recursive: true });
  const out = [];
  for (const job of (manifest.jobs ?? []).filter((j) => j.golden)) {
    const golden = join(dir, `${job.golden}.png`);
    if (update || !existsSync(golden)) {
      copyFileSync(job.png, golden);
      out.push({ name: job.golden, ok: true, ratio: 0, created: true });
      continue;
    }
    const a = await pixels(job.png);
    const b = await pixels(golden);
    if (a.width !== b.width || a.height !== b.height) {
      out.push({ name: job.golden, ok: false, ratio: 1, reason: `size ${a.width}x${a.height} vs ${b.width}x${b.height}` });
      continue;
    }
    let bad = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]), Math.abs(a.data[i + 3] - b.data[i + 3]));
      if (d > channelTolerance) bad++;
    }
    const ratio = bad / (a.width * a.height);
    out.push({ name: job.golden, ok: ratio <= maxDiffRatio, ratio });
  }
  writeFileSync(results, JSON.stringify(out));
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

for (const sheet of manifest.sheets ?? []) {
  const pad = sheet.pad ?? 24;
  const labelH = 46;
  const tileW = sheet.tileWidth;
  const tiles = [];
  for (const tile of sheet.tiles) {
    const png = sharp(tile.png);
    const meta = await png.metadata();
    const h = Math.round((tileW * meta.height) / meta.width);
    const body = await png.resize(tileW, h).png().toBuffer();
    tiles.push({ ...tile, h, body });
  }
  const rows = [];
  for (let i = 0; i < tiles.length; i += sheet.cols) rows.push(tiles.slice(i, i + sheet.cols));
  const rowH = rows.map((row) => Math.max(...row.map((t) => t.h)) + labelH);
  const width = pad + sheet.cols * (tileW + pad);
  const height = pad + rowH.reduce((a, b) => a + b + pad, 0);
  const composites = [];
  let y = pad;
  rows.forEach((row, r) => {
    row.forEach((tile, c) => {
      const x = pad + c * (tileW + pad);
      if (tile.transparent) {
        const light = tile.transparent === 'light';
        const check = Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${tileW}" height="${tile.h}"><defs><pattern id="c" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="${light ? "#e9e6df" : "#1a1d1b"}"/><rect width="12" height="12" fill="${light ? "#f7f5f0" : "#2a2f2c"}"/><rect x="12" y="12" width="12" height="12" fill="${light ? "#f7f5f0" : "#2a2f2c"}"/></pattern></defs><rect width="100%" height="100%" fill="url(#c)"/></svg>`,
        );
        composites.push({ input: check, left: x, top: y });
      }
      composites.push({ input: tile.body, left: x, top: y });
      const label = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${tileW}" height="${labelH}"><text x="0" y="30" font-family="Plus Jakarta Sans" font-weight="600" font-size="22" fill="#b8c4c8">${esc(tile.label)}</text></svg>`,
      );
      composites.push({ input: label, left: x, top: y + tile.h + 6 });
    });
    y += rowH[r] + pad;
  });
  await sharp({ create: { width, height, channels: 4, background: '#0e1112' } })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(sheet.out);
}
