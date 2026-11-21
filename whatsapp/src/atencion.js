// Memoria del WhatsApp de Zustro Labs en un solo Durable Object («Atencion»), con almacenamiento SQLite.
// Por qué un Durable Object y no KV:
// - atiende los pedidos de a uno: dos mensajes que llegan juntos no se pisan (con KV, el panel perdía mensajes);
// - no gasta la cuota gratis de escrituras de KV, que es de toda la cuenta y la usa el bot del Radar.
// Qué guarda, con vencimiento (una alarma diaria borra lo vencido y cada lectura lo ignora):
// - wa:<número>    → {idioma, humanoHasta}: 90 días desde el último cambio. Nunca el texto.
//                    (Instagram usa el mismo lugar con `ig:<id>` en vez del número: wa:ig:<id>, chat:ig:<id>.)
// - id:<wamid>     → para no responder dos veces un reintento de Meta: 1 hora.
// - uso:<número>:<día> → cuántas respuestas de la IA tuvo ese número ese día: 2 días.
// - chat:<número>  → la charla con atención humana (solo después de PERSONA): 30 días desde el último mensaje.
// - igc:<cuenta>   → cuenta de Instagram conectada {id, username, token, tokenVence, app}: no vence (se renueva el token).
// - igapp:<id>     → app de Instagram de un cliente {id, secreto, nombre, creado}: no vence.
// - neg:<id>       → negocio cliente {id, nombre, emails, cuentas, canales {instagram, whatsapp}, limiteDia, creado}: no vence.
//   negmail:<correo> → {ids} y negcta:<cuenta> → {id}: índices para encontrar el negocio de quien entra a la app o
//   de la cuenta de Instagram que recibió un mensaje.
// - negf:<id>      → ficha del asistente de ese negocio {texto, activa, actualizada} (ZL-113): no vence.
// - neguso:<id>:<día> → respuestas de la IA de ese negocio ese día: 40 días (para el tope diario y para facturar).
// Este módulo no importa nada de Cloudflare: se prueba con un almacenamiento simulado (ver test/).

import { clavesVapid } from './push.js';
import { ZONA_POR_DEFECTO, ZONAS } from './reporte.js';

/** ZL-160: cómo responde los comentarios de Instagram (src/comentarios.js). */
export const MODOS_COMENTARIOS = ['publico_privado', 'privado'];
/** ZL-160: lo que eligió el negocio (apagado si nunca lo tocó). */
export function configComentarios(negocio) {
  const c = negocio?.comentarios ?? {};
  return { activo: c.activo === true, modo: MODOS_COMENTARIOS.includes(c.modo) ? c.modo : 'publico_privado' };
}

/** Lo que llega de la app → lo que se guarda (solo los dos campos, con valores válidos). */
export function normalizarComentarios(datos, antes = null) {
  const a = configComentarios({ comentarios: antes });
  return {
    activo: typeof datos?.activo === 'boolean' ? datos.activo : a.activo,
    modo: MODOS_COMENTARIOS.includes(datos?.modo) ? datos.modo : a.modo,
  };
}


export const DIA_MS = 24 * 3600_000;
/** Índice de seguimientos: `seg:<hora con 15 dígitos>:<num>`, así se ordenan por hora. */
const claveSeguimiento = (cuando, num) => `seg:${String(Math.max(0, Math.floor(cuando))).padStart(15, '0')}:${num}`;

/**
 * Los ajustes de venta que carga el propio negocio (ZL-148): cuánto se guarda un pedido aceptado sin pagar, si hace
 * retiro, envío o los dos, dónde y cuándo se retira, zonas y costo de envío, y cómo se paga. Solo campos conocidos y
 * cortos; lo que no se entiende vuelve al valor de siempre.
 */
export const RESERVAS_HORAS = [2, 24, 48, 168];
const limpio = (v, n) => String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u0009\u000B-\u001F\u007F<>]/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, n);
/** ZL-159: la pausa del asistente {hasta, mensaje}; null o una fecha pasada la quitan. Máximo 60 días. */
export function pausaDe(p, now) {
  const hasta = Number(p?.hasta);
  if (!p || !Number.isFinite(hasta) || hasta <= now) return null;
  return { hasta: Math.min(hasta, now + 60 * 86_400_000), mensaje: limpio(p.mensaje, 300), desde: now };
}
/** ZL-159: el aviso del día {texto, hasta}; vacío lo quita. Dura hasta `hasta` (como mucho 7 días). */
export function avisoDiaDe(a, now) {
  const texto = limpio(a?.texto, 300);
  const hasta = Number(a?.hasta);
  if (!texto || !Number.isFinite(hasta) || hasta <= now) return null;
  return { texto, hasta: Math.min(hasta, now + 7 * 86_400_000) };
}
/** ZL-159: ¿ese correo es dueño del negocio? (los que no están en `empleados`). El equipo, siempre. */
export const esDueño = (n, email, admin = false) => admin || ((n?.emails ?? []).includes(email) && !(n?.empleados ?? []).includes(email));

