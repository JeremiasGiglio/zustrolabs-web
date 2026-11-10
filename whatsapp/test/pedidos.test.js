// ZL-139, etapa 1: el núcleo de los pedidos. La IA propone; acá se prueba que el código valida, reserva y calcula.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearCatalogo, ErrorCatalogo } from '../src/catalogo.js';
import { datosComprador } from '../src/pedidos.js';
import { sqlPrueba } from './sqlite.js';

const T0 = 1_792_000_000_000;
const MIN = 60_000;
const DUENA = 'duena@example.com';
const CHARLA = 'yc:5493410000001:5493410000009';
const OTRA = 'ig:17841400000000001.900';

function armar() {
  const { sql, transaccion } = sqlPrueba();
  let t = T0;
  const c = crearCatalogo(sql, transaccion, () => t);
  const pan = c.crear({ nombre: 'Pan francés', codigo: 'PF', precio: 2500, unidad: 'kg', stock: 10 }, DUENA);
  const torta = c.crear({ nombre: 'Torta de chocolate', codigo: 'TC', precio: 18000.5, stock: 1 }, DUENA);
  const encargo = c.crear({ nombre: 'Torta por encargo', codigo: 'TE' }, DUENA); // sin precio ni control de stock
  const pausado = c.crear({ nombre: 'Rosca', codigo: 'RO', precio: 9000, stock: 5, activo: false }, DUENA);
  return { c, pan, torta, encargo, pausado, avanzar: (ms) => (t += ms), ahora: () => t };
}
const stock = (c, id) => { const p = c.obtener(id); return [p.stock, p.reservado]; };
const datos = { nombre: 'Ana', entrega: 'retiro' };

test('carrito: el código valida cada producto, reserva el stock y calcula el total (no la IA)', () => {
  const { c, pan, torta, encargo, pausado } = armar();
  const r = c.carrito(CHARLA, [{ id: pan.id, cantidad: 2 }, { id: torta.id, cantidad: 1 }, { id: pan.id, cantidad: 1 }], { canal: 'wa' });
  assert.deepEqual(r.faltantes, []);
  assert.equal(r.pedido.estado, 'borrador');
  assert.equal(r.pedido.numero, null, 'un carrito todavía no tiene número');
  assert.deepEqual(r.pedido.items.map((i) => [i.nombre, i.cantidad, i.precio, i.subtotal]), [['Pan francés', 3, 2500, 7500], ['Torta de chocolate', 1, 18000.5, 18000.5]]);
  assert.equal(r.pedido.total, 25500.5);
  assert.equal(r.pedido.sinPrecio, false);
  assert.deepEqual(stock(c, pan.id), [10, 3], 'reservado, todavía no descontado');
  assert.deepEqual(stock(c, torta.id), [1, 1]);
  // Lo que no se puede no entra y vuelve explicado: no existe, pausado, sin stock, cantidad imposible.
  const r2 = c.carrito(OTRA, [{ id: 'p-inventado', cantidad: 1 }, { id: pausado.id, cantidad: 1 }, { id: torta.id, cantidad: 1 }, { id: pan.id, cantidad: 2.5 }, { id: encargo.id, cantidad: 2 }]);
  assert.deepEqual(r2.faltantes.map((f) => f.motivo), ['no_existe', 'pausado', 'sin_stock', 'cantidad']);
  assert.equal(r2.faltantes[2].disponible, 0, 'la última torta ya está reservada por otra charla');
  // Sin precio: el total no se inventa.
  assert.deepEqual(r2.pedido.items.map((i) => [i.nombre, i.precio, i.subtotal]), [['Torta por encargo', null, null]]);
  assert.equal(r2.pedido.sinPrecio, true);
  assert.deepEqual(stock(c, encargo.id), [null, 0], 'sin control de stock, no reserva');
});

