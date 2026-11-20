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

function armar({ precios = true, ajustes = null } = {}) {
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
    vistos.push({ texto, carrito: opts.carrito, compras: opts.compras });
    // ZL-154: «lo mismo que la otra vez» → las refs y cantidades de su último pedido (como lo haría la de verdad).
    if (/lo mismo/.test(texto) && opts.compras) {
      const linea = opts.compras.texto.split('\n')[0];
      return { respuesta: '¡Dale! Te armo lo mismo.', persona: false, fuera_de_tema: false, vacia: false, notas: [], pedido: { cambia: true, items: [...linea.matchAll(/\[ref (p[a-z0-9]+)\] (\d+) ×/g)].map((m) => ({ ref: m[1], cantidad: Number(m[2]) })) } };
    }
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
    const pedidos = pedidosDeCharla({ cat, charla: de, canal: 'wa', negocio: FICHA.nombre, precios, ajustes });
    let n = 0;
    return async (texto) => {
      const r = await atender({ id: `${de}:${++n}:${reloj.t}`, from: de, kind: 'text', text: texto }, { memoria, preguntar, now: reloj.t, perfil, pedidos });
      return { ...r, texto: r.send.map((m) => m.text.body).join('\n---\n'), opciones: r.send.at(-1)?.opciones ?? null };
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

test('tiempos: el carrito se guarda 20 minutos; confirmado, espera al negocio sin plazo (ZL-157); aceptado, lo que diga el negocio', async () => {
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
  // Lo arma de nuevo y confirma: pendiente SIN plazo (ZL-157): lo acepta o lo rechaza el negocio.
  await ana('quiero 2 kilos de pan');
  await ana('dale');
  await ana('1');
  r = await ana('Ana');
  const n = r.pedido;
  reloj.t += 3 * 24 * 60 * MIN;
  assert.equal(c.pedido(n).estado, 'pendiente', 'a los 3 días sigue esperando al negocio');
  assert.equal(stock(pan).reservado, 2, 'y los productos siguen reservados');
  c.cambiarEstado(n, 'rechazado', 'duena@example.com');
  assert.equal(stock(pan).reservado, 0, 'al rechazarlo se liberan');
  // Aceptado con 24 h: a las 23 h sigue; a las 25 h sin pagar, vence; pagado no vence nunca.
  // ZL-146: ya sabemos que se llama Ana: con retiro, el pedido se cierra sin volver a preguntar el nombre.
  await ana('quiero 2 kilos de pan'); await ana('sí');
  const conocida = await ana('1');
  assert.equal(conocida.metrica, 'pedido_nuevo');
  const m = conocida.pedido;
  c.cambiarEstado(m, 'aceptado', 'duena@example.com', { horas: 24 });
  reloj.t += 23 * 60 * MIN;
  assert.equal(c.pedido(m).estado, 'aceptado');
  reloj.t += 2 * 60 * MIN;
  assert.equal(c.pedido(m).estado, 'vencido');
  await ana('quiero 2 kilos de pan'); await ana('sí');
  const k = (await ana('1')).pedido;
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

test('«Cómo vendés» (ZL-149): con solo retiro no se pregunta la entrega; con los dos, la pregunta dice dónde y cuánto; botones en cada paso', async () => {
  const solo = armar({ ajustes: { entrega: 'retiro', retiro: 'Calle Ficticia 123, de 8 a 20' } });
  const ana = solo.charlar(ANA);
  await ana('hola');
  let r = await ana('quiero 2 kilos de pan');
  assert.deepEqual(r.opciones.map((o) => o.id), ['SI', 'CANCELAR'], 'confirmar con botones');
  r = await ana('sí');
  assert.equal(r.metrica, 'pedido_nombre', 'salta «retiro o envío»: solo hace retiro');
  r = await ana('Ana');
  assert.equal(r.metrica, 'pedido_nuevo');
  assert.equal(solo.c.pedido(r.pedido).comprador.entrega, 'retiro');
  const dos = armar({ ajustes: { entrega: 'ambos', retiro: 'Calle Ficticia 123', envio: 'centro $ 1.500' } });
  const beto = dos.charlar(BETO);
  await beto('hola');
  await beto('quiero 2 kilos de pan');
  r = await beto('dale');
  assert.match(r.texto, /1\. Retiro \(Calle Ficticia 123\)\n2\. Envío \(centro \$ 1\.500\)/);
  assert.deepEqual(r.opciones.map((o) => o.id), ['1', '2']);
  const envio = armar({ ajustes: { entrega: 'envio' } });
  const caro = envio.charlar(ANA);
  await caro('hola');
  await caro('quiero 2 kilos de pan');
  assert.equal((await caro('si')).metrica, 'pedido_nombre');
  assert.equal((await caro('Carla')).metrica, 'pedido_direccion', 'solo envío: pide la dirección');
});

test('ZL-154: la IA ve los últimos 3 pedidos de ESA persona, con su estado y sus refs, y arma «lo mismo que la otra vez»', async () => {
  const { c, pan, torta, charlar, reloj, vistos, stock } = armar({ ajustes: { zona: 'America/Argentina/Buenos_Aires' } });
  const pedir = (de, items, datos = { nombre: 'Ana', entrega: 'retiro' }) => { c.carrito(de, items, { canal: 'wa' }); return c.confirmar(de, datos); };
  pedir(ANA, [{ id: pan.id, cantidad: 1 }]);
  reloj.t += 3_600_000;
  const segundo = pedir(ANA, [{ id: pan.id, cantidad: 2 }], { nombre: 'Ana', entrega: 'envio', direccion: 'Calle Ficticia 123' });
  c.cambiarEstado(segundo.numero ?? segundo.pedido?.numero ?? 2, 'rechazado', 'duena@example.com', { motivo: 'sin horno' });
  reloj.t += 3_600_000;
  pedir(BETO, [{ id: torta.id, cantidad: 1 }], { nombre: 'Beto', entrega: 'retiro' });
  reloj.t += 3_600_000;
  pedir(ANA, [{ id: pan.id, cantidad: 2 }]);
  reloj.t += 3_600_000;
  const ultimo = pedir(ANA, [{ id: pan.id, cantidad: 3 }]);
  const n = ultimo.numero ?? ultimo.pedido?.numero;
  for (const e of ['aceptado', 'entregado']) c.cambiarEstado(n, e, 'duena@example.com', { horas: 24 });

  const h = pedidosDeCharla({ cat: { ejecutar: async (op, args) => ejecutarCatalogo(c, op, args) }, charla: ANA, canal: 'wa', negocio: FICHA.nombre, precios: true, ajustes: { zona: 'America/Argentina/Buenos_Aires' } });
  const k = await h.compras(reloj.t);
  const lineas = k.texto.split('\n');
  assert.equal(lineas.length, 3, 'solo los últimos 3');
  assert.match(lineas[0], new RegExp(`^- Pedido N\\.º ${n} del \\d\\d/\\d\\d · entregado · retira en el local · \\[ref ${pan.id}\\] 3 × Pan francés · total \\$ 7\\.500$`));
  assert.match(lineas[1], /esperando que el negocio lo confirme · retira/, 'pendiente: sin plazo (ZL-157)');
  assert.match(lineas[2], /el negocio no lo pudo tomar · con envío/);
  assert.doesNotMatch(k.texto, /Torta|Beto|Calle|Ana|sin horno/, 'nada de otra persona, ni la dirección, ni el nombre, ni el motivo');
  assert.ok(k.montos.includes('7500'));
  // Sin precios en la ficha, no van los totales (ni pasan a ser montos permitidos).
  const sinPrecios = pedidosDeCharla({ cat: { ejecutar: async (op, args) => ejecutarCatalogo(c, op, args) }, charla: ANA, canal: 'wa', negocio: FICHA.nombre, precios: false });
  const k2 = await sinPrecios.compras(reloj.t);
  assert.doesNotMatch(k2.texto, /total|\$/);
  assert.deepEqual(k2.montos, []);
  // Quien nunca pidió: nada.
  assert.equal(await pedidosDeCharla({ cat: { ejecutar: async (op, args) => ejecutarCatalogo(c, op, args) }, charla: 'yc:5493410000001:5493410000007', canal: 'wa', negocio: FICHA.nombre, precios: true }).compras(reloj.t), null);

  // En la charla: la IA lo ve y «lo mismo que la otra vez» arma el carrito con el stock de hoy.
  const antes = stock(pan).reservado;
  const r = await charlar(ANA)('quiero lo mismo que la otra vez');
  assert.match(vistos.at(-1).compras.texto, /Pedido N\.º \d+ del/);
  assert.match(r.texto, /• 3 × Pan francés — \$ 7\.500/);
  assert.equal(stock(pan).reservado, antes + 3);
});

test('BORRAR (ZL-159): borra la memoria y también el nombre de sus pedidos ya cerrados', async () => {
  const { c, charlar } = armar();
  const ana = charlar(ANA);
  await ana('hola');
  await ana('quiero 2 kilos de pan');
  await ana('sí');
  await ana('1');
  const n = (await ana('Ana')).pedido;
  c.cambiarEstado(n, 'aceptado', 'duena@example.com'); c.cambiarEstado(n, 'entregado', 'duena@example.com');
  assert.equal(c.pedido(n).comprador.nombre, 'Ana');
  await ana('borrar');
  assert.equal(c.pedido(n).comprador.nombre, '');
  assert.equal(c.pedido(n).comprador.olvidado, true);
});
