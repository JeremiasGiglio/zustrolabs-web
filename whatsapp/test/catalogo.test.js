// Tests del catálogo de un negocio (ZL-121) contra SQLite de verdad (node:sqlite). Productos ficticios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearCatalogo, ErrorCatalogo, normalizar, pesos, tipoDeImagen, validarProducto, CATALOGO_ENTERO } from '../src/catalogo.js';
import { sqlPrueba } from './sqlite.js';

const T0 = 1_792_000_000_000;
const nuevo = () => {
  const { sql, transaccion } = sqlPrueba();
  let t = T0;
  return crearCatalogo(sql, transaccion, () => t++);
};
const YO = 'duena@example.com';

test('validar: nombre obligatorio, precio y stock como números (vacío = sin precio / sin control de stock)', () => {
  assert.throws(() => validarProducto({ nombre: '  ' }), /nombre/);
  assert.throws(() => validarProducto({ nombre: 'X', precio: -1 }), /precio/);
  assert.throws(() => validarProducto({ nombre: 'X', stock: 2.5 }), /entero/);
  assert.throws(() => validarProducto({ nombre: 'X', stock: 'diez' }), /entero/);
  assert.deepEqual(validarProducto({ nombre: ' Bombones ', precio: '1250.555', stock: '', codigo: '' }), {
    nombre: 'Bombones', codigo: null, categoria: '', descripcion: '', unidad: '', precio: 1250.56, stock: null, activo: 1,
  });
  assert.deepEqual(validarProducto({ stock: 3 }, { parcial: true }), { stock: 3 });
});

test('crear, editar, listar, buscar y borrar; el código no se repite', () => {
  const c = nuevo();
  const a = c.crear({ nombre: 'Caja de bombones x12', codigo: 'B12', categoria: 'Bombones', precio: 18000, stock: 5 }, YO);
  c.crear({ nombre: 'Tableta 70% cacao', codigo: 'T70', categoria: 'Tabletas', precio: 6500, stock: 0 }, YO);
  c.crear({ nombre: 'Chocolate en rama', categoria: 'Rama', precio: 4000 }, YO);
  assert.throws(() => c.crear({ nombre: 'Otra', codigo: 'B12' }, YO), ErrorCatalogo);
  assert.equal(c.lista().total, 3);
  assert.deepEqual(c.lista({ q: 'bombón' }).productos.map((p) => p.codigo), ['B12'], 'sin acentos: «bombón» encuentra «bombones»');
  assert.deepEqual(c.lista({ q: 'bombones' }).productos.map((p) => p.codigo), ['B12']);
  assert.deepEqual(c.lista({ q: 'T70' }).productos.map((p) => p.nombre), ['Tableta 70% cacao']);
  assert.deepEqual(c.lista().categorias.map((x) => x.nombre), ['Bombones', 'Rama', 'Tabletas']);
  const e = c.actualizar(a.id, { precio: 19000, activo: false }, YO);
  assert.equal(e.precio, 19000);
  assert.equal(e.activo, false);
  assert.equal(c.lista({ pausados: false }).total, 2);
  assert.equal(c.borrar(a.id, YO), true);
  assert.equal(c.obtener(a.id), null);
  const h = c.historial();
  assert.deepEqual(h.map((m) => m.tipo), ['baja', 'estado', 'precio', 'alta', 'alta', 'alta']);
  assert.equal(h[2].antes, '18000');
  assert.equal(h[2].despues, '19000');
  assert.ok(h.every((m) => m.quien === YO));
});

test('stock: suma y resta atómicas, nunca negativo, y queda quién lo cambió', () => {
  const c = nuevo();
  const p = c.crear({ nombre: 'Alfajor', stock: 3 }, YO);
  assert.equal(c.moverStock(p.id, -2, 'empleado@example.com', 'venta en el local').stock, 1);
  assert.throws(() => c.moverStock(p.id, -2, YO), /quedan 1/);
  assert.equal(c.obtener(p.id).stock, 1, 'el error no dejó nada a medias');
  assert.equal(c.moverStock(p.id, 10, YO).stock, 11);
  assert.throws(() => c.moverStock(p.id, 0, YO), /distinto de 0/);
  const sin = c.crear({ nombre: 'Rama (sin control de stock)' }, YO);
  assert.throws(() => c.moverStock(sin.id, -1, YO), /no controla stock/);
  const h = c.historial({ producto: p.id });
  assert.equal(h[1].detalle, '-2 · venta en el local');
  assert.equal(h[1].quien, 'empleado@example.com');
});