test('carrito: cambiarlo libera lo anterior y vaciarlo lo borra', () => {
  const { c, pan, torta } = armar();
  c.carrito(CHARLA, [{ id: pan.id, cantidad: 4 }, { id: torta.id, cantidad: 1 }]);
  const r = c.carrito(CHARLA, [{ id: pan.id, cantidad: 1 }]);
  assert.deepEqual(stock(c, pan.id), [10, 1]);
  assert.deepEqual(stock(c, torta.id), [1, 0]);
  assert.equal(c.carritoDe(CHARLA).id, r.pedido.id, 'sigue siendo el mismo carrito');
  // Pedir más de lo que hay contando lo propio: con 10 de stock y 1 propio reservado, 10 entran.
  assert.deepEqual(c.carrito(CHARLA, [{ id: pan.id, cantidad: 10 }]).faltantes, []);
  assert.equal(c.carrito(CHARLA, [{ id: pan.id, cantidad: 11 }]).faltantes[0].disponible, 10);
  assert.deepEqual(stock(c, pan.id), [10, 10], 'si el cambio no entra, el carrito queda como estaba');
  assert.equal(c.carrito(CHARLA, [{ id: 'nada', cantidad: 1 }]).sinCambios, true);
  assert.equal(c.carrito(CHARLA, []).pedido, null);
  assert.equal(c.carritoDe(CHARLA), null);
  assert.throws(() => c.carrito('', []), ErrorCatalogo);
  assert.throws(() => c.carrito(CHARLA, Array.from({ length: 31 }, (_, i) => ({ id: `x${i}`, cantidad: 1 }))), /hasta 30/);
});

test('confirmar: pide nombre y entrega, da número correlativo y la reserva sigue mientras el negocio lo ve', () => {
  const { c, pan, avanzar, ahora } = armar();
  c.carrito(CHARLA, [{ id: pan.id, cantidad: 2 }]);
  assert.throws(() => c.confirmar(CHARLA, {}), /nombre/);
  assert.throws(() => c.confirmar(CHARLA, { nombre: 'Ana', entrega: 'envio' }), /dirección/);
  const p = c.confirmar(CHARLA, { nombre: 'Ana', entrega: 'envio', direccion: 'Calle Falsa 123', notas: 'tocar timbre' });
  assert.equal(p.numero, 1);
  assert.equal(p.estado, 'pendiente');
  assert.deepEqual(p.comprador, { nombre: 'Ana', entrega: 'envio', direccion: 'Calle Falsa 123', notas: 'tocar timbre' });
  assert.equal(p.vence, ahora() + 120 * MIN);
  assert.equal(c.carritoDe(CHARLA), null, 'la charla puede armar otro');
  assert.throws(() => c.confirmar(CHARLA, datos), /no hay un carrito/);
  c.carrito(OTRA, [{ id: pan.id, cantidad: 1 }]);
  assert.equal(c.confirmar(OTRA, datos).numero, 2);
  // Un carrito vencido no se confirma.
  c.carrito(CHARLA, [{ id: pan.id, cantidad: 1 }]);
  avanzar(21 * MIN);
  assert.throws(() => c.confirmar(CHARLA, datos), /venció/);
  assert.deepEqual(datosComprador({ nombre: 'Ana', entrega: 'retiro', direccion: 'no se guarda si retira', extra: 'tampoco' }), { nombre: 'Ana', entrega: 'retiro', direccion: '', notas: '' });
});

test('estados: solo los pasos permitidos; entregado descuenta el stock y deja el movimiento en el historial', () => {
  const { c, pan } = armar();
  c.carrito(CHARLA, [{ id: pan.id, cantidad: 3 }]);
  const { numero } = c.confirmar(CHARLA, datos);
  assert.throws(() => c.cambiarEstado(numero, 'pagado', DUENA), /no puede pasar/, 'no se paga lo que no se aceptó');
  assert.throws(() => c.cambiarEstado(numero, 'borrador', DUENA), /no puede pasar/);
  assert.throws(() => c.cambiarEstado(99, 'aceptado', DUENA), /no existe/);
  assert.equal(c.cambiarEstado(numero, 'aceptado', DUENA, { horas: 24 }).estado, 'aceptado');
  assert.equal(c.cambiarEstado(numero, 'pagado', DUENA).vence, null, 'pagado no vence');
  assert.deepEqual(stock(c, pan.id), [10, 3]);
  const e = c.cambiarEstado(numero, 'entregado', DUENA);
  assert.equal(e.estado, 'entregado');
  assert.deepEqual(stock(c, pan.id), [7, 0]);
  const mov = c.historial({ producto: pan.id })[0];
  assert.deepEqual([mov.tipo, mov.antes, mov.despues, mov.quien], ['stock', '10', '7', DUENA]);
  assert.match(mov.detalle, /pedido 1 entregado/);
  assert.throws(() => c.cambiarEstado(numero, 'cancelado', DUENA), /no puede pasar/, 'lo entregado no se cancela');
  const h = c.pedido(numero);
  assert.deepEqual(h.eventos.map((x) => x.estado), ['borrador', 'pendiente', 'aceptado', 'pagado', 'entregado']);
  assert.equal(h.eventos.at(-1).quien, DUENA);
});

