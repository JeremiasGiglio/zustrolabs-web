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
import { agregarAAcceso } from './acceso.js';
import { ajustesDeVenta, limiteDiaDe } from './atencion.js';
import { parsearFicha, resumenFicha } from './negocio.js';
import { armarDesdeWeb, camposDeFicha, CHARLAS_DE_PRUEBA, evaluarPrueba, fichaDeCampos, PLANTILLAS, revisarFicha } from './fichas-editor.js';
import { APP_CSS, APP_HTML, appJs } from './negocios-ui.js';
import { ICONO_SVG, MANIFIESTO, suscripcionValida, SW_JS } from './push.js';
import { diaLocal } from './reporte.js';

export const NEGOCIOS_HOST = 'negocios.zustrolabs.com';
/** ZL-158: Meta da 1.000 mensajes de servicio gratis por número por mes (desde el 1/10/2026); la app avisa a los 800. */
export const GRATIS_WA_MES = 1000;
export const AVISO_WA_MES = 800;
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

/** Lo que se le manda al comprador cuando el negocio cambia el estado de su pedido (texto fijo, sin IA). */
export function textoEstado(p, estado, motivo, negocio, ajustes = null) {
  const n = `N.º ${p.numero}`;
  const porque = motivo ? ` (${motivo})` : '';
  if (estado === 'aceptado') {
    // ZL-148: con los ajustes de venta, el comprador recibe en el mismo mensaje cómo pagar y cómo se entrega: el negocio
    // no tiene que escribir nada a mano.
    const aj = ajustes ?? {};
    const envio = p.comprador?.entrega === 'envio';
    const partes = [`¡Listo! ${negocio} aceptó tu pedido ${n}.`];
    if (aj.pago) partes.push(`Cómo pagar: ${aj.pago}`);
    if (envio && aj.envio) partes.push(`Envío: ${aj.envio}`);
    if (!envio && aj.retiro) partes.push(`Retiro: ${aj.retiro}`);
    partes.push(aj.pago || (envio ? aj.envio : aj.retiro) ? 'Cualquier duda, escribinos por acá.' : 'En un rato te escriben por acá para coordinar el pago y la entrega.');
    return partes.join('\n');
  }
  if (estado === 'rechazado') return `Lo siento: ${negocio} no puede tomar tu pedido ${n}${porque}.`;
  if (estado === 'pagado') return `${negocio} recibió el pago de tu pedido ${n}. ¡Gracias!`;
  if (estado === 'entregado') return `Tu pedido ${n} figura como entregado. ¡Gracias por tu compra!`;
  if (estado === 'cancelado') return `Tu pedido ${n} fue cancelado${porque}.`;
  return null;
}

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
const sinSecretos = (r) => ({ clave: r.clave, negocio: r.negocio, numero: r.numero, ecos: r.ecos, creado: r.creado, ultimo: r.ultimo || null });

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
    return administrar(request, ruta.slice(6), { ...deps, acceso: (emails) => agregarAAcceso(env, deps.fetch ?? fetch, env.NEGOCIOS_HOST || NEGOCIOS_HOST, emails) }, now);
  }

  const m = /^\/n\/([a-z0-9]{4,40})(\/.*)?$/.exec(ruta);
  if (!m) return error('no existe', 404);
  const negocio = await deps.negocios.get(m[1]);
  // Si no es suyo, como si no existiera: no se revela qué negocios hay.
  if (!negocio || (!admin && !negocio.emails.includes(email))) return error('no existe', 404);
  const sub = m[2] ?? '';
  const cat = deps.catalogo(negocio.id);
  const ejecutar = async (op, args) => delCatalogo(await cat.ejecutar(op, args));

  if (request.method === 'GET' && sub === '') {
    const f = await deps.negocios.ficha(negocio.id);
    const pf = f?.texto ? parsearFicha(f.texto) : null;
    const r = await ejecutar('resumen', []);
    const cuentas = [];
    for (const c of negocio.cuentas) cuentas.push({ id: c, username: (await deps.cuentas?.get(c))?.username ?? null });
    return json({
      negocio: { id: negocio.id, nombre: negocio.nombre, cuentas, canales: canalesDe(negocio), pedidos: negocio.pedidos === true, ajustes: ajustesDeVenta(negocio.ajustes), ...(admin && { emails: negocio.emails, limiteDia: limiteDiaDe(negocio) }) },
      resumen: r.valor ?? null,
      asistente: { tiene: Boolean(f?.texto), activo: Boolean(f?.activa), nombre: pf?.ficha?.nombre ?? null, precios: pf?.ficha?.precios ?? false },
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
        cuentas.push({ id, username: c?.username ?? null, conectada: Boolean(c), venceEnDias: c ? Math.floor((c.vence - now) / 86_400_000) : null });
      }
      return json({ cuentas, disponible: Boolean(app && env.IG_APP_SECRET), invitacion: negocio.invitacionIg ?? null, canal: canalesDe(negocio).instagram });
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
  const mo = /^\/pedidos\/(\d{1,9})$/.exec(sub);
  if (mo && request.method === 'GET') {
    const r = await ejecutar('pedido', [Number(mo[1])]);
    if (r.resp) return r.resp;
    await conContacto([r.valor], deps);
    await conAvisoPendiente([r.valor], deps);
    return json(r.valor);
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
    const r = await ejecutar('cambiarEstado', [Number(mo[1]), b.estado, email, { motivo, horas: b.horas ?? aj.reservaHoras }]);
    if (r.resp) return r.resp;
    // Se le avisa al comprador por el mismo canal (dentro de las 24 h de Meta). Si falla, el estado igual quedó.
    const texto = textoEstado(r.valor, b.estado, motivo, negocio.nombre, aj);
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
    return json({ clave: (await deps.negocios.vapid()).publica, celulares: (await deps.negocios.suscripcionesPush(negocio.id)).length });
  }
  if (request.method === 'POST' && sub === '/push') {
    const b = await leerJson(request);
    if (!suscripcionValida(b?.suscripcion)) return error('este navegador no mandó una suscripción válida');
    const n = await deps.negocios.suscribirPush(negocio.id, b.suscripcion, email);
    return json({ ok: true, celulares: n });
  }
  if (request.method === 'POST' && sub === '/push/probar') {
    const enviados = deps.avisarCelulares ? await deps.avisarCelulares(negocio.id, { titulo: 'Avisos activados', cuerpo: 'Así te va a llegar cada pedido o consulta nueva.' }) : 0;
    return json({ enviados });
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
    return json({ dias, charlas: m.charlas ?? 0, audios: m.audios ?? 0, pases: m.pases ?? 0, seguimientos: m.seguimientos ?? 0, respuestas: uso, ...c, whatsappMes });
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
    await deps.charlasNegocio.devolver(k.valor.charla);
    return json({ ok: true, pausaHasta: 0 });
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
    if (b.canales !== undefined) cambios.canales = leerCanales(b.canales);
    if (typeof b.pedidos === 'boolean') cambios.pedidos = b.pedidos;
    // La invitación de Instagram ya se mandó (ZL-148): se borra del negocio.
    if (b.invitacionIg === null) cambios.invitacionIg = null;
    const r = await deps.negocios.guardar(m[1], cambios);
    if (r.error) return error(r.error);
    return json({ ...r.negocio, acceso: cambios.emails && deps.acceso ? await deps.acceso(r.negocio.emails) : null });
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
