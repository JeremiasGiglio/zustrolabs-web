// WhatsApp de cada negocio por YCloud (ZL-135): firma, lectura de avisos, envío, alta del número y el circuito entero
// por el Worker. Sin red: YCloud se simula. La ficha es FICTICIA (Panadería La Espiga, test/ficha-prueba.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { adaptadores, almacenPrueba, crearAtencion } from '../src/atencion.js';
import { crearCatalogo, ejecutarCatalogo } from '../src/catalogo.js';
import { sqlPrueba } from './sqlite.js';
import { claveMemoria, crearWebhook, enviarYCloud, firmarYCloud, firmaYCloud, idCharla, leerYCloud, normalizar, numeroE164 } from '../src/ycloud.js';

// ZL-149: con opciones, YCloud recibe botones o una lista: el texto va en interactive.body.text.
const textoYC = (b) => b?.text?.body ?? b?.interactive?.body?.text;
const FICHA = readFileSync(new URL('./ficha-prueba.md', import.meta.url), 'utf8');
const T0 = 1_792_000_000_000;
const NEGOCIO_TEL = '+5493410000001';
const PERSONA_TEL = '+5493410000009';
const limiteOk = { limit: async () => ({ success: true }) };
const ENV = { IG_APP_ID: '1000000000000001', IG_APP_SECRET: 'secreto-ig-prueba', IG_ADMIN_CLAVE: 'clave-admin-prueba', LIMITE: limiteOk, LIMITE_GLOBAL: limiteOk };
const CLAVE_API = 'clave-api-ycloud-de-prueba-123';

const entrante = (texto, o = {}) => ({
  id: 'evt_' + Math.random(), type: 'whatsapp.inbound_message.received', apiVersion: 'v2', createTime: new Date(T0).toISOString(),
  whatsappInboundMessage: { id: 'm' + Math.random(), wamid: 'wamid.' + Math.random(), wabaId: '1', from: PERSONA_TEL, to: NEGOCIO_TEL, sendTime: new Date(T0).toISOString(), type: 'text', text: { body: texto }, ...o },
});
const eco = (texto, o = {}) => ({
  id: 'evt_' + Math.random(), type: 'whatsapp.smb.message.echoes', apiVersion: 'v2', createTime: new Date(T0).toISOString(),
  whatsappMessage: { id: 'x', wamid: 'wamid.e', wabaId: '1', from: NEGOCIO_TEL, to: PERSONA_TEL, type: 'text', text: { body: texto }, status: 'sent', sendTime: new Date(T0).toISOString(), ...o },
});

// ——— Piezas ———

test('firma: solo vale la de ese secreto, sobre el cuerpo exacto y de hace menos de 5 minutos', async () => {
  const cuerpo = JSON.stringify(entrante('hola'));
  const t = T0 / 1000;
  const firma = await firmarYCloud(cuerpo, 'secreto-1', t);
  assert.equal(await firmaYCloud(cuerpo, firma, 'secreto-1', T0), true);
  assert.equal(await firmaYCloud(cuerpo, firma, 'otro-secreto', T0), false);
  assert.equal(await firmaYCloud(cuerpo + ' ', firma, 'secreto-1', T0), false, 'el cuerpo exacto, no uno parecido');
  assert.equal(await firmaYCloud(cuerpo, firma, 'secreto-1', T0 + 301_000), false, 'vieja');
  assert.equal(await firmaYCloud(cuerpo, null, 'secreto-1', T0), false);
  assert.equal(await firmaYCloud(cuerpo, 't=abc,s=123', 'secreto-1', T0), false);
});

test('lectura: un mensaje de texto, uno que no es texto, un botón, un eco del dueño y lo que no sirve', () => {
  const [t] = leerYCloud(entrante('¿Tienen facturas?'));
  assert.deepEqual({ from: t.from, kind: t.kind, text: t.text, ts: t.ts }, { from: 'yc:5493410000001:5493410000009', kind: 'text', text: '¿Tienen facturas?', ts: T0 / 1000 });
  assert.equal(leerYCloud(entrante('', { type: 'image', text: undefined, image: { id: 'x' } }))[0].kind, 'otro');
  assert.equal(leerYCloud(entrante('', { type: 'button', text: undefined, button: { text: 'Sí' } }))[0].text, 'Sí');
  assert.deepEqual(leerYCloud(eco('ya te contesto yo')), [{ eco: true, from: 'yc:5493410000001:5493410000009', ts: T0 / 1000 }]);
  // Una reacción (👍 a un mensaje del dueño) no es un mensaje para contestar.
  assert.deepEqual(leerYCloud(entrante('', { type: 'reaction', text: undefined, reaction: { emoji: '👍' } })), []);
  assert.deepEqual(leerYCloud({ type: 'whatsapp.message.updated', whatsappMessage: {} }), []);
  assert.deepEqual(leerYCloud(null), []);
});

