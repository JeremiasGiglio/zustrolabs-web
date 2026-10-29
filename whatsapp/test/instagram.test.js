// Tests del Instagram de Zustro Labs (ZL-111), sin red y sin Cloudflare: Meta, el modelo y el correo se simulan.
// Datos ficticios: ids 1784140000000000x, correos @example.com, tokens «token-…».
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker, { CANALES, mandarA } from '../src/index.js';
import { adaptadores, almacenPrueba, crearAtencion } from '../src/atencion.js';
import { _resetCerts, mailAviso, NOMBRE_CANAL } from '../src/panel.js';
import { CANAL_INSTAGRAM, eligeIdioma, SALUDO_IDIOMA, SALUDO_IDIOMA_TEXTO, TEXTOS } from '../src/textos.js';
import { atender, firmar, msgIdiomas, msgTexto, preguntador, verificarSuscripcion } from '../src/whatsapp.js';
import {
  armarFrom, conectarCuenta, convertir, enviarIg, estadoValido, firmarEstado, leerWebhookIg, mantenerCuentas, MAX_TROZO, nombreDe,
  paginaConectado, partes, PERMISOS, renovarToken, suscribir, trozar, urlAutorizar,
} from '../src/instagram.js';

const CUENTA = '17841400000000001'; // @zustrolabs (ficticio)
const QUIEN = '17841400000000009'; // quien escribe (ficticio)
const FROM = armarFrom(CUENTA, QUIEN);
const T0 = 1_792_000_000_000;
const DIA = 24 * 3600_000;
const limiteOk = { limit: async () => ({ success: true }) };
const ENV = {
  IG_APP_ID: '1000000000000001', IG_APP_SECRET: 'secreto-ig-prueba', IG_VERIFY_TOKEN: 'verificar-ig', IG_CONECTAR_CLAVE: 'clave-link-prueba',
  WHATSAPP_APP_SECRET: 'secreto-wa', WHATSAPP_TOKEN: 'token-wa', WHATSAPP_PHONE_NUMBER_ID: '100000000000001',
  LIMITE: limiteOk, LIMITE_GLOBAL: limiteOk,
  ACCESS_TEAM_DOMAIN: 'equipo-de-prueba.cloudflareaccess.com', ACCESS_AUD: 'aud-de-prueba', PANEL_EMAILS: 'yo@example.com',
};
const controlada = (o = {}) => ({ respuesta: 'Hacemos sitios, apps y agentes de IA.', secciones: [], enlaces: [], escribirnos: false, fuera_de_tema: false, notas: [], ...o });

beforeEach(() => _resetCerts());

function nuevo(reloj = () => T0) {
  const almacen = almacenPrueba();
  return { almacen, ...adaptadores(crearAtencion(almacen), reloj) };
}
/** Memoria con la cuenta @zustrolabs ya conectada. */
async function conCuenta(reloj) {
  const n = nuevo(reloj);
  await n.cuentas.put(CUENTA, { username: 'zustrolabs', token: 'tok-cuenta', vence: T0 + 60 * DIA });
  return n;
}

const aviso = (mensajes, { destino = CUENTA } = {}) => ({
  object: 'instagram',
  entry: [{ id: destino, time: T0, messaging: mensajes.map((m) => ({ sender: { id: QUIEN }, recipient: { id: destino }, timestamp: T0, ...m })) }],
});

// ——— Entrada ———

