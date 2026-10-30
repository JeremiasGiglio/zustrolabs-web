// Tests del WhatsApp de Zustro Labs, sin red y sin Cloudflare: Meta, el modelo y el correo se simulan.
// Datos ficticios: números 549000000000x, correos @example.com.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker, { panelListo } from '../src/index.js';
import { _resetCerts, avisar, HTML, mailAviso, PANEL_URL, textoDevuelta } from '../src/panel.js';
import { adaptadores, almacenPrueba, crearAtencion, RETENCION_CHARLA_MS } from '../src/atencion.js';
import { TEXTOS, SALUDO_IDIOMA, IDIOMAS, opcion, CANAL_WHATSAPP } from '../src/textos.js';
import {
  atender, comando, filtroWhatsApp, firmar, firmaValida, formatear, leerWebhook, msgIdiomas, preguntador, TOPE_DIARIO,
  varianteArgentina, verificarSuscripcion, enviar,
} from '../src/whatsapp.js';

const NUM = '5490000000001';
const T0 = 1_792_000_000_000;
const PHONE_ID = '100000000000001';
const TEAM = 'equipo-de-prueba.cloudflareaccess.com';
const AUD = 'aud-de-prueba';
const ORIGEN_PANEL = 'https://equipo.zustrolabs.com';
const limiteOk = { limit: async () => ({ success: true }) };
const limiteNo = { limit: async () => ({ success: false }) };
const ENV = {
  WHATSAPP_APP_SECRET: 'secreto-de-prueba', WHATSAPP_TOKEN: 'token-de-prueba', WHATSAPP_VERIFY_TOKEN: 'verificar-prueba',
  WHATSAPP_PHONE_NUMBER_ID: PHONE_ID, LIMITE: limiteOk, LIMITE_GLOBAL: limiteOk,
  ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, PANEL_EMAILS: 'yo@example.com',
};
const controlada = (o = {}) => ({ respuesta: 'Hacemos sitios, apps y agentes de IA.', secciones: [], enlaces: [], escribirnos: false, fuera_de_tema: false, notas: [], ...o });
const ev = (o = {}) => ({ id: 'wamid.' + Math.random(), from: NUM, ts: T0 / 1000, kind: 'text', text: '¿Hacen sitios web?', ...o });

beforeEach(() => _resetCerts());

/** Memoria y charlas sobre la misma lógica del Durable Object, con un almacenamiento en memoria. */
function nuevo(reloj = () => T0) {
  const almacen = almacenPrueba();
  return { almacen, ...adaptadores(crearAtencion(almacen), reloj) };
}
const memoriaPrueba = () => nuevo().memoria;

// ——— Firma y verificación de Meta ———

test('firma: acepta la de Meta y rechaza otra, una vacía o una con otro formato', async () => {
  const cuerpo = '{"a":1}';
  const f = await firmar(cuerpo, 's');
  assert.match(f, /^sha256=[0-9a-f]{64}$/);
  assert.equal(await firmaValida(cuerpo, f, 's'), true);
  assert.equal(await firmaValida(cuerpo, f, 'otro'), false);
  assert.equal(await firmaValida(cuerpo + ' ', f, 's'), false);
  assert.equal(await firmaValida(cuerpo, '', 's'), false);
  assert.equal(await firmaValida(cuerpo, 'sha1=abc', 's'), false);
  assert.equal(await firmaValida(cuerpo, f, ''), false);
});

test('verificación de Meta: solo con el token correcto y un challenge con forma de challenge', () => {
  const u = (q) => new URL(`https://zustrolabs.com/api/whatsapp?${q}`);
  assert.deepEqual(verificarSuscripcion(u('hub.mode=subscribe&hub.verify_token=verificar-prueba&hub.challenge=123'), ENV), { status: 200, body: '123' });
  assert.equal(verificarSuscripcion(u('hub.mode=subscribe&hub.verify_token=mal&hub.challenge=123'), ENV).status, 403);
  assert.equal(verificarSuscripcion(u('hub.mode=subscribe&hub.verify_token=verificar-prueba&hub.challenge=<script>'), ENV).status, 400);
  assert.equal(verificarSuscripcion(u('hub.mode=subscribe'), {}).status, 503);
});

// ——— Entrada ———

const payload = (mensajes, phone = PHONE_ID) => ({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: phone }, messages: mensajes } }] }],
});

