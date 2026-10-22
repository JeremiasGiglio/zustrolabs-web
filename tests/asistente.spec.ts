import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Asistente «Preguntale a Zustro» (ZL-105). La IA se simula: estos tests miden la página, no al modelo
// (las evals del modelo están en asistente/evals/).
const PAGINAS = [
  { lang: 'es', url: '/', boton: 'Preguntale a Zustro', equipo: '#equipo', contacto: '#contacto', escribir: 'Escribinos', limite: /muchas preguntas/,
    prohibidas: [/precio/i, /contrat[aá]/i, /\bempresa\b/i] },
  { lang: 'en', url: '/en/', boton: 'Ask Zustro', equipo: '#team', contacto: '#contact', escribir: 'Write to us', limite: /a lot in a row/,
    prohibidas: [/\bpric(e|ing)\b/i, /\bhire\b/i, /\bcompany\b/i] },
  { lang: 'hr', url: '/hr/', boton: 'Pitajte Zustro', equipo: '#tim', contacto: '#kontakt', escribir: 'Pišite nam', limite: /puno pitanja/,
    prohibidas: [/\bcijen/i, /\btvrtk/i, /\bpoduzeć/i] },
] as const;

type Respuesta = { respuesta: string; secciones?: string[]; enlaces?: string[]; escribirnos?: boolean };
const ok = (r: Respuesta) => (route: Route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, secciones: [], enlaces: [], escribirnos: false, ...r }) });

async function abrir(page: Page, url: string, boton: string) {
  await page.goto(url);
  await page.getByRole('button', { name: boton }).click();
  await expect(page.locator('#asis-panel')).toBeVisible();
}
async function preguntar(page: Page, texto: string) {
  await page.locator('#asis-texto').fill(texto);
  await page.locator('#asis-enviar').click();
}

