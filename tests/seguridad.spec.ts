// Tests de seguridad del sitio: lo que se publica (HTML, JS, cabeceras) y lo que hay en el repo público.
// Los del Worker del formulario están en worker/test/ y los del asistente en asistente/test/ (node --test).
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const PAGINAS = ['/', '/en/', '/hr/', '/expo/', '/pantalla/'];
const ARCHIVO = (url: string) => `site${url}index.html`;
const LANDINGS = ['/', '/en/', '/hr/'];

// Orígenes externos acordados en SEGURIDAD.md. Cualquier otro tiene que pasar por la CSP y por un PR.
const SCRIPTS_OK = ['static.cloudflareinsights.com'];
const ESTILOS_OK = ['fonts.googleapis.com'];
const HOSTS_OK = ['fonts.googleapis.com', 'fonts.gstatic.com', 'static.cloudflareinsights.com', 'cloudflareinsights.com'];

const tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
const BINARIO = /\.(png|jpe?g|webp|gif|ico|mp4|webm|woff2?|ttf|zip|pdf)$/i;
const textos = tracked.filter((f) => !BINARIO.test(f));
const leer = (f: string) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };

function tags(html: string) { return html.match(/<[a-zA-Z][^>]*>/g) ?? []; }
function attr(tag: string, nombre: string) {
  const m = tag.match(new RegExp(`\\s${nombre}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
}
function cspDe(headers: string) {
  const linea = headers.split('\n').find((l) => l.trim().startsWith('Content-Security-Policy:'))!;
  const csp = linea.split(':').slice(1).join(':').trim();
  return Object.fromEntries(csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const [k, ...v] = d.split(/\s+/); return [k, v]; }));
}

test.describe('HTML publicado', () => {
  for (const url of PAGINAS) {
    test(`${url}: sin manejadores en línea, javascript:, iframes ni http://`, () => {
      const html = readFileSync(ARCHIVO(url), 'utf8');
      for (const t of tags(html)) {
        expect(t, `manejador en línea en ${t.slice(0, 60)}`).not.toMatch(/\son[a-z]+\s*=/i);
        expect(t, `javascript: en ${t.slice(0, 60)}`).not.toMatch(/=\s*["']?\s*javascript:/i);
      }
      expect(html).not.toMatch(/<(iframe|object|embed|frame|applet)\b/i);
      const http = (html.match(/http:\/\/[^\s"'<>)]+/g) ?? []).filter((u) => !u.startsWith('http://www.w3.org/'));
      expect(http, 'recursos o links sin HTTPS').toEqual([]);
    });

    test(`${url}: scripts y estilos externos solo de la lista acordada`, () => {
      const html = readFileSync(ARCHIVO(url), 'utf8');
      for (const t of tags(html)) {
        const tag = t.slice(1).split(/[\s>]/)[0].toLowerCase();
        if (tag === 'script' && attr(t, 'src')) {
          const src = attr(t, 'src')!;
          if (/^https?:|^\/\//.test(src)) expect(SCRIPTS_OK, `script externo ${src}`).toContain(new URL(src, 'https://x').host);
        }
        if (tag === 'link' && /stylesheet/i.test(attr(t, 'rel') ?? '')) {
          const href = attr(t, 'href')!;
          if (/^https?:|^\/\//.test(href)) expect(ESTILOS_OK, `estilo externo ${href}`).toContain(new URL(href, 'https://x').host);
        }
      }
    });

    test(`${url}: los scripts en línea no usan eval, Function, document.write ni innerHTML`, () => {
      const html = readFileSync(ARCHIVO(url), 'utf8');
      const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
      for (const js of inline) expect(js).not.toMatch(/\beval\s*\(|new\s+Function|document\.write|innerHTML|outerHTML|insertAdjacentHTML/);
    });

    test(`${url}: todo link que abre otra pestaña lleva rel="noopener"`, () => {
      for (const t of tags(readFileSync(ARCHIVO(url), 'utf8'))) {
        if (/^<a\s/i.test(t) && attr(t, 'target') === '_blank') expect(attr(t, 'rel') ?? '', t.slice(0, 80)).toMatch(/noopener/);
      }
    });
  }

  for (const url of LANDINGS) {
    test(`${url}: el formulario va por POST al mismo sitio y limita el largo de cada campo`, () => {
      const html = readFileSync(ARCHIVO(url), 'utf8');
      const form = tags(html).find((t) => /^<form\s/i.test(t) && attr(t, 'id') === 'form-contacto')!;
      expect(form).toBeTruthy();
      expect(attr(form, 'method')).toBe('post');
      expect(attr(form, 'action')).toBe('/api/contacto');
      const campos = tags(html).filter((t) => /^<(input|textarea)\s/i.test(t) && /\sname=/.test(t));
      expect(campos.length).toBeGreaterThanOrEqual(5);
      for (const c of campos) expect(Number(attr(c, 'maxlength')), `sin maxlength: ${c.slice(0, 50)}`).toBeGreaterThan(0);
    });
  }

  test('site.js no arma HTML con datos ni usa eval, y solo guarda el tema en el navegador', () => {
    const js = readFileSync('site/assets/site.js', 'utf8');
    expect(js).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function|setTimeout\(\s*['"]/);
    const claves = [...js.matchAll(/localStorage\.setItem\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(claves).toEqual(['tema']);
    expect(js).not.toMatch(/document\.cookie/);
    expect(js).not.toMatch(/formsubmit/i);
  });
});

test.describe('cabeceras (site/_headers)', () => {
  const h = readFileSync('site/_headers', 'utf8');
  const csp = cspDe(h);

  test('CSP estricta: sin eval, sin iframes, sin plugins, formularios y conexiones solo al propio sitio', () => {
    expect(csp['default-src']).toEqual(["'self'"]);
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['frame-ancestors']).toEqual(["'none'"]);
    expect(csp['base-uri']).toEqual(["'self'"]);
    expect(csp['form-action']).toEqual(["'self'"]);
    expect(csp['connect-src']).toEqual(["'self'", 'https://cloudflareinsights.com']);
    expect(csp['img-src']).toEqual(["'self'", 'data:']);
    expect(csp['media-src']).toEqual(["'self'"]);
    // 'unsafe-inline' sigue por el script del tema antes de pintar (ver la nota técnica de SEGURIDAD.md); nada más
    expect(csp['script-src']).toEqual(["'self'", "'unsafe-inline'", 'https://static.cloudflareinsights.com']);
    expect(csp['style-src']).toEqual(["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']);
    expect(csp['font-src']).toEqual(['https://fonts.gstatic.com']);
    expect('upgrade-insecure-requests' in csp).toBe(true);
    const todo = Object.values(csp).flat();
    expect(todo).not.toContain("'unsafe-eval'");
    expect(todo).not.toContain('*');
    expect(todo.filter((v) => v.startsWith('http:'))).toEqual([]);
    expect(todo.filter((v) => /^https:\/\//.test(v)).map((v) => new URL(v).host).every((x) => HOSTS_OK.includes(x))).toBe(true);
  });

  test('HSTS de un año, nosniff, sin framing, COOP y permisos del navegador cerrados', () => {
    expect(h).toMatch(/Strict-Transport-Security: max-age=(\d+); includeSubDomains/);
    expect(Number(h.match(/max-age=(\d+); includeSubDomains/)![1])).toBeGreaterThanOrEqual(31536000);
    for (const must of ['X-Content-Type-Options: nosniff', 'X-Frame-Options: DENY', 'Cross-Origin-Opener-Policy: same-origin', 'Referrer-Policy: strict-origin-when-cross-origin']) expect(h).toContain(must);
    for (const p of ['camera=()', 'microphone=()', 'geolocation=()', 'payment=()']) expect(h).toContain(p);
  });
});

test.describe('en el navegador', () => {
  for (const url of PAGINAS) {
    test(`${url}: sin violaciones de CSP, sin errores y sin pedidos a sitios fuera de la lista`, async ({ page }) => {
      const violaciones: string[] = [];
      const errores: string[] = [];
      const hosts = new Set<string>();
      await page.exposeFunction('__csp', (v: string) => violaciones.push(v));
      await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => (window as any).__csp(`${e.violatedDirective} ${e.blockedURI}`)));
      page.on('pageerror', (e) => errores.push(e.message));
      page.on('request', (r) => { const u = new URL(r.url()); if (u.hostname !== 'localhost') hosts.add(u.hostname); });
      const r = await page.goto(url);
      // el servidor local aplica site/_headers: la CSP de producción está activa en este test
      expect(r!.headers()['content-security-policy']).toContain("default-src 'self'");
      await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise((ok) => setTimeout(ok, 30)); } });
      await page.waitForLoadState('load');
      expect(violaciones).toEqual([]);
      expect(errores).toEqual([]);
      expect([...hosts].filter((x) => !HOSTS_OK.includes(x))).toEqual([]);
    });
  }

  for (const url of LANDINGS) {
    test(`${url}: lo que escribe un visitante nunca se ejecuta ni queda en la URL, cookies o almacenamiento`, async ({ page, context }) => {
      const ataque = '"><img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
      await page.route('**/api/contacto', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: '{"ok":false}' }));
      await page.goto(url);
      const f = page.locator('#form-contacto');
      await f.scrollIntoViewIfNeeded();
      await f.locator('[name=nombre]').fill(ataque);
      await f.locator('[name=email]').fill('prueba@example.com');
      await f.locator('[name=mensaje]').fill(ataque);
      await f.locator('#form-enviar').click();
      await expect(page.locator('#form-fail')).toBeVisible();
      expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
      await expect(page.locator('img[src="x"]')).toHaveCount(0);
      const href = (await page.locator('#form-mailto').getAttribute('href'))!;
      expect(href).toMatch(/^mailto:hola@zustrolabs\.com\?/);
      expect(href).not.toMatch(/[<>"]/);
      expect(page.url()).not.toMatch(/xss|onerror|prueba/i);
      expect(await context.cookies()).toEqual([]);
      const guardado = await page.evaluate(() => Object.keys(localStorage));
      expect(guardado.filter((k) => k !== 'tema')).toEqual([]);
    });
  }

  test('el servidor local no sirve archivos fuera de site/ ni el archivo de cabeceras', async () => {
    // pedido HTTP crudo: así la ruta llega tal cual, sin que un cliente la normalice antes
    const { connect } = await import('node:net');
    const crudo = (ruta: string) => new Promise<string>((ok, mal) => {
      const s = connect(4173, '127.0.0.1', () => s.write(`GET ${ruta} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`));
      let r = ''; s.on('data', (d) => (r += d)); s.on('end', () => ok(r)); s.on('error', mal);
    });
    for (const ruta of ['/../package.json', '/..%2fpackage.json', '/%2e%2e/%2e%2e/etc/passwd', '/..\\package.json', '/_headers', '/../worker/wrangler.toml', '/assets/../../REGLAS.md']) {
      const r = await crudo(ruta);
      expect(r.split('\r\n')[0], ruta).toBe('HTTP/1.1 404 Not Found');
      expect(r, ruta).not.toMatch(/"devDependencies"|root:|ZL-68|Reglas inquebrantables/);
    }
  });

  test('site.js y site.css se revalidan siempre (sin la caché de una semana de /assets/*)', async ({ request }) => {
    for (const ruta of ['/assets/site.js', '/assets/site.css']) {
      const r = await request.get(ruta);
      expect(r.headers()['cache-control'], ruta).toBe('public, max-age=0, must-revalidate');
    }
    expect((await request.get('/assets/hero-poster.jpg')).headers()['cache-control']).toBe('public, max-age=604800');
  });

  // ZL-71: con la versión en la dirección, cada publicación pide archivos nuevos y una copia vieja en caché no se usa.
  test('cada HTML pide site.css y site.js con la versión de su contenido (npm run versionar)', async () => {
    const { hashDe, paginas } = await import('../scripts/versionar.mjs');
    const v = { 'site.css': hashDe('site.css'), 'site.js': hashDe('site.js') };
    const htmls = paginas();
    expect(htmls.length).toBeGreaterThanOrEqual(6);
    for (const f of htmls) {
      const html = readFileSync(f, 'utf8');
      const refs = html.match(/\/assets\/site\.(css|js)[^"']*/g) ?? [];
      for (const r of refs) {
        const archivo = r.slice('/assets/'.length).split('?')[0] as 'site.css' | 'site.js';
        expect(r, `${f}: falta la versión o está vieja; correr npm run versionar`).toBe(`/assets/${archivo}?v=${v[archivo]}`);
      }
    }
    for (const url of ['/', '/en/', '/hr/']) {
      const html = readFileSync(ARCHIVO(url), 'utf8');
      expect(html, url).toContain(`/assets/site.css?v=${v['site.css']}`);
      expect(html, url).toContain(`/assets/site.js?v=${v['site.js']}`);
    }
  });

  test('una versión de site.js que no existe responde el script igual, como JavaScript', async ({ request }) => {
    const r = await request.get('/assets/site.js?v=0000000000');
    expect(r.status()).toBe(200);
    expect(r.headers()['content-type']).toMatch(/javascript/);
  });
});

test.describe('repo público', () => {
  test('sin claves, tokens ni llaves privadas en ningún archivo', () => {
    const patrones: [string, RegExp][] = [
      ['llave privada', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
      ['AWS', /\bAKIA[0-9A-Z]{16}\b/],
      ['GitHub', /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/],
      ['Anthropic', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
      ['OpenAI', /\bsk-(proj-)?[A-Za-z0-9]{32,}/],
      ['Google', /\bAIza[0-9A-Za-z_-]{35}\b/],
      ['Slack', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
      ['asignación de secreto', /\b(api[_-]?key|secret|token|password|passwd|contraseña)\b\s*[:=]\s*["'][^"'\s]{12,}["']/i],
    ];
    const hallados: string[] = [];
    for (const f of textos) {
      const s = leer(f);
      for (const [nombre, re] of patrones) if (re.test(s)) hallados.push(`${f}: ${nombre}`);
    }
    expect(hallados).toEqual([]);
  });

  test('sin datos personales en lo publicado ni en la documentación', () => {
    const revisar = textos.filter((f) => /^(site\/|worker\/src\/|worker\/wrangler\.toml|asistente\/src\/|asistente\/wrangler\.toml|asistente\/evals\/casos\.json|scripts\/|[^/]+\.md$)/.test(f) && !f.endsWith('.svg'));
    const patrones: [string, RegExp][] = [
      ['CUIL/CUIT', /\b(20|23|24|27|30|33|34)-?\d{8}-?\d\b/],
      ['DNI', /\b\d{2}\.\d{3}\.\d{3}\b/],
      ['CBU/CVU', /\b\d{22}\b/],
      ['IBAN', /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}\b/],
      ['correo personal', /[A-Za-z0-9._%+-]+@(gmail|hotmail|yahoo|outlook)\.[a-z.]+/i],
      ['celular argentino completo', /\+?54\s?9\s?\d{3,4}[\s-]?\d{2,4}[\s-]?\d{4}\b/],
    ];
    const hallados: string[] = [];
    for (const f of revisar) {
      const s = leer(f);
      for (const [nombre, re] of patrones) { const m = s.match(re); if (m) hallados.push(`${f}: ${nombre} (${m[0]})`); }
    }
    expect(hallados).toEqual([]);
  });

  test('el nombre del cliente actual no aparece (se compara por hash para no escribirlo acá)', () => {
    // SHA-256 del nombre en minúsculas. Para sumar otro: echo -n "nombre" | sha256sum
    const PROHIBIDOS = new Set(['01c9d31ae687be50d07bfa699f457cc88b26fa302652c86cd0167d85acdfc995']);
    const sha = (s: string) => createHash('sha256').update(s).digest('hex');
    const hallados: string[] = [];
    for (const f of textos) {
      const palabras = leer(f).toLowerCase().match(/[a-záéíóúñüšžčćđ0-9]+/g) ?? [];
      for (let i = 0; i < palabras.length; i++) {
        for (const frase of [palabras[i], `${palabras[i]} ${palabras[i + 1] ?? ''}`]) if (PROHIBIDOS.has(sha(frase))) hallados.push(f);
      }
    }
    expect([...new Set(hallados)]).toEqual([]);
  });

  test('las carpetas y archivos sensibles no se suben', () => {
    const malos = tracked.filter((f) => /(^|\/)(privado|convocatoria|\.wrangler)\/|(^|\/)\.dev\.vars$|(^|\/)\.env(\.|$)|\.(pem|key|p12)$/i.test(f));
    expect(malos).toEqual([]);
    const gi = readFileSync('.gitignore', 'utf8');
    for (const p of ['node_modules/', '.wrangler/', '.dev.vars', 'privado/']) expect(gi).toContain(p);
  });

  test('el Worker no tiene secretos en wrangler.toml y solo atiende /api/contacto', () => {
    // sin los comentarios: lo que cuenta es la configuración
    const w = readFileSync('worker/wrangler.toml', 'utf8').split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    expect(w).not.toMatch(/DESTINO\s*=/);
    expect(w).not.toMatch(/destination_address/);
    const rutas = [...w.matchAll(/pattern\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(rutas.sort()).toEqual(['www.zustrolabs.com/api/contacto', 'zustrolabs.com/api/contacto']);
    expect(w).toMatch(/workers_dev\s*=\s*false/);
  });
});
