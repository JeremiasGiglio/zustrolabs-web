// Worker «zustrolabs-whatsapp»: el WhatsApp y el Instagram de Zustro Labs.
// - zustrolabs.com/api/whatsapp → webhook de la Cloud API de Meta (whatsapp.js).
// - zustrolabs.com/api/instagram → webhook de los mensajes directos de Instagram (instagram.js);
//   /api/instagram/conectar → link para que una cuenta (la del estudio o la de un cliente) se conecte con su Instagram.
// - equipo.zustrolabs.com → panel de atención humana, detrás de Cloudflare Access (panel.js).
// Separado del Radar Croacia: otra app de Meta, otro número, otra memoria y la clave de IA del estudio.
import { adaptadores, almacenPrueba, crearAtencion } from './atencion.js';
import { appDe, conectarCuenta, enviarIg, esInstagram, leerEstado, leerWebhookIg, mantenerCuentas, nombreDe, paginaConectado, secretosDe, urlAutorizar } from './instagram.js';
import { parsearFicha, perfilNegocio, preguntadorNegocio, resumenFicha } from './negocio.js';
import { administrar, appNegocios, canalesDe, NEGOCIOS_HOST } from './negocios.js';
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
    return { memoria: deps.memoria ?? null, charlas: deps.charlas ?? null, cuentas: deps.cuentas ?? null, apps: deps.apps ?? null, fichas: deps.fichas ?? null, negocios: deps.negocios ?? null };
  }
  if (!env.ATENCION) return { memoria: null, charlas: null, cuentas: null, apps: null, fichas: null, negocios: null };
  return adaptadores(env.ATENCION.get(env.ATENCION.idFromName('zustrolabs')));
}

/** La base de un negocio (Durable Object «Catalogo», una por negocio), o la de los tests. → {ejecutar(op, args)} */
const catalogoDe = (env, deps) => deps.catalogo ?? ((id) => (env.CATALOGO ? env.CATALOGO.get(env.CATALOGO.idFromName(`negocio:${id}`)) : null));

