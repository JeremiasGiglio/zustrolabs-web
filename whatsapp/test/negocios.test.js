// Tests de la app de negocios (ZL-121): ingreso con Access, qué ve cada uno, protección de los cambios, productos,
// stock, importación, fotos, administración y que la IA consulte el catálogo. Sin red: Access, Meta y la IA se simulan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker, { esCliente } from '../src/index.js';
import { adaptadores, almacenPrueba, crearAtencion } from '../src/atencion.js';
import { crearCatalogo, ejecutarCatalogo } from '../src/catalogo.js';
import { _resetCerts } from '../src/panel.js';
import { firmar } from '../src/whatsapp.js';
import { firmarYCloud } from '../src/ycloud.js';
import { sqlPrueba } from './sqlite.js';

// ZL-149: con opciones, YCloud recibe botones o una lista: el texto va en interactive.body.text.
const textoYC = (b) => b?.text?.body ?? b?.interactive?.body?.text;
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
const CLAVE_YC = 'clave-api-ycloud-de-prueba-123';

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
      if (String(url).includes('?fields=username')) return Response.json({ username: 'cliente.prueba' });
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
  // ZL-153: «hello» arranca en inglés sin preguntar el idioma.
  const q1 = await probar('hello', null);
  assert.equal(q1.charla[0].que, 'saludo');
  assert.match(q1.charla[0].respuestas.join('\n'), /Hi from the bakery[\s\S]*Bread/);
  assert.equal(q1.estado.idioma, 'en');
  const q3 = await probar('2', q1.estado);
  assert.match(q3.charla[0].respuestas[0], /To order/, 'con el idioma ya elegido, 2 es la opción del menú');
  // Un estado raro se ignora (no rompe la prueba).
  assert.equal((await probar('hello', { idioma: 'xx', humanoHasta: 'mucho' })).charla[0].que, 'saludo');

  // Un mensaje real de Instagram a la cuenta de La Espiga: consulta su catálogo y responde con su token.
  const mensaje = async (cuenta, text, quien = '17841400000000009') => {
    const cuerpo = JSON.stringify({ object: 'instagram', entry: [{ id: cuenta, time: T0, messaging: [{ sender: { id: quien }, recipient: { id: cuenta }, timestamp: T0, message: { mid: 'm' + Math.random(), text } }] }] });
    const r = await worker.fetch(new Request('https://zustrolabs.com/api/instagram', { method: 'POST', headers: { 'X-Hub-Signature-256': await firmar(cuerpo, APP.secreto) }, body: cuerpo }), ENV, {}, d);
    assert.equal(r.status, 200);
  };
  await mensaje(CUENTA_A, '¿Tienen medialunas?');
  assert.equal(ia.at(-1).texto, '¿Tienen medialunas?');
  // ZL-153: el usuario de Instagram de la persona queda en su memoria (una sola vez) y la app lo muestra.
  const QUIEN_IG = `ig:${CUENTA_A}.17841400000000009`;
  assert.equal((await d.memoria.get(QUIEN_IG)).usuario, 'cliente.prueba');
  const busquedas = () => enviados.filter((e) => e.url.includes('?fields=username')).length;
  const yaBuscado = busquedas();
  await mensaje(CUENTA_A, '¿Y a qué hora abren?');
  assert.equal(busquedas(), yaBuscado, 'con el usuario ya guardado no se vuelve a pedir a Meta');
  await d.catalogo(a.id).ejecutar('crearConsulta', [QUIEN_IG, { tipo: 'consulta', nombre: 'Ana', canal: 'ig' }]);
  await d.catalogo(a.id).ejecutar('crearConsulta', [`ig:${CUENTA_A}.17841400000000777`, { tipo: 'persona', canal: 'ig' }]);
  const cs = (await pedir('duena@example.com', 'GET', `/api/n/${a.id}/consultas`)).datos.consultas;
  assert.deepEqual(cs.find((c) => c.charla === QUIEN_IG).contacto, { canal: 'instagram', texto: '@cliente.prueba', enlace: 'https://ig.me/m/cliente.prueba' });
  assert.equal(cs.find((c) => c.charla !== QUIEN_IG).contacto.enlace, 'https://www.instagram.com/direct/inbox/', 'sin usuario guardado, la bandeja de Instagram');
  assert.match(ia.at(-1).catalogo, /Medialunas/);
  const r1 = enviados.filter((e) => e.url.endsWith('/me/messages'));
  assert.ok(r1.length && r1.every((e) => e.auth === 'Bearer tok-a'));
  assert.match(r1.at(-1).body.message.text, /Respuesta de Panadería La Espiga/);
  await mensaje(CUENTA_B, '¿Qué tienen?');
  assert.match(ia.at(-1).catalogo, /Producto secreto de otra tienda/);
  assert.doesNotMatch(ia.at(-1).catalogo, /Medialunas/);

  // Tope por negocio: con limiteDia 10, la 11.ª respuesta del día de La Espiga ya no usa IA; Otra Tienda sigue.
  for (let i = 0; i < 8; i++) await mensaje(CUENTA_A, `¿Hay pan número ${i}?`, `1784140000000010${i}`);
  const antes = ia.length;
  await mensaje(CUENTA_A, '¿Y facturas?', '17841400000000200');
  assert.equal(ia.length, antes, 'pasado el tope no llama a la IA');
  assert.match(enviados.filter((e) => e.url.endsWith('/me/messages')).at(-1).body.message.text, /Eso lo consulto con el equipo de Panadería La Espiga/, 'ZL-146: pasado el tope, la charla pasa al negocio');
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
  // Sin app compartida registrada, se usa la del estudio (ZL-140: Meta ya no da «Instagram login» a las apps nuevas).
  assert.equal(r.datos.disponible, true);
  const conEstudio = new URL((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/instagram/conectar`)).datos.url);
  assert.equal(conEstudio.searchParams.get('client_id'), ENV.IG_APP_ID);
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

test('pedidos (ZL-139): por WhatsApp el asistente arma el pedido; el negocio lo ve, lo acepta, lo cobra y lo entrega; el comprador recibe cada aviso', async () => {
  const { d, a, b, pedir, enviados } = await armar();
  const FICHA = readFileSync(new URL('./ficha-prueba.md', import.meta.url), 'utf8');
  // El negocio: ficha activa, WhatsApp y pedidos encendidos, un producto con stock.
  await d.negocios.guardarFicha(a.id, { texto: FICHA, activa: true });
  assert.equal((await pedir('equipo@example.com', 'PUT', `/api/admin/negocios/${a.id}`, { canales: { instagram: true, whatsapp: true }, pedidos: true })).status, 200);
  const pan = (await pedir('duena@example.com', 'POST', `/api/n/${a.id}/productos`, { nombre: 'Pan francés', precio: 2500, stock: 10 })).datos;
  assert.equal((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/whatsapp`, { numero: '+5493410000001', apiKey: CLAVE_YC })).status, 200);
  const clave = /\/ycloud\/([0-9a-f]{24})$/.exec(enviados.find((e) => e.url.endsWith('/webhookEndpoints')).body.url)[1];
  // La «IA»: pide el carrito con la ref que ve en el catálogo.
  const vio = [];
  d.preguntarNegocio = (f, cat) => async (texto, idioma, opts = {}) => {
    const c = await cat(texto, { refs: opts.carrito !== undefined });
    vio.push({ catalogo: c.texto, carrito: opts.carrito, compras: opts.compras });
    const ref = /\[ref (p[a-z0-9]+)\] Pan francés/.exec(c.texto)?.[1];
    return { respuesta: '¡Dale!', persona: false, fuera_de_tema: false, vacia: false, notas: [], ...(/pan/.test(texto) && { pedido: { cambia: true, items: [{ ref, cantidad: 3 }] } }) };
  };
  let n = 0;
  const escribir = async (texto) => {
    const cuerpo = JSON.stringify({ id: `ev${++n}`, type: 'whatsapp.inbound_message.received', createTime: new Date(T0).toISOString(), whatsappInboundMessage: { id: `m${n}`, wamid: `w${n}`, from: '+5493410000009', to: '+5493410000001', type: 'text', text: { body: texto }, sendTime: new Date(T0).toISOString() } });
    const antes = enviados.length;
    const r = await worker.fetch(new Request(`https://zustrolabs.com/api/whatsapp/ycloud/${clave}`, { method: 'POST', headers: { 'YCloud-Signature': await firmarYCloud(cuerpo, FIRMA_FALSA, T0 / 1000) }, body: cuerpo }), ENV, {}, d);
    assert.equal(r.status, 200);
    return enviados.slice(antes).filter((e) => e.url.endsWith('/sendDirectly')).map((e) => textoYC(e.body)).join('\n---\n');
  };
  await escribir('hola');
  let t = await escribir('quiero 3 kilos de pan');
  assert.match(vio.at(-1).catalogo, /\[ref p[a-z0-9]+\] Pan francés/, 'con pedidos, la IA ve la ref de cada producto');
  assert.match(t, /• 3 × Pan francés — \$ 7\.500\nTotal: \$ 7\.500/);
  assert.equal((await pedir('duena@example.com', 'GET', `/api/n/${a.id}/productos`)).datos.productos[0].reservado, 3);
  await escribir('sí');
  await escribir('1');
  t = await escribir('Ana');
  assert.match(t, /Tu pedido N\.º 1 quedó registrado/);
  assert.equal(vio.at(-1).compras, undefined, 'antes de confirmar no había pedidos');
  // ZL-154: la IA ve lo que pidió esta persona y en qué estado está, para responder «¿ya salió mi pedido?».
  await escribir('¿ya salió mi pedido?');
  assert.match(vio.at(-1).compras.texto, /^- Pedido N\.º 1 del \d\d\/\d\d · esperando que el negocio lo confirme · retira en el local · \[ref p[a-z0-9]+\] 3 × Pan francés · total \$ 7\.500$/);
  // El panel del negocio: lo ve; otro negocio no.
  let lista = (await pedir('duena@example.com', 'GET', `/api/n/${a.id}/pedidos`)).datos;
  assert.deepEqual(lista.cuenta, { pendiente: 1 });
  assert.equal(lista.encendidos, true);
  assert.deepEqual(lista.pedidos[0].items.map((i) => [i.nombre, i.cantidad, i.subtotal]), [['Pan francés', 3, 7500]]);
  // ZL-153: la tarjeta dice por dónde escribió y su número, para encontrarlo rápido.
  assert.deepEqual(lista.pedidos[0].contacto, { canal: 'whatsapp', texto: '+5493410000009', enlace: 'https://wa.me/5493410000009' });
  assert.deepEqual((await pedir('duena@example.com', 'GET', `/api/n/${a.id}/pedidos/1`)).datos.contacto, lista.pedidos[0].contacto);
  assert.equal((await pedir('otro@example.com', 'GET', `/api/n/${a.id}/pedidos`)).status, 404);
  assert.equal((await pedir('otro@example.com', 'POST', `/api/n/${a.id}/pedidos/1`, { estado: 'aceptado' })).status, 404);
  assert.deepEqual((await pedir('otro@example.com', 'GET', `/api/n/${b.id}/pedidos`)).datos.pedidos, []);
  // Pasos que no se pueden y estados inventados.
  assert.equal((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/pedidos/1`, { estado: 'pagado' })).status, 400);
  assert.equal((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/pedidos/1`, { estado: 'borrador' })).status, 400);
  assert.equal((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/pedidos/1`, { estado: 'aceptado' }, { sinCabecera: true })).status, 403);
  // ZL-148: el negocio carga una vez cómo se paga y cómo se entrega; el aviso de «aceptado» lo lleva solo.
  const aj = await pedir('duena@example.com', 'PUT', `/api/n/${a.id}/ajustes`, { pago: 'Transferencia al alias LA.ESPIGA.PAN (ficticio)', envio: 'Centro, $ 1.500, de 18 a 20', retiro: 'Calle Ficticia 123, de 9 a 20', reservaHoras: 48, entrega: 'cualquiera' });
  assert.equal(aj.status, 200);
  assert.deepEqual([aj.datos.reservaHoras, aj.datos.entrega], [48, 'ambos'], 'lo que no se entiende vuelve al valor de siempre');
  // Aceptar, pagar, entregar: cada uno le llega al comprador por su WhatsApp, con la clave del negocio.
  const avisos = [];
  for (const estado of ['aceptado', 'pagado', 'entregado']) {
    const antes = enviados.length;
    const r = await pedir('duena@example.com', 'POST', `/api/n/${a.id}/pedidos/1`, { estado, horas: 24 });
    assert.equal(r.status, 200, JSON.stringify(r.datos));
    assert.equal(r.datos.estado, estado);
    assert.equal(r.datos.aviso, true);
    const e = enviados.slice(antes).find((x) => x.url.endsWith('/sendDirectly'));
    assert.equal(e.clave, CLAVE_YC);
    assert.deepEqual([e.body.from, e.body.to], ['+5493410000001', '+5493410000009']);
    avisos.push(textoYC(e.body));
  }
  assert.match(avisos[0], /^¡Listo! Panadería La Espiga aceptó tu pedido N\.º 1\.\nCómo pagar: Transferencia al alias LA\.ESPIGA\.PAN \(ficticio\)\nRetiro: Calle Ficticia 123, de 9 a 20\nCualquier duda/, 'retira en el local: va el retiro, no el envío');
  assert.match(avisos[1], /recibió el pago de tu pedido N\.º 1/);
  assert.match(avisos[2], /figura como entregado/);
  const p = (await pedir('duena@example.com', 'GET', `/api/n/${a.id}/productos`)).datos.productos[0];
  assert.deepEqual([p.stock, p.reservado], [7, 0], 'entregado: el stock bajó de 10 a 7');
  const hist = (await pedir('duena@example.com', 'GET', `/api/n/${a.id}/pedidos/1`)).datos;
  assert.deepEqual(hist.eventos.map((x) => [x.estado, x.quien]).slice(-3), [['aceptado', 'duena@example.com'], ['pagado', 'duena@example.com'], ['entregado', 'duena@example.com']]);
  // ZL-154: después de entregado, la IA lo sabe (y puede nombrar ese total); nunca ve la dirección ni el número.
  await escribir('¿me llegó todo bien?');
  const compras = vio.at(-1).compras;
  assert.match(compras.texto, /^- Pedido N\.º 1 del \d\d\/\d\d · entregado · retira en el local · \[ref p[a-z0-9]+\] 3 × Pan francés · total \$ 7\.500$/);
  assert.ok(compras.montos.includes('7500'));
  assert.doesNotMatch(compras.texto, /Ana|Calle|5493410000009/);
  // Con los pedidos apagados, el asistente responde pero no arma pedidos.
  await pedir('equipo@example.com', 'PUT', `/api/admin/negocios/${a.id}`, { pedidos: false });
  t = await escribir('quiero 3 kilos de pan');
  assert.doesNotMatch(t, /Tu pedido/);
  assert.equal(vio.at(-1).carrito, undefined);
});

test('Instagram (ZL-140): un cliente conectado con la app del estudio desde la app de negocios queda como cliente (nunca responde como Zustro Labs)', async () => {
  const { n, d, a, pedir } = await armar();
  const CTA = '17841400000000088';
  const url = new URL((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/instagram/conectar`)).datos.url);
  assert.equal(url.searchParams.get('client_id'), ENV.IG_APP_ID, 'sin app compartida, la del estudio');
  d.fetch = async (u, o = {}) => {
    const s = String(u);
    if (s.startsWith('https://api.instagram.com/oauth/access_token')) return Response.json({ access_token: 'corto', user_id: CTA });
    if (s.includes('ig_exchange_token')) return Response.json({ access_token: 'largo', expires_in: 5_183_944 });
    if (s.includes('/me?fields=user_id,username')) return Response.json({ user_id: CTA, username: 'somosventro' });
    if (s.includes('/me/subscribed_apps')) return Response.json((o.method ?? 'GET') === 'GET' ? { data: [{ subscribed_fields: ['messages'] }] } : { success: true });
    return Response.json({}, { status: 400 });
  };
  const r = await worker.fetch(new Request(`https://zustrolabs.com/api/instagram/conectar/vuelta?code=c&state=${encodeURIComponent(url.searchParams.get('state'))}`), { ...ENV, IG_CONECTAR_CLAVE: 'clave-link' }, {}, d);
  assert.equal(r.status, 200, await r.text());
  const c = await n.cuentas.get(CTA);
  assert.equal(c.app, ENV.IG_APP_ID);
  assert.equal(c.cliente, true);
  assert.equal(esCliente(ENV, c), true);
  assert.ok((await n.negocios.get(a.id)).cuentas.includes(CTA));
  // La renovación del token conserva la marca.
  await n.cuentas.put(CTA, { ...c, token: 'renovado' });
  assert.equal((await n.cuentas.get(CTA)).cliente, true);
  // Una cuenta conectada con el link viejo del estudio (sin negocio) sigue siendo la del estudio.
  assert.equal(esCliente(ENV, { app: ENV.IG_APP_ID, cliente: false }), false);
});

