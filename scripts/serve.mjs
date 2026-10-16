// Servidor estático mínimo para mirar la página y para los tests (sin dependencias).
// Aplica las cabeceras de site/_headers igual que Cloudflare Pages, así los tests ven la CSP real.
// En local se quitan solo dos cosas que no tienen sentido sin HTTPS: HSTS y upgrade-insecure-requests.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../site/', import.meta.url));
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.vtt': 'text/vtt', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8' };

/** Lee site/_headers: bloques «ruta» seguidos de líneas «  Nombre: valor». */
function leerHeaders(texto) {
  const reglas = [];
  let actual = null;
  for (const linea of texto.split(/\r?\n/)) {
    if (!linea.trim() || linea.trim().startsWith('#')) continue;
    if (!/^\s/.test(linea)) { actual = { patron: linea.trim(), cabeceras: [] }; reglas.push(actual); continue; }
    const t = linea.trim();
    if (actual && t.startsWith('!')) { actual.cabeceras.push([t.slice(1).trim(), null]); continue; }
    const i = t.indexOf(':');
    if (actual && i > 0) actual.cabeceras.push([t.slice(0, i).trim(), t.slice(i + 1).trim()]);
  }
  return reglas.map((r) => ({ ...r, re: new RegExp('^' + r.patron.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$') }));
}

const reglas = leerHeaders(readFileSync(join(root, '_headers'), 'utf8'));

function cabecerasPara(ruta) {
  const h = {};
  // Como Cloudflare Pages: las reglas que coinciden se suman; un mismo nombre se junta con coma y «! Nombre» lo saca.
  for (const r of reglas) if (r.re.test(ruta)) for (const [k, v] of r.cabeceras) {
    if (v === null) delete h[k]; else h[k] = h[k] ? `${h[k]}, ${v}` : v;
  }
  delete h['Strict-Transport-Security'];
  if (h['Content-Security-Policy']) h['Content-Security-Policy'] = h['Content-Security-Policy'].replace(/;?\s*upgrade-insecure-requests/, '');
  return h;
}

http.createServer(async (req, res) => {
  try {
    const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file0 = join(root, normalize(ruta));
    if (!file0.startsWith(root) && file0 + sep !== root) throw new Error('fuera de site/');
    let file = file0;
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    if (file.endsWith(`${sep}_headers`)) throw new Error('no se sirve');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', ...cabecerasPara(ruta) });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`http://localhost:${port}`));
