// App de los negocios clientes (ZL-121), en negocios.zustrolabs.com, detrás de su propia app de Cloudflare Access.
// - Entra quien Access deja pasar (código por mail). Acá se decide qué ve: el equipo (PANEL_EMAILS) ve todos los
//   negocios y administra; cada persona de un negocio ve SOLO los negocios donde está su correo.
// - Cada negocio tiene su base (Durable Object «Catalogo»): productos, stock con historial, fotos, importación.
// - La ficha del asistente la edita solo el equipo (decisión del 3/11/2026); el negocio ve si está activo.
// - Los cambios piden la cabecera «x-zl: 1» y el mismo origen: otra página no puede mandar pedidos con la sesión.
// No importa nada de Cloudflare: el catálogo y el registro llegan en `deps` (index.js), así se prueba con node.

import { correosDe, emailDeAcceso } from './panel.js';
import { borrarWebhook, claveNueva, crearWebhook, normalizar, numeroE164 } from './ycloud.js';
import { appDelEstudio, urlAutorizar } from './instagram.js';
import { agregarAAcceso, quitarDeAcceso } from './acceso.js';
import { ajustesDeVenta, configComentarios, esDueño, limiteDiaDe } from './atencion.js';
import { parsearFicha, resumenFicha } from './negocio.js';
import { armarDesdeWeb, camposDeFicha, CHARLAS_DE_PRUEBA, evaluarPrueba, fichaDeCampos, PLANTILLAS, revisarFicha } from './fichas-editor.js';
import { APP_CSS, APP_HTML, appJs } from './negocios-ui.js';
import { ICONO_SVG, MANIFIESTO, suscripcionValida, SW_JS } from './push.js';
import { diaLocal, ZONAS } from './reporte.js';
import { ajustesConMiNegocio, cuandoResponden, estadoAhora, feriados, instanteEnZona, mapaDe, normalizarMiNegocio, paisDeZona, pesos, tieneHorarios } from './minegocio.js';

export const NEGOCIOS_HOST = 'negocios.zustrolabs.com';
/** ZL-158: Meta da 1.000 mensajes de servicio gratis por número por mes (desde el 1/10/2026); la app avisa a los 800. */
export const GRATIS_WA_MES = 1000;
export const AVISO_WA_MES = 800;
/** ZL-159: mensajes de la charla de prueba por día para el dueño (gastan IA). */
export const PRUEBAS_DIA = 40;
const MAX_JSON = 2_000_000;
const SEGURIDAD = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  // manifest-src y worker-src (ZL-151, ZL-152): la app instalable y los avisos al celular.
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};
/** Canales del negocio; los negocios creados antes de ZL-122 tienen solo Instagram. */
export const canalesDe = (n) => n?.canales ?? { instagram: true, whatsapp: false };

const resp = (cuerpo, status, tipo, extra = {}) => new Response(cuerpo, { status, headers: { 'content-type': tipo, ...SEGURIDAD, ...extra } });
const json = (data, status = 200) => resp(JSON.stringify(data), status, 'application/json; charset=utf-8');
const error = (mensaje, status = 400, campo) => json({ error: mensaje, ...(campo && { campo }) }, status);

/**
 * Lo que se le manda al comprador cuando el negocio cambia el estado de su pedido (texto fijo, sin IA). ZL-163: en el
 * idioma de su charla y con el nombre del negocio igual que en la charla (el de la ficha).
 */
const ESTADO_TEXTOS = {
  es: { aceptado: (neg, n) => `¡Listo! ${neg} aceptó tu pedido ${n}.`, pago: 'Cómo pagar', envio: 'Envío', retiro: 'Retiro', dudas: 'Cualquier duda, escribinos por acá.', coordinar: 'En un rato te escriben por acá para coordinar el pago y la entrega.',
    rechazado: (neg, n, p) => `Lo siento: ${neg} no puede tomar tu pedido ${n}${p}.`, pagado: (neg, n) => `${neg} recibió el pago de tu pedido ${n}. ¡Gracias!`,
    entregado: (neg, n) => `¡Tu pedido ${n} ya está entregado! Gracias por comprarle a ${neg} 😊`, cancelado: (neg, n, p) => `Tu pedido ${n} fue cancelado${p}.`,
    vencido: (neg, n) => `Tu pedido ${n} se canceló porque no se registró el pago a tiempo. Si ya pagaste o lo querés igual, escribinos por acá y lo vemos.`, num: (x) => `N.º ${x}`, sinCargo: 'sin cargo', totalEnvio: 'total con envío' },
  en: { aceptado: (neg, n) => `Done! ${neg} accepted your order ${n}.`, pago: 'How to pay', envio: 'Delivery', retiro: 'Pick-up', dudas: 'Any questions, write to us here.', coordinar: 'They’ll write to you here shortly to arrange payment and delivery.',
    rechazado: (neg, n, p) => `Sorry: ${neg} can’t take your order ${n}${p}.`, pagado: (neg, n) => `${neg} received the payment for your order ${n}. Thank you!`,
    entregado: (neg, n) => `Your order ${n} has been delivered! Thanks for buying from ${neg} 😊`, cancelado: (neg, n, p) => `Your order ${n} was cancelled${p}.`,
    vencido: (neg, n) => `Your order ${n} was cancelled because the payment wasn’t registered in time. If you already paid or still want it, write to us here.`, num: (x) => `no. ${x}`, sinCargo: 'free', totalEnvio: 'total with delivery' },
  hr: { aceptado: (neg, n) => `Gotovo! ${neg} je prihvatio vašu narudžbu ${n}.`, pago: 'Plaćanje', envio: 'Dostava', retiro: 'Preuzimanje', dudas: 'Za sva pitanja pišite nam ovdje.', coordinar: 'Uskoro će vam se javiti ovdje radi plaćanja i preuzimanja.',
    rechazado: (neg, n, p) => `Žao nam je: ${neg} ne može prihvatiti vašu narudžbu ${n}${p}.`, pagado: (neg, n) => `${neg} je primio uplatu za narudžbu ${n}. Hvala!`,
    entregado: (neg, n) => `Vaša narudžba ${n} je isporučena! Hvala što kupujete kod ${neg} 😊`, cancelado: (neg, n, p) => `Vaša narudžba ${n} je otkazana${p}.`,
    vencido: (neg, n) => `Vaša narudžba ${n} je otkazana jer uplata nije zabilježena na vrijeme. Ako ste već platili ili je i dalje želite, pišite nam ovdje.`, num: (x) => `br. ${x}`, sinCargo: 'besplatno', totalEnvio: 'ukupno s dostavom' },
};
export function textoEstado(p, estado, motivo, negocio, ajustes = null, idioma = 'es') {
  const T = ESTADO_TEXTOS[idioma] ?? ESTADO_TEXTOS.es;
  const n = T.num(p.numero);
  const porque = motivo ? ` (${motivo})` : '';
  if (estado === 'aceptado') {
    // ZL-148: con los ajustes de venta, el comprador recibe en el mismo mensaje cómo pagar y cómo se entrega: el negocio
    // no tiene que escribir nada a mano.
    const aj = ajustes ?? {};
    const envio = p.comprador?.entrega === 'envio';
    const partes = [T.aceptado(negocio, n)];
    // ZL-164: con las formas de pago de «Mi negocio», acá sí va el alias (a la IA no se le da).
    if (aj.pago) partes.push(`${T.pago}: ${aj.pago}`);
    // La zona y el costo que calculó el código al cerrar el pedido; si no, el texto de «Cómo vendés».
    if (envio && p.comprador?.zona) partes.push(`${T.envio}: ${p.comprador.zona} (${p.comprador.envio ? pesos(p.comprador.envio) : T.sinCargo})${p.total && p.comprador.envio ? ` · ${T.totalEnvio}: ${pesos(Math.round((p.total + p.comprador.envio) * 100) / 100)}` : ''}`);
    else if (envio && aj.envio) partes.push(`${T.envio}: ${aj.envio}`);
    if (!envio && aj.retiro) partes.push(`${T.retiro}: ${aj.retiro}${aj.mapa ? `\n${aj.mapa}` : ''}`);
    partes.push(aj.pago || (envio ? aj.envio || p.comprador?.zona : aj.retiro) ? T.dudas : T.coordinar);
    return partes.join('\n');
  }
  if (['rechazado', 'pagado', 'entregado', 'cancelado', 'vencido'].includes(estado)) return T[estado](negocio, n, porque);
  return null;
}

/** ZL-163: el nombre del negocio como lo dice el asistente (el de la ficha); si no hay ficha, el de la app. */
async function nombreDeFicha(deps, negocio) {
  const f = await deps.negocios.ficha(negocio.id).catch(() => null);
  const pf = f?.texto ? parsearFicha(f.texto) : null;
  return pf?.ok ? pf.ficha.nombre : negocio.nombre;
}

