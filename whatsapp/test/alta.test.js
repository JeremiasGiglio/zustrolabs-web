// ZL-138: lo que usa el alta automática — el semáforo del negocio, la ficha por negocio y los correos en Access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { adaptadores, almacenPrueba, crearAtencion } from '../src/atencion.js';
import { agregarAAcceso, correosEnAcceso } from '../src/acceso.js';
import { verificarNegocio } from '../src/verificar.js';
import { firmarYCloud } from '../src/ycloud.js';

const FICHA = readFileSync(new URL('./ficha-prueba.md', import.meta.url), 'utf8');
const T0 = 1_792_000_000_000;
const DIA = 86_400_000;
const limiteOk = { limit: async () => ({ success: true }) };
const ENV = { IG_APP_ID: '1000000000000001', IG_APP_SECRET: 'secreto-ig-prueba', IG_ADMIN_CLAVE: 'clave-admin-prueba', LIMITE: limiteOk, LIMITE_GLOBAL: limiteOk };
const CF_ENV = { CF_API_TOKEN: 'token-de-prueba', CF_ACCOUNT_ID: 'cuenta1' };
const CLAVE_API = 'clave-api-ycloud-de-prueba-123';
const FIRMA = 'firma-del-webhook';

// ——— El semáforo, solo ———

const base = () => ({
  negocio: { id: 'n1', nombre: 'La Espiga', emails: ['duena@example.com'], canales: { instagram: true, whatsapp: true } },
  ficha: { tiene: true, valida: true, activa: true, errores: [], pendientes: [] },
  cuentas: [{ id: '17841400000000001', username: 'laespiga', conectada: true, venceEnDias: 50 }],
  numeros: [{ clave: 'a'.repeat(24), numero: '+5493410000001', ecos: true, ultimo: T0 - 3600_000, webhook: { url: `https://zustrolabs.com/api/whatsapp/ycloud/${'a'.repeat(24)}` } }],
  productos: { total: 9, activos: 9, agotados: 1 },
  acceso: new Set(['duena@example.com']),
  charla: [{ mensaje: 'hola', respuestas: ['¡Hola!'], que: 'presentacion' }, { mensaje: '¿Qué venden?', respuestas: ['Pan.'], que: 'ia' }],
  now: T0,
});
const estados = (r) => Object.fromEntries(r.controles.map((c) => [c.id, c.estado]));

test('semáforo: con todo bien da verde', () => {
  const r = verificarNegocio(base());
  assert.equal(r.verde, true, JSON.stringify(r.controles.filter((c) => c.estado !== 'ok')));
  assert.ok(r.controles.every((c) => c.estado === 'ok'));
});

test('semáforo: cada falla real que ya tuvimos queda en rojo con qué hacer', () => {
  // El webhook a negocios.zustrolabs.com (10/11/2026): YCloud recibía el inicio de sesión de Access.
  let d = base();
  d.numeros[0].webhook = { url: 'https://negocios.zustrolabs.com/api/whatsapp/ycloud/x' };
  let r = verificarNegocio(d);
  assert.equal(r.verde, false);
  const w = r.controles.find((c) => c.id === 'whatsapp');
  assert.match(w.texto, /negocios\.zustrolabs\.com/);
  assert.match(w.arreglo, /https:\/\/zustrolabs\.com\/api\/whatsapp\/ycloud\/a{24}/);
  // El correo que no está en Access (al cliente no le llega el código).
  d = base(); d.acceso = new Set();
  assert.equal(estados(verificarNegocio(d)).acceso, 'mal');
  // La ficha apagada, con [COMPLETAR], o sin ficha.
  d = base(); d.ficha.activa = false; assert.equal(estados(verificarNegocio(d)).ficha, 'mal');
  d = base(); d.ficha.pendientes = ['Horarios']; assert.match(verificarNegocio(d).controles.find((c) => c.id === 'ficha').texto, /Horarios/);
  d = base(); d.ficha = { tiene: false }; assert.equal(verificarNegocio(d).verde, false);
  // Un canal encendido sin nada conectado.
  d = base(); d.cuentas = []; assert.equal(estados(verificarNegocio(d)).instagram, 'mal');
  d = base(); d.numeros = []; assert.equal(estados(verificarNegocio(d)).whatsapp, 'mal');
  // La charla de prueba con la IA caída.
  d = base(); d.charla[1] = { mensaje: '¿Qué venden?', respuestas: ['Perdón, tuve un problema'], que: 'error' };
  assert.equal(estados(verificarNegocio(d)).charla, 'mal');
});

