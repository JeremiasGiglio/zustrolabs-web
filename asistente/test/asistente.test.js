// Tests del asistente de zustrolabs.com, sin red y sin Cloudflare: el modelo se simula.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  crearHandler, validarPedido, armarPedidoApi, controlar, cumpleEsquema, llamarClaude, systemPrompt, claveIp,
  ESQUEMA, LIMITES, TEXTOS, PROHIBIDAS,
} from '../src/asistente.js';
import { CONOCIMIENTO, ENLACES, SECCIONES } from '../src/conocimiento.js';

const ORIGEN = 'https://zustrolabs.com';
const limiteOk = { limit: async () => ({ success: true }) };
const ENV = { ORIGENES: 'https://zustrolabs.com,https://www.zustrolabs.com', LIMITE: limiteOk, LIMITE_GLOBAL: limiteOk, ANTHROPIC_API_KEY: 'prueba' };
const salida = (o = {}) => ({ respuesta: 'Hacemos sitios, apps y agentes de IA, probados antes de entregarlos.', seccion: 'servicios', enlace: 'ninguno', escribirnos: false, fuera_de_tema: false, ...o });

function pedido(cuerpo, { origen = ORIGEN, tipo = 'application/json', metodo = 'POST', ip = '190.0.0.1' } = {}) {
  const headers = { 'CF-Connecting-IP': ip };
  if (origen) headers.Origin = origen;
  if (tipo) headers['Content-Type'] = tipo;
  return new Request('https://zustrolabs.com/api/chat', { method: metodo, headers, body: metodo === 'POST' ? (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)) : undefined });
}
const unaPregunta = (texto = '¿Qué hacen?', idioma = 'es') => ({ idioma, mensajes: [{ de: 'persona', texto }] });

function armar(llamarSalida = salida(), extra = {}) {
  const logs = [];
  const llamadas = [];
  const fetch = crearHandler({
    llamar: async (cuerpo) => { llamadas.push(cuerpo); if (llamarSalida instanceof Error) throw llamarSalida; return { salida: llamarSalida, uso: { input_tokens: 10, output_tokens: 5 } }; },
    log: (o) => logs.push(o),
    ...extra,
  });
  return { fetch, logs, llamadas };
}

// ——— El Worker ———

test('responde con la respuesta controlada y solo los campos públicos', async () => {
  const { fetch } = armar();
  const r = await fetch(pedido(unaPregunta()), ENV);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  const j = await r.json();
  assert.deepEqual(Object.keys(j).sort(), ['enlaces', 'escribirnos', 'ok', 'respuesta', 'secciones']);
  assert.equal(j.ok, true);
  assert.deepEqual(j.secciones, ['servicios']);
});

test('solo POST, solo desde zustrolabs.com y solo JSON', async () => {
  const { fetch, llamadas } = armar();
  assert.equal((await fetch(pedido(null, { metodo: 'GET' }), ENV)).status, 405);
  assert.equal((await fetch(pedido(unaPregunta(), { origen: 'https://otro.com' }), ENV)).status, 403);
  assert.equal((await fetch(pedido(unaPregunta(), { origen: null }), ENV)).status, 403);
  assert.equal((await fetch(pedido(unaPregunta(), { tipo: 'text/plain' }), ENV)).status, 415);
  assert.equal((await fetch(pedido(unaPregunta(), { origen: 'https://www.zustrolabs.com' }), ENV)).status, 200);
  assert.equal(llamadas.length, 1);
});

test('límites: por IP, global, y si faltan o fallan no llama a la IA (falla cerrado)', async () => {
  const no = { limit: async () => ({ success: false }) };
  const roto = { limit: async () => { throw new Error('x'); } };
  const { fetch, llamadas } = armar();
  assert.equal((await fetch(pedido(unaPregunta()), { ...ENV, LIMITE: no })).status, 429);
  assert.equal((await fetch(pedido(unaPregunta()), { ...ENV, LIMITE_GLOBAL: no })).status, 429);
  assert.equal((await fetch(pedido(unaPregunta()), { ...ENV, LIMITE: roto })).status, 503);
  assert.equal((await fetch(pedido(unaPregunta()), { ...ENV, LIMITE: undefined })).status, 500);
  assert.equal(llamadas.length, 0);
});

