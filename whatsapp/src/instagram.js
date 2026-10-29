// Instagram de Zustro Labs: los mensajes directos de @zustrolabs llegan al webhook zustrolabs.com/api/instagram
// (app de Meta «Zustro Labs», variante con inicio de sesión de Facebook: la cuenta está vinculada a la página de
// Facebook del estudio) y se responden desde esa página con la API de Meta.
// Misma lógica que WhatsApp (whatsapp.js: atender) y mismo panel (panel.js). Lo que cambia:
// - el aviso de Meta tiene otra forma (object: "instagram", entry[].messaging[]), con los tiempos en milisegundos;
// - no hay botones: el idioma se elige escribiendo su nombre, y los mensajes van en trozos de hasta 1000 caracteres;
// - la persona se identifica con `ig:<id de Instagram>` para que no se mezcle con los números de WhatsApp en la
//   memoria ni en el panel.
// Este módulo no importa nada de Cloudflare: se prueba con `node --test`.

import { GRAPH_VERSION } from './whatsapp.js';
import { SALUDO_IDIOMA_TEXTO } from './textos.js';

export const PREFIJO = 'ig:';
/** Meta: el texto de un mensaje directo de Instagram tiene que ser de 1000 bytes o menos. */
export const MAX_TROZO = 1000;
const ID_RE = /^\d{6,20}$/;

export const esInstagram = (quien) => String(quien ?? '').startsWith(PREFIJO);

// ───────────────────────── Entrada ─────────────────────────

/**
 * Pasa el aviso de Meta a los mismos eventos que WhatsApp: {id, from: 'ig:<id>', ts (segundos), kind, text}.
 * Ignora los ecos (lo que mandamos nosotros), los borrados, las reacciones, los «visto» y lo que llegue
 * para otra cuenta.
 */
export function leerWebhookIg(payload, igId) {
  if (payload?.object !== 'instagram' || !igId) return [];
  const out = [];
  for (const entry of payload.entry ?? []) {
    // Meta manda los mensajes en entry[].messaging[]; el panel de prueba (y alguna versión) los manda como
    // entry[].changes[] con field «messages» y la misma forma adentro de value. Se leen las dos.
    const cambios = (entry.changes ?? []).filter((c) => c.field === 'messages' && c.value?.sender).map((c) => c.value);
    for (const m of [...(entry.messaging ?? []), ...cambios]) {
      const msg = m.message;
      if (!msg || msg.is_echo || msg.is_deleted) continue;
      if (String(m.recipient?.id ?? '') !== String(igId)) continue;
      const quien = String(m.sender?.id ?? '');
      if (!ID_RE.test(quien) || quien === String(igId)) continue;
      const base = { id: String(msg.mid ?? ''), from: PREFIJO + quien, ts: Math.floor(Number(m.timestamp ?? 0) / 1000) };
      if (!base.id) continue;
      const texto = typeof msg.text === 'string' ? msg.text : '';
      // Un «me gusta» rápido o un sticker llegan como adjunto; una foto con texto, como texto.
      if (texto.trim()) out.push({ ...base, kind: 'text', text: texto });
      else out.push({ ...base, kind: 'otro' });
    }
  }
  return out;
}

// ───────────────────────── Salida ─────────────────────────

/** Corta un texto en trozos de hasta MAX_TROZO bytes, por párrafos y oraciones si se puede. */
export function trozar(texto, max = MAX_TROZO) {
  const bytes = (s) => new TextEncoder().encode(s).length;
  const limpio = String(texto ?? '').trim();
  if (!limpio) return [];
  if (bytes(limpio) <= max) return [limpio];
  const partes = limpio.split(/\n{2,}/).flatMap((p) => (bytes(p) <= max ? [p] : p.split(/(?<=[.!?…])\s+/)));
  const out = [];
  let actual = '';
  for (const p of partes) {
    let pieza = p;
    // Una pieza que sola supera el máximo se corta a lo bruto (no debería pasar: el asistente responde corto).
    while (bytes(pieza) > max) {
      let corte = pieza.length;
      while (bytes(pieza.slice(0, corte)) > max) corte -= 50;
      out.push(pieza.slice(0, corte).trim());
      pieza = pieza.slice(corte);
    }
    const junto = actual ? `${actual}\n\n${pieza}` : pieza;
    if (bytes(junto) <= max) actual = junto;
    else {
      if (actual) out.push(actual);
      actual = pieza;
    }
  }
  if (actual) out.push(actual);
  return out.filter(Boolean);
}