test('firma: en mayúsculas también vale', async () => {
  const cuerpo = JSON.stringify(entrante('hola'));
  const firma = (await firmarYCloud(cuerpo, 'secreto-1', T0 / 1000)).replace(/s=([0-9a-f]+)/, (_, h) => `s=${h.toUpperCase()}`);
  assert.equal(await firmaYCloud(cuerpo, firma, 'secreto-1', T0), true);
});

test('números: el mismo celular escrito de dos formas (Argentina con o sin 9, México con o sin 1) es la misma charla', () => {
  assert.equal(normalizar('+54 341 000 0009'), '5493410000009');
  assert.equal(normalizar('5493410000009'), '5493410000009');
  assert.equal(normalizar('5215512345678'), '525512345678');
  assert.equal(normalizar('+34600000000'), '34600000000');
  assert.equal(claveMemoria('yc:543410000001:543410000009'), claveMemoria('yc:5493410000001:5493410000009'));
  // Para responder se usa el número tal como vino.
  assert.equal(idCharla('+543410000001', '+543410000009'), 'yc:543410000001:543410000009');
});

test('números: con código de país, con o sin espacios; la charla une el número del negocio y el de la persona', () => {
  assert.equal(numeroE164('+54 9 341 000-0001'), '+5493410000001');
  assert.equal(numeroE164('5493410000001'), '+5493410000001');
  assert.equal(numeroE164('341'), null);
  assert.equal(numeroE164('hola'), null);
  assert.equal(idCharla('+5493410000001', '+5493410000009'), 'yc:5493410000001:5493410000009');
});

test('envío: sendDirectly con la clave del negocio, desde su número a la persona', async () => {
  const pedidos = [];
  const fake = async (url, o) => (pedidos.push({ url, o }), Response.json({ id: 'y1', status: 'accepted' }));
  await enviarYCloud(CLAVE_API, { to: 'yc:5493410000001:5493410000009', text: { body: 'Hola 👋' } }, fake);
  assert.equal(pedidos[0].url, 'https://api.ycloud.com/v2/whatsapp/messages/sendDirectly');
  assert.equal(pedidos[0].o.headers['X-API-Key'], CLAVE_API);
  assert.deepEqual(JSON.parse(pedidos[0].o.body), { from: '+5493410000001', to: '+5493410000009', type: 'text', text: { body: 'Hola 👋' } });
  await assert.rejects(() => enviarYCloud(CLAVE_API, { to: 'yc:1:2', text: { body: 'x' } }, async () => new Response('', { status: 401 })), /ycloud 401/);
  await assert.rejects(() => enviarYCloud(CLAVE_API, { to: 'yc:1:2', text: { body: 'x' } }, async () => Response.json({ status: 'failed', errorCode: 'X' })), /ycloud X/);
  await assert.rejects(() => enviarYCloud(CLAVE_API, { to: 'ig:1.2', text: { body: 'x' } }, fake), /destino/);
});

test('webhook en YCloud: con los ecos del dueño; si la cuenta no los acepta, solo con los mensajes entrantes', async () => {
  const pedidos = [];
  const ok = await crearWebhook(CLAVE_API, 'https://zustrolabs.com/api/whatsapp/ycloud/abc', async (url, o) => (pedidos.push(JSON.parse(o.body)), Response.json({ id: 'we1', secret: 'sec' })));
  assert.deepEqual(ok, { id: 'we1', secreto: 'sec', ecos: true });
  assert.deepEqual(pedidos[0].enabledEvents, ['whatsapp.inbound_message.received', 'whatsapp.smb.message.echoes']);
  let n = 0;
  const sin = await crearWebhook(CLAVE_API, 'https://x', async () => (++n === 1 ? new Response('', { status: 400 }) : Response.json({ id: 'we2', secret: 's2' })));
  assert.deepEqual(sin, { id: 'we2', secreto: 's2', ecos: false });
  await assert.rejects(() => crearWebhook(CLAVE_API, 'https://x', async () => new Response('', { status: 401 })), /no aceptó la clave/);
});

