// ZL-139: un pedido de punta a punta en la charla, con el stock y los tiempos de verdad (reloj simulado).
// La IA es falsa: solo devuelve lo que devolvería la de verdad (refs y cantidades). Todo lo demás es el código real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crearCatalogo, ejecutarCatalogo } from '../src/catalogo.js';
import { parsearFicha, perfilNegocio } from '../src/negocio.js';
import { pedidosDeCharla, resumenPedido } from '../src/pedidos-charla.js';
import { atender } from '../src/whatsapp.js';
import { sqlPrueba } from './sqlite.js';

const FICHA = parsearFicha(readFileSync(new URL('./ficha-prueba.md', import.meta.url), 'utf8')).ficha;
const T0 = 1_792_000_000_000;
const MIN = 60_000;
const ANA = 'yc:5493410000001:5493410000009';
const BETO = 'yc:5493410000001:5493410000008';

function armar({ precios = true } = {}) {
  const { sql, transaccion } = sqlPrueba();
  const reloj = { t: T0 };
  const c = crearCatalogo(sql, transaccion, () => reloj.t);
  const pan = c.crear({ nombre: 'Pan francés', precio: 2500, unidad: 'kg', stock: 10 }, 'duena@example.com');
  const torta = c.crear({ nombre: 'Torta de chocolate', precio: 18000, stock: 1 }, 'duena@example.com');
  const cat = { ejecutar: async (op, args) => ejecutarCatalogo(c, op, args) };
  const mem = new Map();
  const memoria = { get: async (k) => mem.get(k) ?? null, put: async (k, v) => mem.set(k, v), delete: async (k) => mem.delete(k), visto: async () => false, contar: async () => 1 };
  const vistos = [];
  // La «IA»: según el mensaje, propone el carrito completo con refs (como lo haría la de verdad).
  const preguntar = async (texto, idioma, opts = {}) => {
    vistos.push({ texto, carrito: opts.carrito });
    const r = (pedido, respuesta = '¡Dale! Te lo agrego.') => ({ respuesta, persona: false, fuera_de_tema: false, vacia: false, notas: [], pedido });
    if (/2 kilos de pan/.test(texto)) return r({ cambia: true, items: [{ ref: pan.id, cantidad: 2 }] });
    if (/y la torta/.test(texto)) return r({ cambia: true, items: [{ ref: pan.id, cantidad: 2 }, { ref: torta.id, cantidad: 1 }] });
    if (/mejor 3 de pan/.test(texto)) return r({ cambia: true, items: [{ ref: pan.id, cantidad: 3 }, { ref: torta.id, cantidad: 1 }] });
    if (/50 de pan/.test(texto)) return r({ cambia: true, items: [{ ref: pan.id, cantidad: 50 }] });
    if (/producto inventado/.test(texto)) return r({ cambia: true, items: [{ ref: 'p-que-no-existe', cantidad: 1 }] });
    return { respuesta: 'Abrimos de 8 a 20.', persona: false, fuera_de_tema: false, vacia: false, notas: [], pedido: { cambia: false, items: [] } };
  };
  const perfil = perfilNegocio({ ...FICHA, precios });
  const charlar = (de) => {
    const pedidos = pedidosDeCharla({ cat, charla: de, canal: 'wa', negocio: FICHA.nombre, precios });
    let n = 0;
    return async (texto) => {
      const r = await atender({ id: `${de}:${++n}:${reloj.t}`, from: de, kind: 'text', text: texto }, { memoria, preguntar, now: reloj.t, perfil, pedidos });
      return { ...r, texto: r.send.map((m) => m.text.body).join('\n---\n') };
    };
  };
  const stock = (p) => { const x = ejecutarCatalogo(c, 'obtener', [p.id]).valor; return { stock: x.stock, reservado: x.reservado, disponible: x.stock - x.reservado }; };
  return { c, pan, torta, charlar, stock, reloj, mem, vistos };
}

