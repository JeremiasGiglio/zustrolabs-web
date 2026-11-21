// ZL-161: las fotos de los productos que el asistente manda por la charla. Las fotos viven en la base de cada negocio
// (Durable Object «Catalogo») y la app las muestra solo con sesión. Para que WhatsApp (YCloud o Meta) e Instagram las
// puedan bajar, se arma un link público FIRMADO y que VENCE: sin la firma de la clave del Worker (que se crea sola y
// vive en el Durable Object) nadie puede pedir otra foto ni otro negocio, y pasado el plazo el link deja de andar.
// Este módulo no importa nada de Cloudflare: se prueba con `node --test`.

export const HOST_FOTOS = 'https://zustrolabs.com';
export const RUTA_FOTOS = '/api/whatsapp/foto/';
/** Meta baja la foto al mandarla; una semana alcanza para reintentos y para verla desde la charla de prueba. */
export const VIGENCIA_FOTO_MS = 7 * 24 * 3600_000;
const NEGOCIO_RE = /^[a-z0-9]{4,40}$/;
const FOTO_RE = /^f[a-z0-9]{4,40}$/;

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function firma(clave, texto) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(clave), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(texto))).slice(0, 32);
}

/** El link público y firmado de una foto: `/api/whatsapp/foto/<negocio>/<foto>?v=<vence>&s=<firma>`. */
export async function linkFoto(clave, negocio, foto, now = Date.now()) {
  if (!clave || !NEGOCIO_RE.test(String(negocio)) || !FOTO_RE.test(String(foto))) return null;
  const vence = Math.floor((now + VIGENCIA_FOTO_MS) / 1000);
  return `${HOST_FOTOS}${RUTA_FOTOS}${negocio}/${foto}?v=${vence}&s=${await firma(clave, `${negocio}.${foto}.${vence}`)}`;
}

/** Lee y valida un pedido de foto: → {negocio, foto} si la firma es de esta clave y no venció; si no, null. */
export async function leerLinkFoto(clave, url, now = Date.now()) {
  const u = new URL(url);
  const m = new RegExp(`^${RUTA_FOTOS}([a-z0-9]{4,40})/(f[a-z0-9]{4,40})$`).exec(u.pathname);
  const vence = Number(u.searchParams.get('v'));
  const s = u.searchParams.get('s') ?? '';
  if (!clave || !m || !Number.isFinite(vence) || vence * 1000 < now) return null;
  const esperada = await firma(clave, `${m[1]}.${m[2]}.${vence}`);
  // Comparación sin cortar en la primera diferencia.
  if (s.length !== esperada.length) return null;
  let dif = 0;
  for (let i = 0; i < s.length; i++) dif |= s.charCodeAt(i) ^ esperada.charCodeAt(i);
  return dif === 0 ? { negocio: m[1], foto: m[2] } : null;
}
