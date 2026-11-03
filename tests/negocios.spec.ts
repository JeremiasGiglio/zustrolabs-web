// La app de negocios (ZL-121) en un navegador de verdad: la página la sirve el Worker (whatsapp/src) con SQLite real
// y Access simulado; Playwright intercepta negocios.zustrolabs.com y le pasa cada pedido al Worker.
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import worker from '../whatsapp/src/index.js';
import { adaptadores, almacenPrueba, crearAtencion } from '../whatsapp/src/atencion.js';
import { crearCatalogo, ejecutarCatalogo } from '../whatsapp/src/catalogo.js';
import { _resetCerts } from '../whatsapp/src/panel.js';
import { sqlPrueba } from '../whatsapp/test/sqlite.js';

const TEAM = 'equipo-de-prueba.cloudflareaccess.com';
const AUD = 'aud-negocios-prueba';
const ENV = { ACCESS_TEAM_DOMAIN: TEAM, NEGOCIOS_ACCESS_AUD: AUD, PANEL_EMAILS: 'equipo@example.com', IG_APP_ID: '1000000000000001' };
const FICHA = readFileSync('whatsapp/test/ficha-prueba.md', 'utf8');

async function montar(page: Page, email: string) {
  _resetCerts();
  const claves = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', claves.publicKey)), kid: 'k1' };
  const b64 = (s: string) => Buffer.from(s).toString('base64url');
  const firmarToken = async (correo: string) => {
    const cuerpo = `${b64(JSON.stringify({ alg: 'RS256', kid: 'k1' }))}.${b64(JSON.stringify({ email: correo, aud: [AUD], exp: Math.floor(Date.now() / 1000) + 3600 }))}`;
    const f = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', claves.privateKey, new TextEncoder().encode(cuerpo));
    return `${cuerpo}.${Buffer.from(f).toString('base64url')}`;
  };
  const n = adaptadores(crearAtencion(almacenPrueba()));
  const bases = new Map();
  const deps: any = {
    ...n,
    catalogo: (id: string) => {
      if (!bases.has(id)) { const { sql, transaccion } = sqlPrueba(); bases.set(id, crearCatalogo(sql, transaccion)); }
      return { ejecutar: async (op: string, args: unknown[]) => structuredClone(ejecutarCatalogo(bases.get(id), op, structuredClone(args))) };
    },
    fetch: async (url: string) => (String(url).includes('/cdn-cgi/access/certs') ? Response.json({ keys: [jwk] }) : Response.json({})),
    preguntarNegocio: () => async () => ({ respuesta: 'Sí, tenemos pan francés 🥖 ¿Cuánto querés?', persona: false, fuera_de_tema: false, vacia: false, notas: [] }),
  };
  const r = await n.negocios.guardar(null, { nombre: 'Panadería La Espiga', emails: ['duena@example.com'], cuentas: [] });
  await n.negocios.guardarFicha(r.negocio.id, { texto: FICHA, activa: true });
  const tok = await firmarToken(email);
  await page.route('https://negocios.zustrolabs.com/**', async (route) => {
    const req = route.request();
    const res = await worker.fetch(new Request(req.url(), {
      method: req.method(),
      headers: { ...req.headers(), 'cf-access-jwt-assertion': tok },
      body: ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postDataBuffer(),
    }), ENV, {}, deps);
    await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
  });
  await page.goto('https://negocios.zustrolabs.com/');
  return { negocio: r.negocio };
}

