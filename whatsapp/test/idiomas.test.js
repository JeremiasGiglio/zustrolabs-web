// Fichas con varios idiomas (ZL-126): el primer mensaje pregunta el idioma, y el saludo, el menú y sus respuestas
// salen en el idioma elegido. Con un solo idioma, todo sigue igual (lo prueba negocio.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adaptadores, almacenPrueba, crearAtencion } from '../src/atencion.js';
import { parsearFicha, perfilNegocio, preguntadorNegocio, promptNegocio } from '../src/negocio.js';
import { atender } from '../src/whatsapp.js';

const BASE = readFileSync(new URL('./ficha-prueba.md', import.meta.url), 'utf8');
const T0 = 1_792_000_000_000;
const EXTRA_EN = `
## Saludo (inglés)

I'm the virtual assistant of Panadería La Espiga 🥖

## Menú (inglés)

### 1. 🥖 Bread and pastries
Fresh bread every morning.

### 2. 🎂 Cakes to order
Order two days ahead.

### 3. 📍 Opening hours
Monday to Saturday.
`;
const EXTRA_HR = `
## Saludo (croata)

Ja sam virtualni asistent pekarnice 🥖

## Menú (croata)

### 1. 🥖 Kruh i peciva
Svježi kruh svako jutro.

### 2. 🎂 Torte po narudžbi
Naručite dva dana ranije.

### 3. 📍 Radno vrijeme
Od ponedjeljka do subote.
`;
const conIdiomas = (linea, ...extras) => BASE.replace('- Idioma: castellano', `- Idioma: ${linea}`) + extras.join('\n');
const TRES = conIdiomas('castellano, inglés, croata', EXTRA_EN, EXTRA_HR);

function charla(fichaTexto) {
  const pf = parsearFicha(fichaTexto);
  assert.ok(pf.ok, pf.errores.join(' | '));
  const perfil = perfilNegocio(pf.ficha);
  const memoria = adaptadores(crearAtencion(almacenPrueba()), () => T0).memoria;
  const preguntas = [];
  const preguntar = async (texto, idioma) => (preguntas.push([texto, idioma]), { respuesta: `IA (${idioma})`, persona: false, fuera_de_tema: false, vacia: false, notas: [] });
  let k = 0;
  const decir = async (text) => {
    const r = await atender({ id: `m${++k}`, from: 'ig:1.2', ts: T0 / 1000, kind: 'text', text }, { memoria, charlas: null, preguntar, now: T0 + k, perfil });
    return { ...r, textos: r.send.map((m) => m.text?.body ?? '') };
  };
  return { decir, preguntas, ficha: pf.ficha };
}

test('ficha: varios idiomas, el primero es el principal; cada uno con su saludo y su menú', () => {
  const p = parsearFicha(TRES);
  assert.ok(p.ok, p.errores.join(' | '));
  assert.deepEqual(p.ficha.idiomas, ['es', 'en', 'hr']);
  assert.equal(p.ficha.idioma, 'es');
  assert.match(p.ficha.saludos.en, /virtual assistant/);
  assert.deepEqual(p.ficha.menus.hr.map((o) => o.titulo), ['🥖 Kruh i peciva', '🎂 Torte po narudžbi', '📍 Radno vrijeme']);
  // El principal sigue en saludo y menu (lo usa el prompt de la IA).
  assert.equal(p.ficha.menu.length, 3);
  assert.deepEqual(parsearFicha(conIdiomas('inglés y castellano', EXTRA_EN.replace(/\(inglés\)/g, '(castellano)'))).ficha?.idiomas, ['en', 'es']);
});

