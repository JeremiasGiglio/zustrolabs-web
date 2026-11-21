// Instagram de Zustro Labs (y de cada cliente): mensajes directos por la «Instagram API con inicio de sesión de
// Instagram» (ZL-111). Sin página de Facebook ni usuario del sistema: cada cuenta profesional se conecta entrando
// con su Instagram en un link (/api/instagram/conectar) y acepta los permisos; el Worker guarda su token, lo renueva
// solo y suscribe la cuenta a los avisos. Los mensajes llegan a zustrolabs.com/api/instagram y se responden con
// graph.instagram.com. Misma lógica que WhatsApp (whatsapp.js: atender) y mismo panel (panel.js). Lo que cambia:
// - el aviso de Meta tiene otra forma (object: "instagram", entry[].messaging[]), con los tiempos en milisegundos;
// - no hay botones: el idioma se elige escribiendo su nombre, y los mensajes van en trozos de hasta 1000 caracteres;
// - la persona se identifica con `ig:<cuenta>.<quien>` (la cuenta que recibió el mensaje y quien escribió), así no
//   se mezcla con los números de WhatsApp ni entre cuentas.
// Este módulo no importa nada de Cloudflare: se prueba con `node --test`.

import { SALUDO_IDIOMA_TEXTO } from './textos.js';

export const PREFIJO = 'ig:';
export const GRAPH_IG = 'https://graph.instagram.com';
export const VERSION_IG = 'v26.0';
/** Meta: el texto de un mensaje directo de Instagram tiene que ser de 1000 bytes o menos. */
export const MAX_TROZO = 1000;
/** Los tokens largos de Instagram duran 60 días; se renuevan cuando les quedan menos de 15. */
export const DURACION_TOKEN_MS = 60 * 24 * 3600_000;
export const RENOVAR_ANTES_MS = 15 * 24 * 3600_000;
export const PERMISOS = ['instagram_business_basic', 'instagram_business_manage_messages', 'instagram_business_manage_comments'];
/** ZL-160: el permiso para leer y responder comentarios. Las cuentas conectadas antes lo dan al volver a conectarse. */
export const PERMISO_COMENTARIOS = 'instagram_business_manage_comments';
const ID_RE = /^\d{6,20}$/;
const api = (env) => `${GRAPH_IG}/${env.IG_GRAPH_VERSION || VERSION_IG}`;

export const esInstagram = (quien) => String(quien ?? '').startsWith(PREFIJO);

/** `ig:<cuenta>.<quien>` → {cuenta, quien}; null si no tiene esa forma. */
export function partes(from) {
  const m = /^ig:(\d{6,20})\.(\d{6,20})$/.exec(String(from ?? ''));
  return m ? { cuenta: m[1], quien: m[2] } : null;
}
export const armarFrom = (cuenta, quien) => `${PREFIJO}${cuenta}.${quien}`;

// ───────────────────────── Entrada ─────────────────────────

/**
 * Pasa el aviso de Meta a los mismos eventos que WhatsApp: {id, from: 'ig:<cuenta>.<quien>', ts (segundos), kind, text}.
 * Ignora los ecos (lo que mandamos nosotros), los borrados, las reacciones y los «visto». Qué cuentas se atienden lo
 * decide después procesar() con la lista de cuentas conectadas.
 */
export function leerWebhookIg(payload) {
  if (payload?.object !== 'instagram') return [];
  const out = [];
  for (const entry of payload.entry ?? []) {
    // Meta manda los mensajes en entry[].messaging[]; el panel de prueba los manda como entry[].changes[] con
    // field «messages» y la misma forma adentro de value. Se leen las dos.
    const cambios = (entry.changes ?? []).filter((c) => c.field === 'messages' && c.value?.sender).map((c) => c.value);
    for (const m of [...(entry.messaging ?? []), ...cambios]) {
      const msg = m.message;
      if (!msg || msg.is_echo || msg.is_deleted) continue;
      const cuenta = String(m.recipient?.id ?? entry.id ?? '');
      const quien = String(m.sender?.id ?? '');
      if (!ID_RE.test(cuenta) || !ID_RE.test(quien) || quien === cuenta) continue;
      const base = { id: String(msg.mid ?? ''), from: armarFrom(cuenta, quien), cuenta, ts: Math.floor(Number(m.timestamp ?? 0) / 1000) };
      if (!base.id) continue;
      // ZL-149: una respuesta rápida tocada trae nuestro id («2», «SI»): vale como si lo escribiera.
      const rapido = String(msg.quick_reply?.payload ?? '');
      const texto = /^[A-Z0-9_]{1,20}$/.test(rapido) ? rapido : typeof msg.text === 'string' ? msg.text : '';
      // Un audio no se escucha: el asistente avisa que solo lee mensajes escritos. Un «me gusta» o un sticker también
      // llegan como adjunto.
      const adjuntos = msg.attachments ?? [];
      const audio = adjuntos.some((x) => x?.type === 'audio');
      if (texto.trim()) { out.push({ ...base, kind: 'text', text: texto }); continue; }
      // ZL-157: un ❤️, un sticker o una mención en una historia no se contestan (antes recibían «solo leo mensajes de
      // texto»). Una publicación compartida tiene su respuesta: no la vemos, así que se pregunta qué quiere saber.
      if (msg.is_unsupported || adjuntos.some((x) => ['story_mention', 'like_heart'].includes(x?.type) || x?.payload?.sticker_id)) continue;
      if (adjuntos.some((x) => ['share', 'ig_reel', 'reel', 'ig_post', 'post'].includes(x?.type))) { out.push({ ...base, kind: 'compartido' }); continue; }
      out.push({ ...base, kind: 'otro', ...(audio && { audio: true }) });
    }
  }
  return out;
}