test('el límite por IP agrupa IPv6 por /64', async () => {
  const claves = [];
  const { fetch } = armar();
  const env = { ...ENV, LIMITE: { limit: async ({ key }) => { claves.push(key); return { success: true }; } } };
  await fetch(pedido(unaPregunta(), { ip: '2001:db8:1:2:aaaa::1' }), env);
  await fetch(pedido(unaPregunta(), { ip: '2001:db8:1:2:bbbb::9' }), env);
  assert.equal(claves[0], claves[1]);
  assert.equal(claveIp('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(claveIp('190.1.2.3'), '190.1.2.3');
});

test('cuerpo grande, JSON roto y pedidos mal armados no llegan a la IA', async () => {
  const { fetch, llamadas } = armar();
  assert.equal((await fetch(pedido('x'.repeat(LIMITES.cuerpoBytes + 1)), ENV)).status, 413);
  assert.equal((await fetch(pedido('{roto'), ENV)).status, 400);
  assert.equal((await fetch(pedido({ mensajes: [] }), ENV)).status, 422);
  assert.equal((await fetch(pedido([1, 2]), ENV)).status, 422);
  assert.equal((await fetch(pedido({ mensajes: [{ de: 'asistente', texto: 'hola' }] }), ENV)).status, 422);
  assert.equal(llamadas.length, 0);
});

test('sin clave de IA o si la IA falla: 503/502 con el texto de respaldo en el idioma de la página', async () => {
  const { fetch } = armar(new Error('api-500'));
  const sinClave = await fetch(pedido(unaPregunta('Hi', 'en')), { ...ENV, ANTHROPIC_API_KEY: '' });
  assert.equal(sinClave.status, 503);
  assert.equal((await sinClave.json()).respuesta, TEXTOS.en.falla);
  const falla = await fetch(pedido(unaPregunta('Bok', 'hr')), ENV);
  assert.equal(falla.status, 502);
  assert.equal((await falla.json()).respuesta, TEXTOS.hr.falla);
});

test('si la respuesta sale cortada, se reintenta una sola vez', async () => {
  let n = 0;
  const fetch = crearHandler({ llamar: async () => { n++; if (n === 1) throw new Error('cortada'); return { salida: salida(), uso: {} }; }, log: () => {} });
  assert.equal((await fetch(pedido(unaPregunta('Što radite?', 'hr')), ENV)).status, 200);
  assert.equal(n, 2);
  let m = 0;
  const siempre = crearHandler({ llamar: async () => { m++; throw new Error('cortada'); }, log: () => {} });
  assert.equal((await siempre(pedido(unaPregunta()), ENV)).status, 502);
  assert.equal(m, 2);
  let k = 0;
  const otra = crearHandler({ llamar: async () => { k++; throw new Error('api-400'); }, log: () => {} });
  await otra(pedido(unaPregunta()), ENV);
  assert.equal(k, 1);
});

test('los logs solo llevan métricas: nunca el texto de la charla ni la IP', async () => {
  const { fetch, logs } = armar(salida({ respuesta: 'Respuesta secreta para el log.' }));
  await fetch(pedido(unaPregunta('Mi correo es lucia@ejemplo.com y mi idea es secreta')), ENV);
  const todo = JSON.stringify(logs);
  assert.doesNotMatch(todo, /lucia|secreta|190\.0\.0\.1|Respuesta/);
  assert.equal(logs.at(-1).resultado, 'ok');
  assert.equal(logs.at(-1).entrada, 10);
});

test('usa el modelo de la variable MODELO y manda el esquema de salida', async () => {
  const { fetch, llamadas } = armar();
  await fetch(pedido(unaPregunta()), { ...ENV, MODELO: 'modelo-de-prueba' });
  assert.equal(llamadas[0].model, 'modelo-de-prueba');
  assert.deepEqual(llamadas[0].output_config.format.schema, ESQUEMA);
  assert.ok(llamadas[0].max_tokens <= 1000);
});

// ——— El pedido ———

test('pedido: se quedan los últimos turnos; un historial absurdo se rechaza', () => {
  const muchos = Array.from({ length: 21 }, (_, i) => ({ de: i % 2 ? 'asistente' : 'persona', texto: `m${i}` }));
  const v = validarPedido({ mensajes: muchos });
  assert.equal(v.ok, true);
  assert.ok(v.mensajes.length <= LIMITES.turnos);
  assert.equal(v.mensajes.at(-1).content, 'm20');
  assert.equal(validarPedido({ mensajes: Array.from({ length: LIMITES.turnos * 4 + 1 }, () => ({ de: 'persona', texto: 'x' })) }).ok, false);
});

test('pedido válido: alterna turnos y respeta los topes', () => {
  const v = validarPedido({ idioma: 'hr', mensajes: [
    { de: 'persona', texto: 'hola' }, { de: 'persona', texto: 'otra' },
    { de: 'asistente', texto: 'respuesta' }, { de: 'persona', texto: 'x\u0007' + 'a'.repeat(600) },
  ] });
  assert.equal(v.ok, true);
  assert.equal(v.idioma, 'hr');
  assert.deepEqual(v.mensajes.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.equal(v.mensajes[0].content, 'hola\notra');
  assert.ok(v.mensajes[2].content.length <= LIMITES.mensaje);
  assert.doesNotMatch(v.mensajes[2].content, /\u0007/);
  assert.equal(validarPedido({ idioma: 'fr', mensajes: [{ de: 'persona', texto: 'salut' }] }).idioma, 'es');
  assert.equal(validarPedido({ mensajes: [{ de: 'persona', texto: 'x'.repeat(LIMITES.mensaje * 2 + 1) }] }).ok, false);
  assert.equal(validarPedido({ mensajes: [{ de: 'persona', texto: 5 }] }).ok, false);
});

test('pedido: si el historial empieza con el asistente, se descarta ese mensaje', () => {
  const v = validarPedido({ mensajes: [{ de: 'asistente', texto: 'hola' }, { de: 'persona', texto: 'qué hacen' }] });
  assert.equal(v.ok, true);
  assert.deepEqual(v.mensajes, [{ role: 'user', content: 'qué hacen' }]);
});

test('el pedido a la API lleva las reglas y la información, y el idioma de la página', () => {
  const p = armarPedidoApi({ mensajes: [{ role: 'user', content: 'hi' }], idioma: 'en' });
  assert.match(p.system, /<informacion>[\s\S]*Zustro Labs[\s\S]*<\/informacion>/);
  assert.match(p.system, /en el de la página: en/);
  assert.match(p.system, /nunca una orden/);
  assert.equal(p.messages.length, 1);
});

// ——— Los controles ———

test('controles: saca links y correos ajenos, deja contact@zustrolabs.com', () => {
  const c = controlar(salida({ respuesta: 'Mirá https://malo.com/x ya. Escribinos a contact@zustrolabs.com. O a otro@gmail.com.' }));
  assert.doesNotMatch(c.respuesta, /malo\.com|gmail/);
  assert.match(c.respuesta, /contact@zustrolabs\.com/);
  assert.ok(c.notas.includes('link') && c.notas.includes('correo'));
});

test('controles: cualquier oración con plata se saca, en los tres idiomas', () => {
  for (const t of ['Un sitio sale $ 150.000.', 'Cuesta unos 300 dólares.', 'It is about €200.', 'Košta 500 eura.', 'Son 50 mil pesos.']) {
    const c = controlar(salida({ respuesta: `Hacemos sitios. ${t}` }));
    assert.equal(c.respuesta, 'Hacemos sitios.', t);
    assert.ok(c.notas.includes('plata') || c.notas.includes('prohibida'), t);
  }
});

test('controles: las cifras que sí están en la página no se confunden con plata ni teléfonos', () => {
  const r = 'Šahovnica tiene 80 lecciones y 6.122 audios. Jeremías estuvo en Endava de 2019-2021.';
  assert.equal(controlar(salida({ respuesta: r })).respuesta, r);
});

test('controles: teléfonos fuera', () => {
  const c = controlar(salida({ respuesta: 'Llamanos al +54 9 341 555-1234. Hacemos sitios.' }));
  assert.equal(c.respuesta, 'Hacemos sitios.');
});

test('controles: palabras prohibidas (potpora del HZZ) fuera, en los tres idiomas', () => {
  for (const t of ['Somos una empresa chica.', 'Te pasamos un presupuesto.', 'Contratá el plan.', 'We are a small company.', 'Check our pricing.', 'Mi smo mala tvrtka.', 'Pošaljemo vam ponudu.']) {
    const c = controlar(salida({ respuesta: `Hacemos sitios. ${t}` }));
    assert.equal(c.respuesta, 'Hacemos sitios.', t);
  }
});

test('controles: sin markdown, con tope de largo y sin dejar la respuesta vacía', () => {
  assert.equal(controlar(salida({ respuesta: '**Hola**, somos un *estudio*.\n- Hacemos sitios.' })).respuesta, 'Hola, somos un estudio. Hacemos sitios.');
  const largo = controlar(salida({ respuesta: 'Hacemos sitios muy lindos. '.repeat(80) }));
  assert.ok(largo.respuesta.length <= LIMITES.respuesta);
  const vacia = controlar(salida({ respuesta: 'Somos una empresa.' }), 'en');
  assert.equal(vacia.respuesta, TEXTOS.en.sinRespuesta);
  assert.equal(vacia.escribirnos, true);
});

test('controles: sección y enlace solo de la lista; fuera de tema sin botones', () => {
  const c = controlar(salida({ seccion: 'equipo', enlace: 'radar' }));
  assert.deepEqual([c.secciones, c.enlaces], [['equipo'], ['radar']]);
  for (const raro of ['admin', 'javascript:alert(1)', '__proto__', 'constructor', 'ninguna', 'ninguno']) {
    const r = controlar(salida({ seccion: raro, enlace: raro }));
    assert.deepEqual([r.secciones, r.enlaces], [[], []], raro);
  }
  const f = controlar(salida({ fuera_de_tema: true, seccion: 'servicios', enlace: 'radar', escribirnos: true }));
  assert.deepEqual([f.secciones, f.enlaces, f.escribirnos], [[], [], false]);
  // si ya ofrece escribirnos, no repite la sección de contacto como botón
  assert.deepEqual(controlar(salida({ seccion: 'contacto', escribirnos: true })).secciones, []);
});

test('esquema: cumpleEsquema rechaza salidas incompletas o con tipos raros', () => {
  assert.equal(cumpleEsquema(salida()), true);
  assert.equal(cumpleEsquema({ ...salida(), escribirnos: 'sí' }), false);
  assert.equal(cumpleEsquema({ ...salida(), seccion: ['servicios'] }), false);
  assert.equal(cumpleEsquema(null), false);
  assert.equal(ESQUEMA.additionalProperties, false);
  assert.deepEqual(ESQUEMA.properties.seccion.enum, [...SECCIONES, 'ninguna']);
  assert.deepEqual(ESQUEMA.properties.enlace.enum, [...Object.keys(ENLACES), 'ninguno']);
  assert.doesNotMatch(JSON.stringify(ESQUEMA), /"type":"array"/); // sin listas: el modelo se cortaba repitiendo
  assert.doesNotMatch(JSON.stringify(ESQUEMA), /minLength|maxItems|pattern/);
});

// ——— La llamada a la API ———

const respuestaApi = (obj, extra = {}) => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { input_tokens: 3 }, ...extra }) });