test('consultas (ZL-146): cada negocio ve las suyas, las mueve de estado y no puede tocar las de otro', async () => {
  const { pedir, a, b, d } = await armar();
  await d.catalogo(a.id).ejecutar('crearConsulta', ['yc:1:2', { tipo: 'consulta', nombre: 'Ana', resumen: 'Torta para el sábado (ficticio).', canal: 'wa' }]);
  const l = (await pedir('duena@example.com', 'GET', `/api/n/${a.id}/consultas`)).datos;
  assert.equal(l.nuevas, 1);
  assert.equal(l.consultas[0].nombre, 'Ana');
  assert.equal((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/consultas/1`, { estado: 'atendiendo' })).datos.estado, 'atendiendo');
  assert.equal((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/consultas/1`, { estado: 'borrada' })).status, 400);
  assert.equal((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/consultas/1`, { estado: 'ganada' }, { sinCabecera: true })).status, 403, 'sin la cabecera del mismo origen no se cambia');
  assert.equal((await pedir('otro@example.com', 'GET', `/api/n/${a.id}/consultas`)).status, 404);
  assert.deepEqual((await pedir('otro@example.com', 'GET', `/api/n/${b.id}/consultas`)).datos.consultas, []);
});

test('consultas (ZL-148): «La atiendo» calla al asistente en esa charla, «Devolver al asistente» lo vuelve a encender; reclamos se resuelven', async () => {
  const { pedir, a, d, n } = await armar();
  const CHARLA = 'yc:5493410000001:5493410000009';
  await n.memoria.put(CHARLA, { idioma: 'es', humanoHasta: 0, nombre: 'Ana' });
  await d.catalogo(a.id).ejecutar('crearConsulta', [CHARLA, { tipo: 'persona', resumen: 'Reclamo (ficticio).', canal: 'wa' }]);
  const r = await pedir('duena@example.com', 'POST', `/api/n/${a.id}/consultas/1`, { estado: 'atendiendo' });
  assert.equal(r.status, 200);
  assert.ok(r.datos.pausaHasta > T0, 'el asistente se calla');
  assert.ok((await n.memoria.get(CHARLA)).humanoHasta > T0);
  const l = (await pedir('duena@example.com', 'GET', `/api/n/${a.id}/consultas`)).datos;
  assert.ok(l.consultas[0].pausaHasta > T0, 'la tarjeta muestra hasta cuándo');
  assert.equal((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/consultas/1/devolver`, {})).status, 200);
  assert.equal((await n.memoria.get(CHARLA)).humanoHasta, 0, 'vuelve el asistente');
  assert.equal((await n.memoria.get(CHARLA)).nombre, 'Ana', 'la memoria de la persona queda');
  assert.equal((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/consultas/1`, { estado: 'resuelta' })).datos.estado, 'resuelta');
  assert.equal((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/consultas/99/devolver`, {})).status, 400, 'una consulta que no es suya no se toca');
  assert.equal((await pedir('otro@example.com', 'POST', `/api/n/${a.id}/consultas/1/devolver`, {})).status, 404);
});