test('leerWebhookIg: texto, adjuntos, ecos, borrados; la persona se identifica con cuenta y remitente; tiempos en segundos', () => {
  const evs = leerWebhookIg(aviso([
    { message: { mid: 'm1', text: 'Hola' } },
    { message: { mid: 'm2', attachments: [{ type: 'image', payload: { url: 'https://example.com/foto.jpg' } }] } },
    { message: { mid: 'm3', text: 'Mandé esto yo', is_echo: true }, sender: { id: CUENTA }, recipient: { id: QUIEN } },
    { message: { mid: 'm4', text: 'borrado', is_deleted: true } },
    { read: { mid: 'm1' } },
    { reaction: { mid: 'm1', action: 'react', emoji: '❤️' } },
    { message: { mid: 'm5', text: 'otra' }, sender: { id: 'no-es-id' } },
  ]));
  assert.deepEqual(evs.map((e) => [e.kind, e.id]), [['text', 'm1'], ['otro', 'm2']]);
  assert.equal(evs[0].from, FROM);
  assert.equal(evs[0].cuenta, CUENTA);
  assert.equal(evs[0].ts, T0 / 1000);
  assert.deepEqual(partes(FROM), { cuenta: CUENTA, quien: QUIEN });
  assert.equal(partes('5490000000001'), null);
  assert.deepEqual(leerWebhookIg({ object: 'whatsapp_business_account' }), []);
  // La forma del panel de prueba de Meta: entry[].changes[] con field «messages».
  const porCambios = leerWebhookIg({ object: 'instagram', entry: [{ id: CUENTA, time: T0, changes: [{ field: 'messages', value: { sender: { id: QUIEN }, recipient: { id: CUENTA }, timestamp: String(T0), message: { mid: 'c1', text: 'Hola' } } }] }] });
  assert.deepEqual(porCambios.map((e) => [e.kind, e.id, e.from]), [['text', 'c1', FROM]]);
});

test('verificación de Meta para Instagram: usa IG_VERIFY_TOKEN, no el de WhatsApp', () => {
  const u = (q) => new URL(`https://zustrolabs.com/api/instagram?${q}`);
  assert.deepEqual(verificarSuscripcion(u('hub.mode=subscribe&hub.verify_token=verificar-ig&hub.challenge=abc'), ENV, 'IG_VERIFY_TOKEN'), { status: 200, body: 'abc' });
  assert.equal(verificarSuscripcion(u('hub.mode=subscribe&hub.verify_token=verificar-prueba&hub.challenge=abc'), { ...ENV, WHATSAPP_VERIFY_TOKEN: 'verificar-prueba' }, 'IG_VERIFY_TOKEN').status, 403);
  assert.equal(verificarSuscripcion(u('hub.mode=subscribe&hub.verify_token=x&hub.challenge=abc'), {}, 'IG_VERIFY_TOKEN').status, 503);
});

test('elegir idioma escribiendo su nombre (sin botones): los tres, con y sin acento; lo demás no', () => {
  for (const [t, i] of [['Español', 'es'], ['espanol', 'es'], ['castellano', 'es'], ['Hrvatski', 'hr'], ['croata', 'hr'], ['English', 'en'], ['inglés', 'en'], ['english!', 'en']]) assert.equal(eligeIdioma(t), i, t);
  for (const t of ['hola', 'quiero hablar en español', 'en', 'es', '']) assert.equal(eligeIdioma(t), null, t);
  assert.match(SALUDO_IDIOMA_TEXTO, /Escribí: Español · Hrvatski · English/);
  assert.ok(SALUDO_IDIOMA_TEXTO.startsWith(SALUDO_IDIOMA.split('\n\n')[0]));
});

// ——— Lógica (la misma de WhatsApp, con ids de Instagram) ———

test('primer contacto por Instagram: saludo en texto; «Hrvatski» elige el idioma; después responde el asistente', async () => {
  const { memoria } = nuevo();
  const llamadas = [];
  const preguntar = async (texto, idioma) => (llamadas.push({ texto, idioma }), controlada());
  const ev = (o) => ({ id: 'm' + Math.random(), from: FROM, cuenta: CUENTA, ts: T0 / 1000, kind: 'text', ...o });
  const r1 = await atender(ev({ text: 'hola' }), { memoria, preguntar, now: T0 });
  assert.deepEqual(convertir(r1.send[0]), [{ recipient: { id: QUIEN }, message: { text: SALUDO_IDIOMA_TEXTO } }]);
  const r2 = await atender(ev({ text: 'Hrvatski' }), { memoria, preguntar, now: T0 });
  assert.equal(r2.metrica, 'idioma');
  assert.equal(r2.send[0].text.body, TEXTOS.hr.bienvenida);
  assert.equal((await memoria.get(FROM)).idioma, 'hr');
  await atender(ev({ text: 'Što radite?' }), { memoria, preguntar, now: T0 });
  assert.deepEqual(llamadas, [{ texto: 'Što radite?', idioma: 'hr' }]);
  // La memoria de Instagram no se mezcla con un número de WhatsApp ni con la misma persona en otra cuenta.
  assert.equal(await memoria.get(QUIEN), null);
  assert.equal(await memoria.get(armarFrom('17841400000000002', QUIEN)), null);
});

