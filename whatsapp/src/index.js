// Worker «zustrolabs-whatsapp»: el WhatsApp y el Instagram de Zustro Labs.
// - zustrolabs.com/api/whatsapp → webhook de la Cloud API de Meta (whatsapp.js).
// - zustrolabs.com/api/instagram → webhook de los mensajes directos de Instagram (instagram.js);
//   /api/instagram/conectar → link para que una cuenta (la del estudio o la de un cliente) se conecte con su Instagram.
// - zustrolabs.com/api/whatsapp/ycloud/<clave> → el WhatsApp de cada negocio, por su cuenta de YCloud (ycloud.js, ZL-135).
// - equipo.zustrolabs.com → panel de atención humana, detrás de Cloudflare Access (panel.js).
// Separado del Radar Croacia: otra app de Meta, otro número, otra memoria y la clave de IA del estudio.
import { adaptadores, almacenPrueba, crearAtencion } from './atencion.js';
import { appDe, conectarCuenta, enviarIg, esInstagram, leerEstado, leerWebhookIg, mantenerCuentas, nombreDe, paginaConectado, secretosDe, urlAutorizar } from './instagram.js';
import { conAjustes, parsearFicha, perfilNegocio, preguntadorNegocio, resumenFicha } from './negocio.js';
import { ajustesDeVenta } from './atencion.js';
import { administrar, appCompartida, appNegocios, canalesDe, conectarWhatsApp, desconectarWhatsApp, NEGOCIOS_HOST, todosLosNumeros } from './negocios.js';
import { avisar, panel } from './panel.js';
import { CANAL_INSTAGRAM, CANAL_WHATSAPP, textos } from './textos.js';
import { atender, enviar, firmaValida, leerWebhook, msgTexto, preguntador, verificarSuscripcion } from './whatsapp.js';
import { claveMemoria, claveValida, enviarYCloud, firmaYCloud, leerYCloud, normalizar, numeroDeCharla, webhookDeYCloud } from './ycloud.js';
import { agregarAAcceso, correosEnAcceso } from './acceso.js';
import { pedidosDeCharla } from './pedidos-charla.js';
import { consultasDeCharla } from './consultas.js';
import { avisarCelulares } from './push.js';
import { armarReporte, diaLocal, horaLocal, xlsx } from './reporte.js';
import { mensajesDePrueba, verificarNegocio } from './verificar.js';

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
    // IG_APP_SECRET también firma el `state` del OAuth de las apps de los clientes.
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
    return { memoria: deps.memoria ?? null, charlas: deps.charlas ?? null, cuentas: deps.cuentas ?? null, apps: deps.apps ?? null, fichas: deps.fichas ?? null, negocios: deps.negocios ?? null, ycloud: deps.ycloud ?? null };
  }
  if (!env.ATENCION) return { memoria: null, charlas: null, cuentas: null, apps: null, fichas: null, negocios: null, ycloud: null };
  return adaptadores(env.ATENCION.get(env.ATENCION.idFromName('zustrolabs')));
}

/** La base de un negocio (Durable Object «Catalogo», una por negocio), o la de los tests. → {ejecutar(op, args)} */
const catalogoDe = (env, deps) => deps.catalogo ?? ((id) => (env.CATALOGO ? env.CATALOGO.get(env.CATALOGO.idFromName(`negocio:${id}`)) : null));

/** Lo que la IA consulta antes de responder: los productos de ese negocio que vienen al caso. */
const consultaCatalogo = (env, deps, negocioId, ficha) => {
  const cat = negocioId ? catalogoDe(env, deps)(negocioId) : null;
  if (!cat) return null;
  return async (texto, { refs = false } = {}) => {
    const r = await cat.ejecutar('paraAsistente', [texto, { precios: ficha.precios, refs }]);
    return r?.ok ? r.valor : null;
  };
};

/**
 * La IA de un negocio: su ficha, sus productos y su tope diario (uno con mucho movimiento no deja sin IA a los demás;
 * también es lo que se le factura). Lo usan Instagram y WhatsApp por YCloud.
 */
function iaDeNegocio(env, deps, a, dueño, fichaSola, canal) {
  // ZL-149: lo que carga el negocio en «Cómo vendés» (retiro, envío, pago) también lo sabe el asistente.
  const ficha = dueño?.ajustes ? conAjustes(fichaSola, ajustesDeVenta(dueño.ajustes)) : fichaSola;
  const catalogo = consultaCatalogo(env, deps, dueño?.id, ficha);
  const ia = deps.preguntarNegocio ? deps.preguntarNegocio(ficha, catalogo) : preguntadorNegocio(env, ficha, { catalogo, canal });
  return async (texto, idioma, opciones) => {
    if (dueño && a.negocios && (await a.negocios.contarUso(dueño.id)) > (dueño.limiteDia ?? 300)) return { respuesta: '', vacia: true, tope: true, persona: true, fuera_de_tema: false, notas: ['tope_negocio'] };
    return ia(texto, idioma, opciones);
  };
}

/**
 * Le avisa al comprador por el mismo canal del pedido (ZL-139): Instagram con el token de la cuenta del negocio, o
 * WhatsApp con la clave de YCloud del número del negocio. Solo cuentas y números de ESE negocio. → true o el motivo.
 */
async function avisarComprador(env, a, negocio, charla, texto, fetchImpl = fetch) {
  const msg = { to: charla, text: { body: String(texto).slice(0, 1000) } };
  try {
    if (/^yc:\d+:\d+$/.test(charla)) {
      const reg = ((await a.ycloud?.list?.()) ?? []).find((r) => r.negocio === negocio.id && normalizar(r.numero) === normalizar(numeroDeCharla(charla)));
      if (!reg) return 'el número ya no está conectado';
      await enviarYCloud(reg.apiKey, msg, fetchImpl);
      return true;
    }
    const cuenta = /^ig:(\d+)\./.exec(charla)?.[1];
    if (cuenta && (negocio.cuentas ?? []).includes(cuenta)) {
      await enviarIg(env, msg, fetchImpl, a.cuentas);
      return true;
    }
    return 'la cuenta ya no es de este negocio';
  } catch (e) {
    return String(e?.message ?? e).slice(0, 80);
  }
}

/**
 * La pausa del asistente en una charla, desde la app de negocios (ZL-148): cuánto falta, «La atiendo» (se calla las
 * horas de la ficha) y «Devolver al asistente» (vuelve ya). La memoria de WhatsApp por YCloud usa la clave normalizada.
 */
function pausasDeCharla(a, now) {
  if (!a.memoria) return null;
  const clave = (charla) => claveMemoria(charla);
  const reloj = () => now ?? Date.now();
  return {
    async pausa(charla) {
      const e = await a.memoria.get(clave(charla));
      return e?.humanoHasta && e.humanoHasta > reloj() ? e.humanoHasta : 0;
    },
    async pausar(charla, horas) {
      const e = (await a.memoria.get(clave(charla))) ?? {};
      const hasta = reloj() + horas * 3600_000;
      await a.memoria.put(clave(charla), { ...e, humanoHasta: hasta, pase: null });
      return hasta;
    },
    /** ZL-153: el usuario de Instagram de esa charla, si se guardó (para mostrarlo en la app). */
    async usuario(charla) {
      const e = await a.memoria.get(clave(charla));
      return e?.usuario ?? null;
    },
    async devolver(charla) {
      const e = await a.memoria.get(clave(charla));
      if (e) await a.memoria.put(clave(charla), { ...e, humanoHasta: 0, pase: null, consulta: null });
    },
  };
}

