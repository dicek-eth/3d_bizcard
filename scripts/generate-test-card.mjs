import fs from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';

const root = process.cwd();
const outputDir = path.join(root, 'public', 'cards');
const outputFile = path.join(outputDir, 'bizcard-back.svg');
const cardUrl = process.env.CARD_URL ?? 'http://localhost:5173/?card=default';

await fs.mkdir(outputDir, { recursive: true });

const qrSvg = await QRCode.toString(cardUrl, {
  type: 'svg',
  errorCorrectionLevel: 'H',
  margin: 1,
  color: {
    dark: '#111318',
    light: '#ffffff',
  },
});

const qrDataUrl = `data:image/svg+xml;base64,${Buffer.from(qrSvg).toString('base64')}`;
const pattern = createPattern();

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1050" height="638" viewBox="0 0 1050 638" role="img" aria-labelledby="title desc">
  <title id="title">3D Bizcard back test image</title>
  <desc id="desc">Business card back with QR code and AR tracking pattern.</desc>
  <rect width="1050" height="638" fill="#f7f7f2"/>
  <rect x="26" y="26" width="998" height="586" rx="28" fill="#ffffff" stroke="#111318" stroke-width="5"/>
  <rect x="58" y="58" width="934" height="522" rx="18" fill="#f8fbfb" stroke="#d7e0df" stroke-width="2"/>

  <g opacity="0.96">${pattern}</g>

  <g transform="translate(390 264)">
    <rect x="-28" y="-28" width="316" height="316" rx="18" fill="#ffffff" stroke="#111318" stroke-width="8"/>
    <image href="${qrDataUrl}" x="0" y="0" width="260" height="260" preserveAspectRatio="xMidYMid meet"/>
    <rect x="-45" y="-45" width="350" height="350" rx="30" fill="none" stroke="#1f8a70" stroke-width="7" stroke-dasharray="34 18"/>
    <path d="M-78 -78h74M-78 -78v74M338 -78h-74M338 -78v74M338 338h-74M338 338v-74M-78 338h74M-78 338v-74" fill="none" stroke="#ff4d6d" stroke-width="10" stroke-linecap="round"/>
  </g>

  <g transform="translate(80 93)">
    <text x="0" y="0" fill="#111318" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="800">3D Bizcard</text>
    <text x="0" y="42" fill="#47525f" font-family="Inter, Arial, sans-serif" font-size="20" font-weight="600">Scan. Open. Point camera here.</text>
  </g>

  <g transform="translate(730 106)">
    <circle cx="0" cy="0" r="44" fill="#1f8a70"/>
    <path d="M-12 18l48-18-48-18v13h-30v10h30z" fill="#ffffff"/>
    <text x="-145" y="88" fill="#111318" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="760">AR TARGET SIDE</text>
  </g>

  <g transform="translate(80 528)">
    <rect x="0" y="-22" width="226" height="44" rx="8" fill="#111318"/>
    <text x="20" y="7" fill="#ffffff" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="760">TEST CARD BACK</text>
    <text x="250" y="7" fill="#47525f" font-family="Inter, Arial, sans-serif" font-size="17" font-weight="600">${escapeXml(cardUrl)}</text>
  </g>
</svg>
`;

await fs.writeFile(outputFile, svg, 'utf8');
console.log(`Generated ${path.relative(root, outputFile)}`);
console.log(`QR URL: ${cardUrl}`);

function createPattern() {
  const marks = [];

  for (let i = 0; i < 18; i += 1) {
    const x = 82 + i * 50;
    const y = 178 + ((i * 37) % 128);
    const color = i % 3 === 0 ? '#63d9ff' : i % 3 === 1 ? '#ff4d6d' : '#1f8a70';
    marks.push(`<circle cx="${x}" cy="${y}" r="${8 + (i % 4) * 3}" fill="${color}"/>`);
  }

  for (let i = 0; i < 15; i += 1) {
    const x = 112 + i * 60;
    const y = 418 + ((i * 29) % 72);
    const rotation = (i * 17) % 90;
    const color = i % 2 === 0 ? '#111318' : '#1f8a70';
    marks.push(`<rect x="${x}" y="${y}" width="34" height="12" rx="3" fill="${color}" transform="rotate(${rotation} ${x + 17} ${y + 6})"/>`);
  }

  for (let i = 0; i < 11; i += 1) {
    const x = 650 + (i % 4) * 76;
    const y = 236 + Math.floor(i / 4) * 82;
    const color = i % 2 === 0 ? '#ff4d6d' : '#63d9ff';
    marks.push(`<path d="M${x} ${y}l28 48h-56z" fill="${color}" stroke="#111318" stroke-width="3"/>`);
  }

  marks.push('<path d="M92 362C210 312 290 390 390 344S562 232 692 296s178 96 270 24" fill="none" stroke="#111318" stroke-width="6" stroke-linecap="round" stroke-dasharray="16 18"/>');
  marks.push('<path d="M96 142h246M806 512h132M640 170h180" fill="none" stroke="#1f8a70" stroke-width="8" stroke-linecap="round"/>');
  return marks.join('\n    ');
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
