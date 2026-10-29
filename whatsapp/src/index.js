// Worker «zustrolabs-whatsapp»: el WhatsApp y el Instagram de Zustro Labs.
// - zustrolabs.com/api/whatsapp → webhook de la Cloud API de Meta (whatsapp.js).
// - zustrolabs.com/api/instagram → webhook de los mensajes directos de Instagram (instagram.js);
//   /api/instagram/conectar → link para que una cuenta (la del estudio o la de un cliente) se conecte con su Instagram.
// - equipo.zustrolabs.com → panel de atención humana, detrás de Cloudflare Access (panel.js).
// Separado del Radar Croacia: otra app de Meta, otro número, otra memoria y la clave de IA del estudio.
import { adaptadores } from './atencion.js';
import { conectarCuenta, enviarIg, esInstagram, estadoValido, leerWebhookIg, mantenerCuentas, nombreDe, paginaConectado, urlAutorizar } from './instagram.js';
import { avisar, panel } from './panel.js';
import { CANAL_INSTAGRAM, CANAL_WHATSAPP, textos } from './textos.js';
import { atender, enviar, firmaValida, leerWebhook, msgTexto, preguntador, verificarSuscripcion } from './whatsapp.js';

const MAX_CUERPO = 256_000;
const MAX_EDAD_MS = 3600_000; // mensajes de más de 1 h se ignoran (reintentos tardíos o reenvíos de un pedido firmado)
export const PANEL_HOST = 'equipo.zustrolabs.com';

/** El panel cuenta solo con el login de Access completo (dominio del equipo, audiencia y correos autorizados). */
export const panelListo = (env) => Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD && env.PANEL_EMAILS);

const SEGURIDAD = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
const json = (data, status) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...SEGURIDAD } });

/** Lo que cambia entre los dos canales de Meta. El resto (atender, panel, memoria) es el mismo. */
export const CANALES = {
  wa: {
    clave: 'wa',
    verify: 'WHATSAPP_VERIFY_TOKEN',
    secreto: (env) => env.WHATSAPP_APP_SECRET,
    listo: (env) => Boolean(env.WHATSAPP_APP_SECRET && env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID),
    leer: (payload, env) => leerWebhook(payload, env.WHATSAPP_PHONE_NUMBER_ID),
    enviar,
    nota: CANAL_WHATSAPP,
  },
  ig: {
    clave: 'ig',
    verify: 'IG_VERIFY_TOKEN',
    secreto: (env) => env.IG_APP_SECRET,
    // Las cuentas se conectan solas (/api/instagram/conectar); solo hacen falta las claves de la app de Instagram.
    listo: (env) => Boolean(env.IG_APP_SECRET && env.IG_APP_ID),
    leer: (payload) => leerWebhookIg(payload),
    enviar: (env, m, fetchImpl, cuentas) => enviarIg(env, m, fetchImpl, cuentas),
    nota: CANAL_INSTAGRAM,
  },
};

/** Manda por el canal que corresponde a quien escribe (`ig:…` es Instagram; un número, WhatsApp). */
export const mandarA = (env, m, fetchImpl, cuentas = null) => (esInstagram(m.to) ? enviarIg(env, m, fetchImpl, cuentas) : enviar(env, m, fetchImpl));

/** Memoria, charlas y cuentas de Instagram: el Durable Object ATENCION (una sola instancia), o lo que pasen los tests. */
function almacen(env, deps) {
  if (deps.memoria !== undefined || deps.charlas !== undefined || deps.cuentas !== undefined) {
    return { memoria: deps.memoria ?? null, charlas: deps.charlas ?? null, cuentas: deps.cuentas ?? null };
  }
  if (!env.ATENCION) return { memoria: null, charlas: null, cuentas: null };
  return adaptadores(env.ATENCION.get(env.ATENCION.idFromName('zustrolabs')));
}

const html = (cuerpo, status = 200) => new Response(cuerpo, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...SEGURIDAD } });

/**
 * Conexión de una cuenta de Instagram (la del estudio o la de un cliente):
 * - /api/instagram/conectar?clave=<IG_CONECTAR_CLAVE> → manda a Instagram a entrar y aceptar los permisos;
 * - /api/instagram/conectar/vuelta → Instagram vuelve con el código: se guarda el token y se suscribe la cuenta.
 * La clave del link evita que cualquiera conecte una cuenta; el `state` firmado evita vueltas falsas.
 */
