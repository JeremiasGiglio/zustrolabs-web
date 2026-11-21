// ZL-164: «Mi negocio». Horarios calculados por el código, fechas especiales y feriados, fuera de horario, envíos por
// zona en el pedido por chat, formas de pago, «lo que no supo responder» y la API de la app. Datos ficticios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cuandoResponden, elegirZona, estadoAhora, feriados, fueraDeHorarioAhora, instanteEnZona, normalizarMiNegocio, textoMiNegocioIa } from '../src/minegocio.js';
import { conMiNegocio, fichaDelNegocio, recordarFeriados } from '../src/index.js';
import { adaptadores, almacenPrueba, crearAtencion } from '../src/atencion.js';
import { crearCatalogo, ejecutarCatalogo } from '../src/catalogo.js';
import { parsearFicha, perfilNegocio } from '../src/negocio.js';
import { textoEstado } from '../src/negocios.js';
import { pedidosDeCharla } from '../src/pedidos-charla.js';
import { atender } from '../src/whatsapp.js';
import { sqlPrueba } from './sqlite.js';

const AR = 'America/Argentina/Buenos_Aires';
const FICHA = parsearFicha(readFileSync(new URL('./ficha-prueba.md', import.meta.url), 'utf8')).ficha;
// Lunes 23/11/2026 a las 10:00 en Rosario (13:00 UTC).
const LUN_10 = Date.parse('2026-11-23T13:00:00Z');
const MN = normalizarMiNegocio({
  horarios: [[{ abre: '09:00', cierra: '13:00' }, { abre: '16:00', cierra: '20:30' }], [{ abre: '09:00', cierra: '20:30' }], [{ abre: '09:00', cierra: '20:30' }], [{ abre: '09:00', cierra: '20:30' }], [{ abre: '09:00', cierra: '20:30' }], [{ abre: '09:00', cierra: '13:00' }], []],
  especiales: [{ desde: '2026-12-08', hasta: '2026-12-08', tipo: 'cerrado', nota: 'feriado' }],
  direccion: 'San Martín 1234, Rosario',
  envios: { zonas: [{ nombre: 'Centro', costo: '1.500', gratisDesde: 20000, demora: 'en 2 horas' }, { nombre: 'Fisherton', costo: 2500, minimo: 10000 }] },
  pagos: { efectivo: true, transferencia: true, alias: 'LA.ESPIGA.PAN' },
  contacto: { instagram: '@laespiga' },
});

test('normalizar: solo campos conocidos, turnos válidos y ordenados (hasta 2), montos a número, sin HTML', () => {
  const mn = normalizarMiNegocio({ horarios: [[{ abre: '16:00', cierra: '20:00' }, { abre: '09:00', cierra: '13:00' }, { abre: '21:00', cierra: '22:00' }], [{ abre: '25:00', cierra: '26:00' }]], direccion: '<b>Calle</b> 1', fueraDeHorario: 'otra', raro: 1, envios: { zonas: [{ nombre: 'Norte', costo: '$ 1.500,50' }, { nombre: '' }] } });
  assert.deepEqual(mn.horarios[0], [{ abre: '09:00', cierra: '13:00' }, { abre: '16:00', cierra: '20:00' }]);
  assert.deepEqual(mn.horarios[1], []);
  assert.equal(mn.direccion, 'Calle 1');
  assert.equal(mn.fueraDeHorario, 'pedidos', 'lo desconocido vuelve al recomendado');
  assert.equal(mn.raro, undefined);
  assert.deepEqual(mn.envios.zonas.map((z) => [z.nombre, z.costo]), [['Norte', 1500.5]]);
  // Lo que no viene se conserva de antes.
  assert.equal(normalizarMiNegocio({ direccion: 'Otra 2' }, MN).horarios[0].length, 2);
});