// ——— El circuito por el Worker ———

async function armar() {
  const n = adaptadores(crearAtencion(almacenPrueba()), () => T0);
  const { negocio } = await n.negocios.guardar(null, { nombre: 'Panadería La Espiga', emails: [], cuentas: [] });
  const ycloud = [];
  const llamadas = [];
  let secreto = 'secreto-webhook-de-ycloud';
  const d = {
    ...n, now: T0,
    fetch: async (url, o) => {
      ycloud.push({ url, metodo: o?.method, clave: o?.headers?.['X-API-Key'], body: o?.body ? JSON.parse(o.body) : null });
      if (url.endsWith('/webhookEndpoints')) return Response.json({ id: 'we_1', secret: secreto });
      return Response.json({ id: 'y', status: 'accepted' });
    },
    preguntarNegocio: (f) => async (t) => (llamadas.push([f.nombre, t]), { respuesta: `Respuesta de ${f.nombre}.`, persona: false, fuera_de_tema: false, vacia: false, notas: [] }),
  };
  const admin = (metodo, ruta, cuerpo, clave = ENV.IG_ADMIN_CLAVE) =>
    worker.fetch(new Request(`https://zustrolabs.com/api/instagram/admin${ruta}`, { method: metodo, headers: { authorization: `Bearer ${clave}`, 'content-type': 'application/json' }, ...(cuerpo && { body: JSON.stringify(cuerpo) }) }), ENV, {}, d);
  const avisar = async (clave, payload, sec = secreto) => {
    const cuerpo = JSON.stringify(payload);
    return worker.fetch(new Request(`https://zustrolabs.com/api/whatsapp/ycloud/${clave}`, { method: 'POST', headers: { 'YCloud-Signature': await firmarYCloud(cuerpo, sec, T0 / 1000) }, body: cuerpo }), ENV, {}, d);
  };
  return { n, d, negocio, ycloud, llamadas, admin, avisar, setSecreto: (s) => (secreto = s) };
}
const enviados = (ycloud) => ycloud.filter((p) => p.url.endsWith('/sendDirectly'));

test('admin: conectar un número crea el webhook en la cuenta del negocio, guarda la clave sin devolverla y enciende WhatsApp', async () => {
  const { n, negocio, ycloud, admin } = await armar();
  assert.equal((await admin('POST', '/ycloud', { negocio: negocio.id, numero: '+54 9 341 000-0001', apiKey: CLAVE_API }, 'mala')).status, 401);
  assert.equal((await admin('POST', '/ycloud', { negocio: 'no-existe', numero: NEGOCIO_TEL, apiKey: CLAVE_API })).status, 404);
  assert.match((await (await admin('POST', '/ycloud', { negocio: negocio.id, numero: '341', apiKey: CLAVE_API })).json()).error, /código de país/);
  assert.match((await (await admin('POST', '/ycloud', { negocio: negocio.id, numero: NEGOCIO_TEL, apiKey: 'corta' })).json()).error, /incompleta/);
  const r = await admin('POST', '/ycloud', { negocio: negocio.id, numero: '+54 9 341 000-0001', apiKey: CLAVE_API });
  const datos = await r.json();
  assert.equal(r.status, 200);
  assert.equal(datos.numero, NEGOCIO_TEL);
  assert.equal(datos.ecos, true);
  assert.match(datos.clave, /^[0-9a-f]{24}$/);
  assert.doesNotMatch(JSON.stringify(datos), /clave-api|secreto-webhook/, 'ni la clave ni el secreto vuelven');
  assert.equal(ycloud[0].url, 'https://api.ycloud.com/v2/webhookEndpoints');
  assert.equal(ycloud[0].clave, CLAVE_API);
  assert.equal(ycloud[0].body.url, `https://zustrolabs.com/api/whatsapp/ycloud/${datos.clave}`);
  assert.equal((await n.negocios.get(negocio.id)).canales.whatsapp, true);
  const lista = await (await admin('GET', '/ycloud')).json();
  assert.deepEqual(lista.numeros.map((x) => x.numero), [NEGOCIO_TEL]);
  assert.doesNotMatch(JSON.stringify(lista), /clave-api|secreto-webhook/);
  assert.equal((await admin('POST', '/ycloud', { negocio: negocio.id, numero: NEGOCIO_TEL, apiKey: CLAVE_API })).status, 409, 'el mismo número dos veces, no');
  // Borrar: quita el webhook de YCloud y el registro.
  const b = await (await admin('DELETE', `/ycloud/${datos.clave}`)).json();
  assert.equal(b.webhookBorrado, true);
  assert.equal(ycloud.at(-1).metodo, 'DELETE');
  assert.equal(ycloud.at(-1).url, 'https://api.ycloud.com/v2/webhookEndpoints/we_1');
  assert.deepEqual((await (await admin('GET', '/ycloud')).json()).numeros, []);
});

