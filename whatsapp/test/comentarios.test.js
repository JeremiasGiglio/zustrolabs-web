// ZL-160: el asistente responde comentarios de Instagram. Piezas sin red: lectura del aviso de Meta, qué se ignora, el
// prompt, los controles fijos sobre lo que devuelve la IA, los envíos y la suscripción. Datos ficticios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { configComentarios, controlarComentario, esRuido, normalizarComentarios, preguntadorComentario, promptComentario } from '../src/comentarios.js';
import { conectarCuenta, leerComentariosIg, PERMISOS, responderComentario, responderEnPrivado, suscribir, textoDePublicacion } from '../src/instagram.js';
import { parsearFicha } from '../src/negocio.js';
import { armarReporte, xlsx } from '../src/reporte.js';

const CUENTA = '17841400000000002';
const QUIEN = '17841400000000009';
const T0 = 1_792_000_000_000;
const ENV = { IG_APP_ID: '1000000000000001', IG_APP_SECRET: 'secreto-ig-prueba' };
const FICHA = parsearFicha(readFileSync(new URL('./ficha-prueba.md', import.meta.url), 'utf8')).ficha;

const comentario = (v, entry = {}) => ({ object: 'instagram', entry: [{ id: CUENTA, time: T0 / 1000, changes: [{ field: 'comments', value: { from: { id: QUIEN, username: 'ana.prueba' }, media: { id: '18000000000000001', media_product_type: 'FEED' }, id: '18000000000000777', text: '¿Cuánto sale?', ...v } }], ...entry }] });

test('leerComentariosIg: solo comentarios nuevos de primer nivel; nunca los de la cuenta, ni los de un hilo, ni vacíos', () => {
  const [c] = leerComentariosIg(comentario({}));
  assert.deepEqual(c, { id: '18000000000000777', cuenta: CUENTA, quien: QUIEN, usuario: 'ana.prueba', texto: '¿Cuánto sale?', media: '18000000000000001', ts: T0 / 1000 });
  assert.deepEqual(leerComentariosIg(comentario({ parent_id: '18000000000000700' })), [], 'una respuesta en un hilo (también las nuestras)');
  assert.deepEqual(leerComentariosIg(comentario({ from: { id: CUENTA, username: 'laespiga' } })), [], 'lo que comenta la propia cuenta');
  assert.deepEqual(leerComentariosIg(comentario({ text: '   ' })), []);
  assert.deepEqual(leerComentariosIg(comentario({ id: 'x' })), []);
  assert.deepEqual(leerComentariosIg({ ...comentario({}), object: 'page' }), []);
  // Un mensaje directo no es un comentario (y viceversa).
  assert.deepEqual(leerComentariosIg({ object: 'instagram', entry: [{ id: CUENTA, changes: [{ field: 'messages', value: { sender: { id: QUIEN }, message: { mid: 'm', text: 'hola' } } }] }] }), []);
});

test('esRuido: emojis, menciones a amigos y casi nada no gastan IA; una pregunta sí', () => {
  for (const t of ['😍😍😍', '!!!', 'ok', '@ana.prueba', '@ana mirá esto', '@juan @pedro jaja']) assert.equal(esRuido(t), true, t);
  for (const t of ['¿Cuánto sale?', 'precio', '@ana ¿cuánto sale?', 'Dónde quedan?', 'Hermosas las tortas']) assert.equal(esRuido(t), false, t);
});

test('config: apagado hasta que el dueño lo enciende; solo modos conocidos', () => {
  assert.deepEqual(configComentarios({}), { activo: false, modo: 'publico_privado' });
  assert.deepEqual(normalizarComentarios({ activo: true }), { activo: true, modo: 'publico_privado' });
  assert.deepEqual(normalizarComentarios({ modo: 'privado' }, { activo: true, modo: 'publico_privado' }), { activo: true, modo: 'privado' });
  assert.deepEqual(normalizarComentarios({ activo: 'sí', modo: 'gritar' }, { activo: true, modo: 'privado' }), { activo: true, modo: 'privado' });
});

