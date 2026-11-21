// Tests del asistente por negocio (ZL-113): la ficha, el perfil, los controles y el Worker. Sin red: el modelo se simula.
// La ficha de prueba es FICTICIA (Panadería La Espiga, test/ficha-prueba.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { adaptadores, almacenPrueba, crearAtencion } from '../src/atencion.js';
import { controlarNegocio, cumpleNegocio, parsearFicha, perfilNegocio, preguntadorNegocio, promptNegocio, resumenFicha } from '../src/negocio.js';
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
  assert.match(perfil.opcion('es', 2), /dos días de anticipación/);
  assert.doesNotMatch(perfil.opcion('es', 2), /PERSONA/, 'ZL-146: las opciones no empujan a pedir una persona');
  assert.equal(perfil.opcion('es', 4), null);
  const usted = perfilNegocio(parsearFicha(FICHA.replace('Trato: vos', 'Trato: usted').replace('Emojis: sí', 'Emojis: no')).ficha).textos();
  assert.match(usted.menuPie ?? usted.menu, /Responda con un número o cuénteme qué necesita/);
  assert.match(usted.consultaNombre, /¿me dice su nombre\?/);
  assert.match(usted.consultaLista('Ana'), /^¡Listo, Ana!.*le responden por acá/);
  assert.doesNotMatch(usted.menu + usted.hola + usted.persona, /\p{Extended_Pictographic}/u);
  assert.match(usted.menu, /^1\. /m);
  const en = perfilNegocio(parsearFicha(FICHA.replace('Idioma: castellano', 'Idioma: inglés')).ficha).textos();
  assert.match(en.consultaLista(''), /^All set! 🙌/);
  // Ningún texto fijo le pide a la persona que escriba PERSONA (ZL-146).
  for (const t of [perfil.textos(), usted, en]) assert.doesNotMatch(Object.values(t).filter((v) => typeof v === 'string').join(' '), /PERSONA|PERSON\b/);
});

// ——— La charla ———

test('charla: «hola» → saludo, presentación y menú, sin preguntar el idioma y sin IA; un número → su respuesta fija', async () => {
  const m = memoria();
  const { llamadas, preguntar } = preguntas();
  const r = await atender(ev('Hola, ¿cómo va?'), { memoria: m, preguntar, now: T0, perfil });
  assert.equal(r.metrica, 'saludo');
  // ZL-146: un solo mensaje (Meta cobra cada uno).
  assert.deepEqual(r.send.map((x) => x.text.body), [`${perfil.textos().hola}\n\n${ficha.saludo}\n\n${perfil.textos().menu}`]);
  const o = await atender(ev('2'), { memoria: m, preguntar, now: T0, perfil });
  assert.equal(o.send[0].text.body, perfil.opcion('es', 2));
  assert.equal((await atender(ev('menú'), { memoria: m, preguntar, now: T0, perfil })).send[0].text.body, perfil.textos().menu);
  assert.equal((await atender(ev('English'), { memoria: m, preguntar, now: T0, perfil })).metrica, 'ia', 'no cambia de idioma: lo responde la IA');
  assert.equal(llamadas.length, 1);
});

test('charla: el primer mensaje con una pregunta concreta recibe UNA respuesta de la IA (que saluda), sin pistas fijas', async () => {
  const m = memoria();
  const vistos = [];
  const preguntar = async (texto, idioma, o) => (vistos.push({ texto, ...o }), { respuesta: '¡Hola! El pan francés sale $ 2.500 el kilo 🥖 ¿Cuánto querés?', persona: false, fuera_de_tema: false, vacia: false, notas: [], memoria: { nombre: '', resumen: 'Pregunta por pan francés.' } });
  const r = await atender(ev('¿Cuánto sale el pan francés?'), { memoria: m, preguntar, now: T0, perfil });
  assert.equal(r.metrica, 'ia');
  assert.equal(r.send.length, 1);
  assert.match(r.send[0].text.body, /^¡Hola! El pan francés sale \$ 2\.500/);
  assert.doesNotMatch(r.send[0].text.body, /MENÚ|PERSONA/);
  assert.deepEqual(vistos[0].historial, [], 'la primera vez no hay historial');
  assert.equal(vistos[0].cliente, null);
  // El segundo ve la charla anterior y lo que aprendió (memoria corta).
  await atender(ev('¿Y las facturas?'), { memoria: m, preguntar, now: T0 + 60_000, perfil });
  assert.deepEqual(vistos[1].historial.map((x) => x.r), ['u', 'a']);
  assert.match(vistos[1].historial[0].t, /pan francés/);
  assert.equal(vistos[1].cliente.resumen, 'Pregunta por pan francés.');
});