test('admin: si YCloud no acepta la clave, el script recibe el motivo y no se guarda nada', async () => {
  const { d, negocio, admin } = await armar();
  d.fetch = async () => new Response('', { status: 401 });
  const r = await admin('POST', '/ycloud', { negocio: negocio.id, numero: NEGOCIO_TEL, apiKey: CLAVE_API });
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /no aceptó la clave/);
  assert.deepEqual((await (await admin('GET', '/ycloud')).json()).numeros, []);
});

test('circuito: sin ficha activa no responde; con la ficha, saluda, contesta con la IA del negocio y responde por YCloud', async () => {
  const { n, negocio, ycloud, llamadas, admin, avisar } = await armar();
  const { clave } = await (await admin('POST', '/ycloud', { negocio: negocio.id, numero: NEGOCIO_TEL, apiKey: CLAVE_API })).json();
  assert.equal((await avisar(clave, entrante('hola'))).status, 200);
  assert.equal(enviados(ycloud).length, 0, 'sin ficha no responde');
  await n.negocios.guardarFicha(negocio.id, { texto: FICHA, activa: true });
  await avisar(clave, entrante('hola'));
  const saludo = enviados(ycloud);
  assert.equal(saludo.length, 1, 'ZL-146: un solo mensaje');
  assert.ok(saludo.every((p) => p.clave === CLAVE_API && p.body.from === NEGOCIO_TEL && p.body.to === PERSONA_TEL));
  assert.match(saludo.map((p) => textoYC(p.body)).join('\n'), /Panadería La Espiga[\s\S]*Pan y facturas/);
  await avisar(clave, entrante('¿Tienen facturas sin TACC?'));
  assert.deepEqual(llamadas, [['Panadería La Espiga', '¿Tienen facturas sin TACC?']]);
  assert.match(textoYC(enviados(ycloud).at(-1).body), /Respuesta de Panadería La Espiga/);
  // El script ve cuándo llegó el último mensaje.
  assert.equal((await (await admin('GET', '/ycloud')).json()).numeros[0].ultimo, T0);
});

test('circuito: cuando el dueño contesta desde su app, el asistente se calla en esa charla; las otras siguen', async () => {
  const { n, negocio, ycloud, llamadas, admin, avisar } = await armar();
  const { clave } = await (await admin('POST', '/ycloud', { negocio: negocio.id, numero: NEGOCIO_TEL, apiKey: CLAVE_API })).json();
  await n.negocios.guardarFicha(negocio.id, { texto: FICHA, activa: true });
  await avisar(clave, entrante('hola'));
  await avisar(clave, eco('Hola, soy Marta, te atiendo yo'));
  const antes = enviados(ycloud).length;
  await avisar(clave, entrante('¿Tienen facturas?'));
  assert.equal(enviados(ycloud).length, antes, 'pausa: no responde');
  assert.equal(llamadas.length, 0);
  // Otra persona sí recibe respuesta.
  await avisar(clave, entrante('hola', { from: '+5493410000077' }));
  assert.ok(enviados(ycloud).length > antes);
  assert.equal(enviados(ycloud).at(-1).body.to, '+5493410000077');
});

test('circuito: firma mala, número desconocido o WhatsApp apagado en el negocio → no responde', async () => {
  const { n, negocio, ycloud, admin, avisar } = await armar();
  const { clave } = await (await admin('POST', '/ycloud', { negocio: negocio.id, numero: NEGOCIO_TEL, apiKey: CLAVE_API })).json();
  await n.negocios.guardarFicha(negocio.id, { texto: FICHA, activa: true });
  assert.equal((await avisar(clave, entrante('hola'), 'secreto-falso')).status, 401);
  assert.equal((await avisar('0123456789abcdef01234567', entrante('hola'))).status, 404);
  assert.equal((await avisar('../../x', entrante('hola'))).status, 404);
  assert.equal(enviados(ycloud).length, 0);
  await n.negocios.guardar(negocio.id, { canales: { instagram: true, whatsapp: false } });
  await avisar(clave, entrante('hola'));
  assert.equal(enviados(ycloud).length, 0);
});