test('leerWebhook: texto, botón de idioma y lo demás; ignora otro número y remitentes raros', () => {
  const evs = leerWebhook(payload([
    { id: 'a', from: NUM, timestamp: '1', type: 'text', text: { body: 'Hola' } },
    { id: 'b', from: NUM, timestamp: '1', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'idioma_hr' } } },
    { id: 'c', from: NUM, timestamp: '1', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'idioma_xx' } } },
    { id: 'd', from: NUM, timestamp: '1', type: 'image' },
    { id: 'e', from: 'no-es-numero', timestamp: '1', type: 'text', text: { body: 'x' } },
  ]), PHONE_ID);
  assert.deepEqual(evs.map((e) => e.kind), ['text', 'idioma', 'otro', 'otro']);
  assert.equal(evs[1].idioma, 'hr');
  assert.deepEqual(leerWebhook(payload([{ id: 'a', from: NUM, type: 'text', text: { body: 'x' } }], 'otro-numero'), PHONE_ID), []);
  assert.deepEqual(leerWebhook(payload([{ id: 'a', from: NUM, type: 'text', text: { body: 'x' } }]), ''), [], 'sin número configurado no procesa nada');
  assert.deepEqual(leerWebhook({ object: 'page' }, PHONE_ID), []);
});

test('comandos: en los tres idiomas, solo el mensaje entero', () => {
  for (const t of ['PERSONA', 'persona!', 'Osoba', 'person', 'Hablar con una persona']) assert.equal(comando(t), 'persona', t);
  for (const t of ['BORRAR', 'borrar todo', 'Eliminar mis datos', 'Obriši', 'izbriši sve', 'delete', 'delete all']) assert.equal(comando(t), 'borrar', t);
  for (const t of ['operador', 'Operater', 'operator']) assert.equal(comando(t), 'persona', t);
  for (const t of ['IDIOMA', 'jezik', 'Language']) assert.equal(comando(t), 'idioma', t);
  for (const t of ['quiero hablar con una persona sobre mi negocio', 'borrar el turno', 'hola']) assert.equal(comando(t), null, t);
});

// ——— Lógica ———

const preguntas = () => {
  const llamadas = [];
  const preguntar = async (texto, idioma) => (llamadas.push({ texto, idioma }), controlada());
  return { llamadas, preguntar };
};

test('primer contacto: botones de idioma en los tres idiomas; al elegir, bienvenida en ese idioma', async () => {
  const memoria = memoriaPrueba();
  const { llamadas, preguntar } = preguntas();
  const r1 = await atender(ev(), { memoria, preguntar, now: T0 });
  assert.equal(r1.send[0].type, 'interactive');
  assert.equal(r1.send[0].interactive.body.text, SALUDO_IDIOMA);
  assert.deepEqual(r1.send[0].interactive.action.buttons.map((b) => b.reply.id), ['idioma_es', 'idioma_hr', 'idioma_en']);
  assert.ok(r1.send[0].interactive.action.buttons.every((b) => b.reply.title.length <= 20));
  assert.equal(llamadas.length, 0, 'el primer mensaje no gasta IA');
  const r2 = await atender(ev({ kind: 'idioma', idioma: 'hr' }), { memoria, preguntar, now: T0 });
  assert.equal(r2.send[0].text.body, `${TEXTOS.hr.bienvenida}\n\n${TEXTOS.hr.quienes}`);
  assert.equal((await memoria.get(NUM)).idioma, 'hr');
  await atender(ev({ text: 'Imate li web stranice?' }), { memoria, preguntar, now: T0 });
  assert.deepEqual(llamadas, [{ texto: 'Imate li web stranice?', idioma: 'hr' }]);
});

test('la memoria no guarda texto: solo idioma y humanoHasta (y su vencimiento)', async () => {
  const { memoria, almacen } = nuevo();
  const { preguntar } = preguntas();
  await atender(ev(), { memoria, preguntar, now: T0 });
  await atender(ev({ kind: 'idioma', idioma: 'es' }), { memoria, preguntar, now: T0 });
  await atender(ev({ text: 'Tengo una veterinaria y quiero turnos por WhatsApp' }), { memoria, preguntar, now: T0 });
  const guardado = await memoria.get(NUM);
  assert.deepEqual(Object.keys(guardado).sort(), ['humanoHasta', 'idioma']);
  assert.ok(!JSON.stringify([...almacen._data]).includes('veterinaria'));
});

test('un mismo mensaje (reintento de Meta) no se contesta dos veces', async () => {
  const memoria = memoriaPrueba();
  const { preguntar } = preguntas();
  const e = ev();
  assert.equal((await atender(e, { memoria, preguntar, now: T0 })).send.length, 1);
  assert.deepEqual((await atender(e, { memoria, preguntar, now: T0 })).metrica, 'repetido');
});