test('foto, sticker o audio por Instagram: «solo leo texto», sin gastar IA', async () => {
  const { memoria } = nuevo();
  await memoria.put(FROM, { idioma: 'en', humanoHasta: 0 });
  let llamadas = 0;
  const r = await atender({ id: 'm1', from: FROM, cuenta: CUENTA, ts: T0 / 1000, kind: 'otro' }, { memoria, preguntar: async () => (llamadas++, controlada()), now: T0 });
  assert.equal(r.send[0].text.body, TEXTOS.en.soloTexto);
  assert.equal(llamadas, 0);
});

// ——— Salida ———

test('trozar: hasta 1000 bytes por mensaje, cortando por párrafos y oraciones', () => {
  assert.deepEqual(trozar(''), []);
  assert.deepEqual(trozar('Hola.'), ['Hola.']);
  const parrafo = 'Una oración de prueba con acentos: áéíóú. '.repeat(12).trim(); // ~600 bytes
  const partesTxt = trozar(`${parrafo}\n\n${parrafo}\n\n${parrafo}`);
  assert.ok(partesTxt.length >= 3);
  for (const p of partesTxt) assert.ok(new TextEncoder().encode(p).length <= MAX_TROZO, `${p.length} caracteres`);
  assert.equal(partesTxt.join('\n\n').replace(/\s+/g, ' '), `${parrafo}\n\n${parrafo}\n\n${parrafo}`.replace(/\s+/g, ' '), 'no pierde texto');
  const larga = 'x'.repeat(2500);
  assert.ok(trozar(larga).every((p) => p.length <= MAX_TROZO) && trozar(larga).join('').length === 2500);
});

test('convertir: texto → pedido de Instagram al remitente; los botones de idioma → el saludo en texto', () => {
  assert.deepEqual(convertir(msgTexto(FROM, 'Hola')), [{ recipient: { id: QUIEN }, message: { text: 'Hola' } }]);
  assert.equal(convertir(msgIdiomas(FROM))[0].message.text, SALUDO_IDIOMA_TEXTO);
});

test('enviarIg: manda por graph.instagram.com con el token de la cuenta conectada; sin cuenta, no manda; el error no lleva texto', async () => {
  const { cuentas } = await conCuenta();
  const pedidos = [];
  const fetchImpl = async (url, opts) => (pedidos.push({ url, auth: opts.headers.authorization, body: JSON.parse(opts.body) }), Response.json({ recipient_id: QUIEN, message_id: 'm' }));
  await enviarIg(ENV, msgTexto(FROM, 'Hola'), fetchImpl, cuentas);
  assert.equal(pedidos[0].url, 'https://graph.instagram.com/v26.0/me/messages');
  assert.equal(pedidos[0].auth, 'Bearer tok-cuenta');
  assert.deepEqual(pedidos[0].body, { recipient: { id: QUIEN }, message: { text: 'Hola' } });
  await assert.rejects(enviarIg(ENV, msgTexto(armarFrom('17841400000000002', QUIEN), 'Hola'), fetchImpl, cuentas), (e) => e.code === 'sin_token');
  // La cuenta del estudio también puede venir por variables (IG_ID + IG_TOKEN), sin conectarse por el link.
  await enviarIg({ ...ENV, IG_ID: '17841400000000002', IG_TOKEN: 'token-env' }, msgTexto(armarFrom('17841400000000002', QUIEN), 'Hola'), fetchImpl, cuentas);
  assert.equal(pedidos.at(-1).auth, 'Bearer token-env');
  const malo = async () => Response.json({ error: { code: 10, message: 'dato personal de ejemplo' } }, { status: 400 });
  await assert.rejects(enviarIg(ENV, msgTexto(FROM, 'Hola'), malo, cuentas), (e) => e.message === 'Instagram 400 10' && e.code === 10);
});