test('charla: PERSONA calla al asistente 15 minutos; si nadie la toma vuelve (lo dice una vez); si el negocio la toma, la pausa sigue (ZL-149)', async () => {
  const m = memoria();
  const { llamadas, preguntar } = preguntas();
  const DE = 'ig:17841400000000002.17841400000000009';
  await atender(ev('hola'), { memoria: m, preguntar, now: T0, perfil });
  const p = await atender(ev('quiero hablar con alguien'), { memoria: m, preguntar, now: T0, perfil });
  assert.equal(p.metrica, 'persona');
  assert.equal(p.avisar, undefined, 'no se avisa al estudio');
  assert.equal(p.send[0].text.body, perfil.textos().persona);
  // Mientras espera (ZL-162): UN acuse al primer mensaje, después silencio; y escribir no alarga la espera.
  const acuse = await atender(ev('¿hola?'), { memoria: m, preguntar, now: T0 + 5 * 60_000, perfil });
  assert.deepEqual([acuse.metrica, acuse.send[0].text.body], ['acuse', perfil.textos().acuse]);
  assert.deepEqual((await atender(ev('¿sigue ahí alguien?'), { memoria: m, preguntar, now: T0 + 10 * 60_000, perfil })).send, [], 'después: silencio');
  assert.equal((await m.get(DE)).humanoHasta, T0 + 15 * 60_000);
  const vuelve = await atender(ev('¿tienen torta de limón?'), { memoria: m, preguntar, now: T0 + 16 * 60_000, perfil });
  assert.equal(vuelve.metrica, 'ia', 'a los 15 minutos vuelve el asistente');
  assert.match(vuelve.send[0].text.body, new RegExp('^' + perfil.textos().sigoYo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const otra = await atender(ev('¿y de chocolate?'), { memoria: m, preguntar, now: T0 + 17 * 60_000, perfil });
  assert.doesNotMatch(otra.send[0].text.body, /sigo yo/, 'lo dice una sola vez');
  assert.equal(llamadas.length, 2);
  // Si el negocio la toma (respondió desde su app: eco, o «La atiendo yo»), la pausa es la de la ficha y no hay «sigo yo».
  await atender(ev('PERSONA'), { memoria: m, preguntar, now: T0 + 20 * 60_000, perfil });
  await m.put(DE, { ...(await m.get(DE)), humanoHasta: T0 + 20 * 60_000 + 6 * 3600_000, pase: 0 });
  assert.deepEqual((await atender(ev('gracias'), { memoria: m, preguntar, now: T0 + 3 * 3600_000, perfil })).send, []);
  // ZL-162: escribir mientras la atiende el negocio NO alarga la pausa (la alarga el dueño cuando contesta).
  assert.equal((await m.get(DE)).humanoHasta, T0 + 20 * 60_000 + 6 * 3600_000);
  const despues = await atender(ev('¿tienen torta de limón?'), { memoria: m, preguntar, now: T0 + 9 * 3600_000 + 60_000, perfil });
  assert.equal(despues.metrica, 'ia');
  assert.doesNotMatch(despues.send[0].text.body, /sigo yo/);
  // ZL-162: BORRAR pide confirmación (otra vez BORRAR) y recién ahí borra.
  assert.equal((await atender(ev('BORRAR'), { memoria: m, preguntar, now: T0 + 10 * 3600_000, perfil })).send[0].text.body, perfil.textos().borrarConfirmar);
  assert.equal((await atender(ev('BORRAR'), { memoria: m, preguntar, now: T0 + 10 * 3600_000 + 60_000, perfil })).send[0].text.body, perfil.textos().borrado);
  assert.equal(await m.get(DE), null);
});

test('charla (ZL-162): BORRAR en plena pausa no despierta al asistente', async () => {
  const m = memoria();
  const { preguntar } = preguntas();
  const DE = 'ig:17841400000000002.17841400000000009';
  await m.put(DE, { idioma: 'es', humanoHasta: T0 + 3600_000, nombre: 'Ana', resumen: 'Quiere torta.' });
  await atender(ev('BORRAR'), { memoria: m, preguntar, now: T0, perfil });
  await atender(ev('BORRAR'), { memoria: m, preguntar, now: T0 + 1000, perfil });
  const e = await m.get(DE);
  assert.equal(e.humanoHasta, T0 + 3600_000, 'la pausa sigue');
  assert.equal(e.nombre, undefined, 'lo que recordaba se borró');
  assert.deepEqual((await atender(ev('hola?'), { memoria: m, preguntar, now: T0 + 2000, perfil })).send, []);
});

test('charla (ZL-162): si pide una persona o reclama, pasa al equipo sin preguntas que se pisen; si no sabe algo, OFRECE averiguarlo y pasa solo si dice que sí', async () => {
  const m = memoria();
  const DE = 'ig:17841400000000002.17841400000000009';
  const registradas = [];
  const consultas = { registrar: async (d) => (registradas.push(d), { numero: registradas.length, nueva: true }) };
  await m.put(DE, { idioma: 'es', humanoHasta: 0, nombre: 'Ana' });
  const con = await atender(ev('Me vendieron pan duro ayer'), { memoria: m, preguntar: async () => ({ respuesta: '¡Dale! Eso lo veo con el equipo. ¿Me decís tu nombre?', persona: true, motivo: 'reclamo', fuera_de_tema: false, vacia: false, notas: [], memoria: { nombre: '', resumen: 'Quiere una torta.' } }), now: T0, perfil, consultas });
  assert.equal(con.send[0].text.body, `Eso lo veo con el equipo.\n\n${perfil.textos().persona}`, 'sin «¡Dale!» ni la pregunta que se pisa');
  assert.doesNotMatch(perfil.textos().persona, /Dale/);
  assert.equal(con.metrica, 'persona_auto');
  assert.equal(con.handoff, true);
  assert.deepEqual(registradas[0], { tipo: 'persona', nombre: 'Ana', interes: '', resumen: 'Quiere una torta.', idioma: 'es' });
  assert.ok((await m.get(DE)).humanoHasta > T0, 'el asistente queda en pausa');
  // No sabe algo (o los controles vaciaron la respuesta): ofrece averiguarlo, sin pasar todavía.
  await m.put(DE, { idioma: 'es', humanoHasta: 0, resumen: 'Tiene una panadería.' });
  const nada = await atender(ev('¿hacen factura A?'), { memoria: m, preguntar: async () => controlarNegocio({ respuesta: 'Visitá otro-sitio.com', persona: false, fuera_de_tema: false }, ficha), now: T0, perfil, consultas });
  assert.equal(nada.send[0].text.body, `${perfil.textos().noTengo}\n\n${perfil.textos().ofrecerEquipo}`);
  assert.equal(nada.metrica, 'ofrece_equipo');
  assert.equal(registradas.length, 1, 'todavía no se pasó');
  assert.equal((await m.get(DE)).humanoHasta, 0);
  // «Sí»: se pasa con la pregunta anotada, y se le confirma una sola vez.
  const si = await atender(ev('sí, por favor'), { memoria: m, preguntar: async () => assert.fail('no gasta IA'), now: T0 + 60_000, perfil, consultas });
  assert.deepEqual([si.metrica, si.handoff, si.send[0].text.body], ['persona_auto', true, perfil.textos().persona]);
  assert.equal(registradas[1].interes, '¿hacen factura A?');
  assert.match(registradas[1].resumen, /Tiene una panadería\. Preguntó: «¿hacen factura A\?»/);
  // «No»: no pasa nada y sigue.
  await m.put(DE, { idioma: 'es', humanoHasta: 0 });
  await atender(ev('¿abren el domingo?'), { memoria: m, preguntar: async () => ({ respuesta: 'Eso no lo tengo confirmado.', persona: true, motivo: 'no_se', fuera_de_tema: false, vacia: false, notas: [] }), now: T0, perfil, consultas });
  const no = await atender(ev('no, gracias'), { memoria: m, preguntar: async () => assert.fail('no gasta IA'), now: T0 + 1000, perfil, consultas });
  assert.deepEqual([no.metrica, no.send[0].text.body], ['oferta_no', perfil.textos().dejamosAsi]);
  assert.equal(registradas.length, 2);
  // Otra cosa: el ofrecimiento se olvida y sigue la charla normal.
  await atender(ev('¿abren el domingo?'), { memoria: m, preguntar: async () => ({ respuesta: 'Eso no lo tengo confirmado.', persona: true, motivo: 'no_se', fuera_de_tema: false, vacia: false, notas: [] }), now: T0 + 2000, perfil, consultas });
  const otra = await atender(ev('¿y tienen medialunas?'), { memoria: m, preguntar: async () => ({ respuesta: 'Sí, hay medialunas.', persona: false, fuera_de_tema: false, vacia: false, notas: [] }), now: T0 + 3000, perfil, consultas });
  assert.equal(otra.send[0].text.body, 'Sí, hay medialunas.');
  assert.equal((await m.get(DE)).oferta, undefined);
  // Si eso quedó pendiente (el dueño devolvió la charla sin responderlo), no se vuelve a ofrecer: no hay ciclo.
  await m.put(DE, { idioma: 'es', humanoHasta: 0, devuelta: { t: T0, pregunta: '¿hacen factura A?' } });
  const ciclo = await atender(ev('¿me responden lo de la factura?'), { memoria: m, preguntar: async (t, i, op) => (assert.match(op.cliente.pendiente, /factura A/), { respuesta: 'Eso no lo tengo confirmado.', persona: true, motivo: 'no_se', fuera_de_tema: false, vacia: false, notas: [] }), now: T0 + 3600_000, perfil, consultas });
  assert.deepEqual([ciclo.metrica, ciclo.handoff], ['no_sabe', undefined]);
  assert.match(ciclo.send[0].text.body, /todavía no lo confirmó el equipo/);
  assert.equal(registradas.length, 2);
  // Fuera de tema no molesta al negocio.
  await m.put(DE, { idioma: 'es', humanoHasta: 0 });
  await atender(ev('¿Quién gana el clásico?'), { memoria: m, preguntar: async () => ({ respuesta: 'De eso no sé 😅', persona: true, fuera_de_tema: true, vacia: false, notas: [] }), now: T0, perfil, consultas });
  assert.equal(registradas.length, 2);
});

test('charla: quiere avanzar y el cierre es una consulta → pide el nombre una vez y la registra; si ya lo sabe, no lo pide', async () => {
  const m = memoria();
  const DE = 'ig:17841400000000002.17841400000000009';
  const registradas = [];
  const consultas = { registrar: async (d) => (registradas.push(d), { numero: 7, nueva: true }) };
  await m.put(DE, { idioma: 'es', humanoHasta: 0 });
  const ia = async () => ({ respuesta: '¡Buenísimo! Te armamos la torta para el sábado.', persona: false, fuera_de_tema: false, vacia: false, notas: [], memoria: { nombre: '', resumen: 'Torta de cumpleaños para 20 personas, sábado.' }, avanzar: 'consulta' });
  const r1 = await atender(ev('Dale, quiero encargarla'), { memoria: m, preguntar: ia, now: T0, perfil, consultas });
  assert.equal(r1.metrica, 'consulta_nombre');
  assert.match(r1.send[0].text.body, /¿me decís tu nombre\?$/);
  assert.equal(registradas.length, 0);
  // Una pregunta en vez del nombre: sigue la charla normal.
  const nada = { respuesta: 'Sí, sin TACC también.', persona: false, fuera_de_tema: false, vacia: false, notas: [] };
  assert.equal((await atender(ev('¿La hacen sin TACC?'), { memoria: m, preguntar: async () => nada, now: T0 + 1, perfil, consultas })).metrica, 'ia');
  await atender(ev('Dale, quiero encargarla'), { memoria: m, preguntar: ia, now: T0 + 2, perfil, consultas });
  const r2 = await atender(ev('soy ana pérez'), { memoria: m, preguntar: ia, now: T0 + 3, perfil, consultas });
  assert.equal(r2.metrica, 'consulta');
  assert.equal(r2.consulta, 7);
  assert.match(r2.send[0].text.body, /^¡Listo, Ana Pérez! 🙌 Ya le pasé tu consulta al equipo de Panadería La Espiga/);
  assert.equal(registradas[0].nombre, 'Ana Pérez');
  assert.equal(registradas[0].tipo, 'consulta');
  assert.equal((await m.get(DE)).nombre, 'Ana Pérez');
  assert.equal((await m.get(DE)).humanoHasta, 0, 'una consulta no pausa al asistente');
  // Ya sabemos el nombre: la próxima vez registra directo.
  const r3 = await atender(ev('Y también quiero una docena de facturas para ese día'), { memoria: m, preguntar: ia, now: T0 + 4, perfil, consultas });
  assert.equal(r3.metrica, 'consulta');
  assert.match(r3.send[0].text.body, /¡Listo, Ana Pérez!/);
});

test('charla: un saludo de alguien que ya conocemos lo responde la IA (retoma la charla) en vez del menú fijo', async () => {
  const m = memoria();
  const DE = 'ig:17841400000000002.17841400000000009';
  await m.put(DE, { idioma: 'es', humanoHasta: 0, nombre: 'Ana', resumen: 'Quería una torta para el sábado.', ultimo: T0 - 3 * 86_400_000 });
  const vistos = [];
  const r = await atender(ev('Hola!'), { memoria: m, preguntar: async (t, i, o) => (vistos.push(o), { respuesta: '¡Hola de nuevo, Ana! ¿Seguimos con la torta del sábado?', persona: false, fuera_de_tema: false, vacia: false, notas: [] }), now: T0, perfil });
  assert.equal(r.metrica, 'ia');
  assert.deepEqual(vistos[0].cliente, { nombre: 'Ana', resumen: 'Quería una torta para el sábado.', dias: 3 });
  assert.equal(vistos[0].historial.length, 0, 'pasadas 48 h, los mensajes viejos no van');
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

test('preguntadorNegocio pasa por la llamada real a la API y acepta el esquema del negocio (ZL-125)', async () => {
  // Antes, llamarClaude validaba con el esquema de la landing y toda respuesta de una ficha fallaba con «esquema».
  const ficha = parsearFicha(FICHA).ficha;
  const pedidos = [];
  const api = (salida) => async (url, o) => (pedidos.push({ url, cuerpo: JSON.parse(o.body) }), Response.json({ content: [{ type: 'text', text: JSON.stringify(salida) }], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 2 } }));
  const ok = preguntadorNegocio({ ANTHROPIC_API_KEY: 'clave-prueba' }, ficha, { fetchImpl: api({ respuesta: 'Sí, hacemos facturas todos los días.', persona: false, fuera_de_tema: false }) });
  const r = await ok('¿Tienen facturas?');
  assert.equal(r.respuesta, 'Sí, hacemos facturas todos los días.');
  assert.equal(r.persona, false);
  assert.equal(pedidos[0].url, 'https://api.anthropic.com/v1/messages');
  assert.match(pedidos[0].cuerpo.system, /si pide otro idioma/);
  // Una salida con el formato de la landing (o rota) sigue siendo un error.
  const mal = preguntadorNegocio({ ANTHROPIC_API_KEY: 'clave-prueba' }, ficha, { fetchImpl: api({ respuesta: 'x', seccion: '', enlace: '', escribirnos: false, fuera_de_tema: false }) });
  await assert.rejects(() => mal('hola'), /esquema/);
  assert.equal(cumpleNegocio({ respuesta: '', persona: true, fuera_de_tema: false }), true);
});

test('preguntadorNegocio: pide JSON con el esquema del negocio y controla la salida', async () => {
  let cuerpo;
  const preguntar = preguntadorNegocio({ MODELO: 'modelo-prueba' }, ficha, { llamar: async (c) => ((cuerpo = c), { salida: { respuesta: 'Sale $ 99.999.', persona: false, fuera_de_tema: false }, uso: { input_tokens: 10, output_tokens: 5 } }) });
  const r = await preguntar('¿cuánto sale?');
  assert.equal(cuerpo.model, 'modelo-prueba');
  assert.deepEqual(cuerpo.messages, [{ role: 'user', content: '¿cuánto sale?' }]);
  assert.deepEqual(cuerpo.output_config.format.schema.required, ['respuesta', 'persona', 'fuera_de_tema', 'idioma']);
  assert.equal(r.vacia, true, 'el monto inventado se saca');
  assert.deepEqual(r.uso, { entrada: 10, salida: 5 });
  // ZL-154: el total de un pedido suyo es un monto real: se puede nombrar, y el prompt lleva sus compras.
  const conCompras = await preguntar('¿cuánto me salió?', null, { compras: { texto: '- Pedido N.º 4 del 10/11 · entregado · [ref p1] 1 × Algo · total $ 99.999', montos: ['99999'] } });
  assert.equal(conCompras.respuesta, 'Sale $ 99.999.');
  assert.match(cuerpo.system, /<compras>\n- Pedido N\.º 4 del 10\/11[\s\S]*<\/compras>/);
  assert.match(cuerpo.system, /11b\. Lo que ya pidió[\s\S]*Nunca hables de pedidos o consultas que no estén ahí/);
});

test('prompt (ZL-154): sin compras no hay bloque ni regla; con pedidos encendidos, puede repetir uno', () => {
  const sin = promptNegocio(ficha);
  assert.doesNotMatch(sin, /<compras>|11b\./);
  const cat = { texto: '- [ref p1] Pan francés · $ 2.500' };
  const con = promptNegocio(ficha, 'WhatsApp', cat, null, null, '(vacío)', { compras: { texto: '- Pedido N.º 1 del 01/11 · entregado' } });
  assert.match(con, /lo mismo que la otra vez/);
  assert.doesNotMatch(promptNegocio(ficha, 'WhatsApp', null, null, null, null, { compras: { texto: '- Consulta N.º 1' } }), /lo mismo que la otra vez/, 'sin pedidos por chat, no ofrece repetir');
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
    // Buscar el usuario de Instagram (ZL-153) es una lectura: no cuenta como mensaje enviado.
    fetch: async (url, o) => (String(url).includes('?fields=username') ? Response.json({}) : (enviados.push({ url, auth: o?.headers?.authorization, body: JSON.parse(o?.body ?? 'null') }), Response.json({}))),
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
  // ZL-146: el primer mensaje con una pregunta recibe una sola respuesta de la IA (que saluda en nombre del negocio).
  assert.equal(enviados.at(-1).body.message.text, 'Respuesta de Panadería La Espiga.');
  // La cuenta del estudio sigue con lo de Zustro Labs (pregunta el idioma).
  await mensaje(d, ESTUDIO, 'hola', ENV.IG_APP_SECRET);
  assert.match(enviados.at(-1).body.message.text, /Zustro Labs|idioma/);
  assert.equal(enviados.at(-1).auth, 'Bearer tok-estudio');
});

test('worker: la cuenta del estudio vinculada a un negocio responde con su ficha solo si está activa; si no, con lo de la página (ZL-124)', async () => {
  const { n, d, enviados, llamadas } = await base();
  const charlas = [];
  d.charlas = { ...d.charlas, agregar: async (...x) => charlas.push(x) };
  const ultimo = () => enviados.at(-1).body.message.text;
  // Vinculada pero sin ficha: como siempre (lo de Zustro Labs) y queda registrado por qué.
  const { negocio } = await n.negocios.guardar(null, { nombre: 'ZustroLabs', emails: [], cuentas: [ESTUDIO] });
  let logs = await conLogs(() => mensaje(d, ESTUDIO, 'hola', ENV.IG_APP_SECRET));
  assert.match(ultimo(), /Zustro Labs|idioma/);
  assert.ok(logs.some((l) => l.que === 'estudio_sin_ficha'));
  // Con la ficha apagada, igual: nunca queda muda.
  await n.negocios.guardarFicha(negocio.id, { texto: FICHA, activa: false });
  logs = await conLogs(() => mensaje(d, ESTUDIO, 'hola', ENV.IG_APP_SECRET));
  assert.match(ultimo(), /Zustro Labs|idioma/);
  assert.ok(logs.some((l) => l.que === 'estudio_ficha_inactiva'));
  assert.equal(llamadas.length, 0);
  // Con la ficha activa: el saludo y las respuestas de la ficha, con el token del estudio.
  await n.negocios.guardarFicha(negocio.id, { texto: FICHA, activa: true });
  const antes = enviados.length;
  logs = await conLogs(() => mensaje(d, ESTUDIO, '¿Tienen facturas?', ENV.IG_APP_SECRET));
  assert.deepEqual(llamadas, [['Panadería La Espiga', '¿Tienen facturas?']]);
  const nuevos = enviados.slice(antes);
  // (El saludo de la ficha no se repite: esta persona ya había elegido idioma en la charla con el estudio.)
  assert.match(nuevos.map((e) => e.body.message.text).join('\n'), /Respuesta de Panadería La Espiga/);
  assert.ok(nuevos.every((e) => e.auth === 'Bearer tok-estudio'));
  assert.ok(logs.some((l) => l.negocio === true && l.estudio === 'ficha'));
  // Con Instagram apagado en el negocio, vuelve a lo de la página (no se calla, como haría un cliente).
  await n.negocios.guardar(negocio.id, { canales: { instagram: false, whatsapp: false } });
  logs = await conLogs(() => mensaje(d, ESTUDIO, '¿Tienen facturas?', ENV.IG_APP_SECRET));
  assert.equal(llamadas.length, 1);
  assert.ok(logs.some((l) => l.que === 'estudio_canal_apagado'));
  assert.equal(enviados.at(-1).auth, 'Bearer tok-estudio');
  await n.negocios.guardar(negocio.id, { canales: { instagram: true, whatsapp: false } });
  // Desvincularla la devuelve a lo de la página.
  await n.negocios.guardar(negocio.id, { cuentas: [] });
  await mensaje(d, ESTUDIO, 'hola de nuevo', ENV.IG_APP_SECRET);
  assert.equal(llamadas.length, 1);
  assert.equal(enviados.at(-1).auth, 'Bearer tok-estudio');
});

test('admin: la cuenta del estudio recibe ficha solo si ya está vinculada a un negocio, y el estado lo muestra', async () => {
  const { n, d } = await base();
  assert.equal((await admin(d, 'PUT', `/cuentas/${ESTUDIO}/ficha`, { texto: FICHA, activa: true })).status, 400, 'sin negocio no se crea uno solo');
  assert.equal((await n.negocios.list()).length, 0);
  await n.negocios.guardar(null, { nombre: 'ZustroLabs', emails: [], cuentas: [ESTUDIO] });
  assert.equal((await admin(d, 'PUT', `/cuentas/${ESTUDIO}/ficha`, { texto: FICHA, activa: true })).status, 200);
  const est = (await (await admin(d, 'GET', '/estado')).json()).cuentas.find((c) => c.id === ESTUDIO);
  assert.equal(est.estudio, true);
  assert.deepEqual(est.ficha, { tiene: true, activa: true, nombre: 'Panadería La Espiga', pendientes: [] });
  assert.ok(est.negocio);
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

test('los scripts de Windows se guardan con BOM (PowerShell 5.1 lee los .ps1 sin BOM como ANSI y rompe los acentos)', () => {
  const leer = (n) => readFileSync(new URL(`../scripts/${n}`, import.meta.url));
  for (const n of ['comun.ps1', 'instagram-cliente.ps1', 'cliente-nuevo.ps1', 'whatsapp-cliente.ps1']) assert.deepEqual([...leer(n).subarray(0, 3)], [0xef, 0xbb, 0xbf], n);
  const comun = leer('comun.ps1').toString('utf8');
  for (const t of ['/ficha/revisar', '/ficha/probar', '/ficha"', '"/negocios"', 'PLANTILLA.md', 'notepad.exe']) assert.ok(comun.includes(t), t);
  assert.doesNotMatch(comun, /\$args\s*=/, 'no se pisa la variable reservada $args');
  const ig = leer('instagram-cliente.ps1').toString('utf8');
  for (const t of ['. "$PSScriptRoot\\comun.ps1"', '-Ficha', 'Vincular-Cuenta', 'Preparar-Ficha', '[switch]$DesdeAlta']) assert.ok(ig.includes(t), t);
  const wa = leer('whatsapp-cliente.ps1').toString('utf8');
  for (const t of ['. "$PSScriptRoot\\comun.ps1"', 'Llamar POST "/ycloud"', '[switch]$DesdeAlta', '[switch]$Desconectar', '$apiKey = $null', 'Paso-Acceso']) assert.ok(wa.includes(t), t);
  assert.doesNotMatch(wa, /Write-Host[^\n]*\$apiKey/, 'la clave de API nunca se muestra');
  // ZL-138: el alta completa es alta.ps1; cliente-nuevo.ps1 solo lo llama.
  assert.deepEqual([...leer('alta.ps1').subarray(0, 3)], [0xef, 0xbb, 0xbf], 'alta.ps1');
  assert.deepEqual([...leer('instagram-app-clientes.ps1').subarray(0, 3)], [0xef, 0xbb, 0xbf], 'instagram-app-clientes.ps1');
  assert.ok(leer('cliente-nuevo.ps1').toString('utf8').includes('alta.ps1'));
  const alta = leer('alta.ps1').toString('utf8');
  for (const t of ['. "$PSScriptRoot\\comun.ps1"', 'instagram-cliente.ps1', '-SinFicha', 'whatsapp-cliente.ps1', '[3] Los dos', 'Paso-Acceso', '-DesdeAlta',
    '/verificar', '/instagram-link', '/ficha"', 'negocio = $neg.id', '[switch]$Verificar', 'Mensaje-Bienvenida']) assert.ok(alta.includes(t), t);
  assert.doesNotMatch(alta, /\$args\s*=/, 'no se pisa la variable reservada $args');
  // Nada de lo que se le manda al cliente habla de precios ni de «empresa» (HZZ).
  const bienvenida = alta.slice(alta.indexOf('function Mensaje-Bienvenida'), alta.indexOf('# ── 0.'));
  assert.doesNotMatch(bienvenida, /precio|empresa|contrat/i);
});

test('ZL-145: si el saludo de la ficha ya dice «¡Hola!», no se le antepone el saludo fijo (un solo saludo)', async () => {
  const { yaSaluda, perfilNegocio, parsearFicha } = await import('../src/negocio.js');
  for (const t of ['¡Hola! Soy el asistente', 'Hola, soy', 'Buenas! Soy', '👋 ¡Hola!', 'Buen día', 'Hi! I am', 'Pozdrav! Ja sam']) assert.equal(yaSaluda(t), true, t);
  for (const t of ['Soy el asistente de Ventro', 'Somos una panadería', 'Holanda es lindo']) assert.equal(yaSaluda(t), false, t);
  const ficha = parsearFicha(readFileSync(new URL('./ficha-prueba.md', import.meta.url), 'utf8')).ficha;
  const conHola = perfilNegocio({ ...ficha, saludo: '¡Hola! Soy el asistente de la panadería.', saludos: { es: '¡Hola! Soy el asistente de la panadería.' } }).textos('es');
  assert.equal(conHola.hola, '');
  const sinHola = perfilNegocio({ ...ficha, saludo: 'Soy el asistente de la panadería.', saludos: { es: 'Soy el asistente de la panadería.' } }).textos('es');
  assert.match(sinHola.hola, /Gracias por escribirnos/);
  const { atender } = await import('../src/whatsapp.js');
  const r = await atender({ id: 'x1', from: 'yc:1:2', kind: 'text', text: 'hola' }, { memoria: null, preguntar: async () => assert.fail('sin IA'), perfil: perfilNegocio({ ...ficha, saludo: '¡Hola! Soy el asistente de la panadería.', saludos: { es: '¡Hola! Soy el asistente de la panadería.' } }) });
  const primero = r.send[0].text.body;
  assert.equal((primero.match(/hola/gi) ?? []).length, 1, primero);
  assert.ok(primero.startsWith('¡Hola! Soy el asistente'), primero);
});

// ——— Memoria corta y cierre (ZL-146) ———

test('nombreDeMensaje: un nombre sí; una pregunta, un número o un mensaje largo no', async () => {
  const { nombreDeMensaje } = await import('../src/whatsapp.js');
  assert.equal(nombreDeMensaje('ana'), 'Ana');
  assert.equal(nombreDeMensaje('Soy María José López.'), 'María José López');
  assert.equal(nombreDeMensaje('me llamo luis'), 'Luis');
  assert.equal(nombreDeMensaje("I'm John"), 'John');
  // ZL-153: lo que pasó en una charla real («¡Listo, Nelson Me Llamo!»).
  assert.equal(nombreDeMensaje('Nelson me llamo'), 'Nelson');
  assert.equal(nombreDeMensaje('sí, soy Ana'), 'Ana');
  assert.equal(nombreDeMensaje('dale, me llamo luis'), 'Luis');
  assert.equal(nombreDeMensaje('Hola, soy Nelson Zalazar!'), 'Nelson Zalazar');
  assert.equal(nombreDeMensaje('Esteban'), 'Esteban', '«es» al principio de un nombre no se corta');
  for (const no of ['¿La hacen sin TACC?', '3415551234', 'sí', 'quiero saber si tienen torta de limón para mañana', 'a@b.com', '']) assert.equal(nombreDeMensaje(no), '', no);
});

test('mensajesConHistorial: alterna persona y asistente, empieza por la persona y termina con el mensaje nuevo', async () => {
  const { mensajesConHistorial } = await import('../src/negocio.js');
  assert.deepEqual(mensajesConHistorial([], 'hola'), [{ role: 'user', content: 'hola' }]);
  const m = mensajesConHistorial([{ r: 'a', t: 'saludo suelto' }, { r: 'u', t: 'a' }, { r: 'a', t: 'b' }, { r: 'a', t: 'c' }, { r: 'x', t: 'raro' }], 'd');
  assert.deepEqual(m, [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b\nc' }, { role: 'user', content: 'd' }]);
  // La IA recibe la charla en el pedido a la API.
  const cuerpos = [];
  const llamar = async (c) => (cuerpos.push(c), { salida: { respuesta: 'ok', persona: false, fuera_de_tema: false, idioma: 'es' }, uso: {} });
  await preguntadorNegocio({}, ficha, { llamar })('¿y facturas?', 'es', { historial: [{ r: 'u', t: 'hola' }, { r: 'a', t: '¡Hola!' }], cliente: { nombre: 'Ana', resumen: 'Quiere pan.', dias: 2 }, objetivo: 'consultas' });
  assert.equal(cuerpos[0].messages.length, 3);
  assert.match(cuerpos[0].system, /<cliente>\nNombre: Ana\nLo que sabemos: Quiere pan\.\nÚltima charla: hace 2 día\(s\)\n<\/cliente>/);
  assert.match(cuerpos[0].system, /avanzar = «consulta»/);
});

test('prompt: guía al cierre, no empuja a PERSONA y usa «Cómo vendemos» y el objetivo de la ficha', () => {
  const conVender = parsearFicha(FICHA.replace('## Lo que sabe', '## Cómo vendemos\n- Preguntá para cuántas personas es antes de recomendar una torta.\n\n## Lo que sabe').replace('- Horas de pausa: 6', '- Horas de pausa: 6\n- Objetivo: consultas'));
  assert.ok(conVender.ok, conVender.errores.join(' | '));
  assert.equal(conVender.ficha.objetivo, 'consultas');
  const p = promptNegocio(conVender.ficha, 'WhatsApp', null, null, null, null, { objetivo: 'consultas' });
  assert.match(p, /## Cómo vende el negocio[\s\S]*para cuántas personas/);
  assert.match(p, /Nunca ofrezcas una persona por tu cuenta ni sugieras escribir PERSONA/);
  assert.match(p, /<cliente>\n\(primera vez\)\n<\/cliente>/);
  assert.match(promptNegocio(ficha, 'WhatsApp', null, null, null, '(vacío)', { objetivo: 'pedidos' }), /arme su pedido acá mismo/);
  assert.match(parsearFicha(FICHA.replace('- Horas de pausa: 6', '- Horas de pausa: 6\n- Objetivo: vender humo')).errores.join(), /Objetivo/);
});

test('memoria: guarda solo lo conocido; los mensajes se olvidan a las 48 h, el nombre y el resumen quedan', async () => {
  const m = memoria();
  const DE = 'ig:1.2';
  await m.put(DE, { idioma: 'es', humanoHasta: 0, hist: [{ r: 'u', t: 'hola' }, { r: 'z', t: 'raro' }], histT: T0, nombre: 'Ana', resumen: 'Quiere pan.', ultimo: T0, consulta: { paso: 'nombre', tipo: 'otro', interes: 'x' }, otraCosa: 'no' });
  const e = await m.get(DE);
  assert.deepEqual(e.hist, [{ r: 'u', t: 'hola' }]);
  assert.deepEqual(e.consulta, { paso: 'nombre', tipo: 'consulta', interes: 'x' });
  assert.equal(e.otraCosa, undefined);
  const viejo = adaptadores(crearAtencion(almacenPrueba()), () => T0 + 49 * 3600_000).memoria;
  await viejo.put(DE, e);
  const v = await viejo.get(DE);
  assert.equal(v.hist, undefined, 'pasadas 48 h, sin mensajes');
  assert.deepEqual([v.nombre, v.resumen], ['Ana', 'Quiere pan.']);
});

// ——— Lo que el lector de fichas no puede perder sin avisar (ZL-147) ———

test('ficha: «Precios: solo los "desde"…» es sí; las pautas en varias secciones se juntan en «Cómo vendemos»; lo desconocido se avisa', () => {
  const texto = FICHA.replace('- Precios: sí', '- Precios: solo los "desde" de esta ficha')
    .replace('## Lo que sabe', '## Cómo vende\n- Entender el caso antes de recomendar.\n\n## Dudas y objeciones\n- Preguntar qué lo frena.\n\n## Tomar los datos\n- Pedir el rubro.\n\n## Estilo\n- Mensajes cortos.\n\n## Horóscopo\n- Esto no lo lee nadie.\n\n## Lo que sabe');
  const p = parsearFicha(texto);
  assert.ok(p.ok, p.errores.join(' | '));
  assert.equal(p.ficha.precios, true);
  for (const t of ['### Cómo vende', 'Entender el caso', '### Dudas y objeciones', 'Preguntar qué lo frena', '### Tomar los datos', 'Pedir el rubro', '### Estilo', 'Mensajes cortos']) assert.ok(p.ficha.vender.includes(t), t);
  assert.doesNotMatch(p.ficha.vender, /Horóscopo|no lo lee nadie/);
  assert.equal(p.avisos.length, 1);
  assert.match(p.avisos[0], /«## Horóscopo» no la lee el asistente/);
  assert.deepEqual(resumenFicha(p).avisos, p.avisos);
  assert.match(promptNegocio(p.ficha), /## Cómo vende el negocio[\s\S]*Preguntar qué lo frena[\s\S]*Mensajes cortos/);
  assert.equal(parsearFicha(FICHA.replace('- Precios: sí', '- Precios: no, nunca')).ficha.precios, false);
  assert.deepEqual(parsearFicha(FICHA).avisos, [], 'la ficha de prueba no tiene secciones desconocidas');
  assert.deepEqual(parsearFicha(PLANTILLA).avisos, [], 'la plantilla tampoco');
});

test('conAjustes (ZL-149): lo que carga el negocio en «Cómo vendés» lo sabe el asistente y sus montos quedan permitidos', async () => {
  const { conAjustes } = await import('../src/negocio.js');
  const f = conAjustes(ficha, { entrega: 'retiro', retiro: 'Calle Ficticia 123', envio: '', pago: 'alias LA.ESPIGA o $ 1.200 de seña' });
  assert.match(f.conocimiento, /## Entrega y pago \(lo carga el negocio\)\nEntrega: solo retiro en el local\.\nRetiro \(dónde y cuándo\): Calle Ficticia 123\nCómo se paga: alias LA\.ESPIGA/);
  assert.ok(f.permitidos.montos.includes('1200'));
  assert.equal(controlarNegocio({ respuesta: 'Se paga una seña de $ 1.200.', persona: false, fuera_de_tema: false }, f).notas.length, 0);
  assert.equal(conAjustes(ficha, null), ficha);
});