test('PERSONA con panel: confirma, abre la charla, pide aviso y el asistente se calla 24 h', async () => {
  const { memoria, charlas } = nuevo();
  const { llamadas, preguntar } = preguntas();
  await memoria.put(NUM, { idioma: 'en', humanoHasta: 0 });
  const r = await atender(ev({ text: 'PERSON' }), { memoria, charlas, preguntar, now: T0 });
  assert.equal(r.send[0].text.body, TEXTOS.en.persona);
  assert.equal(r.avisar, true);
  const c = await charlas.get(NUM);
  assert.equal(c.abierta, true);
  assert.equal(c.idioma, 'en');
  const r2 = await atender(ev({ text: 'I have a shop' }), { memoria, charlas, preguntar, now: T0 + 1000 });
  assert.equal(r2.send.length, 0);
  assert.equal(llamadas.length, 0);
  assert.equal((await charlas.get(NUM)).mensajes.at(-1).texto, 'I have a shop');
  // Pasadas las 24 h sin mensajes, vuelve el asistente.
  const r3 = await atender(ev({ text: 'Do you build apps?' }), { memoria, charlas, preguntar, now: T0 + 1000 + 25 * 3600_000 });
  assert.equal(r3.metrica, 'ia');
});

test('PERSONA sin panel: deriva a contact@ y el asistente no se calla', async () => {
  const memoria = memoriaPrueba();
  await memoria.put(NUM, { idioma: 'es', humanoHasta: 0 });
  const r = await atender(ev({ text: 'PERSONA' }), { memoria, charlas: null, preguntar: async () => controlada(), now: T0 });
  assert.equal(r.send[0].text.body, TEXTOS.es.personaMail);
  assert.ok(!r.avisar);
  assert.equal((await memoria.get(NUM)).humanoHasta, 0);
});

test('BORRAR borra la memoria y la charla del panel, aunque esté atendiendo una persona', async () => {
  const { memoria, charlas } = nuevo();
  await memoria.put(NUM, { idioma: 'es', humanoHasta: 0 });
  await atender(ev({ text: 'PERSONA' }), { memoria, charlas, preguntar: async () => controlada(), now: T0 });
  const r = await atender(ev({ text: 'BORRAR' }), { memoria, charlas, preguntar: async () => controlada(), now: T0 + 1 });
  assert.equal(r.send[0].text.body, TEXTOS.es.borrado);
  assert.equal(await memoria.get(NUM), null);
  assert.equal(await charlas.get(NUM), null);
});

test('audio, foto o archivo: pide texto y no gasta IA', async () => {
  const memoria = memoriaPrueba();
  await memoria.put(NUM, { idioma: 'es', humanoHasta: 0 });
  const { llamadas, preguntar } = preguntas();
  const r = await atender(ev({ kind: 'otro', text: undefined }), { memoria, preguntar, now: T0 });
  assert.equal(r.send[0].text.body, TEXTOS.es.soloTexto);
  assert.equal(llamadas.length, 0);
});

test('IDIOMA vuelve a mostrar los botones', async () => {
  const memoria = memoriaPrueba();
  await memoria.put(NUM, { idioma: 'es', humanoHasta: 0 });
  const r = await atender(ev({ text: 'idioma' }), { memoria, preguntar: async () => controlada(), now: T0 });
  assert.deepEqual(r.send[0], msgIdiomas(NUM));
});

test('memoria: mensajes que llegan juntos no se pisan (con KV se perdían)', async () => {
  const { memoria, charlas } = nuevo();
  await memoria.put(NUM, { idioma: 'es', humanoHasta: 0 });
  await atender(ev({ text: 'PERSONA' }), { memoria, charlas, preguntar: async () => controlada(), now: T0 });
  await Promise.all(['uno', 'dos', 'tres'].map((t) => atender(ev({ text: t }), { memoria, charlas, preguntar: async () => controlada(), now: T0 + 1 })));
  const textos = (await charlas.get(NUM)).mensajes.map((m) => m.texto);
  for (const t of ['uno', 'dos', 'tres']) assert.ok(textos.includes(t), t);
  // Dos PERSONA de números distintos a la vez: las dos aparecen en el panel.
  const otro = '5490000000002';
  await memoria.put(otro, { idioma: 'en', humanoHasta: 0 });
  await Promise.all([otro, '5490000000003'].map((n) => atender(ev({ from: n, text: 'PERSONA' }), { memoria, charlas, preguntar: async () => controlada(), now: T0 + 2 })));
  assert.equal((await charlas.list()).length, 3);
});

test('memoria: las charlas vencen a los 30 días (también en la lista del panel) y la limpieza las borra', async () => {
  let ahora = T0;
  const { memoria, charlas, almacen } = nuevo(() => ahora);
  const logica = crearAtencion(almacen);
  await memoria.put(NUM, { idioma: 'es', humanoHasta: 0 });
  await atender(ev({ text: 'PERSONA' }), { memoria, charlas, preguntar: async () => controlada(), now: T0 });
  ahora = T0 + RETENCION_CHARLA_MS + 1;
  await charlas.agregar('5490000000009', { de: 'persona', texto: 'otra' }, ahora, { abierta: true });
  assert.deepEqual((await charlas.list()).map((c) => c.num), ['5490000000009']);
  assert.equal(await charlas.get(NUM), null);
  assert.ok((await logica.limpiar(ahora)) >= 1);
  assert.ok(![...almacen._data.keys()].includes(`chat:${NUM}`));
  assert.ok([...almacen._data.keys()].includes(`wa:${NUM}`), 'la memoria dura 90 días');
});