test('mandarA elige el canal por quien escribe: ig:… → Instagram, número → WhatsApp', async () => {
  const { cuentas } = await conCuenta();
  const urls = [];
  const fetchImpl = async (url) => (urls.push(url), Response.json({}));
  await mandarA(ENV, msgTexto(FROM, 'a'), fetchImpl, cuentas);
  await mandarA(ENV, msgTexto('5490000000001', 'b'), fetchImpl, cuentas);
  assert.match(urls[0], /graph\.instagram\.com\/v26\.0\/me\/messages$/);
  assert.match(urls[1], new RegExp(`graph\\.facebook\\.com/.*/${ENV.WHATSAPP_PHONE_NUMBER_ID}/messages$`));
});

test('nombreDe: trae el usuario de Instagram para el panel y nunca falla', async () => {
  const { cuentas } = await conCuenta();
  assert.equal(await nombreDe(ENV, FROM, async () => Response.json({ username: 'alguien.de.prueba' }), cuentas), 'alguien.de.prueba');
  assert.equal(await nombreDe(ENV, FROM, async () => Response.json({ username: '<script>' }), cuentas), null);
  assert.equal(await nombreDe(ENV, FROM, async () => { throw new Error('red'); }, cuentas), null);
  assert.equal(await nombreDe(ENV, FROM, async () => Response.json({ username: 'x' }), null), null, 'sin cuenta conectada no hay token');
});

test('preguntador con la nota de Instagram: mismo prompt de la página, respuestas cortas, mismos controles', async () => {
  let cuerpo;
  const llamar = async (c) => {
    cuerpo = c;
    return { salida: { respuesta: 'Sale 300 euros. Hacemos agentes de WhatsApp.', seccion: 'ninguna', enlace: 'ninguno', escribirnos: false, fuera_de_tema: false }, uso: {} };
  };
  const c = await preguntador({}, { llamar, canal: CANAL_INSTAGRAM })('¿Cuánto sale?', 'en');
  assert.match(cuerpo.system, /<informacion>/);
  assert.match(cuerpo.system, /Canal: mensajes directos de Instagram/);
  assert.doesNotMatch(cuerpo.system, /Canal: WhatsApp/);
  assert.match(cuerpo.system, /el que eligió: English/);
  assert.equal(c.respuesta, 'Hacemos agentes de WhatsApp.');
});

// ——— Conexión de cuentas (OAuth) ———

test('urlAutorizar: manda a Instagram con la app, los dos permisos, la vuelta a nuestro dominio y un state firmado que vence', async () => {
  const u = new URL(await urlAutorizar(ENV, 'https://zustrolabs.com', T0));
  assert.equal(u.origin + u.pathname, 'https://www.instagram.com/oauth/authorize');
  assert.equal(u.searchParams.get('client_id'), ENV.IG_APP_ID);
  assert.equal(u.searchParams.get('redirect_uri'), 'https://zustrolabs.com/api/instagram/conectar/vuelta');
  assert.equal(u.searchParams.get('scope'), PERMISOS.join(','));
  const estado = u.searchParams.get('state');
  assert.equal(await estadoValido(ENV.IG_APP_SECRET, estado, T0 + 60_000), true);
  assert.equal(await estadoValido(ENV.IG_APP_SECRET, estado, T0 + 16 * 60_000), false, 'vence a los 15 minutos');
  assert.equal(await estadoValido('otro-secreto', estado, T0), false);
  assert.equal(await estadoValido(ENV.IG_APP_SECRET, 'cualquier.cosa', T0), false);
  assert.equal(await estadoValido(ENV.IG_APP_SECRET, await firmarEstado(ENV.IG_APP_SECRET, T0), T0), true);
});

