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
import { agregar } from './panel.js';
import { CANAL_WHATSAPP, eligeIdioma, IDIOMA_POR_NUMERO, IDIOMAS, idiomaDe, NOMBRE_IDIOMA, numeroSolo, opcion, SALUDO_IDIOMA, textos } from './textos.js';

export const GRAPH_VERSION = 'v25.0';
export const HORAS_PERSONA = 24;
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

export const msgTexto = (to, body) => ({
  messaging_product: 'whatsapp',
  recipient_type: 'individual',
  to,
  type: 'text',
  text: { preview_url: false, body: String(body).slice(0, 4096) },
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
export async function enviar(env, mensaje, fetchImpl = fetch) {
  let err = await postear(env, mensaje, fetchImpl);
  const alt = varianteArgentina(mensaje.to);
  if (err && err.code === 131030 && alt) err = await postear(env, { ...mensaje, to: alt }, fetchImpl);
  // Solo estado y código: el texto del error de Meta podría traer datos.
  if (err) throw Object.assign(new Error(`WhatsApp ${err.status} ${err.code ?? ''}`.trim()), { code: err.code });
}

// ───────────────────────── Lógica ─────────────────────────

const notaNoTexto = (ev) => (ev.kind === 'idioma' ? '[Eligió idioma]' : '[Mandó algo que no es texto: audio, foto o archivo]');

/**
 * Decide qué contestar a un evento. Devuelve los mensajes a mandar y métricas (sin texto ni número).
 * deps: {memoria, charlas (o null sin panel), preguntar(texto, idioma) → respuesta controlada, now,
 *        cupo() → 'ok' | 'global' (el tope por minuto de toda la cuenta), solo antes de gastar IA}
 */
export async function atender(ev, { memoria, charlas = null, preguntar, now = Date.now(), cupo = async () => 'ok' }) {
  if (memoria && (await memoria.visto(ev.id))) return { send: [], metrica: 'repetido' };
  const estado = (memoria && (await memoria.get(ev.from))) || null;
  // El nombre o la bandera de un idioma como mensaje entero vale como el botón (en Instagram no hay botones);
  // mientras se espera el idioma (ya saludamos y todavía no eligió), también 1, 2 o 3.
  const num = ev.kind === 'text' ? numeroSolo(ev.text) : null;
  const esperaIdioma = !!estado && !estado.idioma;
  const elegido = ev.kind === 'text' ? eligeIdioma(ev.text) ?? (esperaIdioma ? IDIOMA_POR_NUMERO[num] ?? null : null) : null;
  if (elegido) ev = { ...ev, kind: 'idioma', idioma: elegido };
  const guardar = (s) => memoria?.put(ev.from, s);
  const cmd = ev.kind === 'text' ? comando(ev.text) : null;
  const idioma = idiomaDe(estado?.idioma);
  const T = textos(idioma);

  if (cmd === 'borrar') {
    await memoria?.delete(ev.from);
    await charlas?.delete(ev.from);
    return { send: [msgTexto(ev.from, T.borrado)], metrica: 'borrar' };
  }

  // Atiende una persona: el asistente no contesta (salvo BORRAR) hasta que lo devuelvan o pasen 24 h.
  // El mensaje queda en la charla del panel y la ventana de 24 h se renueva (se guarda como mucho una vez por hora).
  // Sin panel nadie lo leería: en ese caso sigue el asistente.
  if (charlas && estado?.humanoHasta && estado.humanoHasta > now) {
    const texto = ev.kind === 'text' ? String(ev.text ?? '').replace(CONTROL_RE, ' ').trim() || '[Mensaje vacío]' : notaNoTexto(ev);
    await agregar(charlas, ev.from, { de: 'persona', texto }, now, { abierta: true });
    const hasta = now + HORAS_PERSONA * 3600_000;
    if (hasta - estado.humanoHasta > 3600_000) await guardar({ ...estado, humanoHasta: hasta });
    return { send: [], metrica: 'humano' };
  }

  if (cmd === 'persona') {
    // Sin panel o sin memoria nadie vería el pedido: se deriva al correo y el asistente no se calla.
    if (!charlas || !memoria) return { send: [msgTexto(ev.from, T.personaMail)], metrica: 'persona', handoff: true };
    await guardar({ ...estado, idioma, humanoHasta: now + HORAS_PERSONA * 3600_000 });
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
    const nuevo = idiomaDe(ev.idioma);
    await guardar({ ...estado, idioma: nuevo, humanoHasta: 0 });
    // ¿Cómo estás? + quiénes somos, y enseguida lo que podemos lograr juntos.
    return { send: [msgTexto(ev.from, textos(nuevo).bienvenida), msgTexto(ev.from, textos(nuevo).menu)], metrica: 'idioma', idioma: nuevo };
  }

  if (cmd === 'idioma') {
    // Mientras elige, los números 1 a 3 son idiomas (no opciones del menú).
    if (estado) await guardar({ humanoHasta: estado.humanoHasta ?? 0 });
    return { send: [msgIdiomas(ev.from)], metrica: 'pide_idioma' };
  }
  if (cmd === 'menu') return { send: [msgTexto(ev.from, T.menu)], metrica: 'menu' };
  if (ev.kind === 'otro') return { send: [msgTexto(ev.from, T.soloTexto)], metrica: 'otro' };

  // Un número del menú: respuesta fija, sin gastar IA.
  if (num && estado?.idioma && opcion(idioma, num)) return { send: [msgTexto(ev.from, opcion(idioma, num))], metrica: 'opcion', opcion: num };

  // Primer contacto (con memoria): botones de idioma. Si escribe otra cosa sin elegir, sigue en castellano.
  if (memoria && !estado) {
    await guardar({ humanoHasta: 0 });
    return { send: [msgIdiomas(ev.from)], metrica: 'pide_idioma' };
  }

  const texto = String(ev.text ?? '').replace(CONTROL_RE, ' ').trim().slice(0, LIMITES.mensaje);
  if (!texto) return { send: [msgTexto(ev.from, T.soloTexto)], metrica: 'vacio' };

  // Topes antes de gastar IA: el de toda la cuenta por minuto y el de este número por día.
  if ((await cupo()) !== 'ok') return { send: [msgTexto(ev.from, T.limite)], metrica: 'limite_global' };
  if (memoria?.contar && (await memoria.contar(ev.from)) > TOPE_DIARIO) return { send: [msgTexto(ev.from, T.tope)], metrica: 'tope_diario' };

  const c = await preguntar(texto, idioma);
  return {
    send: [msgTexto(ev.from, formatear(c, idioma))],
    metrica: 'ia',
    idioma,
    fuera: c.fuera_de_tema,
    notas: c.notas,
    uso: c.uso,
  };
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