test('BORRAR también borra el contador diario', async () => {
  const { memoria, almacen } = nuevo();
  await memoria.put(NUM, { idioma: 'es', humanoHasta: 0 });
  await atender(ev({ text: '¿Hacen apps?' }), { memoria, preguntar: async () => controlada(), now: T0 });
  assert.ok([...almacen._data.keys()].some((k) => k.startsWith(`uso:${NUM}:`)));
  await atender(ev({ text: 'borrar todo' }), { memoria, preguntar: async () => controlada(), now: T0 });
  assert.deepEqual([...almacen._data.keys()].filter((k) => k.includes(NUM)), []);
});

test('tope diario: pasadas las 40 respuestas de la IA del día, sugiere PERSONA sin gastar más', async () => {
  const { memoria } = nuevo();
  const { llamadas, preguntar } = preguntas();
  await memoria.put(NUM, { idioma: 'es', humanoHasta: 0 });
  for (let i = 0; i < TOPE_DIARIO; i++) await atender(ev({ text: 'pregunta ' + i }), { memoria, preguntar, now: T0 });
  const r = await atender(ev({ text: 'una más' }), { memoria, preguntar, now: T0 });
  assert.equal(r.metrica, 'tope_diario');
  assert.equal(r.send[0].text.body, TEXTOS.es.tope);
  assert.equal(llamadas.length, TOPE_DIARIO);
});

test('el tope global solo frena la IA: no corta la atención humana ni BORRAR', async () => {
  const { memoria, charlas } = nuevo();
  const cupo = async () => 'global';
  await memoria.put(NUM, { idioma: 'hr', humanoHasta: 0 });
  const r1 = await atender(ev({ text: 'Imate li web stranice?' }), { memoria, charlas, preguntar: async () => controlada(), now: T0, cupo });
  assert.equal(r1.send[0].text.body, TEXTOS.hr.limite);
  await atender(ev({ text: 'OSOBA' }), { memoria, charlas, preguntar: async () => controlada(), now: T0, cupo });
  const r2 = await atender(ev({ text: 'Imam trgovinu' }), { memoria, charlas, preguntar: async () => controlada(), now: T0 + 1, cupo });
  assert.deepEqual(r2.send, [], 'mientras atiende una persona, el asistente no escribe');
  assert.equal((await charlas.get(NUM)).mensajes.at(-1).texto, 'Imam trgovinu');
  assert.equal((await atender(ev({ text: 'OBRIŠI' }), { memoria, charlas, preguntar: async () => controlada(), now: T0 + 2, cupo })).metrica, 'borrar');
});

test('sin panel, una atención humana que quedó abierta no deja a la persona sin respuesta', async () => {
  const { memoria } = nuevo();
  const { llamadas, preguntar } = preguntas();
  await memoria.put(NUM, { idioma: 'es', humanoHasta: T0 + 3600_000 });
  const r = await atender(ev({ text: '¿Hay alguien?' }), { memoria, charlas: null, preguntar, now: T0 });
  assert.equal(r.metrica, 'ia');
  assert.equal(llamadas.length, 1);
});

test('filtro de WhatsApp: saca dominios ajenos y plata dicha sin moneda; deja los nuestros', () => {
  for (const malo of [
    'Pagá la seña en zustro-pagos.shop y listo.',
    'Visitá zustrolabs-oferta.online.',
    'Sale 50 lucas.',
    'El costo arranca en 500 mangos.',
    'Hacemos un 50% de descuento.',
    'Get a discount at zustro.deals today.',
  ]) assert.equal(filtroWhatsApp(`Hacemos agentes de WhatsApp. ${malo}`).texto, 'Hacemos agentes de WhatsApp.', malo);
  for (const bueno of ['Mirá el Radar en radar.zustrolabs.com.', 'Escribinos a contact@zustrolabs.com.', 'Šahovnica está en croata.zustrolabs.com.'])
    assert.equal(filtroWhatsApp(bueno).texto, bueno);
  assert.equal(formatear(controlada({ respuesta: 'Pagá en estafa.shop.' }), 'en'), TEXTOS.en.sinRespuesta, 'si no queda nada, el texto fijo');
});

// ——— Formato y cerebro ———