/** Meta simulada para el OAuth: código → token corto → token largo → quién soy → suscripción. */
function metaOauth({ suscripta = false } = {}) {
  const pedidos = [];
  const fetchImpl = async (url, opts = {}) => {
    pedidos.push({ url: String(url), method: opts.method ?? 'GET', body: opts.body });
    const u = String(url);
    if (u.startsWith('https://api.instagram.com/oauth/access_token')) return Response.json({ access_token: 'token-corto', user_id: CUENTA });
    if (u.includes('/access_token?grant_type=ig_exchange_token')) return Response.json({ access_token: 'token-largo', token_type: 'bearer', expires_in: 5_183_944 });
    if (u.includes('/me?fields=user_id,username')) return Response.json({ user_id: CUENTA, username: 'zustrolabs' });
    if (u.includes('/me/subscribed_apps') && (opts.method ?? 'GET') === 'GET') return Response.json({ data: suscripta ? [{ subscribed_fields: ['messages'] }] : [] });
    if (u.includes('/me/subscribed_apps')) return Response.json({ success: true });
    if (u.includes('/refresh_access_token')) return Response.json({ access_token: 'token-renovado', expires_in: 5_183_944 });
    return Response.json({ error: { code: 100 } }, { status: 400 });
  };
  return { pedidos, fetchImpl };
}

test('conectarCuenta: cambia el código por un token largo, lee la cuenta y la suscribe a los mensajes', async () => {
  const { pedidos, fetchImpl } = metaOauth();
  const c = await conectarCuenta(ENV, { code: 'codigo-prueba', origen: 'https://zustrolabs.com', now: T0 }, fetchImpl);
  assert.deepEqual(c, { id: CUENTA, username: 'zustrolabs', token: 'token-largo', vence: T0 + 5_183_944_000, suscripta: true });
  const corto = pedidos[0];
  assert.equal(corto.method, 'POST');
  const form = Object.fromEntries(new URLSearchParams(String(corto.body)));
  assert.deepEqual(form, { client_id: ENV.IG_APP_ID, client_secret: ENV.IG_APP_SECRET, grant_type: 'authorization_code', redirect_uri: 'https://zustrolabs.com/api/instagram/conectar/vuelta', code: 'codigo-prueba' });
  assert.ok(pedidos.some((p) => p.method === 'POST' && p.url.endsWith('/me/subscribed_apps?subscribed_fields=messages')));
  await assert.rejects(conectarCuenta(ENV, { code: 'x', origen: 'https://zustrolabs.com' }, async () => Response.json({ error: 'nope' }, { status: 400 })), /oauth 400/);
});

test('worker: el link de conexión exige la clave y manda a Instagram; la vuelta guarda la cuenta y muestra «Listo»', async () => {
  const { memoria, charlas, cuentas } = nuevo();
  const { fetchImpl } = metaOauth();
  const d = { fetch: fetchImpl, memoria, charlas, cuentas, now: T0 };
  const sinClave = await worker.fetch(new Request('https://zustrolabs.com/api/instagram/conectar'), ENV, {}, d);
  assert.equal(sinClave.status, 403);
  const r = await worker.fetch(new Request('https://zustrolabs.com/api/instagram/conectar?clave=clave-link-prueba'), ENV, {}, d);
  assert.equal(r.status, 302);
  const ida = new URL(r.headers.get('location'));
  assert.equal(ida.hostname, 'www.instagram.com');
  const vuelta = await worker.fetch(new Request(`https://zustrolabs.com/api/instagram/conectar/vuelta?code=codigo-prueba&state=${ida.searchParams.get('state')}`), ENV, {}, d);
  assert.equal(vuelta.status, 200);
  const cuerpo = await vuelta.text();
  assert.match(cuerpo, /Listo/);
  assert.match(cuerpo, /@zustrolabs/);
  assert.doesNotMatch(cuerpo, /token-/, 'la página no muestra tokens');
  assert.deepEqual(await cuentas.get(CUENTA), { id: CUENTA, username: 'zustrolabs', token: 'token-largo', vence: T0 + 5_183_944_000 });
  // Una vuelta con state inventado o sin configurar no guarda nada.
  assert.equal((await worker.fetch(new Request('https://zustrolabs.com/api/instagram/conectar/vuelta?code=x&state=1.falso'), ENV, {}, d)).status, 400);
  assert.equal((await worker.fetch(new Request('https://zustrolabs.com/api/instagram/conectar?clave=x'), { ...ENV, IG_CONECTAR_CLAVE: '' }, {}, d)).status, 503);
  assert.match(paginaConectado({ ok: false, error: '<b>x' }), /&lt;|x/);
});

