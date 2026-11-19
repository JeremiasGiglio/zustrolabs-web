// Avisos al celular del dueño (ZL-151): Web Push estándar (RFC 8291 + VAPID, RFC 8292), sin servicios de terceros.
// - Las claves VAPID se generan solas la primera vez y viven en el Durable Object (nunca en el repo ni en el chat).
// - El celular se suscribe desde la app de negocios (instalada en la pantalla de inicio) y la suscripción queda guardada
//   en el negocio. Cuando entra un pedido o una consulta, se le manda un aviso cifrado: el texto no dice datos de nadie.
// Solo WebCrypto: anda igual en Cloudflare y en `node --test`.

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const deB64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)), (c) => c.charCodeAt(0));
const unir = (...partes) => {
  const out = new Uint8Array(partes.reduce((a, p) => a + p.length, 0));
  let i = 0;
  for (const p of partes) { out.set(p, i); i += p.length; }
  return out;
};

async function hkdf(salt, ikm, info, largo) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, largo * 8));
}

/** Un par de claves VAPID nuevo: {publica (base64url, sin comprimir), privada (JWK)}. */
export async function clavesVapid() {
  const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { publica: b64u(await crypto.subtle.exportKey('raw', par.publicKey)), privada: await crypto.subtle.exportKey('jwk', par.privateKey) };
}

/** La cabecera Authorization de VAPID para el servicio de avisos de esa suscripción. */
export async function cabeceraVapid(endpoint, vapid, now = Date.now(), contacto = 'mailto:contact@zustrolabs.com') {
  const aud = new URL(endpoint).origin;
  const h = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const p = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: contacto })));
  const clave = await crypto.subtle.importKey('jwk', vapid.privada, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const firma = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, clave, enc.encode(`${h}.${p}`));
  return `vapid t=${h}.${p}.${b64u(firma)}, k=${vapid.publica}`;
}

/** Cifra el contenido para esa suscripción (aes128gcm, RFC 8291). → el cuerpo del pedido. */
export async function cifrar(suscripcion, texto) {
  const uaPublica = deB64u(suscripcion.keys.p256dh);
  const auth = deB64u(suscripcion.keys.auth);
  const efimera = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublica = new Uint8Array(await crypto.subtle.exportKey('raw', efimera.publicKey));
  const uaClave = await crypto.subtle.importKey('raw', uaPublica, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secreto = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaClave }, efimera.privateKey, 256));
  const ikm = await hkdf(auth, secreto, unir(enc.encode('WebPush: info\0'), uaPublica, asPublica), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const clave = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, clave, unir(enc.encode(texto), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return unir(salt, rs, new Uint8Array([asPublica.length]), asPublica, cifrado);
}

/** ¿Es una suscripción con la forma que manda el navegador (https y las dos claves)? */
export function suscripcionValida(s) {
  try {
    const u = new URL(String(s?.endpoint ?? ''));
    return u.protocol === 'https:' && /^[A-Za-z0-9_-]{80,100}$/.test(String(s?.keys?.p256dh ?? '')) && /^[A-Za-z0-9_-]{16,30}$/.test(String(s?.keys?.auth ?? ''));
  } catch {
    return false;
  }
}

/**
 * Manda un aviso a cada celular suscripto del negocio. `aviso`: {titulo, cuerpo, url}. Las suscripciones que el servicio
 * da por muertas (404 o 410) se devuelven en `muertas` para borrarlas. → {enviados, muertas}.
 */
export async function avisarCelulares(suscripciones, aviso, vapid, { fetchImpl = fetch, now = Date.now() } = {}) {
  let enviados = 0;
  const muertas = [];
  for (const s of suscripciones ?? []) {
    if (!suscripcionValida(s)) { muertas.push(s.endpoint); continue; }
    try {
      const r = await fetchImpl(s.endpoint, {
        method: 'POST',
        headers: { authorization: await cabeceraVapid(s.endpoint, vapid, now), 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '86400', urgency: 'high' },
        body: await cifrar(s, JSON.stringify({ titulo: String(aviso.titulo).slice(0, 80), cuerpo: String(aviso.cuerpo).slice(0, 160), url: aviso.url ?? '/' })),
      });
      if (r.status === 404 || r.status === 410) muertas.push(s.endpoint);
      else if (r.ok) enviados++;
    } catch { /* un celular que no responde no frena a los demás */ }
  }
  return { enviados, muertas };
}

/** El service worker de la app: muestra el aviso y, al tocarlo, abre la app. */
export const SW_JS = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { cuerpo: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Negocios', { body: d.cuerpo || '', icon: '/icono.svg', badge: '/icono.svg', data: { url: d.url || '/' }, tag: 'zl-aviso', renotify: true }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => {
    for (const w of ws) if ('focus' in w) { w.navigate(e.notification.data.url); return w.focus(); }
    return self.clients.openWindow(e.notification.data.url);
  }));
});
`;

export const MANIFIESTO = JSON.stringify({
  name: 'Negocios · Zustro Labs', short_name: 'Negocios', start_url: '/', display: 'standalone',
  background_color: '#F6F7F9', theme_color: '#C8102E', lang: 'es',
  icons: [{ src: '/icono.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
});

// El damero de la marca: la primera casilla (arriba a la izquierda) siempre roja.
export const ICONO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 3"><rect width="3" height="3" fill="#fff"/>${[0, 1, 2].flatMap((y) => [0, 1, 2].map((x) => ((x + y) % 2 === 0 ? `<rect x="${x}" y="${y}" width="1" height="1" fill="#C8102E"/>` : ''))).join('')}</svg>`;
