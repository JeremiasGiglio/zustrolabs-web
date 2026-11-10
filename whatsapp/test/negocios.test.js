// Tests de la app de negocios (ZL-121): ingreso con Access, qué ve cada uno, protección de los cambios, productos,
// stock, importación, fotos, administración y que la IA consulte el catálogo. Sin red: Access, Meta y la IA se simulan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { adaptadores, almacenPrueba, crearAtencion } from '../src/atencion.js';
import { crearCatalogo, ejecutarCatalogo } from '../src/catalogo.js';
import { _resetCerts } from '../src/panel.js';
import { firmar } from '../src/whatsapp.js';
import { sqlPrueba } from './sqlite.js';

const T0 = 1_792_000_000_000;
const TEAM = 'equipo-de-prueba.cloudflareaccess.com';
const AUD = 'aud-negocios-prueba';
const ESTUDIO = '17841400000000001';
const CUENTA_A = '17841400000000002';
const CUENTA_B = '17841400000000003';
const APP = { id: '2000000000000002', secreto: 'secreto-cliente-prueba' };
const limiteOk = { limit: async () => ({ success: true }) };
const ENV = {
  ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: 'aud-panel', NEGOCIOS_ACCESS_AUD: AUD, PANEL_EMAILS: 'equipo@example.com',
  IG_APP_ID: '1000000000000001', IG_APP_SECRET: 'secreto-ig-prueba', LIMITE: limiteOk, LIMITE_GLOBAL: limiteOk,
};
const FICHA = readFileSync(new URL('./ficha-prueba.md', import.meta.url), 'utf8');

// ── Access simulado: una clave RSA de prueba y tokens firmados con ella ──
const claves = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', claves.publicKey)), kid: 'k1' };
const b64 = (s) => Buffer.from(s).toString('base64url');
async function token(email, { aud = AUD, exp = T0 / 1000 + 3600 } = {}) {
  const cuerpo = `${b64(JSON.stringify({ alg: 'RS256', kid: 'k1' }))}.${b64(JSON.stringify({ email, aud: [aud], exp }))}`;
  const firma = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', claves.privateKey, new TextEncoder().encode(cuerpo));
  return `${cuerpo}.${Buffer.from(firma).toString('base64url')}`;
}

// Valor falso para las pruebas (en una constante: el control de secretos del repo no lo confunde con uno real).
const FIRMA_FALSA = 'secreto-del-webhook';