test('mantenerCuentas: renueva el token cuando quedan menos de 15 días, repone la suscripción y nunca registra tokens', async () => {
  const { cuentas } = nuevo();
  await cuentas.put(CUENTA, { username: 'zustrolabs', token: 'token-viejo', vence: T0 + 10 * DIA });
  await cuentas.put('17841400000000002', { username: 'cliente', token: 'tok-cliente', vence: T0 + 50 * DIA });
  const { pedidos, fetchImpl } = metaOauth({ suscripta: false });
  const r = await mantenerCuentas(ENV, cuentas, fetchImpl, T0);
  assert.deepEqual(r, [
    { cuenta: CUENTA, renovado: true, suscripta: true },
    { cuenta: '17841400000000002', renovado: false, suscripta: true },
  ]);
  assert.equal((await cuentas.get(CUENTA)).token, 'token-renovado');
  assert.equal((await cuentas.get('17841400000000002')).token, 'tok-cliente');
  assert.ok(!JSON.stringify(r).includes('token'));
  assert.equal(pedidos.filter((p) => p.url.includes('refresh_access_token')).length, 1);
  assert.equal(await renovarToken(ENV, 'x', async () => Response.json({ error: 1 }, { status: 400 })), null);
  assert.deepEqual(await suscribir(ENV, 'x', metaOauth({ suscripta: true }).fetchImpl), { suscripta: true, arreglada: false });
  const logs = await conLogs(() => worker.scheduled({}, ENV, {}, { fetch: fetchImpl, cuentas, now: T0 }));
  assert.equal(JSON.parse(logs[0]).que, 'mantenimiento');
  assert.ok(!logs.join('\n').includes('token-'));
});

// ——— Worker ———

async function ig(mensajes, env = ENV, d = {}, { firma } = {}) {
  const cuerpo = JSON.stringify(aviso(mensajes));
  const req = new Request('https://zustrolabs.com/api/instagram', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Hub-Signature-256': firma ?? (await firmar(cuerpo, env.IG_APP_SECRET || 'x')) },
    body: cuerpo,
  });
  return worker.fetch(req, env, {}, d);
}
const texto = (t) => ({ message: { mid: 'm' + Math.random(), text: t } });

async function deps(o = {}) {
  const enviados = [];
  const n = await conCuenta();
  return {
    enviados,
    fetch: async (url, opts) => (enviados.push({ url, body: JSON.parse(opts?.body ?? 'null') }), Response.json({ username: 'alguien.de.prueba' })),
    memoria: n.memoria, charlas: n.charlas, cuentas: n.cuentas,
    preguntar: async () => controlada(),
    avisar: async () => true,
    now: T0,
    ...o,
  };
}

async function conLogs(fn) {
  const logs = [];
  const orig = console.log;
  console.log = (x) => logs.push(String(x));
  try {
    await fn();
  } finally {
    console.log = orig;
  }
  return logs;
}

test('worker: /api/instagram verifica con su propio secreto; firmado con el de WhatsApp → 401; sin las claves de la app → 503', async () => {
  const d = await deps();
  assert.equal((await ig([texto('hola')], ENV, d, { firma: await firmar(JSON.stringify(aviso([texto('hola')])), ENV.WHATSAPP_APP_SECRET) })).status, 401);
  assert.equal(d.enviados.length, 0);
  for (const falta of ['IG_APP_SECRET', 'IG_APP_ID']) assert.equal((await ig([texto('hola')], { ...ENV, [falta]: '' }, d)).status, 503, falta);
  assert.equal((await ig([texto('hola')], ENV, d)).status, 200);
  assert.equal(d.enviados[0].body.message.text, SALUDO_IDIOMA_TEXTO, 'primer contacto: el saludo en texto');
  assert.ok(d.enviados[0].url.endsWith('/me/messages'));
});