test('el código calcula si está abierto y cuándo abre (dos turnos, fin de semana, fecha especial, hora de Croacia)', () => {
  assert.deepEqual(estadoAhora(MN, AR, LUN_10), { abierto: true, cierra: '13:00' });
  assert.equal(cuandoResponden(MN, AR, LUN_10), 'hoy hasta las 13:00');
  // Lunes 14:00: entre turnos.
  assert.equal(cuandoResponden(MN, AR, LUN_10 + 4 * 3600_000), 'hoy desde las 16:00');
  // Sábado 28/11 a las 14:00: abre el lunes.
  const sab = Date.parse('2026-11-28T17:00:00Z');
  assert.equal(cuandoResponden(MN, AR, sab), 'el lunes desde las 9:00');
  assert.equal(cuandoResponden(MN, AR, sab, 'en'), 'on Monday from 9:00');
  // Lunes 7/12 a las 21:00: el martes 8/12 es fecha especial (cerrado), abre el miércoles.
  assert.equal(cuandoResponden(MN, AR, Date.parse('2026-12-08T00:00:00Z')), 'el miércoles desde las 9:00');
  // El cambio de hora de Croacia: las 9:00 del 29/3 son las 7:00 UTC.
  assert.equal(new Date(instanteEnZona('2026-03-29', '09:00', 'Europe/Zagreb')).toISOString(), '2026-03-29T07:00:00.000Z');
  // Sin horarios cargados, no dice si está abierto.
  assert.equal(estadoAhora(normalizarMiNegocio({}), AR, LUN_10), null);
});

test('feriados: Argentina con los trasladables de la Ley 27.399, Croacia con Pascua; otros países, ninguno', () => {
  const ar = feriados('AR', 2026).map((f) => f.fecha);
  for (const f of ['2026-01-01', '2026-02-16', '2026-02-17', '2026-04-03', '2026-06-15', '2026-08-17', '2026-10-12', '2026-11-23', '2026-12-08']) assert.ok(ar.includes(f), f);
  const hr = feriados('HR', 2026).map((f) => f.fecha);
  for (const f of ['2026-04-05', '2026-04-06', '2026-06-04', '2026-05-30', '2026-11-18']) assert.ok(hr.includes(f), f);
  assert.deepEqual(feriados('UY', 2026), []);
});