/**
 * ZL-160: los comentarios nuevos en las publicaciones de una cuenta (entry[].changes[] con field «comments»):
 * → [{id, cuenta, quien, usuario, texto, media}]. Solo los de primer nivel (no las respuestas dentro de un hilo, que es
 * donde caen también nuestras respuestas públicas) y nunca los de la propia cuenta.
 */
export function leerComentariosIg(payload) {
  if (payload?.object !== 'instagram') return [];
  const out = [];
  for (const entry of payload.entry ?? []) {
    const cuenta = String(entry.id ?? '');
    for (const c of entry.changes ?? []) {
      if (c?.field !== 'comments') continue;
      const v = c.value ?? {};
      const id = String(v.id ?? '');
      const quien = String(v.from?.id ?? '');
      const usuario = /^[\w.]{1,30}$/.test(String(v.from?.username ?? '')) ? String(v.from.username) : '';
      const texto = typeof v.text === 'string' ? v.text.trim() : '';
      if (!/^\d{6,30}$/.test(id) || !ID_RE.test(cuenta) || !ID_RE.test(quien) || quien === cuenta || v.parent_id || !texto) continue;
      out.push({ id, cuenta, quien, usuario, texto: texto.slice(0, 1000), media: String(v.media?.id ?? '').replace(/\D/g, '').slice(0, 30), ts: Number(entry.time ?? 0) });
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
  const p = partes(m.to);
  const id = p ? p.quien : String(m.to ?? '').replace(PREFIJO, '');
  // ZL-161: una foto va como adjunto (Instagram la baja del link); el pie ya va en el texto de la respuesta.
  if (m.type === 'image' && /^https:\/\//.test(String(m.image?.link ?? ''))) return [{ recipient: { id }, message: { attachment: { type: 'image', payload: { url: m.image.link } } } }];
  const texto = m.type === 'interactive' ? SALUDO_IDIOMA_TEXTO : String(m.text?.body ?? '');
  const trozos = trozar(texto);
  // ZL-149: las opciones van como respuestas rápidas en el último trozo (hasta 13, 20 letras cada una).
  const ops = Array.isArray(m.opciones) ? m.opciones.filter((o) => o && /^[A-Z0-9_]{1,20}$/.test(String(o.id)) && String(o.titulo ?? '').trim()).slice(0, 13) : [];
  const corto = (t) => { const a = [...String(t).trim()]; return a.length > 20 ? `${a.slice(0, 19).join('')}…` : a.join(''); };
  return trozos.map((t, i) => ({ recipient: { id }, message: { text: t, ...(ops.length && i === trozos.length - 1 && { quick_replies: ops.map((o) => ({ content_type: 'text', title: corto(o.titulo), payload: String(o.id) })) }) } }));
}

/** Token de la cuenta que recibió el mensaje: la guardada al conectarse, o la de la variable IG_TOKEN para IG_ID. */
export async function tokenDe(env, cuentas, cuenta) {
  const c = await cuentas?.get?.(cuenta);
  if (c?.token) return c.token;
  if (env.IG_ID && String(env.IG_ID) === String(cuenta) && env.IG_TOKEN) return env.IG_TOKEN;
  return null;
}

/** Manda un mensaje (forma de WhatsApp) por Instagram, con el token de la cuenta que atiende esa charla. */
export async function enviarIg(env, mensaje, fetchImpl = fetch, cuentas = null) {
  const p = partes(mensaje.to);
  const token = p ? await tokenDe(env, cuentas, p.cuenta) : null;
  if (!token) throw Object.assign(new Error('Instagram sin_token'), { code: 'sin_token' });
  for (const pedido of convertir(mensaje)) {
    const res = await fetchImpl(`${api(env)}/me/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(pedido),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) continue;
    const data = await res.json().catch(() => ({}));
    // Solo estado y código: el texto del error de Meta podría traer datos.
    throw Object.assign(new Error(`Instagram ${res.status} ${data?.error?.code ?? ''}`.trim()), { code: data?.error?.code });
  }
}

/** Un error de Meta que dice que falta el permiso (la cuenta se conectó antes de pedirlo). */
const sinPermiso = (status, data) => [10, 200, 3].includes(Number(data?.error?.code)) || (status === 403);

/** ZL-160: respuesta pública debajo de un comentario. → {ok, id?, sinPermiso?, error?} (sin el texto de Meta). */
export async function responderComentario(env, token, comentario, texto, fetchImpl = fetch) {
  const res = await fetchImpl(`${api(env)}/${comentario}/replies`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Bearer ${token}` },
    body: new URLSearchParams({ message: String(texto).slice(0, 2000) }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data?.id) return { ok: true, id: String(data.id) };
  return { ok: false, sinPermiso: sinPermiso(res.status, data), error: `${res.status} ${data?.error?.code ?? ''}`.trim() };
}

/** ZL-160: respuesta privada a quien comentó (Meta: una sola por comentario, dentro de los 7 días). */
export async function responderEnPrivado(env, token, comentario, texto, fetchImpl = fetch) {
  const res = await fetchImpl(`${api(env)}/me/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ recipient: { comment_id: comentario }, message: { text: trozar(texto)[0] ?? '' } }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true };
  return { ok: false, sinPermiso: sinPermiso(res.status, data), error: `${res.status} ${data?.error?.code ?? ''}`.trim() };
}

/** ZL-160: el texto de la publicación comentada (para que «¿precio?» se entienda). Nunca corta el flujo si falla. */
export async function textoDePublicacion(env, token, media, fetchImpl = fetch) {
  if (!/^\d{6,30}$/.test(String(media ?? ''))) return '';
  try {
    const res = await fetchImpl(`${api(env)}/${media}?fields=caption`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return '';
    return String((await res.json())?.caption ?? '').slice(0, 600);
  } catch {
    return '';
  }
}

/** Nombre de usuario de quien escribe, para el panel (si Meta lo da). Nunca corta el flujo si falla. */
export async function nombreDe(env, from, fetchImpl = fetch, cuentas = null) {
  const p = partes(from);
  if (!p) return null;
  try {
    const token = await tokenDe(env, cuentas, p.cuenta);
    if (!token) return null;
    const res = await fetchImpl(`${api(env)}/${p.quien}?fields=username`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const u = String((await res.json())?.username ?? '');
    return /^[\w.]{1,30}$/.test(u) ? u : null;
  } catch {
    return null;
  }
}

// ───────────────────────── Conexión de una cuenta (OAuth de Instagram) ─────────────────────────

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(secreto, texto) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(texto)));
}

/**
 * Apps de Instagram que atiende el Worker: la del estudio (variables IG_APP_ID / IG_APP_SECRET) y una por cliente,
 * registradas en el Durable Object con el script scripts/instagram-cliente.ps1. Cada cliente usa su propia app de
 * Meta: así el acceso estándar le alcanza para su cuenta y no hace falta la revisión de Meta.
 */
export const appDelEstudio = (env) => (env.IG_APP_ID && env.IG_APP_SECRET ? { id: String(env.IG_APP_ID), secreto: env.IG_APP_SECRET, nombre: 'Zustro Labs' } : null);

export async function appDe(env, apps, id) {
  const propia = appDelEstudio(env);
  if (!id || (propia && String(id) === propia.id)) return propia;
  return (await apps?.get?.(String(id))) ?? null;
}

/** Todos los secretos con los que puede venir firmado un aviso (la app del estudio y las de los clientes). */
export async function secretosDe(env, apps) {
  const propia = appDelEstudio(env);
  const lista = await apps?.list?.().catch(() => []);
  return [...(propia ? [propia.secreto] : []), ...(lista ?? []).map((a) => a.secreto)].filter(Boolean);
}

/**
 * `state` firmado para el OAuth: lleva la app (y, desde la app de negocios, el negocio: ZL-137) y vence a los 15
 * minutos; así nadie conecta una cuenta sin pasar por nuestro link, ni la vincula a un negocio que no es suyo.
 */
export async function firmarEstado(secreto, now = Date.now(), app = '', negocio = '') {
  const hasta = String(now + 15 * 60_000);
  const cuerpo = negocio ? `${hasta}.${app}.${negocio}` : `${hasta}.${app}`;
  return `${cuerpo}.${await hmac(secreto, cuerpo)}`;
}
/** Devuelve {app, negocio?} si el state es válido; null si no. */
export async function leerEstado(secreto, estado, now = Date.now()) {
  const m = /^(\d+)\.(\d*)(?:\.([a-z0-9]{4,40}))?\.([A-Za-z0-9_-]+)$/.exec(String(estado ?? ''));
  if (!m || Number(m[1]) < now) return null;
  const cuerpo = m[3] ? `${m[1]}.${m[2]}.${m[3]}` : `${m[1]}.${m[2]}`;
  if (m[4] !== (await hmac(secreto, cuerpo))) return null;
  return m[3] ? { app: m[2], negocio: m[3] } : { app: m[2] };
}
export const estadoValido = async (secreto, estado, now) => Boolean(await leerEstado(secreto, estado, now));

export const urlVuelta = (origen) => `${origen}/api/instagram/conectar/vuelta`;

/** Adónde mandar a la persona para que entre con su Instagram y acepte los permisos (con la app que corresponda). */
export async function urlAutorizar(env, origen, now = Date.now(), app = appDelEstudio(env), negocio = '') {
  const u = new URL('https://www.instagram.com/oauth/authorize');
  u.searchParams.set('client_id', app.id);
  u.searchParams.set('redirect_uri', urlVuelta(origen));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', PERMISOS.join(','));
  u.searchParams.set('state', await firmarEstado(env.IG_APP_SECRET, now, app.id, negocio));
  u.searchParams.set('enable_fb_login', '0');
  u.searchParams.set('force_authentication', '1');
  return u.toString();
}

/**
 * Vuelta del OAuth: cambia el código por un token largo (60 días), lee quién es la cuenta y la suscribe a los avisos.
 * Devuelve {id, username, token, vence, app}. Los errores llevan solo el paso que falló.
 */
export async function conectarCuenta(env, { code, origen, now = Date.now(), app = appDelEstudio(env) }, fetchImpl = fetch) {
  const corto = await fetchImpl('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: app.id, client_secret: app.secreto, grant_type: 'authorization_code', redirect_uri: urlVuelta(origen), code }),
    signal: AbortSignal.timeout(10_000),
  });
  const c0 = await corto.json().catch(() => ({}));
  // Meta lo da plano o adentro de data[0] según la versión.
  const c = c0?.access_token ? c0 : c0?.data?.[0] ?? {};
  if (!corto.ok || !c.access_token) throw new Error(`oauth ${corto.status}`);
  // ZL-160: si dio el permiso de comentarios (la persona puede destildarlo al conectar). Sin el dato, no se sabe.
  const permisos = Array.isArray(c.permissions) ? c.permissions.map(String) : typeof c.permissions === 'string' ? c.permissions.split(',').map((x) => x.trim()) : null;
  const permisoComentarios = permisos ? permisos.includes(PERMISO_COMENTARIOS) : undefined;
  const largo = await fetchImpl(`${GRAPH_IG}/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(app.secreto)}&access_token=${encodeURIComponent(c.access_token)}`, { signal: AbortSignal.timeout(10_000) });
  const l = await largo.json().catch(() => ({}));
  if (!largo.ok || !l.access_token) throw new Error(`token_largo ${largo.status}`);
  const token = l.access_token;
  const vence = now + (Number(l.expires_in) > 0 ? Number(l.expires_in) * 1000 : DURACION_TOKEN_MS);
  const yo = await fetchImpl(`${api(env)}/me?fields=user_id,username`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  const y = await yo.json().catch(() => ({}));
  const id = String(y.user_id ?? y.id ?? '');
  if (!yo.ok || !ID_RE.test(id)) throw new Error(`cuenta ${yo.status}`);
  const username = /^[\w.]{1,30}$/.test(String(y.username ?? '')) ? String(y.username) : '';
  const s = await suscribir(env, token, fetchImpl, { comentarios: permisoComentarios === true });
  return { id, username, token, vence, app: app.id, suscripta: s.suscripta, ...(permisoComentarios !== undefined && { permisoComentarios: permisoComentarios && s.comentarios !== false }) };
}

/**
 * Suscribe la cuenta (su token) a los avisos de mensajes y, con el permiso dado (ZL-160), de comentarios.
 * Devuelve {suscripta, arreglada, comentarios?}. Si Meta rechaza los comentarios, igual quedan los mensajes: nunca se
 * pierde lo que ya andaba.
 */
export async function suscribir(env, token, fetchImpl = fetch, { comentarios = false } = {}) {
  const base = `${api(env)}/me/subscribed_apps`;
  const cab = { authorization: `Bearer ${token}` };
  const res = await fetchImpl(`${base}?fields=subscribed_fields`, { headers: cab, signal: AbortSignal.timeout(10_000) });
  const data = res.ok ? ((await res.json().catch(() => ({})))?.data ?? []) : [];
  const tiene = (campo) => data.some((a) => (a.subscribed_fields ?? []).includes(campo));
  if (tiene('messages') && (!comentarios || tiene('comments'))) return { suscripta: true, arreglada: false, ...(comentarios && { comentarios: true }) };
  const alta = async (campos) => {
    const post = await fetchImpl(`${base}?subscribed_fields=${campos}`, { method: 'POST', headers: cab, signal: AbortSignal.timeout(10_000) });
    return { ok: post.ok && Boolean((await post.json().catch(() => ({})))?.success), status: post.status };
  };
  if (comentarios) {
    const r = await alta('messages,comments');
    if (r.ok) return { suscripta: true, arreglada: true, comentarios: true };
  }
  const r = await alta('messages');
  return { suscripta: r.ok, arreglada: r.ok, ...(comentarios && { comentarios: false }), error: r.ok ? undefined : `alta ${r.status}` };
}

/** Renueva un token largo (Meta da otro de 60 días). Devuelve {token, vence} o null si Meta lo rechaza. */
export async function renovarToken(env, token, fetchImpl = fetch, now = Date.now()) {
  const res = await fetchImpl(`${GRAPH_IG}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(10_000) });
  const r = await res.json().catch(() => ({}));
  if (!res.ok || !r.access_token) return null;
  return { token: r.access_token, vence: now + (Number(r.expires_in) > 0 ? Number(r.expires_in) * 1000 : DURACION_TOKEN_MS) };
}

/**
 * Mantenimiento diario de cada cuenta conectada: renueva el token si le quedan menos de 15 días y comprueba la
 * suscripción. Devuelve una línea por cuenta, sin tokens.
 */
export async function mantenerCuentas(env, cuentas, fetchImpl = fetch, now = Date.now()) {
  const salida = [];
  for (const c of await cuentas.list()) {
    const linea = { cuenta: c.id, renovado: false, suscripta: false };
    try {
      if (c.vence - now < RENOVAR_ANTES_MS) {
        const nuevo = await renovarToken(env, c.token, fetchImpl, now);
        if (nuevo) {
          await cuentas.put(c.id, { ...c, ...nuevo });
          c.token = nuevo.token;
          linea.renovado = true;
        } else linea.error = 'renovar';
      }
      const s = await suscribir(env, c.token, fetchImpl, { comentarios: c.permisoComentarios === true });
      linea.suscripta = s.suscripta;
      if (s.comentarios !== undefined) linea.comentarios = s.comentarios;
      if (s.error) linea.error = s.error;
    } catch (e) {
      linea.error = String(e?.name ?? 'Error').slice(0, 40);
    }
    salida.push(linea);
  }
  return salida;
}

/** Página mínima que se muestra al terminar de conectar (sin datos de la persona). */
export function paginaConectado({ ok, username, suscripta, error, volver }) {
  // `volver`: desde la app de negocios (ZL-137), el botón para volver a ella.
  const boton = volver ? `<p><a href="${volver}" style="display:inline-block;background:#C8102E;color:#fff;padding:.6rem 1rem;border-radius:8px;text-decoration:none;font-weight:600">Volver a mi negocio</a></p>` : '<p>Ya podés cerrar esta ventana.</p>';
  const t = ok
    ? `<h1>Listo</h1><p>La cuenta ${username ? '@' + username.replace(/[^\w.]/g, '') : ''} quedó conectada${suscripta ? ' y suscripta a los mensajes' : ', pero falta la suscripción: avisanos'}.</p>${boton}`
    : `<h1>No se pudo conectar</h1><p>${volver ? 'Volvé a tu negocio y probá de nuevo' : 'Volvé a abrir el link que te mandamos'}, o escribinos a contact@zustrolabs.com.</p><p><small>${String(error ?? '').replace(/[<>&]/g, '')}</small></p>${volver ? boton : ''}`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Instagram · Zustro Labs</title><style>body{font:18px/1.5 system-ui,sans-serif;color:#1B2230;max-width:36rem;margin:3rem auto;padding:0 1rem}h1{color:#C8102E}</style></head><body>${t}</body></html>`;
}
