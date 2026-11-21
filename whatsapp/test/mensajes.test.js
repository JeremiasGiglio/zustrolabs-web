// ZL-165: «Charlas» de la app (30 días) y borrar pedidos de prueba. Base SQLite de prueba, datos ficticios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearCatalogo, ejecutarCatalogo } from '../src/catalogo.js';
import { RETENCION_CHARLAS_APP_MS } from '../src/mensajes.js';
import { sqlPrueba } from './sqlite.js';

const T0 = 1_792_000_000_000;
const CH = 'yc:5493410000001:5493410000009';

function base() {
  const { sql, transaccion } = sqlPrueba();
  const reloj = { t: T0 };
  const c = crearCatalogo(sql, transaccion, () => reloj.t);
  return { c, reloj, op: (o, ...a) => ejecutarCatalogo(c, o, a) };
}

test('charlas: se crean al primer mensaje, suman, se buscan, se marcan vistas y se borran a los 30 días', () => {
  const { reloj, op } = base();
  const id = op('guardarMensajes', CH, 'wa', [{ de: 'cliente', texto: 'Hola' }, { de: 'asistente', texto: '¡Hola! ¿Qué buscás?' }], 'Ana').valor;
  reloj.t += 60_000;
  assert.equal(op('guardarMensajes', CH, 'wa', [{ de: 'cliente', texto: 'Una torta' }]).valor, id, 'misma charla');
  op('guardarMensajes', 'ig:1.2', 'ig', [{ de: 'cliente', texto: 'precio?' }], '@beto');
  let l = op('charlasApp', {}).valor;
  assert.deepEqual(l.charlas.map((x) => [x.nombre, x.sinLeer]), [['@beto', true], ['Ana', true]]);
  assert.equal(l.sinLeer, 2);
  assert.deepEqual(op('charlasApp', { q: 'torta' }).valor.charlas.map((x) => x.nombre), ['Ana']);
  const c = op('charlaApp', id).valor;
  assert.equal(c.charla, CH);
  assert.deepEqual(c.mensajes.map((m) => m.texto), ['Hola', '¡Hola! ¿Qué buscás?', 'Una torta']);
  assert.equal(op('charlasApp', {}).valor.sinLeer, 1);
  assert.equal(op('charlaApp', 999).ok, false);
  // A los 30 días sin nada nuevo, se borra.
  reloj.t += RETENCION_CHARLAS_APP_MS + 1;
  assert.equal(op('purgarMensajes', reloj.t).valor, 2);
  assert.deepEqual(op('charlasApp', {}).valor.charlas, []);
});

test('borrar un pedido de prueba libera lo reservado; un entregado no se borra', () => {
  const { c, op } = base();
  const pan = c.crear({ nombre: 'Pan', precio: 100, stock: 5 }, 'x@example.com');
  c.carrito(CH, [{ id: pan.id, cantidad: 2 }]);
  const { numero } = c.confirmar(CH, { nombre: 'Ana', entrega: 'retiro' });
  assert.equal(op('obtener', pan.id).valor.reservado, 2);
  assert.deepEqual(op('borrarPedido', numero).valor, { numero, borrado: true });
  assert.equal(op('obtener', pan.id).valor.reservado, 0);
  assert.equal(op('pedido', numero).ok, false);
  c.carrito(CH, [{ id: pan.id, cantidad: 1 }]);
  const otro = c.confirmar(CH, { nombre: 'Ana', entrega: 'retiro' }).numero;
  c.cambiarEstado(otro, 'aceptado', 'x'); c.cambiarEstado(otro, 'entregado', 'x');
  assert.match(op('borrarPedido', otro).error, /entregado no se borra/);
});