/** Lo que la IA consulta antes de responder: los productos de ese negocio que vienen al caso. */
const consultaCatalogo = (env, deps, negocioId, ficha) => {
  const cat = negocioId ? catalogoDe(env, deps)(negocioId) : null;
  if (!cat) return null;
  return async (texto) => {
    const r = await cat.ejecutar('paraAsistente', [texto, { precios: ficha.precios }]);
    return r?.ok ? r.valor : null;
  };
};

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
  const code = url.searchParams.get('code');
  const estado = await leerEstado(env.IG_APP_SECRET, url.searchParams.get('state'), now);
  if (!code || !estado) {
    return html(paginaConectado({ ok: false, error: url.searchParams.get('error_reason') ? 'no aceptaste los permisos' : 'vuelta inválida' }), 400);
  }
  if (!cuentas) return html(paginaConectado({ ok: false, error: 'sin memoria' }), 503);
  const app = await appDe(env, apps, estado.app);
  if (!app) return html(paginaConectado({ ok: false, error: 'app desconocida' }), 404);
  try {
    const c = await conectarCuenta(env, { code, origen, now, app }, fetchImpl);
    await cuentas.put(c.id, { username: c.username, token: c.token, vence: c.vence, app: c.app });
    console.log(JSON.stringify({ canal: 'ig', que: 'conectada', suscripta: c.suscripta, propia: app.id === String(env.IG_APP_ID) }));
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
    let perfil, preguntarEv = preguntar, charlasEv = charlas;
    if (negocio) {
      const f = cliente ? await a.fichas?.get(ev.cuenta) : fichaEstudio;
      if (!f?.texto || !f.activa) { log({ ok: true, que: f?.texto ? 'ficha_inactiva' : 'sin_ficha' }); continue; }
      const pf = parsearFicha(f.texto);
      if (!pf.ok) { log({ ok: false, que: 'ficha_invalida' }); continue; }
      perfil = perfilNegocio(pf.ficha);
      const dueño = await a.negocios?.deCuenta(ev.cuenta);
      // El negocio eligió sus canales: con Instagram apagado, esta cuenta no responde.
      if (dueño && !canalesDe(dueño)[canal.clave === 'ig' ? 'instagram' : 'whatsapp']) { log({ ok: true, que: 'canal_apagado' }); continue; }
      const catalogo = consultaCatalogo(env, deps, dueño?.id, pf.ficha);
      const ia = deps.preguntarNegocio ? deps.preguntarNegocio(pf.ficha, catalogo) : preguntadorNegocio(env, pf.ficha, { catalogo });
      // Tope por negocio: uno con mucho movimiento no deja sin IA a los demás. También es lo que se le factura.
      preguntarEv = async (texto, idioma) => {
        if (dueño && a.negocios && (await a.negocios.contarUso(dueño.id)) > (dueño.limiteDia ?? 300)) return { respuesta: '', vacia: true, tope: true, persona: true, fuera_de_tema: false, notas: ['tope_negocio'] };
        return ia(texto, idioma);
      };
      if (cliente) charlasEv = null;
    }
    try {
      // Sin límites no se responde: son el freno al abuso y al gasto en IA.
      if (!env.LIMITE?.limit || !env.LIMITE_GLOBAL?.limit) { log({ ok: false, que: 'config' }); continue; }
      // Por persona: pasado el límite, silencio (contestar cada mensaje sería otra forma de abuso).
      if (!(await env.LIMITE.limit({ key: esInstagram(ev.from) ? ev.from : `wa:${ev.from}` })).success) { log({ ok: true, que: 'limite' }); continue; }
      // El de toda la cuenta (los dos canales juntos) se mira recién antes de gastar IA (no corta la atención humana ni BORRAR).
      const cupo = async () => ((await env.LIMITE_GLOBAL.limit({ key: 'ia' })).success ? 'ok' : 'global');
      const r = await atender(ev, { memoria, charlas: charlasEv, preguntar: preguntarEv, now, cupo, ...(perfil && { perfil }) });
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

/** La cuenta es de un cliente si se conectó con una app que no es la del estudio. */
export const esCliente = (env, cuenta) => Boolean(cuenta?.app && cuenta.app !== String(env.IG_APP_ID ?? ''));

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

/** Charla de prueba con una ficha (y los productos del negocio, si se sabe cuál), sin tocar la memoria real ni mandar nada. */
async function probarFicha(env, ficha, mensajes, deps, negocioId = null) {
  const memoria = adaptadores(crearAtencion(almacenPrueba())).memoria;
  const perfil = perfilNegocio(ficha);
  const catalogo = consultaCatalogo(env, deps, negocioId, ficha);
  const preguntar = deps.preguntarNegocio ? deps.preguntarNegocio(ficha, catalogo) : preguntadorNegocio(env, ficha, { catalogo });
  const now = deps.now ?? Date.now();
  const charla = [];
  for (const [i, texto] of mensajes.entries()) {
    const ev = { id: `prueba-${i}`, from: 'ig:0.0', ts: now / 1000, kind: 'text', text: texto };
    try {
      const r = await atender(ev, { memoria, charlas: null, preguntar, now: now + i, perfil });
      charla.push({ mensaje: texto, respuestas: r.send.map((m) => m.text?.body ?? ''), que: r.metrica, notas: r.notas ?? [] });
    } catch (e) {
      charla.push({ mensaje: texto, respuestas: [perfil.textos().falla], que: 'error', notas: [String(e?.message ?? 'error').slice(0, 40)] });
    }
  }
  return charla;
}

const leerFicha = async (request) => {
  try {
    const b = await request.json();
    return { texto: String(b?.texto ?? ''), activa: b?.activa === true, mensajes: Array.isArray(b?.mensajes) ? b.mensajes : null };
  } catch {
    return null;
  }
};

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
    return administrar(request, ruta, { ...a, esCliente: (c) => esCliente(env, c) }, now);
  }
  if (request.method === 'GET' && ruta === '/estado') {
    const listaApps = (await apps.list()).map((a) => ({ id: a.id, nombre: a.nombre, creado: a.creado }));
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
    await apps.put(id, { secreto, nombre });
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
    const dueño = b.cuenta ? await almacen(env, deps).negocios?.deCuenta(String(b.cuenta)) : null;
    return json({ ...resumenFicha(pf), charla: await probarFicha(env, pf.ficha, mensajes, deps, dueño?.id ?? null) }, 200);
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
        probar: (ficha, negocioId, mensajes) => probarFicha(env, ficha, mensajes, deps, negocioId),
      });
    }
    if (url.hostname === (env.PANEL_HOST || PANEL_HOST)) {
      const a = almacen(env, deps);
      return panel(request, env, { fetch: fetchImpl, now: deps.now, store: a.memoria, chats: a.charlas, send: (e, m) => mandarA(e, m, fetchImpl, a.cuentas) });
    }
    if (url.pathname === '/api/whatsapp') return webhook(request, env, ctx, deps, CANALES.wa);
    if (url.pathname === '/api/instagram') return webhook(request, env, ctx, deps, CANALES.ig);
    if (url.pathname === '/api/instagram/conectar' || url.pathname === '/api/instagram/conectar/vuelta') return conectar(request, env, deps);
    if (url.pathname.startsWith('/api/instagram/admin/')) return admin(request, env, deps);
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
