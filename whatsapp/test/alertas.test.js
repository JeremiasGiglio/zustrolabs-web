// ZL-159: los avisos de respaldo al equipo de Zustro Labs. Sin red: el correo (Email Routing) se simula. Datos ficticios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { recordarPedidos, revisarNegocios } from '../src/index.js';
import { avisarEquipo } from '../src/panel.js';
import { adaptadores, almacenPrueba, crearAtencion } from '../src/atencion.js';
import { crearCatalogo, ejecutarCatalogo } from '../src/catalogo.js';
import { sqlPrueba } from './sqlite.js';

const T0 = 1_792_000_000_000;
const MIN = 60_000;

class CorreoFalso { constructor(from, to, raw) { Object.assign(this, { from, to, raw }); } }

test('avisarEquipo: un correo de texto al equipo, sin saltos que rompan el asunto; sin configurar no manda nada', async () => {
  const salidos = [];
  const env = { AVISO: { send: async (m) => { salidos.push(m); } }, AVISO_PARA: 'equipo@example.com' };
  assert.equal(await avisarEquipo(env, 'algo\r\nBcc: otro@example.com', ['Línea 1', 'Línea 2'], CorreoFalso, new Date(T0)), true);
  assert.equal(salidos.length, 1);
  const { to, raw } = salidos[0];
  assert.equal(to, 'equipo@example.com');
  assert.match(raw, /^Subject: Zustro Labs: algo Bcc: otro@example\.com\r$/m, 'el asunto queda en una sola línea');
  assert.doesNotMatch(raw, /^Bcc:/m);
  assert.match(raw, /Línea 1\r\nLínea 2/);
  assert.equal(await avisarEquipo({ AVISO: env.AVISO }, 'x', ['y'], CorreoFalso), false, 'sin AVISO_PARA');
  assert.equal(await avisarEquipo({ AVISO_PARA: 'equipo@example.com' }, 'x', ['y'], CorreoFalso), false, 'sin el binding');
  assert.equal(salidos.length, 1);
});

async function armar({ canales = { whatsapp: true }, pedidos = true } = {}) {
  const n = adaptadores(crearAtencion(almacenPrueba()), () => T0);
  const { negocio } = await n.negocios.guardar(null, { nombre: 'Panadería La Espiga', emails: [], cuentas: [], canales, pedidos });
  const { sql, transaccion } = sqlPrueba();
  let t = T0;
  const base = crearCatalogo(sql, transaccion, () => t);
  const correos = [];
  const d = {
    ...n, now: T0,
    fetch: async () => Response.json({}),
    catalogo: () => ({ ejecutar: async (op, args) => ejecutarCatalogo(base, op, args) }),
    avisarEquipo: async (asunto, lineas) => (correos.push({ asunto, lineas }), true),
  };
  return { n, d, negocio, base, correos, avanzar: (ms) => (t += ms) };
}

test('recordarPedidos: un pedido que espera una hora en un negocio sin avisos al celular le llega por correo al equipo', async () => {
  const { d, base, correos, avanzar } = await armar();
  const pan = base.crear({ nombre: 'Pan francés', codigo: 'PF', precio: 2500, stock: 10 }, 'duena@example.com');
  base.carrito('yc:5493410000001:5493410000009', [{ id: pan.id, cantidad: 1 }]);
  const { numero } = base.confirmar('yc:5493410000001:5493410000009', { nombre: 'Ana', entrega: 'retiro' });
  avanzar(61 * MIN);
  const r = await recordarPedidos({}, d, T0 + 61 * MIN);
  assert.deepEqual(r, [{ que: 'recordatorio', tipo: '1h' }]);
  assert.equal(correos.length, 1);
  assert.match(correos[0].asunto, /Panadería La Espiga espera sin que nadie se entere/);
  assert.match(correos[0].lineas.join('\n'), new RegExp(`N\\.º ${numero}[\\s\\S]*WhatsApp[\\s\\S]*Avisos en este celular`));
  assert.doesNotMatch(correos[0].lineas.join('\n'), /Ana|5493410000009/, 'sin el nombre ni el número del comprador');
  // El de las 20 h no repite el correo (ya se avisó a la hora).
  avanzar(20 * 60 * MIN);
  await recordarPedidos({}, d, T0 + 21 * 60 * MIN);
  assert.equal(correos.length, 1);
});

test('revisión diaria: un solo correo con todo lo que está en rojo; los negocios sin canales ni se revisan', async () => {
  const { n, d, correos } = await armar();
  await n.negocios.guardar(null, { nombre: 'Kiosco Apagado', emails: [], cuentas: [], canales: { instagram: false, whatsapp: false } });
  const rojos = await revisarNegocios({}, d, T0);
  assert.deepEqual(rojos.map((x) => x.nombre), ['Panadería La Espiga']);
  assert.equal(correos.length, 1);
  assert.match(correos[0].asunto, /un negocio tiene algo en rojo/);
  const cuerpo = correos[0].lineas.join('\n');
  assert.match(cuerpo, /Panadería La Espiga:[\s\S]*No tiene ficha[\s\S]*WhatsApp encendido pero sin número conectado/);
  assert.doesNotMatch(cuerpo, /Kiosco Apagado/);
});

test('revisión diaria: con todo bien no manda nada; y corre en el cron diario, no en el de 10 minutos', async () => {
  const { d, correos } = await armar({ canales: { instagram: false, whatsapp: false } });
  assert.deepEqual(await revisarNegocios({}, d, T0), []);
  assert.equal(correos.length, 0);
  const { d: d2, correos: c2 } = await armar();
  const cuentas = { list: async () => [] };
  await worker.scheduled({ cron: '*/10 * * * *' }, {}, {}, { ...d2, cuentas });
  assert.equal(c2.length, 0, 'el de 10 minutos no revisa');
  await worker.scheduled({ cron: '0 6 * * *' }, {}, {}, { ...d2, cuentas });
  assert.equal(c2.length, 1, 'el diario sí');
});