/** ZL-166: sacar correos de Access, protegiendo al equipo y a los que siguen en algún negocio. */
const quitarAccesoDe = (env, deps) => async (emails) => {
  const otros = (await deps.negocios.list()).flatMap((n) => n.emails ?? []);
  const equipo = String(env.PANEL_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return quitarDeAcceso(env, deps.fetch ?? fetch, env.NEGOCIOS_HOST || NEGOCIOS_HOST, emails, [...otros, ...equipo]);
};

const leerCanales = (c) => ({ ...(typeof c?.instagram === 'boolean' && { instagram: c.instagram }), ...(typeof c?.whatsapp === 'boolean' && { whatsapp: c.whatsapp }) });

const PAGINA_SIN_CONFIGURAR = `<!doctype html><html lang="es"><meta charset="utf-8"><title>Negocios · Zustro Labs</title><body style="font-family:system-ui;padding:2rem"><h1>Todavía no está configurado</h1><p>Falta la app de Cloudflare Access de negocios.zustrolabs.com (ver whatsapp/NEGOCIOS.md).</p></body></html>`;

async function leerJson(request) {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_JSON) return null;
  const t = await request.text();
  if (t.length > MAX_JSON) return null;
  try { return JSON.parse(t); } catch { return null; }
}

/** El resultado de una operación del catálogo: {ok, valor} → valor; {ok: false} → respuesta de error. */
const delCatalogo = (r) => (r?.ok ? { valor: r.valor } : { resp: error(r?.error ?? 'no se pudo', 400, r?.campo) });

/**
 * deps: {negocios (registro), cuentas (Instagram conectadas), catalogo(idNegocio) → {ejecutar(op, args)},
 *        probar(ficha, idNegocio, mensajes) → charla simulada, fetch, now}
 */
// ── WhatsApp por YCloud (ZL-135, ZL-136): lo usan la app (el negocio, con su correo) y el admin del equipo ──
const sinSecretos = (r) => ({ clave: r.clave, negocio: r.negocio, numero: r.numero, ecos: r.ecos, creado: r.creado, ultimo: r.ultimo || null, ultimoEco: r.ultimoEco || null });

/** Los números de WhatsApp de un negocio (sin la clave de API ni el secreto). */
export const numerosDe = async (ycloud, negocioId) => (await ycloud.list()).filter((r) => r.negocio === negocioId).map(sinSecretos);
export const todosLosNumeros = async (ycloud) => (await ycloud.list()).map(sinSecretos);

/**
 * Conecta el número de WhatsApp Business de un negocio a través de SU cuenta de YCloud: crea en esa cuenta el webhook
 * hacia este Worker, guarda la clave y el secreto (nunca se devuelven) y enciende WhatsApp en el negocio.
 * → {status, datos}
 */
// El webhook va SIEMPRE a zustrolabs.com: negocios. y equipo. están detrás de Cloudflare Access y YCloud recibiría la
// página de inicio de sesión (con 200), sin que el mensaje llegue nunca al asistente (pasó el 10/11/2026).
export const WEBHOOK_ORIGEN = 'https://zustrolabs.com';

export async function conectarWhatsApp({ ycloud, negocios, fetch: fetchImpl = fetch }, negocio, cuerpo) {
  const numero = numeroE164(cuerpo?.numero);
  if (!numero) return { status: 400, datos: { error: 'el número va con código de país, por ejemplo +5493411234567' } };
  const apiKey = String(cuerpo?.apiKey ?? '').trim();
  if (apiKey.length < 16 || /\s/.test(apiKey)) return { status: 400, datos: { error: 'la clave de API parece incompleta: copiala entera' } };
  if ((await ycloud.list()).some((r) => normalizar(r.numero) === normalizar(numero))) {
    return { status: 409, datos: { error: 'ese número ya está conectado: para volver a conectarlo, desconectalo primero' } };
  }
  const clave = claveNueva();
  let wh;
  try {
    wh = await crearWebhook(apiKey, `${WEBHOOK_ORIGEN}/api/whatsapp/ycloud/${clave}`, fetchImpl);
  } catch (e) {
    console.log(JSON.stringify({ canal: 'yc', que: 'conectar', ok: false, error: String(e?.message ?? 'error').slice(0, 60) }));
    return { status: 502, datos: { error: String(e?.message ?? 'no se pudo crear el webhook en YCloud') } };
  }
  await ycloud.put(clave, { negocio: negocio.id, numero, apiKey, secreto: wh.secreto, endpointId: wh.id, ecos: wh.ecos });
  await negocios.guardar(negocio.id, { canales: { ...canalesDe(negocio), whatsapp: true } });
  console.log(JSON.stringify({ canal: 'yc', que: 'numero_conectado', ecos: wh.ecos }));
  return { status: 200, datos: { ok: true, clave, numero, negocio: negocio.id, ecos: wh.ecos } };
}

/** Desconecta un número: borra el webhook en YCloud y el registro. `negocioId`: solo si es de ese negocio. */
export async function desconectarWhatsApp({ ycloud, fetch: fetchImpl = fetch }, clave, negocioId = null) {
  const reg = await ycloud.get(clave);
  if (!reg || (negocioId && reg.negocio !== negocioId)) return { status: 404, datos: { error: 'no existe' } };
  const borrado = await borrarWebhook(reg.apiKey, reg.endpointId, fetchImpl).catch(() => false);
  await ycloud.delete(clave);
  return { status: 200, datos: { ok: true, webhookBorrado: borrado } };
}

// ── Instagram desde la app (ZL-137): la app de Meta de Zustro Labs para clientes, con cada cliente como evaluador ──
/** La app compartida (la más nueva marcada como compartida), o null si todavía no se registró. */
/**
 * La app con la que se conectan los clientes: la compartida registrada más nueva o, si no hay, la del estudio (ZL-140).
 * Desde fines de octubre de 2026, Meta no ofrece «Instagram login» en las apps nuevas: la del estudio (anterior) sí.
 */
export const appCompartida = async (apps, env = {}) => ((await apps?.list?.()) ?? []).filter((a) => a.compartida).sort((x, y) => (y.creado ?? 0) - (x.creado ?? 0))[0] ?? appDelEstudio(env);
// La vuelta del OAuth es siempre zustrolabs.com (es la Redirect URL registrada en la app de Meta).
const ORIGEN_IG = 'https://zustrolabs.com';