/** Pedidos por chat de un negocio (ZL-139), si los tiene encendidos y una base de productos. */
function pedidosDe(env, deps, dueño, ficha, charla, canal) {
  if (!dueño?.pedidos) return null;
  const cat = catalogoDe(env, deps)(dueño.id);
  return cat ? pedidosDeCharla({ cat, charla, canal, negocio: ficha.nombre, precios: ficha.precios, ajustes: ajustesDeVenta(dueño.ajustes) }) : null;
}

/**
 * Después de responderle a alguien de un negocio (ZL-151): los números del día (charlas, audios, pases) y el aviso al
 * celular del dueño cuando entra un pedido o una consulta. Nunca frena la charla si falla.
 */
async function despuesDeAtender(env, a, deps, fetchImpl, dueño, antes, ev, r, now, charla) {
  if (!dueño?.id || !a.negocios?.sumarMetrica) return;
  try {
    // Todo con la hora del negocio (ZL-152): así el reporte dice a qué hora y qué día le escriben.
    const zona = ajustesDeVenta(dueño.ajustes).zona;
    const dia = diaLocal(now, zona);
    if (r.metrica !== 'repetido' && a.negocios.sumarMensaje) await a.negocios.sumarMensaje(dueño.id, { dia, hora: horaLocal(now, zona), canal: /^yc:/.test(charla) ? 'wa' : 'ig', n: ev.partes ?? 1 });
    if (!['repetido', 'humano'].includes(r.metrica) && (!antes?.ultimo || diaLocal(antes.ultimo, zona) !== dia)) await a.negocios.sumarMetrica(dueño.id, 'charlas', dia);
    if (ev.audio) await a.negocios.sumarMetrica(dueño.id, 'audios', dia);
    if (r.handoff) await a.negocios.sumarMetrica(dueño.id, 'pases', dia);
    const canal = /^yc:/.test(charla) ? 'WhatsApp' : 'Instagram';
    let aviso = null;
    if (r.metrica === 'pedido_nuevo' && r.pedido) aviso = { titulo: 'Pedido nuevo', cuerpo: `Pedido N.º ${r.pedido} por ${canal}. Abrí la app para aceptarlo.` };
    else if (r.consulta && r.handoff) aviso = { titulo: 'Alguien necesita al negocio', cuerpo: `Consulta N.º ${r.consulta} por ${canal}. El asistente espera 15 minutos a que la tomes.` };
    else if (r.consulta && r.metrica === 'consulta') aviso = { titulo: 'Consulta nueva', cuerpo: `Consulta N.º ${r.consulta} por ${canal}: quiere avanzar.` };
    if (aviso) await avisarNegocio(a, dueño.id, aviso, fetchImpl, now);
  } catch (e) {
    console.log(JSON.stringify({ canal: 'negocio', que: 'despues', error: String(e?.message ?? 'error').slice(0, 60) }));
  }
}

/** Aviso a los celulares suscriptos del negocio (Web Push). Borra los que ya no existen. → cuántos se mandaron. */
async function avisarNegocio(a, negocioId, aviso, fetchImpl, now) {
  const subs = await a.negocios.suscripcionesPush(negocioId);
  if (!subs.length) return 0;
  const r = await avisarCelulares(subs, { ...aviso, url: '/' }, await a.negocios.vapid(), { fetchImpl, now });
  if (r.muertas.length) await a.negocios.borrarPush(negocioId, r.muertas);
  console.log(JSON.stringify({ canal: 'negocio', que: 'aviso_celular', enviados: r.enviados, muertas: r.muertas.length }));
  return r.enviados;
}

/**
 * Seguimiento con permiso (ZL-151), cada 10 minutos: los recordatorios que ya tocan. Solo dentro de las 24 h del
 * último mensaje de la persona, sin BAJA, sin alguien del negocio atendiendo, y como mucho dos por charla.
 */
export async function seguimientos(env, deps, now) {
  const a = almacen(env, deps);
  const fetchImpl = deps.fetch ?? fetch;
  if (!a.memoria?.seguimientos) return [];
  const out = [];
  for (const { num, estado: e } of await a.memoria.seguimientos(50, now)) {
    const charla = e.seguir?.charla || num;
    const listo = (motivo) => (out.push({ que: motivo }), a.memoria.put(num, { ...e, seguir: null }));
    if (e.baja) { await listo('baja'); continue; }
    if (e.humanoHasta && e.humanoHasta > now) { await listo('atiende_el_negocio'); continue; }
    if (!e.ultimo || now - e.ultimo > 23 * 3600_000) { await listo('fuera_de_24h'); continue; }
    // El negocio de esa charla: por el número de WhatsApp (YCloud) o por la cuenta de Instagram.
    let negocio = null;
    if (/^yc:/.test(charla)) {
      const reg = ((await a.ycloud?.list?.()) ?? []).find((r) => normalizar(r.numero) === normalizar(numeroDeCharla(charla)));
      negocio = reg ? await a.negocios.get(reg.negocio) : null;
    } else {
      const cuenta = /^ig:(\d+)\./.exec(charla)?.[1];
      negocio = cuenta ? await a.negocios.deCuenta(cuenta) : null;
    }
    const f = negocio ? await a.negocios.ficha(negocio.id) : null;
    const pf = f?.texto && f.activa ? parsearFicha(f.texto) : null;
    if (!pf?.ok) { await listo('sin_negocio'); continue; }
    if (e.seguir.tipo === 'carrito') {
      const cat = catalogoDe(env, deps)(negocio.id);
      const r = cat ? await cat.ejecutar('carritoDe', [charla]).catch(() => null) : null;
      if (!r?.ok || !r.valor) { await listo('sin_carrito'); continue; }
    }
    const T = perfilNegocio(pf.ficha).textos(e.idioma);
    const texto = e.seguir.tipo === 'carrito' ? T.seguirCarrito : T.seguirConsulta;
    const enviado = await avisarComprador(env, a, negocio, charla, texto, fetchImpl);
    await a.memoria.put(num, { ...e, seguir: null, seguidos: (e.seguidos ?? 0) + 1 });
    if (enviado === true) await a.negocios.sumarMetrica?.(negocio.id, 'seguimientos', diaLocal(now, ajustesDeVenta(negocio.ajustes).zona));
    out.push({ que: enviado === true ? 'enviado' : 'no_enviado', tipo: e.seguir.tipo });
  }
  if (out.length) console.log(JSON.stringify({ canal: 'negocio', que: 'seguimientos', r: out }));
  return out;
}