async function armar() {
  _resetCerts();
  const n = adaptadores(crearAtencion(almacenPrueba()), () => T0);
  await n.cuentas.put(ESTUDIO, { username: 'zustrolabs', token: 'tok-estudio', vence: T0 + 9e9, app: ENV.IG_APP_ID });
  await n.apps.put(APP.id, { secreto: APP.secreto, nombre: 'Clientes' });
  await n.cuentas.put(CUENTA_A, { username: 'laespiga', token: 'tok-a', vence: T0 + 9e9, app: APP.id });
  await n.cuentas.put(CUENTA_B, { username: 'otra.tienda', token: 'tok-b', vence: T0 + 9e9, app: APP.id });
  const bases = new Map();
  const catalogo = (id) => {
    if (!bases.has(id)) { const { sql, transaccion } = sqlPrueba(); let t = T0; bases.set(id, crearCatalogo(sql, transaccion, () => t++)); }
    const c = bases.get(id);
    return { ejecutar: async (op, args) => structuredClone(ejecutarCatalogo(c, op, structuredClone(args))) };
  };
  const enviados = [];
  const ia = [];
  const d = {
    ...n, catalogo, now: T0,
    fetch: async (url, o) => {
      if (String(url) === `https://${TEAM}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
      enviados.push({ url: String(url), auth: o?.headers?.authorization, clave: o?.headers?.['X-API-Key'], metodo: o?.method, body: JSON.parse(o?.body ?? 'null') });
      if (String(url).endsWith('/webhookEndpoints')) return Response.json({ id: 'we_1', secret: FIRMA_FALSA });
      return Response.json({});
    },
    preguntarNegocio: (f, cat) => async (texto) => {
      const c = cat ? await cat(texto) : null;
      ia.push({ negocio: f.nombre, texto, catalogo: c?.texto ?? null });
      return { respuesta: `Respuesta de ${f.nombre}.`, persona: false, fuera_de_tema: false, vacia: false, notas: [] };
    },
  };
  const pedir = async (email, metodo, ruta, cuerpo, extra = {}) => {
    const headers = { ...(email && { 'Cf-Access-Jwt-Assertion': await token(email, extra.token) }), ...(metodo !== 'GET' && !extra.sinCabecera && { 'x-zl': '1' }), ...extra.headers };
    let body;
    if (cuerpo instanceof Uint8Array) body = cuerpo;
    else if (cuerpo !== undefined) { body = JSON.stringify(cuerpo); headers['content-type'] = 'application/json'; }
    const r = await worker.fetch(new Request(`https://negocios.zustrolabs.com${ruta}`, { method: metodo, headers, body }), extra.env ?? ENV, {}, d);
    const tipo = r.headers.get('content-type') ?? '';
    return { status: r.status, headers: r.headers, datos: tipo.includes('json') ? await r.json() : await r.arrayBuffer() };
  };
  // Dos negocios: La Espiga (con su cuenta de Instagram) y Otra Tienda.
  const a = (await pedir('equipo@example.com', 'POST', '/api/admin/negocios', { nombre: 'Panadería La Espiga', emails: 'duena@example.com, Empleado@Example.com' })).datos;
  const b = (await pedir('equipo@example.com', 'POST', '/api/admin/negocios', { nombre: 'Otra Tienda', emails: ['otro@example.com'] })).datos;
  return { n, d, a, b, pedir, enviados, ia, bases };
}

test('ingreso: sin configurar 503; sin token, con el token de otra app o vencido, 401', async () => {
  const { pedir } = await armar();
  assert.equal((await pedir('duena@example.com', 'GET', '/api/yo', undefined, { env: { ...ENV, NEGOCIOS_ACCESS_AUD: '' } })).status, 503);
  assert.equal((await pedir(null, 'GET', '/api/yo')).status, 401);
  assert.equal((await pedir('duena@example.com', 'GET', '/api/yo', undefined, { token: { aud: 'aud-panel' } })).status, 401, 'el token del panel del equipo no sirve acá');
  assert.equal((await pedir('duena@example.com', 'GET', '/api/yo', undefined, { token: { exp: T0 / 1000 - 10 } })).status, 401);
});

test('cada uno ve lo suyo: el equipo todos; el negocio solo el suyo; un correo sin negocio, ninguno', async () => {
  const { pedir, a, b } = await armar();
  assert.deepEqual((await pedir('equipo@example.com', 'GET', '/api/yo')).datos.negocios.map((x) => x.nombre), ['Otra Tienda', 'Panadería La Espiga']);
  const yo = (await pedir('empleado@example.com', 'GET', '/api/yo')).datos;
  assert.deepEqual([yo.admin, yo.negocios.map((x) => x.id)], [false, [a.id]], 'el correo se compara en minúsculas');
  assert.deepEqual((await pedir('nadie@example.com', 'GET', '/api/yo')).datos.negocios, []);
  // El negocio A no puede ver ni tocar el B, aunque cambie la dirección.
  assert.equal((await pedir('duena@example.com', 'GET', `/api/n/${b.id}`)).status, 404);
  assert.equal((await pedir('duena@example.com', 'POST', `/api/n/${b.id}/productos`, { nombre: 'Intruso' })).status, 404);
  assert.equal((await pedir('duena@example.com', 'GET', '/api/admin/negocios')).status, 403);
  assert.equal((await pedir('duena@example.com', 'GET', `/api/n/${a.id}/ficha`)).status, 403, 'la ficha la maneja solo el equipo');
  assert.equal((await pedir('duena@example.com', 'PUT', `/api/n/${a.id}/ficha`, { texto: FICHA, activa: true })).status, 403);
  const datos = (await pedir('duena@example.com', 'GET', `/api/n/${a.id}`)).datos;
  assert.equal(datos.negocio.emails, undefined, 'el negocio no ve la configuración del equipo');
  assert.equal(datos.admin, false);
});

test('cambios protegidos: sin la cabecera propia o desde otro sitio, 403', async () => {
  const { pedir, a } = await armar();
  assert.equal((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/productos`, { nombre: 'X' }, { sinCabecera: true })).status, 403);
  assert.equal((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/productos`, { nombre: 'X' }, { headers: { origin: 'https://malo.example.com' } })).status, 403);
  assert.equal((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/productos`, { nombre: 'X' }, { headers: { origin: 'https://negocios.zustrolabs.com' } })).status, 201);
});

test('productos y stock desde la app: errores claros, quién cambió cada cosa, y los datos de un negocio no se cruzan', async () => {
  const { pedir, a, b } = await armar();
  const mal = await pedir('duena@example.com', 'POST', `/api/n/${a.id}/productos`, { nombre: 'Pan', precio: 'caro' });
  assert.deepEqual([mal.status, mal.datos.campo], [400, 'precio']);
  const p = (await pedir('duena@example.com', 'POST', `/api/n/${a.id}/productos`, { nombre: 'Pan francés', precio: 2500, stock: 10, unidad: 'kg' })).datos;
  assert.equal((await pedir('empleado@example.com', 'POST', `/api/n/${a.id}/productos/${p.id}/stock`, { delta: -3, motivo: 'venta en el local' })).datos.stock, 7);
  assert.equal((await pedir('empleado@example.com', 'POST', `/api/n/${a.id}/productos/${p.id}/stock`, { delta: -30 })).status, 400);
  assert.equal((await pedir('duena@example.com', 'PUT', `/api/n/${a.id}/productos/${p.id}`, { precio: 2700 })).datos.precio, 2700);
  const h = (await pedir('duena@example.com', 'GET', `/api/n/${a.id}/historial`)).datos.movimientos;
  assert.deepEqual(h.map((m) => [m.tipo, m.quien]), [['precio', 'duena@example.com'], ['stock', 'empleado@example.com'], ['alta', 'duena@example.com']]);
  assert.equal((await pedir('otro@example.com', 'GET', `/api/n/${b.id}/productos`)).datos.total, 0, 'el otro negocio no ve el pan');
  const resumen = (await pedir('duena@example.com', 'GET', `/api/n/${a.id}`)).datos.resumen;
  assert.deepEqual(resumen, { total: 1, activos: 1, agotados: 0 });
  assert.equal((await pedir('duena@example.com', 'DELETE', `/api/n/${a.id}/productos/${p.id}`)).datos.ok, true);
});

test('importar: vista previa y después en serio; exportar devuelve todo', async () => {
  const { pedir, a } = await armar();
  const filas = [{ _fila: 2, codigo: 'P1', nombre: 'Pan francés', precio: 2500, stock: 10 }, { _fila: 3, nombre: 'Facturas', precio: 'x' }, { _fila: 4, nombre: 'Torta', precio: 30000 }];
  const vista = (await pedir('duena@example.com', 'POST', `/api/n/${a.id}/importar`, { filas, probar: true })).datos;
  assert.deepEqual([vista.creados, vista.errores.map((e) => e.fila)], [2, [3]]);
  assert.equal((await pedir('duena@example.com', 'GET', `/api/n/${a.id}/exportar`)).datos.productos.length, 0);
  const real = (await pedir('duena@example.com', 'POST', `/api/n/${a.id}/importar`, { filas })).datos;
  assert.equal(real.creados, 2);
  assert.deepEqual((await pedir('duena@example.com', 'GET', `/api/n/${a.id}/exportar`)).datos.productos.map((p) => p.nombre), ['Pan francés', 'Torta']);
  assert.equal((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/importar`, { nada: 1 })).status, 400);
});