async function conectar(request, env, deps) {
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now();
  const url = new URL(request.url);
  const origen = `https://${url.host}`;
  if (!CANALES.ig.listo(env) || !env.IG_CONECTAR_CLAVE) return html(paginaConectado({ ok: false, error: 'sin configurar' }), 503);
  if (url.pathname === '/api/instagram/conectar') {
    if ((url.searchParams.get('clave') ?? '') !== env.IG_CONECTAR_CLAVE) return html(paginaConectado({ ok: false, error: 'link inválido' }), 403);
    return Response.redirect(await urlAutorizar(env, origen, now), 302);
  }
  // Vuelta de Instagram.
  const code = url.searchParams.get('code');
  if (!code || !(await estadoValido(env.IG_APP_SECRET, url.searchParams.get('state'), now))) {
    return html(paginaConectado({ ok: false, error: url.searchParams.get('error_reason') ? 'no aceptaste los permisos' : 'vuelta inválida' }), 400);
  }
  const { cuentas } = almacen(env, deps);
  if (!cuentas) return html(paginaConectado({ ok: false, error: 'sin memoria' }), 503);
  try {
    const c = await conectarCuenta(env, { code, origen, now }, fetchImpl);
    await cuentas.put(c.id, { username: c.username, token: c.token, vence: c.vence });
    console.log(JSON.stringify({ canal: 'ig', que: 'conectada', suscripta: c.suscripta }));
    return html(paginaConectado({ ok: true, username: c.username, suscripta: c.suscripta }));
  } catch (e) {
    console.log(JSON.stringify({ canal: 'ig', que: 'conectar', ok: false, error: String(e?.message ?? 'error').slice(0, 40) }));
    return html(paginaConectado({ ok: false, error: String(e?.message ?? 'error').slice(0, 40) }), 502);
  }
}

/** Webhook: GET = verificación de Meta; POST = mensajes firmados. Responde 200 rápido y procesa aparte. */
async function webhook(request, env, ctx, deps, canal) {
  const fetchImpl = deps.fetch ?? fetch;
  if (request.method === 'GET') {
    const v = verificarSuscripcion(new URL(request.url), env, canal.verify);
    return new Response(v.body, { status: v.status, headers: { 'content-type': 'text/plain; charset=utf-8', ...SEGURIDAD } });
  }
  if (request.method !== 'POST') return json({ error: 'usá POST' }, 405);
  if (!canal.listo(env)) return json({ error: 'canal sin configurar' }, 503);
  if (Number(request.headers.get('content-length') ?? 0) > MAX_CUERPO) return json({ error: 'demasiado grande' }, 413);
  const crudo = await request.text();
  if (crudo.length > MAX_CUERPO) return json({ error: 'demasiado grande' }, 413);
  if (!(await firmaValida(crudo, request.headers.get('X-Hub-Signature-256'), canal.secreto(env)))) {
    console.log(JSON.stringify({ canal: canal.clave, ok: false, que: 'firma' }));
    return json({ error: 'firma inválida' }, 401);
  }
  let payload;
  try {
    payload = JSON.parse(crudo);
  } catch {
    return json({ error: 'pedido inválido' }, 400);
  }
  const eventos = canal.leer(payload, env);
  // Cuántos avisos llegaron y cuántos sirven (sin ids ni texto): para saber si Meta manda algo y con qué forma.
  console.log(JSON.stringify({
    canal: canal.clave, que: 'aviso', objeto: String(payload?.object ?? '').slice(0, 40), entradas: (payload?.entry ?? []).length,
    forma: (payload?.entry ?? []).map((e) => (e.messaging ? 'messaging' : e.changes ? 'changes' : 'otra')).join(','), eventos: eventos.length,
  }));
  const trabajo = procesar(eventos, env, fetchImpl, deps, canal);
  if (ctx?.waitUntil) ctx.waitUntil(trabajo);
  else await trabajo;
  return json({ ok: true }, 200);
}