/** Cuánto espera el asistente a que terminen de llegar los mensajes de una ráfaga antes de responder (ZL-149). */
export const RAFAGA_MS = 6000;

/**
 * Antes de responder a un negocio (ZL-149): los mensajes seguidos se juntan en uno. Devuelve el evento listo, o null si
 * este mensaje es parte de una ráfaga que va a responder el último. (Los audios no se transcriben: el asistente avisa
 * que solo lee mensajes escritos.)
 */
async function prepararEvento(ev, { deps, memoria, clave }) {
  if (ev.kind !== 'text' || !memoria?.sumarRafaga || !(deps.rafagaMs > 0)) return ev;
  await memoria.sumarRafaga(clave, { id: ev.id, t: ev.text });
  await (deps.esperar ?? ((ms) => new Promise((ok) => setTimeout(ok, ms))))(deps.rafagaMs);
  const textos = await memoria.tomarRafaga(clave, ev.id);
  if (!textos) {
    // Lo responde el último de la ráfaga; este queda marcado para que un reintento de Meta no lo repita.
    await memoria.visto?.(ev.id);
    return null;
  }
  return textos.length > 1 ? { ...ev, text: textos.join('\n'), partes: textos.length } : ev;
}


/** Consultas y pases al equipo de un negocio (ZL-146): siempre que el negocio tenga su base. */
function consultasDe(env, deps, dueño, charla, canal) {
  if (!dueño?.id) return null;
  const cat = catalogoDe(env, deps)(dueño.id);
  return cat ? consultasDeCharla({ cat, charla, canal }) : null;
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
  const { cuentas, apps } = almacen(env, deps);
  if (url.pathname === '/api/instagram/conectar') {
    if ((url.searchParams.get('clave') ?? '') !== env.IG_CONECTAR_CLAVE) return html(paginaConectado({ ok: false, error: 'link inválido' }), 403);
    // `app`: la app de Instagram del cliente (registrada con el script); sin `app`, la del estudio.
    const app = await appDe(env, apps, url.searchParams.get('app') ?? '');
    if (!app) return html(paginaConectado({ ok: false, error: 'app desconocida' }), 404);
    return Response.redirect(await urlAutorizar(env, origen, now, app), 302);
  }
  // Vuelta de Instagram.
  const volver = `https://${env.NEGOCIOS_HOST || NEGOCIOS_HOST}/`;
  const code = url.searchParams.get('code');
  const estado = await leerEstado(env.IG_APP_SECRET, url.searchParams.get('state'), now);
  if (!code || !estado) {
    return html(paginaConectado({ ok: false, error: url.searchParams.get('error_reason') ? 'no aceptaste los permisos' : !estado ? 'el link venció o no es válido: volvé a apretar «Conectar Instagram»' : 'vuelta inválida', ...(estado?.negocio && { volver }) }), 400);
  }
  if (!cuentas) return html(paginaConectado({ ok: false, error: 'sin memoria' }), 503);
  const app = await appDe(env, apps, estado.app);
  if (!app) return html(paginaConectado({ ok: false, error: 'app desconocida' }), 404);
  try {
    const c = await conectarCuenta(env, { code, origen, now, app }, fetchImpl);
    // Conectada desde la app de negocios (estado con negocio) = cuenta de un cliente, aunque use la app del estudio:
    // responde solo con la ficha de su negocio, nunca con lo de Zustro Labs (ZL-140).
    const antes = await cuentas.get(c.id);
    await cuentas.put(c.id, { username: c.username, token: c.token, vence: c.vence, app: c.app, cliente: Boolean(estado.negocio) || antes?.cliente === true });
    console.log(JSON.stringify({ canal: 'ig', que: 'conectada', suscripta: c.suscripta, propia: app.id === String(env.IG_APP_ID), negocio: Boolean(estado.negocio) }));
    // Desde la app de negocios (ZL-137): la cuenta queda vinculada sola a ese negocio, con Instagram encendido.
    if (estado.negocio) {
      const { negocios } = almacen(env, deps);
      const n = await negocios?.get(estado.negocio);
      if (!n) return html(paginaConectado({ ok: false, error: 'ese negocio no existe', volver }), 404);
      const r = await negocios.guardar(n.id, { cuentas: [...new Set([...n.cuentas, c.id])], canales: { ...canalesDe(n), instagram: true }, invitacionIg: null });
      if (r?.error) return html(paginaConectado({ ok: false, error: r.error, volver }), 409);
    }
    return html(paginaConectado({ ok: true, username: c.username, suscripta: c.suscripta, ...(estado.negocio && { volver }) }));
  } catch (e) {
    console.log(JSON.stringify({ canal: 'ig', que: 'conectar', ok: false, error: String(e?.message ?? 'error').slice(0, 40) }));
    return html(paginaConectado({ ok: false, error: String(e?.message ?? 'error').slice(0, 40), ...(estado.negocio && { volver }) }), 502);
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
  // Instagram: el aviso puede venir firmado por la app del estudio o por la de un cliente.
  const secretos = canal.clave === 'ig' ? await secretosDe(env, almacen(env, deps).apps) : [canal.secreto(env)];
  const firma = request.headers.get('X-Hub-Signature-256');
  let firmada = false;
  for (const sec of secretos) if (await firmaValida(crudo, firma, sec)) { firmada = true; break; }
  if (!firmada) {
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
  // En Cloudflare (con waitUntil) se esperan las ráfagas; en las pruebas, no (salvo que la prueba lo pida).
  const trabajo = procesar(eventos, env, fetchImpl, { ...deps, rafagaMs: deps.rafagaMs ?? (ctx?.waitUntil ? RAFAGA_MS : 0) }, canal);
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
    const cuenta = ev.cuenta ? await cuentas?.get(ev.cuenta) : null;
    if (ev.cuenta && !cuenta && !(env.IG_ID && String(env.IG_ID) === ev.cuenta && env.IG_TOKEN)) {
      log({ ok: true, que: 'cuenta_desconocida' });
      continue;
    }
    // La cuenta de un cliente (conectada con su propia app) responde con SU ficha del negocio; sin ficha activa, no
    // responde nada (nunca como Zustro Labs). Sin panel: el negocio contesta desde su app mientras el asistente se calla.
    // La cuenta del estudio (ZL-124) usa la ficha y el catálogo de su negocio solo si está vinculada a uno y la ficha
    // está activa y sin errores; si no, responde como siempre, con lo de la landing. PERSONA sigue yendo al panel del equipo.
    const cliente = esCliente(env, cuenta);
    const fichaEstudio = !cliente && cuenta ? await fichaDelEstudio(a, ev.cuenta) : null;
    if (fichaEstudio?.motivo) log({ ok: fichaEstudio.motivo !== 'ficha_invalida', que: `estudio_${fichaEstudio.motivo}` });
    const negocio = cliente || Boolean(fichaEstudio?.texto);
    let perfil, preguntarEv = preguntar, charlasEv = charlas, pedidosEv = null, consultasEv = null, dueñoEv = null;
    if (negocio) {
      const f = cliente ? await a.fichas?.get(ev.cuenta) : fichaEstudio;
      if (!f?.texto || !f.activa) { log({ ok: true, que: f?.texto ? 'ficha_inactiva' : 'sin_ficha' }); continue; }
      const pf = parsearFicha(f.texto);
      if (!pf.ok) { log({ ok: false, que: 'ficha_invalida' }); continue; }
      perfil = perfilNegocio(pf.ficha);
      const dueño = await a.negocios?.deCuenta(ev.cuenta);
      dueñoEv = dueño;
      // El negocio eligió sus canales: con Instagram apagado, esta cuenta no responde.
      if (dueño && !canalesDe(dueño)[canal.clave === 'ig' ? 'instagram' : 'whatsapp']) { log({ ok: true, que: 'canal_apagado' }); continue; }
      preguntarEv = iaDeNegocio(env, deps, a, dueño, pf.ficha, 'Instagram');
      pedidosEv = pedidosDe(env, deps, dueño, pf.ficha, ev.from, 'ig');
      consultasEv = consultasDe(env, deps, dueño, ev.from, 'ig');
      if (cliente) charlasEv = null;
    }
    try {
      // Sin límites no se responde: son el freno al abuso y al gasto en IA.
      if (!env.LIMITE?.limit || !env.LIMITE_GLOBAL?.limit) { log({ ok: false, que: 'config' }); continue; }
      // Por persona: pasado el límite, silencio (contestar cada mensaje sería otra forma de abuso).
      if (!(await env.LIMITE.limit({ key: esInstagram(ev.from) ? ev.from : `wa:${ev.from}` })).success) { log({ ok: true, que: 'limite' }); continue; }
      // El de toda la cuenta (los dos canales juntos) se mira recién antes de gastar IA (no corta la atención humana ni BORRAR).
      const cupo = async () => ((await env.LIMITE_GLOBAL.limit({ key: 'ia' })).success ? 'ok' : 'global');
      // Un negocio: los mensajes seguidos van en uno solo (ZL-149).
      const listo = negocio ? await prepararEvento(ev, { deps, memoria: a.memoria, clave: ev.from }) : ev;
      if (!listo) { log({ ok: true, que: 'rafaga' }); continue; }
      const antes = negocio && dueñoEv ? await memoria?.get(ev.from) : null;
      const r = await atender(listo, { memoria, charlas: charlasEv, preguntar: preguntarEv, now, cupo, ...(perfil && { perfil }), pedidos: pedidosEv, consultas: consultasEv });
      for (const m of r.send) await mandar(m);
      if (negocio && dueñoEv) await despuesDeAtender(env, a, deps, fetchImpl, dueñoEv, antes, listo, r, now, ev.from);
      // ZL-153: el usuario de Instagram de la persona, una vez (al primer mensaje o cuando deja un pedido o una consulta),
      // para que el negocio vea en la app quién le escribió. Si Meta no lo da, la charla sigue igual.
      if (negocio && dueñoEv && memoria && esInstagram(ev.from) && !antes?.usuario && (!antes?.ultimo || r.pedido || r.consulta)) {
        const usuario = await nombreDe(env, ev.from, fetchImpl, cuentas).catch(() => null);
        const ahora = usuario ? await memoria.get(ev.from) : null;
        if (ahora) await memoria.put(ev.from, { ...ahora, usuario });
      }
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
      log({ ok: true, ms: Date.now() - t0, que: r.metrica, negocio, ...(fichaEstudio?.texto && { estudio: 'ficha' }), idioma: r.idioma, fuera: r.fuera, notas: r.notas, uso: r.uso, handoff: r.handoff, avisado, avisoError });
    } catch (e) {
      log({ ok: false, ms: Date.now() - t0, error: String(e?.message || 'error').slice(0, 60) });
      // El aviso de falla va en el idioma de la charla (si la memoria responde).
      const st = await Promise.resolve(memoria?.get(ev.from)).catch(() => null);
      const falla = perfil ? perfil.textos().falla : textos(st?.idioma).falla;
      await mandar(msgTexto(ev.from, falla)).catch(() => {});
    }
  }
}

/**
 * WhatsApp de un negocio por YCloud (ZL-135): un webhook por número (`/api/whatsapp/ycloud/<clave>`), firmado con el
 * secreto de ESE número. Responde 200 rápido y atiende aparte, con la ficha y los productos del negocio.
 */
async function webhookYCloud(request, env, ctx, deps, clave) {
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now();
  const log = (o) => console.log(JSON.stringify({ canal: 'yc', ...o }));
  if (request.method !== 'POST') return json({ error: 'usá POST' }, 405);
  if (!claveValida(clave)) return json({ error: 'no existe' }, 404);
  const a = almacen(env, deps);
  if (!a.ycloud) return json({ error: 'sin memoria' }, 503);
  const reg = await a.ycloud.get(clave);
  if (!reg) { log({ ok: true, que: 'numero_desconocido' }); return json({ error: 'no existe' }, 404); }
  if (Number(request.headers.get('content-length') ?? 0) > MAX_CUERPO) return json({ error: 'demasiado grande' }, 413);
  const crudo = await request.text();
  if (crudo.length > MAX_CUERPO) return json({ error: 'demasiado grande' }, 413);
  if (!(await firmaYCloud(crudo, request.headers.get('YCloud-Signature'), reg.secreto, now))) {
    log({ ok: false, que: 'firma' });
    return json({ error: 'firma inválida' }, 401);
  }
  let payload;
  try {
    payload = JSON.parse(crudo);
  } catch {
    return json({ error: 'pedido inválido' }, 400);
  }
  const eventos = leerYCloud(payload);
  log({ que: 'aviso', tipo: String(payload?.type ?? '').slice(0, 50), eventos: eventos.length });
  // Para el script: cuándo llegó el último mensaje (se guarda como mucho una vez por minuto).
  if (eventos.some((e) => !e.eco) && now - (reg.ultimo ?? 0) > 60_000) await a.ycloud.put(clave, { ultimo: now }).catch(() => {});
  const trabajo = procesarYCloud(eventos, env, fetchImpl, { ...deps, rafagaMs: deps.rafagaMs ?? (ctx?.waitUntil ? RAFAGA_MS : 0) }, reg);
  if (ctx?.waitUntil) ctx.waitUntil(trabajo);
  else await trabajo;
  return json({ ok: true }, 200);
}

async function procesarYCloud(eventos, env, fetchImpl, deps, reg) {
  const log = (o) => console.log(JSON.stringify({ canal: 'yc', ...o }));
  if (!eventos.length) return;
  const a = almacen(env, deps);
  const now = deps.now ?? Date.now();
  const mandar = (m) => enviarYCloud(reg.apiKey, m, fetchImpl);
  // Igual que una cuenta de Instagram de cliente: sin negocio, sin WhatsApp encendido o sin ficha activa, no responde.
  const dueño = await a.negocios?.get(reg.negocio);
  if (!dueño) { log({ ok: true, que: 'sin_negocio' }); return; }
  if (!canalesDe(dueño).whatsapp) { log({ ok: true, que: 'canal_apagado' }); return; }
  const f = await a.negocios.ficha(dueño.id);
  if (!f?.texto || !f.activa) { log({ ok: true, que: f?.texto ? 'ficha_inactiva' : 'sin_ficha' }); return; }
  const pf = parsearFicha(f.texto);
  if (!pf.ok) { log({ ok: false, que: 'ficha_invalida' }); return; }
  const perfil = perfilNegocio(pf.ficha);
  const preguntar = iaDeNegocio(env, deps, a, dueño, pf.ficha, 'WhatsApp');
  // La memoria guarda cada charla con los números normalizados: así el eco del dueño pausa la misma charla aunque Meta
  // escriba el número de la persona distinto (con o sin el 9). Para responder se usa el número tal como vino.
  const memoria = a.memoria && {
    get: (n) => a.memoria.get(claveMemoria(n)),
    put: (n, d) => a.memoria.put(claveMemoria(n), d),
    delete: (n) => a.memoria.delete(claveMemoria(n)),
    contar: (n) => a.memoria.contar(claveMemoria(n)),
    visto: (id) => a.memoria.visto(id),
  };

  for (const ev of eventos) {
    const t0 = Date.now();
    // Un webhook de YCloud recibe lo de TODOS los números de esa cuenta: solo se atiende el número conectado a este negocio.
    if (normalizar(numeroDeCharla(ev.from)) !== normalizar(reg.numero)) { log({ ok: true, que: 'otro_numero' }); continue; }
    if (!ev.ts || now - ev.ts * 1000 > MAX_EDAD_MS) { log({ ok: true, que: 'viejo' }); continue; }
    // El dueño contestó desde su app (coexistencia): el asistente se calla en esa charla las horas de pausa de la ficha.
    if (ev.eco) {
      if (memoria) {
        const estado = await memoria.get(ev.from);
        // Lo tomó el dueño: la pausa es la de la ficha y ya no vuelve el asistente a los 15 minutos (ZL-149).
        await memoria.put(ev.from, { ...(estado ?? {}), humanoHasta: now + (perfil.horasPausa ?? 12) * 3600_000, pase: 0 });
      }
      log({ ok: true, que: 'eco' });
      continue;
    }
    try {
      if (!env.LIMITE?.limit || !env.LIMITE_GLOBAL?.limit) { log({ ok: false, que: 'config' }); continue; }
      if (!(await env.LIMITE.limit({ key: ev.from })).success) { log({ ok: true, que: 'limite' }); continue; }
      const cupo = async () => ((await env.LIMITE_GLOBAL.limit({ key: 'ia' })).success ? 'ok' : 'global');
      const listo = await prepararEvento(ev, { deps, memoria: a.memoria, clave: claveMemoria(ev.from) });
      if (!listo) { log({ ok: true, que: 'rafaga' }); continue; }
      const antes = await memoria?.get(ev.from);
      const r = await atender(listo, { memoria, charlas: null, preguntar, now, cupo, perfil, pedidos: pedidosDe(env, deps, dueño, pf.ficha, ev.from, 'wa'), consultas: consultasDe(env, deps, dueño, ev.from, 'wa') });
      // Si el dueño contestó mientras la IA pensaba, su respuesta ganó: no se manda la del asistente. (Un pase al equipo
      // también pausa, pero ese aviso sí va: lo puso el propio asistente.)
      if (r.send.length && !['borrar', 'persona', 'humano'].includes(r.metrica) && !r.handoff && memoria) {
        const st = await memoria.get(ev.from);
        if (st?.humanoHasta && st.humanoHasta > now) { log({ ok: true, que: 'contesto_el_duenio' }); continue; }
      }
      for (const m of r.send) await mandar(m);
      await despuesDeAtender(env, a, deps, fetchImpl, dueño, antes, listo, r, now, ev.from);
      log({ ok: true, ms: Date.now() - t0, que: r.metrica, negocio: true, ...(r.pedido && { pedido: r.pedido }), ...(r.consulta && { consulta: r.consulta }), idioma: r.idioma, fuera: r.fuera, notas: r.notas, handoff: r.handoff });
    } catch (e) {
      log({ ok: false, ms: Date.now() - t0, error: String(e?.message || 'error').slice(0, 60) });
      const st = await Promise.resolve(memoria?.get(ev.from)).catch(() => null);
      await mandar(msgTexto(ev.from, perfil.textos(st?.idioma).falla)).catch(() => {});
    }
  }
}

/**
 * Números de WhatsApp de negocios por YCloud (lo que usa whatsapp-cliente.ps1):
 * - GET /ycloud → los números conectados (sin la clave ni el secreto).
 * - POST /ycloud {negocio, numero, apiKey} → crea el webhook en la cuenta de YCloud del negocio, guarda la clave y el
 *   secreto (nunca se devuelven) y enciende WhatsApp en ese negocio.
 * - DELETE /ycloud/<clave> → borra el webhook y el registro.
 */
async function adminYCloud(request, env, deps, ruta, url, now) {
  const a = almacen(env, deps);
  if (!a.ycloud || !a.negocios) return json({ error: 'sin memoria' }, 503);
  const d = { ycloud: a.ycloud, negocios: a.negocios, fetch: deps.fetch ?? fetch };
  if (request.method === 'GET' && ruta === '/ycloud') return json({ ok: true, numeros: await todosLosNumeros(a.ycloud) }, 200);
  if (request.method === 'POST' && ruta === '/ycloud') {
    let b;
    try { b = await request.json(); } catch { return json({ error: 'pedido inválido' }, 400); }
    const dueño = await a.negocios.get(String(b?.negocio ?? ''));
    if (!dueño) return json({ error: 'ese negocio no existe' }, 404);
    const r = await conectarWhatsApp(d, dueño, b);
    return json(r.datos, r.status);
  }
  const m = /^\/ycloud\/([0-9a-f]{24})$/.exec(ruta);
  if (request.method === 'DELETE' && m) {
    const r = await desconectarWhatsApp(d, m[1]);
    return json(r.datos, r.status);
  }
  return json({ error: 'no existe' }, 404);
}

/** La cuenta es de un cliente si se conectó con una app que no es la del estudio, o desde la app de negocios (ZL-140). */
export const esCliente = (env, cuenta) => cuenta?.cliente === true || Boolean(cuenta?.app && cuenta.app !== String(env.IG_APP_ID ?? ''));

/**
 * La ficha que usa la cuenta del estudio (ZL-124): la de su negocio, si está vinculada a uno y la ficha está activa y
 * sin errores. Si no, {motivo} (o null sin negocio) y la cuenta responde con lo de la landing, como siempre: nunca muda.
 */
async function fichaDelEstudio(a, cuenta) {
  if (!a.negocios || !a.fichas) return null;
  const dueño = await a.negocios.deCuenta(cuenta);
  if (!dueño) return null;
  // Con Instagram apagado en ese negocio, la del estudio vuelve a lo de la landing (un cliente, en cambio, se calla).
  if (!canalesDe(dueño).instagram) return { motivo: 'canal_apagado' };
  const f = await a.fichas.get(cuenta);
  if (!f?.texto) return { motivo: 'sin_ficha' };
  if (!f.activa) return { motivo: 'ficha_inactiva' };
  if (!parsearFicha(f.texto).ok) return { motivo: 'ficha_invalida' };
  return f;
}

/**
 * Charla de prueba con una ficha (y los productos del negocio, si se sabe cuál), sin tocar la memoria real ni mandar nada.
 * `estado`: lo que devolvió la prueba anterior ({idioma, humanoHasta}), para seguir la misma charla en la app (ZL-126).
 * Devuelve {charla, estado}.
 */
async function probarFicha(env, ficha, mensajes, deps, negocioId = null, estado = null) {
  const memoria = adaptadores(crearAtencion(almacenPrueba())).memoria;
  const DE = 'ig:0.0';
  const previo = estadoDePrueba(estado);
  if (previo) await memoria.put(DE, previo);
  const perfil = perfilNegocio(ficha);
  const catalogo = consultaCatalogo(env, deps, negocioId, ficha);
  const preguntar = deps.preguntarNegocio ? deps.preguntarNegocio(ficha, catalogo) : preguntadorNegocio(env, ficha, { catalogo });
  const now = deps.now ?? Date.now();
  const charla = [];
  for (const [i, texto] of mensajes.entries()) {
    const ev = { id: `prueba-${i}`, from: DE, ts: now / 1000, kind: 'text', text: texto };
    try {
      const r = await atender(ev, { memoria, charlas: null, preguntar, now: now + i, perfil });
      charla.push({ mensaje: texto, respuestas: r.send.map((m) => m.text?.body ?? ''), que: r.metrica, notas: r.notas ?? [] });
    } catch (e) {
      charla.push({ mensaje: texto, respuestas: [perfil.textos((await memoria.get(DE))?.idioma).falla], que: 'error', notas: [String(e?.message ?? 'error').slice(0, 40)] });
    }
  }
  return { charla, estado: estadoDePrueba(await memoria.get(DE)) };
}

/** Lo que se guarda entre mensajes de la charla de prueba: el idioma, la pausa y la memoria corta (ZL-146). */
function estadoDePrueba(e) {
  if (!e || typeof e !== 'object') return null;
  const idioma = ['es', 'en', 'hr'].includes(e.idioma) ? e.idioma : undefined;
  const humanoHasta = Number.isFinite(e.humanoHasta) ? e.humanoHasta : 0;
  // ZL-146: también la memoria corta, para que la charla de prueba se comporte como la real (la memoria la vuelve a
  // filtrar al guardarla: solo campos conocidos y cortos).
  const { hist, histT, nombre, resumen, interes, ultimo, consulta } = e;
  return { ...(idioma && { idioma }), humanoHasta, ...(Array.isArray(hist) && { hist: hist.slice(-8), histT }), ...(nombre && { nombre }), ...(resumen && { resumen }), ...(interes && { interes }), ...(ultimo && { ultimo }), ...(consulta && { consulta }) };
}

const leerFicha = async (request) => {
  try {
    const b = await request.json();
    return { texto: String(b?.texto ?? ''), activa: b?.activa === true, mensajes: Array.isArray(b?.mensajes) ? b.mensajes : null, cuenta: b?.cuenta ?? null, negocio: b?.negocio ?? null };
  } catch {
    return null;
  }
};

/** Agregar correos a la política de Access de la app de negocios (ZL-138), o null si no hay token de Cloudflare. */
export const accesoDe = (env, deps) => (emails) => agregarAAcceso(env, deps.fetch ?? fetch, env.NEGOCIOS_HOST || NEGOCIOS_HOST, emails);

/** GET|PUT /api/instagram/admin/negocios/<id>/ficha: la ficha del NEGOCIO (sirve sin Instagram, ZL-138). */
async function fichaDeNegocio(request, env, deps, id) {
  const { negocios } = almacen(env, deps);
  const n = await negocios.get(id);
  if (!n) return json({ error: 'no existe ese negocio' }, 404);
  if (request.method === 'GET') {
    const f = await negocios.ficha(id);
    return f?.texto ? json({ ok: true, texto: f.texto, activa: Boolean(f.activa), ...resumenFicha(parsearFicha(f.texto)) }, 200) : json({ error: 'sin ficha' }, 404);
  }
  if (request.method !== 'PUT') return json({ error: 'usá GET o PUT' }, 405);
  const b = await leerFicha(request);
  if (!b) return json({ error: 'pedido inválido' }, 400);
  const pf = parsearFicha(b.texto);
  if (!pf.ok) return json(resumenFicha(pf), 400);
  if (b.activa && pf.pendientes.length) return json({ ...resumenFicha(pf), error: 'faltan completar cosas: la ficha se guarda solo apagada' }, 400);
  await negocios.guardarFicha(id, { texto: b.texto, activa: b.activa, nombre: pf.ficha.nombre });
  console.log(JSON.stringify({ canal: 'negocio', que: 'ficha', activa: b.activa }));
  return json({ ...resumenFicha(pf), activa: b.activa, negocio: n.nombre }, 200);
}

/** GET /api/instagram/admin/negocios/<id>/verificar: el semáforo del negocio, con una charla de prueba (ZL-138). */
async function verificar(env, deps, id, now) {
  const r = await datosVerificar(env, deps, id, now);
  return r ? json(r, 200) : json({ error: 'no existe ese negocio' }, 404);
}

/** El semáforo de un negocio. `charla: false` no corre la charla de prueba (lo que ve el negocio, ZL-150). */
async function datosVerificar(env, deps, id, now, { charla: conCharla = true } = {}) {
  const a = almacen(env, deps);
  const fetchImpl = deps.fetch ?? fetch;
  const negocio = await a.negocios.get(id);
  if (!negocio) return null;
  const f = await a.negocios.ficha(id);
  const pf = f?.texto ? parsearFicha(f.texto) : null;
  const ficha = { tiene: Boolean(f?.texto), valida: Boolean(pf?.ok), activa: Boolean(f?.activa), errores: pf?.errores ?? [], pendientes: pf?.pendientes ?? [] };
  const cuentas = [];
  for (const cid of negocio.cuentas ?? []) {
    const c = await a.cuentas.get(cid);
    cuentas.push({ id: cid, username: c?.username ?? null, conectada: Boolean(c?.token), venceEnDias: c?.vence ? Math.floor((c.vence - now) / 86_400_000) : null });
  }
  const numeros = [];
  for (const r of ((await a.ycloud?.list?.()) ?? []).filter((x) => x.negocio === id)) {
    numeros.push({ clave: r.clave, numero: r.numero, ecos: r.ecos, ultimo: r.ultimo ?? null, webhook: await webhookDeYCloud(r.apiKey, r.endpointId, fetchImpl) });
  }
  let productos = null;
  try {
    const cat = catalogoDe(env, deps)(id);
    const r = cat ? await cat.ejecutar('resumen', []) : null;
    productos = r?.ok ? r.valor : null;
  } catch { productos = null; }
  const acceso = await correosEnAcceso(env, fetchImpl, env.NEGOCIOS_HOST || NEGOCIOS_HOST);
  let charla = null;
  if (conCharla && ficha.valida && ficha.activa && !ficha.pendientes.length) {
    const varios = (pf.ficha.idiomas?.length ?? 1) > 1;
    charla = (await probarFicha(env, pf.ficha, mensajesDePrueba(varios), deps, id)).charla;
  }
  const r = verificarNegocio({ negocio: { ...negocio, canales: canalesDe(negocio) }, ficha, cuentas, numeros, productos, acceso, charla, now });
  console.log(JSON.stringify({ canal: 'negocio', que: 'verificar', verde: r.verde, mal: r.controles.filter((x) => x.estado === 'mal').map((x) => x.id) }));
  return { negocio: { id, nombre: negocio.nombre }, ...r, charla };
}

/**
 * Administración de Instagram para el script scripts/instagram-cliente.ps1 (Bearer IG_ADMIN_CLAVE):
 * - GET  /api/instagram/admin/estado  → qué está configurado, apps y cuentas (sin secretos ni tokens);
 * - POST /api/instagram/admin/apps    → registra la app de Instagram de un cliente {id, secreto, nombre};
 * - DELETE /api/instagram/admin/apps/<id> → la quita (y las cuentas conectadas con ella);
 * - DELETE /api/instagram/admin/cuentas/<id> → desconecta una cuenta.
 * Negocios (ZL-122, para scripts/cliente-nuevo.ps1): los mismos de la app negocios.zustrolabs.com:
 * - GET /api/instagram/admin/negocios · POST /api/instagram/admin/negocios {nombre, emails, canales}
 * - PUT /api/instagram/admin/negocios/<id> {nombre, emails, canales, cuentas, limiteDia}
 * Fichas del negocio (ZL-113):
 * - POST /api/instagram/admin/ficha/revisar {texto} → errores, lo que falta completar y el menú (no guarda nada);
 * - POST /api/instagram/admin/ficha/probar {texto, mensajes[]} → charla de prueba con esa ficha (no guarda ni manda);
 * - GET|PUT|DELETE /api/instagram/admin/cuentas/<id>/ficha → ver, cargar {texto, activa} o borrar la ficha de una cuenta.
 */
async function admin(request, env, deps) {
  const url = new URL(request.url);
  if (!env.IG_ADMIN_CLAVE) return json({ error: 'sin configurar' }, 503);
  const auth = request.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${env.IG_ADMIN_CLAVE}`) return json({ error: 'sin acceso' }, 401);
  const { cuentas, apps, fichas } = almacen(env, deps);
  if (!cuentas || !apps) return json({ error: 'sin memoria' }, 503);
  const now = deps.now ?? Date.now();
  const ruta = url.pathname.replace('/api/instagram/admin', '');

  if (ruta === '/negocios' || ruta.startsWith('/negocios/')) {
    const a = almacen(env, deps);
    if (!a.negocios) return json({ error: 'sin memoria' }, 503);
    const mf = /^\/negocios\/([a-z0-9]{4,40})\/(ficha|verificar|instagram-link)$/.exec(ruta);
    if (mf?.[2] === 'ficha') return fichaDeNegocio(request, env, deps, mf[1]);
    if (mf?.[2] === 'verificar') return verificar(env, deps, mf[1], now);
    if (mf?.[2] === 'instagram-link' && request.method === 'POST') {
      // El link de «Conectar Instagram» con la app compartida para ese negocio (ZL-137/138), para mandárselo al cliente.
      if (!(await a.negocios.get(mf[1]))) return json({ error: 'no existe ese negocio' }, 404);
      const app = await appCompartida(apps, env);
      if (!app || !env.IG_APP_SECRET) return json({ error: 'todavía no hay app compartida: corré instagram-app-clientes.ps1' }, 503);
      return json({ url: await urlAutorizar(env, 'https://zustrolabs.com', now, app, mf[1]), app: app.id }, 200);
    }
    return administrar(request, ruta, { ...a, esCliente: (c) => esCliente(env, c), acceso: accesoDe(env, deps) }, now);
  }
  if (ruta === '/ycloud' || ruta.startsWith('/ycloud/')) return adminYCloud(request, env, deps, ruta, url, now);
  if (request.method === 'GET' && ruta === '/estado') {
    const listaApps = (await apps.list()).map((a) => ({ id: a.id, nombre: a.nombre, compartida: Boolean(a.compartida), creado: a.creado }));
    const compartida = await appCompartida(apps, env);
    const listaCuentas = [];
    for (const c of await cuentas.list()) {
      const cli = esCliente(env, c);
      const negocio = (await almacen(env, deps).negocios?.deCuenta(c.id))?.id ?? null;
      // La del estudio sin negocio responde con lo de la landing («estudio»); vinculada a uno, con su ficha (ZL-124).
      const f = cli || negocio ? await fichas?.get(c.id) : null;
      const pf = f?.texto ? parsearFicha(f.texto) : null;
      listaCuentas.push({
        id: c.id, username: c.username, app: c.app || String(env.IG_APP_ID ?? ''), tokenVenceEnDias: Math.floor((c.vence - now) / 86_400_000),
        negocio,
        ...(!cli && { estudio: true }),
        ficha: cli || negocio ? { tiene: Boolean(f?.texto), activa: Boolean(f?.activa), nombre: pf?.ficha?.nombre ?? null, pendientes: pf?.pendientes ?? [] } : 'estudio',
      });
    }
    return json({
      ok: true,
      configurado: { app_estudio: Boolean(env.IG_APP_ID && env.IG_APP_SECRET), verify: Boolean(env.IG_VERIFY_TOKEN), link: Boolean(env.IG_CONECTAR_CLAVE), ia: Boolean(env.ANTHROPIC_API_KEY), aviso: Boolean(env.AVISO_PARA), panel: panelListo(env) },
      app_estudio: env.IG_APP_ID ? String(env.IG_APP_ID) : null,
      // La app con la que se conectan los clientes (ZL-140): la compartida registrada o, si no hay, la del estudio.
      app_clientes: compartida?.id ?? null,
      apps: listaApps,
      cuentas: listaCuentas,
    }, 200);
  }
  if (request.method === 'POST' && ruta === '/apps') {
    let b;
    try { b = await request.json(); } catch { return json({ error: 'pedido inválido' }, 400); }
    const id = String(b?.id ?? '').trim();
    const secreto = String(b?.secreto ?? '').trim();
    const nombre = String(b?.nombre ?? '').trim();
    if (!/^\d{6,20}$/.test(id)) return json({ error: 'id inválido (solo dígitos)' }, 400);
    if (secreto.length < 16) return json({ error: 'secreto muy corto' }, 400);
    if (!nombre) return json({ error: 'falta el nombre del cliente' }, 400);
    if (String(env.IG_APP_ID ?? '') === id) return json({ error: 'esa es la app del estudio' }, 400);
    await apps.put(id, { secreto, nombre, compartida: b?.compartida === true });
    console.log(JSON.stringify({ canal: 'ig', que: 'app_registrada' }));
    return json({ ok: true, id, nombre, conectar: `https://${url.host}/api/instagram/conectar?clave=<IG_CONECTAR_CLAVE>&app=${id}` }, 200);
  }
  let m = /^\/apps\/(\d+)$/.exec(ruta);
  if (request.method === 'DELETE' && m) {
    await apps.delete(m[1]);
    let borradas = 0;
    for (const c of await cuentas.list()) if (c.app === m[1]) { await cuentas.delete(c.id); borradas++; }
    return json({ ok: true, cuentasDesconectadas: borradas }, 200);
  }
  if (request.method === 'POST' && (ruta === '/ficha/revisar' || ruta === '/ficha/probar')) {
    const b = await leerFicha(request);
    if (!b) return json({ error: 'pedido inválido' }, 400);
    const pf = parsearFicha(b.texto);
    if (ruta === '/ficha/revisar' || !pf.ok) return json({ ...resumenFicha(pf) }, pf.ok ? 200 : 400);
    const mensajes = (b.mensajes ?? ['hola']).map((x) => String(x).slice(0, 500)).filter(Boolean).slice(0, 12);
    const dueño = b.negocio ? await almacen(env, deps).negocios?.get(String(b.negocio)) : b.cuenta ? await almacen(env, deps).negocios?.deCuenta(String(b.cuenta)) : null;
    return json({ ...resumenFicha(pf), ...(await probarFicha(env, pf.ficha, mensajes, deps, dueño?.id ?? null)) }, 200);
  }
  m = /^\/cuentas\/(\d+)\/ficha$/.exec(ruta);
  if (m) {
    if (!fichas) return json({ error: 'sin memoria' }, 503);
    const c = await cuentas.get(m[1]);
    if (!c) return json({ error: 'esa cuenta no está conectada: conectala primero' }, 404);
    // La del estudio puede tener ficha solo si ya está vinculada a un negocio (en la app): así nunca se crea un negocio solo.
    if (!esCliente(env, c) && !(await almacen(env, deps).negocios?.deCuenta(c.id))) {
      return json({ error: 'es la cuenta del estudio: vinculala a un negocio en negocios.zustrolabs.com (Administración) para darle una ficha' }, 400);
    }
    if (request.method === 'GET') {
      const f = await fichas.get(m[1]);
      return f ? json({ ok: true, texto: f.texto, activa: f.activa, actualizada: f.actualizada, ...resumenFicha(parsearFicha(f.texto)) }, 200) : json({ error: 'sin ficha' }, 404);
    }
    if (request.method === 'DELETE') {
      await fichas.delete(m[1]);
      return json({ ok: true }, 200);
    }
    if (request.method === 'PUT') {
      const b = await leerFicha(request);
      if (!b) return json({ error: 'pedido inválido' }, 400);
      const pf = parsearFicha(b.texto);
      if (!pf.ok) return json(resumenFicha(pf), 400);
      if (b.activa && pf.pendientes.length) return json({ ...resumenFicha(pf), error: 'faltan completar cosas: la ficha se guarda solo apagada' }, 400);
      await fichas.put(m[1], { texto: b.texto, activa: b.activa, nombre: pf.ficha.nombre });
      console.log(JSON.stringify({ canal: 'ig', que: 'ficha', activa: b.activa }));
      return json({ ...resumenFicha(pf), activa: b.activa, cuenta: c.username }, 200);
    }
  }
  m = /^\/cuentas\/(\d+)$/.exec(ruta);
  if (request.method === 'DELETE' && m) {
    await cuentas.delete(m[1]);
    return json({ ok: true }, 200);
  }
  return json({ error: 'no existe' }, 404);
}