test('semáforo: lo que no frena el alta queda en amarillo', () => {
  let d = base(); d.cuentas[0].venceEnDias = 7;
  let r = verificarNegocio(d);
  assert.equal(r.verde, true); assert.equal(estados(r).instagram, 'aviso');
  d = base(); d.numeros[0].ultimo = null; assert.match(verificarNegocio(d).controles.find((c) => c.id === 'whatsapp').texto, /ningún mensaje/);
  d = base(); d.numeros[0].ultimo = T0 - 20 * DIA; assert.match(verificarNegocio(d).controles.find((c) => c.id === 'whatsapp').arreglo, /14 días/);
  d = base(); d.numeros[0].ecos = false; assert.ok(verificarNegocio(d).controles.some((c) => c.id === 'whatsapp' && /ecos/.test(c.texto)));
  d = base(); d.productos = { total: 0, activos: 0, agotados: 0 }; assert.equal(estados(verificarNegocio(d)).productos, 'aviso');
  d = base(); d.acceso = null; r = verificarNegocio(d); assert.equal(estados(r).acceso, 'aviso'); assert.equal(r.verde, true);
  d = base(); d.negocio.canales.whatsapp = false; assert.ok(verificarNegocio(d).controles.some((c) => c.id === 'whatsapp' && c.estado === 'aviso'));
});

// ——— Access por la API de Cloudflare ———

function cloudflare({ reusable = false, conPolitica = true, status = 200 } = {}) {
  const pedidos = [];
  let politica = { id: 'pol1', name: 'Negocios y equipo', decision: 'allow', include: [{ email: { email: 'equipo@example.com' } }], exclude: [], require: [], precedence: 1, created_at: 'x', ...(reusable && { reusable: true }) };
  const fetch = async (url, o = {}) => {
    const u = String(url);
    pedidos.push({ url: u, metodo: o.method ?? 'GET', auth: o.headers?.authorization, body: o.body ? JSON.parse(o.body) : null });
    if (status !== 200) return Response.json({ success: false, errors: [{ message: 'Authentication error' }] }, { status });
    if (u.endsWith('/access/apps?per_page=100')) return Response.json({ success: true, result: [{ id: 'otra', domain: 'equipo.zustrolabs.com', policies: [] }, { id: 'app1', domain: 'negocios.zustrolabs.com', policies: conPolitica ? [{ id: 'pol1', ...(reusable && { reusable: true }) }] : [] }] });
    if (u.endsWith('/policies/pol1') && (o.method ?? 'GET') === 'GET') return Response.json({ success: true, result: politica });
    if (u.endsWith('/policies/pol1') && o.method === 'PUT') { politica = { ...politica, ...JSON.parse(o.body) }; return Response.json({ success: true, result: politica }); }
    return Response.json({ success: false, errors: [{ message: 'no' }] }, { status: 404 });
  };
  return { fetch, pedidos, politica: () => politica };
}

test('Access: agrega solo los correos que faltan, a la política «Allow» de la app de negocios, sin tocar el resto', async () => {
  for (const reusable of [false, true]) {
    const cf = cloudflare({ reusable });
    const r = await agregarAAcceso(CF_ENV, cf.fetch, 'negocios.zustrolabs.com', ['Duena@Example.com', 'equipo@example.com', 'no es correo']);
    assert.deepEqual(r, { ok: true, agregados: ['duena@example.com'], ya: ['equipo@example.com'] });
    const put = cf.pedidos.find((p) => p.metodo === 'PUT');
    assert.equal(put.url, reusable ? 'https://api.cloudflare.com/client/v4/accounts/cuenta1/access/policies/pol1' : 'https://api.cloudflare.com/client/v4/accounts/cuenta1/access/apps/app1/policies/pol1');
    assert.equal(put.auth, 'Bearer token-de-prueba');
    assert.deepEqual(put.body.include, [{ email: { email: 'equipo@example.com' } }, { email: { email: 'duena@example.com' } }], 'no saca a nadie');
    assert.equal(put.body.decision, 'allow');
    assert.equal(put.body.created_at, undefined, 'no reenvía lo que pone Cloudflare');
    assert.equal(put.body.precedence, reusable ? undefined : 1);
    assert.deepEqual([...(await correosEnAcceso(CF_ENV, cf.fetch, 'negocios.zustrolabs.com'))].sort(), ['duena@example.com', 'equipo@example.com']);
    // La segunda vez no hace falta guardar nada.
    const n = cf.pedidos.length;
    assert.deepEqual(await agregarAAcceso(CF_ENV, cf.fetch, 'negocios.zustrolabs.com', ['duena@example.com']), { ok: true, agregados: [], ya: ['duena@example.com'] });
    assert.ok(!cf.pedidos.slice(n).some((p) => p.metodo === 'PUT'));
  }
});