test('worker: un mensaje para una cuenta no conectada se registra y no se responde', async () => {
  const d = await deps();
  const logs = await conLogs(() => ig([texto('hola')], ENV, d, {}).then(() => ig([{ ...texto('hola'), recipient: { id: '17841400000000002' } }], ENV, d)));
  assert.equal(d.enviados.length, 1, 'solo la cuenta conectada recibe respuesta');
  assert.ok(logs.some((l) => JSON.parse(l).que === 'cuenta_desconocida'));
});

test('worker: cada aviso firmado deja un registro con la forma y la cantidad, sin ids ni texto; la firma mala también', async () => {
  const d = await deps();
  const logs = await conLogs(() => ig([texto('un texto privado')], ENV, d));
  const a = logs.map((l) => JSON.parse(l)).find((l) => l.que === 'aviso');
  assert.deepEqual(a, { canal: 'ig', que: 'aviso', objeto: 'instagram', entradas: 1, forma: 'messaging', eventos: 1 });
  assert.ok(!logs.join('\n').includes(QUIEN) && !logs.join('\n').includes('privado'));
  const logs2 = await conLogs(async () => ig([texto('x')], ENV, await deps(), { firma: 'sha256=' + '0'.repeat(64) }));
  assert.ok(logs2.some((l) => JSON.parse(l).que === 'firma'));
});

test('worker: un aviso de Instagram no entra por /api/whatsapp aunque esté bien firmado', async () => {
  const d = await deps();
  const cuerpo = JSON.stringify(aviso([texto('hola')]));
  const req = new Request('https://zustrolabs.com/api/whatsapp', { method: 'POST', headers: { 'X-Hub-Signature-256': await firmar(cuerpo, ENV.WHATSAPP_APP_SECRET) }, body: cuerpo });
  assert.equal((await worker.fetch(req, ENV, {}, d)).status, 200);
  assert.equal(d.enviados.length, 0);
});

test('worker: PERSONA por Instagram abre la charla en el panel con el canal y el usuario, y el asistente se calla', async () => {
  const d = await deps();
  await d.memoria.put(FROM, { idioma: 'es', humanoHasta: 0 });
  const logs = await conLogs(() => ig([texto('PERSONA')], ENV, d));
  const respuestas = d.enviados.filter((e) => e.url.endsWith('/me/messages'));
  assert.equal(respuestas[0].body.message.text, TEXTOS.es.persona);
  const c = await d.charlas.get(FROM);
  assert.equal(c.abierta, true);
  assert.equal(c.nombre, 'alguien.de.prueba');
  assert.deepEqual((await d.charlas.list()).map((x) => x.num), [FROM]);
  const linea = logs.map((l) => JSON.parse(l)).find((l) => l.que === 'persona');
  assert.equal(linea.canal, 'ig');
  assert.ok(!logs.join('\n').includes(QUIEN), 'el registro no lleva el id de la persona');
  await ig([texto('Tengo un local')], ENV, d);
  assert.equal(d.enviados.filter((e) => e.url.endsWith('/me/messages')).length, 1, 'mientras atiende una persona, el asistente no escribe');
  assert.equal((await d.charlas.get(FROM)).mensajes.at(-1).texto, 'Tengo un local');
});

