/**
 * Generates app icons (PWA + Android launcher) from an SVG master.
 * Run: npm run icons   (requires the sharp dev dependency)
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4c2fd6"/>
      <stop offset="1" stop-color="#8b6cff"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="120" fill="url(#g)"/>
  <circle cx="256" cy="256" r="170" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="26"/>
  <path d="M158 322 V250 h30 v72 z M324 322 V250 h30 v72 z" fill="#fff"/>
  <rect x="188" y="262" width="136" height="38" rx="19" fill="#fff"/>
  <path d="M176 206 L228 156 L266 188 L338 118" fill="none" stroke="#c4b5fd" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M300 118 h40 v40" fill="none" stroke="#c4b5fd" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

mkdirSync("public/icons", { recursive: true });
mkdirSync("android/app/src/main/res", { recursive: true });

const sizes = [192, 512];
for (const s of sizes) {
  await sharp(Buffer.from(svg)).resize(s, s).png().toFile(`public/icons/icon-${s}.png`);
  console.log(`public/icons/icon-${s}.png`);
}

// Android launcher icons (put into res dirs after `npx cap add android`)
const android = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
};
for (const [density, px] of Object.entries(android)) {
  const dir = `android/app/src/main/res/mipmap-${density}`;
  mkdirSync(dir, { recursive: true });
  await sharp(Buffer.from(svg)).resize(px, px).png().toFile(`${dir}/ic_launcher.png`);
  await sharp(Buffer.from(svg)).resize(px, px).png().toFile(`${dir}/ic_launcher_round.png`);
  console.log(`${dir}/ic_launcher.png`);
}

console.log("Icons generated ✔");