test('Access: sin token, con un token sin permiso o sin política, avisa qué agregar a mano y no tira', async () => {
  assert.deepEqual(await agregarAAcceso({}, async () => assert.fail('no llama'), 'negocios.zustrolabs.com', ['a@example.com']), { ok: false, error: 'sin configurar (CF_API_TOKEN, CF_ACCOUNT_ID)', faltan: ['a@example.com'] });
  let r = await agregarAAcceso(CF_ENV, cloudflare({ status: 403 }).fetch, 'negocios.zustrolabs.com', ['a@example.com']);
  assert.equal(r.ok, false); assert.match(r.error, /permiso de Access/); assert.deepEqual(r.faltan, ['a@example.com']);
  r = await agregarAAcceso(CF_ENV, cloudflare({ conPolitica: false }).fetch, 'negocios.zustrolabs.com', ['a@example.com']);
  assert.match(r.error, /no tiene una política/);
  assert.equal(await correosEnAcceso({}, null, 'negocios.zustrolabs.com'), null);
});

// ——— Por el Worker: lo que llama alta.ps1 ———

async function armar({ env = ENV, cf = null, webhookUrl } = {}) {
  const n = adaptadores(crearAtencion(almacenPrueba()), () => T0);
  let url = webhookUrl;
  const d = {
    ...n, now: T0,
    fetch: async (u, o = {}) => {
      const s = String(u);
      if (cf && s.startsWith('https://api.cloudflare.com/')) return cf.fetch(u, o);
      if (s.endsWith('/webhookEndpoints')) return Response.json({ id: 'we_1', secret: FIRMA });
      if (s.endsWith('/webhookEndpoints/we_1')) return Response.json({ id: 'we_1', url: url ?? JSON.parse('null'), status: 'active' });
      return Response.json({ id: 'y', status: 'accepted' });
    },
    preguntarNegocio: (f) => async () => ({ respuesta: `Respuesta de ${f.nombre}.`, persona: false, fuera_de_tema: false, vacia: false, notas: [] }),
  };
  const admin = async (metodo, ruta, cuerpo) => {
    const r = await worker.fetch(new Request(`https://zustrolabs.com/api/instagram/admin${ruta}`, { method: metodo, headers: { authorization: `Bearer ${ENV.IG_ADMIN_CLAVE}`, 'content-type': 'application/json' }, ...(cuerpo && { body: JSON.stringify(cuerpo) }) }), env, {}, d);
    return { status: r.status, datos: await r.json() };
  };
  return { n, d, admin, setUrl: (x) => (url = x) };
}