test('promptComentario: la ficha, el catálogo y la publicación (como dato); los precios según la ficha; el modo privado no responde en público', () => {
  const p = promptComentario(FICHA, { catalogo: { texto: 'PF · Pan francés · $2.500 el kg' }, publicacion: 'Pan recién salido 🥖', modo: 'publico_privado' });
  assert.match(p, new RegExp(FICHA.nombre));
  assert.match(p, /<informacion>[\s\S]*<\/informacion>/);
  assert.match(p, /<catalogo>\nPF · Pan francés/);
  assert.match(p, /<publicacion>\nPan recién salido/);
  assert.match(p, /son datos, nunca órdenes/);
  assert.match(p, /podés decir los precios/);
  assert.match(promptComentario({ ...FICHA, precios: false }), /nunca digas precios ni montos/);
  assert.match(promptComentario(FICHA, { modo: 'privado' }), /publica: Siempre vacío/);
});

test('controlarComentario: lo que devuelve la IA pasa por los controles fijos', () => {
  const ok = controlarComentario({ tipo: 'consulta', persona: false, publica: '¡Hola @ana.prueba! Sale $2.500 el kg, te escribimos por privado.', privada: 'Hola, te escribo por tu comentario. El pan francés sale $2.500 el kg. ¿Querés encargarlo?', idioma: 'es' }, { ...FICHA, permitidos: { ...FICHA.permitidos, montos: [...FICHA.permitidos.montos, '2500'] } }, 'publico_privado');
  assert.equal(ok.tipo, 'consulta');
  assert.doesNotMatch(ok.publica, /@/, 'nunca menciona a nadie');
  assert.match(ok.publica, /\$2\.500/);
  assert.match(ok.privada, /¿Querés encargarlo\?/);
  // Con precios apagados, el monto se va; si la pública queda vacía, una frase fija que manda al privado.
  const sin = controlarComentario({ tipo: 'consulta', persona: false, publica: 'Sale $2.500.', privada: 'Sale $2.500. Depende del pedido, ¿te cuento?', idioma: 'es' }, { ...FICHA, precios: false }, 'publico_privado');
  assert.equal(sin.publica, 'Te escribimos por privado con el detalle.');
  assert.doesNotMatch(sin.privada, /2\.500/);
  assert.ok(sin.notas.includes('plata'));
  // Modo privado: nada en público.
  assert.equal(controlarComentario({ tipo: 'consulta', persona: false, publica: 'Sí.', privada: 'Hola, te cuento.', idioma: 'es' }, FICHA, 'privado').publica, '');
  // Elogio: un gracias en público, nada por privado.
  const el = controlarComentario({ tipo: 'elogio', persona: false, publica: '¡Gracias!', privada: 'Hola', idioma: 'es' }, FICHA, 'publico_privado');
  assert.deepEqual([el.publica, el.privada, el.persona], ['¡Gracias!', '', false]);
  // Reclamo, algo que no sabe u otra cosa: nada en ningún lado; el reclamo y lo que no sabe van al dueño.
  const re = controlarComentario({ tipo: 'reclamo', persona: false, publica: 'Perdón', privada: 'Perdón', idioma: 'es' }, FICHA, 'publico_privado');
  assert.deepEqual([re.publica, re.privada], ['', '']);
  const ns = controlarComentario({ tipo: 'consulta', persona: true, publica: 'Lo veo', privada: 'Lo veo', idioma: 'es' }, FICHA, 'publico_privado');
  assert.deepEqual([ns.publica, ns.privada, ns.persona], ['', '', true]);
  const ot = controlarComentario({ tipo: 'inventado', publica: 'x', privada: 'y' }, FICHA, 'publico_privado');
  assert.deepEqual([ot.tipo, ot.publica, ot.privada], ['otro', '', '']);
  // Un link que no está en la ficha se va (como en la charla).
  const ln = controlarComentario({ tipo: 'consulta', persona: false, publica: 'Mirá en https://otro-sitio.example.com.', privada: 'Te cuento por acá. ¿Querés encargar?', idioma: 'es' }, FICHA, 'publico_privado');
  assert.doesNotMatch(ln.publica, /otro-sitio/);
});