test('formatear: links solo de la lista fija, PERSONA si conviene una persona, sin derivar si es fuera de tema', () => {
  assert.equal(formatear(controlada({ enlaces: ['radar'] })), 'Hacemos sitios, apps y agentes de IA.\n\nhttps://radar.zustrolabs.com');
  assert.equal(formatear(controlada({ enlaces: ['https://malo.example'] })), 'Hacemos sitios, apps y agentes de IA.');
  assert.match(formatear(controlada({ escribirnos: true }), 'hr'), /OSOBA/);
  assert.doesNotMatch(formatear(controlada({ escribirnos: true, fuera_de_tema: true })), /PERSONA/);
  assert.equal(formatear(controlada({ notas: ['vacia'], escribirnos: true }), 'en'), TEXTOS.en.sinRespuesta);
});

test('preguntador: usa el prompt de la página más la nota de WhatsApp y pasa por los mismos controles', async () => {
  let cuerpo;
  const llamar = async (c) => {
    cuerpo = c;
    return { salida: { respuesta: 'Sale 300 euros. Escribinos a otro@example.com. Hacemos agentes de WhatsApp.', seccion: 'ninguna', enlace: 'ninguno', escribirnos: true, fuera_de_tema: false }, uso: { input_tokens: 9, output_tokens: 3 } };
  };
  const c = await preguntador({ MODELO: 'modelo-de-prueba' }, { llamar })('¿Cuánto sale?', 'es');
  assert.equal(cuerpo.model, 'modelo-de-prueba');
  assert.match(cuerpo.system, /<informacion>/);
  assert.match(cuerpo.system, /Canal: WhatsApp de Zustro Labs/);
  assert.match(cuerpo.system, /el que eligió: Español/);
  assert.deepEqual(cuerpo.messages, [{ role: 'user', content: '¿Cuánto sale?' }]);
  assert.equal(c.respuesta, 'Hacemos agentes de WhatsApp.', 'sin plata ni correos ajenos');
  assert.deepEqual(c.notas.sort(), ['correo', 'plata']);
  assert.deepEqual(c.uso, { entrada: 9, salida: 3 });
});

test('preguntador: si sale cortada prueba una vez más', async () => {
  let n = 0;
  const llamar = async () => {
    n++;
    if (n === 1) throw new Error('cortada');
    return { salida: { respuesta: 'Hola.', seccion: 'ninguna', enlace: 'ninguno', escribirnos: false, fuera_de_tema: false }, uso: {} };
  };
  assert.equal((await preguntador({}, { llamar })('hola')).respuesta, 'Hola.');
  assert.equal(n, 2);
});

// ——— Envío ———

test('enviar: si Meta rechaza un celular argentino (#131030) prueba la otra forma', async () => {
  const tos = [];
  const fetchImpl = async (url, opts) => {
    const to = JSON.parse(opts.body).to;
    tos.push(to);
    return to === NUM ? Response.json({ error: { code: 131030, message: 'no permitido' } }, { status: 400 }) : Response.json({});
  };
  await enviar(ENV, { to: NUM, type: 'text' }, fetchImpl);
  assert.deepEqual(tos, [NUM, varianteArgentina(NUM)]);
  assert.equal(varianteArgentina('540000000001'), '5490000000001');
  assert.equal(varianteArgentina('385910000000'), null);
});

// ——— Worker ———

async function wa(texto, env = ENV, d = {}, { firma } = {}) {
  const cuerpo = JSON.stringify(payload([{ id: 'wamid.' + Math.random(), from: NUM, timestamp: String(T0 / 1000), type: 'text', text: { body: texto } }]));
  const req = new Request('https://zustrolabs.com/api/whatsapp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Hub-Signature-256': firma ?? (await firmar(cuerpo, env.WHATSAPP_APP_SECRET || 'x')) },
    body: cuerpo,
  });
  return worker.fetch(req, env, {}, d);
}