test('un pedido completo por WhatsApp: arma, cambia, confirma con retiro, y el stock se reserva y se descuenta al entregar', async () => {
  const { c, pan, torta, charlar, stock, mem, vistos } = armar();
  const ana = charlar(ANA);
  await ana('hola'); // saludo y menú (sin IA)
  let r = await ana('quiero 2 kilos de pan');
  assert.equal(r.metrica, 'ia_pedido');
  assert.match(r.texto, /¡Dale! Te lo agrego\./);
  assert.match(r.texto, /Tu pedido \(lo guardo 20 minutos\):\n• 2 × Pan francés — \$ 5\.000\nTotal: \$ 5\.000/);
  assert.match(r.texto, /¿Lo confirmamos\? Respondé SÍ/);
  assert.deepEqual(stock(pan), { stock: 10, reservado: 2, disponible: 8 });
  // La IA ve el carrito con las refs para devolverlo completo.
  r = await ana('y la torta también');
  assert.match(vistos.at(-1).carrito, new RegExp(`\\[ref ${pan.id}\\] 2 × Pan francés`));
  assert.match(r.texto, /• 1 × Torta de chocolate — \$ 18\.000\nTotal: \$ 23\.000/);
  r = await ana('mejor 3 de pan');
  assert.match(r.texto, /• 3 × Pan francés — \$ 7\.500/);
  assert.match(r.texto, /Total: \$ 25\.500/);
  assert.deepEqual(stock(pan), { stock: 10, reservado: 3, disponible: 7 });
  assert.deepEqual(stock(torta), { stock: 1, reservado: 1, disponible: 0 });
  // Una pregunta en el medio no toca el carrito.
  r = await ana('¿hasta qué hora abren?');
  assert.equal(r.metrica, 'ia');
  assert.equal(mem.get(ANA).pedido.paso, 'confirmar', 'el paso sigue');
  // Confirmar: SÍ → retiro o envío (1 y 2 son eso, no el menú) → nombre → pedido con número.
  r = await ana('sí');
  assert.equal(r.metrica, 'pedido_entrega');
  assert.match(r.texto, /1\. Retiro\n2\. Envío/);
  r = await ana('3');
  assert.match(r.texto, /Respondé 1 para retirar o 2 para envío/);
  r = await ana('1');
  assert.match(r.texto, /¿A nombre de quién/);
  r = await ana('Ana');
  assert.equal(r.metrica, 'pedido_nuevo');
  assert.equal(r.pedido, 1);
  assert.match(r.texto, /¡Listo! Tu pedido N\.º 1 quedó registrado\. Panadería La Espiga lo revisa y te confirma por acá\./);
  assert.match(r.texto, /• 3 × Pan francés — \$ 7\.500\n• 1 × Torta de chocolate — \$ 18\.000\nTotal: \$ 25\.500/);
  assert.equal(mem.get(ANA).pedido, null);
  const p = c.pedido(1);
  assert.equal(p.estado, 'pendiente');
  assert.deepEqual(p.comprador, { nombre: 'Ana', entrega: 'retiro', direccion: '', notas: '' });
  assert.equal(p.total, 25500);
  // El negocio lo acepta, lo cobra y lo entrega: recién ahí baja el stock.
  c.cambiarEstado(1, 'aceptado', 'duena@example.com');
  c.cambiarEstado(1, 'pagado', 'duena@example.com');
  assert.deepEqual(stock(pan), { stock: 10, reservado: 3, disponible: 7 });
  c.cambiarEstado(1, 'entregado', 'duena@example.com');
  assert.deepEqual(stock(pan), { stock: 7, reservado: 0, disponible: 7 });
  assert.deepEqual(stock(torta), { stock: 0, reservado: 0, disponible: 0 });
});

test('envío pide la dirección; lo que no hay o no existe no entra y se explica; CANCELAR libera todo', async () => {
  const { c, pan, torta, charlar, stock } = armar();
  const ana = charlar(ANA);
  const beto = charlar(BETO);
  await ana('hola');
  await ana('y la torta también');
  await beto('hola');
  // Beto pide la última torta, que está reservada por Ana: no entra.
  let r = await beto('y la torta también');
  assert.match(r.texto, /• 2 × Pan francés/);
  assert.match(r.texto, /No pude sumar: Torta de chocolate \(no queda\)\./);
  r = await beto('50 de pan');
  assert.match(r.texto, /No pude sumar: Pan francés \(quedan 8\)\./, 'contando lo suyo: 10 de stock − 2 de Ana');
  assert.match(r.texto, /• 2 × Pan francés/, 'y le quedan los 2 que ya tenía');
  r = await beto('producto inventado');
  assert.match(r.texto, /un producto que no encontré en el catálogo/);
  assert.doesNotMatch(r.texto, /Te lo agrego/, 'si nada entró, no dice que lo agrega');
  assert.match(r.texto, /• 2 × Pan francés/, 'tampoco se le borra el carrito');
  await beto('cancelar');
  assert.equal(c.carritoDe(BETO), null);
  // Ana: envío → dirección.
  await ana('sí');
  r = await ana('envío');
  r = await ana('Ana Pérez');
  assert.match(r.texto, /¿A qué dirección/);
  r = await ana('x');
  assert.match(r.texto, /¿A qué dirección/, 'una dirección de 1 letra no sirve');
  r = await ana('Calle Ficticia 123, Centro');
  assert.equal(r.metrica, 'pedido_nuevo');
  assert.deepEqual(c.pedido(r.pedido).comprador, { nombre: 'Ana Pérez', entrega: 'envio', direccion: 'Calle Ficticia 123, Centro', notas: '' });
  // Beto arma y cancela: se libera.
  await beto('quiero 2 kilos de pan');
  assert.equal(stock(pan).reservado, 4);
  r = await beto('cancelar');
  assert.equal(r.metrica, 'pedido_cancelado');
  assert.equal(stock(pan).reservado, 2);
  assert.equal(stock(torta).reservado, 1);
  // CANCELAR sin pedido no es un comando de pedidos (sigue la IA).
  assert.notEqual((await beto('cancelar')).metrica, 'pedido_cancelado');
});