test('ficha: los errores de idioma se explican', () => {
  const err = (t) => parsearFicha(t).errores.join(' | ');
  assert.match(err(conIdiomas('castellano, inglés')), /falta la sección «## Saludo \(inglés\)»/);
  assert.match(err(conIdiomas('castellano, inglés')), /falta la sección «## Menú \(inglés\)»/);
  assert.match(err(conIdiomas('castellano, inglés', EXTRA_EN.replace(/### 3\.[\s\S]*$/, ''))), /el menú \(inglés\) tiene que tener las mismas opciones que el principal \(3\)/);
  assert.match(err(conIdiomas('castellano, italiano')), /«Idioma» tiene que ser castellano, inglés o croata/);
  assert.match(err(conIdiomas('castellano, inglés', EXTRA_EN, '\n## Nunca (inglés)\n- Nothing.\n')), /solo el saludo y el menú van por idioma/);
});

test('charla: el primer mensaje pregunta el idioma; el número elige; el menú y sus opciones salen en ese idioma', async () => {
  const { decir, preguntas } = charla(TRES);
  const r1 = await decir('hello');
  assert.equal(r1.metrica, 'pide_idioma');
  assert.match(r1.textos[0], /Gracias por escribir a Panadería La Espiga[\s\S]*Thanks for writing to Panadería La Espiga[\s\S]*Na kojem jeziku/);
  assert.match(r1.textos[0], /1️⃣ Español 🇦🇷\n2️⃣ English 🇬🇧\n3️⃣ Hrvatski 🇭🇷$/);
  // Mientras elige, 2 es el idioma (no la opción 2 del menú).
  const r2 = await decir('2');
  assert.equal(r2.metrica, 'idioma');
  assert.match(r2.textos[0], /^Hi! 👋[\s\S]*virtual assistant of Panadería La Espiga/);
  assert.match(r2.textos[1], /How can I help\?[\s\S]*Bread and pastries[\s\S]*Reply with a number/);
  // Ya eligió: 2 es la opción del menú, en inglés.
  const r3 = await decir('2');
  assert.equal(r3.metrica, 'opcion');
  assert.match(r3.textos[0], /Order two days ahead[\s\S]*type PERSON/);
  // La IA recibe el idioma elegido, y el pie va en ese idioma.
  const r4 = await decir('Do you have gluten free bread?');
  assert.equal(r4.metrica, 'ia');
  assert.deepEqual(preguntas, [['Do you have gluten free bread?', 'en']]);
  assert.equal(r4.textos[0], 'IA (en)');
  // Saludar de nuevo: saludo y menú en el idioma elegido, sin volver a preguntar.
  assert.match((await decir('hola')).textos[1], /How can I help\?/);
  // Pedir otro idioma por su nombre lo cambia y vuelve a mostrar el saludo y el menú.
  const r5 = await decir('español');
  assert.equal(r5.metrica, 'idioma');
  assert.match(r5.textos[1], /¿En qué te puedo ayudar\?[\s\S]*Pan y facturas/);
  // IDIOMA vuelve a preguntar.
  assert.equal((await decir('idioma')).metrica, 'pide_idioma');
  const r6 = await decir('3');
  assert.match(r6.textos[1], /Kako vam mogu pomoći\?[\s\S]*Kruh i peciva/);
});

test('charla: una pregunta antes de elegir idioma recibe la pregunta del idioma; un idioma que la ficha no tiene no se elige', async () => {
  const dos = charla(conIdiomas('castellano, inglés', EXTRA_EN));
  const r = await dos.decir('¿Tienen facturas?');
  assert.equal(r.metrica, 'pide_idioma');
  assert.match(r.textos[0], /1️⃣ Español 🇦🇷\n2️⃣ English 🇬🇧$/);
  assert.equal((await dos.decir('hrvatski')).metrica !== 'idioma', true, 'croata no está en esta ficha');
  assert.equal((await dos.decir('3')).metrica !== 'idioma', true, 'no hay opción 3 de idioma');
  assert.equal((await dos.decir('1')).metrica, 'idioma');
});

test('charla: sin emojis, la pregunta del idioma va con números y sin banderas', async () => {
  const { decir } = charla(TRES.replace('- Emojis: sí', '- Emojis: no'));
  const t = (await decir('hola')).textos[0];
  assert.match(t, /1\. Español\n2\. English\n3\. Hrvatski$/);
  assert.doesNotMatch(t, /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u);
});

test('IA: el prompt dice el idioma elegido solo si la ficha tiene varios', async () => {
  const tres = parsearFicha(TRES).ficha;
  assert.match(promptNegocio(tres, 'Instagram', null, 'en'), /la persona eligió hablar en inglés: respondé en inglés/);
  const cuerpos = [];
  const llamar = async (c) => (cuerpos.push(c), { salida: { respuesta: 'ok', persona: false, fuera_de_tema: false }, uso: {} });
  await preguntadorNegocio({}, tres, { llamar })('hi', 'en');
  assert.match(cuerpos[0].system, /eligió hablar en inglés/);
  const uno = parsearFicha(BASE).ficha;
  await preguntadorNegocio({}, uno, { llamar })('hi', 'en');
  assert.doesNotMatch(cuerpos[1].system, /eligió hablar/);
  assert.match(cuerpos[1].system, /respondé en el idioma del último mensaje/);
});

test('plantilla: el ejemplo de varios idiomas está comentado y, al sacarle el comentario, se lee', () => {
  const plantilla = readFileSync(new URL('../fichas/PLANTILLA.md', import.meta.url), 'utf8');
  assert.deepEqual(parsearFicha(plantilla).ficha?.idiomas, ['es']);
  const dos = plantilla.replace('- Idioma: castellano', '- Idioma: castellano, inglés').replace(/<!--\n(## Varios idiomas[\s\S]*?)\n-->/, '$1');
  const errores = parsearFicha(dos).errores.join(' | ');
  assert.doesNotMatch(errores, /Saludo \(inglés\)|Menú \(inglés\)/);
  assert.match(errores, /el menú \(inglés\) tiene que tener las mismas opciones/, 'el ejemplo tiene una sola opción: avisa');
});

test('PERSONA: el horario va en el idioma de la charla, y sin traducción no se nombra', async () => {
  const texto = TRES.replace(/(- Cuándo responde una persona: [^\n]*\n)/, '$1- Cuándo responde una persona (inglés): Monday to Saturday\n');
  const { decir, ficha } = charla(texto);
  assert.equal(ficha.horarios.en, 'Monday to Saturday');
  await decir('hello');
  await decir('2');
  assert.match((await decir('person')).textos[0], /someone will reply to you here \(Monday to Saturday\)\./);
  const otra = charla(texto);
  await otra.decir('hola');
  await otra.decir('3');
  const hr = (await otra.decir('osoba')).textos[0];
  assert.match(hr, /odgovoriti osoba\.$/);
  assert.doesNotMatch(hr, /\(/, 'sin el horario en castellano');
});