test('la IA recibe fecha, hora, estado, horario, dirección con mapa, envíos y pagos (sin el alias); los textos fijos dicen hasta cuándo', () => {
  const t = textoMiNegocioIa(MN, AR, LUN_10);
  assert.match(t, /Ahora: lunes 23\/11\/2026, 10:00/);
  assert.match(t, /Estado ahora: ABIERTO, cierra hoy a las 13:00/);
  assert.match(t, /- Lunes: 9:00 a 13:00 y 16:00 a 20:30/);
  assert.match(t, /- Domingo: cerrado/);
  assert.match(t, /08\/12: cerrado \(feriado\)/);
  assert.match(t, /Mapa: https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=San%20Mart%C3%ADn%201234/);
  assert.match(t, /- Centro: \$ 1\.500 \(gratis desde \$ 20\.000\), llega en 2 horas/);
  assert.match(t, /Formas de pago: Efectivo, transferencia\./);
  assert.doesNotMatch(t, /LA\.ESPIGA\.PAN/, 'el alias no va a la IA');
  const dueño = { minegocio: MN, ajustes: { zona: AR } };
  const f = fichaDelNegocio(FICHA, dueño, LUN_10);
  assert.match(f.conocimiento, /## Mi negocio: fecha, hora[\s\S]*ABIERTO/);
  assert.ok(f.permitidos.montos?.length || f.permitidos.links?.length || Object.keys(f.permitidos).length, 'sus montos y el link del mapa quedan permitidos');
  assert.equal(f.horarioPersona, 'hoy hasta las 13:00');
  assert.match(perfilNegocio(f).textos('es').persona, /\(hoy hasta las 13:00\)/);
  // Sin «Mi negocio» igual sabe la fecha y la hora.
  assert.match(conMiNegocio(FICHA, { ajustes: { zona: AR } }, LUN_10).conocimiento, /Ahora: lunes 23\/11\/2026, 10:00/);
});

test('fuera de horario: según lo que eligió el dueño', () => {
  const noche = Date.parse('2026-11-24T02:00:00Z'); // lunes 23:00
  assert.equal(fueraDeHorarioAhora(MN, AR, LUN_10), null, 'abierto');
  const f = fueraDeHorarioAhora({ ...MN, fueraDeHorario: 'cerrado' }, AR, noche);
  assert.equal(f.modo, 'cerrado');
  assert.equal(new Date(f.hasta).toISOString(), '2026-11-24T12:00:00.000Z', 'abre el martes a las 9');
  assert.equal(f.cuando.es, 'mañana a las 9:00');
});

test('fuera de horario «no atender»: a cada persona se le dice una vez cuándo abren; BORRAR sigue andando', async () => {
  const mem = new Map();
  const memoria = { get: async (k) => mem.get(k) ?? null, put: async (k, v) => mem.set(k, v), delete: async (k) => mem.delete(k), visto: async () => false, contar: async () => 1 };
  const noche = Date.parse('2026-11-24T02:00:00Z');
  const f = fueraDeHorarioAhora({ ...MN, fueraDeHorario: 'cerrado' }, AR, noche);
  const perfil = { ...perfilNegocio(FICHA), pausa: { desde: `cerrado:${f.hasta}`, hasta: f.hasta, zona: AR, cerrado: f.cuando } };
  const preguntar = async () => { throw new Error('no tiene que llamar a la IA'); };
  let r = await atender({ id: 'm1', from: 'yc:1:2', kind: 'text', text: 'hola, tienen pan?' }, { memoria, preguntar, now: noche, perfil });
  assert.equal(r.metrica, 'cerrado_aviso');
  assert.match(r.send[0].text.body, /Ahora estamos cerrados 🙏 Abrimos mañana a las 9:00/);
  r = await atender({ id: 'm2', from: 'yc:1:2', kind: 'text', text: 'hola?' }, { memoria, preguntar, now: noche + 60_000, perfil });
  assert.deepEqual([r.metrica, r.send.length], ['pausa', 0], 'una sola vez');
  r = await atender({ id: 'm3', from: 'yc:1:2', kind: 'text', text: 'BORRAR' }, { memoria, preguntar, now: noche + 120_000, perfil });
  assert.notEqual(r.metrica, 'pausa');
});

function armarPedido(ajustes) {
  const { sql, transaccion } = sqlPrueba();
  const c = crearCatalogo(sql, transaccion, () => LUN_10);
  const pan = c.crear({ nombre: 'Pan francés', precio: 2500, stock: 10 }, 'duena@example.com');
  const cat = { ejecutar: async (op, args) => ejecutarCatalogo(c, op, args) };
  const mem = new Map();
  const memoria = { get: async (k) => mem.get(k) ?? null, put: async (k, v) => mem.set(k, v), delete: async (k) => mem.delete(k), visto: async () => false, contar: async () => 1 };
  const preguntar = async (texto) => (/2 kilos de pan/.test(texto)
    ? { respuesta: '¡Dale!', persona: false, fuera_de_tema: false, vacia: false, notas: [], pedido: { cambia: true, items: [{ ref: pan.id, cantidad: 2 }] } }
    : { respuesta: 'Sí, claro.', persona: false, fuera_de_tema: false, vacia: false, notas: [], pedido: { cambia: false, items: [] } });
  const perfil = perfilNegocio(FICHA);
  const DE = 'yc:5493410000001:5493410000009';
  const pedidos = pedidosDeCharla({ cat, charla: DE, canal: 'wa', negocio: FICHA.nombre, precios: true, ajustes });
  let n = 0;
  const decir = async (texto) => {
    const r = await atender({ id: `x${++n}`, from: DE, kind: 'text', text: texto }, { memoria, preguntar, now: LUN_10 + n, perfil, pedidos });
    return { ...r, texto: r.send.map((m) => m.text.body).join('\n---\n'), opciones: r.send.at(-1)?.opciones ?? null };
  };
  return { c, decir };
}

test('pedido con envío por zona: pregunta la zona, suma el costo en la revisión y queda en el pedido', async () => {
  const { c, decir } = armarPedido({ entrega: 'ambos', zona: AR, zonas: MN.envios.zonas, pago: 'Efectivo, transferencia' });
  await decir('hola');
  await decir('quiero 2 kilos de pan');
  await decir('si');
  let r = await decir('2');
  assert.match(r.texto, /A nombre de quién/);
  r = await decir('Ana');
  assert.equal(r.metrica, 'pedido_zona');
  assert.match(r.texto, /¿A qué zona lo enviamos\?\n1\. Centro \(\$ 1\.500, sin cargo > \$ 20\.000\)\n2\. Fisherton \(\$ 2\.500\)/);
  assert.deepEqual(r.opciones.map((o) => o.titulo), ['Centro', 'Fisherton']);
  r = await decir('el centro');
  assert.equal(r.metrica, 'pedido_direccion');
  r = await decir('San Martín 1234');
  assert.equal(r.metrica, 'pedido_revisar');
  assert.match(r.texto, /Entrega: envío a San Martín 1234 \(Centro, \$ 1\.500\)\nTotal con envío: \$ 6\.500/);
  r = await decir('si');
  assert.equal(r.metrica, 'pedido_nuevo');
  assert.match(r.texto, /Total con envío: \$ 6\.500/);
  const p = ejecutarCatalogo(c, 'pedidos', [{}]).valor.pedidos?.[0] ?? ejecutarCatalogo(c, 'pedido', [r.numero ?? 1]).valor;
  assert.deepEqual([p.comprador.zona, p.comprador.envio], ['Centro', 1500]);
  // El aviso de aceptado: la zona con su costo, el total con envío y el alias (que la IA no da).
  const aviso = textoEstado(p, 'aceptado', '', 'La Espiga', { pago: 'Efectivo, transferencia (alias: LA.ESPIGA.PAN)' });
  assert.match(aviso, /Cómo pagar: Efectivo, transferencia \(alias: LA\.ESPIGA\.PAN\)\nEnvío: Centro \(\$ 1\.500\) · total con envío: \$ 6\.500/);
});

test('pedido con envío: si no llega al mínimo de la zona, dice cuánto falta y vuelve a la entrega', async () => {
  const { decir } = armarPedido({ entrega: 'ambos', zona: AR, zonas: MN.envios.zonas });
  await decir('hola');
  await decir('quiero 2 kilos de pan');
  await decir('si');
  await decir('envío');
  await decir('Ana');
  let r = await decir('7');
  assert.match(r.texto, /Elegí la zona con su número/, 'un número que no es una zona se vuelve a pedir');
  r = await decir('2');
  assert.equal(r.metrica, 'pedido_minimo');
  assert.match(r.texto, /El pedido mínimo para envío a Fisherton es \$ 10\.000 \(faltan \$ 5\.000\)/);
  r = await decir('retiro');
  assert.equal(r.metrica, 'pedido_revisar');
  assert.match(r.texto, /Entrega: retirás en el local/);
});

test('elegirZona: por número, por nombre o parte del nombre', () => {
  assert.equal(elegirZona(MN.envios.zonas, '2').nombre, 'Fisherton');
  assert.equal(elegirZona(MN.envios.zonas, 'Centro!').nombre, 'Centro');
  assert.equal(elegirZona(MN.envios.zonas, 'fisher').nombre, 'Fisherton');
  assert.equal(elegirZona(MN.envios.zonas, '9'), null);
  assert.equal(elegirZona(MN.envios.zonas, 'zz'), null);
});

test('lo que no supo responder: suma una vez por pregunta parecida y no repite las que ya son frecuentes', async () => {
  const n = adaptadores(crearAtencion(almacenPrueba()), () => LUN_10);
  const { negocio } = await n.negocios.guardar(null, { nombre: 'La Espiga', emails: [], cuentas: [], preguntas: [{ p: '¿Hacen envíos?', r: 'Sí.' }] });
  await n.negocios.sumarNoSupo(negocio.id, '¿Tienen pan sin TACC?');
  await n.negocios.sumarNoSupo(negocio.id, 'tienen pan sin tacc');
  await n.negocios.sumarNoSupo(negocio.id, '¿Hacen envios?');
  const x = await n.negocios.get(negocio.id);
  assert.deepEqual(x.noSupo.map((y) => [y.p, y.n]), [['¿Tienen pan sin TACC?', 2]]);
});

test('recordatorio de feriado: una vez por feriado, solo si ese día abre y no lo cargó', async () => {
  const n = adaptadores(crearAtencion(almacenPrueba()), () => LUN_10);
  const sinEspecial = { ...MN, especiales: [] };
  const { negocio } = await n.negocios.guardar(null, { nombre: 'La Espiga', emails: [], cuentas: [], minegocio: sinEspecial, ajustes: { zona: AR } });
  await n.negocios.guardar(null, { nombre: 'Sin horarios', emails: [], cuentas: [] });
  // Martes 1/12: el 8/12 (martes, abre) es feriado.
  const hoy = Date.parse('2026-12-01T12:00:00Z');
  const d = { ...n, now: hoy, fetch: async () => new Response('', { status: 201 }) };
  const r = await recordarFeriados({}, d, hoy);
  assert.deepEqual(r.map((x) => [x.negocio, x.fecha]), [[negocio.id, '2026-12-08']]);
  assert.deepEqual(await recordarFeriados({}, d, hoy + 3600_000), [], 'no se repite');
  // Si lo carga como fecha especial, no hay nada que recordar.
  await n.negocios.guardar(negocio.id, { avisoFeriado: '', minegocio: MN });
  assert.deepEqual(await recordarFeriados({}, d, hoy), []);
});

test('normalizar: un turno que se pisa con el anterior no se guarda', () => {
  const mn = normalizarMiNegocio({ horarios: [[{ abre: '09:00', cierra: '18:00' }, { abre: '16:00', cierra: '20:00' }]] });
  assert.deepEqual(mn.horarios[0], [{ abre: '09:00', cierra: '18:00' }]);
});
