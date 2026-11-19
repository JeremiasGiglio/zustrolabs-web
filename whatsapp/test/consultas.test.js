// Consultas de un negocio (ZL-146): se guardan en la base del negocio, una abierta por charla, y solo el negocio las mueve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearCatalogo, ejecutarCatalogo } from '../src/catalogo.js';
import { consultasDeCharla } from '../src/consultas.js';
import { sqlPrueba } from './sqlite.js';

const T0 = 1_792_000_000_000;
const armar = () => {
  const { sql, transaccion } = sqlPrueba();
  const reloj = { t: T0 };
  const c = crearCatalogo(sql, transaccion, () => reloj.t);
  return { c, reloj, cat: { ejecutar: async (op, args) => ejecutarCatalogo(c, op, args) } };
};

test('consultas: una abierta por charla; lo nuevo completa sin borrar y «persona» gana', () => {
  const { c, reloj } = armar();
  const a = c.crearConsulta('yc:1:2', { tipo: 'consulta', nombre: 'Ana', resumen: 'Quiere una torta.', canal: 'wa' });
  assert.equal(a.nueva, true);
  assert.deepEqual([a.consulta.numero, a.consulta.estado, a.consulta.tipo, a.consulta.nombre], [1, 'nueva', 'consulta', 'Ana']);
  reloj.t += 1000;
  const b = c.crearConsulta('yc:1:2', { tipo: 'persona', resumen: '' });
  assert.equal(b.nueva, false);
  assert.deepEqual([b.consulta.numero, b.consulta.tipo, b.consulta.nombre, b.consulta.resumen], [1, 'persona', 'Ana', 'Quiere una torta.']);
  c.crearConsulta('ig:9.9', { nombre: 'Beto' });
  assert.equal(c.consultas().consultas.length, 2);
  assert.equal(c.consultas().nuevas, 2);
  // Cerrada, la próxima de esa charla es otra.
  c.cambiarConsulta(1, 'ganada', 'Encargó para el sábado');
  assert.equal(c.consultas({ estado: 'ganada' }).consultas[0].nota, 'Encargó para el sábado');
  assert.equal(c.crearConsulta('yc:1:2', { tipo: 'consulta' }).consulta.numero, 3);
  assert.equal(c.consultaAbierta('yc:1:2').numero, 3);
});

test('consultas: estados y datos controlados; los textos se recortan y no llevan caracteres de control', () => {
  const { c } = armar();
  const r = c.crearConsulta('yc:1:2', { tipo: 'cualquiera', nombre: 'A'.repeat(200), resumen: 'linea1\nlinea2\u0000' });
  assert.equal(r.consulta.tipo, 'consulta');
  assert.equal(r.consulta.nombre.length, 60);
  assert.equal(r.consulta.resumen, 'linea1 linea2');
  assert.deepEqual(ejecutarCatalogo(c, 'cambiarConsulta', [1, 'borrada']), { ok: false, error: 'estado inválido', campo: undefined });
  assert.equal(ejecutarCatalogo(c, 'cambiarConsulta', [99, 'ganada']).error, 'esa consulta no existe');
  assert.equal(ejecutarCatalogo(c, 'crearConsulta', ['', {}]).ok, false);
});

test('consultasDeCharla: registra con el canal de la charla y, si la base falla, no corta la charla', async () => {
  const { c, cat } = armar();
  const k = consultasDeCharla({ cat, charla: 'ig:1.2', canal: 'ig' });
  assert.deepEqual(await k.registrar({ tipo: 'persona', nombre: 'Ana' }), { numero: 1, nueva: true });
  assert.equal(c.consultas().consultas[0].canal, 'ig');
  const roto = consultasDeCharla({ cat: { ejecutar: async () => { throw new Error('caída'); } }, charla: 'x', canal: 'wa' });
  assert.equal(await roto.registrar({}), null);
});
