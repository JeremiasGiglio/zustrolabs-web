// ZL-162: la charla sin contradicciones (auditoría del 21/11). Mensajes seguidos → una sola respuesta, el prompt con
// las reglas nuevas y las piezas de texto. Sin red; datos ficticios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adaptadores, almacenPrueba, crearAtencion } from '../src/atencion.js';
import { conAvisoDia, conPreguntas, controlarNegocio, parsearFicha, perfilNegocio, promptNegocio } from '../src/negocio.js';
import { atender, siNo, sinPreguntaFinal } from '../src/whatsapp.js';

const T0 = 1_792_000_000_000;
const ficha = parsearFicha(readFileSync(new URL('./ficha-prueba.md', import.meta.url), 'utf8')).ficha;
const perfil = perfilNegocio(ficha);
const DE = 'ig:17841400000000002.17841400000000009';
const ev = (text, o = {}) => ({ id: 'm' + Math.random(), from: DE, ts: T0 / 1000, kind: 'text', text, ...o });

test('mensajes seguidos: si llega otro mientras se responde el primero, ese absorbe al primero y sale UNA sola respuesta', async () => {
  let t = T0;
  const { memoria } = adaptadores(crearAtencion(almacenPrueba()), () => t);
  // Primer mensaje: su ráfaga termina y empieza a responderse.
  await memoria.sumarRafaga(DE, { id: 'a', t: 'tengo una panadería y no doy abasto' });
  assert.deepEqual(await memoria.tomarRafaga(DE, 'a'), ['tengo una panadería y no doy abasto']);
  assert.equal(await memoria.cursoVigente(DE, 'a'), true);
  // 8 s después llega otro: su ráfaga incluye al primero, que deja de estar vigente.
  t += 8000;
  await memoria.sumarRafaga(DE, { id: 'b', t: 'y cuánto sale?' });
  assert.deepEqual(await memoria.tomarRafaga(DE, 'b'), ['tengo una panadería y no doy abasto', 'y cuánto sale?']);
  assert.equal(await memoria.cursoVigente(DE, 'a'), false);
  assert.equal(await memoria.cursoVigente(DE, 'b'), true);
  // La respuesta del primero se descarta antes de tocar nada (ni memoria ni pedidos ni consultas).
  await memoria.put(DE, { idioma: 'es', humanoHasta: 0, ultimo: T0 });
  const antes = await memoria.get(DE);
  const pedidos = { antes: async () => null, contexto: async () => null, despues: async () => assert.fail('no toca el carrito') };
  const r = await atender(ev('tengo una panadería y no doy abasto', { id: 'a' }), { memoria, preguntar: async () => ({ respuesta: 'Te sirve el asistente.', persona: false, fuera_de_tema: false, vacia: false, notas: [], pedido: { cambia: true, items: [] } }), now: t, perfil, pedidos, vigente: () => memoria.cursoVigente(DE, 'a') });
  assert.deepEqual([r.send, r.metrica], [[], 'reemplazado']);
  assert.deepEqual((await memoria.get(DE)).hist, antes.hist, 'la memoria corta no cambió');
  // Al terminar el segundo, la próxima ráfaga arranca de cero.
  await memoria.terminarCurso(DE, 'a');
  assert.equal(await memoria.cursoVigente(DE, 'b'), true, 'terminar el viejo no borra el nuevo');
  await memoria.terminarCurso(DE, 'b');
  await memoria.sumarRafaga(DE, { id: 'c', t: 'gracias' });
  assert.deepEqual(await memoria.tomarRafaga(DE, 'c'), ['gracias']);
});

test('siNo y sinPreguntaFinal: lo justo para no pisar preguntas', () => {
  assert.deepEqual(['sí', 'Sí, dale!', 'ok perfecto', 'yes please', 'da'].map(siNo), ['si', 'si', 'si', 'si', 'si']);
  assert.deepEqual(['no', 'no, gracias', 'mejor no'].map(siNo), ['no', 'no', 'no']);
  assert.deepEqual(['y cuánto sale?', 'si pero cuánto sale?', 'quiero 3 empanadas', 'sí, y además quiero que me manden el menú completo por favor'].map(siNo), [null, null, null, null]);
  assert.equal(sinPreguntaFinal('¡Dale! No publicamos valores. ¿Te sirve que lo dejemos así?'), 'No publicamos valores.');
  assert.equal(sinPreguntaFinal('¿Te sirve?'), '');
  assert.equal(sinPreguntaFinal('Hacemos tortas. Tenemos de chocolate.'), 'Hacemos tortas. Tenemos de chocolate.');
});

test('prompt (ZL-162): no sabe → lo dice sin preguntas y motivo «no_se»; persona solo si lo pide o reclama; una pregunta por mensaje; sin «¡Dale!» ni «bot»; no mezcla productos', () => {
  const p = promptNegocio(ficha, 'WhatsApp');
  assert.match(p, /decilo con honestidad en una oración corta .*SIN hacer ninguna pregunta, y poné persona = true con motivo «no_se»/);
  assert.match(p, /motivo «pidio» SOLO si lo pide con claridad, o con motivo «reclamo»/);
  assert.match(p, /Una sola pregunta por mensaje/);
  assert.match(p, /Nunca arranques con «¡Dale!»/);
  assert.match(p, /«Soy el asistente virtual de Panadería La Espiga».*sin la palabra «bot»/);
  assert.match(p, /no le sumes funciones de otros productos o rubros \(por ejemplo, turnos a una panadería\)/);
  const cons = promptNegocio(ficha, 'WhatsApp', null, null, null, null, { objetivo: 'consultas' });
  assert.match(cons, /Si pregunta el precio y no está en la información, explicá .* preguntá si quiere que el equipo lo contacte/);
  assert.doesNotMatch(cons, /interés en avanzar \(precio/, 'preguntar el precio ya no lleva directo a pedir el nombre');
});

test('controlarNegocio: el motivo del pase; sin motivo claro o vacía, «no_se» (se ofrece, no se pasa solo)', () => {
  assert.equal(controlarNegocio({ respuesta: 'Ya te paso.', persona: true, motivo: 'reclamo', fuera_de_tema: false }, ficha).motivo, 'reclamo');
  assert.equal(controlarNegocio({ respuesta: 'Ya te paso.', persona: true, fuera_de_tema: false }, ficha).motivo, 'no_se');
  assert.equal(controlarNegocio({ respuesta: 'Visitá otro-sitio.com', persona: false, motivo: 'pidio', fuera_de_tema: false }, ficha).motivo, 'no_se');
  assert.equal(controlarNegocio({ respuesta: 'Hola', persona: false, fuera_de_tema: false }, ficha).motivo, undefined);
});

test('preguntas frecuentes y aviso del día: entran en la información y sus montos quedan permitidos', () => {
  const f = conPreguntas(ficha, [{ p: '¿Hacen factura A?', r: 'Sí, hacemos factura A. El envío cuesta $1.500.' }, { p: 'vacía', r: '' }]);
  assert.match(f.conocimiento, /## Preguntas frecuentes[^\n]*\n- ¿Hacen factura A\?\n  Sí, hacemos factura A/);
  assert.ok(f.permitidos.montos.includes('1500'));
  assert.equal(controlarNegocio({ respuesta: 'El envío cuesta $1.500.', persona: false, fuera_de_tema: false }, f).respuesta, 'El envío cuesta $1.500.');
  const a = conAvisoDia(ficha, { texto: 'Hoy la docena de medialunas está $3.000.', hasta: T0 + 1 }, T0);
  assert.ok(a.permitidos.montos.includes('3000'), 'antes el monto del aviso del día se borraba');
});