/**
 * ZL-158: cuántas respuestas de IA por día tiene un negocio. 1.000 por defecto (un negocio con 100 charlas de 6
 * mensajes usa 600). Los negocios guardados con 300, el valor por defecto de antes, pasan a 1.000.
 */
export const LIMITE_DIA_NEGOCIO = 1000;
export const limiteDiaDe = (n) => (Number.isFinite(n?.limiteDia) && n.limiteDia !== 300 ? n.limiteDia : LIMITE_DIA_NEGOCIO);

export function ajustesDeVenta(a) {
  const corto = (v, n) => String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  return {
    reservaHoras: RESERVAS_HORAS.includes(Number(a?.reservaHoras)) ? Number(a.reservaHoras) : 24,
    entrega: ['ambos', 'retiro', 'envio'].includes(a?.entrega) ? a.entrega : 'ambos',
    retiro: corto(a?.retiro, 300),
    envio: corto(a?.envio, 300),
    pago: corto(a?.pago, 300),
    // ZL-152: la zona horaria del negocio (para los reportes: a qué hora y qué día escriben).
    zona: ZONAS.some(([z]) => z === a?.zona) ? a.zona : ZONA_POR_DEFECTO,
  };
}
export const RETENCION_MEMORIA_MS = 90 * DIA_MS;
/** La memoria corta de la charla (ZL-146): los últimos mensajes, que se olvidan pasadas 48 h sin escribir. */
export const HISTORIAL_MS = 2 * DIA_MS;
export const HISTORIAL_MAX = 8;
export const RETENCION_CHARLA_MS = 30 * DIA_MS;
const RETENCION_ID_MS = 3600_000;
const MAX_MENSAJES = 200;
const MAX_TEXTO = 1600;
const MAX_CHARLAS = 500;

const vigente = (x, now) => (x && (!x.vence || x.vence > now) ? x : null);
const diaDe = (now) => new Date(now).toISOString().slice(0, 10);

