// Avisos al celular (ZL-151): el cifrado se puede descifrar con la clave del celular, la firma VAPID se verifica con la
// clave pública, y las suscripciones muertas se borran.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avisarCelulares, cabeceraVapid, cifrar, clavesVapid, deB64u, suscripcionValida } from '../src/push.js';

const enc = new TextEncoder();
const b64u = (b) => Buffer.from(b).toString('base64url');
async function hkdf(salt, ikm, info, n) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, n * 8));
}
/** Un «celular» de prueba: su par de claves y el secreto de autenticación, como los arma el navegador. */
async function celular() {
  const par = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { par, pub, auth, sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: b64u(pub), auth: b64u(auth) } } };
}
/** Descifra como lo haría el navegador (RFC 8291). */
async function descifrar(cuerpo, c) {
  const salt = cuerpo.slice(0, 16);
  const largo = cuerpo[20];
  const asPub = cuerpo.slice(21, 21 + largo);
  const datos = cuerpo.slice(21 + largo);
  const asClave = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secreto = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asClave }, c.par.privateKey, 256));
  const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...c.pub, ...asPub]);
  const ikm = await hkdf(c.auth, secreto, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plano = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, k, datos));
  assert.equal(plano.at(-1), 2, 'termina con el delimitador del último registro');
  return new TextDecoder().decode(plano.slice(0, -1));
}

test('cifrado: el celular descifra exactamente el aviso', async () => {
  const c = await celular();
  const cuerpo = await cifrar(c.sub, '{"titulo":"Pedido nuevo"}');
  assert.equal(await descifrar(cuerpo, c), '{"titulo":"Pedido nuevo"}');
});

test('VAPID: la firma se verifica con la clave pública y el destino es el del servicio de avisos', async () => {
  const v = await clavesVapid();
  const cab = await cabeceraVapid('https://fcm.googleapis.com/fcm/send/abc', v, 1_792_000_000_000);
  const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(cab);
  assert.equal(k, v.publica);
  const [h, p, f] = jwt.split('.');
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.equal(payload.aud, 'https://fcm.googleapis.com');
  assert.equal(payload.sub, 'mailto:contact@zustrolabs.com');
  const pub = await crypto.subtle.importKey('raw', deB64u(v.publica), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, Buffer.from(f, 'base64url'), enc.encode(`${h}.${p}`)));
});

test('avisar: manda a cada celular; los que el servicio da por muertos (410) vuelven para borrarlos', async () => {
  const [a, b] = [await celular(), await celular()];
  b.sub.endpoint = 'https://updates.push.services.mozilla.com/wpush/v2/muerta';
  const pedidos = [];
  const fetchImpl = async (url, o) => (pedidos.push({ url, o }), new Response('', { status: url.includes('muerta') ? 410 : 201 }));
  const r = await avisarCelulares([a.sub, b.sub, { endpoint: 'http://mal', keys: {} }], { titulo: 'Pedido nuevo', cuerpo: 'N.º 1' }, await clavesVapid(), { fetchImpl });
  assert.equal(r.enviados, 1);
  assert.deepEqual(r.muertas.sort(), ['http://mal', b.sub.endpoint].sort());
  assert.equal(pedidos[0].o.headers['content-encoding'], 'aes128gcm');
  assert.match(JSON.parse(await descifrar(pedidos[0].o.body, a)).cuerpo, /N\.º 1/);
  assert.equal(suscripcionValida(a.sub), true);
  assert.equal(suscripcionValida({ endpoint: 'https://x.com', keys: { p256dh: 'corta', auth: 'x' } }), false);
});
