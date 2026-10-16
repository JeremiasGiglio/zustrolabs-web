import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const RED = { light: 'rgb(200, 16, 46)', dark: 'rgb(232, 52, 76)' };

// Las tres versiones de la landing. Cada una tiene su lema, su palabra para "ficticio"
// y su lista de términos prohibidos (potpora del HZZ: nada de precios, "contratá" ni figuras de empresa).
const PAGINAS = [
  { lang: 'es', url: '/', lema: /porque están testeados/, ficticio: /ficticio/i,
    prohibidas: [/precio/i, /contrat[aá]/i, /\bempresa\b/i, /\bS\.A\.?\b/, /\bSAS\b/, /d\.o\.o\./i] },
  { lang: 'en', url: '/en/', lema: /because they are tested/, ficticio: /fictional/i,
    prohibidas: [/\bpric(e|ing)\b/i, /\bhire\b/i, /\bcompany\b/i, /\bLtd\b/, /\bInc\b/, /\bLLC\b/, /d\.o\.o\./i] },
  { lang: 'hr', url: '/hr/', lema: /jer su testirani/, ficticio: /izmišljen/i,
    prohibidas: [/\bcijen/i,/\btvrtk/i, /\bpoduzeć/i, /d\.o\.o\./i] },
] as const;

// El nombre del cliente actual no se escribe en este repo público: lo controla tests/seguridad.spec.ts por hash.
const COMUNES = [/\bdeel\b/i, /USD|U\$S|US\$/, /\$\s?\d/];

