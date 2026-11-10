// App de los negocios clientes (ZL-121), en negocios.zustrolabs.com, detrás de su propia app de Cloudflare Access.
// - Entra quien Access deja pasar (código por mail). Acá se decide qué ve: el equipo (PANEL_EMAILS) ve todos los
//   negocios y administra; cada persona de un negocio ve SOLO los negocios donde está su correo.
// - Cada negocio tiene su base (Durable Object «Catalogo»): productos, stock con historial, fotos, importación.
// - La ficha del asistente la edita solo el equipo (decisión del 3/11/2026); el negocio ve si está activo.
// - Los cambios piden la cabecera «x-zl: 1» y el mismo origen: otra página no puede mandar pedidos con la sesión.
// No importa nada de Cloudflare: el catálogo y el registro llegan en `deps` (index.js), así se prueba con node.

import { correosDe, emailDeAcceso } from './panel.js';
import { borrarWebhook, claveNueva, crearWebhook, normalizar, numeroE164 } from './ycloud.js';
import { urlAutorizar } from './instagram.js';
import { agregarAAcceso } from './acceso.js';
import { parsearFicha, resumenFicha } from './negocio.js';
import { APP_CSS, APP_HTML, appJs } from './negocios-ui.js';

export const NEGOCIOS_HOST = 'negocios.zustrolabs.com';
const MAX_JSON = 2_000_000;
const SEGURIDAD = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};
/** Canales del negocio; los negocios creados antes de ZL-122 tienen solo Instagram. */
export const canalesDe = (n) => n?.canales ?? { instagram: true, whatsapp: false };

const resp = (cuerpo, status, tipo, extra = {}) => new Response(cuerpo, { status, headers: { 'content-type': tipo, ...SEGURIDAD, ...extra } });
const json = (data, status = 200) => resp(JSON.stringify(data), status, 'application/json; charset=utf-8');
const error = (mensaje, status = 400, campo) => json({ error: mensaje, ...(campo && { campo }) }, status);

/** Lo que se le manda al comprador cuando el negocio cambia el estado de su pedido (texto fijo, sin IA). */
export function textoEstado(p, estado, motivo, negocio) {
  const n = `N.º ${p.numero}`;
  const porque = motivo ? ` (${motivo})` : '';
  if (estado === 'aceptado') return `Tu pedido ${n} fue aceptado por ${negocio}. En un rato te escriben por acá para coordinar el pago y la entrega.`;
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
export const appCompartida = async (apps) => ((await apps?.list?.()) ?? []).filter((a) => a.compartida).sort((x, y) => (y.creado ?? 0) - (x.creado ?? 0))[0] ?? null;
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
      negocio: { id: negocio.id, nombre: negocio.nombre, cuentas, canales: canalesDe(negocio), pedidos: negocio.pedidos === true, ...(admin && { emails: negocio.emails, limiteDia: negocio.limiteDia }) },
      resumen: r.valor ?? null,
      asistente: { tiene: Boolean(f?.texto), activo: Boolean(f?.activa), nombre: pf?.ficha?.nombre ?? null, precios: pf?.ficha?.precios ?? false },
      admin,
    });
  }

  // Instagram del negocio (ZL-137): pedir la invitación, «Conectar Instagram» y desconectar.
  if (sub === '/instagram' || sub.startsWith('/instagram/')) {
    if (!deps.cuentas || !deps.apps) return error('sin memoria', 503);
    const app = await appCompartida(deps.apps);
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
    return r.resp ?? json({ ...r.valor, encendidos: negocio.pedidos === true });
  }
  const mo = /^\/pedidos\/(\d{1,9})$/.exec(sub);
  if (mo && request.method === 'GET') {
    const r = await ejecutar('pedido', [Number(mo[1])]);
    return r.resp ?? json(r.valor);
  }
  if (mo && request.method === 'POST') {
    const b = await leerJson(request);
    if (!b || !['aceptado', 'rechazado', 'pagado', 'entregado', 'cancelado'].includes(b.estado)) return error('estado inválido');
    const motivo = String(b.motivo ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 200);
    const r = await ejecutar('cambiarEstado', [Number(mo[1]), b.estado, email, { motivo, horas: b.horas ?? null }]);
    if (r.resp) return r.resp;
    // Se le avisa al comprador por el mismo canal (dentro de las 24 h de Meta). Si falla, el estado igual quedó.
    const texto = textoEstado(r.valor, b.estado, motivo, negocio.nombre);
    const aviso = texto && deps.avisarComprador ? await deps.avisarComprador(negocio, r.valor.charla, texto) : null;
    return json({ ...r.valor, aviso });
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
    if (request.method === 'GET' && sub === '/uso') return json({ uso: await deps.negocios.uso(negocio.id), limiteDia: negocio.limiteDia });
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
      out.push({ ...n, canales: canalesDe(n), asistente: { tiene: Boolean(f?.texto), activo: Boolean(f?.activa) }, usoHoy: uso.find((u) => u.dia === hoy)?.n ?? 0, usoMes: uso.filter((u) => u.dia.slice(0, 7) === hoy.slice(0, 7)).reduce((a, u) => a + u.n, 0) });
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
    const r = await deps.negocios.guardar(m[1], cambios);
    if (r.error) return error(r.error);
    return json({ ...r.negocio, acceso: cambios.emails && deps.acceso ? await deps.acceso(r.negocio.emails) : null });
  }
  return error('no existe', 404);
}