export async function appNegocios(request, env, deps) {
  const url = new URL(request.url);
  const now = deps.now ?? Date.now();
  if (!env.ACCESS_TEAM_DOMAIN || !env.NEGOCIOS_ACCESS_AUD) return resp(PAGINA_SIN_CONFIGURAR, 503, 'text/html; charset=utf-8');
  if (!deps.negocios || !deps.catalogo) return error('sin memoria', 503);
  const email = await emailDeAcceso(request, env, env.NEGOCIOS_ACCESS_AUD, deps.fetch ?? fetch, now);
  if (!email) return error('sin acceso: entrá de nuevo', 401);
  const admin = correosDe(env.PANEL_EMAILS).includes(email);

  // Archivos de la app.
  if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return resp(APP_HTML, 200, 'text/html; charset=utf-8');
  if (request.method === 'GET' && url.pathname === '/app.js') return resp(appJs(), 200, 'text/javascript; charset=utf-8');
  if (request.method === 'GET' && url.pathname === '/app.css') return resp(APP_CSS, 200, 'text/css; charset=utf-8');
  // App instalable y avisos al celular (ZL-151).
  if (request.method === 'GET' && url.pathname === '/sw.js') return resp(SW_JS, 200, 'text/javascript; charset=utf-8');
  if (request.method === 'GET' && url.pathname === '/manifest.webmanifest') return resp(MANIFIESTO, 200, 'application/manifest+json');
  if (request.method === 'GET' && url.pathname === '/icono.svg') return resp(ICONO_SVG, 200, 'image/svg+xml');
  if (!url.pathname.startsWith('/api/')) return error('no existe', 404);

  // Cambios: mismo origen y cabecera propia (una página de otro sitio no puede mandarla sin permiso de CORS).
  if (request.method !== 'GET') {
    const origen = request.headers.get('origin');
    if (request.headers.get('x-zl') !== '1' || (origen && origen !== `https://${url.host}`)) return error('pedido no permitido', 403);
  }
  const ruta = url.pathname.slice(4); // sin «/api»

  if (request.method === 'GET' && ruta === '/yo') {
    const lista = admin ? await deps.negocios.list() : await deps.negocios.deEmail(email);
    return json({ email, admin, negocios: lista.map((n) => ({ id: n.id, nombre: n.nombre })) });
  }

  if (ruta.startsWith('/admin/')) {
    if (!admin) return error('solo el equipo de Zustro Labs', 403);
    return administrar(request, ruta.slice(6), { ...deps, acceso: (emails) => agregarAAcceso(env, deps.fetch ?? fetch, env.NEGOCIOS_HOST || NEGOCIOS_HOST, emails), quitarAcceso: quitarAccesoDe(env, deps) }, now);
  }

  const m = /^\/n\/([a-z0-9]{4,40})(\/.*)?$/.exec(ruta);
  if (!m) return error('no existe', 404);
  const negocio = await deps.negocios.get(m[1]);
  // Si no es suyo, como si no existiera: no se revela qué negocios hay.
  if (!negocio || (!admin && !negocio.emails.includes(email))) return error('no existe', 404);
  const sub = m[2] ?? '';
  const cat = deps.catalogo(negocio.id);
  const ejecutar = async (op, args) => delCatalogo(await cat.ejecutar(op, args));
  // ZL-159: lo que solo hace un dueño (conectar canales, cómo se vende, pausar el asistente). Un empleado, no.
  const dueño = esDueño(negocio, email, admin);
  const soloDueño = () => error('eso lo cambia el dueño del negocio', 403);
  const configura = request.method !== 'GET' && (/^\/(instagram|whatsapp)(\/|$)/.test(sub) || ['/ajustes', '/asistente', '/mi-negocio'].includes(sub));
  if (configura && !dueño) return soloDueño();

  if (request.method === 'GET' && sub === '') {
    const f = await deps.negocios.ficha(negocio.id);
    const pf = f?.texto ? parsearFicha(f.texto) : null;
    const r = await ejecutar('resumen', []);
    const cuentas = [];
    for (const c of negocio.cuentas) cuentas.push({ id: c, username: (await deps.cuentas?.get(c))?.username ?? null });
    return json({
      negocio: {
        id: negocio.id, nombre: negocio.nombre, cuentas, canales: canalesDe(negocio), pedidos: negocio.pedidos === true, ajustes: ajustesDeVenta(negocio.ajustes),
        // ZL-159: el rol de quien entra, la pausa del asistente y el aviso del día (vencidos, como si no estuvieran).
        rol: dueño ? 'dueño' : 'empleado',
        // ZL-160: si el asistente responde comentarios de Instagram, y cómo.
        comentarios: configComentarios(negocio),
        pausa: negocio.pausa && negocio.pausa.hasta > now ? negocio.pausa : null,
        avisoDia: negocio.avisoDia && negocio.avisoDia.hasta > now ? negocio.avisoDia : null,
        ...(admin && { emails: negocio.emails, empleados: negocio.empleados ?? [], limiteDia: limiteDiaDe(negocio) }),
      },
      resumen: r.valor ?? null,
      asistente: { tiene: Boolean(f?.texto), activo: Boolean(f?.activa), nombre: pf?.ficha?.nombre ?? null, precios: pf?.ficha?.precios ?? false, objetivo: pf?.ficha?.objetivo ?? null },
      admin,
    });
  }

  // Instagram del negocio (ZL-137): pedir la invitación, «Conectar Instagram» y desconectar.
  if (sub === '/instagram' || sub.startsWith('/instagram/')) {
    if (!deps.cuentas || !deps.apps) return error('sin memoria', 503);
    const app = await appCompartida(deps.apps, env);
    if (request.method === 'GET' && sub === '/instagram') {
      const cuentas = [];
      for (const id of negocio.cuentas) {
        const c = await deps.cuentas.get(id);
        // ZL-160: true si dio el permiso de comentarios; false si falta; null si se conectó antes y no se sabe.
        // ZL-166: si Instagram rechazó el permiso al responder, la cuenta figura desconectada (aunque haya token).
        cuentas.push({ id, username: c?.username ?? null, conectada: Boolean(c) && !c.tokenInvalido, ...(c?.tokenInvalido && { revocada: true }), venceEnDias: c ? Math.floor((c.vence - now) / 86_400_000) : null, permisoComentarios: typeof c?.permisoComentarios === 'boolean' ? c.permisoComentarios : null });
      }
      return json({ cuentas, disponible: Boolean(app && env.IG_APP_SECRET), invitacion: negocio.invitacionIg ?? null, canal: canalesDe(negocio).instagram, comentarios: configComentarios(negocio) });
    }
    // ZL-160: encender o apagar las respuestas a comentarios, y el modo. Solo el dueño (como todo lo de /instagram).
    if (request.method === 'PUT' && sub === '/instagram/comentarios') {
      const b = await request.json().catch(() => null);
      if (!b || (b.activo !== undefined && typeof b.activo !== 'boolean') || (b.modo !== undefined && !['publico_privado', 'privado'].includes(b.modo))) return error('activo (sí o no) y modo (publico_privado o privado)', 400);
      const r = await deps.negocios.guardar(negocio.id, { comentarios: { activo: b.activo, modo: b.modo } });
      if (r?.error) return error(r.error, 400);
      console.log(JSON.stringify({ canal: 'ig', que: 'comentarios_config', activo: r.negocio.comentarios.activo, modo: r.negocio.comentarios.modo }));
      return json({ ok: true, comentarios: r.negocio.comentarios });
    }
    if (request.method === 'POST' && sub === '/instagram/invitacion') {
      const b = await request.json().catch(() => null);
      const usuario = String(b?.usuario ?? '').trim().replace(/^@/, '');
      if (!/^[A-Za-z0-9._]{1,30}$/.test(usuario)) return error('escribí el usuario de Instagram del negocio, sin espacios (por ejemplo: mi.negocio)', 400);
      const r = await deps.negocios.guardar(negocio.id, { invitacionIg: { usuario, pedido: now } });
      if (r?.error) return error(r.error, 400);
      console.log(JSON.stringify({ canal: 'ig', que: 'invitacion_pedida' }));
      return json({ ok: true, invitacion: r.negocio.invitacionIg });
    }
    if (request.method === 'POST' && sub === '/instagram/conectar') {
      if (!app || !env.IG_APP_SECRET) return error('todavía no está disponible: escribinos a contact@zustrolabs.com', 503);
      return json({ url: await urlAutorizar(env, ORIGEN_IG, now, app, negocio.id) });
    }
    const c = /^\/instagram\/(\d{6,20})$/.exec(sub);
    if (request.method === 'DELETE' && c) {
      if (!negocio.cuentas.includes(c[1])) return error('no existe', 404);
      const r = await deps.negocios.guardar(negocio.id, { cuentas: negocio.cuentas.filter((x) => x !== c[1]) });
      if (r?.error) return error(r.error, 400);
      // La cuenta del estudio (app del estudio) solo se desvincula: su token no se borra desde acá (ZL-137).
      const cta = await deps.cuentas.get(c[1]);
      const estudio = Boolean(cta) && String(cta.app ?? env.IG_APP_ID) === String(env.IG_APP_ID);
      if (!estudio) await deps.cuentas.delete(c[1]);
      return json({ ok: true, borrada: !estudio });
    }
    return error('no existe', 404);
  }

  // WhatsApp del negocio (ZL-136): el negocio conecta su número solo, con su cuenta de YCloud.
  if (sub === '/whatsapp' || sub.startsWith('/whatsapp/')) {
    if (!deps.ycloud) return error('sin memoria', 503);
    if (request.method === 'GET' && sub === '/whatsapp') return json({ numeros: await numerosDe(deps.ycloud, negocio.id), canal: canalesDe(negocio).whatsapp });
    if (request.method === 'POST' && sub === '/whatsapp') {
      const b = await request.json().catch(() => null);
      const r = await conectarWhatsApp(deps, negocio, b);
      return json(r.datos, r.status);
    }
    const w = /^\/whatsapp\/([0-9a-f]{24})$/.exec(sub);
    if (request.method === 'DELETE' && w) {
      const r = await desconectarWhatsApp(deps, w[1], negocio.id);
      return json(r.datos, r.status);
    }
    return error('no existe', 404);
  }

  if (request.method === 'GET' && sub === '/productos') {
    const p = url.searchParams;
    const r = await ejecutar('lista', [{ q: p.get('q') ?? '', categoria: p.get('categoria') ?? '', pausados: p.get('pausados') !== '0', desde: Number(p.get('desde') ?? 0), cuantos: Number(p.get('cuantos') ?? 200) }]);
    return r.resp ?? json(r.valor);
  }
  if (request.method === 'POST' && sub === '/productos') {
    const b = await leerJson(request);
    if (!b) return error('pedido inválido');
    const r = await ejecutar('crear', [b, email]);
    return r.resp ?? json(r.valor, 201);
  }
  // Pedidos (ZL-139): el panel del negocio. Solo el negocio (y el equipo) cambia estados; nunca la IA.
  if (request.method === 'GET' && sub === '/pedidos') {
    const r = await ejecutar('pedidos', [{ estado: url.searchParams.get('estado') ?? '', cuantos: Number(url.searchParams.get('cuantos') ?? 100) }]);
    if (r.resp) return r.resp;
    await conContacto(r.valor.pedidos, deps);
    await conAvisoPendiente(r.valor.pedidos, deps);
    return json({ ...r.valor, encendidos: negocio.pedidos === true });
  }
  // ZL-163: corregir a nombre de quién, la entrega o la dirección de un pedido abierto.
  const mcp = /^\/pedidos\/(\d{1,9})\/comprador$/.exec(sub);
  if (mcp && request.method === 'PUT') {
    const b = await leerJson(request);
    if (!b) return error('pedido inválido');
    const r = await ejecutar('corregirComprador', [Number(mcp[1]), { nombre: b.nombre, entrega: b.entrega, direccion: b.direccion }, email]);
    return r.resp ?? json(r.valor);
  }
  const mo = /^\/pedidos\/(\d{1,9})$/.exec(sub);
  if (mo && request.method === 'GET') {
    const r = await ejecutar('pedido', [Number(mo[1])]);
    if (r.resp) return r.resp;
    await conContacto([r.valor], deps);
    await conAvisoPendiente([r.valor], deps);
    return json(r.valor);
  }
  // ZL-165: el equipo borra un pedido de prueba (libera lo reservado; no queda en números ni reportes).
  if (mo && request.method === 'DELETE') {
    if (!admin) return error('los pedidos de prueba los borra el equipo', 403);
    const r = await ejecutar('borrarPedido', [Number(mo[1])]);
    return r.resp ?? json(r.valor);
  }
  // ZL-157: «Ya se lo mandé»: el dueño le avisó desde su app; el asistente ya no lo repite.
  const mav = /^\/pedidos\/(\d{1,9})\/avisado$/.exec(sub);
  if (mav && request.method === 'POST') {
    const r = await ejecutar('pedido', [Number(mav[1])]);
    if (r.resp) return r.resp;
    await deps.charlasNegocio?.quitarAvisos?.(r.valor.charla, r.valor.numero);
    return json({ ok: true });
  }
  if (mo && request.method === 'POST') {
    const b = await leerJson(request);
    if (!b || !['aceptado', 'rechazado', 'pagado', 'entregado', 'cancelado'].includes(b.estado)) return error('estado inválido');
    const motivo = String(b.motivo ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 200);
    // Aceptar con un toque (ZL-148): cuánto se guarda sin pagar sale de los ajustes del negocio, no de cada pedido.
    const aj = ajustesDeVenta(negocio.ajustes);
    // ZL-164: el aviso al comprador con lo de «Mi negocio» (formas de pago con el alias, dirección con mapa).
    const ajAviso = { ...ajustesConMiNegocio(aj, negocio.minegocio ?? null, { conAlias: true }), mapa: negocio.minegocio?.direccion && !aj.retiro ? mapaDe(negocio.minegocio.direccion) : '' };
    const r = await ejecutar('cambiarEstado', [Number(mo[1]), b.estado, email, { motivo, horas: b.horas ?? aj.reservaHoras }]);
    if (r.resp) return r.resp;
    // Se le avisa al comprador por el mismo canal (dentro de las 24 h de Meta). Si falla, el estado igual quedó.
    // ZL-163: en el idioma de su charla y con el nombre del negocio de la ficha (el mismo que usa el asistente).
    const idioma = await deps.charlasNegocio?.idioma?.(r.valor.charla).catch(() => null);
    const texto = textoEstado(r.valor, b.estado, motivo, await nombreDeFicha(deps, negocio), ajAviso, idioma ?? 'es');
    let aviso = texto && deps.avisarComprador ? await deps.avisarComprador(negocio, r.valor.charla, texto) : null;
    // ZL-157: el comprador SIEMPRE se entera. Si no salió solo (pasaron las 24 h de Meta, o falló el envío), queda
    // guardado para cuando vuelva a escribir, y el dueño tiene el mensaje listo para mandarlo él con un toque.
    if (texto && aviso !== true) {
      await deps.charlasNegocio?.guardarAviso?.(r.valor.charla, texto).catch(() => {});
      aviso = avisoManual(r.valor.charla, r.valor.canal, texto, aviso, await deps.charlasNegocio?.usuario?.(r.valor.charla).catch(() => null));
    }
    return json({ ...r.valor, aviso });
  }
  // Avisos al celular (ZL-151): la clave pública, suscribir este celular y un aviso de prueba.
  if (request.method === 'GET' && sub === '/push') {
    if (!deps.negocios.vapid) return error('sin memoria', 503);
    const lista = await deps.negocios.suscripcionesPush(negocio.id);
    // ZL-165: la lista de dispositivos (sin el endpoint, que es un secreto del navegador), para probar o sacar uno.
    return json({ clave: (await deps.negocios.vapid()).publica, celulares: lista.length, dispositivos: lista.map((x, n) => ({ n, nombre: x.nombre || 'Dispositivo', email: x.email, creado: x.creado })) });
  }
  const mpu = /^\/push\/(\d{1,2})(\/probar)?$/.exec(sub);
  if (mpu) {
    const lista = await deps.negocios.suscripcionesPush(negocio.id);
    const x = lista[Number(mpu[1])];
    if (!x) return error('ese dispositivo ya no está', 404);
    if (request.method === 'POST' && mpu[2]) {
      const enviados = deps.avisarCelulares ? await deps.avisarCelulares(negocio.id, { titulo: 'Prueba de avisos', cuerpo: 'Si ves esto, en este dispositivo te llegan los pedidos y consultas.' }, { solo: x.endpoint }) : 0;
      return json({ enviados });
    }
    if (request.method === 'DELETE' && !mpu[2]) return json({ celulares: await deps.negocios.borrarPush(negocio.id, [x.endpoint]) });
    return error('no existe', 404);
  }
  if (request.method === 'POST' && sub === '/push') {
    const b = await leerJson(request);
    if (!suscripcionValida(b?.suscripcion)) return error('este navegador no mandó una suscripción válida');
    const n = await deps.negocios.suscribirPush(negocio.id, b.suscripcion, email, String(b.nombre ?? ''));
    return json({ ok: true, celulares: n });
  }
  if (request.method === 'POST' && sub === '/push/probar') {
    const enviados = deps.avisarCelulares ? await deps.avisarCelulares(negocio.id, { titulo: 'Avisos activados', cuerpo: 'Así te va a llegar cada pedido o consulta nueva.' }) : 0;
    return json({ enviados });
  }

  // ZL-165: la guía para dejar el negocio andando (Inicio la muestra hasta que todo está hecho).
  if (request.method === 'GET' && sub === '/guia') {
    const f = await deps.negocios.ficha(negocio.id);
    const res = (await ejecutar('resumen', [])).valor ?? {};
    const wa = deps.ycloud?.list ? (await deps.ycloud.list().catch(() => [])).some((r) => r.negocio === negocio.id) : false;
    const c = canalesDe(negocio);
    const celulares = deps.negocios.suscripcionesPush ? (await deps.negocios.suscripcionesPush(negocio.id)).length : 0;
    const vende = ajustesDeVenta(negocio.ajustes).vende;
    const pasos = [
      { id: 'asistente', texto: 'El equipo de Zustro Labs prepara y enciende tu asistente', hecho: Boolean(f?.texto && f.activa), ir: null },
      { id: 'canal', texto: 'Conectá tu WhatsApp o tu Instagram', hecho: (c.instagram && (negocio.cuentas ?? []).length > 0) || (c.whatsapp && wa), ir: 'conexiones' },
      { id: 'productos', texto: vende === 'servicios' ? 'Cargá tus servicios' : 'Cargá tus productos (o subí tu Excel)', hecho: (res.total ?? 0) > 0, ir: 'productos' },
      { id: 'horarios', texto: 'Cargá tus horarios y cómo se paga en Mi negocio', hecho: tieneHorarios(negocio.minegocio), ir: 'minegocio' },
      { id: 'avisos', texto: 'Activá los avisos en el celular del negocio', hecho: celulares > 0, ir: 'avisos' },
    ];
    return json({ pasos, listo: pasos.every((p) => p.hecho) });
  }

  // Números de los últimos 7 días (ZL-151): charlas, consultas, pedidos, ventas cerradas.
  if (request.method === 'GET' && sub === '/numeros') {
    const dias = 7;
    const desde = now - dias * 86_400_000;
    const m = deps.negocios.metricas ? await deps.negocios.metricas(negocio.id, dias) : {};
    const c = (await ejecutar('numeros', [desde])).valor ?? {};
    const uso = (await deps.negocios.uso(negocio.id)).filter((u) => u.dia >= new Date(desde).toISOString().slice(0, 10)).reduce((x, u) => x + u.n, 0);
    // ZL-158: lo que mandó el sistema por WhatsApp este mes (Meta cobra pasando los 1.000 por número por mes).
    let whatsappMes = null;
    if (canalesDe(negocio).whatsapp && deps.negocios.metricasDias) {
      const hoy = diaLocal(now, ajustesDeVenta(negocio.ajustes).zona);
      const dias = await deps.negocios.metricasDias(negocio.id, `${hoy.slice(0, 7)}-01`, hoy);
      whatsappMes = { enviados: dias.reduce((x, d) => x + (d.enviadosWa ?? 0), 0), gratis: GRATIS_WA_MES, aviso: AVISO_WA_MES, mes: hoy.slice(0, 7) };
    }
    // ZL-165: lo de hoy (con la hora del negocio), para el «Hoy» de Inicio.
    const zonaN = ajustesDeVenta(negocio.ajustes).zona;
    const diaHoy = diaLocal(now, zonaN);
    const desdeHoy = instanteEnZona(diaHoy, '00:00', zonaN);
    const mh = deps.negocios.metricasDias ? (await deps.negocios.metricasDias(negocio.id, diaHoy, diaHoy))[0] ?? {} : {};
    const ch = (await ejecutar('numeros', [desdeHoy])).valor ?? {};
    const hoy = { charlas: mh.charlas ?? 0, mensajes: mh.mensajes ?? 0, pedidos: ch.pedidos ?? 0, consultas: ch.consultas ?? 0, vendido: ch.vendido ?? 0, fueraHorario: mh.fueraHorario ?? 0 };
    return json({ dias, charlas: m.charlas ?? 0, audios: m.audios ?? 0, pases: m.pases ?? 0, seguimientos: m.seguimientos ?? 0, respuestas: uso, ...c, whatsappMes, hoy });
  }

  // Reportes (ZL-152): día, semana o mes, para ver en la app o bajar en Excel. Con la hora del negocio.
  if (request.method === 'GET' && sub === '/reporte') {
    if (!deps.reporte || !deps.negocios.metricasDias) return error('sin memoria', 503);
    const zona = ajustesDeVenta(negocio.ajustes).zona;
    const periodo = url.searchParams.get('periodo') ?? 'semana';
    const fecha = url.searchParams.get('fecha') ?? '';
    // Primero el rango (para pedirle a la base solo esos días) y después el reporte entero.
    const vacio = deps.reporte.armarReporte({ negocio: negocio.nombre, periodo, fecha, zona, now });
    const desdeMs = Date.parse(`${vacio.desde}T00:00:00Z`) - 86_400_000;
    const hastaMs = Date.parse(`${vacio.hasta}T00:00:00Z`) + 2 * 86_400_000;
    const datos = (await ejecutar('datosReporte', [desdeMs, hastaMs])).valor ?? {};
    const r = deps.reporte.armarReporte({
      negocio: negocio.nombre, periodo, fecha, zona, now,
      metricas: await deps.negocios.metricasDias(negocio.id, vacio.desde, vacio.hasta),
      uso: await deps.negocios.uso(negocio.id),
      datos,
    });
    if (url.searchParams.get('formato') === 'xlsx') {
      const nombre = `reporte-${r.periodo}-${r.desde}${r.hasta !== r.desde ? `-al-${r.hasta}` : ''}.xlsx`;
      return new Response(deps.reporte.xlsx(r), { status: 200, headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="${nombre}"`, 'cache-control': 'no-store' } });
    }
    return json(r);
  }

  // Ajustes de venta (ZL-148): los carga el propio negocio (entrega, pago, cuánto se guarda un pedido sin pagar).
  if (request.method === 'GET' && sub === '/ajustes') return json(ajustesDeVenta(negocio.ajustes));
  if (request.method === 'PUT' && sub === '/ajustes') {
    const b = await leerJson(request);
    if (!b) return error('pedido inválido');
    const r = await deps.negocios.guardar(negocio.id, { ajustes: ajustesDeVenta({ ...negocio.ajustes, ...b }) });
    if (r?.error) return error(r.error);
    return json(r.negocio.ajustes);
  }

  // ZL-164: «Mi negocio». Lo carga el dueño sin pasar por el equipo (horarios, fechas especiales, fuera de horario,
  // dirección, envíos, pagos, contacto y la zona horaria); las preguntas frecuentes y «lo que no supo responder» también
  // los maneja un empleado. Cada cambio queda en el historial con quién lo hizo.
  if (sub === '/mi-negocio' || sub.startsWith('/mi-negocio/')) {
    const aj = ajustesDeVenta(negocio.ajustes);
    const vista = (n) => {
      const mn = normalizarMiNegocio(n.minegocio ?? null);
      const e = estadoAhora(mn, ajustesDeVenta(n.ajustes).zona, now);
      return {
        minegocio: mn, zona: ajustesDeVenta(n.ajustes).zona, zonas: ZONAS.map(([z, nombre]) => ({ z, nombre })), pais: paisDeZona(ajustesDeVenta(n.ajustes).zona),
        ahora: e ? { abierto: e.abierto, texto: cuandoResponden(mn, ajustesDeVenta(n.ajustes).zona, now) } : null,
        preguntas: n.preguntas ?? [], noSupo: [...(n.noSupo ?? [])].sort((x, y) => y.n - x.n || y.t - x.t), cambios: [...(n.cambios ?? [])].reverse().slice(0, 20),
        mapa: mn.direccion ? mapaDe(mn.direccion) : '', puede: dueño,
      };
    };
    if (request.method === 'GET' && sub === '/mi-negocio') return json(vista(negocio));
    if (request.method === 'GET' && sub === '/mi-negocio/feriados') {
      const pais = paisDeZona(aj.zona);
      const hoy = diaLocal(now, aj.zona);
      const anio = Number(hoy.slice(0, 4));
      const enUnAnio = `${anio + 1}${hoy.slice(4)}`;
      return json({ pais, feriados: pais ? [...feriados(pais, anio), ...feriados(pais, anio + 1)].filter((f) => f.fecha >= hoy && f.fecha < enUnAnio) : [] });
    }
    const b = await leerJson(request);
    if (!b) return error('pedido inválido');
    if (request.method === 'PUT' && sub === '/mi-negocio') {
      const antes = normalizarMiNegocio(negocio.minegocio ?? null);
      const nuevo = normalizarMiNegocio(b.minegocio ?? {}, antes);
      // Las fechas especiales que ya pasaron no se guardan (la lista queda corta).
      const hoy = diaLocal(now, aj.zona);
      nuevo.especiales = nuevo.especiales.filter((e) => e.hasta >= hoy);
      antes.especiales = antes.especiales.filter((e) => e.hasta >= hoy);
      const NOMBRES = { horarios: 'el horario', especiales: 'las fechas especiales', fueraDeHorario: 'qué hacer fuera de horario', direccion: 'la dirección', envios: 'los envíos', pagos: 'las formas de pago', contacto: 'el contacto' };
      const que = Object.keys(NOMBRES).filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(nuevo[k])).map((k) => NOMBRES[k]);
      const zona = b.zona && ZONAS.some(([z]) => z === b.zona) ? b.zona : null;
      if (zona && zona !== aj.zona) que.push('la zona horaria');
      if (!que.length) return json(vista(negocio));
      const r = await deps.negocios.guardar(negocio.id, { minegocio: nuevo, ...(zona && { ajustes: { ...aj, zona } }), cambio: `cambió ${que.join(', ')}`, quien: email });
      if (r?.error) return error(r.error);
      console.log(JSON.stringify({ canal: 'negocio', que: 'mi_negocio', cambios: que.length }));
      return json(vista(r.negocio));
    }
    const limpio = (v, n) => String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').replace(/ ([?!.,;:])/g, '$1').trim().slice(0, n);
    const clave = (t) => limpio(t, 200).toLowerCase();
    if (request.method === 'PUT' && sub === '/mi-negocio/preguntas') {
      if (!Array.isArray(b.preguntas)) return error('pedido inválido');
      const preguntas = b.preguntas.map((x) => ({ p: limpio(x?.p, 200), r: limpio(x?.r, 600), t: Number(x?.t) || now })).filter((x) => x.p && x.r).slice(0, 100);
      const claves = new Set(preguntas.map((x) => clave(x.p)));
      const r = await deps.negocios.guardar(negocio.id, { preguntas, noSupo: (negocio.noSupo ?? []).filter((x) => !claves.has(clave(x.p))), cambio: 'cambió las preguntas frecuentes', quien: email });
      if (r?.error) return error(r.error);
      return json(vista(r.negocio));
    }
    if (request.method === 'POST' && sub === '/mi-negocio/no-supo') {
      // «Responder y guardar»: la respuesta pasa a las preguntas frecuentes; «Descartar» (sin respuesta) la saca.
      const pregunta = limpio(b.pregunta, 200);
      const respuesta = limpio(b.respuesta, 600);
      if (!pregunta) return error('falta la pregunta');
      const noSupo = (negocio.noSupo ?? []).filter((x) => clave(x.p) !== clave(pregunta));
      const preguntas = respuesta ? [...(negocio.preguntas ?? []).filter((x) => clave(x.p) !== clave(pregunta)), { p: pregunta, r: respuesta, t: now }].slice(-100) : negocio.preguntas ?? [];
      const r = await deps.negocios.guardar(negocio.id, { noSupo, preguntas, ...(respuesta && { cambio: 'respondió una pregunta que el asistente no sabía', quien: email }) });
      if (r?.error) return error(r.error);
      return json(vista(r.negocio));
    }
    return error('no existe', 404);
  }

  // ZL-159: el dueño maneja su asistente sin pasar por el equipo: lo pausa (vacaciones, local cerrado) con un mensaje
  // de ausencia, y deja un aviso del día que el asistente tiene en cuenta. La ficha la sigue editando el equipo.
  if (request.method === 'PUT' && sub === '/asistente') {
    const b = await leerJson(request);
    if (!b) return error('pedido inválido');
    const cambios = {};
    if (b.pausa !== undefined) cambios.pausa = b.pausa;
    if (b.avisoDia !== undefined) cambios.avisoDia = b.avisoDia;
    const r = await deps.negocios.guardar(negocio.id, cambios);
    if (r?.error) return error(r.error);
    console.log(JSON.stringify({ canal: 'negocio', que: 'asistente', pausa: Boolean(r.negocio.pausa), aviso: Boolean(r.negocio.avisoDia) }));
    return json({ pausa: r.negocio.pausa, avisoDia: r.negocio.avisoDia });
  }
  // ZL-159: la charla de prueba también para el dueño, con la ficha guardada (no la puede cambiar) y un tope por día.
  if (request.method === 'POST' && sub === '/prueba') {
    const b = await leerJson(request);
    if (!b || !deps.probar) return error('pedido inválido');
    const f = await deps.negocios.ficha(negocio.id);
    const pf = f?.texto ? parsearFicha(f.texto) : null;
    if (!pf?.ok) return error('el asistente todavía no está listo: lo prepara el equipo de Zustro Labs', 409);
    const mensajes = (Array.isArray(b.mensajes) ? b.mensajes : []).map((x) => String(x).slice(0, 500)).filter(Boolean).slice(0, 3);
    if (!mensajes.length) return error('escribí un mensaje');
    if (deps.negocios.sumarMetrica) {
      const usados = await deps.negocios.sumarMetrica(negocio.id, 'pruebas', diaLocal(now, ajustesDeVenta(negocio.ajustes).zona));
      if (usados > PRUEBAS_DIA) return error(`ya probaste ${PRUEBAS_DIA} mensajes hoy: seguí mañana`, 429);
    }
    const r = await deps.probar(pf.ficha, negocio.id, mensajes, b.estado ?? null);
    return json({ charla: r.charla, estado: r.estado ?? null });
  }

  // Consultas (ZL-146): lo que el asistente le pasa al negocio cuando el cierre no es un pedido o hace falta alguien.
  // ZL-148: cada una dice si el asistente está callado en esa charla y hasta cuándo.
  if (request.method === 'GET' && sub === '/consultas') {
    const r = await ejecutar('consultas', [{ estado: url.searchParams.get('estado') ?? '', cuantos: Number(url.searchParams.get('cuantos') ?? 100) }]);
    if (r.resp) return r.resp;
    for (const c of r.valor.consultas) {
      if (deps.charlasNegocio?.pausa && ['nueva', 'atendiendo'].includes(c.estado)) c.pausaHasta = await deps.charlasNegocio.pausa(c.charla).catch(() => 0);
    }
    await conContacto(r.valor.consultas, deps);
    return json(r.valor);
  }
  const mc = /^\/consultas\/(\d{1,9})(\/devolver)?$/.exec(sub);
  if (mc && request.method === 'POST' && mc[2]) {
    // Devolver al asistente: vuelve a responder en esa charla ya (solo charlas de ESTE negocio: salen de su consulta).
    const k = await ejecutar('consulta', [Number(mc[1])]);
    if (k.resp) return k.resp;
    if (!deps.charlasNegocio?.devolver) return error('sin memoria', 503);
    // ZL-162: el dueño puede escribir qué responderle. Se le manda ya (dentro de las 24 h de Meta; si no, queda el
    // mensaje listo para mandar a mano), queda como pregunta frecuente para la próxima y el asistente sigue con eso.
    const b = (await leerJson(request)) ?? {};
    const respuesta = String(b.respuesta ?? '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u0009\u000B-\u001F\u007F<>]/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, 600);
    const pregunta = String(k.valor.interes ?? '').trim();
    await deps.charlasNegocio.devolver(k.valor.charla, { pregunta, respuesta });
    let guardada = false;
    if (respuesta && pregunta && b.guardar !== false) {
      const r = await deps.negocios.guardar(negocio.id, { preguntas: [...(negocio.preguntas ?? []).filter((x) => x.p !== pregunta), { p: pregunta, r: respuesta, t: now }] });
      guardada = !r?.error;
    }
    let aviso = null;
    if (respuesta) {
      const enviado = deps.avisarComprador ? await deps.avisarComprador(negocio, k.valor.charla, respuesta) : 'sin_envio';
      if (enviado !== true) aviso = avisoManual(k.valor.charla, k.valor.canal, respuesta, enviado, await deps.charlasNegocio?.usuario?.(k.valor.charla).catch(() => null));
    }
    console.log(JSON.stringify({ canal: 'negocio', que: 'devolver', respondida: Boolean(respuesta), guardada, manual: Boolean(aviso) }));
    return json({ ok: true, pausaHasta: 0, respondida: Boolean(respuesta), guardada, ...(aviso && { aviso }) });
  }
  if (mc && request.method === 'POST') {
    const b = await leerJson(request);
    if (!b || !['nueva', 'atendiendo', 'ganada', 'perdida', 'resuelta'].includes(b.estado)) return error('estado inválido');
    const r = await ejecutar('cambiarConsulta', [Number(mc[1]), b.estado, String(b.nota ?? '')]);
    if (r.resp) return r.resp;
    // «La atiendo»: el asistente se calla en esa charla las horas de pausa de la ficha (para no pisarse con el negocio).
    let pausaHasta;
    if (b.estado === 'atendiendo' && deps.charlasNegocio?.pausar) {
      const f = await deps.negocios.ficha(negocio.id);
      const horas = (f?.texto && parsearFicha(f.texto).ficha?.pausaHoras) || 12;
      pausaHasta = await deps.charlasNegocio.pausar(r.valor.charla, horas).catch(() => undefined);
    }
    return json({ ...r.valor, ...(pausaHasta && { pausaHasta }) });
  }
  // ── Equipo (ZL-165): quién entra. El dueño suma o saca empleados; van solos a Access (y salen, ZL-166). ──
  if (sub === '/equipo') {
    const personas = (n) => (n.emails ?? []).map((e) => ({ email: e, rol: (n.empleados ?? []).includes(e) ? 'empleado' : 'dueño' }));
    if (request.method === 'GET') return json({ personas: personas(negocio) });
    if (!dueño) return soloDueño();
    const b = await leerJson(request);
    const correo = String(b?.email ?? '').trim().toLowerCase();
    if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}$/i.test(correo)) return error('ese correo no parece válido', 400, 'email');
    if (request.method === 'POST') {
      if (negocio.emails.includes(correo)) return error('ya entra a la app');
      const r = await deps.negocios.guardar(negocio.id, { emails: [...negocio.emails, correo], empleados: [...(negocio.empleados ?? []), correo], cambio: `sumó a ${correo} como empleado`, quien: email });
      if (r?.error) return error(r.error);
      const acceso = await agregarAAcceso(env, deps.fetch ?? fetch, env.NEGOCIOS_HOST || NEGOCIOS_HOST, [correo]);
      return json({ personas: personas(r.negocio), acceso });
    }
    if (request.method === 'DELETE') {
      if (!(negocio.empleados ?? []).includes(correo)) return error('solo se sacan empleados (a un dueño lo saca el equipo de Zustro Labs)', 403);
      const r = await deps.negocios.guardar(negocio.id, { emails: negocio.emails.filter((e) => e !== correo), empleados: (negocio.empleados ?? []).filter((e) => e !== correo), cambio: `sacó a ${correo}`, quien: email });
      if (r?.error) return error(r.error);
      const quitados = await quitarAccesoDe(env, deps)([correo]);
      return json({ personas: personas(r.negocio), quitados });
    }
    return error('no existe', 404);
  }

  // ── Charlas (ZL-165): lo que habló cada persona con el asistente (30 días). La app las pide por su número, nunca por
  // el teléfono ni el id de Instagram. Desde acá el negocio responde (dentro de las 24 h de Meta) y el asistente se
  // calla en esa charla; «Que siga el asistente» lo devuelve; 👎 marca una respuesta mala.
  if (request.method === 'GET' && sub === '/charlas') {
    const p = new URL(request.url).searchParams;
    const r = await ejecutar('charlasApp', [{ q: p.get('q') ?? '', cuantos: Number(p.get('cuantos') ?? 50) }]);
    return r.resp ?? json(r.valor);
  }
  const mch = /^\/charlas\/(\d{1,9})(\/responder|\/asistente|\/resuelta|\/mensajes\/(\d{1,12})\/mal)?$/.exec(sub);
  if (mch) {
    const r = await ejecutar('charlaApp', [Number(mch[1]), { marcar: request.method === 'GET' }]);
    if (r.resp) return r.resp;
    const { charla, ...c } = r.valor;
    const estadoCharla = async () => ({
      pausaHasta: (await deps.charlasNegocio?.pausa?.(charla).catch(() => 0)) || 0,
      ventanaHasta: (await deps.charlasNegocio?.ventana?.(charla).catch(() => 0)) || 0,
    });
    if (request.method === 'GET' && !mch[2]) return json({ ...c, ...(await estadoCharla()) });
    if (request.method !== 'POST') return error('no existe', 404);
    const b = (await leerJson(request)) ?? {};
    if (mch[2] === '/responder') {
      const texto = String(b.texto ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').trim().slice(0, 3000);
      if (!texto) return error('escribí la respuesta');
      const enviado = deps.avisarComprador ? await deps.avisarComprador(negocio, charla, texto) : 'sin canal';
      if (enviado !== true) {
        return error(enviado === 'fuera_24h'
          ? 'Pasaron más de 24 horas desde su último mensaje: WhatsApp e Instagram no dejan escribirle desde acá. Respondele desde tu app de ' + (c.canal === 'wa' ? 'WhatsApp' : 'Instagram') + '.'
          : 'No se pudo mandar (' + enviado + '). Probá de nuevo o respondele desde tu app.', 409);
      }
      // Contestó alguien del negocio: el asistente se calla en esa charla las horas de la ficha (no se pisan).
      const f = await deps.negocios.ficha(negocio.id);
      const horas = (f?.texto && parsearFicha(f.texto).ficha?.pausaHoras) || 12;
      await deps.charlasNegocio?.pausar?.(charla, horas).catch(() => null);
      const nueva = await ejecutar('charlaApp', [Number(mch[1]), { marcar: true }]);
      const { charla: _c, ...vista } = nueva.valor ?? c;
      return json({ ...vista, ...(await estadoCharla()) });
    }
    if (mch[2] === '/asistente') {
      await deps.charlasNegocio?.devolver?.(charla, {}).catch(() => null);
      return json({ ...c, ...(await estadoCharla()) });
    }
    // «Ya lo resolví»: la consulta abierta de esa charla queda resuelta y sigue el asistente.
    if (mch[2] === '/resuelta') {
      const k = await ejecutar('consultaAbierta', [charla]);
      if (k.valor) await ejecutar('cambiarConsulta', [k.valor.numero, 'resuelta', 'resuelta desde Charlas']);
      await deps.charlasNegocio?.devolver?.(charla, {}).catch(() => null);
      return json({ ...c, ...(await estadoCharla()), resuelta: Boolean(k.valor) });
    }
    const m = await ejecutar('marcarMal', [Number(mch[3]), b.mal !== false]);
    if (m.resp) return m.resp;
    if (b.mal !== false) await deps.negocios.sumarMetrica?.(negocio.id, 'mal', diaLocal(now, ajustesDeVenta(negocio.ajustes).zona)).catch(() => null);
    return json(m.valor);
  }

  // ZL-165: precios en bloque (primero la vista previa con «probar», después en serio).
  if (request.method === 'POST' && sub === '/productos/precios') {
    const b = await leerJson(request);
    if (!b) return error('pedido inválido');
    const r = await ejecutar('ajustarPrecios', [{ porcentaje: b.porcentaje, categoria: b.categoria, redondeo: b.redondeo, probar: b.probar === true }, email]);
    return r.resp ?? json(r.valor);
  }
  let mp = /^\/productos\/(p[a-z0-9]{4,40})$/.exec(sub);
  if (mp && request.method === 'PUT') {
    const b = await leerJson(request);
    if (!b) return error('pedido inválido');
    const r = await ejecutar('actualizar', [mp[1], b, email]);
    return r.resp ?? json(r.valor);
  }
  if (mp && request.method === 'DELETE') {
    const r = await ejecutar('borrar', [mp[1], email]);
    return r.resp ?? json({ ok: r.valor });
  }
  mp = /^\/productos\/(p[a-z0-9]{4,40})\/stock$/.exec(sub);
  if (mp && request.method === 'POST') {
    const b = await leerJson(request);
    if (!b) return error('pedido inválido');
    const r = await ejecutar('moverStock', [mp[1], b.delta, email, String(b.motivo ?? 'ajuste').slice(0, 80)]);
    return r.resp ?? json(r.valor);
  }
  if (request.method === 'POST' && sub === '/importar') {
    const b = await leerJson(request);
    if (!b || !Array.isArray(b.filas)) return error('pedido inválido (¿el archivo es muy grande? máximo 3.000 filas)');
    const r = await ejecutar('importar', [b.filas, { modo: b.modo === 'reemplazar' ? 'reemplazar' : 'actualizar', clave: b.clave === 'nombre' ? 'nombre' : 'codigo', probar: b.probar === true }, email]);
    return r.resp ?? json(r.valor);
  }
  if (request.method === 'GET' && sub === '/exportar') {
    const r = await ejecutar('exportar', []);
    return r.resp ?? json({ productos: r.valor });
  }
  if (request.method === 'GET' && sub === '/historial') {
    const r = await ejecutar('historial', [{ producto: url.searchParams.get('producto') ?? '', cuantos: 200 }]);
    return r.resp ?? json({ movimientos: r.valor });
  }
  if (request.method === 'POST' && sub === '/fotos') {
    const tipo = (request.headers.get('content-type') ?? '').split(';')[0].trim();
    if (Number(request.headers.get('content-length') ?? 0) > 700_000) return error('la foto es muy pesada');
    const bytes = new Uint8Array(await request.arrayBuffer());
    const r = await ejecutar('guardarFoto', [bytes, tipo]);
    return r.resp ?? json({ id: r.valor }, 201);
  }
  mp = /^\/fotos\/(f[a-z0-9]{4,40})$/.exec(sub);
  if (mp && request.method === 'GET') {
    const r = await ejecutar('foto', [mp[1]]);
    if (r.resp) return r.resp;
    if (!r.valor) return error('no existe', 404);
    return new Response(r.valor.datos, { status: 200, headers: { 'content-type': r.valor.tipo, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" } });
  }

  // El semáforo del negocio (ZL-150): qué anda y qué falta, en Conexiones. Sin charla de prueba (no gasta IA).
  if (request.method === 'GET' && sub === '/estado') {
    if (!deps.verificar) return error('sin memoria', 503);
    return json(await deps.verificar(negocio.id, { charla: false }));
  }

  // Alta fácil (ZL-150): la ficha por formulario, desde la web y desde plantillas, y el revisor. Solo el equipo.
  if (sub.startsWith('/ficha/')) {
    if (!admin) return error('la ficha del asistente la maneja el equipo de Zustro Labs', 403);
    if (request.method === 'GET' && sub === '/ficha/plantillas') return json({ plantillas: PLANTILLAS.map((p) => ({ id: p.id, nombre: p.nombre, campos: p.campos })) });
    const b = request.method === 'POST' ? await leerJson(request) : null;
    if (request.method !== 'POST' || !b) return error('pedido inválido');
    if (sub === '/ficha/campos') {
      const r = camposDeFicha(String(b.texto ?? ''));
      return json(r, r.ok ? 200 : 400);
    }
    if (sub === '/ficha/armar') {
      const texto = fichaDeCampos(b.campos ?? {});
      return json({ texto, ...resumenFicha(parsearFicha(texto)) });
    }
    if (sub === '/ficha/web') {
      try {
        const r = await armarDesdeWeb(env, b.url, { fetchImpl: deps.fetch ?? fetch, ...(deps.llamarWeb && { llamar: deps.llamarWeb }) });
        return json(r, r.error ? 400 : 200);
      } catch (e) {
        return error(`no pude armarla: ${String(e?.message ?? 'error').slice(0, 60)}`, 502);
      }
    }
    if (sub === '/ficha/revisar') {
      const texto = String(b.texto ?? '');
      const pf = parsearFicha(texto);
      const resumen = (await ejecutar('resumen', [])).valor ?? {};
      const conflictos = revisarFicha(texto, { pedidos: negocio.pedidos === true, productos: resumen.activos ?? 0 });
      if (!pf.ok || b.charlas === false) return json({ ...resumenFicha(pf), conflictos, charlas: [] });
      // Cada charla de prueba arranca de cero, con los productos del negocio. No se manda nada a nadie.
      const charlas = [];
      for (const prueba of CHARLAS_DE_PRUEBA) {
        const r = await deps.probar(pf.ficha, negocio.id, [prueba.mensaje], null);
        const ultima = r.charla.at(-1) ?? {};
        charlas.push({ mensaje: prueba.mensaje, respuestas: ultima.respuestas ?? [], que: ultima.que, ...evaluarPrueba(prueba, ultima) });
      }
      return json({ ...resumenFicha(pf), conflictos, charlas });
    }
    return error('no existe', 404);
  }

  // Lo que sigue es solo del equipo: la ficha del asistente y la charla de prueba.
  if (sub === '/ficha' || sub === '/probar' || sub === '/uso') {
    if (!admin) return error('la ficha del asistente la maneja el equipo de Zustro Labs', 403);
    if (request.method === 'GET' && sub === '/ficha') {
      const f = await deps.negocios.ficha(negocio.id);
      return json({ texto: f?.texto ?? '', activa: Boolean(f?.activa), actualizada: f?.actualizada ?? null, ...(f?.texto ? resumenFicha(parsearFicha(f.texto)) : {}) });
    }
    if (request.method === 'PUT' && sub === '/ficha') {
      const b = await leerJson(request);
      if (!b) return error('pedido inválido');
      const pf = parsearFicha(String(b.texto ?? ''));
      if (!pf.ok) return json({ ...resumenFicha(pf), error: 'la ficha tiene errores' }, 400);
      if (b.activa === true && pf.pendientes.length) return json({ ...resumenFicha(pf), error: 'faltan completar cosas: se guarda solo apagada' }, 400);
      const r = await deps.negocios.guardarFicha(negocio.id, { texto: String(b.texto), activa: b.activa === true });
      if (r?.error) return error(r.error);
      return json({ ...resumenFicha(pf), activa: b.activa === true });
    }
    if (request.method === 'POST' && sub === '/probar') {
      const b = await leerJson(request);
      if (!b) return error('pedido inválido');
      const pf = parsearFicha(String(b.texto ?? (await deps.negocios.ficha(negocio.id))?.texto ?? ''));
      if (!pf.ok) return json({ ...resumenFicha(pf), error: 'la ficha tiene errores' }, 400);
      const mensajes = (Array.isArray(b.mensajes) ? b.mensajes : ['hola']).map((x) => String(x).slice(0, 500)).filter(Boolean).slice(0, 12);
      // `estado` (lo que devolvió el mensaje anterior) sigue la misma charla: idioma elegido y pausa de PERSONA.
      return json({ ...resumenFicha(pf), ...(await deps.probar(pf.ficha, negocio.id, mensajes, b.estado ?? null)) });
    }
    if (request.method === 'GET' && sub === '/uso') return json({ uso: await deps.negocios.uso(negocio.id), limiteDia: limiteDiaDe(negocio) });
  }
  return error('no existe', 404);
}

/**
 * Alta y cambios de negocios, quién entra, qué canales tiene y qué cuentas de Instagram son suyas. Solo el equipo:
 * desde la app (Access) o desde el script de alta de clientes (index.js, con IG_ADMIN_CLAVE).
 */
export async function administrar(request, ruta, deps, now) {
  if (request.method === 'GET' && ruta === '/negocios') {
    const hoy = new Date(now).toISOString().slice(0, 10);
    const out = [];
    for (const n of await deps.negocios.list()) {
      const f = await deps.negocios.ficha(n.id);
      const uso = await deps.negocios.uso(n.id);
      out.push({ ...n, limiteDia: limiteDiaDe(n), canales: canalesDe(n), asistente: { tiene: Boolean(f?.texto), activo: Boolean(f?.activa) }, usoHoy: uso.find((u) => u.dia === hoy)?.n ?? 0, usoMes: uso.filter((u) => u.dia.slice(0, 7) === hoy.slice(0, 7)).reduce((a, u) => a + u.n, 0) });
    }
    return json({ negocios: out });
  }
  if (request.method === 'GET' && ruta === '/cuentas') {
    const lista = (await deps.cuentas?.list?.()) ?? [];
    const out = [];
    // La del estudio también aparece (ZL-124): vinculada a un negocio con ficha activa, responde con esa ficha y su catálogo.
    for (const c of lista) {
      out.push({ id: c.id, username: c.username, negocio: (await deps.negocios.deCuenta(c.id))?.id ?? null, ...(!deps.esCliente(c) && { estudio: true }) });
    }
    return json({ cuentas: out });
  }
  const b = request.method === 'GET' ? null : await leerJson(request);
  if (request.method === 'POST' && ruta === '/negocios') {
    if (!b) return error('pedido inválido');
    const r = await deps.negocios.guardar(null, { nombre: b.nombre, emails: correosDe(Array.isArray(b.emails) ? b.emails.join(',') : b.emails), cuentas: [], ...(b.canales && { canales: leerCanales(b.canales) }) });
    if (r.error) return error(r.error);
    // Los correos van solos a Access (ZL-138): sin esto, al cliente no le llega el código para entrar.
    return json({ ...r.negocio, acceso: deps.acceso ? await deps.acceso(r.negocio.emails) : null }, 201);
  }
  const m = /^\/negocios\/([a-z0-9]{4,40})$/.exec(ruta);
  if (m && request.method === 'PUT') {
    if (!b) return error('pedido inválido');
    const cambios = {};
    if (b.nombre !== undefined) cambios.nombre = b.nombre;
    if (b.emails !== undefined) cambios.emails = correosDe(Array.isArray(b.emails) ? b.emails.join(',') : b.emails);
    if (b.cuentas !== undefined) {
      const conectadas = new Map(((await deps.cuentas?.list?.()) ?? []).map((c) => [String(c.id), c]));
      for (const c of b.cuentas) {
        const cu = conectadas.get(String(c));
        if (!cu) return error(`la cuenta ${c} no está conectada`);
      }
      cambios.cuentas = b.cuentas.map(String);
    }
    if (b.limiteDia !== undefined) cambios.limiteDia = b.limiteDia;
    if (b.empleados !== undefined) cambios.empleados = correosDe(Array.isArray(b.empleados) ? b.empleados.join(',') : b.empleados);
    if (b.canales !== undefined) cambios.canales = leerCanales(b.canales);
    if (typeof b.pedidos === 'boolean') cambios.pedidos = b.pedidos;
    // La invitación de Instagram ya se mandó (ZL-148): se borra del negocio.
    if (b.invitacionIg === null) cambios.invitacionIg = null;
    const antes = cambios.emails ? await deps.negocios.get(m[1]) : null;
    const r = await deps.negocios.guardar(m[1], cambios);
    if (r.error) return error(r.error);
    // ZL-166: los correos que se sacaron también salen de Access (si no entran a otro negocio ni son del equipo).
    const sacados = antes ? antes.emails.filter((e) => !r.negocio.emails.includes(e)) : [];
    const quitados = sacados.length && deps.quitarAcceso ? await deps.quitarAcceso(sacados) : null;
    return json({ ...r.negocio, acceso: cambios.emails && deps.acceso ? await deps.acceso(r.negocio.emails) : null, ...(quitados && { quitados }) });
  }
  return error('no existe', 404);
}

/**
 * Por dónde escribió la persona y cómo encontrarla (ZL-153): en WhatsApp, su número (sale de la charla); en Instagram,
 * su usuario si se guardó. Se arma al pedir la lista: nunca va en la URL ni en los avisos al celular.
 * → {canal: 'whatsapp'|'instagram', texto, enlace} o null (una charla de prueba).
 */
export function contactoDeCharla(charla, canal, usuario = null) {
  const wa = /^yc:\d+:(\d{6,16})$/.exec(String(charla ?? ''));
  if (wa) return { canal: 'whatsapp', texto: '+' + wa[1], enlace: 'https://wa.me/' + wa[1] };
  if (canal === 'ig' || /^ig:/.test(String(charla ?? ''))) {
    const u = /^[\w.]{1,30}$/.test(String(usuario ?? '')) ? String(usuario) : null;
    return u
      ? { canal: 'instagram', texto: '@' + u, enlace: 'https://ig.me/m/' + u }
      : { canal: 'instagram', texto: 'Instagram (sin usuario)', enlace: 'https://www.instagram.com/direct/inbox/' };
  }
  return null;
}

/** Le suma `contacto` a cada pedido o consulta (el usuario de Instagram se busca una vez por charla). */
async function conContacto(lista, deps) {
  const usuarios = new Map();
  for (const x of lista ?? []) {
    if (!x) continue;
    let u = null;
    if (/^ig:/.test(String(x.charla ?? '')) && deps.charlasNegocio?.usuario) {
      if (!usuarios.has(x.charla)) usuarios.set(x.charla, await deps.charlasNegocio.usuario(x.charla).catch(() => null));
      u = usuarios.get(x.charla);
    }
    x.contacto = contactoDeCharla(x.charla, x.canal, u);
  }
}

/**
 * ZL-157: lo que la app le muestra al dueño cuando el aviso no salió solo: por qué, el texto y el link para mandarlo
 * desde su WhatsApp (con el texto ya escrito) o su Instagram (el texto se copia). Desde su app no hay límite de 24 h.
 */
export function avisoManual(charla, canal, texto, motivo, usuario = null) {
  const k = contactoDeCharla(charla, canal, usuario);
  const fuera = motivo === 'fuera_24h';
  const base = { pendiente: true, fuera24h: fuera, motivo: fuera ? 'pasaron más de 24 h desde su último mensaje' : String(motivo ?? 'no se pudo mandar'), texto };
  if (k?.canal === 'whatsapp') return { ...base, canal: 'whatsapp', enlace: `${k.enlace}?text=${encodeURIComponent(texto)}` };
  if (k?.canal === 'instagram') return { ...base, canal: 'instagram', enlace: k.enlace };
  return base;
}

/** ZL-157: a cada pedido con un aviso que todavía no le llegó al comprador, la tarjeta le suma el mensaje listo. */
async function conAvisoPendiente(lista, deps) {
  if (!deps.charlasNegocio?.avisos) return;
  const porCharla = new Map();
  for (const p of lista ?? []) {
    if (!p?.charla) continue;
    if (!porCharla.has(p.charla)) porCharla.set(p.charla, await deps.charlasNegocio.avisos(p.charla).catch(() => []));
    const texto = porCharla.get(p.charla).filter((t) => new RegExp(`N\\.º ${Number(p.numero)}(?!\\d)`).test(String(t))).at(-1);
    if (texto) p.avisoPendiente = avisoManual(p.charla, p.canal, texto, 'fuera_24h', /^@/.test(p.contacto?.texto ?? '') ? p.contacto.texto.slice(1) : null);
  }
}
