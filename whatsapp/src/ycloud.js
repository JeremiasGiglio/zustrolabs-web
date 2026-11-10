// WhatsApp de cada negocio con YCloud (ZL-135). El negocio conecta su número de WhatsApp Business a SU cuenta gratis
// de YCloud con coexistencia: sigue usando la app como siempre y no pierde las charlas. Nosotros solo:
// - creamos en esa cuenta un webhook hacia zustrolabs.com/api/whatsapp/ycloud/<clave> (uno por número);
// - verificamos la firma de cada aviso (YCloud-Signature: t=…,s=HMAC-SHA256(secreto, "t.cuerpo"));
// - respondemos con POST /v2/whatsapp/messages/sendDirectly y la clave de API del negocio.
// La clave de API y el secreto del webhook viven en el Durable Object; nunca se devuelven ni se registran.

export const YCLOUD_API = 'https://api.ycloud.com/v2';
const ENTRANTE = 'whatsapp.inbound_message.received';
// Lo que el dueño manda desde su app de WhatsApp Business (coexistencia): el asistente se calla en esa charla.
const ECO = 'whatsapp.smb.message.echoes';
const TOLERANCIA_S = 300;
const MAX_TEXTO = 4096;

const digitos = (s) => String(s ?? '').replace(/\D/g, '');

/** Un número en formato internacional (+ y de 8 a 15 dígitos), o null. Acepta espacios y guiones. */
export function numeroE164(s) {
  const t = String(s ?? '').trim().replace(/[\s()-]/g, '');
  return /^\+?\d{8,15}$/.test(t) ? `+${digitos(t)}` : null;
}

/** Quién escribe, para la memoria y para responder: `yc:<número del negocio>:<número de la persona>`. */
export const idCharla = (negocio, persona) => `yc:${digitos(negocio)}:${digitos(persona)}`;
export const esYCloud = (id) => /^yc:\d+:\d+$/.test(String(id ?? ''));

/** Clave nueva para la ruta del webhook de un número (no adivinable; la firma igual es lo que protege). */
export const claveNueva = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
export const claveValida = (c) => /^[0-9a-f]{24}$/.test(String(c ?? ''));

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** La firma de un aviso de YCloud. `now` en milisegundos. */
export async function firmaYCloud(crudo, cabecera, secreto, now = Date.now()) {
  if (!cabecera || !secreto) return false;
  const partes = Object.fromEntries(String(cabecera).split(',').map((p) => p.trim().split('=')).filter((p) => p.length === 2));
  const t = Number(partes.t);
  const s = String(partes.s ?? '');
  if (!Number.isFinite(t) || !/^[0-9a-f]{64}$/.test(s)) return false;
  // Un aviso firmado hace más de 5 minutos (o en el futuro) no se acepta: evita que alguien reenvíe uno viejo.
  if (Math.abs(now / 1000 - t) > TOLERANCIA_S) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const esperada = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${partes.t}.${crudo}`)));
  // Comparación en tiempo constante.
  let dif = 0;
  for (let i = 0; i < 64; i++) dif |= esperada.charCodeAt(i) ^ s.charCodeAt(i);
  return dif === 0;
}

/** Firma un cuerpo como YCloud (para las pruebas). */
export async function firmarYCloud(crudo, secreto, tSegundos) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `t=${tSegundos},s=${hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${tSegundos}.${crudo}`)))}`;
}

/**
 * Lo que sirve de un aviso: un mensaje entrante → {id, from, ts, kind, text?}; un mensaje que el dueño mandó desde su
 * app → {eco: true, from}. Lo demás (estados, historial, contactos) se ignora.
 */
export function leerYCloud(payload) {
  const tipo = payload?.type;
  if (tipo === ENTRANTE) {
    const m = payload.whatsappInboundMessage;
    if (!m?.from || !m?.to) return [];
    const base = { id: `yc:${m.wamid ?? m.id ?? payload.id}`, from: idCharla(m.to, m.from), ts: Math.floor(Date.parse(m.sendTime ?? payload.createTime ?? '') / 1000) || 0 };
    const texto = m.type === 'text' ? m.text?.body
      : m.type === 'button' ? m.button?.text
      : m.type === 'interactive' ? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title
      : null;
    return [texto && String(texto).trim() ? { ...base, kind: 'text', text: String(texto) } : { ...base, kind: 'otro' }];
  }
  if (tipo === ECO) {
    const m = payload.whatsappMessage;
    return m?.from && m?.to ? [{ eco: true, from: idCharla(m.from, m.to) }] : [];
  }
  return [];
}

/** Manda un mensaje de texto (los de atender(): {to, text: {body}}) con la clave del negocio. */
export async function enviarYCloud(apiKey, m, fetchImpl = fetch) {
  const [, negocio, persona] = /^yc:(\d+):(\d+)$/.exec(String(m?.to ?? '')) ?? [];
  if (!negocio) throw new Error('destino inválido');
  const body = String(m?.text?.body ?? '').slice(0, MAX_TEXTO);
  if (!body) return null;
  const r = await fetchImpl(`${YCLOUD_API}/whatsapp/messages/sendDirectly`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ from: `+${negocio}`, to: `+${persona}`, type: 'text', text: { body } }),
  });
  if (!r.ok) throw new Error(`ycloud ${r.status}`);
  const d = await r.json().catch(() => ({}));
  if (d?.status === 'failed') throw new Error(`ycloud ${String(d.errorCode ?? 'failed').slice(0, 30)}`);
  return d;
}

/** Qué quiere decir un error de YCloud, para el script (sin repetir la clave). */
const motivo = (status) => (status === 401 || status === 403 ? 'YCloud no aceptó la clave de API (revisá que esté copiada entera)' : `YCloud respondió ${status}`);

/**
 * Crea el webhook en la cuenta de YCloud del negocio. Primero con los mensajes entrantes y los ecos de la app; si YCloud
 * no acepta los ecos en esa cuenta, solo con los entrantes (y avisa: sin ecos, el asistente no sabe cuándo contesta el
 * dueño). → {id, secreto, ecos}
 */
export async function crearWebhook(apiKey, url, fetchImpl = fetch) {
  const crear = (eventos) => fetchImpl(`${YCLOUD_API}/webhookEndpoints`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ url, enabledEvents: eventos, description: 'Zustro Labs: asistente del negocio' }),
  });
  let ecos = true;
  let r = await crear([ENTRANTE, ECO]);
  if (r.status === 400) {
    ecos = false;
    r = await crear([ENTRANTE]);
  }
  if (!r.ok) throw new Error(motivo(r.status));
  const d = await r.json().catch(() => ({}));
  if (!d?.id || !d?.secret) throw new Error('YCloud no devolvió el webhook');
  return { id: String(d.id), secreto: String(d.secret), ecos };
}

/** Borra el webhook de la cuenta de YCloud del negocio (si ya no está, da igual). */
export async function borrarWebhook(apiKey, id, fetchImpl = fetch) {
  const r = await fetchImpl(`${YCLOUD_API}/webhookEndpoints/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'X-API-Key': apiKey } });
  return r.ok || r.status === 404;
}