test('importar: vista previa sin guardar, actualizar por código o por nombre, errores por fila, reemplazar pausa lo que no vino', () => {
  const c = nuevo();
  c.crear({ nombre: 'Caja x12', codigo: 'B12', precio: 18000, stock: 5 }, YO);
  c.crear({ nombre: 'Rama', precio: 4000 }, YO);
  const filas = [
    { codigo: 'B12', precio: 19000 },
    { nombre: 'Tableta 70%', codigo: 'T70', precio: 6500, stock: 8, categoria: 'Tabletas' },
    { nombre: 'Sin precio', precio: 'gratis' },
    { codigo: 'XX9' },
    { nombre: 'Tableta 70%', codigo: 'T70' },
  ];
  const vista = c.importar(filas, { clave: 'codigo', probar: true }, YO);
  assert.deepEqual([vista.creados, vista.actualizados, vista.errores.map((e) => e.fila)], [1, 1, [4, 5, 6]]);
  assert.equal(c.lista().total, 2, 'la vista previa no guarda nada');
  const r = c.importar(filas, { clave: 'codigo' }, YO);
  assert.deepEqual([r.creados, r.actualizados, r.sinCambios], [1, 1, 0]);
  assert.match(r.errores.find((e) => e.fila === 4).motivo, /precio/);
  assert.match(r.errores.find((e) => e.fila === 5).motivo, /código XX9/);
  assert.match(r.errores.find((e) => e.fila === 6).motivo, /repetida/);
  assert.equal(c.lista({ q: 'B12' }).productos[0].precio, 19000);
  assert.equal(c.lista({ q: 'B12' }).productos[0].stock, 5, 'una columna que no vino no borra el dato');
  assert.equal(c.importar(filas.slice(0, 2), { clave: 'codigo' }, YO).sinCambios, 2, 'volver a importar lo mismo no cambia nada');
  // Por nombre (sin códigos), con otra forma de escribirlo.
  assert.equal(c.importar([{ nombre: 'RAMA', precio: 4200 }], { clave: 'nombre' }, YO).actualizados, 1);
  assert.equal(c.lista({ q: 'rama' }).productos[0].precio, 4200);
  // Reemplazar: lo que no está en el archivo queda pausado, no borrado.
  const rep = c.importar([{ nombre: 'Rama', precio: 4200 }], { modo: 'reemplazar', clave: 'nombre' }, YO);
  assert.equal(rep.pausados, 2);
  assert.equal(c.lista().total, 3);
  assert.equal(c.lista({ pausados: false }).total, 1);
  // Volver a importarlo lo reactiva.
  assert.equal(c.importar([{ codigo: 'B12', precio: 19000 }], { clave: 'codigo' }, YO).actualizados, 1);
  assert.equal(c.lista({ q: 'B12' }).productos[0].activo, true);
  assert.throws(() => c.importar(Array(4000).fill({ nombre: 'x' }), {}, YO), /máximo/);
});

