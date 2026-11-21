// ZL-161: el asistente manda la foto de un producto. Links firmados que vencen, el catálogo que ve la IA, la validación
// de lo que pide y el envío por cada canal. Sin red; datos ficticios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leerLinkFoto, linkFoto, VIGENCIA_FOTO_MS } from '../src/fotos.js';
import { crearCatalogo } from '../src/catalogo.js';
import { parsearFicha, preguntadorNegocio, promptNegocio } from '../src/negocio.js';
import { convertir } from '../src/instagram.js';
import { enviarYCloud } from '../src/ycloud.js';
import { msgImagen } from '../src/whatsapp.js';
import { sqlPrueba } from './sqlite.js';

const T0 = 1_792_000_000_000;
const CLAVE = 'clave-de-fotos-de-prueba';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const FICHA = parsearFicha(readFileSync(new URL('./ficha-prueba.md', import.meta.url), 'utf8')).ficha;

test('linkFoto: firmado, de ese negocio y esa foto, y vence; cualquier cambio lo invalida', async () => {
  const l = await linkFoto(CLAVE, 'n1a2b3c4', 'fabc123', T0);
  assert.match(l, /^https:\/\/zustrolabs\.com\/api\/whatsapp\/foto\/n1a2b3c4\/fabc123\?v=\d+&s=[\w-]{32}$/);
  assert.deepEqual(await leerLinkFoto(CLAVE, l, T0), { negocio: 'n1a2b3c4', foto: 'fabc123' });
  assert.equal(await leerLinkFoto(CLAVE, l, T0 + VIGENCIA_FOTO_MS + 1000), null, 'vencido');
  assert.equal(await leerLinkFoto('otra-clave', l, T0), null);
  assert.equal(await leerLinkFoto(CLAVE, l.replace('fabc123', 'fabc124'), T0), null, 'otra foto');
  assert.equal(await leerLinkFoto(CLAVE, l.replace('n1a2b3c4', 'n9z9z9z9'), T0), null, 'otro negocio');
  const v = new URL(l).searchParams.get('v');
  assert.equal(await leerLinkFoto(CLAVE, l.replace(`v=${v}`, `v=${Number(v) + 3600}`), T0), null, 'estirar el vencimiento');
  assert.equal(await linkFoto('', 'n1a2b3c4', 'fabc123', T0), null);
  assert.equal(await linkFoto(CLAVE, '../x', 'fabc123', T0), null);
});

test('catálogo para la IA: los productos con foto llevan su ref y «con foto»; uno agotado no', () => {
  const { sql, transaccion } = sqlPrueba();
  const c = crearCatalogo(sql, transaccion, () => T0);
  const foto = c.guardarFoto(PNG, 'image/png');
  const foto2 = c.guardarFoto(PNG, 'image/png');
  const torta = c.crear({ nombre: 'Torta de chocolate', precio: 18000, stock: 3, foto }, 'duena@example.com');
  c.crear({ nombre: 'Pan francés', precio: 2500 }, 'duena@example.com');
  const agotado = c.crear({ nombre: 'Rosca', precio: 9000, stock: 0, foto: foto2 }, 'duena@example.com');
  const r = c.paraAsistente('torta', { precios: true });
  assert.match(r.texto, new RegExp(`\\[ref ${torta.id}\\] Torta de chocolate.* · con foto`));
  assert.match(r.texto, /- Pan francés/);
  assert.doesNotMatch(r.texto, /\[ref [^\]]+\] Pan francés/, 'sin foto ni pedidos, sin ref');
  assert.doesNotMatch(r.texto, /Rosca.*con foto/);
  assert.deepEqual(r.fotos, { [torta.id]: { foto, nombre: 'Torta de chocolate' } });
  assert.equal(r.fotos[agotado.id], undefined);
});

test('la IA pide fotos por ref: solo pasan las del catálogo que vio, sin repetir y como mucho 3', async () => {
  const cat = { texto: '- [ref p1] Torta · con foto\n- [ref p2] Pan · con foto', montos: [], cuantos: 2, fotos: { p1: { foto: 'f111111', nombre: 'Torta' }, p2: { foto: 'f222222', nombre: 'Pan' } } };
  let cuerpo;
  const llamar = async (c) => (cuerpo = c, { salida: { respuesta: 'Te paso las fotos.', persona: false, fuera_de_tema: false, idioma: 'es', fotos: ['p1', 'p1', 'p-inventado', 'p2'] } });
  const r = await preguntadorNegocio({}, FICHA, { catalogo: async () => cat, llamar })('¿me mostrás la torta y el pan?');
  assert.deepEqual(r.fotos, [{ ref: 'p1', foto: 'f111111', nombre: 'Torta' }, { ref: 'p2', foto: 'f222222', nombre: 'Pan' }]);
  assert.ok(cuerpo.output_config.format.schema.properties.fotos);
  assert.match(cuerpo.system, /Fotos: si la persona pide ver un producto/);
  // Sin productos con foto, la regla ni aparece (y nada que mandar).
  assert.doesNotMatch(promptNegocio(FICHA, 'WhatsApp', { texto: '- Pan · hay stock' }), /Fotos: si la persona/);
  const sin = await preguntadorNegocio({}, FICHA, { catalogo: async () => ({ texto: '- Pan', montos: [], fotos: {} }), llamar })('foto?');
  assert.equal(sin.fotos, undefined);
});

test('envío: WhatsApp por YCloud manda la imagen con su pie; Instagram, como adjunto', async () => {
  const m = msgImagen('yc:5493410000001:5493410000009', 'https://zustrolabs.com/api/whatsapp/foto/n1/fabc123?v=1&s=x', 'Torta de chocolate');
  const pedidos = [];
  await enviarYCloud('clave', m, async (url, o) => (pedidos.push(JSON.parse(o.body)), Response.json({ id: 'y', status: 'accepted' })));
  assert.deepEqual(pedidos[0], { from: '+5493410000001', to: '+5493410000009', type: 'image', image: { link: m.image.link, caption: 'Torta de chocolate' } });
  assert.equal(await enviarYCloud('clave', { ...m, image: { link: 'http://inseguro.example.com/x' } }, async () => assert.fail('no se manda')), null);
  const ig = convertir({ ...m, to: 'ig:17841400000000002.17841400000000009' });
  assert.deepEqual(ig, [{ recipient: { id: '17841400000000009' }, message: { attachment: { type: 'image', payload: { url: m.image.link } } } }]);
});