for (const p of PAGINAS) {
  test.describe(`asistente · ${p.lang}`, () => {
    test('se abre con el botón, toma el foco y se cierra con Escape devolviendo el foco', async ({ page }) => {
      await abrir(page, p.url, p.boton);
      await expect(page.locator('#asis-texto')).toBeFocused();
      await expect(page.locator('#asis-log .asis-msg')).toHaveCount(1);
      await expect(page.locator('#asis-abrir')).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Escape');
      await expect(page.locator('#asis-panel')).toBeHidden();
      await expect(page.locator('#asis-abrir')).toBeFocused();
    });

    test('manda la pregunta con el idioma de la página y muestra la respuesta con sus botones', async ({ page }) => {
      let cuerpo: any;
      await page.route('**/api/chat', (route) => { cuerpo = route.request().postDataJSON(); return ok({ respuesta: 'Somos tres personas en Rosario.', secciones: ['equipo'], enlaces: ['radar'], escribirnos: true })(route); });
      await abrir(page, p.url, p.boton);
      await preguntar(page, '¿Quiénes son?');
      const r = page.locator('#asis-log .de-zustro').last();
      await expect(r).toContainText('Somos tres personas en Rosario.');
      expect(cuerpo).toEqual({ idioma: p.lang, mensajes: [{ de: 'persona', texto: '¿Quiénes son?' }] });
      await expect(r.locator(`.asis-chips a[href="${p.equipo}"]`)).toHaveCount(1);
      const radar = r.locator('.asis-chips a[href="https://radar.zustrolabs.com"]');
      await expect(radar).toHaveAttribute('target', '_blank');
      await expect(radar).toHaveAttribute('rel', 'noopener');
      await expect(r.locator(`.asis-chips a.escribir[href="${p.contacto}"]`)).toHaveText(p.escribir);
      // el botón de escribirnos lleva al formulario y cierra el panel
      await r.locator('.asis-chips a.escribir').click();
      await expect(page.locator('#asis-panel')).toBeHidden();
      await expect(page).toHaveURL(new RegExp(`${p.contacto}$`));
    });

    test('la respuesta de la IA nunca se ejecuta: se muestra como texto', async ({ page }) => {
      const ataque = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script><a href="javascript:alert(1)">x</a>';
      await page.route('**/api/chat', ok({ respuesta: ataque, secciones: ['admin', '"><img src=x>'], enlaces: ['javascript:alert(1)', '__proto__', 'constructor'] }));
      await abrir(page, p.url, p.boton);
      await preguntar(page, ataque);
      await expect(page.locator('#asis-log .de-zustro').last()).toContainText('<img src=x');
      expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
      await expect(page.locator('#asis img, #asis script, #asis a[href^="javascript"]')).toHaveCount(0);
      await expect(page.locator('#asis-log .asis-chips')).toHaveCount(0);
    });

    test('la charla no queda en la URL, en cookies ni en el almacenamiento', async ({ page, context }) => {
      await page.route('**/api/chat', ok({ respuesta: 'Hola.' }));
      await abrir(page, p.url, p.boton);
      await preguntar(page, 'mi correo es secreto@example.com');
      await expect(page.locator('#asis-log .de-zustro').last()).toContainText('Hola.');
      expect(page.url()).not.toMatch(/secreto|example/);
      expect(await context.cookies()).toEqual([]);
      const guardado = await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)]);
      expect(guardado.filter((k) => k !== 'tema')).toEqual([]);
    });

    test('si la IA no responde, ofrece escribirnos; si hay demasiadas preguntas, pide esperar', async ({ page }) => {
      let n = 0;
      await page.route('**/api/chat', (route) => (++n === 1
        ? route.fulfill({ status: 502, contentType: 'application/json', body: '{"ok":false}' })
        : route.fulfill({ status: 429, contentType: 'application/json', body: '{"ok":false,"error":"limite"}' })));
      await abrir(page, p.url, p.boton);
      await preguntar(page, 'hola');
      const r = page.locator('#asis-log .de-zustro').last();
      await expect(r).toContainText('contact@zustrolabs.com');
      await expect(r.locator(`a.escribir[href="${p.contacto}"]`)).toHaveCount(1);
      await preguntar(page, 'otra');
      await expect(page.locator('#asis-log .de-zustro').last()).toContainText(p.limite);
      await expect(page.locator('#asis-enviar')).toBeEnabled();
    });

    test('sin conexión: el mismo aviso con el correo', async ({ page }) => {
      await page.route('**/api/chat', (route) => route.abort('internetdisconnected'));
      await abrir(page, p.url, p.boton);
      await preguntar(page, 'hola');
      await expect(page.locator('#asis-log .de-zustro').last()).toContainText('contact@zustrolabs.com');
    });

    test('las sugerencias preguntan con un toque y se ocultan después', async ({ page }) => {
      let cuerpo: any;
      await page.route('**/api/chat', (route) => { cuerpo = route.request().postDataJSON(); return ok({ respuesta: 'Respuesta.' })(route); });
      await abrir(page, p.url, p.boton);
      const primera = page.locator('#asis-sug button').first();
      const texto = (await primera.textContent())!.trim();
      await primera.click();
      await expect(page.locator('#asis-log .de-vos')).toHaveText(new RegExp(texto.replace(/[?]/g, '\\?')));
      expect(cuerpo.mensajes.at(-1).texto).toBe(texto);
      await expect(page.locator('#asis-sug')).toBeHidden();
    });

    test('la segunda pregunta manda la charla anterior (solo los últimos mensajes)', async ({ page }) => {
      const cuerpos: any[] = [];
      await page.route('**/api/chat', (route) => { cuerpos.push(route.request().postDataJSON()); return ok({ respuesta: `Respuesta ${cuerpos.length}.` })(route); });
      await abrir(page, p.url, p.boton);
      for (let i = 1; i <= 6; i++) {
        await preguntar(page, `pregunta ${i}`);
        await expect(page.locator('#asis-log .de-zustro').last()).toContainText(`Respuesta ${i}.`);
      }
      expect(cuerpos[1].mensajes).toEqual([{ de: 'persona', texto: 'pregunta 1' }, { de: 'asistente', texto: 'Respuesta 1.' }, { de: 'persona', texto: 'pregunta 2' }]);
      expect(cuerpos[5].mensajes.length).toBeLessThanOrEqual(8);
      expect(cuerpos[5].mensajes.at(-1)).toEqual({ de: 'persona', texto: 'pregunta 6' });
    });

    test('textos del asistente sin palabras prohibidas (potpora del HZZ)', async ({ page }) => {
      await page.goto(p.url);
      const t = (await page.locator('#asis').evaluate((el) => el.textContent + ' ' + Object.values((el as HTMLElement).dataset).join(' ')))!;
      for (const re of p.prohibidas) expect(t, `aparece ${re}`).not.toMatch(re);
    });

    test('accesible con el panel abierto y una respuesta (WCAG A y AA)', async ({ page }) => {
      await page.route('**/api/chat', ok({ respuesta: 'Hacemos sitios.', secciones: ['servicios'], escribirnos: true }));
      await abrir(page, p.url, p.boton);
      await preguntar(page, 'hola');
      await expect(page.locator('#asis-log .asis-chips')).toHaveCount(1);
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        const r = await new AxeBuilder({ page }).include('#asis').withTags(['wcag2a', 'wcag2aa']).analyze();
        const graves = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(graves.map((v) => `${scheme} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      }
    });

    test('el panel entra en la pantalla sin scroll horizontal', async ({ page }) => {
      await abrir(page, p.url, p.boton);
      const caja = (await page.locator('#asis-panel').boundingBox())!;
      const ancho = page.viewportSize()!.width;
      expect(caja.x).toBeGreaterThanOrEqual(0);
      expect(caja.x + caja.width).toBeLessThanOrEqual(ancho);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  });
}

test('sin JavaScript el botón del asistente no aparece', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.locator('#asis-abrir')).toBeHidden();
  await expect(page.locator('#asis-panel')).toBeHidden();
  await ctx.close();
});
