// La app de negocios (ZL-121) en un navegador de verdad: la página la sirve el Worker (whatsapp/src) con SQLite real
// y Access simulado; Playwright intercepta negocios.zustrolabs.com y le pasa cada pedido al Worker.
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { adaptadores, almacenPrueba, crearAtencion } from '../whatsapp/src/atencion.js';
import { crearCatalogo, ejecutarCatalogo } from '../whatsapp/src/catalogo.js';
import { sqlPrueba } from '../whatsapp/test/sqlite.js';

const TEAM = 'equipo-de-prueba.cloudflareaccess.com';
const AUD = 'aud-negocios-prueba';
const ENV = { ACCESS_TEAM_DOMAIN: TEAM, NEGOCIOS_ACCESS_AUD: AUD, PANEL_EMAILS: 'equipo@example.com', IG_APP_ID: '1000000000000001', IG_APP_SECRET: 'secreto-ig-prueba' };
const FICHA = readFileSync('whatsapp/test/ficha-prueba.md', 'utf8');

let claves: CryptoKeyPair;
let jwk: JsonWebKey & { kid: string };
// Valor falso para las pruebas (en una constante: el control de secretos del repo no lo confunde con uno real).
const FIRMA_FALSA = 'secreto-de-prueba';

async function montar(page: Page, email: string, antes?: (n: any, negocio: any, deps: any) => Promise<void>) {
  // Una sola clave por corrida: el Worker empaquetado guarda en memoria las claves de Access que ya bajó.
  if (!claves) {
    claves = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    jwk = { ...(await crypto.subtle.exportKey('jwk', claves.publicKey)), kid: 'k1' };
  }
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
    fetch: async (url: string) => (String(url).includes('/cdn-cgi/access/certs') ? Response.json({ keys: [jwk] })
      : String(url).endsWith('/webhookEndpoints') ? Response.json({ id: 'we_1', secret: FIRMA_FALSA }) : Response.json({})),
    preguntarNegocio: () => async () => ({ respuesta: 'Sí, tenemos pan francés 🥖 ¿Cuánto querés?', persona: false, fuera_de_tema: false, vacia: false, notas: [] }),
  };
  const r = await n.negocios.guardar(null, { nombre: 'Panadería La Espiga', emails: ['duena@example.com'], cuentas: [] });
  await n.negocios.guardarFicha(r.negocio.id, { texto: FICHA, activa: true });
  if (antes) await antes(n, r.negocio, deps);
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
  return { negocio: r.negocio, n, deps };
}

// El Worker empaquetado IGUAL que lo hace Wrangler (esbuild con keepNames): así se prueba el código como queda en
// Cloudflare. Sin el empaquetado, la página andaba acá y en producción se quedaba en «Cargando…» (ZL-123).
let worker: any;
test.beforeAll(async () => {
  const salida = join(tmpdir(), `zl-negocios-${process.pid}-${Date.now()}.mjs`);
  await build({ entryPoints: ['whatsapp/src/index.js'], bundle: true, format: 'esm', platform: 'neutral', keepNames: true, external: ['cloudflare:*', 'node:*'], outfile: salida, logLevel: 'silent' });
  worker = (await import(pathToFileURL(salida).href)).default;
});