test('circuito: un webhook de YCloud recibe lo de todos los números de la cuenta, pero solo atiende el suyo', async () => {
  const { n, negocio, ycloud, admin, avisar } = await armar();
  const { clave } = await (await admin('POST', '/ycloud', { negocio: negocio.id, numero: NEGOCIO_TEL, apiKey: CLAVE_API })).json();
  await n.negocios.guardarFicha(negocio.id, { texto: FICHA, activa: true });
  await avisar(clave, entrante('hola', { to: '+5493410000555' }));
  assert.equal(enviados(ycloud).length, 0, 'otro número de la misma cuenta: no responde');
  // El mismo número escrito sin el 9 sí es el suyo.
  await avisar(clave, entrante('hola', { to: '+543410000001' }));
  assert.ok(enviados(ycloud).length > 0);
  assert.equal(enviados(ycloud)[0].body.from, '+543410000001', 'responde desde el número tal como vino');
});

test('circuito: el eco con el número escrito distinto (sin el 9) igual pausa esa charla', async () => {
  const { n, negocio, ycloud, admin, avisar } = await armar();
  const { clave } = await (await admin('POST', '/ycloud', { negocio: negocio.id, numero: NEGOCIO_TEL, apiKey: CLAVE_API })).json();
  await n.negocios.guardarFicha(negocio.id, { texto: FICHA, activa: true });
  await avisar(clave, entrante('hola'));
  await avisar(clave, eco('te atiendo yo', { to: '+543410000009' }));
  const antes = enviados(ycloud).length;
  await avisar(clave, entrante('¿Tienen facturas?'));
  assert.equal(enviados(ycloud).length, antes);
});

test('circuito: si el dueño contesta mientras la IA piensa, no sale la respuesta del asistente', async () => {
  const { n, d, negocio, ycloud, admin, avisar } = await armar();
  const { clave } = await (await admin('POST', '/ycloud', { negocio: negocio.id, numero: NEGOCIO_TEL, apiKey: CLAVE_API })).json();
  await n.negocios.guardarFicha(negocio.id, { texto: FICHA, activa: true });
  await avisar(clave, entrante('hola'));
  const antes = enviados(ycloud).length;
  // La IA tarda: en el medio llega el eco del dueño.
  d.preguntarNegocio = () => async () => {
    await avisar(clave, eco('ya te contesto yo'));
    return { respuesta: 'Sí, tenemos.', persona: false, fuera_de_tema: false, vacia: false, notas: [] };
  };
  const logs = [];
  const orig = console.log;
  console.log = (x) => logs.push(String(x));
  try { await avisar(clave, entrante('¿Tienen facturas?')); } finally { console.log = orig; }
  assert.equal(enviados(ycloud).length, antes);
  assert.ok(logs.some((l) => l.includes('contesto_el_duenio')));
});

test('registro: un aviso que llega justo al desconectar el número no lo revive', async () => {
  const { n } = await armar();
  await n.ycloud.put('0123456789abcdef01234567', { ultimo: T0 });
  assert.equal(await n.ycloud.get('0123456789abcdef01234567'), null);
});

// ——— Charla completa (ZL-149) ———

