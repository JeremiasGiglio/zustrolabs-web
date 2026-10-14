import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const RED = { light: 'rgb(200, 16, 46)', dark: 'rgb(232, 52, 76)' };

test.describe('marca', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`la primera casilla del logo es roja (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/');
      const fill = await page.locator('[data-testid=logo] rect').first().evaluate((r) => getComputedStyle(r).fill);
      expect(fill).toBe(RED[scheme]);
    });

    test(`el damero del retrato arranca en rojo (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/');
      const portrait = page.locator('.portrait');
      await portrait.scrollIntoViewIfNeeded();
      await page.waitForLoadState('load');
      const box = (await portrait.boundingBox())!;
      // se mira un píxel dentro de la primera casilla (8×8 px), lejos del borde redondeado
      const shot = await page.screenshot({ clip: { x: box.x + 3, y: box.y + 3, width: 1, height: 1 } });
      const { PNG } = await import('./png.js');
      const px = PNG.firstPixel(shot);
      expect(px.r).toBeGreaterThan(180);
      expect(px.g).toBeLessThan(80);
    });
  }
});

test.describe('estructura y contenido', () => {
  test('un solo h1 con el lema', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toContainText('IA que funciona porque');
  });

  test('todas las imágenes tienen texto alternativo y los videos, póster', async ({ page }) => {
    await page.goto('/');
    for (const img of await page.locator('img').all()) await expect(img).toHaveAttribute('alt', /.+/);
    for (const v of await page.locator('video').all()) await expect(v).toHaveAttribute('poster', /.+/);
  });

  test('el contacto es hola@zustrolabs.com', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#mail')).toHaveText('hola@zustrolabs.com');
  });

  test('sin precios, sin "contratá" y sin figuras de empresa (potpora HZZ)', async ({ page }) => {
    await page.goto('/');
    const prohibidas = [/precio/i, /contrat[aá]/i, /\bempresa\b/i, /\bS\.A\.?\b/, /\bSAS\b/, /d\.o\.o\./i, /\bdeel\b/i, /\bblanc labs\b/i, /USD|U\$S|US\$/];
    const texto = await page.locator('body').innerText();
    for (const re of prohibidas) expect(texto, `aparece ${re}`).not.toMatch(re);
    // el único "$" permitido está dentro de la demo con datos ficticios
    const fueraDeDemo = await page.evaluate(() => {
      const clon = document.body.cloneNode(true) as HTMLElement;
      clon.querySelectorAll('.kpi, script, style').forEach((n) => n.remove());
      return clon.innerText;
    });
    expect(fueraDeDemo).not.toMatch(/\$\s?\d/);
  });

  test('las demos dicen que los datos son ficticios', async ({ page }) => {
    await page.goto('/');
    for (const demo of await page.locator('.demo').all()) await expect(demo).toContainText(/ficticio/i);
  });

  test('los links externos abren en pestaña nueva y sin opener', async ({ page }) => {
    await page.goto('/');
    for (const a of await page.locator('a[href^="http"]').all()) {
      await expect(a).toHaveAttribute('target', '_blank');
      await expect(a).toHaveAttribute('rel', /noopener/);
    }
  });
});

test.describe('pantalla', () => {
  for (const width of [360, 390, 768, 1280]) {
    test(`sin scroll horizontal a ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const sobra = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(sobra).toBeLessThanOrEqual(0);
    });
  }

  test('con "reducir movimiento" el video del hero no se reproduce', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const pausado = await page.locator('.hero video').evaluate((v: HTMLVideoElement) => v.paused);
    expect(pausado).toBe(true);
  });
});

test.describe('accesibilidad', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`sin violaciones graves de axe (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/');
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const graves = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(graves.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    });
  }
});

test.describe('links en vivo @red', () => {
  const urls = ['https://croata.zustrolabs.com', 'https://radar.jgcup.stream', 'https://github.com/JeremiasGiglio/radar-croacia'];
  for (const url of urls) {
    test(`${url} responde`, async ({ request }) => {
      const r = await request.get(url, { maxRedirects: 5 });
      expect(r.status()).toBeLessThan(400);
    });
  }
});