/**
 * Pasa un mensaje con forma de WhatsApp (msgTexto / msgIdiomas) a los pedidos de la API de Instagram.
 * Los botones de idioma se vuelven el saludo en texto, con los nombres de los idiomas para escribir.
 */
export function convertir(m) {
  const id = String(m.to ?? '').replace(PREFIJO, '');
  const texto = m.type === 'interactive' ? SALUDO_IDIOMA_TEXTO : String(m.text?.body ?? '');
  return trozar(texto).map((t) => ({ recipient: { id }, message: { text: t } }));
}

/** Manda un mensaje (forma de WhatsApp) por Instagram desde la página de Facebook vinculada. */
export async function enviarIg(env, mensaje, fetchImpl = fetch) {
  const v = env.IG_GRAPH_VERSION || GRAPH_VERSION;
  for (const pedido of convertir(mensaje)) {
    const res = await fetchImpl(`https://graph.facebook.com/${v}/${env.IG_PAGE_ID}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.IG_TOKEN}` },
      body: JSON.stringify(pedido),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) continue;
    const data = await res.json().catch(() => ({}));
    // Solo estado y código: el texto del error de Meta podría traer datos.
    throw Object.assign(new Error(`Instagram ${res.status} ${data?.error?.code ?? ''}`.trim()), { code: data?.error?.code });
  }
}

/** Nombre de usuario de quien escribe, para el panel (si Meta lo da). Nunca corta el flujo si falla. */
export async function nombreDe(env, quien, fetchImpl = fetch) {
  const id = String(quien ?? '').replace(PREFIJO, '');
  if (!ID_RE.test(id) || !env.IG_TOKEN) return null;
  try {
    const v = env.IG_GRAPH_VERSION || GRAPH_VERSION;
    const res = await fetchImpl(`https://graph.facebook.com/${v}/${id}?fields=username`, {
      headers: { authorization: `Bearer ${env.IG_TOKEN}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const u = String((await res.json())?.username ?? '');
    return /^[\w.]{1,30}$/.test(u) ? u : null;
  } catch {
    return null;
  }
}

// ───────────────────────── Suscripción ─────────────────────────

/**
 * Revisa que la página de Facebook siga suscripta a los avisos de mensajes de la app y, si no, la suscribe.
 * Lo corre el cron diario y el script scripts/instagram-suscribir.mjs. Devuelve {suscripta, arreglada}.
 */
export async function revisarSuscripcion(env, fetchImpl = fetch) {
  if (!env.IG_TOKEN || !env.IG_PAGE_ID) return { suscripta: false, arreglada: false, error: 'sin_config' };
  const v = env.IG_GRAPH_VERSION || GRAPH_VERSION;
  const base = `https://graph.facebook.com/${v}/${env.IG_PAGE_ID}/subscribed_apps`;
  const cab = { authorization: `Bearer ${env.IG_TOKEN}` };
  const res = await fetchImpl(`${base}?fields=subscribed_fields`, { headers: cab, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return { suscripta: false, arreglada: false, error: `lectura ${res.status}` };
  const data = (await res.json().catch(() => ({})))?.data ?? [];
  const suscripta = data.some((a) => (a.subscribed_fields ?? []).includes('messages'));
  if (suscripta) return { suscripta: true, arreglada: false };
  const post = await fetchImpl(base, {
    method: 'POST',
    headers: { ...cab, 'content-type': 'application/json' },
    body: JSON.stringify({ subscribed_fields: ['messages'] }),
    signal: AbortSignal.timeout(10_000),
  });
  const ok = post.ok && Boolean((await post.json().catch(() => ({})))?.success);
  return { suscripta: ok, arreglada: ok, error: ok ? undefined : `alta ${post.status}` };
}