test('rechazar o cancelar libera la reserva; el stock no puede bajar de lo reservado ni borrarse un producto reservado', () => {
  const { c, pan, torta } = armar();
  c.carrito(CHARLA, [{ id: torta.id, cantidad: 1 }, { id: pan.id, cantidad: 5 }]);
  const { numero } = c.confirmar(CHARLA, datos);
  assert.throws(() => c.moverStock(pan.id, -6, DUENA), /reservadas/);
  assert.throws(() => c.actualizar(pan.id, { stock: 4 }, DUENA), /reservadas/);
  assert.throws(() => c.borrar(torta.id, DUENA), /reservadas/);
  c.cambiarEstado(numero, 'rechazado', DUENA, { motivo: 'sin horno hoy' });
  assert.deepEqual(stock(c, pan.id), [10, 0]);
  assert.deepEqual(stock(c, torta.id), [1, 0]);
  assert.equal(c.pedido(numero).eventos.at(-1).detalle, 'sin horno hoy');
  assert.equal(c.borrar(torta.id, DUENA), true);
});

test('vencer: el carrito sin confirmar se borra, lo pendiente o aceptado sin pagar vence, lo pagado no', () => {
  const { c, pan, avanzar } = armar();
  c.carrito('a', [{ id: pan.id, cantidad: 1 }]);
  c.carrito('b', [{ id: pan.id, cantidad: 2 }]); const b = c.confirmar('b', datos).numero;
  c.carrito('c', [{ id: pan.id, cantidad: 3 }]); const cc = c.confirmar('c', datos).numero;
  c.cambiarEstado(cc, 'aceptado', DUENA, { horas: 1 });
  c.carrito('d', [{ id: pan.id, cantidad: 4 }]); const d = c.confirmar('d', datos).numero;
  c.cambiarEstado(d, 'aceptado', DUENA); c.cambiarEstado(d, 'pagado', DUENA);
  assert.deepEqual(stock(c, pan.id), [10, 10]);
  assert.equal(c.proximoVencimiento(), T0 + 20 * MIN);
  avanzar(21 * MIN);
  assert.deepEqual(c.vencer(), [], 'el carrito vence callado');
  assert.equal(c.carritoDe('a'), null);
  avanzar(100 * MIN);
  assert.deepEqual(c.vencer().map((v) => [v.numero, v.antes]).sort(), [[b, 'pendiente'], [cc, 'aceptado']]);
  assert.deepEqual(stock(c, pan.id), [10, 4], 'solo queda lo pagado');
  assert.equal(c.pedido(d).estado, 'pagado');
  assert.equal(c.proximoVencimiento(), null);
  const lista = c.pedidos();
  assert.deepEqual(lista.cuenta, { vencido: 2, pagado: 1 });
  assert.ok(!lista.pedidos.some((p) => p.estado === 'borrador'));
  assert.deepEqual(c.pedidos({ estado: 'pagado' }).pedidos.map((p) => p.numero), [d]);
});

test('la IA ve el stock disponible: lo reservado por otros cuenta como agotado', () => {
  const { c, torta } = armar();
  c.carrito(CHARLA, [{ id: torta.id, cantidad: 1 }]);
  const vista = JSON.stringify(c.paraAsistente('torta'));
  assert.match(vista, /AGOTADO/);
});
