// Pone en cada HTML de site/ la versión de site.css y site.js: «/assets/site.css?v=<hash>».
// El hash sale del contenido del archivo, así que cambia solo cuando el archivo cambia y cada
// publicación pide la hoja y el script nuevos (sin caché vieja en el navegador ni en Cloudflare).
// Uso: `npm run versionar` después de tocar site.css o site.js. Un test falla si alguien se olvida.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../site/', import.meta.url));

/** Primeros 10 caracteres del SHA-256 del archivo. */
export function hashDe(archivo) {
  return createHash('sha256').update(readFileSync(join(root, 'assets', archivo))).digest('hex').slice(0, 10);
}

/** Todos los .html debajo de site/. */
export function paginas(dir = root) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? paginas(join(dir, e.name)) : e.name.endsWith('.html') ? [join(dir, e.name)] : []);
}

export function versionar(html, versiones) {
  return html.replace(/\/assets\/(site\.(?:css|js))(?:\?v=[0-9a-f]*)?(?=["'])/g, (_, f) => `/assets/${f}?v=${versiones[f]}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const versiones = { 'site.css': hashDe('site.css'), 'site.js': hashDe('site.js') };
  for (const f of paginas()) {
    const antes = readFileSync(f, 'utf8');
    const despues = versionar(antes, versiones);
    if (despues !== antes) { writeFileSync(f, despues); console.log(`actualizado ${relative(root, f)}`); }
  }
  console.log(`site.css?v=${versiones['site.css']} · site.js?v=${versiones['site.js']}`);
}
