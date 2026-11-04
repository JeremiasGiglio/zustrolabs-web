// App de los negocios clientes (ZL-121), en negocios.zustrolabs.com, detrás de su propia app de Cloudflare Access.
// - Entra quien Access deja pasar (código por mail). Acá se decide qué ve: el equipo (PANEL_EMAILS) ve todos los
//   negocios y administra; cada persona de un negocio ve SOLO los negocios donde está su correo.
// - Cada negocio tiene su base (Durable Object «Catalogo»): productos, stock con historial, fotos, importación.
// - La ficha del asistente la edita solo el equipo (decisión del 3/11/2026); el negocio ve si está activo.
// - Los cambios piden la cabecera «x-zl: 1» y el mismo origen: otra página no puede mandar pedidos con la sesión.
// No importa nada de Cloudflare: el catálogo y el registro llegan en `deps` (index.js), así se prueba con node.

import { correosDe, emailDeAcceso } from './panel.js';
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
    return administrar(request, ruta.slice(6), deps, now);
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
      negocio: { id: negocio.id, nombre: negocio.nombre, cuentas, canales: canalesDe(negocio), ...(admin && { emails: negocio.emails, limiteDia: negocio.limiteDia }) },
      resumen: r.valor ?? null,
      asistente: { tiene: Boolean(f?.texto), activo: Boolean(f?.activa), nombre: pf?.ficha?.nombre ?? null, precios: pf?.ficha?.precios ?? false },
      admin,
    });
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
      return json({ ...resumenFicha(pf), charla: await deps.probar(pf.ficha, negocio.id, mensajes) });
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
    return r.error ? error(r.error) : json(r.negocio, 201);
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
    const r = await deps.negocios.guardar(m[1], cambios);
    return r.error ? error(r.error) : json(r.negocio);
  }
  return error('no existe', 404);
}