for (const p of PAGINAS) {
  test.describe(`${p.lang} · ${p.url}`, () => {
    test.describe('marca', () => {
      for (const scheme of ['light', 'dark'] as const) {
        test(`la primera casilla del logo es roja (${scheme})`, async ({ page }) => {
          await page.emulateMedia({ colorScheme: scheme });
          await page.goto(p.url);
          const fill = await page.locator('[data-testid=logo] rect').first().evaluate((r) => getComputedStyle(r).fill);
          expect(fill).toBe(RED[scheme]);
        });

        test(`el damero de los retratos arranca en rojo (${scheme})`, async ({ page }) => {
          await page.emulateMedia({ colorScheme: scheme });
          await page.goto(p.url);
          const portrait = page.locator('.portrait').first();
          await portrait.scrollIntoViewIfNeeded();
          await page.waitForLoadState('load');
          const box = (await portrait.boundingBox())!;
          // se mira un píxel dentro de la primera casilla (8×8 px), pasando el borde de 1 px
          const shot = await page.screenshot({ clip: { x: box.x + 3, y: box.y + 3, width: 1, height: 1 } });
          const { PNG } = await import('./png.js');
          const px = PNG.firstPixel(shot);
          expect(px.r).toBeGreaterThan(180);
          expect(px.g).toBeLessThan(80);
        });
      }
    });

    test.describe('estructura y contenido', () => {
      test('idioma declarado y un solo h1 con el lema', async ({ page }) => {
        await page.goto(p.url);
        await expect(page.locator('html')).toHaveAttribute('lang', p.lang);
        await expect(page.locator('h1')).toHaveCount(1);
        await expect(page.locator('h1')).toContainText(p.lema);
      });

      test('el selector de idioma apunta a las tres versiones y marca la actual', async ({ page }) => {
        await page.goto(p.url);
        const lang = page.locator('header .lang');
        await expect(lang.locator('a')).toHaveCount(3);
        for (const q of PAGINAS) await expect(lang.locator(`a[hreflang="${q.lang}"]`)).toHaveAttribute('href', q.url);
        await expect(lang.locator('a[aria-current="page"]')).toHaveAttribute('hreflang', p.lang);
        for (const q of PAGINAS) await expect(page.locator(`link[rel=alternate][hreflang="${q.lang}"]`)).toHaveAttribute('href', `https://zustrolabs.com${q.url}`);
      });

      test('el equipo son tres personas con su lugar para la foto', async ({ page }) => {
        await page.goto(p.url);
        const team = page.locator('.team li');
        await expect(team).toHaveCount(3);
        await expect(team.locator('h3')).toHaveText(['Jeremías Giglio', 'David Vera', 'Nelson Zalazar']);
        await expect(team.locator('.portrait')).toHaveCount(3);
      });

      test('cuatro soluciones con su paso chico, y cuatro productos disponibles', async ({ page }) => {
        await page.goto(p.url);
        await expect(page.locator('.creds')).toHaveCount(0);
        await expect(page.locator('.solutions > li')).toHaveCount(4);
        await expect(page.locator('.solutions .prob')).toHaveCount(4);
        await expect(page.locator('.solutions .sol')).toHaveCount(4);
        await expect(page.locator('.hero .btn-ghost')).toHaveAttribute('href', /#(productos|products|proizvodi)$/);
        await expect(page.locator('.contact-alt #mail')).toHaveText('hola@zustrolabs.com');
        await expect(page.locator('.product')).toHaveCount(2);
        await expect(page.locator('.product video')).toHaveCount(2);
        await expect(page.locator('.form-card #form-contacto')).toHaveCount(1);
        await expect(page.locator('#form-contacto [name=mensaje]')).toHaveAttribute('maxlength', '500');
        expect(await page.locator('#form-contacto [name=mensaje]').evaluate((e) => getComputedStyle(e).resize)).toBe('none');
        const casos = page.locator('.case');
        await expect(casos).toHaveCount(2);
        await expect(casos.nth(0).locator('a[href="https://radar.zustrolabs.com"]')).toHaveCount(1);
        await expect(casos.nth(0).locator('img[src="/assets/radar-home.jpg"]')).toHaveCount(1);
        await expect(casos.nth(1).locator('a[href="https://croata.zustrolabs.com"]')).toHaveCount(1);
      });

      test('el botón de modo oscuro cambia el tema y lo recuerda', async ({ page }) => {
        await page.emulateMedia({ colorScheme: 'light' });
        await page.goto(p.url);
        await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
        await page.locator('#theme').click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        await page.locator('#theme').click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
        const fondo = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        expect(fondo).toBe('rgb(255, 255, 255)');
      });

      test('todas las imágenes tienen texto alternativo y los videos, póster', async ({ page }) => {
        await page.goto(p.url);
        for (const img of await page.locator('img').all()) await expect(img).toHaveAttribute('alt', /.+/);
        for (const v of await page.locator('video').all()) await expect(v).toHaveAttribute('poster', /.+/);
      });

      test('el contacto es hola@zustrolabs.com', async ({ page }) => {
        await page.goto(p.url);
        await expect(page.locator('#mail')).toHaveText('hola@zustrolabs.com');
      });

      test('sin precios, sin "contratá" y sin figuras de empresa (potpora HZZ)', async ({ page }) => {
        await page.goto(p.url);
        const texto = await page.evaluate(() => {
          const clon = document.body.cloneNode(true) as HTMLElement;
          clon.querySelectorAll('script, style').forEach((n) => n.remove());
          return clon.innerText;
        });
        for (const re of [...p.prohibidas, ...COMUNES]) expect(texto, `aparece ${re}`).not.toMatch(re);
      });

      test('la sección de productos aclara que los videos usan datos ficticios', async ({ page }) => {
        await page.goto(p.url);
        await expect(page.locator('.product').first().locator('xpath=ancestor::section')).toContainText(p.ficticio);
        for (const v of await page.locator('.product video').all()) await expect(v).toHaveAttribute('aria-label', p.ficticio);
        await expect(page.locator('.hero')).toContainText(p.ficticio);
      });

      test('el formulario de contacto valida y envía', async ({ page }) => {
        await page.goto(p.url);
        const f = page.locator('#form-contacto');
        await f.scrollIntoViewIfNeeded();
        await expect(f).toBeVisible();
        // sin nada → pide el nombre; con nombre y mensaje pero sin contacto → pide correo o teléfono
        await f.locator('#form-enviar').click();
        await expect(page.locator('#form-error')).toBeVisible();
        await f.locator('[name=nombre]').fill('Prueba');
        await f.locator('[name=mensaje]').fill('Quiero un agente de WhatsApp.');
        await f.locator('#form-enviar').click();
        await expect(page.locator('#form-error')).toContainText(/correo|email|e-po/i);
        // con teléfono alcanza: se envía y muestra la confirmación
        let enviado: any = null;
        let pedido: any = null;
        await page.route('**/api/contacto', async (route) => { pedido = route.request(); enviado = pedido.postDataJSON(); await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
        await f.locator('[name=telefono]').fill('+54 341 555 0000');
        await f.locator('#form-enviar').click();
        await expect(page.locator('#form-ok')).toBeVisible();
        // va al Worker propio, del mismo origen, por POST y en JSON
        expect(new URL(pedido.url()).pathname).toBe('/api/contacto');
        expect(new URL(pedido.url()).origin).toBe(new URL(page.url()).origin);
        expect(pedido.method()).toBe('POST');
        expect(pedido.headers()['content-type']).toMatch(/^application\/json/);
        expect(enviado.nombre).toBe('Prueba');
        expect(enviado.telefono).toBe('+54 341 555 0000');
        expect(enviado.idioma).toBe(p.lang);
        expect(enviado.web).toBe('');
        expect(typeof enviado.t).toBe('number');
        // nada de lo escrito queda en la dirección de la página
        expect(page.url()).not.toMatch(/Prueba|555|\?/);
      });

      test('si el envío falla, el formulario ofrece el correo con el mensaje armado', async ({ page }) => {
        await page.goto(p.url);
        await page.route('**/api/contacto', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: '{"ok":false,"error":"envio"}' }));
        const f = page.locator('#form-contacto');
        await f.scrollIntoViewIfNeeded();
        await f.locator('[name=nombre]').fill('Prueba');
        await f.locator('[name=email]').fill('prueba@example.com');
        await f.locator('[name=mensaje]').fill('Hola');
        await f.locator('#form-enviar').click();
        await expect(page.locator('#form-fail')).toBeVisible();
        const href = await page.locator('#form-mailto').getAttribute('href');
        expect(href).toMatch(/^mailto:hola@zustrolabs\.com\?subject=/);
        expect(decodeURIComponent(href!)).toContain('Prueba');
      });

      test('el único contacto es el correo', async ({ page }) => {
        await page.goto(p.url);
        await expect(page.locator('#contacto a[href^="http"], #contact a[href^="http"], #kontakt a[href^="http"]')).toHaveCount(0);
        await expect(page.locator('body')).not.toContainText(/whatsapp:\s*\+?\d/i);
      });

      test('los links externos abren en pestaña nueva y sin opener', async ({ page }) => {
        await page.goto(p.url);
        for (const a of await page.locator('a[href^="http"]').all()) {
          await expect(a).toHaveAttribute('target', '_blank');
          await expect(a).toHaveAttribute('rel', /noopener/);
        }
      });

      test('los links internos de la navegación llevan a secciones que existen', async ({ page }) => {
        await page.goto(p.url);
        for (const a of await page.locator('header a[href^="#"], footer a[href^="#"]').all()) {
          const id = (await a.getAttribute('href'))!.slice(1);
          await expect(page.locator(`#${id}`), `falta #${id}`).toHaveCount(1);
        }
      });
    });

    test.describe('pantalla', () => {
      for (const width of [320, 360, 390, 768, 1024, 1280, 1920]) {
        test(`sin scroll horizontal a ${width}px`, async ({ page }) => {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(p.url);
          const sobra = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          expect(sobra).toBeLessThanOrEqual(0);
        });
      }

      test('en celular los botones y links sueltos miden al menos 24 px (WCAG 2.5.8) y la letra no baja de 11,5 px', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(p.url);
        const r = await page.evaluate(() => {
          const visible = (e: Element) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && !e.closest('.hp, [hidden], nav:not(.open)'); };
          // los links dentro de una oración quedan exceptuados por la norma
          const enTexto = (e: Element) => e.tagName === 'A' && !!e.closest('p, li span, .talks li');
          const chicos = [...document.querySelectorAll('a, button, input, select, textarea, summary')].filter((e) => visible(e) && !enTexto(e))
            .filter((e) => { const b = e.getBoundingClientRect(); return b.height < 23.5 || b.width < 23.5; })
            .map((e) => `${e.tagName} «${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 24)}» ${Math.round(e.getBoundingClientRect().width)}×${Math.round(e.getBoundingClientRect().height)}`);
          const letras = [...document.querySelectorAll('body *')].filter((e) => visible(e) && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()))
            .map((e) => parseFloat(getComputedStyle(e).fontSize));
          return { chicos, min: Math.min(...letras) };
        });
        expect(r.chicos).toEqual([]);
        expect(r.min).toBeGreaterThanOrEqual(11.5); // los rótulos en mayúscula de .74rem (11,8 px) son el piso
      });

      test('en celular el menú se abre y se cierra', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(p.url);
        const nav = page.locator('#nav');
        await expect(nav).toBeHidden();
        await page.locator('#menu').click();
        await expect(nav).toBeVisible();
        await expect(page.locator('#menu')).toHaveAttribute('aria-expanded', 'true');
        await nav.locator('a[href^="#"]').first().click();
        await expect(nav).toBeHidden();
      });

      test('el hero muestra el agente de turnos y ningún video arranca solo', async ({ page }) => {
        await page.goto(p.url);
        await expect(page.locator('.hero .phone-mock')).toHaveCount(1);
        await expect(page.locator('.hero .phone-mock .msg.flag')).toHaveCount(1);
        await expect(page.locator('video[autoplay]')).toHaveCount(0);
      });
    });

    test.describe('accesibilidad', () => {
      for (const scheme of ['light', 'dark'] as const) {
        test(`sin violaciones graves de axe (${scheme})`, async ({ page }) => {
          // axe mide el estado final: sin animaciones a medio camino
          await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
          await page.goto(p.url);
          const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
          const graves = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
          expect(graves.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
        });
      }
    });
  });
}

