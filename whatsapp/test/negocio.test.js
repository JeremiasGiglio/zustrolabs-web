// Tests del asistente por negocio (ZL-113): la ficha, el perfil, los controles y el Worker. Sin red: el modelo se simula.
// La ficha de prueba es FICTICIA (Panadería La Espiga, test/ficha-prueba.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { adaptadores, almacenPrueba, crearAtencion } from '../src/atencion.js';
import { controlarNegocio, parsearFicha, perfilNegocio, preguntadorNegocio, promptNegocio, resumenFicha } from '../src/negocio.js';
import { armarFrom } from '../src/instagram.js';
import { atender, firmar } from '../src/whatsapp.js';

const FICHA = readFileSync(new URL('./ficha-prueba.md', import.meta.url), 'utf8');
const PLANTILLA = readFileSync(new URL('../fichas/PLANTILLA.md', import.meta.url), 'utf8');
const T0 = 1_792_000_000_000;
const ficha = parsearFicha(FICHA).ficha;
const perfil = perfilNegocio(ficha);
const memoria = () => adaptadores(crearAtencion(almacenPrueba()), () => T0).memoria;
const ev = (text, o = {}) => ({ id: 'm' + Math.random(), from: 'ig:17841400000000002.17841400000000009', ts: T0 / 1000, kind: 'text', text, ...o });
const preguntas = (r = { respuesta: 'El pan francés sale $ 2.500 el kilo 🥖', persona: false, fuera_de_tema: false, vacia: false, notas: [] }) => {
  const llamadas = [];
  return { llamadas, preguntar: async (texto) => (llamadas.push(texto), r) };
};

// ——— La ficha ———

test('ficha: lee datos, saludo, menú, lo que sabe, preguntas frecuentes y reglas; la ayuda («>») no cuenta', () => {
  const p = parsearFicha(FICHA);
  assert.equal(p.ok, true, p.errores.join('; '));
  assert.deepEqual(p.pendientes, []);
  assert.equal(ficha.nombre, 'Panadería La Espiga');
  assert.deepEqual([ficha.idioma, ficha.trato, ficha.emojis, ficha.precios, ficha.pausaHoras], ['es', 'vos', true, true, 6]);
  assert.equal(ficha.horarioPersona, 'de lunes a sábado de 8 a 20');
  assert.deepEqual(ficha.menu.map((o) => o.titulo), ['🥖 Pan y facturas', '🎂 Tortas por encargo', '📍 Horarios y dirección']);
  assert.match(ficha.conocimiento, /\$ 2\.500/);
  assert.match(ficha.faq, /sin TACC/);
  assert.doesNotMatch(JSON.stringify(ficha), /ayuda y no cuenta/);
  assert.deepEqual(ficha.permitidos.dominios, ['laespiga.example.com']);
  assert.deepEqual(ficha.permitidos.telefonos, ['3414001234']);
  assert.deepEqual(ficha.permitidos.montos.sort(), ['2500', '30000', '6000']);
});

test('ficha: la plantilla se puede revisar, pero tiene lo que falta completar (y por eso no se puede activar)', () => {
  const p = parsearFicha(PLANTILLA);
  assert.equal(p.ok, true, p.errores.join('; '));
  assert.ok(p.pendientes.length >= 4, p.pendientes.join(', '));
  assert.ok(p.pendientes.some((x) => x.startsWith('datos')));
  assert.ok(p.pendientes.some((x) => x.startsWith('menu')));
  assert.equal(resumenFicha(p).menu.length, 3);
});

