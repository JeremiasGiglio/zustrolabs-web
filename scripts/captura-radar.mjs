// Captura real de la portada del Radar para la landing. Uso: node scripts/captura-radar.mjs
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const out = fileURLToPath(new URL('../site/assets/radar-home.jpg', import.meta.url));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 });
await p.goto('https://radar.zustrolabs.com/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
await p.screenshot({ path: out, type: 'jpeg', quality: 82 });
await b.close();
console.log('ok', out);