// Páginas de apoyo para la exposición: la de QR (/expo/) y la de pantalla grande (/pantalla/). Solo en castellano.
for (const url of ['/expo/', '/pantalla/']) {
  test.describe(`apoyo · ${url}`, () => {
    test('un solo h1, imágenes con alt y la primera casilla del logo roja', async ({ page }) => {
      await page.goto(url);
      await expect(page.locator('html')).toHaveAttribute('lang', 'es');
      await expect(page.locator('h1')).toHaveCount(1);
      for (const img of await page.locator('img').all()) await expect(img).toHaveAttribute('alt', /.+/);
      const fill = await page.locator('[data-testid=logo] rect').first().evaluate((r) => getComputedStyle(r).fill);
      expect([RED.light, RED.dark]).toContain(fill);
    });

    test('sin precios ni figuras de empresa, y los links externos sin opener', async ({ page }) => {
      await page.goto(url);
      const texto = await page.locator('body').innerText();
      for (const re of [...PAGINAS[0].prohibidas, ...COMUNES]) expect(texto, `aparece ${re}`).not.toMatch(re);
      for (const a of await page.locator('a[href^="http"]').all()) {
        await expect(a).toHaveAttribute('target', '_blank');
        await expect(a).toHaveAttribute('rel', /noopener/);
      }
    });

    for (const width of [360, 1280, 1920]) {
      test(`sin scroll horizontal a ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1080 });
        await page.goto(url);
        const sobra = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(sobra).toBeLessThanOrEqual(0);
      });
    }

    test('con "reducir movimiento" ningún video arranca solo', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(url);
      for (const v of await page.locator('video').all()) expect(await v.evaluate((e: HTMLVideoElement) => e.paused)).toBe(true);
    });

    test('sin violaciones graves de axe', async ({ page }) => {
      await page.goto(url);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const graves = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(graves.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    });
  });
}

// Las cabeceras las aplica Cloudflare Pages a partir de site/_headers: se revisa el archivo, no la respuesta local.
test.describe('cabeceras de seguridad (site/_headers)', () => {
  test('la CSP y las cabeceras clave siguen en su lugar', async () => {
    const { readFileSync } = await import('node:fs');
    const h = readFileSync('site/_headers', 'utf8');
    for (const must of [
      "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self';",
      'Strict-Transport-Security: max-age=31536000', 'X-Content-Type-Options: nosniff', 'X-Frame-Options: DENY',
      '/assets/site.css\n  ! Cache-Control\n  Cache-Control: public, max-age=0, must-revalidate',
    ]) expect(h, `falta ${must}`).toContain(must);
    expect(h).not.toMatch(/unsafe-eval/);
    // ningún origen fuera de la lista acordada en SEGURIDAD.md
    const permitidos = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://static.cloudflareinsights.com', 'https://cloudflareinsights.com'];
    for (const o of h.match(/https:\/\/[a-z0-9.-]+/g) ?? []) expect(permitidos, `origen no acordado: ${o}`).toContain(o);
  });
});

test.describe('links en vivo @red', () => {
  const urls = ['https://croata.zustrolabs.com', 'https://radar.zustrolabs.com', 'https://github.com/JeremiasGiglio/radar-croacia'];
  for (const url of urls) {
    test(`${url} responde`, async ({ request }) => {
      const r = await request.get(url, { maxRedirects: 5 });
      expect(r.status()).toBeLessThan(400);
    });
  }
});