test('worker: si Meta no da el usuario, la charla igual se abre; la respuesta larga sale en trozos', async () => {
  const d = await deps();
  d.fetch = async (url, opts) => (d.enviados.push({ url, body: JSON.parse(opts?.body ?? 'null') }), url.includes('?fields=username') ? Response.json({}, { status: 400 }) : Response.json({}));
  await d.memoria.put(FROM, { idioma: 'es', humanoHasta: 0 });
  await ig([texto('PERSONA')], ENV, d);
  assert.equal((await d.charlas.get(FROM)).abierta, true);
  assert.equal((await d.charlas.get(FROM)).nombre, undefined);
  const d2 = await deps({ preguntar: async () => controlada({ respuesta: ('Una oración larga de prueba. '.repeat(45)).trim() }) });
  await d2.memoria.put(FROM, { idioma: 'es', humanoHasta: 0 });
  await ig([texto('¿Qué hacen?')], ENV, d2);
  assert.ok(d2.enviados.length >= 2);
  for (const e of d2.enviados) assert.ok(new TextEncoder().encode(e.body.message.text).length <= MAX_TROZO);
});

test('worker: el límite por persona usa cuenta y remitente de Instagram y el tope global es el mismo que WhatsApp', async () => {
  const claves = [];
  const limite = { limit: async ({ key }) => (claves.push(key), { success: true }) };
  const d = await deps();
  await d.memoria.put(FROM, { idioma: 'es', humanoHasta: 0 });
  await ig([texto('¿Qué hacen?')], { ...ENV, LIMITE: limite, LIMITE_GLOBAL: limite }, d);
  assert.deepEqual(claves, [FROM, 'ia']);
});

test('worker: el panel responde por Instagram a una charla ig:… y marca el canal', async () => {
  const d = await deps();
  await d.memoria.put(FROM, { idioma: 'es', humanoHasta: 0 });
  await ig([texto('PERSONA')], ENV, d);
  // Sin el login de Access el panel no entra (401): la ruta con prefijo igual existe (no 404).
  const r = await worker.fetch(new Request(`https://equipo.zustrolabs.com/api/charlas/${FROM}`), ENV, {}, d);
  assert.equal(r.status, 401);
  assert.equal(NOMBRE_CANAL.ig, 'Instagram');
  const m = mailAviso({ from: 'avisos@avisos.zustrolabs.com', to: 'equipo@example.com', now: new Date(T0), canal: 'ig' });
  assert.match(m, /PERSONA en el Instagram de Zustro Labs/);
  assert.doesNotMatch(m.split('\r\n\r\n')[1], /\d{6,}/, 'el cuerpo no lleva ids');
});

// ——— Reglas del estudio ———

test('nota de Instagram: sin palabras prohibidas, pide respuestas cortas y sin direcciones web', () => {
  assert.doesNotMatch(CANAL_INSTAGRAM, /precio|contrat[aá]|\bempresas?\b|presupuest|tarifa|\bbot\b|robot/i);
  assert.match(CANAL_INSTAGRAM, /corto/);
  assert.match(CANAL_INSTAGRAM, /No escribas direcciones web/);
  assert.equal(CANALES.ig.nota, CANAL_INSTAGRAM);
});

test('wrangler.toml: la ruta de Instagram con *, el id de la app comentado (no secreto) y el cron diario', () => {
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /pattern = "zustrolabs\.com\/api\/instagram\*"/, 'con * al final: si no, la verificación de Meta (?hub.mode=…) cae en Pages');
  assert.match(toml, /^\[triggers\]\ncrons = \["\d+ \d+ \* \* \*"\]$/m);
  assert.doesNotMatch(toml, /^(IG_TOKEN|IG_APP_SECRET|IG_VERIFY_TOKEN|IG_CONECTAR_CLAVE)\s*=/m, 'los secretos no van en el repo');
});

test('la página de conexión no lleva palabras prohibidas ni otros correos', () => {
  for (const h of [paginaConectado({ ok: true, username: 'zustrolabs', suscripta: true }), paginaConectado({ ok: false, error: 'x' })]) {
    const p = h.replace(/<head>[\s\S]*<\/head>/, '').replace(/<[^>]+>/g, ' '); // solo el texto visible
    assert.doesNotMatch(p, /precio|contrat[aá]|\bempresas?\b|tarifa|\bbot\b|robot/i);
    for (const c of p.match(/[\w.+-]+@[\w.-]+\w/g) ?? []) assert.equal(c, 'contact@zustrolabs.com');
  }
});