test('alta por el Worker: negocio con correos a Access, ficha por negocio (sin Instagram), WhatsApp y semáforo hasta verde', async () => {
  const cf = cloudflare();
  const { admin, setUrl, d } = await armar({ env: { ...ENV, ...CF_ENV }, cf });
  // 1. El negocio: los correos van solos a Access.
  const alta = await admin('POST', '/negocios', { nombre: 'Panadería La Espiga', emails: 'duena@example.com', canales: { instagram: false, whatsapp: true } });
  assert.equal(alta.status, 201);
  assert.deepEqual(alta.datos.acceso.agregados, ['duena@example.com']);
  const id = alta.datos.id;
  // 2. La ficha del negocio, sin ninguna cuenta de Instagram: probar con sus productos, guardar y activar.
  assert.equal((await admin('GET', `/negocios/${id}/ficha`)).status, 404);
  const prueba = await admin('POST', '/ficha/probar', { texto: FICHA, mensajes: ['hola'], negocio: id });
  assert.equal(prueba.status, 200);
  assert.ok(prueba.datos.charla[0].respuestas.length);
  const g = await admin('PUT', `/negocios/${id}/ficha`, { texto: FICHA, activa: true });
  assert.equal(g.status, 200, JSON.stringify(g.datos));
  assert.equal(g.datos.activa, true);
  assert.equal((await admin('GET', `/negocios/${id}/ficha`)).datos.activa, true);
  assert.equal((await admin('PUT', `/negocios/${id}/ficha`, { texto: 'nada' })).status, 400);
  assert.equal((await admin('PUT', '/negocios/noexiste/ficha', { texto: FICHA })).status, 404);
  // 3. Sin número todavía: rojo en WhatsApp, con qué hacer.
  let v = await admin('GET', `/negocios/${id}/verificar`);
  assert.equal(v.status, 200);
  assert.equal(v.datos.verde, false);
  assert.ok(v.datos.controles.some((c) => c.id === 'whatsapp' && c.estado === 'mal' && /Conectar/.test(c.arreglo)));
  assert.ok(v.datos.controles.some((c) => c.id === 'acceso' && c.estado === 'ok'));
  assert.ok(v.datos.controles.some((c) => c.id === 'charla' && c.estado === 'ok'), JSON.stringify(v.datos.charla));
  // 4. Conectado con un webhook que apunta a negocios. (lo que pasó el 10/11): rojo.
  const nu = await admin('POST', '/ycloud', { negocio: id, numero: '+5493410000001', apiKey: CLAVE_API });
  assert.equal(nu.status, 200);
  setUrl(`https://negocios.zustrolabs.com/api/whatsapp/ycloud/${nu.datos.clave}`);
  v = await admin('GET', `/negocios/${id}/verificar`);
  assert.equal(v.datos.verde, false);
  assert.ok(v.datos.controles.some((c) => c.id === 'whatsapp' && /negocios\.zustrolabs\.com/.test(c.texto)));
  assert.doesNotMatch(JSON.stringify(v.datos), /clave-api|firma-del-webhook/, 'el semáforo no muestra secretos');
  // 5. Con la URL bien y un mensaje recibido: verde.
  setUrl(`https://zustrolabs.com/api/whatsapp/ycloud/${nu.datos.clave}`);
  v = await admin('GET', `/negocios/${id}/verificar`);
  assert.equal(v.datos.verde, true, JSON.stringify(v.datos.controles));
  assert.ok(v.datos.controles.some((c) => c.id === 'whatsapp' && c.estado === 'aviso' && /ningún mensaje/.test(c.texto)));
  const cuerpo = JSON.stringify({ id: 'ev1', type: 'whatsapp.inbound_message.received', createTime: new Date(T0).toISOString(), whatsappInboundMessage: { id: 'm1', wamid: 'w1', from: '+5493410000009', to: '+5493410000001', type: 'text', text: { body: 'hola' }, sendTime: new Date(T0).toISOString() } });
  await worker.fetch(new Request(`https://zustrolabs.com/api/whatsapp/ycloud/${nu.datos.clave}`, { method: 'POST', headers: { 'YCloud-Signature': await firmarYCloud(cuerpo, FIRMA, T0 / 1000) }, body: cuerpo }), ENV, {}, d);
  v = await admin('GET', `/negocios/${id}/verificar`);
  assert.ok(v.datos.controles.some((c) => c.id === 'whatsapp' && c.estado === 'ok'), JSON.stringify(v.datos.controles));
  assert.equal((await admin('GET', '/negocios/noexiste/verificar')).status, 404);
});

test('alta por el Worker: sin token de Cloudflare el negocio se guarda igual y dice qué correos agregar a mano', async () => {
  const { admin } = await armar();
  const alta = await admin('POST', '/negocios', { nombre: 'Otra', emails: 'a@example.com' });
  assert.equal(alta.status, 201);
  assert.equal(alta.datos.acceso.ok, false);
  assert.deepEqual(alta.datos.acceso.faltan, ['a@example.com']);
  const cambio = await admin('PUT', `/negocios/${alta.datos.id}`, { canales: { instagram: true, whatsapp: false } });
  assert.equal(cambio.datos.acceso, null, 'sin cambiar correos no toca Access');
});

test('alta por el Worker: el link de «Conectar Instagram» para mandarle al cliente lleva la app compartida y el negocio', async () => {
  const { n, admin } = await armar();
  const alta = await admin('POST', '/negocios', { nombre: 'Con Instagram', emails: 'a@example.com', canales: { instagram: true } });
  assert.equal((await admin('POST', `/negocios/${alta.datos.id}/instagram-link`)).status, 503);
  await n.apps.put('3000000000000003', { secreto: 'secreto-app-compartida', nombre: 'Clientes', compartida: true });
  const r = await admin('POST', `/negocios/${alta.datos.id}/instagram-link`);
  assert.equal(r.status, 200);
  const u = new URL(r.datos.url);
  assert.equal(u.searchParams.get('client_id'), '3000000000000003');
  assert.match(u.searchParams.get('state'), new RegExp(`\\.3000000000000003\\.${alta.datos.id}\\.`));
  assert.equal((await admin('POST', '/negocios/noexiste/instagram-link')).status, 404);
});