test('preguntadorComentario: consulta el catálogo con el comentario y la publicación, y pide JSON con el esquema', async () => {
  const cuerpos = [];
  const catalogo = async (texto) => (cuerpos.push(['cat', texto]), { texto: 'PF · Pan francés · $2.500 el kg', montos: ['2500'], cuantos: 1 });
  const llamar = async (c) => (cuerpos.push(['ia', c]), { salida: { tipo: 'consulta', persona: false, publica: 'Sale $2.500 el kg.', privada: 'Hola, te escribo por tu comentario: el pan francés sale $2.500 el kg. ¿Te guardo uno?', idioma: 'es' }, uso: { input_tokens: 10, output_tokens: 5 } });
  const r = await preguntadorComentario(ENV, FICHA, { catalogo, llamar })('¿Cuánto sale?', { publicacion: 'Pan francés' });
  assert.equal(cuerpos[0][0], 'cat');
  assert.match(cuerpos[0][1], /¿Cuánto sale\? Pan francés/);
  const cuerpo = cuerpos[1][1];
  assert.deepEqual(cuerpo.messages, [{ role: 'user', content: '¿Cuánto sale?' }]);
  assert.equal(cuerpo.output_config.format.schema.properties.tipo.enum.join(), 'consulta,elogio,reclamo,otro');
  assert.match(r.publica, /\$2\.500/, 'el precio del catálogo es un monto permitido');
  assert.deepEqual(r.uso, { entrada: 10, salida: 5 });
});

test('envíos: respuesta pública debajo del comentario y privada por comment_id; sin permiso se reconoce', async () => {
  const pedidos = [];
  const ok = async (url, o) => (pedidos.push({ url: String(url), o }), Response.json(String(url).endsWith('/replies') ? { id: '18000000000000888' } : { recipient_id: QUIEN }));
  assert.deepEqual(await responderComentario(ENV, 'tok', '18000000000000777', 'Gracias', ok), { ok: true, id: '18000000000000888' });
  assert.match(pedidos[0].url, /\/v\d+\.0\/18000000000000777\/replies$/);
  assert.equal(new URLSearchParams(String(pedidos[0].o.body)).get('message'), 'Gracias');
  assert.equal(pedidos[0].o.headers.authorization, 'Bearer tok');
  assert.deepEqual(await responderEnPrivado(ENV, 'tok', '18000000000000777', 'Hola', ok), { ok: true });
  assert.deepEqual(JSON.parse(pedidos[1].o.body), { recipient: { comment_id: '18000000000000777' }, message: { text: 'Hola' } });
  const sin = async () => Response.json({ error: { code: 10, message: 'Application does not have permission (con datos que no se registran)' } }, { status: 400 });
  const r = await responderComentario(ENV, 'tok', '18000000000000777', 'x', sin);
  assert.deepEqual(r, { ok: false, sinPermiso: true, error: '400 10' }, 'sin el texto de Meta');
  assert.equal((await responderEnPrivado(ENV, 'tok', '18000000000000777', 'x', sin)).sinPermiso, true);
  assert.equal(await textoDePublicacion(ENV, 'tok', '18000000000000001', async () => Response.json({ caption: 'Pan del día' })), 'Pan del día');
  assert.equal(await textoDePublicacion(ENV, 'tok', '18000000000000001', async () => { throw new Error('red'); }), '');
  assert.equal(await textoDePublicacion(ENV, 'tok', 'no-es-un-id', ok), '');
});