test('paraAsistente: activos con stock legible, AGOTADO para no ofrecer, precios solo si el negocio los permite', () => {
  const c = nuevo();
  c.crear({ nombre: 'Caja x12', categoria: 'Bombones', precio: 18000, stock: 9, unidad: 'caja' }, YO);
  c.crear({ nombre: 'Tableta 70%', categoria: 'Tabletas', precio: 6500.5, stock: 2 }, YO);
  c.crear({ nombre: 'Huevo de Pascua', precio: 30000, stock: 0 }, YO);
  c.crear({ nombre: 'Rama', precio: 4000 }, YO);
  c.crear({ nombre: 'Pausado', precio: 1, stock: 3, activo: false }, YO);
  const sin = c.paraAsistente('hola');
  assert.doesNotMatch(sin.texto, /\$/);
  assert.deepEqual(sin.montos, []);
  const con = c.paraAsistente('hola', { precios: true });
  assert.match(con.texto, /- Caja x12 \(Bombones\) · \$ 18\.000 por caja · hay stock/);
  assert.match(con.texto, /Tableta 70% \(Tabletas\) · \$ 6\.500,50 · quedan 2/);
  assert.match(con.texto, /Huevo de Pascua · \$ 30\.000 · AGOTADO: no ofrecer/);
  assert.match(con.texto, /Rama · \$ 4\.000 · hay stock/);
  assert.doesNotMatch(con.texto, /Pausado/);
  assert.ok(['18000', '650050', '30000', '4000'].every((m) => con.montos.includes(m)), con.montos.join());
  assert.equal(pesos(1250.5), '$ 1.250,50');
});

test('paraAsistente: con un catálogo grande busca lo que se parece al mensaje', () => {
  const c = nuevo();
  c.importar(Array.from({ length: CATALOGO_ENTERO + 30 }, (_, i) => ({ nombre: `Producto genérico ${i}`, codigo: `G${i}` })), {}, YO);
  c.crear({ nombre: 'Bombón de dulce de leche', categoria: 'Bombones', stock: 4 }, YO);
  c.crear({ nombre: 'Caja de bombones surtidos', categoria: 'Bombones', stock: 0 }, YO);
  const r = c.paraAsistente('¿tenés bombones de dulce de leche?');
  assert.equal(r.cuantos, 2);
  assert.match(r.texto, /Bombón de dulce de leche.*quedan 4/);
  assert.match(r.texto, /Caja de bombones surtidos.*AGOTADO/);
  assert.match(r.texto, /Hay 180 productos más/);
});

test('fotos: solo imágenes reales y livianas; al cambiar la foto se borra la anterior', () => {
  const c = nuevo();
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
  assert.equal(tipoDeImagen(webp), 'image/webp');
  assert.equal(tipoDeImagen(new TextEncoder().encode('<svg onload=alert(1)>')), null);
  assert.throws(() => c.guardarFoto(new TextEncoder().encode('<script>'), 'image/png'), /solo fotos/);
  assert.throws(() => c.guardarFoto(webp, 'image/png'), /solo fotos/, 'el tipo declarado tiene que coincidir con el real');
  assert.throws(() => c.guardarFoto(new Uint8Array(700_000).fill(0xff), 'image/jpeg'), /pesada/);
  const f1 = c.guardarFoto(webp, 'image/webp');
  const p = c.crear({ nombre: 'Con foto', foto: f1 }, YO);
  assert.deepEqual([...c.foto(f1).datos], [...webp]);
  const f2 = c.guardarFoto(png, 'image/png');
  c.actualizar(p.id, { foto: f2 }, YO);
  assert.equal(c.foto(f1), null, 'la foto vieja se borró');
  assert.equal(c.foto(f2).tipo, 'image/png');
  c.guardarFoto(png, 'image/png'); // subida y nunca usada
  assert.equal(c.limpiarFotos(T0 + 1e9), 1);
  assert.ok(c.foto(f2), 'la que usa un producto queda');
});

test('normalizar: sin acentos ni signos, para buscar y reconocer nombres', () => {
  assert.equal(normalizar('  Bombón  de Dulce-de-Leche! '), 'bombon de dulce de leche');
});

test('búsquedas largas no rompen la base (los patrones de un Durable Object tienen 50 bytes como mucho)', () => {
  const c = nuevo();
  c.crear({ nombre: 'Ñandú de chocolate' }, YO);
  assert.equal(c.lista({ q: 'ñ'.repeat(80) }).total, 0);
  assert.equal(c.lista({ q: 'ñandu' }).total, 1);
  assert.doesNotThrow(() => c.paraAsistente('x'.repeat(300)));
});
