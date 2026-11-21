// ZL-166: canales y avisos. Mensajes largos en partes, texto al pie de una foto, avisos que no se pisan y el aviso de
// coexistencia de WhatsApp a los 10 días. Sin red; datos ficticios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partirTexto, recordarCoexistencia } from '../src/index.js';
import { adaptadores, almacenPrueba, crearAtencion } from '../src/atencion.js';
import { leerYCloud } from '../src/ycloud.js';
import { SW_JS } from '../src/push.js';

const T0 = 1_792_000_000_000;
const DIA = 86_400_000;

test('partirTexto: lo largo va en partes por oración, sin perder nada; lo corto, igual', () => {
  assert.deepEqual(partirTexto('Hola.'), ['Hola.']);
  assert.deepEqual(partirTexto(''), []);
  const largo = Array.from({ length: 40 }, (_, i) => `Esta es la oración número ${i + 1} del mensaje.`).join(' ');
  const partes = partirTexto(largo, 500);
  assert.ok(partes.length >= 3);
  assert.ok(partes.every((p) => p.length <= 500 && /\.$/.test(p)));
  assert.equal(partes.join(' '), largo);
});

test('YCloud: una foto con texto al pie llega como texto (y se sabe que vino un archivo); sin texto, como archivo', () => {
  const llega = (m) => leerYCloud({ id: 'ev1', type: 'whatsapp.inbound_message.received', createTime: new Date(T0).toISOString(), whatsappInboundMessage: { id: 'm1', wamid: 'w1', from: '+5493410000009', to: '+5493410000001', sendTime: new Date(T0).toISOString(), ...m } });
  assert.deepEqual(llega({ type: 'image', image: { id: 'i1', caption: 'ya pagué' } }).map((e) => [e.kind, e.text, e.archivo]), [['text', 'ya pagué', true]]);
  assert.deepEqual(llega({ type: 'document', document: { id: 'd1' } }).map((e) => e.kind), ['otro']);
});

test('avisos al celular: cada uno con su etiqueta (no se pisan)', () => {
  assert.match(SW_JS, /tag: d\.tag \|\| \('zl-' \+ Date\.now\(\)\)/);
});

test('coexistencia: al día 10 sin usar WhatsApp Business, un aviso al dueño (una vez hasta que vuelva a usarla)', async () => {
  const n = adaptadores(crearAtencion(almacenPrueba()), () => T0);
  const { negocio } = await n.negocios.guardar(null, { nombre: 'La Espiga', emails: [], cuentas: [] });
  await n.ycloud.put('a'.repeat(24), { negocio: negocio.id, numero: '+5493410000001', apiKey: 'k', secreto: 's', endpointId: 'e', ecos: true });
  await n.ycloud.put('b'.repeat(24), { negocio: negocio.id, numero: '+5493410000002', apiKey: 'k', secreto: 's', endpointId: 'e', ecos: false });
  const d = { ...n, fetch: async () => new Response('', { status: 201 }) };
  assert.deepEqual(await recordarCoexistencia({}, d, T0 + 5 * DIA), []);
  assert.deepEqual((await recordarCoexistencia({}, d, T0 + 10 * DIA)).map((x) => [x.numero, x.dias]), [['a'.repeat(24), 10]]);
  assert.deepEqual(await recordarCoexistencia({}, d, T0 + 11 * DIA), [], 'una sola vez');
  // Vuelve a usar la app (eco): el conteo arranca de nuevo.
  await n.ycloud.put('a'.repeat(24), { ultimoEco: T0 + 12 * DIA });
  assert.deepEqual(await recordarCoexistencia({}, d, T0 + 15 * DIA), []);
  assert.equal((await recordarCoexistencia({}, d, T0 + 22 * DIA)).length, 1);
});