test('botones y listas: hasta 3 opciones son botones, más son una lista; títulos al largo de WhatsApp; si no los acepta, va el texto', async () => {
  const { interactivo } = await import('../src/ycloud.js');
  const b = interactivo('¿Lo confirmamos?', [{ id: 'SI', titulo: 'Sí, confirmo' }, { id: 'CANCELAR', titulo: 'Cancelar' }]);
  assert.equal(b.interactive.type, 'button');
  assert.deepEqual(b.interactive.action.buttons.map((x) => x.reply.id), ['SI', 'CANCELAR']);
  const l = interactivo('Menú', [1, 2, 3, 4].map((n) => ({ id: String(n), titulo: `🥖 Opción con un título larguísimo número ${n}` })));
  assert.equal(l.interactive.type, 'list');
  assert.ok(l.interactive.action.sections[0].rows.every((r) => [...r.title].length <= 24));
  assert.equal(interactivo('x'.repeat(1100), [{ id: '1', titulo: 'a' }]), null, 'texto muy largo: sin botones');
  assert.equal(interactivo('hola', [{ id: 'con espacios', titulo: 'a' }]), null, 'solo nuestros ids');
  // Si YCloud rechaza el interactivo, va el texto.
  const pedidos = [];
  const f = async (url, o) => { const body = JSON.parse(o.body); pedidos.push(body); return body.type === 'interactive' ? new Response('', { status: 400 }) : Response.json({ status: 'accepted' }); };
  await enviarYCloud(CLAVE_API, { to: idCharla(NEGOCIO_TEL, PERSONA_TEL), text: { body: 'Menú' }, opciones: [{ id: '1', titulo: 'Pan' }] }, f);
  assert.deepEqual(pedidos.map((p) => p.type), ['interactive', 'text']);
});

test('entrada: un botón o una fila tocada vale su id; un audio llega como audio con su link', () => {
  const [b] = leerYCloud(entrante('', { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'SI', title: 'Sí, confirmo' } } }));
  assert.deepEqual([b.kind, b.text], ['text', 'SI']);
  const [l] = leerYCloud(entrante('', { type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: '2', title: '🎂 Tortas' } } }));
  assert.equal(l.text, '2');
  const [a] = leerYCloud(entrante('', { type: 'audio', audio: { link: 'https://api.ycloud.com/v2/whatsapp/media/download/abc', id: 'm1', mime_type: 'audio/ogg' } }));
  assert.equal(a.kind, 'audio');
  assert.match(a.media.link, /^https:\/\/api\.ycloud\.com/);
});

test('circuito: un audio se transcribe (con la clave del negocio) y se responde como texto; si no se puede, pide repetirlo', async () => {
  const { n, negocio, ycloud, llamadas, admin, avisar, d } = await armar();
  const { clave } = await (await admin('POST', '/ycloud', { negocio: negocio.id, numero: NEGOCIO_TEL, apiKey: CLAVE_API })).json();
  await n.negocios.guardarFicha(negocio.id, { texto: FICHA, activa: true });
  const bajados = [];
  d.transcribir = async (media) => (bajados.push(media.link), media.link.endsWith('ok') ? '¿Tienen facturas sin TACC?' : null);
  await avisar(clave, entrante('', { type: 'audio', audio: { link: 'https://api.ycloud.com/v2/whatsapp/media/download/ok', mime_type: 'audio/ogg' } }));
  assert.deepEqual(llamadas.at(-1), ['Panadería La Espiga', '¿Tienen facturas sin TACC?']);
  assert.match(textoYC(enviados(ycloud).at(-1).body), /Respuesta de Panadería La Espiga/);
  await avisar(clave, entrante('', { type: 'audio', audio: { link: 'https://api.ycloud.com/v2/whatsapp/media/download/mal', mime_type: 'audio/ogg' } }));
  assert.match(textoYC(enviados(ycloud).at(-1).body), /No pude escuchar bien el audio/);
  assert.equal(bajados.length, 2);
});

test('circuito: tres mensajes seguidos reciben UNA respuesta, con los tres juntos para la IA', async () => {
  const { n, negocio, ycloud, llamadas, admin, avisar, d } = await armar();
  const { clave } = await (await admin('POST', '/ycloud', { negocio: negocio.id, numero: NEGOCIO_TEL, apiKey: CLAVE_API })).json();
  await n.negocios.guardarFicha(negocio.id, { texto: FICHA, activa: true });
  await avisar(clave, entrante('hola'));
  const antes = enviados(ycloud).length;
  d.rafagaMs = 400;
  d.esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));
  await Promise.all([avisar(clave, entrante('quiero una torta')), avisar(clave, entrante('para el sábado')), avisar(clave, entrante('de chocolate'))]);
  assert.equal(enviados(ycloud).length - antes, 1, 'una sola respuesta');
  assert.deepEqual(llamadas.at(-1), ['Panadería La Espiga', 'quiero una torta\npara el sábado\nde chocolate']);
});