test('alta fácil (ZL-150): formulario, plantillas, web y revisor son del equipo; el negocio ve su semáforo', async () => {
  const { pedir, a, d } = await armar();
  const FICHA_P = readFileSync(new URL('./ficha-prueba.md', import.meta.url), 'utf8');
  assert.equal((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/ficha/campos`, { texto: FICHA_P })).status, 403);
  const c = await pedir('equipo@example.com', 'POST', `/api/n/${a.id}/ficha/campos`, { texto: FICHA_P });
  assert.equal(c.datos.campos.nombre, 'Panadería La Espiga');
  const m = await pedir('equipo@example.com', 'POST', `/api/n/${a.id}/ficha/armar`, { campos: { ...c.datos.campos, objetivo: 'pedidos' } });
  assert.match(m.datos.texto, /- Objetivo: pedidos/);
  assert.equal(m.datos.ok, true);
  assert.equal((await pedir('equipo@example.com', 'GET', `/api/n/${a.id}/ficha/plantillas`)).datos.plantillas.length, 3);
  d.llamarWeb = async () => ({ salida: { nombre: 'Ficticia', trato: 'vos', objetivo: 'consultas', saludo: 'Soy el asistente de Ficticia', menu: [{ titulo: 'Uno', texto: '¿Sí?' }], vender: '', conocimiento: 'x', faq: '', nunca: '', persona: '', horario: '' } });
  const fetchAntes = d.fetch;
  d.fetch = async (url, o) => (String(url).startsWith('https://ficticia.example.com') ? new Response(`<p>${'Página de un negocio ficticio. '.repeat(10)}</p>`, { headers: { 'content-type': 'text/html' } }) : fetchAntes(url, o));
  const w = await pedir('equipo@example.com', 'POST', `/api/n/${a.id}/ficha/web`, { url: 'https://ficticia.example.com' });
  assert.equal(w.status, 200, JSON.stringify(w.datos));
  assert.equal(w.datos.campos.nombre, 'Ficticia');
  const rev = await pedir('equipo@example.com', 'POST', `/api/n/${a.id}/ficha/revisar`, { texto: FICHA_P });
  assert.equal(rev.status, 200);
  assert.ok(rev.datos.conflictos.some((x) => /Objetivo/.test(x.texto)));
  assert.equal(rev.datos.charlas.length, 7);
  assert.ok(rev.datos.charlas.every((x) => typeof x.ok === 'boolean' && Array.isArray(x.respuestas)));
  const est = await pedir('duena@example.com', 'GET', `/api/n/${a.id}/estado`);
  assert.equal(est.status, 200);
  assert.equal(typeof est.datos.verde, 'boolean');
  assert.equal(est.datos.charla, null, 'el semáforo del negocio no gasta IA');
  assert.ok(est.datos.controles.some((x) => x.id === 'ficha'));
});

test('avisos y números (ZL-151): el negocio suscribe su celular y ve los números de la semana', async () => {
  const { pedir, a, d, n } = await armar();
  const clave = await pedir('duena@example.com', 'GET', `/api/n/${a.id}/push`);
  assert.equal(clave.status, 200);
  assert.match(clave.datos.clave, /^[A-Za-z0-9_-]{80,90}$/);
  assert.equal((await pedir('duena@example.com', 'GET', `/api/n/${a.id}/push`)).datos.clave, clave.datos.clave, 'la misma clave siempre');
  assert.equal((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/push`, { suscripcion: { endpoint: 'http://mal' } })).status, 400);
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } };
  assert.equal((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/push`, { suscripcion: sub })).datos.celulares, 1);
  assert.equal((await n.negocios.suscripcionesPush(a.id))[0].email, 'duena@example.com');
  await n.negocios.sumarMetrica(a.id, 'charlas');
  await d.catalogo(a.id).ejecutar('crearConsulta', ['yc:1:2', { tipo: 'consulta', nombre: 'Ana' }]);
  await d.catalogo(a.id).ejecutar('cambiarConsulta', [1, 'ganada']);
  const num = (await pedir('duena@example.com', 'GET', `/api/n/${a.id}/numeros`)).datos;
  assert.deepEqual([num.dias, num.charlas, num.consultas, num.ganadas, num.pedidos], [7, 1, 1, 1, 0]);
  for (const r of ['/sw.js', '/manifest.webmanifest', '/icono.svg']) assert.equal((await pedir('duena@example.com', 'GET', r)).status, 200, r);
});

test('reportes (ZL-152): cada mensaje cuenta con la hora del negocio; el reporte se ve y se baja en Excel', async () => {
  const { pedir, a, d, n } = await armar();
  await pedir('duena@example.com', 'PUT', `/api/n/${a.id}/ajustes`, { zona: 'Europe/Zagreb' });
  assert.equal((await n.negocios.get(a.id)).ajustes.zona, 'Europe/Zagreb');
  assert.equal((await pedir('duena@example.com', 'PUT', `/api/n/${a.id}/ajustes`, { zona: 'Marte/Olimpo' })).datos.zona, 'America/Argentina/Buenos_Aires', 'una zona que no está en la lista vuelve a la de siempre');
  const hoy = new Date(T0).toISOString().slice(0, 10);
  await n.negocios.sumarMensaje(a.id, { dia: hoy, hora: 19, canal: 'wa', n: 3 });
  await n.negocios.sumarMensaje(a.id, { dia: hoy, hora: 10, canal: 'ig' });
  await d.catalogo(a.id).ejecutar('crearConsulta', ['yc:1:2', { tipo: 'consulta', nombre: 'Ana' }]);
  const r = await pedir('duena@example.com', 'GET', `/api/n/${a.id}/reporte?periodo=semana`);
  assert.equal(r.status, 200);
  assert.equal(r.datos.resumen.mensajes, 4);
  assert.deepEqual(r.datos.resumen.canales, { whatsapp: 3, instagram: 1 });
  assert.equal(r.datos.porHora[19], 3);
  assert.deepEqual(r.datos.horasPico, [19, 10]);
  assert.equal(r.datos.resumen.consultas, 1);
  const x = await pedir('duena@example.com', 'GET', `/api/n/${a.id}/reporte?periodo=mes&formato=xlsx`);
  assert.equal(x.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.match(x.headers.get('content-disposition'), /^attachment; filename="reporte-mes-\d{4}-\d{2}-01-al-\d{4}-\d{2}-\d{2}\.xlsx"$/);
  assert.deepEqual([...new Uint8Array(x.datos).slice(0, 2)], [0x50, 0x4b]);
  assert.equal((await pedir('otro@example.com', 'GET', `/api/n/${a.id}/reporte`)).status, 404, 'el de otro negocio, no');
});

test('ZL-157: el pedido pendiente espera al dueño; pasadas las 24 h el aviso queda guardado, la app da el mensaje listo y el comprador lo recibe al volver a escribir; con un pedido abierto, una foto va al dueño', async () => {
  const { d, a, pedir: pedirT0, enviados } = await armar();
  // La sesión de Access vale una hora: en este test pasan días.
  const pedir = (email, metodo, ruta, cuerpo) => pedirT0(email, metodo, ruta, cuerpo, { token: { exp: Math.floor(d.now / 1000) + 3600 } });
  const FICHA = readFileSync(new URL('./ficha-prueba.md', import.meta.url), 'utf8');
  await d.negocios.guardarFicha(a.id, { texto: FICHA, activa: true });
  assert.equal((await pedir('equipo@example.com', 'PUT', `/api/admin/negocios/${a.id}`, { canales: { instagram: true, whatsapp: true }, pedidos: true })).status, 200);
  await pedir('duena@example.com', 'POST', `/api/n/${a.id}/productos`, { nombre: 'Pan francés', precio: 2500, stock: 10 });
  await pedir('duena@example.com', 'POST', `/api/n/${a.id}/whatsapp`, { numero: '+5493410000001', apiKey: CLAVE_YC });
  const clave = /\/ycloud\/([0-9a-f]{24})$/.exec(enviados.find((e) => e.url.endsWith('/webhookEndpoints')).body.url)[1];
  const ia = [];
  d.preguntarNegocio = (f, cat) => async (texto, idioma, opts = {}) => {
    ia.push(texto);
    const c = await cat(texto, { refs: opts.carrito !== undefined });
    const ref = /\[ref (p[a-z0-9]+)\] Pan francés/.exec(c.texto)?.[1];
    return { respuesta: 'Sí, decime.', persona: false, fuera_de_tema: false, vacia: false, notas: [], ...(/pan/.test(texto) && { pedido: { cambia: true, items: [{ ref, cantidad: 3 }] } }) };
  };
  let n = 0;
  const llega = async (mensaje) => {
    const t = new Date(d.now).toISOString();
    const cuerpo = JSON.stringify({ id: `ev${++n}`, type: 'whatsapp.inbound_message.received', createTime: t, whatsappInboundMessage: { id: `m${n}`, wamid: `w${n}`, from: '+5493410000009', to: '+5493410000001', sendTime: t, ...mensaje } });
    const antes = enviados.length;
    const r = await worker.fetch(new Request(`https://zustrolabs.com/api/whatsapp/ycloud/${clave}`, { method: 'POST', headers: { 'YCloud-Signature': await firmarYCloud(cuerpo, FIRMA_FALSA, d.now / 1000) }, body: cuerpo }), ENV, {}, d);
    assert.equal(r.status, 200);
    return enviados.slice(antes).filter((e) => e.url.endsWith('/sendDirectly')).map((e) => textoYC(e.body));
  };
  const escribir = async (texto) => (await llega({ type: 'text', text: { body: texto } })).join('\n---\n');
  await escribir('hola');
  await escribir('quiero 3 kilos de pan');
  await escribir('sí');
  await escribir('1');
  assert.match(await escribir('Ana'), /Tu pedido N\.º 1 quedó registrado/);
  // Tres días después sigue pendiente, con los productos reservados.
  d.now = T0 + 3 * 24 * 3600_000;
  let lista = (await pedir('duena@example.com', 'GET', `/api/n/${a.id}/pedidos`)).datos;
  assert.equal(lista.pedidos[0].estado, 'pendiente');
  assert.equal(lista.pedidos[0].vence, null);
  // Lo acepta: pasaron más de 24 h, así que ni se intenta mandar (Meta lo rechazaría sin avisarnos).
  const antes = enviados.length;
  const r = await pedir('duena@example.com', 'POST', `/api/n/${a.id}/pedidos/1`, { estado: 'aceptado', horas: 48 });
  assert.equal(r.status, 200);
  assert.ok(!enviados.slice(antes).some((e) => e.url.endsWith('/sendDirectly')));
  assert.equal(r.datos.aviso.pendiente, true);
  assert.equal(r.datos.aviso.fuera24h, true);
  assert.match(r.datos.aviso.enlace, /^https:\/\/wa\.me\/5493410000009\?text=/);
  assert.match(decodeURIComponent(r.datos.aviso.enlace.split('?text=')[1]), /^¡Listo! Panadería La Espiga aceptó tu pedido N\.º 1\./);
  // La tarjeta lo sigue mostrando aunque se recargue la app.
  lista = (await pedir('duena@example.com', 'GET', `/api/n/${a.id}/pedidos`)).datos;
  assert.match(lista.pedidos[0].avisoPendiente.texto, /aceptó tu pedido N\.º 1/);
  // El comprador vuelve a escribir: primero se entera de su pedido, en el mismo mensaje de la respuesta.
  const t = await escribir('che, ¿y mi pedido?');
  assert.match(t, /^¡Listo! Panadería La Espiga aceptó tu pedido N\.º 1\.[\s\S]*\n\nSí, decime\.$/);
  assert.equal((await pedir('duena@example.com', 'GET', `/api/n/${a.id}/pedidos`)).datos.pedidos[0].avisoPendiente, undefined, 'ya le llegó');
  // Dentro de las 24 h, el aviso sale solo.
  const pago = await pedir('duena@example.com', 'POST', `/api/n/${a.id}/pedidos/1`, { estado: 'pagado' });
  assert.equal(pago.datos.aviso, true);
  // Con el pedido abierto, una foto (el comprobante) no la ve la IA ni se contesta: es para el dueño.
  const consultasIa = ia.length;
  assert.deepEqual(await llega({ type: 'image', image: { id: 'img1' } }), []);
  assert.equal(ia.length, consultasIa);
  // Pasadas otras 24 h, «Ya se lo mandé» borra el aviso guardado.
  d.now += 25 * 3600_000;
  const ent = await pedir('duena@example.com', 'POST', `/api/n/${a.id}/pedidos/1`, { estado: 'entregado' });
  assert.equal(ent.datos.aviso.pendiente, true);
  assert.equal((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/pedidos/1/avisado`, {})).status, 200);
  assert.equal((await pedir('duena@example.com', 'GET', `/api/n/${a.id}/pedidos`)).datos.pedidos[0].avisoPendiente, undefined);
  // Sin pedido abierto, una foto vuelve a recibir «solo leo mensajes de texto».
  const foto = await llega({ type: 'image', image: { id: 'img2' } });
  assert.equal(foto.length, 1);
  assert.match(foto[0], /solo leo mensajes de texto/);
  // ZL-158: la app cuenta cada mensaje que mandó el sistema por WhatsApp este mes (Meta cobra pasando los 1.000).
  const mandados = enviados.filter((e) => e.url.endsWith('/sendDirectly')).length;
  const mes = (await pedir('duena@example.com', 'GET', `/api/n/${a.id}/numeros`)).datos.whatsappMes;
  assert.deepEqual([mes.enviados, mes.gratis, mes.aviso], [mandados, 1000, 800]);
  assert.ok(mandados >= 8);
});

test('ZL-159: roles, pausa con mensaje de ausencia (una vez por persona), aviso del día en la información del asistente y charla de prueba del dueño con tope', async () => {
  const { d, a, pedir, enviados } = await armar();
  const FICHA = readFileSync(new URL('./ficha-prueba.md', import.meta.url), 'utf8');
  await d.negocios.guardarFicha(a.id, { texto: FICHA, activa: true });
  // El empleado: ve pedidos y productos, no configura.
  assert.equal((await pedir('equipo@example.com', 'PUT', `/api/admin/negocios/${a.id}`, { empleados: ['empleado@example.com'], canales: { instagram: true, whatsapp: true } })).status, 200);
  assert.equal((await pedir('empleado@example.com', 'GET', `/api/n/${a.id}`)).datos.negocio.rol, 'empleado');
  assert.equal((await pedir('duena@example.com', 'GET', `/api/n/${a.id}`)).datos.negocio.rol, 'dueño');
  assert.equal((await pedir('empleado@example.com', 'GET', `/api/n/${a.id}/pedidos`)).status, 200);
  for (const [m, r, c] of [['PUT', '/ajustes', { pago: 'x' }], ['PUT', '/asistente', { pausa: null }], ['POST', '/whatsapp', { numero: '+5493410000001', apiKey: CLAVE_YC }], ['DELETE', `/instagram/${CUENTA_A}`]]) {
    const x = await pedir('empleado@example.com', m, `/api/n/${a.id}${r}`, c);
    assert.equal(x.status, 403, `${m} ${r}`);
    assert.equal(x.datos.error, 'eso lo cambia el dueño del negocio');
  }
  assert.equal((await pedir('equipo@example.com', 'PUT', `/api/admin/negocios/${a.id}`, { empleados: ['duena@example.com', 'empleado@example.com'] })).datos.error, 'tiene que quedar al menos un dueño');
  // Aviso del día: entra en lo que sabe el asistente mientras está vigente.
  const vio = [];
  d.preguntarNegocio = (f) => async (texto) => (vio.push(f.conocimiento), { respuesta: 'Te cuento.', persona: false, fuera_de_tema: false, vacia: false, notas: [] });
  const av = await pedir('duena@example.com', 'PUT', `/api/n/${a.id}/asistente`, { avisoDia: { texto: 'Hoy no hay medialunas. <b>', hasta: T0 + 3600_000 } });
  assert.equal(av.status, 200);
  assert.equal(av.datos.avisoDia.texto, 'Hoy no hay medialunas.', 'sin marcas');
  await pedir('equipo@example.com', 'PUT', `/api/admin/negocios/${a.id}`, { cuentas: [CUENTA_A] });
  let n = 0;
  const ig = async (texto, quien = '17841400000000101') => {
    const cuerpo = JSON.stringify({ object: 'instagram', entry: [{ id: CUENTA_A, time: T0, messaging: [{ sender: { id: quien }, recipient: { id: CUENTA_A }, timestamp: T0, message: { mid: `z${++n}`, text: texto } }] }] });
    const antes = enviados.length;
    await worker.fetch(new Request('https://zustrolabs.com/api/instagram', { method: 'POST', headers: { 'x-hub-signature-256': await firmar(cuerpo, APP.secreto) }, body: cuerpo }), ENV, {}, d);
    return enviados.slice(antes).filter((e) => /\/messages$/.test(e.url)).map((e) => e.body.message.text);
  };
  await ig('hola');
  await ig('¿tienen medialunas?');
  assert.match(vio.at(-1), /## Aviso de hoy \(lo carga el negocio, manda sobre lo de arriba\)\nHoy no hay medialunas\./);
  // Pausa: a cada persona se le dice UNA vez cuándo vuelven (con el mensaje del dueño); la IA no responde.
  const p = await pedir('duena@example.com', 'PUT', `/api/n/${a.id}/asistente`, { pausa: { hasta: T0 + 2 * 86_400_000, mensaje: 'Estamos de vacaciones 🌴' } });
  assert.equal(p.status, 200);
  const consultas = vio.length;
  const t1 = await ig('hola, ¿están?', '17841400000000102');
  assert.equal(t1.length, 1);
  assert.match(t1[0], /^Estamos de vacaciones 🌴\n\n\(Volvemos el .+ y te respondemos apenas estemos de vuelta\.\)$/);
  assert.deepEqual(await ig('¿hola?', '17841400000000102'), [], 'la segunda vez, nada');
  assert.equal(vio.length, consultas, 'sin IA durante la pausa');
  // Encendido otra vez: responde la IA.
  await pedir('duena@example.com', 'PUT', `/api/n/${a.id}/asistente`, { pausa: null });
  assert.equal((await ig('¿y facturas?', '17841400000000102')).length, 1);
  assert.equal(vio.length, consultas + 1);
  // Charla de prueba del dueño: con la ficha guardada, tope por día.
  const pr = await pedir('duena@example.com', 'POST', `/api/n/${a.id}/prueba`, { mensajes: ['hola'] });
  assert.equal(pr.status, 200, JSON.stringify(pr.datos));
  assert.ok(pr.datos.charla[0].respuestas.length);
  assert.equal((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/prueba`, { texto: '# otra ficha', mensajes: [] })).status, 400, 'sin mensajes no; y la ficha no se cambia desde acá');
  for (let i = 0; i < 40; i++) await pedir('duena@example.com', 'POST', `/api/n/${a.id}/prueba`, { mensajes: ['hola'] });
  assert.equal((await pedir('duena@example.com', 'POST', `/api/n/${a.id}/prueba`, { mensajes: ['hola'] })).status, 429);
});