/** La lógica, separada del Durable Object para poder probarla con cualquier almacenamiento get/put/delete/list. */
export function crearAtencion(storage) {
  const s = storage;
  // En el Durable Object los pedidos ya no se mezclan (input gates); esta cola lo garantiza igual, también en los tests.
  let cola = Promise.resolve();
  const enSerie = (fn) => (...args) => {
    const r = cola.then(() => fn(...args));
    cola = r.catch(() => {});
    return r;
  };
  const metodos = {
    // ── Memoria por número ──
    async estado(num, now) {
      const x = vigente(await s.get(`wa:${num}`), now);
      if (!x) return null;
      const { vence, ...resto } = x;
      return resto;
    },
    async guardarEstado(num, datos, now) {
      const { idioma, humanoHasta = 0 } = datos ?? {};
      // El paso del pedido en curso (ZL-139), solo con los campos conocidos y cortos.
      const p = datos?.pedido;
      // ZL-163: también la revisión final.
      const pedido = p && ['confirmar', 'entrega', 'nombre', 'direccion', 'revisar'].includes(p.paso)
        ? { paso: p.paso, ...(['retiro', 'envio'].includes(p.entrega) && { entrega: p.entrega }), ...(p.nombre && { nombre: String(p.nombre).slice(0, 80) }), ...(p.direccion && { direccion: String(p.direccion).slice(0, 200) }) }
        : null;
      // La memoria corta de un negocio (ZL-146), solo con campos conocidos y cortos: los últimos mensajes (48 h), el
      // nombre, el resumen y el interés de la persona, la última charla y el paso de la consulta en curso.
      const corto = (v, n) => String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, n);
      const histT = Number.isFinite(datos?.histT) && now - datos.histT < HISTORIAL_MS ? datos.histT : 0;
      const hist = histT && Array.isArray(datos?.hist)
        ? datos.hist.filter((m) => m && (m.r === 'u' || m.r === 'a') && corto(m.t, 500)).slice(-HISTORIAL_MAX).map((m) => ({ r: m.r, t: corto(m.t, 500) }))
        : [];
      const k = datos?.consulta;
      const consulta = k && k.paso === 'nombre' ? { paso: 'nombre', tipo: k.tipo === 'persona' ? 'persona' : 'consulta', interes: corto(k.interes, 120) } : null;
      const contacto = {
        ...(hist.length && { hist, histT }),
        ...(corto(datos?.nombre, 60) && { nombre: corto(datos.nombre, 60) }),
        ...(corto(datos?.resumen, 300) && { resumen: corto(datos.resumen, 300) }),
        ...(corto(datos?.interes, 120) && { interes: corto(datos.interes, 120) }),
        ...(Number.isFinite(datos?.ultimo) && { ultimo: datos.ultimo }),
        ...(consulta && { consulta }),
        // ZL-149: cuándo el asistente le pasó la charla al equipo (para volver a los 15 minutos si nadie la tomó).
        ...(Number.isFinite(datos?.pase) && datos.pase > 0 && { pase: datos.pase }),
        // ZL-151: seguimiento con permiso (un recordatorio, como mucho dos) y BAJA.
        ...(datos?.seguir && Number.isFinite(datos.seguir.cuando) && ['carrito', 'consulta'].includes(datos.seguir.tipo) && { seguir: { cuando: datos.seguir.cuando, tipo: datos.seguir.tipo, negocio: corto(datos.seguir.negocio, 40), charla: corto(datos.seguir.charla, 80) } }),
        ...(Number.isFinite(datos?.seguidos) && datos.seguidos > 0 && { seguidos: Math.min(9, datos.seguidos) }),
        ...(datos?.baja === true && { baja: true }),
        // ZL-153: el usuario de Instagram de la persona (para que el negocio la encuentre rápido en la app).
        ...(/^[\w.]{1,30}$/.test(String(datos?.usuario ?? '')) && { usuario: String(datos.usuario) }),
        // ZL-162: el ofrecimiento de averiguarlo con el equipo (espera el sí), el acuse único de un pase, la confirmación
        // de BORRAR y lo que quedó pendiente al devolver la charla al asistente.
        ...(datos?.oferta && Number.isFinite(datos.oferta.t) && { oferta: { t: datos.oferta.t, pregunta: corto(datos.oferta.pregunta, 200) } }),
        ...(Number.isFinite(datos?.acuse) && { acuse: datos.acuse }),
        ...(Number.isFinite(datos?.borrarPend) && { borrarPend: datos.borrarPend }),
        ...(datos?.devuelta && Number.isFinite(datos.devuelta.t) && { devuelta: { t: datos.devuelta.t, pregunta: corto(datos.devuelta.pregunta, 200) } }),
        // ZL-159: a quién ya se le dijo que el asistente está en pausa (la pausa se identifica por cuándo empezó).
        ...(Number.isFinite(datos?.ausencia) && { ausencia: datos.ausencia }),
        // ZL-157: avisos de pedido que no salieron solos (fuera de las 24 h): se dicen cuando vuelve a escribir.
        ...(Array.isArray(datos?.avisos) && datos.avisos.some((x) => corto(x, 1000)) && { avisos: datos.avisos.map((x) => String(x ?? '').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ').trim().slice(0, 1000)).filter(Boolean).slice(-3) }),
      };
      // El índice de seguimientos (ZL-151): una clave por recordatorio pendiente, ordenada por hora, para que el cron
      // encuentre los vencidos sin recorrer toda la memoria.
      const antes = await s.get(`wa:${num}`);
      const viejo = antes?.seguir?.cuando;
      const nuevo = contacto.seguir?.cuando;
      if (viejo && viejo !== nuevo) await s.delete(claveSeguimiento(viejo, num));
      if (nuevo && viejo !== nuevo) await s.put(claveSeguimiento(nuevo, num), { num, vence: nuevo + DIA_MS });
      await s.put(`wa:${num}`, { idioma, humanoHasta, ...(pedido && { pedido }), ...contacto, vence: now + RETENCION_MEMORIA_MS });
    },
    /**
     * Ráfagas (ZL-149): quien escribe varios mensajes seguidos recibe UNA respuesta. Cada mensaje se suma acá (en una
     * sola operación del Durable Object, así dos mensajes que llegan juntos no se pisan); después de unos segundos, solo
     * el último de la ráfaga la toma entera y responde. Vence a los 2 minutos.
     */
    async sumarRafaga(num, item, now) {
      const k = `raf:${num}`;
      const r = vigente(await s.get(k), now);
      const lista = [...(r?.lista ?? []), { id: String(item.id).slice(0, 120), t: String(item.t ?? '').slice(0, 1000) }].slice(-6);
      await s.put(k, { lista, vence: now + 120_000 });
      return lista.length;
    },
    async tomarRafaga(num, id, now) {
      const k = `raf:${num}`;
      const r = vigente(await s.get(k), now);
      if (!r?.lista?.length || r.lista.at(-1).id !== String(id)) return null;
      await s.delete(k);
      // ZL-162: si todavía se está respondiendo la ráfaga anterior, esta la absorbe (una sola respuesta para todo) y la
      // anterior, al ver que ya no está en curso, no manda nada.
      const c = vigente(await s.get(`cur:${num}`), now);
      const textos = [...(c?.textos ?? []), ...r.lista.map((x) => x.t)].slice(-8);
      await s.put(`cur:${num}`, { id: String(id), textos, vence: now + 90_000 });
      return textos;
    },
    /** ZL-162: ¿sigue siendo esta la respuesta en curso de esa charla? (Si llegó otro mensaje, ya no.) */
    async cursoVigente(num, id, now) {
      const c = vigente(await s.get(`cur:${num}`), now);
      return !c || c.id === String(id);
    },
    async terminarCurso(num, id, now) {
      const c = vigente(await s.get(`cur:${num}`), now);
      if (c?.id === String(id)) await s.delete(`cur:${num}`);
    },
    /** Los seguimientos que ya tocan (ZL-151): [{num, estado}], como mucho `limite`. */
    async seguimientosVencidos(now, limite = 50) {
      const out = [];
      const lista = await s.list({ prefix: 'seg:', end: claveSeguimiento(now + 1, ''), limit: limite });
      for (const [k, v] of lista) {
        if (k > claveSeguimiento(now, '\uffff')) continue;
        const e = vigente(await s.get(`wa:${v.num}`), now);
        if (!e?.seguir || claveSeguimiento(e.seguir.cuando, v.num) !== k) { await s.delete(k); continue; }
        out.push({ num: v.num, estado: e });
        if (out.length >= limite) break;
      }
      return out;
    },
    /** Claves VAPID de los avisos al celular (ZL-151): se crean solas la primera vez. Solo la pública sale de acá. */
    async vapid() {
      let v = await s.get('vapid');
      if (!v) { v = await clavesVapid(); await s.put('vapid', v); }
      return v;
    },
    /** ZL-161: la clave con la que se firman los links de las fotos que mandamos por la charla (se crea sola). */
    async claveFotos() {
      let k = await s.get('clave_fotos');
      if (!k?.clave) {
        const b = crypto.getRandomValues(new Uint8Array(32));
        k = { clave: btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') };
        await s.put('clave_fotos', k);
      }
      return k.clave;
    },
    /** Celulares suscriptos a los avisos de un negocio (como mucho 10; el más nuevo reemplaza al mismo endpoint). */
    async suscribirPush(id, sub, email, now) {
      const k = `push:${id}`;
      const lista = ((await s.get(k))?.lista ?? []).filter((x) => x.endpoint !== sub.endpoint);
      lista.push({ endpoint: String(sub.endpoint).slice(0, 600), keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) }, email: String(email ?? '').slice(0, 120), creado: now });
      await s.put(k, { lista: lista.slice(-10) });
      return lista.length;
    },
    async suscripcionesPush(id) {
      return (await s.get(`push:${id}`))?.lista ?? [];
    },
    async borrarPush(id, endpoints) {
      const k = `push:${id}`;
      const lista = ((await s.get(k))?.lista ?? []).filter((x) => !endpoints.includes(x.endpoint));
      await s.put(k, { lista });
      return lista.length;
    },
    /** Números del negocio por día (ZL-151): charlas, audios, seguimientos, pases. 120 días. */
    async sumarMetrica(id, clave, now, dia = null) {
      // ZL-158: «enviadosWa», lo que manda el sistema por WhatsApp (Meta cobra pasando los 1.000 por número por mes).
      // ZL-160: «comentarios», los que respondió la IA; «comentariosIa», cuántos le pasaron (el tope diario).
      if (!['charlas', 'audios', 'seguimientos', 'pases', 'enviadosWa', 'topes', 'pruebas', 'comentarios', 'comentariosIa'].includes(clave)) return 0;
      const k = `negmet:${id}:${/^\d{4}-\d{2}-\d{2}$/.test(dia ?? '') ? dia : diaDe(now)}`;
      const x = (await s.get(k)) ?? {};
      x[clave] = (x[clave] ?? 0) + 1;
      x.vence = now + 120 * DIA_MS;
      await s.put(k, x);
      return x[clave];
    },
    /** Cada mensaje que recibe un negocio (ZL-152): por día y hora del negocio, y por canal. Sin texto ni número. */
    async sumarMensaje(id, { dia, hora, canal, n = 1 }, now) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dia)) || !(hora >= 0 && hora < 24)) return 0;
      const k = `negmet:${id}:${dia}`;
      const x = (await s.get(k)) ?? {};
      const k1 = Math.min(20, Math.max(1, Math.floor(Number(n) || 1)));
      x.mensajes = (x.mensajes ?? 0) + k1;
      x.horas = Array.from({ length: 24 }, (_, h) => (x.horas?.[h] ?? 0) + (h === Math.floor(hora) ? k1 : 0));
      x.canales = { wa: (x.canales?.wa ?? 0) + (canal === 'wa' ? k1 : 0), ig: (x.canales?.ig ?? 0) + (canal === 'ig' ? k1 : 0) };
      x.vence = now + 120 * DIA_MS;
      await s.put(k, x);
      return x.mensajes;
    },
    /** Los números de cada día entre `desde` y `hasta` (AAAA-MM-DD, incluidos), para los reportes. */
    async metricasDias(id, desde, hasta, now) {
      const out = [];
      for (const [k, v] of await s.list({ prefix: `negmet:${id}:` })) {
        const dia = k.split(':').pop();
        if (dia < desde || dia > hasta || !vigente(v, now)) continue;
        const { vence, ...resto } = v;
        out.push({ dia, ...resto });
      }
      return out;
    },
    async metricas(id, dias, now) {
      const desde = diaDe(now - (dias - 1) * DIA_MS);
      const tot = { charlas: 0, audios: 0, seguimientos: 0, pases: 0, enviadosWa: 0, comentarios: 0 };
      for (const [k, v] of await s.list({ prefix: `negmet:${id}:` })) {
        if (k.split(':').pop() < desde || !vigente(v, now)) continue;
        for (const c of Object.keys(tot)) tot[c] += v[c] ?? 0;
      }
      return tot;
    },
    /** BORRAR: memoria, charla y contador de ese número. */
    async borrar(num) {
      const claves = [`wa:${num}`, `chat:${num}`, ...(await s.list({ prefix: `uso:${num}:` })).keys()];
      await s.delete(claves);
    },
    /** true si ese mensaje ya se procesó (reintento de Meta). */
    async visto(id, now) {
      if (vigente(await s.get(`id:${id}`), now)) return true;
      await s.put(`id:${id}`, { vence: now + RETENCION_ID_MS });
      return false;
    },
    /** Suma una respuesta de la IA para ese número hoy y devuelve cuántas van. */
    async contar(num, now) {
      const k = `uso:${num}:${diaDe(now)}`;
      const n = ((await s.get(k))?.n ?? 0) + 1;
      await s.put(k, { n, vence: now + 2 * DIA_MS });
      return n;
    },

    // ── Charlas con atención humana ──
    async charla(num, now) {
      const c = vigente(await s.get(`chat:${num}`), now);
      if (!c) return null;
      const { vence, ...resto } = c;
      return resto;
    },
    /** Agrega mensajes a la charla (la crea si no existe). de: 'persona' | 'equipo' | 'sistema'. */
    async agregar(num, mensajes, now, extra = {}) {
      const c = vigente(await s.get(`chat:${num}`), now) ?? { num, desde: now, mensajes: [], abierta: true, ultimoPersona: 0 };
      for (const { de, texto } of [].concat(mensajes)) {
        c.mensajes.push({ de, t: now, texto: String(texto).slice(0, MAX_TEXTO) });
        if (de === 'persona') c.ultimoPersona = now;
      }
      c.mensajes = c.mensajes.slice(-MAX_MENSAJES);
      c.ultimo = now;
      Object.assign(c, extra);
      c.vence = now + RETENCION_CHARLA_MS;
      await s.put(`chat:${num}`, c);
      const { vence, ...resto } = c;
      return resto;
    },
    async borrarCharla(num) {
      await s.delete(`chat:${num}`);
    },

    // ── Cuentas de Instagram conectadas ──
    async cuentaIg(id) {
      return (await s.get(`igc:${id}`)) ?? null;
    },
    async guardarCuentaIg(id, datos) {
      const { username = '', token, tokenVence = 0, app = '', cliente = false, permisoComentarios } = datos ?? {};
      // `cliente`: una cuenta de cliente conectada con la app del estudio (ZL-140); sin esto se la confundiría con la
      // cuenta del estudio (que responde con lo de la landing).
      // ZL-160: si la cuenta dio el permiso de comentarios (true / false; sin el dato, no se guarda).
      await s.put(`igc:${id}`, { id: String(id), username, token, tokenVence, app: String(app), ...(cliente === true && { cliente: true }), ...(typeof permisoComentarios === 'boolean' && { permisoComentarios }) });
    },
    async borrarCuentaIg(id) {
      await s.delete(`igc:${id}`);
    },
    async listaCuentasIg() {
      return [...(await s.list({ prefix: 'igc:' })).values()];
    },

    // ── Apps de Instagram de clientes ──
    async appIg(id) {
      return (await s.get(`igapp:${id}`)) ?? null;
    },
    async guardarAppIg(id, datos, now) {
      const { secreto, nombre = '', compartida } = datos ?? {};
      const antes = await s.get(`igapp:${id}`);
      // `compartida` (ZL-137): la app de Zustro Labs para clientes, con la que conectan desde la app de negocios.
      await s.put(`igapp:${id}`, { id: String(id), secreto, nombre: String(nombre).slice(0, 80), compartida: compartida ?? antes?.compartida ?? false, creado: antes?.creado ?? now });
    },
    async borrarAppIg(id) {
      await s.delete(`igapp:${id}`);
    },
    async listaAppsIg() {
      return [...(await s.list({ prefix: 'igapp:' })).values()];
    },
    // ── WhatsApp de negocios por YCloud (ZL-135): un registro por número, con la clave de API y el secreto del webhook ──
    async numeroYc(clave) {
      return (await s.get(`ycl:${clave}`)) ?? null;
    },
    async guardarNumeroYc(clave, datos, now) {
      const antes = await s.get(`ycl:${clave}`);
      // Un aviso que llega justo cuando se desconectaba el número no lo revive (solo se anota «ultimo» si existe).
      if (!antes && !datos?.secreto) return;
      const { negocio, numero, apiKey, secreto, endpointId, ecos, ultimo } = { ...antes, ...datos };
      await s.put(`ycl:${clave}`, { clave: String(clave), negocio: String(negocio), numero: String(numero), apiKey, secreto, endpointId: String(endpointId ?? ''), ecos: Boolean(ecos), ultimo: ultimo ?? 0, creado: antes?.creado ?? now });
    },
    async borrarNumeroYc(clave) {
      await s.delete(`ycl:${clave}`);
    },
    async listaNumerosYc() {
      return [...(await s.list({ prefix: 'ycl:' })).values()];
    },
    // ── Negocios clientes (ZL-121) ──
    // Los errores que puede ver quien usa la app vuelven como {error}; así cruzan el RPC del Durable Object.
    async negocio(id) {
      return (await s.get(`neg:${id}`)) ?? null;
    },
    async listaNegocios() {
      return [...(await s.list({ prefix: 'neg:' })).values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
    },
    async negociosDeEmail(email) {
      const ids = (await s.get(`negmail:${String(email).toLowerCase()}`))?.ids ?? [];
      const out = [];
      for (const id of ids) {
        const n = await s.get(`neg:${id}`);
        if (n) out.push(n);
      }
      return out;
    },
    async negocioDeCuenta(cuenta) {
      const id = (await s.get(`negcta:${cuenta}`))?.id;
      return id ? (await s.get(`neg:${id}`)) ?? null : null;
    },
    /** Crea o cambia un negocio y mantiene los índices. Una cuenta de Instagram es de un solo negocio. */
    async guardarNegocio(id, datos, now) {
      const antes = id ? await s.get(`neg:${id}`) : null;
      if (id && !antes) return { error: 'ese negocio no existe' };
      const nombre = String(datos?.nombre ?? antes?.nombre ?? '').trim().slice(0, 80);
      if (!nombre) return { error: 'falta el nombre del negocio' };
      const emails = [...new Set((datos?.emails ?? antes?.emails ?? []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
      if (emails.some((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))) return { error: 'hay un correo mal escrito' };
      if (emails.length > 20) return { error: 'máximo 20 personas por negocio' };
      const cuentas = [...new Set((datos?.cuentas ?? antes?.cuentas ?? []).map(String))];
      if (cuentas.some((c) => !/^\d{6,20}$/.test(c))) return { error: 'cuenta de Instagram inválida' };
      const nid = antes?.id ?? `n${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      for (const c of cuentas) {
        const dueño = (await s.get(`negcta:${c}`))?.id;
        if (dueño && dueño !== nid) return { error: `la cuenta ${c} ya es de otro negocio` };
      }
      const limiteDia = Math.min(Math.max(Number(datos?.limiteDia ?? antes?.limiteDia ?? 1000) || 1000, 10), 5000);
      // Canales que contrató el negocio (ZL-122): Instagram, WhatsApp o ambos. Con un canal apagado, el agente no responde ahí.
      const c0 = antes?.canales ?? { instagram: true, whatsapp: false };
      const ci = datos?.canales ?? {};
      const canales = { instagram: typeof ci.instagram === 'boolean' ? ci.instagram : c0.instagram, whatsapp: typeof ci.whatsapp === 'boolean' ? ci.whatsapp : c0.whatsapp };
      // El pedido de invitación de Instagram (ZL-137): {usuario, pedido} hasta que el equipo lo atiende (null lo borra).
      const invitacionIg = datos?.invitacionIg !== undefined ? datos.invitacionIg : antes?.invitacionIg ?? null;
      // Pedidos por chat (ZL-139): apagados hasta que el equipo los enciende en Administración.
      const pedidos = typeof datos?.pedidos === 'boolean' ? datos.pedidos : antes?.pedidos === true;
      const ajustes = ajustesDeVenta({ ...(antes?.ajustes ?? {}), ...(datos?.ajustes ?? {}) });
      // ZL-159: empleados (de los mismos correos): usan pedidos, consultas y productos, pero no conectan canales, no
      // cambian cómo se vende ni pausan el asistente. Los demás correos son dueños.
      const empleados = [...new Set((datos?.empleados ?? antes?.empleados ?? []).map((e) => String(e).trim().toLowerCase()))].filter((e) => emails.includes(e));
      if (emails.length && empleados.length === emails.length) return { error: 'tiene que quedar al menos un dueño' };
      // ZL-159: el asistente en pausa (vacaciones, local cerrado): hasta cuándo y el mensaje de ausencia.
      const pausa = datos?.pausa !== undefined ? pausaDe(datos.pausa, now) : antes?.pausa ?? null;
      // ZL-159: el aviso del día que el asistente tiene en cuenta («hoy no hay medialunas»), con vencimiento.
      const avisoDia = datos?.avisoDia !== undefined ? avisoDiaDe(datos.avisoDia, now) : antes?.avisoDia ?? null;
      // ZL-162: preguntas frecuentes del negocio (las carga el dueño o salen de responder al devolver una charla).
      const preguntas = Array.isArray(datos?.preguntas)
        ? datos.preguntas.map((x) => ({ p: limpio(x?.p).slice(0, 200), r: limpio(x?.r).slice(0, 600), ...(Number.isFinite(x?.t) && { t: x.t }) })).filter((x) => x.p && x.r).slice(-100)
        : antes?.preguntas ?? [];
      // ZL-160: responder comentarios de Instagram (lo enciende el dueño) y de qué forma.
      const comentarios = normalizarComentarios(datos?.comentarios, antes?.comentarios);
      const n = { id: nid, nombre, emails, empleados, cuentas, canales, limiteDia, invitacionIg, pedidos, ajustes, pausa, avisoDia, comentarios, preguntas, creado: antes?.creado ?? now, actualizado: now };
      await s.put(`neg:${nid}`, n);
      for (const e of antes?.emails ?? []) if (!emails.includes(e)) {
        const ids = ((await s.get(`negmail:${e}`))?.ids ?? []).filter((x) => x !== nid);
        if (ids.length) await s.put(`negmail:${e}`, { ids }); else await s.delete(`negmail:${e}`);
      }
      for (const e of emails) {
        const ids = (await s.get(`negmail:${e}`))?.ids ?? [];
        if (!ids.includes(nid)) await s.put(`negmail:${e}`, { ids: [...ids, nid] });
      }
      for (const c of antes?.cuentas ?? []) if (!cuentas.includes(c)) await s.delete(`negcta:${c}`);
      for (const c of cuentas) await s.put(`negcta:${c}`, { id: nid });
      return { negocio: n };
    },
    async fichaNegocio(id) {
      return (await s.get(`negf:${id}`)) ?? null;
    },
    async guardarFichaNegocio(id, datos, now) {
      if (!(await s.get(`neg:${id}`))) return { error: 'ese negocio no existe' };
      const { texto, activa = false } = datos ?? {};
      await s.put(`negf:${id}`, { texto: String(texto ?? ''), activa: activa === true, actualizada: now });
      return { ok: true };
    },
    async borrarFichaNegocio(id) {
      await s.delete(`negf:${id}`);
    },
    /** Suma una respuesta de la IA para ese negocio hoy y devuelve cuántas van. */
    async contarUsoNegocio(id, now) {
      const k = `neguso:${id}:${diaDe(now)}`;
      const n = ((await s.get(k))?.n ?? 0) + 1;
      await s.put(k, { n, vence: now + 40 * DIA_MS });
      return n;
    },
    /** Uso de la IA por día (los últimos 40 días como mucho). */
    async usoNegocio(id, now) {
      const out = [];
      for (const [k, v] of await s.list({ prefix: `neguso:${id}:` })) if (vigente(v, now)) out.push({ dia: k.split(':').pop(), n: v.n });
      return out.sort((a, b) => (a.dia < b.dia ? -1 : 1));
    },
    /** Lista para el panel: sin texto, solo las vigentes, la más reciente primero. */
    async lista(now) {
      const out = [];
      for (const [, c] of await s.list({ prefix: 'chat:' })) {
        if (!vigente(c, now)) continue;
        out.push({ num: c.num, ultimo: c.ultimo, ultimoPersona: c.ultimoPersona, abierta: c.abierta, idioma: c.idioma, nombre: c.nombre });
      }
      return out.sort((a, b) => b.ultimo - a.ultimo).slice(0, MAX_CHARLAS);
    },

    /** Borra todo lo vencido. Lo llama la alarma diaria. */
    async limpiar(now) {
      const vencidas = [];
      for (const [k, v] of await s.list()) if (v?.vence && v.vence <= now) vencidas.push(k);
      // delete() acepta hasta 128 claves por llamada.
      for (let i = 0; i < vencidas.length; i += 128) await s.delete(vencidas.slice(i, i + 128));
      return vencidas.length;
    },
  };
  return Object.fromEntries(Object.entries(metodos).map(([k, fn]) => [k, enSerie(fn)]));
}

/** Almacenamiento en memoria con la misma forma que ctx.storage, para tests. */
export function almacenPrueba() {
  const m = new Map();
  let alarma = null;
  return {
    _data: m,
    get: async (k) => structuredClone(m.get(k)),
    put: async (k, v) => void m.set(k, structuredClone(v)),
    delete: async (k) => {
      for (const x of [].concat(k)) m.delete(x);
    },
    list: async ({ prefix = '' } = {}) => new Map([...m].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1))),
    getAlarm: async () => alarma,
    setAlarm: async (t) => void (alarma = t),
  };
}

/**
 * Adaptadores que usa el Worker: memoria {get, put, delete, visto, contar}, charlas {get, list, agregar, delete},
 * cuentas {get, put, delete, list} (Instagram), apps {get, put, delete, list} (apps de Instagram de clientes) y
 * fichas {get, put, delete} (la ficha del negocio de cada cuenta de cliente).
 * `a` es la lógica directa (tests) o el stub RPC del Durable Object (producción); `reloj` da la hora.
 */
export function adaptadores(a, reloj = () => Date.now()) {
  const memoria = {
    get: (n) => a.estado(n, reloj()),
    put: (n, d) => a.guardarEstado(n, d, reloj()),
    delete: (n) => a.borrar(n),
    visto: (id) => a.visto(id, reloj()),
    sumarRafaga: (n, item) => a.sumarRafaga(n, item, reloj()),
    seguimientos: (limite, now) => a.seguimientosVencidos(now ?? reloj(), limite),
    tomarRafaga: (n, id) => a.tomarRafaga(n, id, reloj()),
    cursoVigente: (n, id) => a.cursoVigente(n, id, reloj()),
    terminarCurso: (n, id) => a.terminarCurso(n, id, reloj()),
    contar: (n) => a.contar(n, reloj()),
  };
  const charlas = {
    get: (n) => a.charla(n, reloj()),
    list: () => a.lista(reloj()),
    agregar: (n, mensajes, now, extra) => a.agregar(n, mensajes, now ?? reloj(), extra),
    delete: (n) => a.borrarCharla(n),
  };
  // Cuentas de Instagram conectadas: {id, username, token, vence} (vence = cuándo vence el token).
  const cuentas = {
    get: async (id) => {
      const c = await a.cuentaIg(id);
      return c ? { id: c.id, username: c.username, token: c.token, vence: c.tokenVence, app: c.app ?? '', cliente: c.cliente === true, ...(typeof c.permisoComentarios === 'boolean' && { permisoComentarios: c.permisoComentarios }) } : null;
    },
    put: (id, d) => a.guardarCuentaIg(id, { username: d.username, token: d.token, tokenVence: d.vence, app: d.app, cliente: d.cliente, permisoComentarios: d.permisoComentarios }),
    delete: (id) => a.borrarCuentaIg(id),
    list: async () => (await a.listaCuentasIg()).map((c) => ({ id: c.id, username: c.username, token: c.token, vence: c.tokenVence, app: c.app ?? '', cliente: c.cliente === true, ...(typeof c.permisoComentarios === 'boolean' && { permisoComentarios: c.permisoComentarios }) })),
  };
  // Apps de Instagram de clientes: {id, secreto, nombre, creado}.
  const apps = {
    get: (id) => a.appIg(id),
    put: (id, d) => a.guardarAppIg(id, d, reloj()),
    delete: (id) => a.borrarAppIg(id),
    list: () => a.listaAppsIg(),
  };
  // Negocios clientes (app negocios.zustrolabs.com).
  const negocios = {
    get: (id) => a.negocio(id),
    list: () => a.listaNegocios(),
    deEmail: (email) => a.negociosDeEmail(email),
    deCuenta: (cuenta) => a.negocioDeCuenta(cuenta),
    guardar: (id, d) => a.guardarNegocio(id, d, reloj()),
    ficha: (id) => a.fichaNegocio(id),
    guardarFicha: (id, d) => a.guardarFichaNegocio(id, d, reloj()),
    borrarFicha: (id) => a.borrarFichaNegocio(id),
    contarUso: (id) => a.contarUsoNegocio(id, reloj()),
    uso: (id) => a.usoNegocio(id, reloj()),
    vapid: () => a.vapid(),
    claveFotos: () => a.claveFotos(),
    suscribirPush: (id, sub, email) => a.suscribirPush(id, sub, email, reloj()),
    suscripcionesPush: (id) => a.suscripcionesPush(id),
    borrarPush: (id, endpoints) => a.borrarPush(id, endpoints),
    sumarMetrica: (id, clave, dia) => a.sumarMetrica(id, clave, reloj(), dia),
    sumarMensaje: (id, datos) => a.sumarMensaje(id, datos, reloj()),
    metricasDias: (id, desde, hasta) => a.metricasDias(id, desde, hasta, reloj()),
    metricas: (id, dias = 7) => a.metricas(id, dias, reloj()),
  };
  // Ficha por cuenta de Instagram (lo que usan el Worker y el script): es la ficha del negocio dueño de esa cuenta.
  // Cargar una ficha en una cuenta que todavía no es de ningún negocio crea el negocio con ese nombre.
  const fichas = {
    get: async (cuenta) => {
      const n = await a.negocioDeCuenta(cuenta);
      return n ? a.fichaNegocio(n.id) : null;
    },
    put: async (cuenta, d) => {
      let n = await a.negocioDeCuenta(cuenta);
      if (!n) {
        const r = await a.guardarNegocio(null, { nombre: d?.nombre || `Cuenta ${cuenta}`, emails: [], cuentas: [String(cuenta)] }, reloj());
        if (r.error) throw new Error(r.error);
        n = r.negocio;
      }
      return a.guardarFichaNegocio(n.id, d, reloj());
    },
    delete: async (cuenta) => {
      const n = await a.negocioDeCuenta(cuenta);
      if (n) await a.borrarFichaNegocio(n.id);
    },
  };
  // Números de WhatsApp de negocios conectados por YCloud: {clave, negocio, numero, apiKey, secreto, endpointId, ecos, ultimo, creado}.
  const ycloud = {
    get: (clave) => a.numeroYc(clave),
    put: (clave, d) => a.guardarNumeroYc(clave, d, reloj()),
    delete: (clave) => a.borrarNumeroYc(clave),
    list: () => a.listaNumerosYc(),
  };
  return { memoria, charlas, cuentas, apps, fichas, negocios, ycloud };
}