test('tiempos: el carrito se guarda 20 minutos; confirmado, 2 horas para que el negocio responda; aceptado, lo que diga el negocio', async () => {
  const { c, pan, charlar, stock, reloj } = armar();
  const ana = charlar(ANA);
  await ana('hola');
  await ana('quiero 2 kilos de pan');
  reloj.t += 19 * MIN;
  assert.equal(stock(pan).reservado, 2, 'a los 19 minutos sigue reservado');
  reloj.t += 2 * MIN;
  assert.equal(stock(pan).reservado, 0, 'a los 21 minutos se liberó solo (sin alarma: al consultar)');
  let r = await ana('sí');
  assert.equal(r.metrica, 'pedido_vencido');
  assert.match(r.texto, /Tu pedido se venció \(lo guardo 20 minutos sin confirmar\)/);
  // Lo arma de nuevo y confirma: pendiente 2 horas.
  await ana('quiero 2 kilos de pan');
  await ana('dale');
  await ana('1');
  r = await ana('Ana');
  const n = r.pedido;
  reloj.t += 119 * MIN;
  assert.equal(c.pedido(n).estado, 'pendiente');
  reloj.t += 2 * MIN;
  assert.equal(c.pedido(n).estado, 'vencido', 'sin respuesta del negocio en 2 horas, vence');
  assert.equal(stock(pan).reservado, 0);
  // Aceptado con 24 h: a las 23 h sigue; a las 25 h sin pagar, vence; pagado no vence nunca.
  await ana('quiero 2 kilos de pan'); await ana('sí'); await ana('1');
  const m = (await ana('Ana')).pedido;
  c.cambiarEstado(m, 'aceptado', 'duena@example.com', { horas: 24 });
  reloj.t += 23 * 60 * MIN;
  assert.equal(c.pedido(m).estado, 'aceptado');
  reloj.t += 2 * 60 * MIN;
  assert.equal(c.pedido(m).estado, 'vencido');
  await ana('quiero 2 kilos de pan'); await ana('sí'); await ana('1');
  const k = (await ana('Ana')).pedido;
  c.cambiarEstado(k, 'aceptado', 'duena@example.com', { horas: 1 });
  c.cambiarEstado(k, 'pagado', 'duena@example.com');
  reloj.t += 30 * 24 * 60 * MIN;
  assert.equal(c.pedido(k).estado, 'pagado');
  assert.equal(stock(pan).reservado, 2, 'lo pagado sigue reservado hasta entregarlo');
});

test('sin precios en la ficha, el resumen no muestra montos; la IA nunca escribe el total', async () => {
  const { charlar } = armar({ precios: false });
  const ana = charlar(ANA);
  await ana('hola');
  const r = await ana('quiero 2 kilos de pan');
  assert.match(r.texto, /• 2 × Pan francés\nEl total te lo confirma el negocio\./);
  assert.doesNotMatch(r.texto, /\$/);
  assert.equal(resumenPedido({ items: [{ nombre: 'X', cantidad: 1, subtotal: null }], sinPrecio: true }, { precios: true }), 'Tu pedido (lo guardo 20 minutos):\n• 1 × X\nAlgunos productos no tienen precio cargado: el total te lo confirma el negocio.');
});
