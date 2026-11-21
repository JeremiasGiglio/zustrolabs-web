// WhatsApp de Zustro Labs: webhook de la Cloud API de Meta en zustrolabs.com/api/whatsapp.
// Mismo cerebro y mismos controles que «Preguntale a Zustro» (asistente/src/asistente.js + conocimiento.js).
// Adaptado del bot del Radar Croacia (radar-croacia/worker/src/whatsapp.mjs), pero separado: otra app de Meta,
// otro número, otra memoria y la clave de IA del estudio.
// Reglas:
// - solo procesa pedidos firmados por Meta;
// - no guarda el texto de las charlas con el asistente, solo {idioma, humanoHasta} por número, 90 días;
// - con PERSONA, el asistente se calla y esa charla se guarda 30 días para el panel (panel.js);
// - la memoria es un Durable Object (atencion.js): los mensajes que llegan juntos no se pisan.
// Este módulo no importa nada de Cloudflare: se prueba con `node --test`.

import { armarPedidoApi, controlar, llamarClaude, LIMITES, MODELO } from '../../asistente/src/asistente.js';
import { ENLACES } from '../../asistente/src/conocimiento.js';
import { HISTORIAL_MAX, HISTORIAL_MS } from './atencion.js';
import { agregar } from './panel.js';
import { sinSaludoInicial } from './negocio.js';
import { noEsNombre } from './pedidos-charla.js';
import { CANAL_WHATSAPP, eligeIdioma, esSaludo, IDIOMA_POR_NUMERO, IDIOMAS, idiomaDe, idiomaDelTexto, idiomasDelSaludo, idiomasQueHacen, NOMBRE_IDIOMA, numeroSolo, opcion, pideQueHacen, SALUDO_IDIOMA, textos } from './textos.js';

export const GRAPH_VERSION = 'v25.0';
export const HORAS_PERSONA = 24;
/** Cuánto espera el asistente callado a que alguien del negocio tome una charla que le pasó (ZL-149). */
export const PASE_MS = 15 * 60_000;
/** ZL-162: cuánto espera el «sí» a «¿querés que lo averigüe el equipo?», la confirmación de BORRAR, y cuánto se recuerda
 * lo que quedó pendiente al devolver una charla. */
export const OFERTA_MS = 2 * 3600_000;
export const BORRAR_CONFIRMAR_MS = 10 * 60_000;
export const DEVUELTA_MS = 24 * 3600_000;

/** ZL-162: «sí» o «no» a una pregunta nuestra (corto y sin preguntas); cualquier otra cosa → null. */
export function siNo(texto) {
  const crudo = String(texto ?? '');
  if (/[?¿]/.test(crudo)) return null;
  const t = crudo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.split(' ').length > 6) return null;
  if (/^(no|nah|nop|nope|ne|no gracias|deja|no hace falta|no por ahora|mejor no)\b/.test(t)) return 'no';
  if (/^(si|dale|ok|okey|okay|oka|bueno|bueno dale|por favor|porfa|claro|obvio|de una|perfecto|genial|joya|yes|yeah|yep|sure|please|da|moze|naravno|vale)\b/.test(t)) return 'si';
  return null;
}

/**
 * ZL-162: lo que dijo la IA antes de un texto fijo del sistema, sin sus preguntas finales ni un «¡Dale!» de arranque:
 * así nunca salen dos preguntas que se pisan («¿Te sirve?» + «¿me decís tu nombre?»).
 */
export function sinPreguntaFinal(texto) {
  const partes = String(texto ?? '').replace(/^\s*¡?dale!?[,.]?\s*/i, '').split(/(?<=[.!?…])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  while (partes.length && /\?\s*\S{0,3}$/.test(partes.at(-1))) partes.pop();
  return partes.join(' ');
}
/** Cuándo va el recordatorio de un carrito sin confirmar (se guarda 20 min) y de una consulta sin nombre (ZL-151). */
export const SEGUIR_CARRITO_MS = 10 * 60_000;
export const SEGUIR_CONSULTA_MS = 2 * 3600_000;
/** Respuestas de la IA por número y por día; pasado eso, se sugiere PERSONA (tope de gasto y de abuso). */
export const TOPE_DIARIO = 40;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u2028\u2029]/g;

// ───────────────────────── Seguridad ─────────────────────────

function iguales(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** GET de verificación de Meta: devuelve el challenge si el token coincide (`clave`: qué secreto se compara). */
export function verificarSuscripcion(url, env, clave = 'WHATSAPP_VERIFY_TOKEN') {
  const p = url.searchParams;
  if (!env[clave]) return { status: 503, body: 'sin configurar' };
  if (p.get('hub.mode') === 'subscribe' && iguales(p.get('hub.verify_token') ?? '', env[clave])) {
    // Solo un challenge con forma de challenge: nada de reflejar texto arbitrario.
    const ch = p.get('hub.challenge') ?? '';
    return /^[A-Za-z0-9_-]{1,128}$/.test(ch) ? { status: 200, body: ch } : { status: 400, body: 'challenge inválido' };
  }
  return { status: 403, body: 'token inválido' };
}

/** Firma HMAC-SHA256 del cuerpo crudo, como la manda Meta en X-Hub-Signature-256 («sha256=<hex>»). */
export async function firmar(cuerpo, secreto) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(cuerpo));
  return 'sha256=' + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function firmaValida(cuerpo, cabecera, secreto) {
  if (!secreto || !cabecera || !/^sha256=[0-9a-f]{64}$/i.test(cabecera)) return false;
  return iguales(cabecera.toLowerCase(), await firmar(cuerpo, secreto));
}

// ───────────────────────── Entrada ─────────────────────────

/**
 * Pasa el payload de Meta a eventos simples. Ignora los avisos de estado (enviado, leído) y lo que llegue
 * para otro número.
 * @returns {{id:string, from:string, ts:number, kind:'text'|'idioma'|'otro', text?:string, idioma?:string}[]}
 */
export function leerWebhook(payload, phoneNumberId) {
  if (payload?.object !== 'whatsapp_business_account') return [];
  const out = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      if (change.field !== 'messages' || !Array.isArray(v.messages)) continue;
      if (!phoneNumberId || v.metadata?.phone_number_id !== phoneNumberId) continue;
      for (const m of v.messages) {
        const base = { id: String(m.id ?? ''), from: String(m.from ?? ''), ts: Number(m.timestamp ?? 0) };
        if (!base.id || !/^\d{6,16}$/.test(base.from)) continue;
        if (m.type === 'text') out.push({ ...base, kind: 'text', text: String(m.text?.body ?? '') });
        else if (m.type === 'interactive' && m.interactive?.type === 'button_reply') {
          const i = /^idioma_(es|hr|en)$/.exec(m.interactive.button_reply?.id ?? '')?.[1];
          out.push(i ? { ...base, kind: 'idioma', idioma: i } : { ...base, kind: 'otro' });
        } else if (m.type === 'button') out.push({ ...base, kind: 'text', text: String(m.button?.text ?? '') });
        else out.push({ ...base, kind: 'otro' });
      }
    }
  }
  return out;
}