// ——— ZL-160: comentarios de Instagram ———

test('ZL-160: con «Responder comentarios» encendido, una consulta recibe una frase en público y el detalle por privado; la charla sigue sabiendo qué comentó; el reporte lo cuenta', async () => {
  const { d, a, pedir, enviados } = await armar();
  await d.negocios.guardarFicha(a.id, { texto: FICHA, activa: true });
  await pedir('equipo@example.com', 'PUT', `/api/admin/negocios/${a.id}`, { cuentas: [CUENTA_A], empleados: ['empleado@example.com'] });
  const QUIEN = '17841400000000009';
  // Meta: la respuesta pública devuelve su id; el texto de la publicación; el resto, como siempre.
  const publicas = [];
  let rechazar = false;
  const fetch0 = d.fetch;
  d.fetch = async (url, o) => {
    const u = String(url);
    if (u.endsWith('/replies')) {
      if (rechazar) return Response.json({ error: { code: 10 } }, { status: 400 });
      publicas.push({ url: u, texto: new URLSearchParams(String(o.body)).get('message'), auth: o.headers.authorization });
      return Response.json({ id: `1800000000000${publicas.length}888` });
    }
    if (u.includes('?fields=caption')) return Response.json({ caption: 'Pan francés recién horneado' });
    return fetch0(url, o);
  };
  const ia = [];
  let salida = { tipo: 'consulta', persona: false, publica: '¡Hola! Sale $2.500 el kg, te escribimos por privado.', privada: 'Hola, te escribo por tu comentario: el pan francés sale $2.500 el kg. ¿Te guardo uno para hoy?', idioma: 'es' };
  d.preguntarComentario = (f, cat) => async (texto, op) => {
    ia.push({ negocio: f.nombre, texto, ...op, catalogo: cat ? 'sí' : 'no' });
    const { controlarComentario } = await import('../src/comentarios.js');
    return { ...controlarComentario(salida, { ...f, permitidos: { ...f.permitidos, montos: [...f.permitidos.montos, '2500'] } }, op.modo), uso: { entrada: 1, salida: 1 } };
  };
  let n = 0;
  const comentar = async (texto, o = {}) => {
    const id = o.id ?? `18000000000000${String(++n).padStart(3, '0')}`;
    const cuerpo = JSON.stringify({ object: 'instagram', entry: [{ id: CUENTA_A, time: T0 / 1000, changes: [{ field: 'comments', value: { from: { id: o.quien ?? QUIEN, username: 'ana.prueba' }, media: { id: '18000000000000001', media_product_type: 'FEED' }, id, text: texto } }] }] });
    const antesP = publicas.length, antesM = enviados.length;
    const r = await worker.fetch(new Request('https://zustrolabs.com/api/instagram', { method: 'POST', headers: { 'x-hub-signature-256': await firmar(cuerpo, APP.secreto) }, body: cuerpo }), ENV, {}, d);
    assert.equal(r.status, 200);
    return { id, publicas: publicas.slice(antesP), privadas: enviados.slice(antesM).filter((e) => /\/me\/messages$/.test(e.url)).map((e) => e.body) };
  };

  // Apagado (como arranca): ni IA ni respuestas.
  assert.deepEqual((await pedir('duena@example.com', 'GET', `/api/n/${a.id}/instagram`)).datos.comentarios, { activo: false, modo: 'publico_privado' });
  let x = await comentar('¿Cuánto sale el pan francés?');
  assert.deepEqual([x.publicas, x.privadas, ia.length], [[], [], 0]);

  // Lo enciende el dueño (un empleado no; un modo inventado tampoco).
  assert.equal((await pedir('empleado@example.com', 'PUT', `/api/n/${a.id}/instagram/comentarios`, { activo: true })).status, 403);
  assert.equal((await pedir('duena@example.com', 'PUT', `/api/n/${a.id}/instagram/comentarios`, { activo: true, modo: 'gritar' })).status, 400);
  const on = await pedir('duena@example.com', 'PUT', `/api/n/${a.id}/instagram/comentarios`, { activo: true });
  assert.deepEqual(on.datos.comentarios, { activo: true, modo: 'publico_privado' });
  assert.equal((await pedir('empleado@example.com', 'GET', `/api/n/${a.id}`)).datos.negocio.comentarios.activo, true);

  // Una consulta: frase corta en público y detalle por privado, con la ficha, el catálogo y el texto de la publicación.
  x = await comentar('¿Cuánto sale el pan francés?');
  assert.deepEqual(ia.at(-1), { negocio: 'Panadería La Espiga', texto: '¿Cuánto sale el pan francés?', publicacion: 'Pan francés recién horneado', modo: 'publico_privado', catalogo: 'sí' });
  assert.equal(x.publicas.length, 1);
  assert.match(x.publicas[0].url, new RegExp(`/${x.id}/replies$`));
  assert.equal(x.publicas[0].auth, 'Bearer tok-a', 'con el token de la cuenta del negocio');
  assert.match(x.publicas[0].texto, /\$2\.500.*privado/);
  assert.deepEqual(x.privadas, [{ recipient: { comment_id: x.id }, message: { text: salida.privada } }]);
  // Si contesta por privado, el asistente sabe qué comentó y qué le dijo.
  const mem = await d.memoria.get(`ig:${CUENTA_A}.${QUIEN}`);
  assert.deepEqual(mem.hist.map((m) => m.r), ['u', 'a']);
  assert.match(mem.hist[0].t, /Comentario en una publicación.*Cuánto sale el pan francés/);
  assert.equal(mem.hist[1].t, salida.privada);
  const hist = [];
  d.preguntarNegocio = () => async (texto, idioma, op) => (hist.push(op?.historial ?? []), { respuesta: 'Dale, te lo guardo.', persona: false, fuera_de_tema: false, vacia: false, notas: [] });
  const dm = JSON.stringify({ object: 'instagram', entry: [{ id: CUENTA_A, time: T0, messaging: [{ sender: { id: QUIEN }, recipient: { id: CUENTA_A }, timestamp: T0, message: { mid: 'dm1', text: 'Sí, guardame uno' } }] }] });
  await worker.fetch(new Request('https://zustrolabs.com/api/instagram', { method: 'POST', headers: { 'x-hub-signature-256': await firmar(dm, APP.secreto) }, body: dm }), ENV, {}, d);
  assert.ok(hist.at(-1)?.some((m) => /Cuánto sale el pan francés/.test(m.t)), 'la IA de la charla recibe el comentario');

  // El mismo comentario otra vez (Meta reintenta): una sola respuesta. Emojis o una mención a un amigo: ni IA.
  const antesIa = ia.length;
  assert.deepEqual((await comentar('¿Cuánto sale el pan francés?', { id: x.id })).publicas, []);
  assert.deepEqual((await comentar('😍😍😍')).publicas, []);
  assert.deepEqual((await comentar('@juan.prueba mirá')).publicas, []);
  assert.equal(ia.length, antesIa);

  // Un elogio: gracias en público, nada por privado. Un reclamo: nada en ningún lado.
  salida = { tipo: 'elogio', persona: false, publica: '¡Gracias por elegirnos!', privada: '', idioma: 'es' };
  x = await comentar('Las mejores medialunas');
  assert.deepEqual([x.publicas.map((p) => p.texto), x.privadas], [['¡Gracias por elegirnos!'], []]);
  salida = { tipo: 'reclamo', persona: false, publica: 'Perdón', privada: 'Perdón', idioma: 'es' };
  x = await comentar('Me vendieron pan duro');
  assert.deepEqual([x.publicas, x.privadas], [[], []]);

  // Solo por privado.
  await pedir('duena@example.com', 'PUT', `/api/n/${a.id}/instagram/comentarios`, { modo: 'privado' });
  salida = { tipo: 'consulta', persona: false, publica: 'Sí', privada: 'Hola, te escribo por tu comentario: abrimos de 8 a 20. ¿Querés encargar algo?', idioma: 'es' };
  x = await comentar('¿A qué hora abren?', { quien: '17841400000000010' });
  assert.deepEqual([x.publicas.length, x.privadas.length], [0, 1]);

  // El reporte: 3 comentarios respondidos (la consulta, el elogio y el de solo privado).
  const rep = await pedir('duena@example.com', 'GET', `/api/n/${a.id}/reporte?periodo=dia`);
  assert.equal(rep.datos.resumen.comentarios, 3);

  // Una cuenta conectada antes del permiso: Meta rechaza, la cuenta queda marcada, la app y el semáforo lo dicen.
  await pedir('duena@example.com', 'PUT', `/api/n/${a.id}/instagram/comentarios`, { modo: 'publico_privado' });
  rechazar = true;
  x = await comentar('¿Hacen envíos?', { quien: '17841400000000011' });
  assert.deepEqual([x.publicas.length, x.privadas.length], [0, 0], 'sin permiso no se insiste por privado');
  assert.equal((await pedir('duena@example.com', 'GET', `/api/n/${a.id}/instagram`)).datos.cuentas[0].permisoComentarios, false);
  const est = (await pedir('duena@example.com', 'GET', `/api/n/${a.id}/estado`)).datos;
  assert.ok(est.controles.some((c) => c.id === 'comentarios' && /no dio el permiso/.test(c.texto)), JSON.stringify(est.controles));
  rechazar = false;

  // En pausa no responde comentarios.
  await pedir('duena@example.com', 'PUT', `/api/n/${a.id}/asistente`, { pausa: { hasta: T0 + 3600_000 } });
  const antesPausa = ia.length;
  assert.deepEqual((await comentar('¿Tienen facturas?', { quien: '17841400000000012' })).publicas, []);
  assert.equal(ia.length, antesPausa);
});
