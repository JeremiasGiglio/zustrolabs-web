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
    // ZL-159: «Asistente» también para el negocio (pausa, aviso del día y charla de prueba).
    await expect(page.getByRole('tab')).toHaveText(['Inicio', 'Charlas', 'Productos', 'Mi negocio', 'Más']);
    await page.getByRole('tab', { name: 'Productos' }).click();
    await expect(page.getByRole('heading', { name: 'Productos' })).toBeVisible();
    await expect(page.getByText('Asistente activo')).toBeVisible();
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
    await page.getByRole('tab', { name: 'Más' }).click(); await page.getByRole('button', { name: 'Asistente', exact: true }).click();
    // ZL-150: la ficha se abre en el formulario; en Markdown está la misma.
    await expect(page.getByLabel('Nombre del negocio')).toHaveValue('Panadería La Espiga');
    await expect(page.getByLabel('Opción 2: título')).toHaveValue('🎂 Tortas por encargo');
    await page.getByRole('button', { name: 'Markdown' }).click();
    await expect(page.getByLabel('Ficha del negocio')).toHaveValue(/- Nombre: Panadería La Espiga[\s\S]*- Objetivo: consultas/);
    // La charla de prueba de la ficha (la del equipo es la segunda: arriba está la del dueño, ZL-159).
    await page.getByLabel('Mensaje de prueba', { exact: true }).fill('¿tienen pan?');
    await page.getByRole('button', { name: 'Enviar' }).last().click();
    await expect(page.locator('.burbuja.asis').last()).toContainText('tenemos pan francés');
    await page.getByRole('tab', { name: 'Admin' }).click();
    await page.getByLabel('Nombre del negocio').fill('Chocolatería Ficticia');
    await page.getByLabel('Correos de quienes entran').fill('dueno@example.com');
    await page.getByRole('button', { name: 'Crear' }).click();
    await expect(page.getByRole('combobox', { name: 'Negocio', exact: true })).toHaveValue(/.+/);
    await expect(page.getByRole('combobox', { name: 'Negocio', exact: true }).locator('option:checked')).toHaveText('Chocolatería Ficticia');
  });

  test('la charla de prueba con una ficha en dos idiomas arranca en el idioma del mensaje, lo recuerda y se reinicia (ZL-126, ZL-153)', async ({ page }) => {
    await montar(page, 'equipo@example.com');
    await page.getByRole('tab', { name: 'Más' }).click(); await page.getByRole('button', { name: 'Asistente', exact: true }).click();
    const dos = FICHA.replace('- Idioma: castellano', '- Idioma: castellano, inglés') +
      '\n## Saludo (inglés)\n\nHi from the bakery.\n\n## Menú (inglés)\n\n### 1. Bread\nFresh.\n\n### 2. Cakes\nTo order.\n\n### 3. Hours\nMon to Sat.\n';
    await page.getByRole('button', { name: 'Markdown' }).click();
    await page.getByLabel('Ficha del negocio').fill(dos);
    const enviar = async (m: string) => {
      await page.getByLabel('Mensaje de prueba', { exact: true }).fill(m);
      await page.getByRole('button', { name: 'Enviar' }).last().click();
    };
    // ZL-153: no pregunta el idioma: «hello» ya arranca en inglés con el saludo y el menú.
    await enviar('hello');
    await expect(page.locator('.burbuja.asis').last()).toContainText('How can I help?');
    await expect(page.locator('.burbuja.asis').last()).not.toContainText('English');
    await enviar('2');
    await expect(page.locator('.burbuja.asis').last()).toContainText('To order.');
    await page.getByRole('button', { name: 'Reiniciar charla' }).click();
    await expect(page.locator('.burbuja')).toHaveCount(0);
    // Quien lo pide con IDIOMA igual puede elegir.
    await enviar('idioma');
    await expect(page.locator('.burbuja.asis').last()).toContainText('2️⃣ English', { timeout: 5000 });
  });

  test('WhatsApp (ZL-136): la dueña conecta su número sola, ve el estado y lo desconecta; la página es accesible', async ({ page }) => {
    await montar(page, 'duena@example.com');
    await page.getByRole('tab', { name: 'Más' }).click(); await page.getByRole('button', { name: 'Conexiones', exact: true }).click();
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
    await page.getByRole('tab', { name: 'Más' }).click(); await page.getByRole('button', { name: 'Conexiones', exact: true }).click();
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
    await page.getByRole('tab', { name: 'Más' }).click(); await page.getByRole('button', { name: 'Conexiones', exact: true }).click();
    await page.getByRole('button', { name: 'Instagram', exact: true }).click();
    let destino = '';
    await page.route('https://www.instagram.com/**', async (route) => { destino = route.request().url(); await route.fulfill({ status: 200, body: 'instagram' }); });
    await page.getByRole('button', { name: 'Conectar Instagram' }).click();
    await expect.poll(() => destino).toContain('client_id=3000000000000003');
    expect(new URL(destino).searchParams.get('redirect_uri')).toBe('https://zustrolabs.com/api/instagram/conectar/vuelta');
  });

  test('comentarios (ZL-160): la dueña enciende «Responder comentarios», elige el modo, ve si falta el permiso y el reporte los cuenta; accesible', async ({ page }) => {
    const CUENTA = '17841400000000002';
    await montar(page, 'duena@example.com', async (n, neg) => {
      await n.cuentas.put(CUENTA, { username: 'la.espiga', token: 'tok', vence: Date.now() + 9e9, app: '1000000000000001', cliente: true });
      await n.negocios.guardar(neg.id, { cuentas: [CUENTA] });
      // Dos comentarios respondidos hoy (para el reporte).
      const { diaLocal } = await import('../whatsapp/src/reporte.js');
      const dia = diaLocal(Date.now(), 'America/Argentina/Buenos_Aires');
      await n.negocios.sumarMetrica(neg.id, 'comentarios', dia);
      await n.negocios.sumarMetrica(neg.id, 'comentarios', dia);
    });
    await page.getByRole('tab', { name: 'Más' }).click(); await page.getByRole('button', { name: 'Conexiones', exact: true }).click();
    await page.getByRole('button', { name: 'Instagram', exact: true }).click();
    const activo = page.getByLabel('Responder comentarios');
    await expect(activo).not.toBeChecked();
    await expect(page.getByLabel('Cómo responde')).toBeDisabled();
    await activo.check();
    await expect(page.getByRole('status').filter({ hasText: 'el asistente responde los comentarios nuevos' }).first()).toBeVisible();
    await expect(page.getByLabel('Cómo responde')).toBeEnabled();
    // La cuenta se conectó antes de este permiso: la app pide conectarla de nuevo.
    await expect(page.getByText(/@la\.espiga tiene que dar un permiso más/)).toBeVisible();
    await page.getByLabel('Cómo responde').selectOption('privado');
    await expect(page.getByLabel('Cómo responde')).toHaveValue('privado');
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
    await page.reload();
    await page.getByRole('tab', { name: 'Más' }).click(); await page.getByRole('button', { name: 'Conexiones', exact: true }).click();
    await page.getByRole('button', { name: 'Instagram', exact: true }).click();
    await expect(page.getByLabel('Responder comentarios')).toBeChecked();
    await expect(page.getByLabel('Cómo responde')).toHaveValue('privado');
    await page.getByRole('tab', { name: 'Más' }).click(); await page.getByRole('button', { name: 'Reportes', exact: true }).click();
    await page.getByText('Más números').click();
    await expect(page.locator('.resumen').getByText('comentarios respondidos')).toBeVisible();
    await expect(page.locator('.resumen div').filter({ hasText: 'comentarios respondidos' }).locator('strong')).toHaveText('2');
  });

  test('pedidos (ZL-139): el negocio ve el pedido nuevo, lo acepta, lo marca pagado y entregado, y el stock baja; la pestaña es accesible', async ({ page }) => {
    const CHARLA = 'yc:5493410000001:5493410000009';
    let panId = '';
    const { negocio, deps } = await montar(page, 'duena@example.com', async (n, neg, d) => {
      await n.negocios.guardar(neg.id, { pedidos: true, ajustes: { reservaHoras: 48 }, canales: { instagram: false, whatsapp: true } });
      const cat = d.catalogo(neg.id);
      panId = (await cat.ejecutar('crear', [{ nombre: 'Pan francés', precio: 2500, stock: 10 }, 'duena@example.com'])).valor.id;
      await cat.ejecutar('carrito', [CHARLA, [{ id: panId, cantidad: 3 }], { canal: 'wa' }]);
      await cat.ejecutar('confirmar', [CHARLA, { nombre: 'Ana', entrega: 'envio', direccion: 'Calle Ficticia 123' }]);
      // ZL-157: la compradora escribió por última vez hace 30 h: Meta ya no deja avisarle solo.
      await n.memoria.put('yc:5493410000001:5493410000009', { idioma: 'es', humanoHasta: 0, ultimo: Date.now() - 30 * 3600_000 });
      // ZL-158: el asistente ya mandó 850 mensajes por WhatsApp este mes.
      const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
      for (let i = 0; i < 850; i++) await n.negocios.sumarMetrica(neg.id, 'enviadosWa', hoy);
    });
    const stock = async () => (await deps.catalogo(negocio.id).ejecutar('obtener', [panId])).valor;
    await expect(page.getByRole('tab', { name: 'Inicio' })).toHaveAttribute('aria-selected', 'true');
    const tarjeta = page.locator('article.pedido');
    await expect(tarjeta.getByRole('heading', { name: 'Pedido N.º 1 · Ana' })).toBeVisible();
    await expect(page.locator('.resumen', { hasText: 'pedidos para aceptar' })).toContainText('1pedidos para aceptar');
    // ZL-151: los números de la semana y el botón de avisos al celular.
    await expect(page.getByRole('heading', { name: 'Últimos 7 días' })).toBeVisible();
    await expect(page.getByLabel('Últimos 7 días')).toContainText('1 pedido ');
    // ZL-163: corregir los datos del comprador (cambió de envío a retiro).
    await tarjeta.getByRole('button', { name: 'Corregir datos' }).click();
    await expect(tarjeta.getByLabel('A nombre de')).toBeFocused();
    await expect(tarjeta.getByLabel('Entrega')).toHaveValue('envio');
    await expect(tarjeta.getByLabel('Dirección (si es envío)')).toHaveValue('Calle Ficticia 123');
    await tarjeta.getByLabel('Dirección (si es envío)').fill('Calle Ficticia 123, timbre B');
    await tarjeta.getByRole('button', { name: 'Guardar los datos' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'datos corregidos' }).first()).toBeVisible();
    await expect(tarjeta).toContainText('Envío: Calle Ficticia 123, timbre B');
    await expect(page.getByRole('button', { name: 'Avisos en este celular' })).toBeVisible();
    await expect(tarjeta.getByRole('link', { name: 'Responder por WhatsApp' })).toHaveAttribute('href', 'https://wa.me/5493410000009');
    // ZL-153: por dónde escribió y su número, para encontrarlo rápido.
    await expect(tarjeta.locator('.contacto')).toHaveText('Te escribió por WhatsApp: +5493410000009 Copiar');
    await expect(tarjeta).toContainText('3 × Pan francés — $ 7.500');
    await expect(tarjeta).toContainText('Total: $ 7.500');
    await expect(tarjeta).toContainText('Envío: Calle Ficticia 123');
    // ZL-157: un pedido pendiente no se vence: espera la respuesta del negocio.
    await expect(tarjeta).toContainText('Espera tu respuesta: los productos quedan reservados hasta que lo aceptes o lo rechaces.');
    // ZL-158: cuánto lleva del cupo gratis de WhatsApp del mes, con aviso a partir de 800.
    await expect(page.locator('.chip.alerta', { hasText: 'WhatsApp este mes' })).toContainText('WhatsApp este mes: 850 de 1.000 mensajes gratis. Te quedan 150.');
    // ZL-165: el pedido nuevo está en «Te necesitan ahora»; abajo, los aceptados.
    await expect(page.getByRole('heading', { name: 'Te necesitan ahora' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aceptados' })).toHaveAttribute('aria-pressed', 'true');
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
    expect((await stock()).reservado).toBe(3);
    // Aceptar con un toque: cuánto se guarda sin pagar sale de «Cómo vendés» (48 h en este negocio).
    await tarjeta.getByRole('button', { name: 'Aceptar' }).click();
    // ZL-157: pasaron más de 24 h desde su último mensaje: el aviso no sale solo y la tarjeta deja el mensaje listo.
    await expect(page.getByText('Pedido N.º 1: aceptado. Falta avisarle: mandale el mensaje desde la tarjeta.')).toBeVisible();
    await page.getByRole('button', { name: /Aceptados/ }).click();
    await expect(tarjeta).toContainText('Guardado hasta el');
    const falta = tarjeta.getByRole('status');
    await expect(falta).toContainText('Falta avisarle al comprador: pasaron más de 24 h desde su último mensaje');
    await expect(falta).toContainText('¡Listo! Panadería La Espiga aceptó tu pedido N.º 1.');
    await expect(falta.getByRole('link', { name: 'Mandárselo por WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/5493410000009\?text=%C2%A1Listo!%20Panader%C3%ADa/);
    // Sigue ahí aunque se recargue la app, hasta que el dueño dice que ya se lo mandó.
    await page.reload();
    await page.getByRole('button', { name: /Aceptados/ }).click();
    await expect(tarjeta.getByRole('status')).toContainText('Falta avisarle al comprador');
    await tarjeta.getByRole('button', { name: 'Ya se lo mandé' }).click();
    await expect(tarjeta.getByRole('status')).toHaveCount(0);
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
      await n.memoria.put('ig:17841400000000001.900', { idioma: 'es', humanoHasta: 0, usuario: 'beto.prueba' });
    });
    const tarjeta = page.locator('article.pedido');
    // ZL-153: en Instagram, el @usuario de quien escribió y el link directo a su charla.
    await expect(tarjeta.locator('.contacto')).toContainText('Te escribió por Instagram: @beto.prueba');
    await expect(tarjeta.getByRole('link', { name: 'Responder por Instagram' })).toHaveAttribute('href', 'https://ig.me/m/beto.prueba');
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
    // «La atiendo yo» calla al asistente en esa charla; «Que siga el asistente» lo vuelve a encender (ZL-148, ZL-162).
    await tarjeta.getByRole('button', { name: 'La atiendo yo' }).click();
    await expect(page.getByRole('status')).toContainText('Consulta N.º 1: la estás atendiendo. El asistente no se mete');
    await expect(tarjeta.locator('.pausa')).toContainText('El asistente está callado en esta charla');
    await expect(tarjeta.locator('.pausa')).not.toContainText('a. m..');
    await tarjeta.getByRole('button', { name: 'Que siga el asistente' }).click();
    await expect(tarjeta.getByLabel('¿Qué le respondemos? (opcional)')).toBeFocused();
    await tarjeta.locator('form').getByRole('button', { name: 'Que siga el asistente' }).click();
    await expect(page.getByRole('status')).toContainText('el asistente vuelve a responder');
    await expect(tarjeta.locator('.pausa')).toHaveCount(0);
    await tarjeta.getByRole('button', { name: 'Ganada' }).click();
    await expect(page.getByText('Nada para hacer ahora.')).toBeVisible();
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
    // ZL-164: la reserva de pedidos aceptados solo se ve con pedidos por chat encendidos.
    const { negocio, n } = await montar(page, 'duena@example.com', async (nn, neg) => { await nn.negocios.guardar(neg.id, { pedidos: true }); });
    const barra = await page.locator('nav.tabs').boundingBox();
    expect(barra && barra.y + barra.height).toBeGreaterThan(800);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.getByRole('tab', { name: 'Más' }).click(); await page.getByRole('button', { name: 'Conexiones', exact: true }).click();
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
    await page.getByRole('tab', { name: 'Más' }).click(); await page.getByRole('button', { name: 'Asistente', exact: true }).click();
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
    await page.getByRole('tab', { name: 'Más' }).click(); await page.getByRole('button', { name: 'Conexiones', exact: true }).click();
    await page.getByRole('button', { name: 'Estado', exact: true }).click();
    await expect(page.locator('.chip').filter({ hasText: /Todo funcionando|Falta algo/ })).toBeVisible();
  });

  test('reportes (ZL-152): semana con horarios y lo que más compran, Excel para bajar, sin estilos bloqueados; accesible', async ({ page }) => {
    const errores: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    const { negocio } = await montar(page, 'duena@example.com', async (n, neg, d) => {
      const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
      await n.negocios.sumarMensaje(neg.id, { dia: hoy, hora: 20, canal: 'wa', n: 5 });
      await n.negocios.sumarMensaje(neg.id, { dia: hoy, hora: 11, canal: 'ig', n: 2 });
      await n.negocios.guardar(neg.id, { pedidos: true });
      const cat = d.catalogo(neg.id);
      const pan = (await cat.ejecutar('crear', [{ nombre: 'Pan francés', precio: 2500, stock: 10 }, 'x'])).valor.id;
      await cat.ejecutar('carrito', ['yc:5493410000001:5493410000009', [{ id: pan, cantidad: 3 }], { canal: 'wa' }]);
      await cat.ejecutar('confirmar', ['yc:5493410000001:5493410000009', { nombre: 'Ana', entrega: 'retiro' }]);
      const torta = (await cat.ejecutar('crear', [{ nombre: 'Torta de chocolate', precio: 30000, stock: 2 }, 'x'])).valor.id;
      await cat.ejecutar('carrito', ['yc:5493410000001:5493410000008', [{ id: torta, cantidad: 1 }], { canal: 'wa' }]);
    });
    // ZL-155: con una sola unidad reservada, en singular.
    await page.getByRole('tab', { name: 'Productos' }).click();
    await expect(page.getByText('3 reservadas', { exact: true })).toBeVisible();
    await expect(page.getByText('1 reservada', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Más' }).click(); await page.getByRole('button', { name: 'Reportes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Semana', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Las horas con más mensajes: 20:00, 11:00.')).toBeVisible();
    await page.getByText('Más números').click();
    await expect(page.locator('.resumen').last()).toContainText('7mensajes recibidos');
    await expect(page.getByRole('cell', { name: 'Pan francés' })).toBeVisible();
    // La barra más alta ocupa todo el alto (el estilo se pone por CSSOM: la política de seguridad no lo bloquea).
    const alto = await page.locator('.grafico').first().locator('.barra-dato').nth(20).evaluate((el) => el.style.height);
    expect(alto).toBe('100%');
    // ZL-155: las horas del eje se leen enteras (en el celular se cortaban: «0C 0: 0€») y no se pisan entre sí.
    const ejes = await page.locator('.ejes').first().evaluate((el) => {
      const caja = el.closest('.caja')!.getBoundingClientRect();
      return [...el.querySelectorAll('span')].filter((s) => s.textContent).map((s) => {
        const r = document.createRange(); r.selectNodeContents(s);
        const b = r.getBoundingClientRect();
        return { t: s.textContent, izq: b.left, der: b.right, dentro: b.left >= caja.left && b.right <= caja.right, corta: getComputedStyle(s).overflow !== 'visible' };
      });
    });
    expect(ejes.map((e) => e.t)).toEqual(['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00']);
    for (const [i, e] of ejes.entries()) {
      expect(e.dentro && !e.corta, `${e.t} se ve entera`).toBe(true);
      if (i) expect(e.izq, `${e.t} no pisa a ${ejes[i - 1].t}`).toBeGreaterThan(ejes[i - 1].der);
    }
    await expect(page.getByRole('link', { name: 'Descargar Excel' })).toHaveAttribute('href', new RegExp(`/api/n/${negocio.id}/reporte\\?periodo=semana&fecha=\\d{4}-\\d{2}-\\d{2}&formato=xlsx$`));
    await page.getByRole('button', { name: 'Mes', exact: true }).click();
    await expect(page.getByRole('heading', { name: /^Reporte de Panadería La Espiga · 01\// })).toBeVisible();
    expect(errores.filter((e) => /Content Security Policy/i.test(e))).toEqual([]);
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });

  test('Asistente (ZL-159): la dueña lo pausa con un mensaje, deja un aviso del día y lo prueba; un empleado lo ve pero no lo cambia; accesible', async ({ page }) => {
    const { negocio, n } = await montar(page, 'duena@example.com', async (n, neg) => {
      await n.negocios.guardar(neg.id, { emails: ['duena@example.com', 'empleado@example.com'], empleados: ['empleado@example.com'] });
    });
    await page.getByRole('tab', { name: 'Más' }).click(); await page.getByRole('button', { name: 'Asistente', exact: true }).click();
    await expect(page.getByText('Atendiendo: responde cada mensaje')).toBeVisible();
    // Pausa de 3 días con mensaje de ausencia.
    await page.getByText('Pausar el asistente (vacaciones, local cerrado)').click();
    await page.getByLabel('¿Hasta cuándo?').selectOption('3');
    await page.getByLabel('Mensaje de ausencia (opcional)').fill('Estamos de vacaciones 🌴');
    await page.getByRole('button', { name: 'Pausar', exact: true }).click();
    await expect(page.getByText(/^En pausa hasta el /)).toBeVisible();
    await expect(page.locator('.cita', { hasText: 'Estamos de vacaciones' })).toBeVisible();
    const guardado = await n.negocios.get(negocio.id);
    expect(Math.round((guardado.pausa.hasta - Date.now()) / 86_400_000)).toBe(3);
    // Aviso del día: el asistente lo tiene en cuenta.
    await page.getByLabel('Aviso del día').fill('Hoy no hay medialunas.');
    await page.getByRole('button', { name: 'Guardar el aviso' }).click();
    await expect(page.locator('.cita', { hasText: 'Hoy no hay medialunas.' })).toBeVisible();
    expect((await n.negocios.get(negocio.id)).avisoDia.texto).toBe('Hoy no hay medialunas.');
    // La prueba como un cliente: con el asistente en pausa responde lo de la pausa.
    await page.getByLabel('Mensaje de prueba para tu asistente').fill('hola');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.locator('.burbuja.asis').last()).toBeVisible();
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
    await page.getByRole('button', { name: 'Volver a encenderlo' }).click();
    await expect(page.getByText('Atendiendo: responde cada mensaje')).toBeVisible();
    expect((await n.negocios.get(negocio.id)).pausa).toBeNull();
  });

  test('roles (ZL-159): un empleado ve el asistente y los pedidos, pero no lo pausa ni cambia cómo se vende', async ({ page }) => {
    await montar(page, 'empleado@example.com', async (n, neg) => {
      await n.negocios.guardar(neg.id, { emails: ['duena@example.com', 'empleado@example.com'], empleados: ['empleado@example.com'] });
    });
    await page.getByRole('tab', { name: 'Más' }).click(); await page.getByRole('button', { name: 'Asistente', exact: true }).click();
    await expect(page.getByText('Atendiendo: responde cada mensaje')).toBeVisible();
    await expect(page.getByText('Pausar el asistente (vacaciones, local cerrado)')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Guardar el aviso' })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Más' }).click(); await page.getByRole('button', { name: 'Conexiones', exact: true }).click();
    await expect(page.getByText('Conectar WhatsApp o Instagram y cambiar cómo se vende lo hace el dueño del negocio.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cómo vendés' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Conectar Instagram' })).toHaveCount(0);
    // Y si igual lo intenta por fuera de la app, el servidor lo frena (lo prueba test/negocios.test.js).
  });

  test('Mi negocio (ZL-164): la dueña carga el horario con dos turnos, copia el lunes, suma feriados y una zona de envío; responde lo que no supo; accesible en el celular', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { negocio, n } = await montar(page, 'duena@example.com', async (nn, neg) => {
      await nn.negocios.sumarNoSupo(neg.id, '¿Hacen tortas sin TACC?');
    });
    await page.getByRole('tab', { name: 'Mi negocio' }).click();
    await expect(page.getByText('Sin horarios cargados')).toBeVisible();
    await page.getByLabel('Lunes').check();
    await page.getByRole('button', { name: '+ Otro turno' }).click();
    await page.getByRole('button', { name: 'Copiar el lunes a todos los días' }).click();
    await page.getByLabel('Domingo').uncheck();
    await page.getByRole('button', { name: 'Cargar feriados' }).click();
    await expect(page.getByRole('status')).toContainText('Sumé');
    await page.getByLabel('Responder sin tomar pedidos').check();
    await page.getByLabel('Dónde está el local').fill('Calle Ficticia 123, Rosario');
    await page.getByRole('button', { name: '+ Agregar zona' }).click();
    await page.getByLabel('Zona', { exact: true }).fill('Centro');
    await page.getByLabel('Costo').fill('1500');
    await page.getByLabel('Transferencia').check();
    await page.getByLabel('Alias o CBU para transferir').fill('ALIAS.FICTICIO');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Guardado');
    const mn = (await n.negocios.get(negocio.id)).minegocio;
    expect(mn.horarios[3]).toEqual([{ abre: '09:00', cierra: '13:00' }, { abre: '16:00', cierra: '20:00' }]);
    expect(mn.horarios[6]).toEqual([]);
    expect(mn.especiales.length).toBeGreaterThan(3);
    expect(mn.especiales.every((e: any) => e.tipo === 'cerrado' && e.nota)).toBe(true);
    expect([mn.fueraDeHorario, mn.direccion, mn.envios.zonas[0].nombre, mn.envios.zonas[0].costo, mn.pagos.transferencia, mn.pagos.alias]).toEqual(['responder', 'Calle Ficticia 123, Rosario', 'Centro', 1500, true, 'ALIAS.FICTICIO']);
    await expect(page.getByRole('link', { name: 'Ver en el mapa' })).toBeVisible();
    await expect(page.getByText('Historial de cambios')).toBeVisible();
    // Lo que no supo: se responde y pasa a las preguntas frecuentes.
    await page.getByPlaceholder('Escribí la respuesta, así la próxima la sabe').fill('Sí, por encargo.');
    await page.getByRole('button', { name: 'Responder y guardar' }).click();
    await expect(page.getByRole('status')).toContainText('preguntas frecuentes');
    expect((await n.negocios.get(negocio.id)).preguntas.map((x: any) => x.p)).toEqual(['¿Hacen tortas sin TACC?']);
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });

  test('Charlas (ZL-165): la dueña ve la charla, marca 👎 y deja la respuesta correcta; pasadas las 24 h no puede escribir desde acá; accesible', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { negocio, n } = await montar(page, 'duena@example.com', async (nn, neg, deps) => {
      await deps.catalogo(neg.id).ejecutar('guardarMensajes', ['yc:5493410000001:5493410000009', 'wa', [{ de: 'cliente', texto: '¿Hacen tortas sin TACC? (dato ficticio)' }, { de: 'asistente', texto: 'Eso no lo tengo confirmado.' }], 'Ana']);
    });
    await page.getByRole('tab', { name: 'Charlas' }).click();
    await page.getByRole('button', { name: /Ana/ }).click();
    await expect(page.locator('.msg.cli')).toContainText('¿Hacen tortas sin TACC?');
    await expect(page.getByText('Pasaron más de 24 horas desde su último mensaje')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enviar' })).toBeDisabled();
    await page.getByRole('button', { name: 'Esta respuesta estuvo mal' }).click();
    await page.getByLabel('¿Qué tendría que haber respondido?').fill('Sí, los viernes por encargo.');
    await page.getByRole('button', { name: 'Guardar como pregunta frecuente' }).click();
    await expect(page.getByRole('status')).toContainText('preguntas frecuentes');
    expect((await n.negocios.get(negocio.id)).preguntas.map((x: any) => [x.p, x.r])).toEqual([['¿Hacen tortas sin TACC? (dato ficticio)', 'Sí, los viernes por encargo.']]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
    await page.getByRole('button', { name: '← Todas las charlas' }).click();
    await expect(page.getByRole('heading', { name: 'Charlas' })).toBeVisible();
  });

  test('Productos (ZL-165): «Se agotó» con un toque, precios en bloque con vista previa y «Servicios»; Más → Avisos', async ({ page }) => {
    const { negocio, deps } = await montar(page, 'duena@example.com', async (nn, neg, dd) => {
      await dd.catalogo(neg.id).ejecutar('crear', [{ nombre: 'Pan francés', precio: 2500, categoria: 'Panes' }, 'duena@example.com']);
    });
    await page.getByRole('tab', { name: 'Productos' }).click();
    await expect(page.getByText('Mostrando 1 de 1.')).toBeVisible();
    await page.getByRole('button', { name: 'Se agotó' }).click();
    await expect(page.getByRole('button', { name: 'Volvió' })).toBeVisible();
    expect((await deps.catalogo(negocio.id).ejecutar('lista', [{}])).valor.productos[0].activo).toBeFalsy();
    await page.getByRole('button', { name: 'Cambiar precios' }).click();
    await page.getByLabel('Porcentaje (negativo para bajar)').fill('10');
    await expect(page.getByText('Pan francés: $ 2.500 → $ 2.750')).toBeVisible();
    await page.getByRole('button', { name: 'Aplicar' }).click();
    await expect(page.getByRole('status')).toContainText('cambiaron 1 precios');
    await page.getByText('Qué mostrar').click();
    await page.getByLabel('Vendés').selectOption('servicios');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Servicios' })).toBeVisible();
    await page.getByRole('tab', { name: 'Más' }).click();
    await page.getByRole('button', { name: 'Avisos', exact: true }).click();
    await expect(page.getByText('Ningún dispositivo tiene los avisos activados')).toBeVisible();
  });

  test('Inicio (ZL-159): si ningún celular tiene los avisos, lo dice arriba', async ({ page }) => {
    await montar(page, 'duena@example.com');
    await expect(page.getByText('Ningún celular tiene los avisos activados')).toBeVisible();
  });
});