/** Comandos que no pasan por la IA (solo el mensaje entero: «borrar el turno» no es un comando). */
export function comando(texto) {
  const t = String(texto ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[¡!¿?.,;:-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^(borrar|borra|borrar todo|olvidame|borrar mis datos|eliminar mis datos|obrisi|obrisi sve|izbrisi|izbrisi sve|obrisi me|zaboravi me|delete|delete all|delete my data|forget me)$/.test(t)) return 'borrar';
  if (/^(persona|humano|hablar con (una )?persona|hablar con alguien|quiero hablar con alguien|alguien del equipo|operador|asesor|un asesor|osoba|covjek|razgovor s osobom|operater|savjetnik|person|human|talk to a person|talk to someone|someone on the team|operator|advisor)$/.test(t)) return 'persona';
  if (/^(idioma|cambiar idioma|jezik|promijeni jezik|language|change language)$/.test(t)) return 'idioma';
  if (/^(menu|opciones|ver opciones|izbornik|opcije|options)$/.test(t)) return 'menu';
  return null;
}

// ───────────────────────── Salida ─────────────────────────

/** ZL-161: una foto (link público que WhatsApp o Instagram bajan) con su pie. */
export const msgImagen = (to, link, caption = '') => ({
  messaging_product: 'whatsapp',
  recipient_type: 'individual',
  to,
  type: 'image',
  image: { link: String(link), ...(String(caption ?? '').trim() && { caption: String(caption).trim().slice(0, 1000) }) },
});

export const msgTexto = (to, body, opciones = null) => ({
  messaging_product: 'whatsapp',
  recipient_type: 'individual',
  to,
  type: 'text',
  text: { preview_url: false, body: String(body).slice(0, 4096) },
  // ZL-149: botones o lista ({id, titulo}); los usan YCloud e Instagram. La API de Meta del estudio no los recibe.
  ...(opciones?.length && { opciones }),
});

/** Tres botones de idioma (Meta deja hasta 3, con título de hasta 20 caracteres). */
export const msgIdiomas = (to) => ({
  messaging_product: 'whatsapp',
  recipient_type: 'individual',
  to,
  type: 'interactive',
  interactive: {
    type: 'button',
    body: { text: SALUDO_IDIOMA },
    action: { buttons: IDIOMAS.map((i) => ({ type: 'reply', reply: { id: `idioma_${i}`, title: NOMBRE_IDIOMA[i] } })) },
  },
});

// Controles de más para WhatsApp, que vuelve link cualquier cosa con forma de dominio y donde una captura del número
// verificado del estudio circula sola: se saca cada oración con un dominio que no sea nuestro, o con plata dicha
// de otra forma (lucas, mangos, palos, por ciento, descuentos, señas) aunque no tenga moneda.
const DOMINIO_RE = /\b[\p{L}\d-]+(?:\.[\p{L}\d-]+)*\.[a-z]{2,24}\b/giu;
const NUESTROS = /^(?:(?:radar|croata)\.)?zustrolabs\.com$/i;
const PLATA_SUELTA_RE = /%|\b(?:lucas?|mangos?|palos?|gambas?|seña|señar|descuentos?|ofertas?|promo(?:ción|cion)?|cuotas?|bucks|grand|discounts?|deals?|popust\w*|akcij\w*)/iu;
const ORACIONES = (s) => s.split(/(?<=[.!?…])\s+|\n+/).map((x) => x.trim()).filter(Boolean);

export function filtroWhatsApp(texto) {
  const notas = [];
  const quedan = ORACIONES(String(texto ?? '')).filter((o) => {
    const ajenos = (o.match(DOMINIO_RE) ?? []).filter((d) => !NUESTROS.test(d.replace(/^.*@/, '')));
    if (ajenos.length) return notas.push('dominio'), false;
    if (PLATA_SUELTA_RE.test(o)) return notas.push('plata'), false;
    return true;
  });
  return { texto: quedan.join(' '), notas };
}

/**
 * Respuesta controlada → texto de WhatsApp. Los links salen de la lista fija de conocimiento.js (nunca de la IA)
 * y, si conviene una persona, se agrega cómo pedirla.
 */
export function formatear(c, idioma = 'es') {
  const T = textos(idioma);
  const f = filtroWhatsApp(c.respuesta);
  const vacia = c.notas?.includes('vacia') || !f.texto;
  const partes = [vacia ? T.sinRespuesta : f.texto];
  const links = (c.enlaces ?? []).map((k) => ENLACES[k]).filter((u) => /^https:\/\/\S+$/.test(u ?? ''));
  if (links.length) partes.push(links.join('\n'));
  if (c.escribirnos && !c.fuera_de_tema && !vacia) partes.push(T.derivar);
  return partes.filter(Boolean).join('\n\n');
}

/**
 * Celulares de Argentina: WhatsApp los informa como 549 + área + número, pero la API a veces acepta solo
 * la otra forma. Devuelve la variante a probar, o null si no es un celular argentino.
 */
export function varianteArgentina(to) {
  const n = String(to ?? '');
  if (/^549\d{10}$/.test(n)) return '54' + n.slice(3);
  if (/^54\d{10}$/.test(n)) return '549' + n.slice(2);
  return null;
}

async function postear(env, mensaje, fetchImpl) {
  const v = env.WHATSAPP_GRAPH_VERSION || GRAPH_VERSION;
  const res = await fetchImpl(`https://graph.facebook.com/${v}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.WHATSAPP_TOKEN}` },
    body: JSON.stringify(mensaje),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return { status: res.status, code: data?.error?.code, message: data?.error?.message ?? 'sin detalle' };
}

/** Manda un mensaje. Si Meta rechaza un celular argentino (#131030), prueba la otra forma. */
export async function enviar(env, mensajeConOpciones, fetchImpl = fetch) {
  // La API de Meta no conoce «opciones» (son nuestras): se sacan antes de mandar.
  const { opciones: _o, ...mensaje } = mensajeConOpciones;
  let err = await postear(env, mensaje, fetchImpl);
  const alt = varianteArgentina(mensaje.to);
  if (err && err.code === 131030 && alt) err = await postear(env, { ...mensaje, to: alt }, fetchImpl);
  // Solo estado y código: el texto del error de Meta podría traer datos.
  if (err) throw Object.assign(new Error(`WhatsApp ${err.status} ${err.code ?? ''}`.trim()), { code: err.code });
}

// ───────────────────────── Lógica ─────────────────────────

/**
 * Lo que cambia entre el asistente del estudio y el de un negocio cliente (negocio.js, perfilNegocio): idiomas,
 * textos fijos, menú, cómo se arma la respuesta de la IA y qué pasa con PERSONA cuando no hay panel.
 */
export const PERFIL_ESTUDIO = { idiomas: IDIOMAS, textos, opcion, formatear: (c, idioma) => formatear(c, idioma), pausaSinPanel: false, horasPausa: HORAS_PERSONA };

const notaNoTexto = (ev) => (ev.kind === 'idioma' ? '[Eligió idioma]' : '[Mandó algo que no es texto: audio, foto o archivo]');

/** Partes de un mensaje separadas por una línea en blanco, sin las vacías (ZL-145: el saludo fijo puede no ir). */
const OPCION_IDIOMA_TXT = { es: 'Español', en: 'English', hr: 'Hrvatski' };
const juntar = (...partes) => partes.filter((x) => String(x ?? '').trim()).join('\n\n');

/**
 * Decide qué contestar a un evento. Devuelve los mensajes a mandar y métricas (sin texto ni número).
 * deps: {memoria, charlas (o null sin panel), preguntar(texto, idioma) → respuesta controlada, now,
 *        cupo() → 'ok' | 'global' (el tope por minuto de toda la cuenta), solo antes de gastar IA}
 */
// `pedidos` (ZL-139): pedidosDeCharla() de pedidos-charla.js, solo para un negocio con pedidos encendidos.
// `consultas` (ZL-146): consultasDeCharla() de consultas.js, para registrar consultas y pases al equipo de un negocio.
export async function atender(ev, deps) {
  const { memoria, perfil = PERFIL_ESTUDIO, now = Date.now() } = deps ?? {};
  // ZL-159: el dueño pausó el asistente (vacaciones, local cerrado): a cada persona se le dice una vez cuándo vuelven
  // (con su mensaje de ausencia, si lo escribió) y nada más. BORRAR sigue andando.
  const enPausa = perfil.negocio === true && memoria && perfil.pausa?.hasta > now && !(ev.kind === 'text' && comando(ev.text) === 'borrar');
  const r = enPausa ? await atenderEnPausa(ev, deps) : await atenderEvento(ev, deps);
  if (perfil.negocio !== true || !memoria || ['repetido', 'reemplazado'].includes(r.metrica)) return r;
  // ZL-157: cualquier mensaje de la persona (también una foto o un audio) abre las 24 h de Meta: queda anotado, así el
  // aviso de su pedido sale solo mientras se puede.
  let e = (await memoria.get(ev.from)) ?? null;
  if (e && e.ultimo !== now && r.metrica !== 'borrar') {
    e = { ...e, humanoHasta: e.humanoHasta ?? 0, ultimo: now };
    await memoria.put(ev.from, e);
  }
  // ZL-157: los avisos de pedido que no pudieron salir (fuera de las 24 h) se dicen ahora, primero, en el mismo mensaje.
  const avisos = Array.isArray(e?.avisos) ? e.avisos.filter(Boolean) : [];
  if (!avisos.length || r.metrica === 'borrar') return r;
  await memoria.put(ev.from, { ...e, avisos: [] });
  const cuerpo = avisos.join('\n\n');
  const i = r.send.findIndex((m) => typeof m.text?.body === 'string');
  const send = i >= 0 ? r.send.map((m, j) => (j === i ? { ...m, text: { ...m.text, body: `${cuerpo}\n\n${m.text.body}` } } : m)) : [msgTexto(ev.from, cuerpo), ...r.send];
  return { ...r, send, avisos: avisos.length };
}

async function atenderEnPausa(ev, { memoria, perfil, now }) {
  if (await memoria.visto(ev.id)) return { send: [], metrica: 'repetido' };
  const estado = (await memoria.get(ev.from)) ?? {};
  const p = perfil.pausa;
  if (estado.ausencia === p.desde) return { send: [], metrica: 'pausa' };
  const idioma = estado.idioma ?? (ev.kind === 'text' ? esSaludo(ev.text) ?? idiomaDelTexto(ev.text) : null) ?? perfil.idiomas[0];
  const T = perfil.textos(perfil.idiomas.includes(idioma) ? idioma : perfil.idiomas[0]);
  // ZL-164: cerrado fuera de horario («no atender»): cuándo abren, en su idioma.
  if (p.cerrado) {
    await memoria.put(ev.from, { ...estado, humanoHasta: estado.humanoHasta ?? 0, ausencia: p.desde });
    return { send: [msgTexto(ev.from, T.cerrado(p.cerrado[perfil.idiomas.includes(idioma) ? idioma : perfil.idiomas[0]] || p.cerrado.es))], metrica: 'cerrado_aviso' };
  }
  let fecha;
  try {
    fecha = new Intl.DateTimeFormat(idioma === 'en' ? 'en-GB' : idioma === 'hr' ? 'hr-HR' : 'es-AR', { timeZone: p.zona || 'America/Argentina/Buenos_Aires', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(p.hasta));
  } catch { fecha = new Date(p.hasta).toISOString().slice(0, 10); }
  const texto = p.mensaje ? `${p.mensaje}\n\n(${T.ausencia(fecha).replace(/^[^🙏]*🙏\s*/, '')})` : T.ausencia(fecha);
  await memoria.put(ev.from, { ...estado, humanoHasta: estado.humanoHasta ?? 0, ausencia: p.desde });
  return { send: [msgTexto(ev.from, texto)], metrica: 'pausa_aviso' };
}

async function atenderEvento(ev, { memoria, charlas = null, preguntar, now = Date.now(), cupo = async () => 'ok', perfil = PERFIL_ESTUDIO, pedidos = null, consultas = null, vigente = null }) {
  if (memoria && (await memoria.visto(ev.id))) return { send: [], metrica: 'repetido' };
  let estado = (memoria && (await memoria.get(ev.from))) || null;
  // Un negocio con un solo idioma no pregunta el idioma: arranca directo con el saludo y el menú.
  const unico = perfil.idiomas.length === 1 ? perfil.idiomas[0] : null;
  // ZL-153: un negocio con varios idiomas tampoco pregunta: se toma el idioma del primer mensaje (o el principal si no
  // se reconoce). Preguntar «¿en qué idioma charlamos?» a alguien que acaba de escribir en castellano no es natural.
  // Si quiere otro, lo escribe en ese idioma o pide IDIOMA.
  if (perfil.negocio === true && !unico && memoria && ev.kind === 'text' && !estado?.idioma && !estado?.ultimo && comando(ev.text) !== 'idioma' && !eligeIdioma(ev.text)) {
    const del = (i) => (i && perfil.idiomas.includes(i) ? i : null);
    const auto = del(esSaludo(ev.text)) ?? del(idiomaDelTexto(ev.text)) ?? perfil.idiomas[0];
    estado = { ...(estado ?? {}), idioma: auto, humanoHasta: estado?.humanoHasta ?? 0 };
    await memoria.put(ev.from, estado);
  }
  // El nombre o la bandera de un idioma como mensaje entero vale como el botón (en Instagram no hay botones);
  // mientras se espera el idioma (ya saludamos y todavía no eligió), también 1, 2 o 3.
  const num = ev.kind === 'text' ? numeroSolo(ev.text) : null;
  const esperaIdioma = !unico && !!estado && !estado.idioma;
  // Un negocio con varios idiomas (ZL-126) pregunta con los suyos, en su orden; el estudio, con los tres de siempre.
  const delPerfil = (i) => (i && perfil.idiomas.includes(i) ? i : null);
  const porNumero = perfil.idiomaPorNumero ?? IDIOMA_POR_NUMERO;
  const pedirIdioma = () => (perfil.preguntaIdioma ? msgTexto(ev.from, perfil.preguntaIdioma, perfil.opcionesIdioma) : msgIdiomas(ev.from));
  const elegido = unico || ev.kind !== 'text' ? null : delPerfil(eligeIdioma(ev.text)) ?? (esperaIdioma ? porNumero[num] ?? null : null);
  if (elegido) ev = { ...ev, kind: 'idioma', idioma: elegido };
  const guardar = (s) => memoria?.put(ev.from, s);
  let cmd = ev.kind === 'text' ? comando(ev.text) : null;
  if (unico && cmd === 'idioma') cmd = null;
  const idioma = unico ?? delPerfil(estado?.idioma) ?? perfil.idiomas[0];
  const conocido = unico ?? estado?.idioma ?? null;
  const T = perfil.textos(idioma);
  const horas = perfil.horasPausa ?? HORAS_PERSONA;
  // Un negocio (ZL-146): memoria corta (los últimos mensajes de las últimas 48 h y lo que sabemos de la persona), un
  // mensaje por respuesta y la persona del negocio solo cuando hace falta.
  const neg = perfil.negocio === true;
  const recordar = (entrada, salida, extra = {}) => recordarCharla(memoria, ev.from, estado, now, idioma, neg, entrada, salida, extra);
  const pasarAlEquipo = (tipo, extra = {}) => pase(memoria, consultas, ev.from, estado, now, horas, idioma, tipo, extra);

  // Seguimiento con permiso (ZL-151): si la persona escribe, el recordatorio pendiente ya no va. BAJA corta los
  // recordatorios para siempre (el asistente sigue respondiendo si escribe).
  if (neg && memoria && estado?.seguir) { estado = { ...estado, seguir: null }; await guardar(estado); }
  if (neg && memoria && ev.kind === 'text' && /^(baja|stop|unsubscribe|no me escribas( mas| más)?)[.!]*$/i.test(String(ev.text ?? '').trim())) {
    await guardar({ ...(estado ?? {}), idioma: estado?.idioma ?? idioma, humanoHasta: estado?.humanoHasta ?? 0, baja: true, seguir: null });
    return { send: [msgTexto(ev.from, T.baja)], metrica: 'baja' };
  }

  if (cmd === 'borrar') {
    // ZL-162: en un negocio se pide confirmación (BORRAR otra vez, dentro de 10 minutos): es irreversible.
    if (neg && memoria && T.borrarConfirmar && !(estado?.borrarPend && now - estado.borrarPend < BORRAR_CONFIRMAR_MS)) {
      await guardar({ ...(estado ?? {}), idioma: estado?.idioma ?? idioma, humanoHasta: estado?.humanoHasta ?? 0, borrarPend: now });
      return { send: [msgTexto(ev.from, T.borrarConfirmar)], metrica: 'borrar_confirmar' };
    }
    // ZL-162: BORRAR no saca la pausa (si alguien del negocio la está atendiendo, el asistente no se «despierta»).
    const sigue = neg && estado?.humanoHasta > now ? { idioma: estado.idioma ?? idioma, humanoHasta: estado.humanoHasta, ...(estado.pase && { pase: estado.pase }) } : null;
    await memoria?.delete(ev.from);
    await charlas?.delete(ev.from);
    // ZL-159: también sus datos (nombre, dirección, resumen) de los pedidos y consultas ya cerrados.
    await pedidos?.olvidar?.();
    await consultas?.olvidar?.();
    if (sigue && memoria) await guardar(sigue);
    return { send: [msgTexto(ev.from, T.borrado)], metrica: 'borrar' };
  }

  // Atiende una persona: el asistente no contesta (salvo BORRAR) hasta que lo devuelvan o pasen 24 h.
  // El mensaje queda en la charla del panel y la ventana de 24 h se renueva (se guarda como mucho una vez por hora).
  // Sin panel nadie lo leería: en ese caso sigue el asistente.
  // En un negocio no hay panel: la persona del negocio contesta desde su propia app de Instagram.
  if ((charlas || perfil.pausaSinPanel) && estado?.humanoHasta && estado.humanoHasta > now) {
    const texto = ev.kind === 'text' ? String(ev.text ?? '').replace(CONTROL_RE, ' ').trim() || '[Mensaje vacío]' : notaNoTexto(ev);
    if (charlas) await agregar(charlas, ev.from, { de: 'persona', texto }, now, { abierta: true });
    // Si el asistente le pasó la charla al equipo y nadie la tomó todavía (ZL-149), la pausa NO se alarga: a los 15
    // minutos vuelve el asistente. Si la tomó alguien (respondió o tocó «La atiendo yo»), sigue la pausa de la ficha.
    const hasta = now + horas * 3600_000;
    // ZL-162: en un negocio, los mensajes del comprador NO alargan la pausa (la alarga el dueño cuando contesta). Y si
    // espera a que alguien la tome, recibe UN acuse: que no quede hablando solo.
    if (!neg && !estado.pase && hasta - estado.humanoHasta > 3600_000) await guardar({ ...estado, humanoHasta: hasta });
    if (neg && !charlas && estado.pase && estado.acuse !== estado.pase && T.acuse) {
      await guardar({ ...estado, acuse: estado.pase });
      return { send: [msgTexto(ev.from, T.acuse)], metrica: 'acuse' };
    }
    return { send: [], metrica: 'humano' };
  }

  if (cmd === 'persona') {
    // Sin panel o sin memoria nadie vería el pedido: se deriva al correo y el asistente no se calla.
    if (memoria && !charlas && perfil.pausaSinPanel) {
      // Un negocio (ZL-149): 15 minutos para que alguien la tome; si nadie la toma, vuelve el asistente.
      await guardar({ ...estado, idioma, humanoHasta: now + (neg ? PASE_MS : horas * 3600_000), ...(neg && { pase: now }) });
      const reg = neg ? await pasarAlEquipo('persona') : null;
      return { send: [msgTexto(ev.from, T.persona)], metrica: 'persona', handoff: true, ...(reg && { consulta: reg.numero }) };
    }
    if (!charlas || !memoria) return { send: [msgTexto(ev.from, T.personaMail)], metrica: 'persona', handoff: true };
    await guardar({ ...estado, idioma, humanoHasta: now + horas * 3600_000 });
    if (neg) await pasarAlEquipo('persona');
    await agregar(
      charlas,
      ev.from,
      [
        { de: 'persona', texto: String(ev.text ?? '').trim() || 'PERSONA' },
        { de: 'sistema', texto: `Pidió hablar con una persona. El asistente está en pausa. Idioma: ${NOMBRE_IDIOMA[idioma]}.` },
      ],
      now,
      { abierta: true, idioma },
    );
    return { send: [msgTexto(ev.from, T.persona)], metrica: 'persona', handoff: true, avisar: true };
  }

  if (ev.kind === 'idioma') {
    const nuevo = delPerfil(ev.idioma) ?? perfil.idiomas[0];
    await guardar({ ...estado, idioma: nuevo, humanoHasta: 0 });
    // ¿Cómo estás? + quiénes somos, y enseguida lo que podemos lograr juntos.
    const N = perfil.textos(nuevo);
    // Un negocio manda todo en un solo mensaje (Meta cobra cada mensaje desde el 1/10/2026).
    const send = neg ? [msgTexto(ev.from, juntar(N.bienvenida, N.quienes, N.menu), perfil.menuOpciones(nuevo))] : [msgTexto(ev.from, juntar(N.bienvenida, N.quienes)), msgTexto(ev.from, N.menu)];
    // ZL-153: queda en la memoria corta, así la IA sabe que ya saludamos.
    if (neg) await recordarCharla(memoria, ev.from, { ...estado, idioma: nuevo }, now, nuevo, neg, String(ev.text ?? OPCION_IDIOMA_TXT[nuevo] ?? nuevo), send[0].text.body);
    return { send, metrica: 'idioma', idioma: nuevo };
  }

  if (cmd === 'idioma') {
    // Mientras elige, los números 1 a 3 son idiomas (no opciones del menú).
    if (estado) await guardar({ ...estado, idioma: undefined, pedido: null, consulta: null, humanoHasta: estado.humanoHasta ?? 0 });
    return { send: [pedirIdioma()], metrica: 'pide_idioma' };
  }
  if (cmd === 'menu') {
    if (neg) await recordar(ev.text, T.menu);
    return { send: [msgTexto(ev.from, T.menu, neg ? perfil.menuOpciones(idioma) : null)], metrica: 'menu' };
  }
  // ZL-157: con un pedido abierto, una foto, un archivo o un audio (el comprobante, casi siempre) es para el negocio: la
  // IA no lo mira ni contesta, y al dueño le llega un aviso.
  if (ev.kind === 'otro' && neg && pedidos?.abierto) {
    const n = await pedidos.abierto().catch(() => null);
    if (n) return { send: [], metrica: 'archivo_pedido', pedido: n, archivo: ev.audio ? 'audio' : 'archivo' };
  }
  // ZL-157: una publicación de Instagram compartida: no la vemos, así que se le pregunta qué quiere saber.
  if (ev.kind === 'compartido') return { send: [msgTexto(ev.from, T.compartido ?? T.soloTexto)], metrica: 'compartido' };
  // Un audio: el asistente avisa que no escucha audios; una foto, que lo escriba.
  if (ev.kind === 'otro') return { send: [msgTexto(ev.from, ev.audio && T.sinAudio ? T.sinAudio : T.soloTexto)], metrica: ev.audio ? 'audio' : 'otro' };

  // Los pasos fijos de un pedido (SÍ, retiro o envío, nombre, dirección, CANCELAR, PEDIDO) van antes que el menú y la
  // IA: «1» y «2» son retiro y envío mientras se pregunta eso. Sin memoria no hay pedidos (no se recordaría el paso).
  // ZL-163: el paso del pedido o de la consulta que hay que repetir después de que la IA responda una pregunta.
  let repetirPaso = null;
  if (pedidos && memoria && ev.kind === 'text' && conocido) {
    // Si ya sabemos su nombre, no se lo volvemos a preguntar (ZL-146).
    const p = await pedidos.antes(ev.text, estado?.pedido ?? null, idioma, { nombre: estado?.nombre ?? '' });
    // ZL-163: una pregunta o un cambio en medio de un paso lo responde la IA, y después se repite el paso.
    if (p?.ia) repetirPaso = { texto: p.repetir, opciones: p.opciones ?? null };
    else if (p) {
      const nombre = p.pedido?.nombre || p.nombre || estado?.nombre;
      await guardar({ ...(estado ?? {}), idioma: estado?.idioma ?? idioma, humanoHasta: estado?.humanoHasta ?? 0, pedido: p.pedido, ...(nombre && { nombre }) });
      await recordar(ev.text, p.texto);
      return { send: [msgTexto(ev.from, p.texto, p.opciones)], metrica: p.metrica, ...(p.numero && { pedido: p.numero }) };
    }
  }

  // El paso de una consulta (ZL-146): el asistente le pidió el nombre para pasarla al equipo. ZL-163: si en vez del nombre
  // hace una pregunta, la responde la IA y le vuelve a pedir el nombre; otra cosa, sigue la charla normal.
  if (neg && memoria && ev.kind === 'text' && estado?.consulta?.paso === 'nombre' && !repetirPaso) {
    const nombre = nombreDeMensaje(ev.text);
    if (nombre) {
      const tipo = estado.consulta.tipo;
      const reg = await pasarAlEquipo(tipo, { nombre, interes: estado.consulta.interes, pausa: tipo === 'persona' });
      const texto = (tipo === 'persona' ? T.persona : T.consultaLista(nombre));
      await recordar(ev.text, texto, { nombre, consulta: null });
      return { send: [msgTexto(ev.from, texto)], metrica: tipo === 'persona' ? 'persona_auto' : 'consulta', ...(tipo === 'persona' && { handoff: true }), ...(reg && { consulta: reg.numero }) };
    }
    if (/[?¿]/.test(ev.text)) repetirPaso = { texto: T.consultaNombre, opciones: null };
    else await guardar({ ...estado, consulta: null });
  }

  // Quien no nos conoce tiene que ver qué ofrecemos desde el primer mensaje: un saludo o «¿qué hacen?» reciben la
  // presentación y el menú, sin gastar IA (también si ya eligió idioma antes y vuelve a escribir otro día).
  const saludo = ev.kind === 'text' ? esSaludo(ev.text) : null;
  const queHacen = ev.kind === 'text' && !saludo ? pideQueHacen(ev.text) : null;
  // Un negocio que ya conoce a la persona (ZL-146) no le repite el saludo fijo: la IA la saluda y retoma lo que charlaron.
  const conocida = neg && !!(estado?.resumen || estado?.nombre);
  if ((saludo || queHacen) && conocido && !(conocida && saludo)) {
    if (unico && !estado) await guardar({ idioma: unico, humanoHasta: 0 });
    // Un negocio con varios idiomas (ZL-127): el idioma del mensaje manda. «Hello» con castellano guardado pasa a
    // inglés; un saludo que vale en varios idiomas («hey», «info») deja el que ya tenía.
    let en = conocido;
    if (perfil.idiomaPorNumero) {
      const posibles = (saludo ? idiomasDelSaludo(ev.text) : idiomasQueHacen(ev.text)).filter((i) => perfil.idiomas.includes(i));
      if (posibles.length && !posibles.includes(conocido)) {
        en = posibles[0];
        await guardar({ ...estado, idioma: en, humanoHasta: estado?.humanoHasta ?? 0 });
      }
    }
    const P = perfil.textos(en);
    const primero = saludo ? juntar(P.hola, P.quienes) : P.quienes;
    if (neg) {
      const texto = juntar(primero, P.menu);
      await recordar(ev.text, texto);
      return { send: [msgTexto(ev.from, texto, perfil.menuOpciones(en))], metrica: saludo ? 'saludo' : 'presentacion' };
    }
    return { send: [msgTexto(ev.from, primero), msgTexto(ev.from, P.menu)], metrica: saludo ? 'saludo' : 'presentacion' };
  }
  // Todavía no eligió idioma: si saluda otra vez se le vuelve a preguntar; si pregunta qué hacemos, se toma el idioma
  // de la pregunta.
  if (saludo && esperaIdioma) return { send: [pedirIdioma()], metrica: 'pide_idioma' };
  if (queHacen && esperaIdioma) {
    const en = delPerfil(queHacen) ?? perfil.idiomas[0];
    await guardar({ ...estado, idioma: en, humanoHasta: 0 });
    const P = perfil.textos(en);
    if (neg) return { send: [msgTexto(ev.from, juntar(P.quienes, P.menu), perfil.menuOpciones(en))], metrica: 'presentacion', idioma: en };
    return { send: [msgTexto(ev.from, P.quienes), msgTexto(ev.from, P.menu)], metrica: 'presentacion', idioma: en };
  }

  // Un número del menú: respuesta fija, sin gastar IA.
  if (num && conocido && perfil.opcion(idioma, num)) {
    await recordar(ev.text, perfil.opcion(idioma, num));
    return { send: [msgTexto(ev.from, perfil.opcion(idioma, num))], metrica: 'opcion', opcion: num };
  }

  // Primer contacto de un negocio con una pregunta concreta: saludo y presentación, y además la respuesta.
  const primerContacto = !!(unico && memoria && !estado);
  if (primerContacto) await guardar({ idioma: unico, humanoHasta: 0 });

  // Primer contacto (con memoria): botones de idioma. Si escribe otra cosa sin elegir, sigue en castellano.
  if (memoria && !estado && !unico) {
    await guardar({ humanoHasta: 0 });
    return { send: [pedirIdioma()], metrica: 'pide_idioma' };
  }

  const texto = String(ev.text ?? '').replace(CONTROL_RE, ' ').trim().slice(0, LIMITES.mensaje);
  if (!texto) return { send: [msgTexto(ev.from, T.soloTexto)], metrica: 'vacio' };

  // ZL-162: le ofrecimos averiguarlo con el equipo. «Sí»: se pasa (con la pregunta anotada) y se le confirma una sola
  // vez. «No»: listo. Otra cosa: sigue la charla normal y el ofrecimiento se olvida.
  if (neg && memoria && estado?.oferta && now - estado.oferta.t < OFERTA_MS) {
    const { pregunta } = estado.oferta;
    const sn = siNo(texto);
    estado = { ...estado, oferta: null };
    if (sn === 'si') {
      const resumen = [estado.resumen, pregunta && `Preguntó: «${pregunta}»`].filter(Boolean).join(' ').slice(0, 300);
      const reg = await pasarAlEquipo('persona', { pausa: true, resumen, interes: pregunta ?? '', ...(estado.nombre && { nombre: estado.nombre }) });
      await recordar(texto, T.persona, { pase: now });
      if (charlas) await agregar(charlas, ev.from, [{ de: 'persona', texto: pregunta || texto }, { de: 'sistema', texto: 'El asistente pasó la charla al equipo (la persona aceptó que lo averigüen).' }], now, { abierta: true, idioma });
      return { send: [msgTexto(ev.from, T.persona)], metrica: 'persona_auto', handoff: true, ...(reg && { consulta: reg.numero }), ...(charlas && { avisar: true }) };
    }
    if (sn === 'no') {
      await recordar(texto, T.dejamosAsi, { oferta: null });
      return { send: [msgTexto(ev.from, T.dejamosAsi)], metrica: 'oferta_no' };
    }
    await guardar(estado);
  }

  // Topes antes de gastar IA: el de toda la cuenta por minuto y el de este número por día.
  if ((await cupo()) !== 'ok') return { send: [msgTexto(ev.from, T.limite)], metrica: 'limite_global' };
  if (memoria?.contar && (await memoria.contar(ev.from)) > TOPE_DIARIO) return { send: [msgTexto(ev.from, T.tope)], metrica: 'tope_diario' };

  // Un negocio (ZL-127): el idioma del mensaje se reconoce sin IA y se le ordena a la IA responder en ese; si no se
  // reconoce, la IA usa el de la charla y dice en cuál respondió. Con varios idiomas, desde ahí los textos fijos (menú,
  // PERSONA) siguen en ese idioma. El estudio sigue como siempre.
  const detectado = perfil === PERFIL_ESTUDIO ? null : idiomaDelTexto(texto);
  // Con pedidos, la IA ve el carrito actual para devolverlo completo si el mensaje lo cambia.
  const carrito = pedidos && memoria ? { carrito: await pedidos.contexto() } : {};
  // Un negocio (ZL-146): la IA ve los últimos mensajes y lo que sabemos de la persona, y sabe a qué cierre llevarla.
  // Sin pedidos por chat encendidos (o sin productos), el cierre es una consulta aunque la ficha diga «pedidos» (ZL-147).
  // ZL-153: si la charla ya empezó (el saludo, el menú o una respuesta), la IA no vuelve a saludar.
  const saludado = Boolean(estado?.ultimo || historial(estado, now).length);
  // ZL-154: los pedidos y la consulta abierta de esta persona (solo para leer: la IA nunca los cambia).
  const compras = neg ? await comprasParaIa(pedidos, consultas, now) : null;
  const contexto = neg ? { ...carrito, ...memoriaParaIa(estado, now), saludado, ...(compras && { compras }), objetivo: perfil.objetivo === 'pedidos' && !pedidos ? 'consultas' : perfil.objetivo ?? (pedidos ? 'pedidos' : 'consultas') } : carrito;
  const c = detectado ? await preguntar(texto, detectado, { seguro: true, ...contexto }) : await preguntar(texto, idioma, contexto);
  // ZL-162: mientras la IA pensaba llegó otro mensaje de la misma persona: esa ráfaga ya lo incluye y responde todo junto.
  if (vigente && !(await vigente())) return { send: [], metrica: 'reemplazado' };
  // Solo lo reconocido sin IA cambia el idioma de la charla: lo que dice la IA de sí misma no siempre es cierto.
  const cambio = perfil.idiomaPorNumero && memoria ? delPerfil(detectado) : null;
  const enIdioma = cambio ?? idioma;
  if (cambio && cambio !== idioma) await guardar({ ...(estado ?? {}), idioma: cambio, humanoHasta: estado?.humanoHasta ?? 0 });
  let respuesta = perfil.formatear(c, enIdioma);
  // ZL-153: si la charla ya empezó y la persona no saludó, la respuesta no arranca con «¡Hola!» (aunque la IA lo diga).
  if (neg && saludado && !saludo) respuesta = sinSaludoInicial(respuesta);
  // La IA propuso cambiar el carrito: el código lo valida, reserva y arma el resumen (ZL-139).
  let pedido = null;
  if (pedidos && memoria && c.pedido && !c.tope) {
    pedido = await pedidos.despues(c.pedido, enIdioma);
    if (pedido) {
      respuesta = [c.vacia || pedido.soloSistema ? '' : c.respuesta, pedido.texto].filter(Boolean).join('\n\n');
      const ahora = (await memoria.get(ev.from)) ?? estado ?? {};
      await guardar({ ...ahora, idioma: ahora.idioma ?? enIdioma, humanoHasta: ahora.humanoHasta ?? 0, pedido: pedido.pedido });
    }
  }
  if (neg) {
    const Te = perfil.textos(enIdioma);
    const nombre = c.memoria?.nombre || estado?.nombre || '';
    const aprendido = { ...(nombre && { nombre }), ...(c.memoria?.resumen && { resumen: c.memoria.resumen }) };
    let metrica = pedido ? 'ia_pedido' : 'ia';
    let extra = {};
    // Hace falta alguien del negocio (lo pidió, es un reclamo, la IA no tenía la respuesta o se llegó al tope del día):
    // el asistente se calla en esta charla, el negocio la ve en «Pedidos y consultas» y responde por acá.
    // ZL-162: si la IA no sabe algo, no se pasa sola la charla: se le ofrece averiguarlo con el equipo (pasa si dice que
    // sí). Si eso mismo ya quedó pendiente (el dueño devolvió la charla sin responderlo), no se vuelve a ofrecer.
    if (c.persona && !c.tope && !c.fuera_de_tema && c.motivo === 'no_se' && Te.ofrecerEquipo) {
      const pendiente = estado?.devuelta && now - estado.devuelta.t < DEVUELTA_MS;
      respuesta = juntar(sinPreguntaFinal(c.vacia ? Te.noTengo : c.respuesta) || Te.noTengo, pendiente ? Te.todaviaNo : Te.ofrecerEquipo);
      if (!pendiente) aprendido.oferta = { t: now, pregunta: texto.slice(0, 200) };
      metrica = pendiente ? 'no_sabe' : 'ofrece_equipo';
      extra = { noSabe: texto.slice(0, 200) };
    } else if ((c.persona || c.tope) && !c.fuera_de_tema) {
      const reg = await pasarAlEquipo('persona', { ...aprendido, pausa: true });
      aprendido.pase = now;
      respuesta = c.vacia || c.tope ? Te.sinRespuesta : juntar(sinPreguntaFinal(c.respuesta), Te.persona);
      metrica = 'persona_auto';
      extra = { handoff: true, ...(reg && { consulta: reg.numero }) };
      // La cuenta del estudio con la ficha de un negocio (ZL-124) tiene el panel del equipo: la charla va ahí y se avisa.
      if (charlas) {
        await agregar(charlas, ev.from, [{ de: 'persona', texto }, { de: 'sistema', texto: `El asistente pasó la charla al equipo. Idioma: ${NOMBRE_IDIOMA[enIdioma] ?? enIdioma}.` }], now, { abierta: true, idioma: enIdioma });
        extra.avisar = true;
      }
    } else if (c.avanzar === 'consulta' && consultas && !pedido) {
      // Quiere avanzar y el cierre es una consulta: con el nombre se registra ya; si no, se le pide (un solo dato).
      if (nombre) {
        const reg = await pasarAlEquipo('consulta', aprendido);
        respuesta = juntar(sinPreguntaFinal(c.respuesta), Te.consultaLista(nombre));
        metrica = 'consulta';
        extra = reg ? { consulta: reg.numero } : {};
      } else {
        respuesta = juntar(sinPreguntaFinal(c.respuesta), Te.consultaNombre);
        aprendido.consulta = { paso: 'nombre', tipo: 'consulta', interes: c.memoria?.resumen ?? '' };
        metrica = 'consulta_nombre';
      }
    }
    // Seguimiento con permiso (ZL-151): si queda a medias (falta el nombre de una consulta, o un carrito sin confirmar),
    // un recordatorio más tarde, dentro de las 24 h. Como mucho dos por charla, y nunca después de BAJA.
    const puedeSeguir = !estado?.baja && (estado?.seguidos ?? 0) < 2;
    if (puedeSeguir && metrica === 'consulta_nombre') aprendido.seguir = { cuando: now + SEGUIR_CONSULTA_MS, tipo: 'consulta', charla: ev.from };
    if (puedeSeguir && metrica === 'ia_pedido' && pedido?.pedido?.paso === 'confirmar') aprendido.seguir = { cuando: now + SEGUIR_CARRITO_MS, tipo: 'carrito', charla: ev.from };
    // Volvió el asistente después de un pase que nadie tomó (ZL-149): lo dice una vez y sigue.
    if (estado?.pase && metrica !== 'persona_auto' && (!estado.humanoHasta || estado.humanoHasta <= now)) {
      respuesta = juntar(Te.sigoYo, respuesta);
      aprendido.pase = 0;
    }
    // ZL-163: estaba en un paso (entrega, nombre, dirección, revisión): después de responder, se repite el paso. Si la
    // IA cambió el carrito, manda el resumen nuevo (que ya pregunta lo que sigue).
    let opciones = metrica === 'ia_pedido' ? pedido?.opciones : null;
    if (repetirPaso && !pedido && !['persona_auto', 'ofrece_equipo'].includes(metrica) && !respuesta.includes(repetirPaso.texto)) {
      respuesta = juntar(sinPreguntaFinal(respuesta), repetirPaso.texto);
      opciones = repetirPaso.opciones;
    }
    // ZL-161: las fotos que pidió van después del texto (con su link firmado). En la memoria queda que se las mandamos,
    // así no se repiten. Si la charla pasó a una persona, no.
    const fotos = metrica === 'persona_auto' ? [] : (c.fotos ?? []).filter((f) => f?.link).slice(0, 3);
    await recordar(texto, fotos.length ? `${respuesta}\n(Le mandé la foto de: ${fotos.map((f) => f.nombre).join(', ')})` : respuesta, aprendido);
    return { send: [msgTexto(ev.from, respuesta, opciones), ...fotos.map((f) => msgImagen(ev.from, f.link, f.nombre))], metrica, ...extra, ...(fotos.length && { fotos: fotos.length }), idioma, fuera: c.fuera_de_tema, notas: c.notas, uso: c.uso };
  }
  return {
    send: primerContacto
      ? [msgTexto(ev.from, juntar(T.hola, T.quienes)), msgTexto(ev.from, respuesta)]
      : [msgTexto(ev.from, respuesta)],
    metrica: pedido ? 'ia_pedido' : 'ia',
    idioma,
    fuera: c.fuera_de_tema,
    notas: c.notas,
    uso: c.uso,
  };
}

const limpiarTexto = (t) => String(t ?? '').replace(CONTROL_RE, ' ').replace(/\s+/g, ' ').trim();

/**
 * El nombre que manda la persona cuando se lo pedimos («Juan», «soy Ana Pérez», «me llamo Luis»). Una pregunta, un
 * número o un mensaje largo no son un nombre: → '' y la charla sigue normal.
 */
export function nombreDeMensaje(texto) {
  // ZL-153: «Nelson me llamo», «sí, soy Ana», «dale, me llamo Luis» → el nombre, sin las palabras de alrededor.
  let t = limpiarTexto(texto)
    .replace(/[.!,;:]+$/, '')
    .replace(/^(si|sí|dale|ok|okey|claro|bueno|perfecto|listo|genial|de una)[,.!]?\s+/i, '')
    .replace(/^(hola|buenas)[,!.]?\s*/i, '')
    .replace(/^(soy|me llamo|mi nombre es|me dicen|es|i'?m|my name is|ja sam|zovem se)\s+/i, '')
    .replace(/[,\s]+(me llamo|es mi nombre|soy yo|me dicen)$/i, '')
    .replace(/[.!]+$/, '').trim();
  if (!t || t.length < 2 || t.length > 60 || /[?¿@\d]|https?:/i.test(t)) return '';
  if (t.split(' ').length > 4) return '';
  if (/^(si|sí|no|ok|dale|gracias|menu|menú|persona|cancelar|hola|buenas)$/i.test(t)) return '';
  // ZL-163: «quiero encargarla» no es un nombre (se tomaba como «Quiero Encargarla»).
  if (noEsNombre(t)) return '';
  return t.split(' ').map((w) => w.charAt(0).toLocaleUpperCase() + w.slice(1)).join(' ');
}

/** Los últimos mensajes de la charla (solo los de las últimas 48 h). */
const historial = (estado, now) => (estado?.histT && now - estado.histT < HISTORIAL_MS && Array.isArray(estado.hist) ? estado.hist : []);

/**
 * ZL-154: lo que la persona ya pidió o consultó en este negocio, para la IA: los últimos 3 pedidos (qué, cuándo, en qué
 * estado) y la consulta abierta. Nunca frena la charla si falla. → {texto, montos} o null si no hay nada.
 */
export async function comprasParaIa(pedidos, consultas, now) {
  const p = pedidos?.compras ? await pedidos.compras(now).catch(() => null) : null;
  const k = consultas?.abierta ? await consultas.abierta().catch(() => null) : null;
  const texto = [p?.texto, k].filter(Boolean).join('\n');
  return texto ? { texto, montos: p?.montos ?? [] } : null;
}

/** Lo que la IA de un negocio sabe de la charla (ZL-146): los últimos mensajes y la persona (nombre, resumen, días). */
export function memoriaParaIa(estado, now) {
  const dias = Number.isFinite(estado?.ultimo) ? Math.floor((now - estado.ultimo) / 86_400_000) : null;
  // ZL-162: lo que quedó pendiente cuando el dueño devolvió la charla sin responderlo (para no volver a pasarla).
  const pendiente = estado?.devuelta && now - estado.devuelta.t < DEVUELTA_MS ? estado.devuelta.pregunta : '';
  const sabe = estado?.nombre || estado?.resumen || pendiente;
  return { historial: historial(estado, now), cliente: sabe ? { nombre: estado.nombre ?? '', resumen: estado.resumen ?? '', dias, ...(pendiente && { pendiente }) } : null };
}

/** Suma el mensaje y la respuesta a la memoria corta de un negocio (y lo que se aprendió de la persona). */
async function recordarCharla(memoria, de, estado, now, idioma, neg, entrada, salida, extra) {
  if (!neg || !memoria) return;
  const ahora = (await memoria.get(de)) ?? estado ?? {};
  const hist = [...historial(ahora, now), { r: 'u', t: limpiarTexto(entrada).slice(0, 500) }, { r: 'a', t: String(salida ?? '').slice(0, 500) }].slice(-HISTORIAL_MAX);
  // El idioma no se fija acá: si todavía no lo eligió, se le sigue preguntando.
  await memoria.put(de, { ...ahora, humanoHasta: ahora.humanoHasta ?? 0, ...extra, hist, histT: now, ultimo: now });
}

/**
 * Pasa la charla al equipo del negocio (ZL-146): la registra en «Pedidos y consultas» con lo que sabemos (nunca el texto
 * de la charla) y, si hace falta una persona, pausa al asistente las horas de la ficha. → {numero, nueva} o null.
 */
async function pase(memoria, consultas, de, estado, now, horas, idioma, tipo, { pausa = false, ...datos } = {}) {
  // ZL-149: la pausa de un pase es de 15 minutos; si alguien del negocio la toma (responde o toca «La atiendo yo»),
  // pasa a las horas de la ficha. Si nadie la toma, vuelve el asistente.
  if (pausa && memoria) {
    const ahora = (await memoria.get(de)) ?? estado ?? {};
    await memoria.put(de, { ...ahora, idioma: ahora.idioma ?? idioma, humanoHasta: now + PASE_MS, pase: now, consulta: null, oferta: null });
  }
  if (!consultas) return null;
  const st = (memoria && (await memoria.get(de))) || estado || {};
  return consultas.registrar({ tipo, nombre: datos.nombre ?? st.nombre ?? '', interes: datos.interes ?? st.interes ?? '', resumen: datos.resumen ?? st.resumen ?? '', idioma });
}

/**
 * Pregunta al modelo con el prompt del asistente de la página + la nota de canal (`canal`: WhatsApp por defecto,
 * Instagram en instagram.js), y pasa la salida por los mismos controles fijos (controlar). llamar(cuerpo) se
 * reemplaza en los tests.
 */
export const preguntador =
  // Espera más corta que en la página: el trabajo corre después de responderle a Meta y tiene tiempo limitado.
  (env, { llamar = (cuerpo) => llamarClaude(cuerpo, { apiKey: env.ANTHROPIC_API_KEY, esperaMs: 12_000, pausaMs: 800 }), canal = CANAL_WHATSAPP } = {}) =>
  async (texto, idioma = 'es') => {
    const cuerpo = armarPedidoApi(
      { mensajes: [{ role: 'user', content: texto }], idioma },
      { modelo: env.MODELO || MODELO, canal: canal.replace('{idioma}', NOMBRE_IDIOMA[idiomaDe(idioma)]) },
    );
    // Si la respuesta salió cortada se prueba una vez más (igual que en la página).
    const r = await llamar(cuerpo).catch((e) => (e?.message === 'cortada' ? llamar(cuerpo) : Promise.reject(e)));
    return { ...controlar(r.salida, idioma), uso: { entrada: r.uso?.input_tokens ?? 0, salida: r.uso?.output_tokens ?? 0 } };
  };