function deps(o = {}) {
  const enviados = [];
  return {
    enviados,
    fetch: async (url, opts) => (enviados.push(JSON.parse(opts.body)), Response.json({})),
    ...(({ memoria, charlas }) => ({ memoria, charlas }))(nuevo()),
    preguntar: async () => controlada(),
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

test('worker: firma inválida → 401 y no contesta; sin configurar → 503', async () => {
  const d = deps();
  assert.equal((await wa('¿Hacen sitios web?', ENV, d, { firma: 'sha256=' + '0'.repeat(64) })).status, 401);
  assert.equal(d.enviados.length, 0);
  assert.equal((await wa('¿Hacen sitios web?', { ...ENV, WHATSAPP_TOKEN: '' }, d)).status, 503);
  assert.equal((await worker.fetch(new Request('https://zustrolabs.com/otra'), ENV, {}, d)).status, 404);
});

test('worker: PERSONA manda el aviso una vez; si no sale, el registro dice por qué y nunca lleva el número', async () => {
  let avisos = 0;
  const d = deps({ avisar: async () => (avisos++, true) });
  await d.memoria.put(NUM, { idioma: 'es', humanoHasta: 0 });
  await wa('PERSONA', ENV, d);
  assert.equal(d.enviados[0].text.body, TEXTOS.es.persona);
  assert.equal(avisos, 1);
  await wa('Tengo un consultorio', ENV, d);
  assert.equal(avisos, 1);
  assert.equal(d.enviados.length, 1, 'el asistente no contesta mientras atiende una persona');

  for (const [avisar, motivo] of [[async () => false, 'sin_config'], [async () => { throw new TypeError('x'); }, 'TypeError']]) {
    const d2 = deps({ avisar });
    await d2.memoria.put(NUM, { idioma: 'es', humanoHasta: 0 });
    const logs = await conLogs(() => wa('PERSONA', ENV, d2));
    const linea = logs.map((l) => JSON.parse(l)).find((l) => l.que === 'persona');
    assert.equal(linea.avisado, false);
    assert.equal(linea.avisoError, motivo);
    assert.equal(d2.enviados[0].text.body, TEXTOS.es.persona, 'la persona igual recibe la confirmación');
    assert.ok(!logs.join('\n').includes(NUM));
  }
});

test('worker: sin el login del panel, PERSONA deriva a contact@', async () => {
  for (const falta of ['PANEL_EMAILS', 'ACCESS_AUD', 'ACCESS_TEAM_DOMAIN']) {
    const d = deps();
    await d.memoria.put(NUM, { idioma: 'es', humanoHasta: 0 });
    await wa('PERSONA', { ...ENV, [falta]: '' }, d);
    assert.equal(d.enviados[0].text.body, TEXTOS.es.personaMail, falta);
    assert.equal(panelListo({ ...ENV, [falta]: '' }), false);
  }
});

test('worker: límites — sin ellos no contesta; pasado el del número, silencio; pasado el global, avisa', async () => {
  const d1 = deps();
  await wa('¿Hacen sitios web?', { ...ENV, LIMITE: undefined }, d1);
  assert.equal(d1.enviados.length, 0);
  const d2 = deps();
  await wa('¿Hacen sitios web?', { ...ENV, LIMITE: limiteNo }, d2);
  assert.equal(d2.enviados.length, 0);
  const d3 = deps();
  await d3.memoria.put(NUM, { idioma: 'hr', humanoHasta: 0 });
  await wa('Imate li web stranice?', { ...ENV, LIMITE_GLOBAL: limiteNo }, d3);
  assert.equal(d3.enviados[0].text.body, TEXTOS.hr.limite);
});

test('worker: si el modelo falla, avisa en el idioma de la charla y el registro no lleva el texto', async () => {
  const d = deps({ preguntar: async () => { throw new Error('api-529'); } });
  await d.memoria.put(NUM, { idioma: 'en', humanoHasta: 0 });
  const logs = await conLogs(() => wa('a secret question', ENV, d));
  assert.equal(d.enviados[0].text.body, TEXTOS.en.falla);
  assert.ok(!logs.join('\n').includes('secret question'));
});

test('worker: mensajes de más de 1 h se ignoran', async () => {
  const d = deps({ now: T0 + 2 * 3600_000 });
  await wa('¿Hacen sitios web?', ENV, d);
  assert.equal(d.enviados.length, 0);
});

test('worker: equipo.zustrolabs.com va al panel y sin token de Access responde 401', async () => {
  const r = await worker.fetch(new Request(`${ORIGEN_PANEL}/`), ENV, {}, deps());
  assert.equal(r.status, 401);
  const r2 = await worker.fetch(new Request(`${ORIGEN_PANEL}/`), { ...ENV, PANEL_EMAILS: '' }, {}, deps());
  assert.equal(r2.status, 503);
});

// ——— Panel (lo que cambia respecto del Radar) ———

test('panel: marca Zustro Labs, sin «bot» ni «Radar» a la vista', () => {
  assert.match(HTML, /<title>Atención · Zustro Labs<\/title>/);
  assert.doesNotMatch(HTML, /Radar|\bbot\b/);
  assert.equal(PANEL_URL, ORIGEN_PANEL);
  for (const i of IDIOMAS) assert.equal(textoDevuelta(i), TEXTOS[i].devuelta);
});

test('aviso por correo: sale de avisos@avisos, al destino del secreto, sin número ni texto', async () => {
  const m = mailAviso({ from: 'avisos@avisos.zustrolabs.com', to: 'equipo@example.com', now: new Date(T0) });
  assert.match(m, /^From: Zustro Labs <avisos@avisos\.zustrolabs\.com>\r\n/);
  assert.match(m, /Subject: Zustro Labs: hay una charla esperando/);
  assert.match(m, /https:\/\/equipo\.zustrolabs\.com/);
  assert.doesNotMatch(m.split('\r\n\r\n')[1], /\d{6,}/, 'el cuerpo no lleva números de teléfono');
  assert.equal(await avisar({}), false);
  const mandados = [];
  class FakeEmail { constructor(de, para, raw) { Object.assign(this, { de, para, raw }); } }
  assert.equal(await avisar({ AVISO: { send: async (x) => void mandados.push(x) }, AVISO_PARA: 'equipo@example.com' }, FakeEmail), true);
  assert.equal(mandados[0].de, 'avisos@avisos.zustrolabs.com');
  assert.equal(mandados[0].para, 'equipo@example.com');
});

// ——— Reglas del estudio ———

const prohibidas = /precio|contrat[aá]|\bempresas?\b|presupuest|tarifa|\bpric(e|es|ing)\b|\bcompan(y|ies)\b|\bhire\b|cijen|tvrtk|poduzeć|\bbot\b|robot/i;

test('textos fijos: sin palabras prohibidas, el único correo es contact@ y nombran el comando en su idioma', () => {
  for (const i of IDIOMAS) {
    for (const [k, t] of Object.entries(TEXTOS[i])) {
      assert.doesNotMatch(t, prohibidas, `${i}.${k}`);
      for (const c of t.match(/[\w.+-]+@[\w.-]+\w/g) ?? []) assert.equal(c, 'contact@zustrolabs.com', `${i}.${k}`);
    }
  }
  for (const [i, palabra] of [['es', 'PERSONA'], ['hr', 'OSOBA'], ['en', 'PERSON']]) {
    assert.equal(comando(TEXTOS[i].derivar.match(new RegExp(`\\b${palabra}\\b`))[0]), 'persona', i);
    for (const n of [1, 2, 3, 4, 5]) {
      const t = opcion(i, n);
      assert.doesNotMatch(t, prohibidas, `${i}.opcion${n}`);
      assert.match(t, new RegExp(`\\b${palabra}\\b`), `${i}.opcion${n}: al final, cómo hablar con una persona`);
      assert.ok(new TextEncoder().encode(t).length <= 1000, `${i}.opcion${n}: entra en un mensaje de Instagram`);
    }
  }
});

test('tono de captación: saludo con emojis, ¿cómo estás?, menú de cinco opciones y nada de privacidad ni comandos en el saludo', () => {
  assert.match(SALUDO_IDIOMA, /👋/);
  assert.doesNotMatch(SALUDO_IDIOMA, /privacidad|BORRAR|OBRIŠI|DELETE/i);
  for (const [i, como] of [['es', /¿Cómo estás\?/], ['hr', /Kako ste\?/], ['en', /How are you\?/]]) {
    assert.match(TEXTOS[i].bienvenida, como, i);
    for (const n of ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣']) assert.ok(TEXTOS[i].menu.includes(n), `${i}: ${n}`);
    assert.doesNotMatch(TEXTOS[i].bienvenida + TEXTOS[i].menu, /privacidad|privatnost|privacy|90 d|BORRAR|OBRIŠI|DELETE/i, i);
    assert.equal(opcion(i, 6), null);
  }
  assert.match(CANAL_WHATSAPP, /emojis/);
  assert.match(CANAL_WHATSAPP, /no son fuera de tema/);
  assert.match(CANAL_WHATSAPP, /nunca des valores/);
});

test('flujo: saludo → 1/2/3 eligen idioma → ¿cómo estás? + menú → un número da la opción sin gastar IA', async () => {
  const memoria = memoriaPrueba();
  const { llamadas, preguntar } = preguntas();
  await atender(ev({ text: 'Holaa' }), { memoria, preguntar, now: T0 });
  const r = await atender(ev({ text: '3' }), { memoria, preguntar, now: T0 });
  assert.equal(r.metrica, 'idioma');
  assert.deepEqual(r.send.map((m) => m.text.body), [`${TEXTOS.en.bienvenida}\n\n${TEXTOS.en.quienes}`, TEXTOS.en.menu]);
  const o = await atender(ev({ text: '1️⃣' }), { memoria, preguntar, now: T0 });
  assert.equal(o.metrica, 'opcion');
  assert.equal(o.send[0].text.body, opcion('en', 1));
  assert.equal((await atender(ev({ text: 'MENU' }), { memoria, preguntar, now: T0 })).send[0].text.body, TEXTOS.en.menu);
  assert.equal(llamadas.length, 0, 'nada de esto gasta IA');
  // Un número que no está en el menú va al asistente; después de IDIOMA, 2 vuelve a ser un idioma.
  await atender(ev({ text: '7' }), { memoria, preguntar, now: T0 });
  assert.equal(llamadas.length, 1);
  assert.equal((await atender(ev({ text: 'idioma' }), { memoria, preguntar, now: T0 })).metrica, 'pide_idioma');
  const h = await atender(ev({ text: '2' }), { memoria, preguntar, now: T0 });
  assert.equal(h.metrica, 'idioma');
  assert.equal((await memoria.get(NUM)).idioma, 'hr');
});

test('PERSONA también con «asesor», «operador» u «hablar con alguien»', () => {
  for (const t of ['asesor', 'Operador', 'hablar con alguien', 'savjetnik', 'talk to someone']) assert.equal(comando(t), 'persona', t);
  for (const t of ['menú', 'Opciones', 'izbornik', 'MENU']) assert.equal(comando(t), 'menu', t);
});

test('wrangler.toml: rutas propias, sin tocar los subdominios de otros proyectos, y sin registros automáticos', () => {
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /^name = "zustrolabs-whatsapp"$/m);
  assert.match(toml, /pattern = "zustrolabs\.com\/api\/whatsapp\*"/, "con * al final: si no, la verificación de Meta (?hub.mode=…) cae en Pages");
  assert.match(toml, /pattern = "equipo\.zustrolabs\.com", custom_domain = true/);
  const patrones = [...toml.matchAll(/pattern = "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(patrones.every((p) => !/^(croata|api|atencion|radar|avisos|www)\./.test(p) && !p.includes('jgcup')), patrones.join(', '));
  assert.match(toml, /^\[observability\.logs\]\ninvocation_logs = false$/m);
  assert.match(toml, /namespace_id = "1072"/);
  assert.doesNotMatch(toml, /namespace_id = "10(01|68|69|70|71)"/, 'no comparte límites con otros Workers');
  assert.doesNotMatch(toml, /^(ANTHROPIC_API_KEY|WHATSAPP_TOKEN|WHATSAPP_APP_SECRET|AVISO_PARA|PANEL_EMAILS)\s*=/m, 'los secretos no van en el repo');
});

test('la charla de las capturas (30/10): quien ya eligió idioma otro día y saluda, ve presentación y menú; «hablo en inglés» cambia el idioma; «¿qué hacen?» y «¿qué me ofrecés?» muestran el menú', async () => {
  const memoria = memoriaPrueba();
  const { llamadas, preguntar } = preguntas();
  await memoria.put(NUM, { idioma: 'es', humanoHasta: 0 }); // eligió castellano ayer
  const hola = await atender(ev({ text: 'Hola, como te va?' }), { memoria, preguntar, now: T0 });
  assert.equal(hola.metrica, 'saludo');
  assert.deepEqual(hola.send.map((m) => m.text.body), [`${TEXTOS.es.hola}\n\n${TEXTOS.es.quienes}`, TEXTOS.es.menu]);
  const ingles = await atender(ev({ text: 'Hablo en inglés' }), { memoria, preguntar, now: T0 });
  assert.equal(ingles.metrica, 'idioma');
  assert.equal(ingles.send[1].text.body, TEXTOS.en.menu);
  assert.equal((await memoria.get(NUM)).idioma, 'en');
  await memoria.put(NUM, { idioma: 'es', humanoHasta: 0 });
  for (const t of ['Que es lo que hacen?', 'Que me ofreces?', '¿A qué se dedican?', 'info']) {
    const r = await atender(ev({ text: t }), { memoria, preguntar, now: T0 });
    assert.equal(r.metrica, 'presentacion', t);
    assert.deepEqual(r.send.map((m) => m.text.body), [TEXTOS.es.quienes, TEXTOS.es.menu], t);
  }
  assert.equal(llamadas.length, 0, 'nada de esto gasta IA');
  // Lo que trae contenido sí va al asistente.
  for (const t of ['hola quiero una web para mi panadería', '¿cuánto sale una web?']) await atender(ev({ text: t }), { memoria, preguntar, now: T0 });
  assert.equal(llamadas.length, 2);
});

test('primer contacto: si pregunta qué hacemos sin elegir idioma, se toma el idioma de la pregunta; si vuelve a saludar, se repregunta el idioma', async () => {
  const memoria = memoriaPrueba();
  const { preguntar } = preguntas();
  assert.equal((await atender(ev({ text: 'Hola' }), { memoria, preguntar, now: T0 })).metrica, 'pide_idioma');
  assert.equal((await atender(ev({ text: 'Holaaa' }), { memoria, preguntar, now: T0 })).metrica, 'pide_idioma');
  const r = await atender(ev({ text: 'What do you do?' }), { memoria, preguntar, now: T0 });
  assert.equal(r.metrica, 'presentacion');
  assert.deepEqual(r.send.map((m) => m.text.body), [TEXTOS.en.quienes, TEXTOS.en.menu]);
  assert.equal((await memoria.get(NUM)).idioma, 'en');
});