test.describe('app de negocios (ZL-121)', () => {
  test('la dueña carga un producto, le cambia el stock y lo ve en el historial', async ({ page }) => {
    await montar(page, 'duena@example.com');
    // ZL-148: arranca en Inicio; Productos es una de las tres secciones.
    await expect(page.getByRole('tab')).toHaveText(['Inicio', 'Productos', 'Conexiones']);
    await page.getByRole('tab', { name: 'Productos' }).click();
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
    await page.getByRole('button', { name: 'Historial', exact: true }).click();
    await expect(page.locator('tbody tr')).toHaveCount(6);
    await expect(page.locator('tbody tr').first()).toContainText('duena@example.com');
  });

  test('importa un Excel con vista previa, después en serio, y encuentra los productos', async ({ page }) => {
    await montar(page, 'duena@example.com');
    await page.getByRole('tab', { name: 'Productos' }).click();
    await page.getByRole('button', { name: 'Importar Excel', exact: true }).click();
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
    // ZL-150: la ficha se abre en el formulario; en Markdown está la misma.
    await expect(page.getByLabel('Nombre del negocio')).toHaveValue('Panadería La Espiga');
    await expect(page.getByLabel('Opción 2: título')).toHaveValue('🎂 Tortas por encargo');
    await page.getByRole('button', { name: 'Markdown' }).click();
    await expect(page.getByLabel('Ficha del negocio')).toHaveValue(/- Nombre: Panadería La Espiga[\s\S]*- Objetivo: consultas/);
    await page.getByLabel('Mensaje de prueba').fill('¿tienen pan?');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.locator('.burbuja.asis').last()).toContainText('tenemos pan francés');
    await page.getByRole('tab', { name: 'Admin' }).click();
    await page.getByLabel('Nombre del negocio').fill('Chocolatería Ficticia');
    await page.getByLabel('Correos de quienes entran').fill('dueno@example.com');
    await page.getByRole('button', { name: 'Crear' }).click();
    await expect(page.getByRole('combobox', { name: 'Negocio', exact: true })).toHaveValue(/.+/);
    await expect(page.getByRole('combobox', { name: 'Negocio', exact: true }).locator('option:checked')).toHaveText('Chocolatería Ficticia');
  });

  test('la charla de prueba con una ficha en dos idiomas pregunta el idioma, lo recuerda y se reinicia (ZL-126)', async ({ page }) => {
    await montar(page, 'equipo@example.com');
    await page.getByRole('tab', { name: 'Asistente' }).click();
    const dos = FICHA.replace('- Idioma: castellano', '- Idioma: castellano, inglés') +
      '\n## Saludo (inglés)\n\nHi from the bakery.\n\n## Menú (inglés)\n\n### 1. Bread\nFresh.\n\n### 2. Cakes\nTo order.\n\n### 3. Hours\nMon to Sat.\n';
    await page.getByRole('button', { name: 'Markdown' }).click();
    await page.getByLabel('Ficha del negocio').fill(dos);
    const enviar = async (m: string) => {
      await page.getByLabel('Mensaje de prueba').fill(m);
      await page.getByRole('button', { name: 'Enviar' }).click();
    };
    await enviar('hello');
    await expect(page.locator('.burbuja.asis').last()).toContainText('2️⃣ English');
    await enviar('2');
    await expect(page.locator('.burbuja.asis').last()).toContainText('How can I help?');
    await enviar('2');
    await expect(page.locator('.burbuja.asis').last()).toContainText('To order.');
    await page.getByRole('button', { name: 'Reiniciar charla' }).click();
    await expect(page.locator('.burbuja')).toHaveCount(0);
    await enviar('2');
    await expect(page.locator('.burbuja.asis').last()).toContainText('Which language', { timeout: 5000 });
  });

  test('WhatsApp (ZL-136): la dueña conecta su número sola, ve el estado y lo desconecta; la página es accesible', async ({ page }) => {
    await montar(page, 'duena@example.com');
    await page.getByRole('tab', { name: 'Conexiones' }).click();
    await page.getByRole('button', { name: 'WhatsApp', exact: true }).click();
    await expect(page.getByText('Todavía no hay un número de WhatsApp conectado.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'YCloud' })).toHaveAttribute('href', 'https://www.ycloud.com/console#/entry/register');
    await page.getByLabel('Tu número de WhatsApp Business (con código de país)').fill('+54 9 341 000-0001');
    await page.getByLabel('Clave de API de YCloud').fill('clave-api-ycloud-de-prueba');
    await expect(page.getByLabel('Clave de API de YCloud')).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Conectar' }).click();
    await expect(page.locator('.wa-num')).toContainText('+5493410000001');
    await expect(page.locator('.wa-num')).toContainText('Se calla cuando contestás vos');
    await expect(page.getByLabel('Clave de API de YCloud')).toHaveValue('');
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
    await page.getByRole('button', { name: 'Desconectar' }).click();
    await page.getByRole('button', { name: /¿Seguro\?/ }).click();
    await expect(page.getByText('Todavía no hay un número de WhatsApp conectado.')).toBeVisible();
  });

  test('Instagram (ZL-137): la dueña pide la invitación y «Conectar Instagram» la lleva a Instagram con la app compartida; la página es accesible', async ({ page }) => {
    const { n } = await montar(page, 'duena@example.com');
    await page.getByRole('tab', { name: 'Conexiones' }).click();
    await page.getByRole('button', { name: 'Instagram', exact: true }).click();
    await expect(page.getByText('Todavía no hay una cuenta de Instagram conectada.')).toBeVisible();
    // Sin app compartida registrada, se usa la del estudio (ZL-140): el botón ya se puede usar.
    await expect(page.getByRole('button', { name: 'Conectar Instagram' })).toBeEnabled();
    await page.getByLabel('Usuario de Instagram del negocio').fill('@la.espiga');
    await page.getByRole('button', { name: 'Pedir invitación' }).click();
    await expect(page.getByText(/para @la\.espiga/)).toBeVisible();
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
    // El equipo registra la app compartida: el botón lleva a Instagram con esa app y vuelve a zustrolabs.com.
    await n.apps.put('3000000000000003', { secreto: 'secreto-app-compartida', nombre: 'Clientes', compartida: true });
    await page.reload();
    await page.getByRole('tab', { name: 'Conexiones' }).click();
    await page.getByRole('button', { name: 'Instagram', exact: true }).click();
    let destino = '';
    await page.route('https://www.instagram.com/**', async (route) => { destino = route.request().url(); await route.fulfill({ status: 200, body: 'instagram' }); });
    await page.getByRole('button', { name: 'Conectar Instagram' }).click();
    await expect.poll(() => destino).toContain('client_id=3000000000000003');
    expect(new URL(destino).searchParams.get('redirect_uri')).toBe('https://zustrolabs.com/api/instagram/conectar/vuelta');
  });

  test('pedidos (ZL-139): el negocio ve el pedido nuevo, lo acepta, lo marca pagado y entregado, y el stock baja; la pestaña es accesible', async ({ page }) => {
    const CHARLA = 'yc:5493410000001:5493410000009';
    let panId = '';
    const { negocio, deps } = await montar(page, 'duena@example.com', async (n, neg, d) => {
      await n.negocios.guardar(neg.id, { pedidos: true, ajustes: { reservaHoras: 48 } });
      const cat = d.catalogo(neg.id);
      panId = (await cat.ejecutar('crear', [{ nombre: 'Pan francés', precio: 2500, stock: 10 }, 'duena@example.com'])).valor.id;
      await cat.ejecutar('carrito', [CHARLA, [{ id: panId, cantidad: 3 }], { canal: 'wa' }]);
      await cat.ejecutar('confirmar', [CHARLA, { nombre: 'Ana', entrega: 'envio', direccion: 'Calle Ficticia 123' }]);
    });
    const stock = async () => (await deps.catalogo(negocio.id).ejecutar('obtener', [panId])).valor;
    await expect(page.getByRole('tab', { name: 'Inicio' })).toHaveAttribute('aria-selected', 'true');
    const tarjeta = page.locator('article.pedido');
    await expect(tarjeta.getByRole('heading', { name: 'Pedido N.º 1 · Ana' })).toBeVisible();
    await expect(page.locator('.resumen')).toContainText('1pedidos para aceptar');
    await expect(tarjeta.getByRole('link', { name: 'Responder por WhatsApp' })).toHaveAttribute('href', 'https://wa.me/5493410000009');
    await expect(tarjeta).toContainText('3 × Pan francés — $ 7.500');
    await expect(tarjeta).toContainText('Total: $ 7.500');
    await expect(tarjeta).toContainText('Envío: Calle Ficticia 123');
    await expect(page.getByRole('button', { name: 'Nuevos (1)' })).toBeVisible();
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
    expect((await stock()).reservado).toBe(3);
    // Aceptar con un toque: cuánto se guarda sin pagar sale de «Cómo vendés» (48 h en este negocio).
    await tarjeta.getByRole('button', { name: 'Aceptar' }).click();
    // Sin un número conectado, no se le puede avisar al comprador: lo dice.
    await expect(page.getByText(/Pedido N\.º 1: aceptado\. No le pudimos avisar/)).toBeVisible();
    await page.getByRole('button', { name: /Aceptados/ }).click();
    await expect(tarjeta).toContainText('Guardado hasta el');
    const vence = (await deps.catalogo(negocio.id).ejecutar('pedido', [1])).valor.vence - Date.now();
    expect(Math.round(vence / 3600_000)).toBe(48);
    await tarjeta.getByRole('button', { name: 'Ya pagó' }).click();
    await page.getByRole('button', { name: /Pagados/ }).click();
    await tarjeta.getByRole('button', { name: 'Entregado' }).click();
    await expect.poll(async () => { const p = await stock(); return [p.stock, p.reservado]; }).toEqual([7, 0]);
    await page.getByRole('button', { name: 'Todos' }).click();
    await expect(tarjeta.getByText('Entregado', { exact: true })).toBeVisible();
  });

  test('pedidos: rechazar pide confirmación, guarda el motivo y libera el stock', async ({ page }) => {
    let panId = '';
    const { negocio, deps } = await montar(page, 'duena@example.com', async (n, neg, d) => {
      await n.negocios.guardar(neg.id, { pedidos: true });
      const cat = d.catalogo(neg.id);
      panId = (await cat.ejecutar('crear', [{ nombre: 'Pan francés', precio: 2500, stock: 10 }, 'x'])).valor.id;
      await cat.ejecutar('carrito', ['ig:17841400000000001.900', [{ id: panId, cantidad: 2 }], { canal: 'ig' }]);
      await cat.ejecutar('confirmar', ['ig:17841400000000001.900', { nombre: 'Beto', entrega: 'retiro' }]);
    });
    const tarjeta = page.locator('article.pedido');
    await tarjeta.getByRole('button', { name: 'Rechazar' }).click();
    await tarjeta.getByLabel('Motivo').fill('hoy no hay horno');
    await tarjeta.getByRole('button', { name: 'Confirmar rechazo' }).click();
    await expect(page.getByText(/Pedido N\.º 1: rechazado/)).toBeVisible();
    expect((await deps.catalogo(negocio.id).ejecutar('obtener', [panId])).valor.reservado).toBe(0);
    expect((await deps.catalogo(negocio.id).ejecutar('pedido', [1])).valor.eventos.at(-1).detalle).toBe('hoy no hay horno');
  });

  test('consultas (ZL-146): con pedidos apagados, el negocio igual ve las consultas que le pasa el asistente y las atiende; accesible', async ({ page }) => {
    const CHARLA = 'yc:5493410000001:5493410000009';
    await montar(page, 'duena@example.com', async (n, neg, d) => {
      await d.catalogo(neg.id).ejecutar('crearConsulta', [CHARLA, { tipo: 'consulta', nombre: 'Ana Pérez', resumen: 'Torta para 20 personas el sábado (dato ficticio).', canal: 'wa' }]);
    });
    await page.getByRole('tab', { name: 'Inicio' }).click();
    const tarjeta = page.locator('article.consulta');
    await expect(tarjeta.getByRole('heading', { name: 'Consulta N.º 1 · Ana Pérez' })).toBeVisible();
    await expect(tarjeta).toContainText('Quiere avanzar');
    await expect(tarjeta).toContainText('Torta para 20 personas');
    await expect(tarjeta.getByRole('link', { name: 'Responder por WhatsApp' })).toHaveAttribute('href', 'https://wa.me/5493410000009');
    await expect(page.getByRole('heading', { name: 'Pedidos', exact: true })).toHaveCount(0);
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
    // «La atiendo yo» calla al asistente en esa charla; «Devolver al asistente» lo vuelve a encender (ZL-148).
    await tarjeta.getByRole('button', { name: 'La atiendo yo' }).click();
    await expect(page.getByRole('status')).toContainText('Consulta N.º 1: la estás atendiendo. El asistente no se mete');
    await expect(tarjeta.locator('.pausa')).toContainText('El asistente está callado en esta charla');
    await tarjeta.getByRole('button', { name: 'Devolver al asistente' }).click();
    await expect(page.getByRole('status')).toContainText('el asistente vuelve a responder');
    await expect(tarjeta.locator('.pausa')).toHaveCount(0);
    await tarjeta.getByRole('button', { name: 'Ganada' }).click();
    await expect(page.getByText('No hay consultas para responder.')).toBeVisible();
  });

  test('exportar a Excel: un nombre que empieza con «=» no se vuelve fórmula', async ({ page }) => {
    await montar(page, 'duena@example.com');
    await page.getByRole('tab', { name: 'Productos' }).click();
    await page.getByRole('button', { name: '+ Nuevo producto' }).click();
    await page.getByRole('dialog').getByLabel('Nombre *').fill('=HYPERLINK("http://malo.example.com")');
    await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('.prod')).toHaveCount(1);
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar a Excel' }).click()]);
    const texto = readFileSync(await descarga.path(), 'utf8');
    expect(texto.startsWith('\uFEFFCódigo;Nombre;')).toBe(true);
    expect(texto).toContain(`;"'=HYPERLINK(""http://malo.example.com"")";`);
  });

  test('un correo sin negocio ve el aviso, sin pestañas y sin textos sueltos («null»)', async ({ page }) => {
    await montar(page, 'nadie@example.com');
    await expect(page.getByText('Tu correo todavía no está en ningún negocio')).toBeVisible();
    await expect(page.getByRole('tab')).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toMatch(/\bnull\b|\bundefined\b/);
  });

  test('sin scroll horizontal y sin problemas graves de accesibilidad', async ({ page }) => {
    await montar(page, 'equipo@example.com');
    await expect(page.getByRole('heading', { name: /^Hola/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const graves = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(graves.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(' ')).join(', ')}`)).toEqual([]);
  });

  test('celular (ZL-148): la barra de secciones va abajo, sin scroll horizontal; «Cómo vendés» se guarda y es accesible', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { negocio, n } = await montar(page, 'duena@example.com');
    const barra = await page.locator('nav.tabs').boundingBox();
    expect(barra && barra.y + barra.height).toBeGreaterThan(800);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.getByRole('tab', { name: 'Conexiones' }).click();
    await page.getByRole('button', { name: 'Cómo vendés' }).click();
    await page.getByLabel('¿Cómo entregás?').selectOption('retiro');
    await page.getByLabel('Retiro: dónde y cuándo').fill('Calle Ficticia 123, de 9 a 20');
    await page.getByLabel('Cómo se paga').fill('Efectivo o transferencia al alias FICTICIO');
    await page.getByLabel('Cuánto te guardo un pedido aceptado sin pagar').selectOption('2');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByRole('status')).toContainText('Guardado');
    const aj = (await n.negocios.get(negocio.id)).ajustes;
    expect([aj.entrega, aj.retiro, aj.reservaHoras]).toEqual(['retiro', 'Calle Ficticia 123, de 9 a 20', 2]);
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });

  test('alta fácil (ZL-150): plantilla por rubro en el formulario, revisor con charlas de prueba; el negocio ve su estado', async ({ page }) => {
    // El formulario es largo y el revisor corre 7 charlas: en el celular emulado tarda más.
    test.setTimeout(90_000);
    await montar(page, 'equipo@example.com');
    await page.getByRole('tab', { name: 'Asistente' }).click();
    await page.getByLabel('Plantilla por rubro').selectOption('servicios');
    await page.getByRole('button', { name: 'Usar plantilla' }).click();
    await expect(page.getByLabel('A qué cierre lleva la charla')).toHaveValue('consultas');
    await expect(page.getByLabel('Saludo')).toHaveValue(/\[COMPLETAR nombre del negocio\]/);
    await page.getByRole('button', { name: '+ Agregar opción' }).click();
    await expect(page.getByLabel('Opción 4: título')).toBeVisible();
    await page.getByRole('button', { name: 'Revisar todo' }).click();
    await expect(page.getByText(/^Charlas de prueba \(\d de 7 bien\)$/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Falta completar/).first()).toBeVisible();
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
    await page.getByRole('tab', { name: 'Conexiones' }).click();
    await page.getByRole('button', { name: 'Estado', exact: true }).click();
    await expect(page.locator('.chip').filter({ hasText: /Todo funcionando|Falta algo/ })).toBeVisible();
  });
});
