// Tests del Instagram de Zustro Labs (ZL-111), sin red y sin Cloudflare: Meta, el modelo y el correo se simulan.
// Datos ficticios: ids 1784140000000000x, correos @example.com.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker, { CANALES, mandarA } from '../src/index.js';
import { adaptadores, almacenPrueba, crearAtencion } from '../src/atencion.js';
import { _resetCerts, mailAviso, NOMBRE_CANAL } from '../src/panel.js';
import { CANAL_INSTAGRAM, eligeIdioma, SALUDO_IDIOMA, SALUDO_IDIOMA_TEXTO, TEXTOS } from '../src/textos.js';
import { atender, firmar, msgIdiomas, msgTexto, preguntador, verificarSuscripcion } from '../src/whatsapp.js';
import { convertir, enviarIg, leerWebhookIg, MAX_TROZO, nombreDe, PREFIJO, revisarSuscripcion, trozar } from '../src/instagram.js';

const IG_ID = '17841400000000001'; // la cuenta @zustrolabs (ficticio)
const PAGE_ID = '100000000000002';
const QUIEN = '17841400000000009'; // quien escribe (ficticio)
const FROM = PREFIJO + QUIEN;
const T0 = 1_792_000_000_000;
const limiteOk = { limit: async () => ({ success: true }) };
const ENV = {
  IG_APP_SECRET: 'secreto-ig-prueba', IG_TOKEN: 'token-ig-prueba', IG_VERIFY_TOKEN: 'verificar-ig', IG_ID, IG_PAGE_ID: PAGE_ID,
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

const aviso = (mensajes, { destino = IG_ID } = {}) => ({
  object: 'instagram',
  entry: [{ id: destino, time: T0, messaging: mensajes.map((m) => ({ sender: { id: QUIEN }, recipient: { id: destino }, timestamp: T0, ...m })) }],
});

// ——— Entrada ———

test('leerWebhookIg: texto, adjuntos, ecos, borrados y otra cuenta; los tiempos pasan a segundos', () => {
  const evs = leerWebhookIg(aviso([
    { message: { mid: 'm1', text: 'Hola' } },
    { message: { mid: 'm2', attachments: [{ type: 'image', payload: { url: 'https://example.com/foto.jpg' } }] } },
    { message: { mid: 'm3', text: 'Mandé esto yo', is_echo: true }, sender: { id: IG_ID }, recipient: { id: QUIEN } },
    { message: { mid: 'm4', text: 'borrado', is_deleted: true } },
    { read: { mid: 'm1' } },
    { reaction: { mid: 'm1', action: 'react', emoji: '❤️' } },
    { message: { mid: 'm5', text: 'otra' }, sender: { id: 'no-es-id' } },
  ]), IG_ID);
  assert.deepEqual(evs.map((e) => [e.kind, e.id]), [['text', 'm1'], ['otro', 'm2']]);
  assert.equal(evs[0].from, FROM);
  assert.equal(evs[0].ts, T0 / 1000);
  assert.equal(evs[0].text, 'Hola');
  assert.deepEqual(leerWebhookIg(aviso([{ message: { mid: 'x', text: 'y' } }], { destino: '17841400000000002' }), IG_ID), [], 'otra cuenta');
  assert.deepEqual(leerWebhookIg(aviso([{ message: { mid: 'x', text: 'y' } }]), ''), [], 'sin IG_ID no procesa nada');
  assert.deepEqual(leerWebhookIg({ object: 'whatsapp_business_account' }, IG_ID), []);
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
  const ev = (o) => ({ id: 'm' + Math.random(), from: FROM, ts: T0 / 1000, kind: 'text', ...o });
  const r1 = await atender(ev({ text: 'hola' }), { memoria, preguntar, now: T0 });
  assert.deepEqual(convertir(r1.send[0]), [{ recipient: { id: QUIEN }, message: { text: SALUDO_IDIOMA_TEXTO } }]);
  const r2 = await atender(ev({ text: 'Hrvatski' }), { memoria, preguntar, now: T0 });
  assert.equal(r2.metrica, 'idioma');
  assert.equal(r2.send[0].text.body, TEXTOS.hr.bienvenida);
  assert.equal((await memoria.get(FROM)).idioma, 'hr');
  await atender(ev({ text: 'Što radite?' }), { memoria, preguntar, now: T0 });
  assert.deepEqual(llamadas, [{ texto: 'Što radite?', idioma: 'hr' }]);
  // La memoria de Instagram no se mezcla con un número de WhatsApp parecido.
  assert.equal(await memoria.get(QUIEN), null);
});

test('foto, sticker o audio por Instagram: «solo leo texto», sin gastar IA', async () => {
  const { memoria } = nuevo();
  await memoria.put(FROM, { idioma: 'en', humanoHasta: 0 });
  let llamadas = 0;
  const r = await atender({ id: 'm1', from: FROM, ts: T0 / 1000, kind: 'otro' }, { memoria, preguntar: async () => (llamadas++, controlada()), now: T0 });
  assert.equal(r.send[0].text.body, TEXTOS.en.soloTexto);
  assert.equal(llamadas, 0);
});

// ——— Salida ———

test('trozar: hasta 1000 bytes por mensaje, cortando por párrafos y oraciones', () => {
  assert.deepEqual(trozar(''), []);
  assert.deepEqual(trozar('Hola.'), ['Hola.']);
  const parrafo = 'Una oración de prueba con acentos: áéíóú. '.repeat(12).trim(); // ~600 bytes
  const partes = trozar(`${parrafo}\n\n${parrafo}\n\n${parrafo}`);
  assert.ok(partes.length >= 3);
  for (const p of partes) assert.ok(new TextEncoder().encode(p).length <= MAX_TROZO, `${p.length} caracteres`);
  assert.equal(partes.join('\n\n').replace(/\s+/g, ' '), `${parrafo}\n\n${parrafo}\n\n${parrafo}`.replace(/\s+/g, ' '), 'no pierde texto');
  const larga = 'x'.repeat(2500);
  assert.ok(trozar(larga).every((p) => p.length <= MAX_TROZO) && trozar(larga).join('').length === 2500);
});

test('convertir: texto → pedido de Instagram sin el prefijo; los botones de idioma → el saludo en texto', () => {
  assert.deepEqual(convertir(msgTexto(FROM, 'Hola')), [{ recipient: { id: QUIEN }, message: { text: 'Hola' } }]);
  assert.equal(convertir(msgIdiomas(FROM))[0].message.text, SALUDO_IDIOMA_TEXTO);
});

test('enviarIg: manda desde la página con el token de Instagram; si Meta rechaza, el error no lleva el texto', async () => {
  const pedidos = [];
  const fetchImpl = async (url, opts) => (pedidos.push({ url, auth: opts.headers.authorization, body: JSON.parse(opts.body) }), Response.json({ recipient_id: QUIEN, message_id: 'm' }));
  await enviarIg(ENV, msgTexto(FROM, 'Hola'), fetchImpl);
  assert.equal(pedidos[0].url, `https://graph.facebook.com/v25.0/${PAGE_ID}/messages`);
  assert.equal(pedidos[0].auth, 'Bearer token-ig-prueba');
  assert.deepEqual(pedidos[0].body, { recipient: { id: QUIEN }, message: { text: 'Hola' } });
  const malo = async () => Response.json({ error: { code: 10, message: 'dato personal de ejemplo' } }, { status: 400 });
  await assert.rejects(enviarIg(ENV, msgTexto(FROM, 'Hola'), malo), (e) => e.message === 'Instagram 400 10' && e.code === 10);
});

test('mandarA elige el canal por quien escribe: ig:<id> → Instagram, número → WhatsApp', async () => {
  const urls = [];
  const fetchImpl = async (url) => (urls.push(url), Response.json({}));
  await mandarA(ENV, msgTexto(FROM, 'a'), fetchImpl);
  await mandarA(ENV, msgTexto('5490000000001', 'b'), fetchImpl);
  assert.match(urls[0], new RegExp(`/${PAGE_ID}/messages$`));
  assert.match(urls[1], new RegExp(`/${ENV.WHATSAPP_PHONE_NUMBER_ID}/messages$`));
});

test('nombreDe: trae el usuario de Instagram para el panel y nunca falla', async () => {
  assert.equal(await nombreDe(ENV, FROM, async () => Response.json({ username: 'alguien.de.prueba' })), 'alguien.de.prueba');
  assert.equal(await nombreDe(ENV, FROM, async () => Response.json({ username: '<script>' })), null);
  assert.equal(await nombreDe(ENV, FROM, async () => { throw new Error('red'); }), null);
  assert.equal(await nombreDe({ ...ENV, IG_TOKEN: '' }, FROM, async () => Response.json({ username: 'x' })), null);
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

function deps(o = {}) {
  const enviados = [];
  return {
    enviados,
    fetch: async (url, opts) => (enviados.push({ url, body: JSON.parse(opts?.body ?? 'null') }), Response.json({ username: 'alguien.de.prueba' })),
    ...(({ memoria, charlas }) => ({ memoria, charlas }))(nuevo()),
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

test('worker: /api/instagram verifica con su propio secreto; firmado con el de WhatsApp → 401; sin configurar → 503', async () => {
  const d = deps();
  assert.equal((await ig([texto('hola')], ENV, d, { firma: await firmar(JSON.stringify(aviso([texto('hola')])), ENV.WHATSAPP_APP_SECRET) })).status, 401);
  assert.equal(d.enviados.length, 0);
  for (const falta of ['IG_TOKEN', 'IG_APP_SECRET', 'IG_ID', 'IG_PAGE_ID']) assert.equal((await ig([texto('hola')], { ...ENV, [falta]: '' }, d)).status, 503, falta);
  assert.equal((await ig([texto('hola')], ENV, d)).status, 200);
  assert.equal(d.enviados[0].body.message.text, SALUDO_IDIOMA_TEXTO, 'primer contacto: el saludo en texto');
  assert.ok(d.enviados[0].url.endsWith(`/${PAGE_ID}/messages`));
});

test('worker: un aviso de Instagram no entra por /api/whatsapp aunque esté bien firmado', async () => {
  const d = deps();
  const cuerpo = JSON.stringify(aviso([texto('hola')]));
  const req = new Request('https://zustrolabs.com/api/whatsapp', { method: 'POST', headers: { 'X-Hub-Signature-256': await firmar(cuerpo, ENV.WHATSAPP_APP_SECRET) }, body: cuerpo });
  assert.equal((await worker.fetch(req, ENV, {}, d)).status, 200);
  assert.equal(d.enviados.length, 0);
});

test('worker: PERSONA por Instagram abre la charla en el panel con el canal y el usuario, y el asistente se calla', async () => {
  const d = deps();
  await d.memoria.put(FROM, { idioma: 'es', humanoHasta: 0 });
  const logs = await conLogs(() => ig([texto('PERSONA')], ENV, d));
  const respuestas = d.enviados.filter((e) => e.url.endsWith('/messages'));
  assert.equal(respuestas[0].body.message.text, TEXTOS.es.persona);
  const c = await d.charlas.get(FROM);
  assert.equal(c.abierta, true);
  assert.equal(c.nombre, 'alguien.de.prueba');
  assert.deepEqual((await d.charlas.list()).map((x) => x.num), [FROM]);
  const linea = logs.map((l) => JSON.parse(l)).find((l) => l.que === 'persona');
  assert.equal(linea.canal, 'ig');
  assert.ok(!logs.join('\n').includes(QUIEN), 'el registro no lleva el id de la persona');
  await ig([texto('Tengo un local')], ENV, d);
  assert.equal(d.enviados.filter((e) => e.url.endsWith('/messages')).length, 1, 'mientras atiende una persona, el asistente no escribe');
  assert.equal((await d.charlas.get(FROM)).mensajes.at(-1).texto, 'Tengo un local');
});

test('worker: si Meta no da el usuario, la charla igual se abre; la respuesta larga sale en trozos', async () => {
  const d = deps({ fetch: async (url, opts) => (d.enviados.push({ url, body: JSON.parse(opts?.body ?? 'null') }), url.includes('?fields=username') ? Response.json({}, { status: 400 }) : Response.json({})) });
  await d.memoria.put(FROM, { idioma: 'es', humanoHasta: 0 });
  await ig([texto('PERSONA')], ENV, d);
  assert.equal((await d.charlas.get(FROM)).abierta, true);
  assert.equal((await d.charlas.get(FROM)).nombre, undefined);
  const d2 = deps({ preguntar: async () => controlada({ respuesta: ('Una oración larga de prueba. '.repeat(45)).trim() }) });
  await d2.memoria.put(FROM, { idioma: 'es', humanoHasta: 0 });
  await ig([texto('¿Qué hacen?')], ENV, d2);
  assert.ok(d2.enviados.length >= 2);
  for (const e of d2.enviados) assert.ok(new TextEncoder().encode(e.body.message.text).length <= MAX_TROZO);
});

test('worker: el límite por persona usa el id de Instagram y el tope global es el mismo que WhatsApp', async () => {
  const claves = [];
  const limite = { limit: async ({ key }) => (claves.push(key), { success: true }) };
  const d = deps();
  await d.memoria.put(FROM, { idioma: 'es', humanoHasta: 0 });
  await ig([texto('¿Qué hacen?')], { ...ENV, LIMITE: limite, LIMITE_GLOBAL: limite }, d);
  assert.deepEqual(claves, [FROM, 'ia']);
});

test('worker: el panel responde por Instagram a una charla ig:<id> y marca el canal', async () => {
  const d = deps();
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

test('cron: revisa la suscripción de la página y la vuelve a suscribir si falta', async () => {
  const pedidos = [];
  const fetchImpl = (suscripta) => async (url, opts = {}) => {
    pedidos.push({ url, method: opts.method ?? 'GET', body: opts.body });
    if ((opts.method ?? 'GET') === 'GET') return Response.json({ data: suscripta ? [{ id: '1', subscribed_fields: ['messages'] }] : [] });
    return Response.json({ success: true });
  };
  assert.deepEqual(await revisarSuscripcion(ENV, fetchImpl(true)), { suscripta: true, arreglada: false });
  assert.equal(pedidos.length, 1);
  assert.deepEqual(await revisarSuscripcion(ENV, fetchImpl(false)), { suscripta: true, arreglada: true, error: undefined });
  assert.equal(pedidos.at(-1).method, 'POST');
  assert.ok(pedidos.at(-1).url.endsWith(`/${PAGE_ID}/subscribed_apps`));
  assert.deepEqual(JSON.parse(pedidos.at(-1).body), { subscribed_fields: ['messages'] });
  assert.equal((await revisarSuscripcion({}, fetchImpl(true))).error, 'sin_config');
  const logs = await conLogs(() => worker.scheduled({}, ENV, {}, { fetch: fetchImpl(true) }));
  assert.deepEqual(JSON.parse(logs[0]), { canal: 'ig', que: 'suscripcion', suscripta: true, arreglada: false });
});

// ——— Reglas del estudio ———

test('nota de Instagram: sin palabras prohibidas, pide respuestas cortas y sin direcciones web', () => {
  assert.doesNotMatch(CANAL_INSTAGRAM, /precio|contrat[aá]|\bempresas?\b|presupuest|tarifa|\bbot\b|robot/i);
  assert.match(CANAL_INSTAGRAM, /corto/);
  assert.match(CANAL_INSTAGRAM, /No escribas direcciones web/);
  assert.equal(CANALES.ig.nota, CANAL_INSTAGRAM);
});

test('wrangler.toml: la ruta de Instagram, los ids comentados (no secretos) y el cron diario', () => {
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /pattern = "zustrolabs\.com\/api\/instagram"/);
  assert.match(toml, /^\[triggers\]\ncrons = \["\d+ \d+ \* \* \*"\]$/m);
  assert.doesNotMatch(toml, /^(IG_TOKEN|IG_APP_SECRET|IG_VERIFY_TOKEN)\s*=/m, 'los secretos no van en el repo');
});

test('script de suscripción: no guarda ni escribe el token en ningún archivo', () => {
  const s = readFileSync(new URL('../scripts/instagram-suscribir.mjs', import.meta.url), 'utf8');
  assert.match(s, /process\.env\.IG_TOKEN/);
  assert.doesNotMatch(s, /writeFile|appendFile|['"]\.env['"]/);
});