export default {
  async fetch(request, env, ctx, deps = {}) {
    const fetchImpl = deps.fetch ?? fetch;
    const url = new URL(request.url);
    if (url.hostname === (env.NEGOCIOS_HOST || NEGOCIOS_HOST)) {
      const a = almacen(env, deps);
      return appNegocios(request, env, {
        ...a, fetch: fetchImpl, now: deps.now, catalogo: catalogoDe(env, deps), esCliente: (c) => esCliente(env, c),
        probar: (ficha, negocioId, mensajes, estado) => probarFicha(env, ficha, mensajes, deps, negocioId, estado),
        avisarComprador: (negocio, charla, texto) => avisarComprador(env, a, negocio, charla, texto, fetchImpl),
        charlasNegocio: pausasDeCharla(a, deps.now),
        verificar: (id, op) => datosVerificar(env, deps, id, deps.now ?? Date.now(), op),
        ...(deps.llamarWeb && { llamarWeb: deps.llamarWeb }),
        avisarCelulares: (id, aviso) => avisarNegocio(a, id, aviso, fetchImpl, deps.now ?? Date.now()),
        reporte: { armarReporte, xlsx },
      });
    }
    if (url.hostname === (env.PANEL_HOST || PANEL_HOST)) {
      const a = almacen(env, deps);
      return panel(request, env, { fetch: fetchImpl, now: deps.now, store: a.memoria, chats: a.charlas, send: (e, m) => mandarA(e, m, fetchImpl, a.cuentas) });
    }
    if (url.pathname === '/api/whatsapp') return webhook(request, env, ctx, deps, CANALES.wa);
    if (url.pathname.startsWith('/api/whatsapp/ycloud/')) return webhookYCloud(request, env, ctx, deps, url.pathname.slice('/api/whatsapp/ycloud/'.length));
    if (url.pathname === '/api/instagram') return webhook(request, env, ctx, deps, CANALES.ig);
    if (url.pathname === '/api/instagram/conectar' || url.pathname === '/api/instagram/conectar/vuelta') return conectar(request, env, deps);
    if (url.pathname.startsWith('/api/instagram/admin/')) return admin(request, env, deps);
    return json({ error: 'no existe' }, 404);
  },

  /** Cron diario: renueva los tokens de Instagram que están por vencer y comprueba que cada cuenta siga suscripta. */
  async scheduled(evento, env, _ctx, deps = {}) {
    // Cada 10 minutos (ZL-151): los recordatorios con permiso. Una vez por día: el mantenimiento de Instagram.
    if (evento?.cron === '*/10 * * * *') return seguimientos(env, deps, deps.now ?? Date.now());
    const fetchImpl = deps.fetch ?? fetch;
    const { cuentas } = almacen(env, deps);
    if (!cuentas) { console.log(JSON.stringify({ canal: 'ig', que: 'mantenimiento', error: 'sin memoria' })); return []; }
    const r = await mantenerCuentas(env, cuentas, fetchImpl, deps.now ?? Date.now()).catch((e) => [{ error: String(e?.name ?? 'Error').slice(0, 40) }]);
    console.log(JSON.stringify({ canal: 'ig', que: 'mantenimiento', cuentas: r }));
    return r;
  },
};