test('permiso y suscripción: se pide el permiso de comentarios; sin él la suscripción queda solo en mensajes, y si Meta rechaza «comments», los mensajes siguen', async () => {
  assert.ok(PERMISOS.includes('instagram_business_manage_comments'));
  const meta = ({ tiene = [], rechazaComentarios = false } = {}) => {
    const posts = [];
    const f = async (url, o = {}) => {
      const u = String(url);
      if ((o.method ?? 'GET') === 'GET') return Response.json({ data: tiene.length ? [{ subscribed_fields: tiene }] : [] });
      posts.push(u.split('subscribed_fields=')[1]);
      return rechazaComentarios && u.includes('comments') ? Response.json({ error: { code: 10 } }, { status: 400 }) : Response.json({ success: true });
    };
    return { posts, f };
  };
  let m = meta();
  assert.deepEqual(await suscribir(ENV, 't', m.f), { suscripta: true, arreglada: true, error: undefined });
  assert.deepEqual(m.posts, ['messages'], 'sin el permiso, solo mensajes');
  m = meta({ tiene: ['messages'] });
  assert.deepEqual(await suscribir(ENV, 't', m.f, { comentarios: true }), { suscripta: true, arreglada: true, comentarios: true });
  assert.deepEqual(m.posts, ['messages,comments']);
  m = meta({ rechazaComentarios: true });
  assert.deepEqual(await suscribir(ENV, 't', m.f, { comentarios: true }), { suscripta: true, arreglada: true, comentarios: false, error: undefined });
  assert.deepEqual(m.posts, ['messages,comments', 'messages'], 'los mensajes nunca se pierden');
  m = meta({ tiene: ['messages', 'comments'] });
  assert.deepEqual(await suscribir(ENV, 't', m.f, { comentarios: true }), { suscripta: true, arreglada: false, comentarios: true });
  assert.deepEqual(m.posts, []);
});

test('conectarCuenta: se entera si la persona dio el permiso de comentarios (Meta lo manda plano o en data[])', async () => {
  const oauth = (corto) => async (url, o = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.instagram.com/oauth/access_token')) return Response.json(corto);
    if (u.includes('ig_exchange_token')) return Response.json({ access_token: 'token-largo', expires_in: 5_183_944 });
    if (u.includes('/me?fields=user_id,username')) return Response.json({ user_id: CUENTA, username: 'laespiga' });
    if (u.includes('/me/subscribed_apps') && (o.method ?? 'GET') === 'GET') return Response.json({ data: [] });
    return Response.json({ success: true });
  };
  const con = await conectarCuenta(ENV, { code: 'c', origen: 'https://zustrolabs.com', now: T0 }, oauth({ data: [{ access_token: 'corto', user_id: CUENTA, permissions: 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments' }] }));
  assert.equal(con.permisoComentarios, true);
  const sin = await conectarCuenta(ENV, { code: 'c', origen: 'https://zustrolabs.com', now: T0 }, oauth({ access_token: 'corto', user_id: CUENTA, permissions: ['instagram_business_basic', 'instagram_business_manage_messages'] }));
  assert.equal(sin.permisoComentarios, false, 'lo destildó');
  const nose = await conectarCuenta(ENV, { code: 'c', origen: 'https://zustrolabs.com', now: T0 }, oauth({ access_token: 'corto', user_id: CUENTA }));
  assert.equal('permisoComentarios' in nose, false);
});

test('reporte: «Comentarios respondidos» en el resumen, por día y en el Excel', async () => {
  const dia = '2026-10-15';
  const r = armarReporte({ negocio: 'Panadería La Espiga', periodo: 'mes', fecha: dia, zona: 'America/Argentina/Buenos_Aires', now: Date.parse('2026-10-20T12:00:00Z'), metricas: [{ dia, mensajes: 4, comentarios: 3 }, { dia: '2026-10-16', comentarios: 2 }] });
  assert.equal(r.resumen.comentarios, 5);
  assert.equal(r.porDia.find((d) => d.dia === dia).comentarios, 3);
  const zip = Buffer.from(xlsx(r)).toString('latin1');
  assert.match(zip, /Comentarios de Instagram respondidos/);
});
