import sharp from "sharp";
import { readdirSync, mkdirSync, statSync, rmSync } from "fs";
import { join, dirname } from "path";

const srcDir = "public/screens-src";
const outDir = "public/screens";
mkdirSync(outDir, { recursive: true });

const WIDTHS = [1600, 1280, 1024]; // 2880px original is larger than any display slot
const QUALITY = 80;

const files = readdirSync(srcDir).filter(f => f.toLowerCase().endsWith(".png")).sort();
let totalPng = 0, totalWebp = 0;

for (const f of files) {
  const src = join(srcDir, f);
  const base = f.replace(/\.png$/i, "");
  const size = statSync(src).size;
  totalPng += size;
  console.log(`\n${base}: PNG ${(size/1024).toFixed(0)} KB`);

  // primary: 1600w webp (keep a PNG fallback at same width)
  const buf1600 = await sharp(src).resize(1600).webp({ quality: QUALITY, effort: 6 }).toBuffer();
  await sharp(src).resize(1600).png({ compressionLevel: 9, effort: 4 }).toFile(join(outDir, `${base}.png`));
  // remove the original 2880px copy first — replaced by the 1600w one below
  const { writeFileSync } = await import("fs");
  writeFileSync(join(outDir, `${base}.webp`), buf1600);
  totalWebp += buf1600.length;
  console.log(`  webp@1600 q80: ${(buf1600.length/1024).toFixed(0)} KB`);

  // responsive variants (used via next/image's automatic srcset, but keep on disk for <picture> fallback)
  for (const w of [1280, 1024]) {
    const b = await sharp(src).resize(w).webp({ quality: QUALITY, effort: 6 }).toBuffer();
    writeFileSync(join(outDir, `${base}-${w}.webp`), b);
    console.log(`  webp@${w} q80: ${(b.length/1024).toFixed(0)} KB`);
  }
  // AVIF for modern browsers
  const avif = await sharp(src).resize(1600).avif({ quality: 50, effort: 6 }).toBuffer();
  writeFileSync(join(outDir, `${base}.avif`), avif);
  console.log(`  avif@1600 q50: ${(avif.length/1024).toFixed(0)} KB`);
}

console.log(`\n=== TOTAL PNG: ${(totalPng/1024).toFixed(0)} KB -> WEBP: ${(totalWebp/1024).toFixed(0)} KB (${(totalWebp/totalPng*100).toFixed(0)}%, ${(totalPng/totalWebp).toFixed(1)}x smaller)`);