test.describe('app de negocios (ZL-121)', () => {
  test('la dueña carga un producto, le cambia el stock y lo ve en el historial', async ({ page }) => {
    await montar(page, 'duena@example.com');
    await expect(page.getByRole('heading', { name: 'Productos' })).toBeVisible();
    await expect(page.getByText('Asistente activo')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Asistente' })).toHaveCount(0, { timeout: 1000 });
    await expect(page.getByText('Todavía no hay productos')).toBeVisible();
    await page.getByRole('button', { name: '+ Nuevo producto' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Nombre *').fill('Pan francés');
    await dlg.getByLabel('Precio').fill('2500');
    await dlg.getByLabel('Por').fill('kg');
    await dlg.getByLabel('Stock').fill('3');
    await dlg.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByRole('button', { name: 'Pan francés', exact: true })).toBeVisible();
    await expect(page.getByText('$ 2.500 / kg')).toBeVisible();
    await page.getByRole('button', { name: 'Sumar uno a Pan francés' }).click();
    await expect(page.getByLabel('Stock', { exact: true })).toHaveText('4');
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Restar uno a Pan francés' }).click();
    await expect(page.getByLabel('Stock', { exact: true })).toHaveText('0');
    await page.getByRole('button', { name: 'Restar uno a Pan francés' }).click();
    await expect(page.getByRole('status')).toContainText('no hay tanto stock');
    await page.getByRole('tab', { name: 'Historial' }).click();
    await expect(page.locator('tbody tr')).toHaveCount(6);
    await expect(page.locator('tbody tr').first()).toContainText('duena@example.com');
  });

  test('importa un Excel con vista previa, después en serio, y encuentra los productos', async ({ page }) => {
    await montar(page, 'duena@example.com');
    await page.getByRole('tab', { name: 'Importar Excel' }).click();
    await page.getByLabel('Elegir planilla').setInputFiles('whatsapp/test/productos-prueba.xlsx');
    await expect(page.getByText('productos-prueba.xlsx · 4 filas')).toBeVisible();
    await expect(page.getByLabel('Qué es la columna Precio de venta')).toHaveValue('precio');
    await expect(page.getByLabel('Qué es la columna Rubro')).toHaveValue('categoria');
    await page.getByRole('button', { name: 'Ver qué va a pasar' }).click();
    await expect(page.getByText('3 nuevos')).toBeVisible();
    await expect(page.getByText('Fila 6: «consultar» no es un número (precio)')).toBeVisible();
    await page.getByRole('button', { name: 'Importar ahora' }).click();
    await expect(page.getByText('Listo, importado')).toBeVisible();
    await page.getByRole('button', { name: 'Ver productos' }).click();
    await expect(page.getByRole('button', { name: 'Caja de bombones x12', exact: true })).toBeVisible();
    await page.getByLabel('Buscar').fill('tableta');
    await expect(page.locator('.prod')).toHaveCount(1);
    await expect(page.getByText('$ 6.500,50')).toBeVisible();
  });

  test('el equipo ve Asistente y Administración, prueba la charla y crea un negocio', async ({ page }) => {
    await montar(page, 'equipo@example.com');
    await page.getByRole('tab', { name: 'Asistente' }).click();
    await expect(page.getByLabel('Ficha del negocio')).toHaveValue(/Panadería La Espiga/);
    await page.getByLabel('Mensaje de prueba').fill('¿tienen pan?');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.locator('.burbuja.asis').last()).toContainText('tenemos pan francés');
    await page.getByRole('tab', { name: 'Administración' }).click();
    await page.getByLabel('Nombre del negocio').fill('Chocolatería Ficticia');
    await page.getByLabel('Correos de quienes entran').fill('dueno@example.com');
    await page.getByRole('button', { name: 'Crear' }).click();
    await expect(page.getByRole('combobox', { name: 'Negocio' })).toHaveValue(/.+/);
    await expect(page.getByRole('combobox', { name: 'Negocio' }).locator('option:checked')).toHaveText('Chocolatería Ficticia');
  });

  test('exportar a Excel: un nombre que empieza con «=» no se vuelve fórmula', async ({ page }) => {
    await montar(page, 'duena@example.com');
    await page.getByRole('button', { name: '+ Nuevo producto' }).click();
    await page.getByRole('dialog').getByLabel('Nombre *').fill('=HYPERLINK("http://malo.example.com")');
    await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('.prod')).toHaveCount(1);
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar a Excel' }).click()]);
    const texto = readFileSync(await descarga.path(), 'utf8');
    expect(texto.startsWith('\uFEFFCódigo;Nombre;')).toBe(true);
    expect(texto).toContain(`;"'=HYPERLINK(""http://malo.example.com"")";`);
  });

  test('sin scroll horizontal y sin problemas graves de accesibilidad', async ({ page }) => {
    await montar(page, 'equipo@example.com');
    await expect(page.getByRole('heading', { name: 'Productos' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const graves = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(graves.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(' ')).join(', ')}`)).toEqual([]);
  });
});