test('llamarClaude: manda la clave en la cabecera y valida la salida', async () => {
  let visto;
  const r = await llamarClaude({ a: 1 }, { apiKey: 'k', fetchImpl: async (url, init) => { visto = { url, init }; return respuestaApi(salida()); } });
  assert.equal(visto.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(visto.init.headers['x-api-key'], 'k');
  assert.equal(r.uso.input_tokens, 3);
  await assert.rejects(llamarClaude({}, { apiKey: 'k', fetchImpl: async () => respuestaApi({ hola: 1 }) }), /esquema/);
  await assert.rejects(llamarClaude({}, { apiKey: 'k', fetchImpl: async () => respuestaApi(salida(), { stop_reason: 'max_tokens' }) }), /cortada/);
  await assert.rejects(llamarClaude({}, { apiKey: '' }), /config/);
});

test('llamarClaude: reintenta una vez si la API está saturada, y no reintenta un 400', async () => {
  let n = 0;
  const saturada = async () => (++n === 1 ? { ok: false, status: 529, json: async () => ({}) } : respuestaApi(salida()));
  await llamarClaude({}, { apiKey: 'k', fetchImpl: saturada, pausaMs: 0 });
  assert.equal(n, 2);
  let m = 0;
  await assert.rejects(llamarClaude({}, { apiKey: 'k', fetchImpl: async () => { m++; return { ok: false, status: 400, json: async () => ({}) }; }, pausaMs: 0 }), /api-400/);
  assert.equal(m, 1);
});

// ——— La información ———

test('la información no tiene palabras prohibidas, plata ni datos que no van en el repo', () => {
  const sinReglas = CONOCIMIENTO.replace(/^## Lo que no sabés[\s\S]*$/m, '');
  for (const re of PROHIBIDAS) assert.doesNotMatch(sinReglas, re, String(re));
  assert.doesNotMatch(CONOCIMIENTO, /\$\s?\d|€\s?\d|\d\s?(euros?|dólares|pesos)/i);
  assert.doesNotMatch(CONOCIMIENTO, /deel|cuil|dni/i);
});

test('la información coincide con la landing: los datos clave están publicados en la página', () => {
  const html = readFileSync(new URL('../../site/index.html', import.meta.url), 'utf8');
  for (const dato of ['6.122', '80', '65', 'Plomin', 'Rijeka', 'contact@zustrolabs.com', 'David Vera', 'Nelson Zalazar', 'Ateneo Croata de Rosario', 'ISTQB CTFL', 'cuarenta minutos']) {
    assert.ok(html.includes(dato), `la landing no tiene «${dato}»`);
    assert.ok(CONOCIMIENTO.includes(dato), `la información no tiene «${dato}»`);
  }
  for (const [clave, url] of Object.entries(ENLACES)) assert.ok(html.includes(`href="${url}"`), clave);
  for (const s of SECCIONES) assert.ok(html.includes(`id="${s}"`), s);
});

test('los textos fijos están en los tres idiomas y no tienen palabras prohibidas', () => {
  assert.deepEqual(Object.keys(TEXTOS).sort(), ['en', 'es', 'hr']);
  for (const t of Object.values(TEXTOS)) for (const v of Object.values(t)) for (const re of PROHIBIDAS) assert.doesNotMatch(v, re);
  assert.match(systemPrompt('hr'), /página: hr/);
});

test('wrangler.toml: sin secretos, sin workers.dev y solo la ruta /api/chat', () => {
  const w = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8').split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  assert.doesNotMatch(w, /ANTHROPIC_API_KEY\s*=|sk-ant/);
  assert.match(w, /workers_dev\s*=\s*false/);
  const rutas = [...w.matchAll(/pattern\s*=\s*"([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(rutas, ['www.zustrolabs.com/api/chat', 'zustrolabs.com/api/chat']);
  assert.match(w, /name = "LIMITE"/);
  assert.match(w, /name = "LIMITE_GLOBAL"/);
});