test('circuito: el menú va con botones (lista) y el pedido sin elegir entrega si el negocio solo hace retiro', async () => {
  const { n, negocio, ycloud, admin, avisar } = await armar();
  const { clave } = await (await admin('POST', '/ycloud', { negocio: negocio.id, numero: NEGOCIO_TEL, apiKey: CLAVE_API })).json();
  await n.negocios.guardarFicha(negocio.id, { texto: FICHA, activa: true });
  await avisar(clave, entrante('hola'));
  const menu = enviados(ycloud).at(-1).body;
  assert.equal(menu.type, 'interactive');
  assert.equal(menu.interactive.type, 'button', 'la ficha de prueba tiene 3 opciones: botones');
  assert.deepEqual(menu.interactive.action.buttons.map((x) => x.reply.id), ['1', '2', '3']);
  // Tocar el botón 2 es como escribir «2».
  await avisar(clave, entrante('', { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: '2', title: 'Tortas' } } }));
  assert.match(textoYC(enviados(ycloud).at(-1).body), /dos días de anticipación/);
});

// ——— Seguimiento con permiso, números y avisos (ZL-151) ———

test('seguimiento: una consulta sin nombre recibe UN recordatorio a las 2 h (dentro de las 24 h); BAJA lo corta', async () => {
  const { seguimientos } = await import('../src/index.js');
  const { n, d, negocio, ycloud, admin, avisar } = await armar();
  const { clave } = await (await admin('POST', '/ycloud', { negocio: negocio.id, numero: NEGOCIO_TEL, apiKey: CLAVE_API })).json();
  await n.negocios.guardarFicha(negocio.id, { texto: FICHA, activa: true });
  // La base del negocio, para registrar la consulta.
  const { sql, transaccion } = sqlPrueba();
  const base = crearCatalogo(sql, transaccion, () => T0);
  d.catalogo = () => ({ ejecutar: async (op, args) => ejecutarCatalogo(base, op, args) });
  d.preguntarNegocio = () => async () => ({ respuesta: '¡Buenísimo!', persona: false, fuera_de_tema: false, vacia: false, notas: [], memoria: { nombre: '', resumen: 'Quiere una torta (ficticio).' }, avanzar: 'consulta' });
  await avisar(clave, entrante('hola'));
  await avisar(clave, entrante('quiero encargar una torta'));
  assert.match(textoYC(enviados(ycloud).at(-1).body), /¿me decís tu nombre\?/);
  const antes = enviados(ycloud).length;
  // Todavía no toca.
  assert.deepEqual(await seguimientos(ENV, { ...d, now: T0 + 60 * 60_000 }, T0 + 60 * 60_000), []);
  const r = await seguimientos(ENV, { ...d, now: T0 + 2 * 3600_000 + 60_000 }, T0 + 2 * 3600_000 + 60_000);
  assert.deepEqual(r, [{ que: 'enviado', tipo: 'consulta' }]);
  assert.equal(enviados(ycloud).length, antes + 1);
  assert.match(textoYC(enviados(ycloud).at(-1).body), /¿Me decís tu nombre así le paso tu consulta al equipo\?[\s\S]*BAJA/);
  // No se repite solo.
  assert.deepEqual(await seguimientos(ENV, { ...d, now: T0 + 3 * 3600_000 }, T0 + 3 * 3600_000), []);
  // BAJA: confirma y no vuelve a escribir por su cuenta.
  await avisar(clave, entrante('BAJA'));
  assert.match(textoYC(enviados(ycloud).at(-1).body), /no te vuelvo a escribir por mi cuenta/);
  assert.equal((await n.memoria.get(claveMemoria(idCharla(NEGOCIO_TEL, PERSONA_TEL)))).baja, true);
});

test('seguimiento: fuera de las 24 h del último mensaje no se manda nada', async () => {
  const { seguimientos } = await import('../src/index.js');
  const { n, d } = await armar();
  const num = claveMemoria(idCharla(NEGOCIO_TEL, PERSONA_TEL));
  await n.memoria.put(num, { idioma: 'es', humanoHasta: 0, ultimo: T0, seguir: { cuando: T0 + 60_000, tipo: 'consulta', charla: idCharla(NEGOCIO_TEL, PERSONA_TEL) } });
  const a2 = adaptadores(crearAtencion(almacenPrueba()), () => T0);
  assert.ok(a2);
  const r = await seguimientos(ENV, { ...d, now: T0 + 25 * 3600_000 }, T0 + 25 * 3600_000);
  assert.deepEqual(r, [{ que: 'fuera_de_24h' }]);
});
