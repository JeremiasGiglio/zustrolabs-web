// Tests del lector de planillas de la app de negocios (ZL-121): .xlsx de Excel/openpyxl, .xlsx con celdas en línea,
// CSV con «;» y BOM como lo guarda Excel en Argentina. Datos ficticios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adivinarColumnas, aNumero, filasAProductos, leerCsv, leerXlsx, FUNCIONES_LECTOR } from '../src/lector.js';

const archivo = (n) => readFileSync(new URL(`./${n}`, import.meta.url));
const valores = (tabla) => tabla.map((f) => f.map((c) => c.v));

test('xlsx (como lo guarda Excel): títulos, textos compartidos, números, vacíos y la fila en blanco salteada', async () => {
  const t = await leerXlsx(archivo('productos-prueba.xlsx'));
  assert.deepEqual(valores(t)[0], ['Código', 'Producto', 'Precio de venta', 'Stock', 'Rubro', 'Detalle']);
  assert.equal(t.length, 5, 'la fila vacía no cuenta');
  assert.deepEqual(valores(t)[1].slice(0, 5), ['B12', 'Caja de bombones x12', '18000', '5', 'Bombones']);
  assert.equal(t[1][5].v, 'Surtidos, con dulce de leche & avellanas');
  assert.equal(t[2][2].n, true);
  assert.equal(aNumero(t[2][2]), 6500.5);
  assert.equal(t[3][5].v, 'Sin TACC <no confirmado>');
});

test('xlsx con celdas en línea y la hoja en otro archivo', async () => {
  const t = await leerXlsx(archivo('productos-inline.xlsx'));
  assert.deepEqual(valores(t), [['nombre', '', 'cantidad'], ['Alfajor & café', '', '12']]);
});

test('xlsx inválido o .xls viejo: un error que se entiende', async () => {
  await assert.rejects(leerXlsx(new TextEncoder().encode('esto no es un zip')), /no es un archivo \.xlsx/);
});

test('csv de Excel en castellano: BOM, «;», comillas con «;» y comillas dobles adentro', () => {
  const t = leerCsv(archivo('productos-prueba.csv').toString('utf8'));
  assert.deepEqual(valores(t)[0], ['Código', 'Producto', 'Precio', 'Cantidad', 'Categoría']);
  assert.equal(t[1][1].v, 'Caja de bombones x12; surtida');
  assert.equal(t[3][1].v, 'Rama "clásica"');
  assert.deepEqual(valores(leerCsv('a,b\n1,2\n\n')), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(valores(leerCsv('a\tb\r\n1\t2')), [['a', 'b'], ['1', '2']]);
});

test('adivinar columnas por el título, sin repetir campos', () => {
  assert.deepEqual(adivinarColumnas(['Código', 'Producto', 'Precio de venta', 'Stock', 'Rubro', 'Detalle', 'Otra']), ['codigo', 'nombre', 'precio', 'stock', 'categoria', 'descripcion', '']);
  assert.deepEqual(adivinarColumnas(['SKU', 'Artículo', 'PVP', 'Existencias', 'Precio']), ['codigo', 'nombre', 'precio', 'stock', '']);
});

test('números como los escribe la gente', () => {
  for (const [v, n] of [['$ 18.000', 18000], ['6.500,50', 6500.5], ['1,250.50', 1250.5], ['4000', 4000], ['12 u.', 12], ['1.5', 1.5], ['', null], ['-', null]]) assert.equal(aNumero({ v, n: false }), n, v);
  assert.ok(Number.isNaN(aNumero({ v: 'consultar', n: false })));
});

test('filas → productos: solo las columnas elegidas; lo que no es número se informa con su fila', async () => {
  const t = await leerXlsx(archivo('productos-prueba.xlsx'));
  const { filas, problemas } = filasAProductos(t, adivinarColumnas(t[0].map((c) => c.v)));
  assert.deepEqual(filas[0], { _fila: 2, codigo: 'B12', nombre: 'Caja de bombones x12', precio: 18000, stock: 5, categoria: 'Bombones', descripcion: 'Surtidos, con dulce de leche & avellanas' });
  assert.deepEqual(filas[2], { _fila: 4, nombre: 'Chocolate en rama', precio: 4000, categoria: 'Rama', descripcion: 'Sin TACC <no confirmado>' }, 'stock vacío = no se manda (no borra el que había)');
  assert.deepEqual(problemas, [{ fila: 6, motivo: '«consultar» no es un número (precio)' }], 'la fila como la muestra Excel (había una en blanco)');
});

test('las funciones se pueden mandar al navegador tal cual (autocontenidas)', () => {
  const codigo = FUNCIONES_LECTOR.map((f) => f.toString()).join('\n');
  const enNavegador = new Function(`${codigo}; return { leerCsv, aNumero, adivinarColumnas, filasAProductos };`)();
  assert.equal(enNavegador.aNumero({ v: '$ 1.250,50', n: false }), 1250.5);
  assert.deepEqual(enNavegador.filasAProductos(enNavegador.leerCsv('nombre;precio\nAlfajor;900'), ['nombre', 'precio']).filas, [{ _fila: 2, nombre: 'Alfajor', precio: 900 }]);
});