test('fotos: se suben como imagen real y se sirven sin que el navegador pueda tomarlas por otra cosa', async () => {
  const { pedir, a } = await armar();
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  assert.equal((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/fotos`, new TextEncoder().encode('<svg onload=x>'), { headers: { 'content-type': 'image/png' } })).status, 400);
  const f = await pedir('duena@example.com', 'POST', `/api/n/${a.id}/fotos`, png, { headers: { 'content-type': 'image/png' } });
  assert.equal(f.status, 201);
  const g = await pedir('duena@example.com', 'GET', `/api/n/${a.id}/fotos/${f.datos.id}`);
  assert.equal(g.headers.get('content-type'), 'image/png');
  assert.equal(g.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual([...new Uint8Array(g.datos)], [...png]);
});

test('administración: cuentas de Instagram de un solo negocio, la del estudio marcada; uso de la IA por negocio', async () => {
  const { pedir, a, b } = await armar();
  const cuentas = (await pedir('equipo@example.com', 'GET', '/api/admin/cuentas')).datos.cuentas;
  assert.deepEqual(cuentas.map((c) => c.username).sort(), ['laespiga', 'otra.tienda', 'zustrolabs']);
  // ZL-124: la del estudio aparece marcada, y se puede vincular a un negocio (después se libera para lo que sigue).
  assert.deepEqual(cuentas.filter((c) => c.estudio).map((c) => c.username), ['zustrolabs']);
  assert.equal((await pedir('equipo@example.com', 'PUT', `/api/admin/negocios/${a.id}`, { cuentas: [ESTUDIO] })).status, 200);
  assert.equal((await pedir('equipo@example.com', 'PUT', `/api/admin/negocios/${a.id}`, { cuentas: [] })).status, 200);
  assert.equal((await pedir('equipo@example.com', 'PUT', `/api/admin/negocios/${a.id}`, { cuentas: ['17841499999999999'] })).status, 400, 'no conectada');
  assert.equal((await pedir('equipo@example.com', 'PUT', `/api/admin/negocios/${a.id}`, { cuentas: [CUENTA_A], limiteDia: 2 })).status, 200);
  const dos = await pedir('equipo@example.com', 'PUT', `/api/admin/negocios/${b.id}`, { cuentas: [CUENTA_A] });
  assert.match(dos.datos.error, /ya es de otro negocio/);
  assert.equal((await pedir('equipo@example.com', 'PUT', `/api/admin/negocios/${a.id}`, { emails: 'mal correo' })).status, 400);
  assert.equal((await pedir('equipo@example.com', 'POST', '/api/admin/negocios', { nombre: '' })).status, 400);
  const lista = (await pedir('equipo@example.com', 'GET', '/api/admin/negocios')).datos.negocios;
  assert.deepEqual(lista.find((x) => x.id === a.id).cuentas, [CUENTA_A]);
});

test('la IA consulta el catálogo de SU negocio antes de responder, y el tope diario es por negocio', async () => {
  const { pedir, a, b, d, enviados, ia } = await armar();
  await pedir('equipo@example.com', 'PUT', `/api/admin/negocios/${a.id}`, { cuentas: [CUENTA_A], limiteDia: 10 });
  await pedir('equipo@example.com', 'PUT', `/api/admin/negocios/${b.id}`, { cuentas: [CUENTA_B] });
  assert.equal((await pedir('equipo@example.com', 'PUT', `/api/n/${a.id}/ficha`, { texto: FICHA, activa: true })).status, 200);
  assert.equal((await pedir('equipo@example.com', 'PUT', `/api/n/${b.id}/ficha`, { texto: FICHA.replace('Panadería La Espiga', 'Otra Tienda'), activa: true })).status, 200);
  await pedir('duena@example.com', 'POST', `/api/n/${a.id}/productos`, { nombre: 'Medialunas', precio: 900, stock: 0 });
  await pedir('otro@example.com', 'POST', `/api/n/${b.id}/productos`, { nombre: 'Producto secreto de otra tienda', stock: 5 });

  // La charla de prueba de la app usa el catálogo del negocio.
  const p = (await pedir('equipo@example.com', 'POST', `/api/n/${a.id}/probar`, { mensajes: ['hola', '¿tienen medialunas?'] })).datos;
  assert.equal(p.charla[1].que, 'ia');
  assert.equal(ia.at(-1).negocio, 'Panadería La Espiga');
  assert.match(ia.at(-1).catalogo, /Medialunas · \$ 900 · AGOTADO: no ofrecer/);
  assert.doesNotMatch(ia.at(-1).catalogo, /secreto/, 'nunca el catálogo de otro negocio');

  // ZL-126: la charla de prueba sigue entre mensajes (idioma elegido), con una ficha en dos idiomas sin guardar.
  const dos = FICHA.replace('- Idioma: castellano', '- Idioma: castellano, inglés') +
    '\n## Saludo (inglés)\n\nHi from the bakery.\n\n## Menú (inglés)\n\n### 1. Bread\nFresh.\n\n### 2. Cakes\nTo order.\n\n### 3. Hours\nMon to Sat.\n';
  const probar = async (m, estado) => (await pedir('equipo@example.com', 'POST', `/api/n/${a.id}/probar`, { texto: dos, mensajes: [m], estado })).datos;
  const q1 = await probar('hello', null);
  assert.equal(q1.charla[0].que, 'pide_idioma');
  assert.deepEqual(q1.estado, { humanoHasta: 0 });
  const q2 = await probar('2', q1.estado);
  assert.equal(q2.charla[0].que, 'idioma');
  assert.match(q2.charla[0].respuestas.join('\n'), /Hi from the bakery[\s\S]*Bread/);
  assert.equal(q2.estado.idioma, 'en');
  const q3 = await probar('2', q2.estado);
  assert.match(q3.charla[0].respuestas[0], /To order/, 'con el idioma ya elegido, 2 es la opción del menú');
  // Un estado raro se ignora (no rompe la prueba).
  assert.equal((await probar('hello', { idioma: 'xx', humanoHasta: 'mucho' })).charla[0].que, 'pide_idioma');

  // Un mensaje real de Instagram a la cuenta de La Espiga: consulta su catálogo y responde con su token.
  const mensaje = async (cuenta, text, quien = '17841400000000009') => {
    const cuerpo = JSON.stringify({ object: 'instagram', entry: [{ id: cuenta, time: T0, messaging: [{ sender: { id: quien }, recipient: { id: cuenta }, timestamp: T0, message: { mid: 'm' + Math.random(), text } }] }] });
    const r = await worker.fetch(new Request('https://zustrolabs.com/api/instagram', { method: 'POST', headers: { 'X-Hub-Signature-256': await firmar(cuerpo, APP.secreto) }, body: cuerpo }), ENV, {}, d);
    assert.equal(r.status, 200);
  };
  await mensaje(CUENTA_A, '¿Tienen medialunas?');
  assert.equal(ia.at(-1).texto, '¿Tienen medialunas?');
  assert.match(ia.at(-1).catalogo, /Medialunas/);
  const r1 = enviados.filter((e) => e.url.endsWith('/me/messages'));
  assert.ok(r1.length && r1.every((e) => e.auth === 'Bearer tok-a'));
  assert.match(r1.at(-1).body.message.text, /Respuesta de Panadería La Espiga/);
  await mensaje(CUENTA_B, '¿Qué tienen?');
  assert.match(ia.at(-1).catalogo, /Producto secreto de otra tienda/);
  assert.doesNotMatch(ia.at(-1).catalogo, /Medialunas/);

  // Tope por negocio: con limiteDia 10, la 11.ª respuesta del día de La Espiga ya no usa IA; Otra Tienda sigue.
  for (let i = 0; i < 9; i++) await mensaje(CUENTA_A, `¿Hay pan número ${i}?`, `1784140000000010${i}`);
  const antes = ia.length;
  await mensaje(CUENTA_A, '¿Y facturas?', '17841400000000200');
  assert.equal(ia.length, antes, 'pasado el tope no llama a la IA');
  assert.match(enviados.filter((e) => e.url.endsWith('/me/messages')).at(-1).body.message.text, /Mañana seguimos/);
  await mensaje(CUENTA_B, '¿Siguen abiertos?', '17841400000000201');
  assert.equal(ia.length, antes + 1, 'el otro negocio no se ve afectado');
  const uso = (await pedir('equipo@example.com', 'GET', '/api/admin/negocios')).datos.negocios;
  assert.equal(uso.find((x) => x.id === a.id).usoHoy, 11);
});

test('la app: la página, el JS y el CSS se sirven con una política que no deja cargar nada de afuera', async () => {
  const { pedir } = await armar();
  const html = await pedir('duena@example.com', 'GET', '/');
  assert.equal(html.status, 200);
  const csp = html.headers.get('content-security-policy');
  assert.match(csp, /default-src 'none'; script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(new TextDecoder().decode(html.datos), /<script src="\/app.js">/);
  const js = new TextDecoder().decode((await pedir('duena@example.com', 'GET', '/app.js')).datos);
  assert.doesNotThrow(() => new Function(js), 'el JS compila');
  assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML|eval\(/, 'lo que viene de la base nunca se pone como HTML');
  assert.match(js, /function leerXlsx/);
  assert.ok(js.startsWith('var __name = function (f) { return f; };'), 'empaquetado por Wrangler, el código trae __name(): tiene que existir (ZL-123)');
  assert.equal((await pedir(null, 'GET', '/app.js')).status, 401, 'sin entrar, ni siquiera el código');
});

test('canales por negocio (ZL-122): Instagram encendido de entrada; si el negocio lo apaga, esa cuenta no responde', async () => {
  const { pedir, a, d, enviados, ia } = await armar();
  assert.deepEqual((await pedir('duena@example.com', 'GET', `/api/n/${a.id}`)).datos.negocio.canales, { instagram: true, whatsapp: false });
  await pedir('equipo@example.com', 'PUT', `/api/admin/negocios/${a.id}`, { cuentas: [CUENTA_A] });
  await pedir('equipo@example.com', 'PUT', `/api/n/${a.id}/ficha`, { texto: FICHA, activa: true });
  const mensaje = async (text) => {
    const cuerpo = JSON.stringify({ object: 'instagram', entry: [{ id: CUENTA_A, time: T0, messaging: [{ sender: { id: '17841400000000009' }, recipient: { id: CUENTA_A }, timestamp: T0, message: { mid: 'm' + Math.random(), text } }] }] });
    const logs = [];
    const orig = console.log;
    console.log = (x) => logs.push(String(x));
    try { await worker.fetch(new Request('https://zustrolabs.com/api/instagram', { method: 'POST', headers: { 'X-Hub-Signature-256': await firmar(cuerpo, APP.secreto) }, body: cuerpo }), ENV, {}, d); }
    finally { console.log = orig; }
    return logs.map((l) => JSON.parse(l));
  };
  const r = (await pedir('equipo@example.com', 'PUT', `/api/admin/negocios/${a.id}`, { canales: { instagram: false } })).datos;
  assert.deepEqual(r.canales, { instagram: false, whatsapp: false });
  assert.ok((await mensaje('¿Tienen pan?')).some((l) => l.que === 'canal_apagado'));
  assert.equal(enviados.filter((e) => e.url.endsWith('/me/messages')).length, 0);
  assert.equal(ia.length, 0);
  await pedir('equipo@example.com', 'PUT', `/api/admin/negocios/${a.id}`, { canales: { instagram: true, whatsapp: true } });
  await mensaje('¿Tienen pan?');
  assert.equal(ia.length, 1, 'encendido de nuevo, responde');
  assert.deepEqual((await pedir('equipo@example.com', 'GET', '/api/admin/negocios')).datos.negocios.find((x) => x.id === a.id).canales, { instagram: true, whatsapp: true });
});

test('el script de alta (IG_ADMIN_CLAVE) crea el negocio, elige canales y lo vincula a la cuenta conectada', async () => {
  const { d } = await armar();
  const env = { ...ENV, IG_ADMIN_CLAVE: 'clave-admin-prueba' };
  const admin = async (metodo, ruta, cuerpo, clave = env.IG_ADMIN_CLAVE) => {
    const r = await worker.fetch(new Request(`https://zustrolabs.com/api/instagram/admin${ruta}`, { method: metodo, headers: { authorization: `Bearer ${clave}`, 'content-type': 'application/json' }, ...(cuerpo && { body: JSON.stringify(cuerpo) }) }), env, {}, d);
    return { status: r.status, datos: await r.json() };
  };
  assert.equal((await admin('GET', '/negocios', undefined, 'otra')).status, 401);
  const n = await admin('POST', '/negocios', { nombre: 'Chocolatería Ficticia', emails: 'dueno@example.com', canales: { instagram: true, whatsapp: true } });
  assert.equal(n.status, 201);
  assert.deepEqual(n.datos.canales, { instagram: true, whatsapp: true });
  // La del estudio se puede vincular (ZL-124: responde con la ficha del negocio solo si está activa); acá se desvincula.
  assert.equal((await admin('PUT', `/negocios/${n.datos.id}`, { cuentas: [ESTUDIO] })).status, 200, 'la cuenta del estudio se puede vincular');
  assert.equal((await admin('PUT', `/negocios/${n.datos.id}`, { cuentas: [CUENTA_A] })).status, 200);
  const est = (await admin('GET', '/estado')).datos;
  assert.equal(est.cuentas.find((c) => c.id === CUENTA_A).negocio, n.datos.id);
  assert.equal(est.cuentas.find((c) => c.id === ESTUDIO).negocio, null);
  // La ficha que carga el script por la cuenta queda en ESE negocio (no crea otro).
  assert.equal((await admin('PUT', `/cuentas/${CUENTA_A}/ficha`, { texto: FICHA, activa: true })).status, 200);
  const lista = (await admin('GET', '/negocios')).datos.negocios;
  assert.equal(lista.length, 3, 'los dos de armar() y el nuevo: ninguno de más');
  assert.equal(lista.find((x) => x.id === n.datos.id).asistente.activo, true);
});

test('WhatsApp (ZL-136): el negocio conecta su número solo, con su clave de YCloud; no ve ni toca los de otro negocio', async () => {
  const { n, a, b, pedir, enviados } = await armar();
  const CLAVE = 'clave-api-ycloud-del-negocio-1';
  // La dueña conecta su número con su correo, sin clave de administración.
  const r = await pedir('duena@example.com', 'POST', `/api/n/${a.id}/whatsapp`, { numero: '+54 9 341 000-0001', apiKey: CLAVE });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.numero, '+5493410000001');
  assert.doesNotMatch(JSON.stringify(r.datos), /clave-api|secreto-del-webhook/);
  const wh = enviados.find((e) => e.url.endsWith('/webhookEndpoints'));
  assert.equal(wh.clave, CLAVE, 'el webhook se crea en la cuenta de YCloud del negocio');
  // Siempre a zustrolabs.com: negocios. está detrás de Access y YCloud recibiría el inicio de sesión (10/11/2026).
  assert.match(wh.body.url, /^https:\/\/zustrolabs\.com\/api\/whatsapp\/ycloud\/[0-9a-f]{24}$/);
  assert.equal((await n.negocios.get(a.id)).canales.whatsapp, true);
  const lista = await pedir('duena@example.com', 'GET', `/api/n/${a.id}/whatsapp`);
  assert.deepEqual(lista.datos.numeros.map((x) => x.numero), ['+5493410000001']);
  assert.doesNotMatch(JSON.stringify(lista.datos), /clave-api|secreto-del-webhook/);
  // Otro negocio no ve ese número ni lo puede desconectar.
  assert.deepEqual((await pedir('otro@example.com', 'GET', `/api/n/${b.id}/whatsapp`)).datos.numeros, []);
  assert.equal((await pedir('otro@example.com', 'GET', `/api/n/${a.id}/whatsapp`)).status, 404);
  assert.equal((await pedir('otro@example.com', 'DELETE', `/api/n/${b.id}/whatsapp/${r.datos.clave}`)).status, 404);
  // Errores claros, y sin la cabecera propia no se puede cambiar nada.
  assert.match((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/whatsapp`, { numero: '341', apiKey: CLAVE })).datos.error, /código de país/);
  assert.equal((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/whatsapp`, { numero: '+5493410000001', apiKey: CLAVE })).status, 409);
  assert.equal((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/whatsapp`, { numero: '+5493410000002', apiKey: CLAVE }, { sinCabecera: true })).status, 403);
  // La dueña lo desconecta: se borra el webhook en YCloud.
  const del = await pedir('duena@example.com', 'DELETE', `/api/n/${a.id}/whatsapp/${r.datos.clave}`);
  assert.equal(del.status, 200);
  assert.equal(enviados.at(-1).metodo, 'DELETE');
  assert.deepEqual((await pedir('duena@example.com', 'GET', `/api/n/${a.id}/whatsapp`)).datos.numeros, []);
});

test('Instagram (ZL-137): pedir la invitación, «Conectar Instagram» con la app compartida y, a la vuelta, la cuenta queda en ese negocio', async () => {
  const { n, d, a, b, pedir } = await armar();
  const CTA = '17841400000000077';
  // Sin la app compartida registrada: no está disponible.
  let r = await pedir('duena@example.com', 'GET', `/api/n/${a.id}/instagram`);
  assert.equal(r.datos.disponible, false);
  assert.equal((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/instagram/conectar`)).status, 503);
  // Pedir la invitación: el equipo la ve en Administración.
  assert.equal((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/instagram/invitacion`, { usuario: 'mal usuario' })).status, 400);
  assert.equal((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/instagram/invitacion`, { usuario: '@la.espiga' })).status, 200);
  const adm = (await pedir('equipo@example.com', 'GET', '/api/admin/negocios')).datos.negocios.find((x) => x.id === a.id);
  assert.equal(adm.invitacionIg.usuario, 'la.espiga');
  // El equipo registra la app compartida.
  await n.apps.put('3000000000000003', { secreto: 'secreto-app-compartida', nombre: 'Clientes', compartida: true });
  r = await pedir('duena@example.com', 'GET', `/api/n/${a.id}/instagram`);
  assert.equal(r.datos.disponible, true);
  const ida = new URL((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/instagram/conectar`)).datos.url);
  assert.equal(ida.searchParams.get('client_id'), '3000000000000003');
  assert.equal(ida.searchParams.get('redirect_uri'), 'https://zustrolabs.com/api/instagram/conectar/vuelta');
  const state = ida.searchParams.get('state');
  assert.match(state, new RegExp(`\\.3000000000000003\\.${a.id}\\.`), 'el state lleva la app y el negocio');
  // Otro negocio no puede pedir el link de este.
  assert.equal((await pedir('otro@example.com', 'POST', `/api/n/${a.id}/instagram/conectar`)).status, 404);
  // Vuelta de Instagram con esa app: la cuenta queda vinculada a La Espiga, con Instagram encendido y sin el pedido.
  d.fetch = async (url, o = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.instagram.com/oauth/access_token')) return Response.json({ access_token: 'corto', user_id: CTA });
    if (u.includes('ig_exchange_token')) return Response.json({ access_token: 'largo', expires_in: 5_183_944 });
    if (u.includes('/me?fields=user_id,username')) return Response.json({ user_id: CTA, username: 'la.espiga' });
    if (u.includes('/me/subscribed_apps') && (o.method ?? 'GET') === 'GET') return Response.json({ data: [{ subscribed_fields: ['messages'] }] });
    if (u.includes('/me/subscribed_apps')) return Response.json({ success: true });
    return Response.json({}, { status: 400 });
  };
  const vuelta = await worker.fetch(new Request(`https://zustrolabs.com/api/instagram/conectar/vuelta?code=c&state=${encodeURIComponent(state)}`), { ...ENV, IG_CONECTAR_CLAVE: 'clave-link' }, {}, d);
  const pagina = await vuelta.text();
  assert.equal(vuelta.status, 200, pagina);
  assert.match(pagina, /@la\.espiga[\s\S]*href="https:\/\/negocios\.zustrolabs\.com\/"[^>]*>Volver a mi negocio/);
  const neg = await n.negocios.get(a.id);
  assert.ok(neg.cuentas.includes(CTA));
  assert.equal(neg.canales.instagram, true);
  assert.equal(neg.invitacionIg, null);
  assert.equal((await n.cuentas.get(CTA)).app, '3000000000000003');
  // Un state tocado (otro negocio con la misma firma) no sirve.
  const tocado = state.replace(a.id, b.id);
  assert.equal((await worker.fetch(new Request(`https://zustrolabs.com/api/instagram/conectar/vuelta?code=c&state=${encodeURIComponent(tocado)}`), { ...ENV, IG_CONECTAR_CLAVE: 'clave-link' }, {}, d)).status, 400);
  // La dueña la ve y la desconecta; otro negocio no puede.
  r = await pedir('duena@example.com', 'GET', `/api/n/${a.id}/instagram`);
  assert.deepEqual(r.datos.cuentas.map((c) => [c.username, c.conectada]), [['la.espiga', true]]);
  assert.equal((await pedir('otro@example.com', 'DELETE', `/api/n/${b.id}/instagram/${CTA}`)).status, 404);
  assert.equal((await pedir('duena@example.com', 'DELETE', `/api/n/${a.id}/instagram/${CTA}`)).status, 200);
  assert.ok(!(await n.negocios.get(a.id)).cuentas.includes(CTA));
  assert.equal(await n.cuentas.get(CTA), null);
});

test('Instagram (ZL-137): desconectar la cuenta del estudio desde un negocio la desvincula pero no borra su token', async () => {
  const { n, pedir } = await armar();
  const z = (await n.negocios.guardar(null, { nombre: 'ZustroLabs', emails: [], cuentas: [ESTUDIO] })).negocio;
  assert.equal((await pedir('equipo@example.com', 'DELETE', `/api/n/${z.id}/instagram/${ESTUDIO}`)).status, 200);
  assert.ok(!(await n.negocios.get(z.id)).cuentas.includes(ESTUDIO));
  assert.equal((await n.cuentas.get(ESTUDIO)).token, 'tok-estudio');
});