test('ficha: los errores dicen qué arreglar', () => {
  const sinNombre = parsearFicha(FICHA.replace('- Nombre: Panadería La Espiga', ''));
  assert.equal(sinNombre.ok, false);
  assert.match(sinNombre.errores.join(), /Nombre/);
  assert.match(parsearFicha(FICHA.replace(/## Menú[\s\S]*?## Lo que sabe/, '## Lo que sabe')).errores.join(), /menú/);
  assert.match(parsearFicha(FICHA.replace('### 2. 🎂', '### 5. 🎂')).errores.join(), /numeradas/);
  assert.match(parsearFicha(FICHA.replace('Idioma: castellano', 'Idioma: klingon')).errores.join(), /Idioma/);
  assert.match(parsearFicha(FICHA.replace('Horas de pausa: 6', 'Horas de pausa: 500')).errores.join(), /pausa/);
  assert.match(parsearFicha('x'.repeat(40_000)).errores.join(), /larga/);
});

// ——— Textos y menú ———

test('perfil: saludo, presentación y menú del negocio; trato de usted y sin emojis si la ficha lo pide', () => {
  const T = perfil.textos();
  assert.equal(T.quienes, ficha.saludo);
  assert.match(T.menu, /1️⃣ 🥖 Pan y facturas\n2️⃣ 🎂 Tortas por encargo\n3️⃣ 📍 Horarios y dirección/);
  assert.match(T.persona, /Panadería La Espiga.*de lunes a sábado de 8 a 20/);
  assert.match(perfil.opcion('es', 2), /dos días de anticipación[\s\S]*PERSONA/);
  assert.equal(perfil.opcion('es', 4), null);
  const usted = perfilNegocio(parsearFicha(FICHA.replace('Trato: vos', 'Trato: usted').replace('Emojis: sí', 'Emojis: no')).ficha).textos();
  assert.match(usted.menuPie ?? usted.menu, /Responda con un número o cuénteme qué necesita/);
  assert.match(usted.derivar, /Si quiere hablar con una persona de Panadería La Espiga, escriba PERSONA/);
  assert.doesNotMatch(usted.menu + usted.hola + usted.persona, /\p{Extended_Pictographic}/u);
  assert.match(usted.menu, /^1\. /m);
  const en = perfilNegocio(parsearFicha(FICHA.replace('Idioma: castellano', 'Idioma: inglés')).ficha).textos();
  assert.match(en.derivar, /type PERSON/);
});

// ——— La charla ———

test('charla: «hola» → saludo, presentación y menú, sin preguntar el idioma y sin IA; un número → su respuesta fija', async () => {
  const m = memoria();
  const { llamadas, preguntar } = preguntas();
  const r = await atender(ev('Hola, ¿cómo va?'), { memoria: m, preguntar, now: T0, perfil });
  assert.equal(r.metrica, 'saludo');
  assert.deepEqual(r.send.map((x) => x.text.body), [`${perfil.textos().hola}\n\n${ficha.saludo}`, perfil.textos().menu]);
  const o = await atender(ev('2'), { memoria: m, preguntar, now: T0, perfil });
  assert.equal(o.send[0].text.body, perfil.opcion('es', 2));
  assert.equal((await atender(ev('menú'), { memoria: m, preguntar, now: T0, perfil })).send[0].text.body, perfil.textos().menu);
  assert.equal((await atender(ev('English'), { memoria: m, preguntar, now: T0, perfil })).metrica, 'ia', 'no cambia de idioma: lo responde la IA');
  assert.equal(llamadas.length, 1);
});

test('charla: el primer mensaje con una pregunta concreta recibe el saludo y además la respuesta, con la pista del menú', async () => {
  const m = memoria();
  const { llamadas, preguntar } = preguntas();
  const r = await atender(ev('¿Cuánto sale el pan francés?'), { memoria: m, preguntar, now: T0, perfil });
  assert.equal(r.metrica, 'ia');
  assert.equal(r.send.length, 2);
  assert.match(r.send[0].text.body, /Gracias por escribirnos[\s\S]*Panadería La Espiga/);
  assert.match(r.send[1].text.body, /\$ 2\.500[\s\S]*MENÚ/);
  assert.deepEqual(llamadas, ['¿Cuánto sale el pan francés?']);
  // El segundo ya no repite el saludo.
  assert.equal((await atender(ev('¿Y las facturas?'), { memoria: m, preguntar, now: T0, perfil })).send.length, 1);
});

test('charla: PERSONA pausa al asistente las horas de la ficha, sin panel ni correo; el negocio contesta desde su app', async () => {
  const m = memoria();
  const { llamadas, preguntar } = preguntas();
  await atender(ev('hola'), { memoria: m, preguntar, now: T0, perfil });
  const p = await atender(ev('quiero hablar con alguien'), { memoria: m, preguntar, now: T0, perfil });
  assert.equal(p.metrica, 'persona');
  assert.equal(p.avisar, undefined, 'no se avisa al estudio');
  assert.equal(p.send[0].text.body, perfil.textos().persona);
  assert.deepEqual((await atender(ev('¿tienen torta de limón?'), { memoria: m, preguntar, now: T0 + 3600_000, perfil })).send, [], 'en pausa: silencio');
  const despues = await atender(ev('¿tienen torta de limón?'), { memoria: m, preguntar, now: T0 + 3600_000 + 7 * 3600_000, perfil });
  assert.equal(despues.metrica, 'ia', 'pasadas las horas de pausa, vuelve el asistente');
  assert.equal(llamadas.length, 1);
  assert.equal((await atender(ev('BORRAR'), { memoria: m, preguntar, now: T0, perfil })).send[0].text.body, perfil.textos().borrado);
});

test('charla: si la IA marca persona, se suma cómo pedirla; si no sabe, el texto fijo', async () => {
  const m = memoria();
  await m.put('ig:17841400000000002.17841400000000009', { idioma: 'es', humanoHasta: 0 });
  const con = await atender(ev('Quiero encargar una torta'), { memoria: m, preguntar: async () => ({ respuesta: '¡Qué lindo! 🎂', persona: true, fuera_de_tema: false, vacia: false, notas: [] }), now: T0, perfil });
  assert.equal(con.send[0].text.body, `¡Qué lindo! 🎂\n\n${perfil.textos().derivar}`);
  const nada = await atender(ev('¿Tienen sushi?'), { memoria: m, preguntar: async () => controlarNegocio({ respuesta: 'Visitá otro-sitio.com', persona: false, fuera_de_tema: false }, ficha), now: T0, perfil });
  assert.equal(nada.send[0].text.body, perfil.textos().sinRespuesta);
});

// ——— Controles (no dependen de que el modelo obedezca) ———

test('controles: solo precios, links y teléfonos escritos en la ficha; nada de promociones inventadas', () => {
  const c = (respuesta, f = ficha) => controlarNegocio({ respuesta, persona: false, fuera_de_tema: false }, f);
  assert.equal(c('El kilo de pan francés sale $ 2.500. ¡Te esperamos!').respuesta, 'El kilo de pan francés sale $ 2.500. ¡Te esperamos!');
  assert.deepEqual(c('La torta sale $ 25.000. Es riquísima.').notas, ['plata'], 'un precio que no está en la ficha');
  assert.equal(c('La torta sale $ 25.000. Es riquísima.').respuesta, 'Es riquísima.');
  assert.equal(c('Mirá el catálogo en https://laespiga.example.com/catalogo').notas.length, 0);
  assert.deepEqual(c('Pedí por https://otra-tienda.com.ar').notas, ['link']);
  assert.deepEqual(c('Llamanos al 341 400-1234.').notas, []);
  assert.deepEqual(c('Llamanos al 11 5555-9999.').notas, ['telefono']);
  assert.deepEqual(c('Escribí a ventas@otra-tienda.com.').notas, ['correo']);
  assert.deepEqual(c('Hoy tenemos 20% de descuento en facturas.').notas, ['promo']);
  assert.equal(c('**Hola**').respuesta, 'Hola');
  const sinPrecios = parsearFicha(FICHA.replace('Precios: sí', 'Precios: no')).ficha;
  assert.deepEqual(c('El kilo sale $ 2.500.', sinPrecios).notas, ['plata'], 'con precios apagados, ningún monto');
  const vacia = c('Pedí por https://otra-tienda.com.ar');
  assert.equal(vacia.vacia, true);
  assert.equal(vacia.persona, true);
});

test('prompt: el negocio, sus reglas, su información y nada de Zustro Labs', () => {
  const p = promptNegocio(ficha);
  assert.match(p, /asistente virtual de Panadería La Espiga/);
  assert.match(p, /podés decir los precios que están en la información/);
  assert.match(p, /No confirmar encargos/);
  assert.match(p, /Quiere encargar una torta/);
  assert.match(p, /de «vos»/);
  assert.match(p, /<informacion>[\s\S]*\$ 2\.500[\s\S]*<\/informacion>/);
  assert.doesNotMatch(p, /Zustro/);
  assert.doesNotMatch(p, /ayuda y no cuenta/);
  assert.match(promptNegocio(parsearFicha(FICHA.replace('Precios: sí', 'Precios: no')).ficha), /nunca digas precios/);
});

test('preguntadorNegocio: pide JSON con el esquema del negocio y controla la salida', async () => {
  let cuerpo;
  const preguntar = preguntadorNegocio({ MODELO: 'modelo-prueba' }, ficha, { llamar: async (c) => ((cuerpo = c), { salida: { respuesta: 'Sale $ 99.999.', persona: false, fuera_de_tema: false }, uso: { input_tokens: 10, output_tokens: 5 } }) });
  const r = await preguntar('¿cuánto sale?');
  assert.equal(cuerpo.model, 'modelo-prueba');
  assert.deepEqual(cuerpo.messages, [{ role: 'user', content: '¿cuánto sale?' }]);
  assert.deepEqual(cuerpo.output_config.format.schema.required, ['respuesta', 'persona', 'fuera_de_tema']);
  assert.equal(r.vacia, true, 'el monto inventado se saca');
  assert.deepEqual(r.uso, { entrada: 10, salida: 5 });
});

// ——— Worker y administración ———

const ESTUDIO = '17841400000000001';
const CLIENTE = '17841400000000002';
const QUIEN = '17841400000000009';
const APP = { id: '2000000000000002', secreto: 'secreto-cliente-prueba' };
const limiteOk = { limit: async () => ({ success: true }) };
const ENV = { IG_APP_ID: '1000000000000001', IG_APP_SECRET: 'secreto-ig-prueba', IG_ADMIN_CLAVE: 'clave-admin-prueba', IG_CONECTAR_CLAVE: 'clave-link', LIMITE: limiteOk, LIMITE_GLOBAL: limiteOk };

async function base() {
  const n = adaptadores(crearAtencion(almacenPrueba()), () => T0);
  await n.cuentas.put(ESTUDIO, { username: 'zustrolabs', token: 'tok-estudio', vence: T0 + 9e9, app: ENV.IG_APP_ID });
  await n.apps.put(APP.id, { secreto: APP.secreto, nombre: 'Panadería' });
  await n.cuentas.put(CLIENTE, { username: 'laespiga', token: 'tok-cliente', vence: T0 + 9e9, app: APP.id });
  const enviados = [];
  const llamadas = [];
  const d = {
    ...n, now: T0,
    fetch: async (url, o) => (enviados.push({ url, auth: o?.headers?.authorization, body: JSON.parse(o?.body ?? 'null') }), Response.json({})),
    preguntar: async () => ({ respuesta: 'Hacemos webs.', secciones: [], enlaces: [], escribirnos: false, fuera_de_tema: false, notas: [] }),
    preguntarNegocio: (f) => async (t) => (llamadas.push([f.nombre, t]), { respuesta: `Respuesta de ${f.nombre}.`, persona: false, fuera_de_tema: false, vacia: false, notas: [] }),
  };
  return { n, d, enviados, llamadas };
}
const mensaje = async (d, destino, text, secreto) => {
  const cuerpo = JSON.stringify({ object: 'instagram', entry: [{ id: destino, time: T0, messaging: [{ sender: { id: QUIEN }, recipient: { id: destino }, timestamp: T0, message: { mid: 'm' + Math.random(), text } }] }] });
  return worker.fetch(new Request('https://zustrolabs.com/api/instagram', { method: 'POST', headers: { 'X-Hub-Signature-256': await firmar(cuerpo, secreto) }, body: cuerpo }), ENV, {}, d);
};
const admin = (d, metodo, ruta, cuerpo, clave = ENV.IG_ADMIN_CLAVE) =>
  worker.fetch(new Request(`https://zustrolabs.com/api/instagram/admin${ruta}`, { method: metodo, headers: { authorization: `Bearer ${clave}`, 'content-type': 'application/json' }, ...(cuerpo && { body: JSON.stringify(cuerpo) }) }), ENV, {}, d);
async function conLogs(fn) {
  const logs = [];
  const orig = console.log;
  console.log = (x) => logs.push(String(x));
  try { await fn(); } finally { console.log = orig; }
  return logs.map((l) => JSON.parse(l));
}

test('worker: la cuenta de un cliente sin ficha, o con la ficha apagada, no responde; con la ficha activa, responde como el negocio', async () => {
  const { n, d, enviados, llamadas } = await base();
  const logs = await conLogs(() => mensaje(d, CLIENTE, '¿Tienen facturas?', APP.secreto));
  assert.equal(enviados.length, 0);
  assert.ok(logs.some((l) => l.que === 'sin_ficha'));
  await n.fichas.put(CLIENTE, { texto: FICHA, activa: false });
  assert.ok((await conLogs(() => mensaje(d, CLIENTE, '¿Tienen facturas?', APP.secreto))).some((l) => l.que === 'ficha_inactiva'));
  assert.equal(enviados.length, 0);
  await n.fichas.put(CLIENTE, { texto: FICHA, activa: true });
  await mensaje(d, CLIENTE, '¿Tienen facturas?', APP.secreto);
  assert.deepEqual(llamadas, [['Panadería La Espiga', '¿Tienen facturas?']]);
  assert.ok(enviados.every((e) => e.auth === 'Bearer tok-cliente'));
  assert.match(enviados.map((e) => e.body.message.text).join('\n'), /Gracias por escribirnos[\s\S]*Respuesta de Panadería La Espiga/);
  // La cuenta del estudio sigue con lo de Zustro Labs (pregunta el idioma).
  await mensaje(d, ESTUDIO, 'hola', ENV.IG_APP_SECRET);
  assert.match(enviados.at(-1).body.message.text, /Zustro Labs|idioma/);
  assert.equal(enviados.at(-1).auth, 'Bearer tok-estudio');
});

test('admin: revisar, probar, cargar (apagada o activa), ver, estado y borrar la ficha de una cuenta', async () => {
  const { d } = await base();
  assert.equal((await admin(d, 'POST', '/ficha/revisar', { texto: FICHA }, 'otra')).status, 401);
  const rev = await (await admin(d, 'POST', '/ficha/revisar', { texto: PLANTILLA })).json();
  assert.ok(rev.pendientes.length > 0);
  assert.equal((await admin(d, 'POST', '/ficha/revisar', { texto: '## Datos' })).status, 400);
  const prueba = await (await admin(d, 'POST', '/ficha/probar', { texto: FICHA, mensajes: ['hola', '1', '¿hacen envíos?'] })).json();
  assert.deepEqual(prueba.charla.map((x) => x.que), ['saludo', 'opcion', 'ia']);
  assert.match(prueba.charla[2].respuestas.join(), /Respuesta de Panadería La Espiga/);
  // Una plantilla con cosas sin completar se guarda solo apagada.
  assert.equal((await admin(d, 'PUT', `/cuentas/${CLIENTE}/ficha`, { texto: PLANTILLA, activa: true })).status, 400);
  assert.equal((await admin(d, 'PUT', `/cuentas/${CLIENTE}/ficha`, { texto: PLANTILLA, activa: false })).status, 200);
  const ok = await (await admin(d, 'PUT', `/cuentas/${CLIENTE}/ficha`, { texto: FICHA, activa: true })).json();
  assert.equal(ok.activa, true);
  assert.equal(ok.cuenta, 'laespiga');
  assert.equal((await (await admin(d, 'GET', `/cuentas/${CLIENTE}/ficha`)).json()).texto, FICHA);
  const est = await (await admin(d, 'GET', '/estado')).json();
  assert.deepEqual(est.cuentas.find((c) => c.id === CLIENTE).ficha, { tiene: true, activa: true, nombre: 'Panadería La Espiga', pendientes: [] });
  assert.equal(est.cuentas.find((c) => c.id === ESTUDIO).ficha, 'estudio');
  assert.equal((await admin(d, 'PUT', `/cuentas/${ESTUDIO}/ficha`, { texto: FICHA, activa: true })).status, 400, 'la del estudio no usa ficha');
  assert.equal((await admin(d, 'PUT', '/cuentas/17841499999999999/ficha', { texto: FICHA, activa: true })).status, 404, 'cuenta sin conectar');
  assert.equal((await admin(d, 'DELETE', `/cuentas/${CLIENTE}/ficha`)).status, 200);
  assert.equal((await admin(d, 'GET', `/cuentas/${CLIENTE}/ficha`)).status, 404);
});

test('la plantilla y el script no traen datos de clientes reales', () => {
  const ps1 = readFileSync(new URL('../scripts/instagram-cliente.ps1', import.meta.url), 'utf8');
  for (const t of [PLANTILLA, ps1]) assert.doesNotMatch(t, /agostino/i);
  assert.match(readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8'), /^whatsapp\/fichas\/clientes\/$/m);
  assert.equal(armarFrom(CLIENTE, QUIEN), `ig:${CLIENTE}.${QUIEN}`);
});

test('el script de Windows se guarda con BOM (PowerShell 5.1 lee los .ps1 sin BOM como ANSI y rompe los acentos)', () => {
  const b = readFileSync(new URL('../scripts/instagram-cliente.ps1', import.meta.url));
  assert.deepEqual([...b.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const s = b.toString('utf8');
  for (const t of ['-Ficha', '/ficha/revisar', '/ficha/probar', '/ficha"', 'activa']) assert.ok(s.includes(t), t);
});