async function procesar(eventos, env, fetchImpl, deps, canal) {
  const log = (o) => console.log(JSON.stringify({ canal: canal.clave, ...o }));
  const a = almacen(env, deps);
  const memoria = a.memoria;
  const cuentas = a.cuentas;
  // Sin el login del panel nadie vería los pedidos de PERSONA: se deriva al correo y el asistente no se calla.
  const charlas = panelListo(env) ? a.charlas : null;
  const preguntar = deps.preguntar ?? preguntador(env, { canal: canal.nota });
  const aviso = deps.avisar ?? (() => avisar(env, undefined, undefined, canal.clave));
  const now = deps.now ?? Date.now();
  const mandar = (m) => canal.enviar(env, m, fetchImpl, cuentas);

  for (const ev of eventos) {
    const t0 = Date.now();
    if (!ev.ts || now - ev.ts * 1000 > MAX_EDAD_MS) { log({ ok: true, que: 'viejo' }); continue; }
    // Instagram: solo las cuentas conectadas (o la de IG_ID con IG_TOKEN); lo demás se registra y se ignora.
    if (ev.cuenta && !(await cuentas?.get(ev.cuenta)) && !(env.IG_ID && String(env.IG_ID) === ev.cuenta && env.IG_TOKEN)) {
      log({ ok: true, que: 'cuenta_desconocida' });
      continue;
    }
    try {
      // Sin límites no se responde: son el freno al abuso y al gasto en IA.
      if (!env.LIMITE?.limit || !env.LIMITE_GLOBAL?.limit) { log({ ok: false, que: 'config' }); continue; }
      // Por persona: pasado el límite, silencio (contestar cada mensaje sería otra forma de abuso).
      if (!(await env.LIMITE.limit({ key: esInstagram(ev.from) ? ev.from : `wa:${ev.from}` })).success) { log({ ok: true, que: 'limite' }); continue; }
      // El de toda la cuenta (los dos canales juntos) se mira recién antes de gastar IA (no corta la atención humana ni BORRAR).
      const cupo = async () => ((await env.LIMITE_GLOBAL.limit({ key: 'ia' })).success ? 'ok' : 'global');
      const r = await atender(ev, { memoria, charlas, preguntar, now, cupo });
      for (const m of r.send) await mandar(m);
      // Aviso por correo (sin número ni texto). Si falla, la charla igual queda en el panel; el motivo va al registro.
      let avisado, avisoError;
      if (r.avisar) {
        // En Instagram el panel muestra el nombre de usuario, si Meta lo da (nunca frena la atención si falla).
        if (charlas && esInstagram(ev.from)) {
          const nombre = await nombreDe(env, ev.from, fetchImpl, cuentas);
          if (nombre) await charlas.agregar(ev.from, [], now, { nombre }).catch(() => {});
        }
        avisado = await Promise.resolve(aviso()).catch((e) => {
          avisoError = String((e && e.name) || 'Error').slice(0, 40);
          return false;
        });
        if (avisado === false && !avisoError) avisoError = 'sin_config';
      }
      // Solo métricas: ni el número ni el texto.
      log({ ok: true, ms: Date.now() - t0, que: r.metrica, idioma: r.idioma, fuera: r.fuera, notas: r.notas, uso: r.uso, handoff: r.handoff, avisado, avisoError });
    } catch (e) {
      log({ ok: false, ms: Date.now() - t0, error: String(e?.message || 'error').slice(0, 60) });
      // El aviso de falla va en el idioma de la charla (si la memoria responde).
      const st = await Promise.resolve(memoria?.get(ev.from)).catch(() => null);
      await mandar(msgTexto(ev.from, textos(st?.idioma).falla)).catch(() => {});
    }
  }
}

export default {
  async fetch(request, env, ctx, deps = {}) {
    const fetchImpl = deps.fetch ?? fetch;
    const url = new URL(request.url);
    if (url.hostname === (env.PANEL_HOST || PANEL_HOST)) {
      const a = almacen(env, deps);
      return panel(request, env, { fetch: fetchImpl, now: deps.now, store: a.memoria, chats: a.charlas, send: (e, m) => mandarA(e, m, fetchImpl, a.cuentas) });
    }
    if (url.pathname === '/api/whatsapp') return webhook(request, env, ctx, deps, CANALES.wa);
    if (url.pathname === '/api/instagram') return webhook(request, env, ctx, deps, CANALES.ig);
    if (url.pathname === '/api/instagram/conectar' || url.pathname === '/api/instagram/conectar/vuelta') return conectar(request, env, deps);
    return json({ error: 'no existe' }, 404);
  },

  /** Cron diario: renueva los tokens de Instagram que están por vencer y comprueba que cada cuenta siga suscripta. */
  async scheduled(_evento, env, _ctx, deps = {}) {
    const fetchImpl = deps.fetch ?? fetch;
    const { cuentas } = almacen(env, deps);
    if (!cuentas) { console.log(JSON.stringify({ canal: 'ig', que: 'mantenimiento', error: 'sin memoria' })); return []; }
    const r = await mantenerCuentas(env, cuentas, fetchImpl, deps.now ?? Date.now()).catch((e) => [{ error: String(e?.name ?? 'Error').slice(0, 40) }]);
    console.log(JSON.stringify({ canal: 'ig', que: 'mantenimiento', cuentas: r }));
    return r;
  },
};
