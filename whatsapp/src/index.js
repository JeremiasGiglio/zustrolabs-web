// Worker «zustrolabs-whatsapp»: el WhatsApp y el Instagram de Zustro Labs.
// - zustrolabs.com/api/whatsapp → webhook de la Cloud API de Meta (whatsapp.js).
// - zustrolabs.com/api/instagram → webhook de los mensajes directos de Instagram (instagram.js);
//   /api/instagram/conectar → link para que una cuenta (la del estudio o la de un cliente) se conecte con su Instagram.
// - zustrolabs.com/api/whatsapp/ycloud/<clave> → el WhatsApp de cada negocio, por su cuenta de YCloud (ycloud.js, ZL-135).
// - equipo.zustrolabs.com → panel de atención humana, detrás de Cloudflare Access (panel.js).
// Separado del Radar Croacia: otra app de Meta, otro número, otra memoria y la clave de IA del estudio.
import { adaptadores, almacenPrueba, crearAtencion } from './atencion.js';
import { appDe, armarFrom, conectarCuenta, enviarIg, esInstagram, leerComentariosIg, leerEstado, leerWebhookIg, mantenerCuentas, nombreDe, paginaConectado, responderComentario, responderEnPrivado, secretosDe, textoDePublicacion, urlAutorizar } from './instagram.js';
import { configComentarios, esRuido, MAX_EDAD_COMENTARIO_MS, preguntadorComentario, TOPE_COMENTARIOS_DIA } from './comentarios.js';
import { conAjustes, conAvisoDia, conInfo, conPreguntas, parsearFicha, perfilNegocio, preguntadorNegocio, resumenFicha } from './negocio.js';
import { ajustesDeVenta, HISTORIAL_MAX, HISTORIAL_MS, limiteDiaDe } from './atencion.js';
import { administrar, appCompartida, appNegocios, canalesDe, textoEstado, conectarWhatsApp, desconectarWhatsApp, NEGOCIOS_HOST, todosLosNumeros } from './negocios.js';
import { avisar, avisarEquipo, panel } from './panel.js';
import { CANAL_INSTAGRAM, CANAL_WHATSAPP, textos } from './textos.js';
import { atender, enviar, firmaValida, leerWebhook, msgTexto, preguntador, verificarSuscripcion } from './whatsapp.js';
import { claveMemoria, claveValida, enviarYCloud, firmaYCloud, leerYCloud, normalizar, numeroDeCharla, webhookDeYCloud } from './ycloud.js';
import { agregarAAcceso, correosEnAcceso } from './acceso.js';
import { pedidosDeCharla } from './pedidos-charla.js';
import { consultasDeCharla } from './consultas.js';
import { avisarCelulares } from './push.js';
import { leerLinkFoto, linkFoto, RUTA_FOTOS } from './fotos.js';
import { armarReporte, diaLocal, horaLocal, xlsx } from './reporte.js';
import { ajustesConMiNegocio, cuandoResponden, enZona, feriados, fueraDeHorarioAhora, paisDeZona, textoMiNegocioIa, tieneHorarios, turnosDe } from './minegocio.js';
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
  return async (texto, { refs = false, contexto = '' } = {}) => {
    const r = await cat.ejecutar('paraAsistente', [texto, { precios: ficha.precios, refs, contexto }]);
    return r?.ok ? r.valor : null;
  };
};

/**
 * La IA de un negocio: su ficha, sus productos y su tope diario (uno con mucho movimiento no deja sin IA a los demás;
 * también es lo que se le factura). Lo usan Instagram y WhatsApp por YCloud.
 */
/**
 * La ficha con todo lo que carga el negocio en la app: «Cómo vendés» (ZL-149), el aviso del día (ZL-159) y las
 * preguntas frecuentes (ZL-162). La usan la charla, los comentarios y la charla de prueba.
 */
export function fichaDelNegocio(fichaSola, dueño, now = Date.now()) {
  const conVenta = dueño?.ajustes ? conAjustes(fichaSola, ajustesDeVenta(dueño.ajustes)) : fichaSola;
  return conPreguntas(conAvisoDia(conMiNegocio(conVenta, dueño, now), dueño?.avisoDia, now), dueño?.preguntas);
}

/**
 * ZL-164: «Mi negocio». La IA recibe la fecha y la hora del negocio siempre, y con horarios cargados, si está abierto
 * ahora y cuándo abre (calculado por el código, no por la IA); también la dirección con mapa, los envíos por zona, las
 * formas de pago (sin el alias) y el contacto. Los textos fijos («te responden por acá …») dicen «hoy hasta las 20:30»
 * o «mañana desde las 9:00» en vez del horario escrito a mano en la ficha.
 */
export function conMiNegocio(ficha, dueño, now = Date.now()) {
  if (!ficha || !dueño) return ficha;
  const mn = dueño.minegocio ?? null;
  const zona = ajustesDeVenta(dueño.ajustes).zona;
  const f = conInfo(ficha, 'Mi negocio: fecha, hora, horarios, dirección, envíos y pagos (lo carga el negocio y lo calcula el sistema; manda sobre lo de arriba)', textoMiNegocioIa(mn, zona, now));
  if (!tieneHorarios(mn)) return f;
  const idiomas = f.idiomas?.length ? f.idiomas : [f.idioma];
  const horarios = Object.fromEntries(idiomas.map((i) => [i, cuandoResponden(mn, zona, now, i) || f.horarios?.[i] || '']));
  return { ...f, horarios, horarioPersona: horarios[f.idioma] ?? f.horarioPersona };
}

/** «Cómo vendés» completado con «Mi negocio» (formas de pago marcadas, dirección, zonas de envío). */
export const ajustesDelNegocio = (dueño, opciones) => ajustesConMiNegocio(ajustesDeVenta(dueño?.ajustes), dueño?.minegocio ?? null, opciones);

function iaDeNegocio(env, deps, a, dueño, fichaSola, canal) {
  const ficha = fichaDelNegocio(fichaSola, dueño, deps.now ?? Date.now());
  const catalogo = consultaCatalogo(env, deps, dueño?.id, ficha);
  const ia = deps.preguntarNegocio ? deps.preguntarNegocio(ficha, catalogo) : preguntadorNegocio(env, ficha, { catalogo, canal });
  return async (texto, idioma, opciones) => {
    if (dueño && a.negocios && (await a.negocios.contarUso(dueño.id)) > limiteDiaDe(dueño)) return { respuesta: '', vacia: true, tope: true, persona: true, fuera_de_tema: false, notas: ['tope_negocio'] };
    return conLinksDeFotos(a, deps, dueño?.id, await ia(texto, idioma, opciones));
  };
}

/** ZL-161: las fotos que pidió la IA (ya controladas contra el catálogo), con un link público firmado que vence. */
async function conLinksDeFotos(a, deps, negocioId, r) {
  if (!r?.fotos?.length) return r;
  const clave = negocioId && a.negocios?.claveFotos ? await a.negocios.claveFotos().catch(() => null) : null;
  const now = deps.now ?? Date.now();
  r.fotos = (await Promise.all(r.fotos.map(async (f) => ({ ...f, link: await linkFoto(clave, negocioId, f.foto, now) })))).filter((f) => f.link);
  return r;
}

/**
 * ZL-158: el cupo de IA antes de responder. Cada negocio tiene el suyo (LIMITE_NEGOCIO, 60 por minuto: uno con mucho
 * movimiento no frena a los demás) y hay uno de seguridad para toda la cuenta (LIMITE_GLOBAL, 1.000 por minuto). Si
 * un cupo está lleno, se espera y se reintenta (dos veces, 4 s) en vez de pedirle a la persona que vuelva a escribir.
 * `deps.esperaCupoMs`: en Cloudflare 4 s; en las pruebas, 0.
 */
export function cupoDeIa(env, negocioId, deps = {}, intentos = 3) {
  const espera = deps.esperaCupoMs ?? (deps.rafagaMs ? 4000 : 0);
  const dormir = deps.dormir ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  return async () => {
    for (let i = 1; i <= intentos; i++) {
      const negocio = !negocioId || !env.LIMITE_NEGOCIO?.limit || (await env.LIMITE_NEGOCIO.limit({ key: `ia:${negocioId}` })).success;
      const global = negocio && (await env.LIMITE_GLOBAL.limit({ key: 'ia' })).success;
      if (negocio && global) return 'ok';
      if (i < intentos && espera > 0) await dormir(espera);
    }
    console.log(JSON.stringify({ canal: 'ia', que: 'cupo_lleno', negocio: Boolean(negocioId) }));
    return 'global';
  };
}

/** ZL-159: la pausa que puso el dueño (con la zona horaria del negocio, para decir cuándo vuelven). */
/**
 * ZL-164: con «Fuera de horario: no atender», el negocio cerrado funciona como una pausa hasta que abre: a cada persona
 * se le dice una vez cuándo abren y nada más (BORRAR sigue andando). La pausa del dueño manda sobre esta.
 */
const conPausa = (perfil, dueño, now = Date.now()) => {
  const zona = ajustesDeVenta(dueño?.ajustes).zona;
  if (dueño?.pausa?.hasta > now) return { ...perfil, pausa: { ...dueño.pausa, zona } };
  const f = dueño?.minegocio ? fueraDeHorarioAhora(dueño.minegocio, zona, now) : null;
  if (f?.modo === 'cerrado' && f.hasta) return { ...perfil, pausa: { desde: `cerrado:${f.hasta}`, hasta: f.hasta, zona, cerrado: f.cuando } };
  return perfil;
};

/** ZL-164: con «Fuera de horario: responder sin tomar pedidos», cerrado no se arman pedidos por la charla. */
const sinPedidosAhora = (dueño, now = Date.now()) => {
  const f = dueño?.minegocio ? fueraDeHorarioAhora(dueño.minegocio, ajustesDeVenta(dueño.ajustes).zona, now) : null;
  return f?.modo === 'responder';
};

/** ZL-157: Meta deja escribirle solo dentro de las 24 h de su último mensaje; con media hora de margen. */
export const VENTANA_SEGURA_MS = 23.5 * 3600_000;

/**
 * Le avisa al comprador por el mismo canal del pedido (ZL-139): Instagram con el token de la cuenta del negocio, o
 * WhatsApp con la clave de YCloud del número del negocio. Solo cuentas y números de ESE negocio. → true o el motivo.
 * ZL-157: fuera de las 24 h de su último mensaje ni se intenta (YCloud acepta el envío y Meta lo rechaza después, sin
 * que nos enteremos): devuelve 'fuera_24h' y quien llama guarda el aviso para cuando vuelva a escribir.
 */
async function avisarComprador(env, a, negocio, charla, texto, fetchImpl = fetch, now = Date.now()) {
  const msg = { to: charla, text: { body: String(texto).slice(0, 1000) } };
  try {
    const e = a.memoria ? await a.memoria.get(claveMemoria(charla)) : null;
    if (!e?.ultimo || now - e.ultimo > VENTANA_SEGURA_MS) return 'fuera_24h';
    if (/^yc:\d+:\d+$/.test(charla)) {
      const reg = ((await a.ycloud?.list?.()) ?? []).find((r) => r.negocio === negocio.id && normalizar(r.numero) === normalizar(numeroDeCharla(charla)));
      if (!reg) return 'el número ya no está conectado';
      await enviarYCloud(reg.apiKey, msg, fetchImpl);
      await contarEnviadoWa(a, negocio, now);
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
    /** ZL-163: el idioma de esa charla (para avisarle al comprador en su idioma). */
    async idioma(charla) {
      const e = await a.memoria.get(clave(charla));
      return ['es', 'en', 'hr'].includes(e?.idioma) ? e.idioma : null;
    },
    /** ZL-153: el usuario de Instagram de esa charla, si se guardó (para mostrarlo en la app). */
    async usuario(charla) {
      const e = await a.memoria.get(clave(charla));
      return e?.usuario ?? null;
    },
    /**
     * Devolver al asistente. ZL-162: si el dueño escribió la respuesta, queda en la charla (y ya se le mandó); si no, la
     * pregunta queda «pendiente» un día: el asistente no la vuelve a pasar (se cortaba el ciclo devolver → pasar).
     */
    async devolver(charla, { pregunta = '', respuesta = '' } = {}) {
      const e = await a.memoria.get(clave(charla));
      if (!e) return;
      const t = reloj();
      const hist = respuesta && e.histT && t - e.histT < HISTORIAL_MS && Array.isArray(e.hist) ? [...e.hist, { r: 'a', t: respuesta.slice(0, 500) }].slice(-HISTORIAL_MAX) : e.hist;
      await a.memoria.put(clave(charla), { ...e, humanoHasta: 0, pase: null, consulta: null, oferta: null, devuelta: respuesta || !pregunta ? null : { t, pregunta }, ...(respuesta && hist && { hist, histT: t }) });
    },
    /**
     * ZL-157: un aviso de pedido que no pudo salir solo (fuera de las 24 h) queda guardado: el asistente se lo dice
     * primero la próxima vez que esa persona escriba. Como mucho los 3 últimos.
     */
    /** ZL-157: los avisos guardados de esa charla (para que la app los muestre en la tarjeta del pedido). */
    async avisos(charla) {
      const e = await a.memoria.get(clave(charla));
      return Array.isArray(e?.avisos) ? e.avisos : [];
    },
    /** ZL-157: el dueño ya se lo mandó él: se borran los avisos de ese pedido. */
    async quitarAvisos(charla, numero) {
      const e = await a.memoria.get(clave(charla));
      if (!e?.avisos?.length) return;
      await a.memoria.put(clave(charla), { ...e, avisos: e.avisos.filter((t) => !new RegExp(`N\\.º ${Number(numero)}(?!\\d)`).test(String(t))) });
    },
    async guardarAviso(charla, texto) {
      const e = (await a.memoria.get(clave(charla))) ?? {};
      await a.memoria.put(clave(charla), { ...e, humanoHasta: e.humanoHasta ?? 0, avisos: [...(e.avisos ?? []), String(texto)].slice(-3) });
    },
  };
}

/** ZL-158: cada mensaje que manda el sistema por WhatsApp (Meta cobra pasando los 1.000 por número por mes). */
async function contarEnviadoWa(a, negocio, now, n = 1) {
  if (!negocio?.id || !a.negocios?.sumarMetrica) return;
  const dia = diaLocal(now, ajustesDeVenta(negocio.ajustes).zona);
  for (let i = 0; i < n; i++) await a.negocios.sumarMetrica(negocio.id, 'enviadosWa', dia).catch(() => {});
}

/** Pedidos por chat de un negocio (ZL-139), si los tiene encendidos y una base de productos. */
function pedidosDe(env, deps, dueño, ficha, charla, canal) {
  if (!dueño?.pedidos || sinPedidosAhora(dueño, deps.now ?? Date.now())) return null;
  const cat = catalogoDe(env, deps)(dueño.id);
  return cat ? pedidosDeCharla({ cat, charla, canal, negocio: ficha.nombre, precios: ficha.precios, ajustes: ajustesDelNegocio(dueño) }) : null;
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
    // ZL-164: los mensajes que llegan con el negocio cerrado (para el reporte: «atendió N fuera de horario»).
    if (r.metrica !== 'repetido' && dueño.minegocio && fueraDeHorarioAhora(dueño.minegocio, zona, now)) await a.negocios.sumarMetrica(dueño.id, 'fueraHorario', dia);
    // ZL-164: lo que no supo responder queda para que el dueño lo cargue en «Mi negocio» (una vez por pregunta parecida).
    if (r.noSabe && a.negocios.sumarNoSupo) { await a.negocios.sumarNoSupo(dueño.id, r.noSabe); await a.negocios.sumarMetrica(dueño.id, 'noSupo', dia); }
    const canal = /^yc:/.test(charla) ? 'WhatsApp' : 'Instagram';
    let aviso = null;
    if (r.metrica === 'pedido_nuevo' && r.pedido) aviso = { titulo: 'Pedido nuevo', cuerpo: `Pedido N.º ${r.pedido} por ${canal}. Abrí la app para aceptarlo.` };
    else if (r.consulta && r.handoff) aviso = { titulo: 'Alguien necesita al negocio', cuerpo: `Consulta N.º ${r.consulta} por ${canal}. El asistente espera 15 minutos a que la tomes.` };
    else if (r.consulta && r.metrica === 'consulta') aviso = { titulo: 'Consulta nueva', cuerpo: `Consulta N.º ${r.consulta} por ${canal}: quiere avanzar.` };
    // ZL-157: con un pedido abierto, una foto, un archivo o un audio (el comprobante, casi siempre) es para el dueño.
    else if (r.metrica === 'archivo_pedido' && r.pedido) aviso = { titulo: 'Te mandó un archivo', cuerpo: `Pedido N.º ${r.pedido} por ${canal}: te mandó ${r.archivo === 'audio' ? 'un audio' : 'una foto o un archivo'}. Miralo en tu ${canal}.` };
    // ZL-158: el negocio llegó a su tope de respuestas del día: las charlas pasan al equipo; el dueño se entera una vez.
    if (!aviso && r.notas?.includes?.('tope_negocio') && (await a.negocios.sumarMetrica(dueño.id, 'topes', dia)) === 1) {
      aviso = { titulo: 'El asistente llegó a su tope de hoy', cuerpo: `Ya respondió ${limiteDiaDe(dueño)} mensajes hoy: lo que llegue hasta mañana te lo pasa a vos. Si pasa seguido, escribinos para subirlo.` };
    }
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
 * ZL-157, cada 10 minutos: un pedido pendiente no se vence, así que al dueño se le recuerda al celular a la hora y a las
 * 20 h (antes de que Meta cierre las 24 h para avisarle solo al comprador). Cada recordatorio sale una sola vez.
 */
export async function recordarPedidos(env, deps, now) {
  const a = almacen(env, deps);
  const fetchImpl = deps.fetch ?? fetch;
  if (!a.negocios?.list || !a.negocios.suscripcionesPush) return [];
  const out = [];
  for (const negocio of await a.negocios.list()) {
    if (!negocio?.pedidos) continue;
    const cat = catalogoDe(env, deps)(negocio.id);
    const r = cat ? await cat.ejecutar('recordatorios', [now]).catch(() => null) : null;
    for (const p of r?.ok ? r.valor : []) {
      const canal = /^yc:/.test(p.charla) ? 'WhatsApp' : 'Instagram';
      let aviso;
      if (p.tipo === '1h') {
        aviso = { titulo: `Pedido N.º ${p.numero} espera tu respuesta`, cuerpo: `Lo pidieron hace una hora por ${canal}. Aceptalo o rechazalo: los productos siguen reservados.` };
      } else {
        const e = a.memoria ? await a.memoria.get(claveMemoria(p.charla)).catch(() => null) : null;
        const cierra = (e?.ultimo ?? p.desde) + 24 * 3600_000;
        const zona = ajustesDeVenta(negocio.ajustes).zona;
        const hora = new Intl.DateTimeFormat('es-AR', { timeZone: zona, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(cierra));
        aviso = cierra > now
          ? { titulo: `Pedido N.º ${p.numero}: aceptalo antes de las ${hora}`, cuerpo: `A las ${hora} se cierran las 24 h de ${canal}: después el aviso no le llega solo y se lo tenés que mandar vos.` }
          : { titulo: `Pedido N.º ${p.numero} sigue esperando`, cuerpo: `Cuando lo aceptes o lo rechaces, la app te deja el mensaje listo para mandárselo por ${canal}.` };
      }
      const llegaron = await avisarNegocio(a, negocio.id, aviso, fetchImpl, now);
      // ZL-159: si el negocio no tiene los avisos activados, nadie se entera: a la hora, se le avisa al equipo.
      if (p.tipo === '1h' && !llegaron) {
        await correoAlEquipo(env, deps)(`un pedido de ${negocio.nombre} espera sin que nadie se entere`, [
          `El pedido N.º ${p.numero} de ${negocio.nombre} (por ${canal}) espera hace una hora y el negocio no tiene los avisos al celular activados.`,
          'Conviene avisarle al negocio y ayudarlo a activar «Avisos en este celular» en Inicio.',
        ]).catch(() => false);
      }
      out.push({ que: 'recordatorio', tipo: p.tipo });
    }
    // ZL-163: aceptados sin pagar que vencen pronto → aviso al dueño; los que vencieron → aviso al comprador (y al dueño).
    const v = cat ? await cat.ejecutar('avisosVencimiento', [now]).catch(() => null) : null;
    const zona = ajustesDeVenta(negocio.ajustes).zona;
    const hora = (t) => new Intl.DateTimeFormat('es-AR', { timeZone: zona, weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t));
    for (const p of v?.ok ? v.valor.pronto : []) {
      await avisarNegocio(a, negocio.id, { titulo: `Pedido N.º ${p.numero} vence el ${hora(p.vence)}`, cuerpo: 'Si ya pagó, marcalo «Ya pagó» para que no se cancele solo.' }, fetchImpl, now);
      out.push({ que: 'por_vencer' });
    }
    for (const p of v?.ok ? v.valor.vencidos : []) {
      const f = await a.negocios.ficha?.(negocio.id).catch(() => null);
      const pf = f?.texto ? parsearFicha(f.texto) : null;
      const mem = a.memoria ? await a.memoria.get(claveMemoria(p.charla)).catch(() => null) : null;
      const texto = textoEstado(p, 'vencido', '', pf?.ok ? pf.ficha.nombre : negocio.nombre, null, mem?.idioma ?? 'es');
      const ok = await avisarComprador(env, a, negocio, p.charla, texto, fetchImpl, now);
      if (ok !== true) await pausasDeCharla(a, now)?.guardarAviso?.(p.charla, texto).catch(() => {});
      await avisarNegocio(a, negocio.id, { titulo: `Pedido N.º ${p.numero} se canceló`, cuerpo: 'No se marcó el pago a tiempo. Ya le avisamos al comprador.' }, fetchImpl, now);
      out.push({ que: 'vencido_avisado', llego: ok === true });
    }
  }
  if (out.length) console.log(JSON.stringify({ canal: 'pedidos', que: 'recordatorios', n: out.length }));
  return out;
}

/** ZL-159: el correo al equipo (en las pruebas, `deps.avisarEquipo`). */
const correoAlEquipo = (env, deps) => deps.avisarEquipo ?? ((asunto, lineas) => avisarEquipo(env, asunto, lineas));

/**
 * ZL-159, una vez por día: el semáforo de cada negocio con algún canal encendido (sin charla de prueba, no gasta IA).
 * Si algo está en rojo (un token vencido, un webhook borrado, una ficha apagada), un solo correo al equipo con todo.
 */
export async function revisarNegocios(env, deps, now) {
  const a = almacen(env, deps);
  if (!a.negocios?.list) return [];
  const rojos = [];
  for (const n of await a.negocios.list()) {
    const c = canalesDe(n);
    if (!c.instagram && !c.whatsapp) continue;
    const r = await datosVerificar(env, deps, n.id, now, { charla: false }).catch(() => null);
    const mal = (r?.controles ?? []).filter((x) => x.estado === 'mal');
    if (mal.length) rojos.push({ nombre: n.nombre, mal: mal.map((x) => `${x.texto}${x.arreglo ? ` → ${x.arreglo}` : ''}`) });
  }
  if (rojos.length) {
    await correoAlEquipo(env, deps)(`${rojos.length === 1 ? 'un negocio tiene' : `${rojos.length} negocios tienen`} algo en rojo`, [
      'El semáforo de cada negocio, revisado hoy:',
      '',
      ...rojos.flatMap((x) => [`${x.nombre}:`, ...x.mal.map((m) => `  - ${m}`), '']),
      'Detalle: Admin → el negocio → Verificar, o Conexiones → Estado.',
    ]).catch(() => false);
  }
  console.log(JSON.stringify({ canal: 'negocio', que: 'revision_diaria', rojos: rojos.length }));
  return rojos;
}

/**
 * ZL-164, en el cron diario: si en los próximos 7 días hay un feriado nacional que el negocio no cargó como fecha
 * especial y ese día suele abrir, se le avisa una vez al celular para que diga si abre (si no, el asistente diría que
 * está abierto). Solo los negocios con horarios cargados y una zona cuyo país sabemos calcular.
 */
export async function recordarFeriados(env, deps, now) {
  const a = almacen(env, deps);
  const fetchImpl = deps.fetch ?? fetch;
  if (!a.negocios?.list) return [];
  const out = [];
  for (const n of await a.negocios.list()) {
    const mn = n.minegocio;
    const zona = ajustesDeVenta(n.ajustes).zona;
    const pais = paisDeZona(zona);
    if (!pais || !tieneHorarios(mn)) continue;
    const hoy = enZona(now, zona).fecha;
    const limite = new Date(Date.parse(`${hoy}T12:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
    const anio = Number(hoy.slice(0, 4));
    const proximo = [...feriados(pais, anio), ...feriados(pais, anio + 1)].find((f) => f.fecha >= hoy && f.fecha <= limite && turnosDe(mn, f.fecha).turnos.length && !turnosDe(mn, f.fecha).especial);
    if (!proximo || (n.avisoFeriado ?? '') >= proximo.fecha) continue;
    const dia = `${proximo.fecha.slice(8)}/${proximo.fecha.slice(5, 7)}`;
    const enviados = await avisarNegocio(a, n.id, { titulo: `El ${dia} es feriado`, cuerpo: `${proximo.nombre}. ¿Abren? Cargalo en Mi negocio → Fechas especiales, así el asistente responde bien.` }, fetchImpl, now).catch(() => 0);
    await a.negocios.guardar(n.id, { avisoFeriado: proximo.fecha });
    out.push({ negocio: n.id, fecha: proximo.fecha, enviados });
  }
  if (out.length) console.log(JSON.stringify({ canal: 'negocio', que: 'feriados', avisos: out.length }));
  return out;
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
    const T = perfilNegocio(fichaDelNegocio(pf.ficha, negocio, now)).textos(e.idioma);
    const texto = e.seguir.tipo === 'carrito' ? T.seguirCarrito : T.seguirConsulta;
    const enviado = await avisarComprador(env, a, negocio, charla, texto, fetchImpl, now);
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
    // ZL-160: si dio el permiso de comentarios (sin el dato, queda lo que había).
    const permisoComentarios = c.permisoComentarios ?? antes?.permisoComentarios;
    await cuentas.put(c.id, { username: c.username, token: c.token, vence: c.vence, app: c.app, cliente: Boolean(estado.negocio) || antes?.cliente === true, ...(permisoComentarios !== undefined && { permisoComentarios }) });
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
  // ZL-160: los comentarios de las publicaciones (solo Instagram), aparte de los mensajes.
  const comentarios = canal.clave === 'ig' ? leerComentariosIg(payload) : [];
  // En Cloudflare (con waitUntil) se esperan las ráfagas; en las pruebas, no (salvo que la prueba lo pida).
  const trabajo = Promise.all([
    procesar(eventos, env, fetchImpl, { ...deps, rafagaMs: deps.rafagaMs ?? (ctx?.waitUntil ? RAFAGA_MS : 0) }, canal),
    comentarios.length ? atenderComentarios(comentarios, env, fetchImpl, deps) : null,
  ]);
  if (ctx?.waitUntil) ctx.waitUntil(trabajo);
  else await trabajo;
  return json({ ok: true }, 200);
}

/**
 * ZL-161: la foto de un producto para WhatsApp o Instagram, por su link firmado (fotos.js). Sin firma válida o vencida,
 * 404 (no se dice si existe). Solo esa foto de ese negocio; nunca un listado.
 */
async function servirFoto(request, env, deps) {
  if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'no existe' }, 404);
  const a = almacen(env, deps);
  const clave = a.negocios?.claveFotos ? await a.negocios.claveFotos().catch(() => null) : null;
  const p = await leerLinkFoto(clave, request.url, deps.now ?? Date.now());
  const cat = p ? catalogoDe(env, deps)(p.negocio) : null;
  const r = cat ? await cat.ejecutar('foto', [p.foto]).catch(() => null) : null;
  const f = r?.ok ? r.valor : null;
  if (!f) return json({ error: 'no existe' }, 404);
  return new Response(request.method === 'HEAD' ? null : f.datos, {
    status: 200,
    headers: { 'content-type': f.tipo, 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" },
  });
}

/**
 * ZL-160: los comentarios de las publicaciones de Instagram de un negocio con «Responder comentarios» encendido.
 * Con la ficha y el catálogo del negocio, una respuesta corta en público y el detalle por privado (o solo por privado,
 * según el modo). Un reclamo o algo que no está en la ficha: nada en público y un aviso al dueño. Uno por comentario,
 * con tope diario y dentro del cupo de IA del negocio. El texto no se guarda, salvo en la memoria corta de la charla
 * cuando se le escribe por privado (para que, si contesta, el asistente sepa de qué viene). → una línea por comentario.
 */
export async function atenderComentarios(comentarios, env, fetchImpl, deps) {
  const a = almacen(env, deps);
  const now = deps.now ?? Date.now();
  const out = [];
  const fin = (que, extra = {}) => { console.log(JSON.stringify({ canal: 'ig', que: 'comentario', r: que, ...extra })); out.push({ que, ...extra }); };
  for (const c of comentarios) {
    try {
      if (c.ts && now - c.ts * 1000 > MAX_EDAD_COMENTARIO_MS) { fin('viejo'); continue; }
      const cuenta = await a.cuentas?.get(c.cuenta);
      if (!cuenta?.token) { fin('cuenta_desconocida'); continue; }
      // Lo que comenta la propia cuenta (por las dudas: las respuestas ya se filtran por ser de un hilo).
      if (c.usuario && cuenta.username && c.usuario.toLowerCase() === String(cuenta.username).toLowerCase()) { fin('propio'); continue; }
      const negocio = await a.negocios?.deCuenta(c.cuenta);
      const conf = configComentarios(negocio);
      if (!negocio || !conf.activo) { fin('apagado'); continue; }
      if (!canalesDe(negocio).instagram) { fin('canal_apagado'); continue; }
      if (negocio.pausa?.hasta > now) { fin('pausa'); continue; }
      if (esRuido(c.texto)) { fin('ruido'); continue; }
      const f = await a.fichas?.get(c.cuenta);
      if (!f?.texto || !f.activa) { fin('sin_ficha'); continue; }
      const pf = parsearFicha(f.texto);
      if (!pf.ok) { fin('ficha_invalida'); continue; }
      // Meta reenvía el mismo aviso si tardamos: una sola respuesta por comentario.
      if (await a.memoria?.visto?.(`cm:${c.id}`)) { fin('repetido'); continue; }
      if (!env.LIMITE?.limit || !env.LIMITE_GLOBAL?.limit) { fin('config'); continue; }
      // Por persona: el mismo freno que en los mensajes (alguien que comenta 30 veces seguidas).
      if (!(await env.LIMITE.limit({ key: `igc:${c.cuenta}.${c.quien}` })).success) { fin('limite'); continue; }
      const zona = ajustesDeVenta(negocio.ajustes).zona;
      const dia = diaLocal(now, zona);
      if ((await a.negocios.sumarMetrica(negocio.id, 'comentariosIa', dia)) > TOPE_COMENTARIOS_DIA) { fin('tope'); continue; }
      if ((await cupoDeIa(env, negocio.id, deps)()) !== 'ok') { fin('cupo'); continue; }
      // La misma ficha que en la charla: con lo de «Cómo vendés» y el aviso del día.
      const ficha = fichaDelNegocio(pf.ficha, negocio, now);
      const catalogo = consultaCatalogo(env, deps, negocio.id, ficha);
      const publicacion = await textoDePublicacion(env, cuenta.token, c.media, fetchImpl);
      const preguntar = deps.preguntarComentario ? deps.preguntarComentario(ficha, catalogo) : preguntadorComentario(env, ficha, { catalogo, fetchImpl });
      const r = await preguntar(c.texto, { publicacion, modo: conf.modo });
      let publica = false, privada = false, sinPermiso = false;
      if (r.publica) {
        const x = await responderComentario(env, cuenta.token, c.id, r.publica, fetchImpl);
        publica = x.ok; sinPermiso = sinPermiso || Boolean(x.sinPermiso);
      }
      if (r.privada && !sinPermiso) {
        const x = await responderEnPrivado(env, cuenta.token, c.id, r.privada, fetchImpl);
        privada = x.ok; sinPermiso = sinPermiso || Boolean(x.sinPermiso);
        // Si contesta, sigue la charla normal: el asistente sabe qué comentó y qué le dijo (memoria corta, 48 h).
        if (privada && a.memoria) {
          const from = armarFrom(c.cuenta, c.quien);
          const e = (await a.memoria.get(from)) ?? {};
          const previa = e.histT && now - e.histT < HISTORIAL_MS && Array.isArray(e.hist) ? e.hist : [];
          const hist = [...previa, { r: 'u', t: `(Comentario en una publicación) ${c.texto}`.slice(0, 500) }, { r: 'a', t: r.privada.slice(0, 500) }].slice(-HISTORIAL_MAX);
          await a.memoria.put(from, {
            ...e, humanoHasta: e.humanoHasta ?? 0, hist, histT: now,
            ...(!e.idioma && ['es', 'en', 'hr'].includes(r.idioma) && { idioma: r.idioma }),
            ...(!e.resumen && { resumen: `Comentó una publicación: «${c.texto.slice(0, 150)}»` }),
            ...(!e.usuario && c.usuario && { usuario: c.usuario }),
          });
        }
      }
      // La cuenta se conectó antes de pedir el permiso: se marca y la app le pide que vuelva a conectarla.
      if (sinPermiso && cuenta.permisoComentarios !== false) await a.cuentas.put(c.cuenta, { ...cuenta, permisoComentarios: false });
      if (publica || privada) await a.negocios.sumarMetrica(negocio.id, 'comentarios', dia);
      if (r.tipo === 'reclamo' || r.persona) {
        await avisarNegocio(a, negocio.id, {
          titulo: 'Un comentario de Instagram espera tu respuesta',
          cuerpo: r.tipo === 'reclamo' ? 'Parece un reclamo: respondelo vos desde Instagram.' : 'Preguntan algo que no está en tu información: respondelo vos desde Instagram.',
        }, fetchImpl, now).catch(() => 0);
      }
      fin(sinPermiso ? 'sin_permiso' : 'ok', { tipo: r.tipo, publica, privada, persona: Boolean(r.persona), notas: r.notas, uso: r.uso });
    } catch (e) {
      fin('error', { error: String(e?.message ?? 'error').slice(0, 60) });
    }
  }
  return out;
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
      const dueño = await a.negocios?.deCuenta(ev.cuenta);
      perfil = conPausa(perfilNegocio(fichaDelNegocio(pf.ficha, dueño, now)), dueño, now);
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
      const cupo = cupoDeIa(env, negocio ? dueñoEv?.id : null, deps);
      // Un negocio: los mensajes seguidos van en uno solo (ZL-149).
      const listo = negocio ? await prepararEvento(ev, { deps, memoria: a.memoria, clave: ev.from }) : ev;
      if (!listo) { log({ ok: true, que: 'rafaga' }); continue; }
      const antes = negocio && dueñoEv ? await memoria?.get(ev.from) : null;
      // ZL-162: si mientras se responde llega otro mensaje, esa ráfaga absorbe a esta y esta no manda nada.
      const vigente = negocio && a.memoria?.cursoVigente ? () => a.memoria.cursoVigente(ev.from, listo.id) : null;
      const r = await atender(listo, { memoria, charlas: charlasEv, preguntar: preguntarEv, now, cupo, ...(perfil && { perfil }), pedidos: pedidosEv, consultas: consultasEv, vigente }).finally(() => a.memoria?.terminarCurso?.(ev.from, listo.id));
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
  // Igual que una cuenta de Instagram de cliente: sin negocio, sin WhatsApp encendido o sin ficha activa, no responde.
  const dueño = await a.negocios?.get(reg.negocio);
  const mandar = async (m) => { await enviarYCloud(reg.apiKey, m, fetchImpl); await contarEnviadoWa(a, dueño, now); };
  if (!dueño) { log({ ok: true, que: 'sin_negocio' }); return; }
  if (!canalesDe(dueño).whatsapp) { log({ ok: true, que: 'canal_apagado' }); return; }
  const f = await a.negocios.ficha(dueño.id);
  if (!f?.texto || !f.activa) { log({ ok: true, que: f?.texto ? 'ficha_inactiva' : 'sin_ficha' }); return; }
  const pf = parsearFicha(f.texto);
  if (!pf.ok) { log({ ok: false, que: 'ficha_invalida' }); return; }
  const perfil = conPausa(perfilNegocio(fichaDelNegocio(pf.ficha, dueño, now)), dueño, now);
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
        // ZL-157: si le escribió él, los avisos de pedido guardados ya no hacen falta.
        await memoria.put(ev.from, { ...(estado ?? {}), humanoHasta: now + (perfil.horasPausa ?? 12) * 3600_000, pase: 0, avisos: [] });
      }
      log({ ok: true, que: 'eco' });
      continue;
    }
    try {
      if (!env.LIMITE?.limit || !env.LIMITE_GLOBAL?.limit) { log({ ok: false, que: 'config' }); continue; }
      if (!(await env.LIMITE.limit({ key: ev.from })).success) { log({ ok: true, que: 'limite' }); continue; }
      const cupo = cupoDeIa(env, dueño.id, deps);
      const listo = await prepararEvento(ev, { deps, memoria: a.memoria, clave: claveMemoria(ev.from) });
      if (!listo) { log({ ok: true, que: 'rafaga' }); continue; }
      const antes = await memoria?.get(ev.from);
      // ZL-162: si mientras se responde llega otro mensaje, esa ráfaga absorbe a esta y esta no manda nada.
      const cm = claveMemoria(ev.from);
      const vigente = a.memoria?.cursoVigente ? () => a.memoria.cursoVigente(cm, listo.id) : null;
      const r = await atender(listo, { memoria, charlas: null, preguntar, now, cupo, perfil, pedidos: pedidosDe(env, deps, dueño, pf.ficha, ev.from, 'wa'), consultas: consultasDe(env, deps, dueño, ev.from, 'wa'), vigente }).finally(() => a.memoria?.terminarCurso?.(cm, listo.id));
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
/**
 * ZL-163: la charla de prueba también ensaya el pedido y la consulta, sin tocar nada de verdad: un catálogo simulado que
 * LEE los productos reales (nombre, precio, stock) y guarda el carrito, el pedido y la consulta solo en memoria. No
 * reserva stock ni aparece nada en «Pedidos y consultas».
 */
export function catalogoDePrueba(real, inicial = null) {
  // Lo que vuelve de la app entre mensajes (se valida: solo campos conocidos y cortos).
  const limpio = (c) => (c && Array.isArray(c.items) ? {
    numero: null, estado: 'borrador', comprador: {}, sinPrecio: c.sinPrecio === true, total: Number(c.total) || 0,
    items: c.items.slice(0, 30).map((i) => ({ id: String(i?.id ?? '').slice(0, 60), nombre: String(i?.nombre ?? '').slice(0, 120), cantidad: Math.max(1, Math.min(999, Math.floor(Number(i?.cantidad) || 1))), precio: Number.isFinite(i?.precio) ? i.precio : null, unidad: String(i?.unidad ?? '').slice(0, 30), subtotal: Number.isFinite(i?.subtotal) ? i.subtotal : null })),
  } : null);
  let carrito = limpio(inicial?.carrito);
  let numero = Math.max(0, Math.min(999, Math.floor(Number(inicial?.numero) || 0)));
  let consulta = null;
  const ok = (valor) => ({ ok: true, valor });
  const redondo = (x) => Math.round(x * 100) / 100;
  return {
    estado: () => ({ carrito, numero }),
    async ejecutar(op, args = []) {
      if (['paraAsistente', 'obtener', 'resumen', 'foto'].includes(op)) return real.ejecutar(op, args);
      if (op === 'carritoDe') return ok(carrito);
      if (op === 'comprasDe') return ok([]);
      if (op === 'consultaAbierta') return ok(consulta);
      if (['renovar', 'olvidarCompradores', 'olvidarConsultas'].includes(op)) return ok(true);
      if (op === 'carrito') {
        const sumados = new Map();
        for (const it of Array.isArray(args[1]) ? args[1] : []) sumados.set(String(it?.id ?? ''), (sumados.get(String(it?.id ?? '')) ?? 0) + Number(it?.cantidad));
        const faltantes = [];
        const items = [];
        for (const [id, cantidad] of sumados) {
          const r = id ? await real.ejecutar('obtener', [id]).catch(() => null) : null;
          const p = r?.ok ? r.valor : null;
          if (!p) { faltantes.push({ id, motivo: 'no_existe' }); continue; }
          if (!p.activo) { faltantes.push({ id, nombre: p.nombre, motivo: 'pausado' }); continue; }
          if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 999) { faltantes.push({ id, nombre: p.nombre, motivo: 'cantidad' }); continue; }
          const disponible = p.stock === null || p.stock === undefined ? Infinity : p.stock - (p.reservado ?? 0);
          if (cantidad > disponible) { faltantes.push({ id, nombre: p.nombre, motivo: 'sin_stock', disponible: Math.max(0, disponible) }); continue; }
          items.push({ id, nombre: p.nombre, cantidad, precio: p.precio ?? null, unidad: p.unidad ?? '', subtotal: p.precio === null || p.precio === undefined ? null : redondo(p.precio * cantidad) });
        }
        carrito = items.length ? { numero: null, estado: 'borrador', items, total: redondo(items.reduce((a, i) => a + (i.subtotal ?? 0), 0)), sinPrecio: items.some((i) => i.subtotal === null), comprador: {} } : null;
        return ok({ pedido: carrito, faltantes });
      }
      if (op === 'confirmar') {
        if (!carrito) return { ok: false, error: 'no hay un carrito para confirmar' };
        const p = { ...carrito, numero: ++numero, estado: 'pendiente', comprador: args[1] ?? {} };
        carrito = null;
        return ok(p);
      }
      if (op === 'crearConsulta') {
        consulta = { numero: ++numero, ...(args[1] ?? {}), estado: 'nueva' };
        return ok({ consulta, nueva: true });
      }
      return { ok: false, error: 'en la charla de prueba no se cambia nada' };
    },
  };
}

async function probarFicha(env, fichaSola, mensajes, deps, negocioId = null, estado = null) {
  // ZL-162: con lo que carga el negocio (Cómo vendés, aviso del día, preguntas frecuentes), igual que en la charla real.
  const dueño = negocioId ? await almacen(env, deps).negocios?.get(negocioId).catch(() => null) : null;
  const ficha = fichaDelNegocio(fichaSola, dueño, deps.now ?? Date.now());
  const memoria = adaptadores(crearAtencion(almacenPrueba())).memoria;
  const DE = 'ig:0.0';
  const previo = estadoDePrueba(estado);
  if (previo) await memoria.put(DE, previo);
  const perfil = conPausa(perfilNegocio(ficha), dueño, deps.now ?? Date.now());
  const catalogo = consultaCatalogo(env, deps, negocioId, ficha);
  const ia = deps.preguntarNegocio ? deps.preguntarNegocio(ficha, catalogo) : preguntadorNegocio(env, ficha, { catalogo });
  // ZL-161: en la charla de prueba también se ven las fotos que mandaría.
  const preguntar = async (...x) => conLinksDeFotos(almacen(env, deps), deps, negocioId, await ia(...x));
  const now = deps.now ?? Date.now();
  // ZL-163: con pedidos y consultas simulados (no reservan ni aparecen en la app). La charla de prueba no guarda nada
  // entre llamadas salvo el estado que vuelve la app, así que el carrito simulado vive lo que dura este pedido.
  const real = negocioId ? catalogoDe(env, deps)(negocioId) : null;
  const sim = real ? catalogoDePrueba(real, estado?.sim ?? null) : null;
  const pruebaPedidos = sim && dueño?.pedidos && !sinPedidosAhora(dueño, now) ? pedidosDeCharla({ cat: sim, charla: DE, canal: 'ig', negocio: ficha.nombre, precios: ficha.precios, ajustes: ajustesDelNegocio(dueño) }) : null;
  const pruebaConsultas = sim ? consultasDeCharla({ cat: sim, charla: DE, canal: 'ig' }) : null;
  const charla = [];
  for (const [i, texto] of mensajes.entries()) {
    const ev = { id: `prueba-${i}`, from: DE, ts: now / 1000, kind: 'text', text: texto };
    try {
      const r = await atender(ev, { memoria, charlas: null, preguntar, now: now + i, perfil, pedidos: pruebaPedidos, consultas: pruebaConsultas });
      const fotos = r.send.filter((m) => m.type === 'image').map((m) => ({ foto: (/\/(f[a-z0-9]{4,40})\?/.exec(m.image.link) ?? [])[1] ?? '', nombre: m.image.caption ?? '' }));
      charla.push({ mensaje: texto, respuestas: r.send.filter((m) => m.type !== 'image').map((m) => m.text?.body ?? ''), ...(fotos.length && { fotos }), que: r.metrica, notas: r.notas ?? [] });
    } catch (e) {
      charla.push({ mensaje: texto, respuestas: [perfil.textos((await memoria.get(DE))?.idioma).falla], que: 'error', notas: [String(e?.message ?? 'error').slice(0, 40)] });
    }
  }
  const final = estadoDePrueba(await memoria.get(DE));
  return { charla, estado: sim ? { ...(final ?? {}), sim: sim.estado() } : final };
}

/** Lo que se guarda entre mensajes de la charla de prueba: el idioma, la pausa y la memoria corta (ZL-146). */
function estadoDePrueba(e) {
  if (!e || typeof e !== 'object') return null;
  const idioma = ['es', 'en', 'hr'].includes(e.idioma) ? e.idioma : undefined;
  const humanoHasta = Number.isFinite(e.humanoHasta) ? e.humanoHasta : 0;
  // ZL-146: también la memoria corta, para que la charla de prueba se comporte como la real (la memoria la vuelve a
  // filtrar al guardarla: solo campos conocidos y cortos).
  const { hist, histT, nombre, resumen, interes, ultimo, consulta, pedido, oferta } = e;
  // ZL-163: también el paso del pedido y el ofrecimiento al equipo, para ensayar el pedido y el pase completos.
  return { ...(idioma && { idioma }), humanoHasta, ...(Array.isArray(hist) && { hist: hist.slice(-8), histT }), ...(nombre && { nombre }), ...(resumen && { resumen }), ...(interes && { interes }), ...(ultimo && { ultimo }), ...(consulta && { consulta }), ...(pedido && { pedido }), ...(oferta && { oferta }) };
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
    cuentas.push({ id: cid, username: c?.username ?? null, conectada: Boolean(c?.token), venceEnDias: c?.vence ? Math.floor((c.vence - now) / 86_400_000) : null, permisoComentarios: c?.permisoComentarios ?? null });
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
        avisarComprador: (negocio, charla, texto) => avisarComprador(env, a, negocio, charla, texto, fetchImpl, deps.now ?? Date.now()),
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
    if (url.pathname.startsWith(RUTA_FOTOS)) return servirFoto(request, env, deps);
    if (url.pathname.startsWith('/api/whatsapp/ycloud/')) return webhookYCloud(request, env, ctx, deps, url.pathname.slice('/api/whatsapp/ycloud/'.length));
    if (url.pathname === '/api/instagram') return webhook(request, env, ctx, deps, CANALES.ig);
    if (url.pathname === '/api/instagram/conectar' || url.pathname === '/api/instagram/conectar/vuelta') return conectar(request, env, deps);
    if (url.pathname.startsWith('/api/instagram/admin/')) return admin(request, env, deps);
    return json({ error: 'no existe' }, 404);
  },

  /** Cron diario: renueva los tokens de Instagram que están por vencer y comprueba que cada cuenta siga suscripta. */
  async scheduled(evento, env, _ctx, deps = {}) {
    // Cada 10 minutos (ZL-151): los recordatorios con permiso. Una vez por día: el mantenimiento de Instagram.
    if (evento?.cron === '*/10 * * * *') {
      const now = deps.now ?? Date.now();
      // ZL-157: los pedidos sin responder no se vencen: el dueño recibe recordatorios al celular.
      const recordados = await recordarPedidos(env, deps, now).catch((e) => (console.log(JSON.stringify({ canal: 'pedidos', que: 'recordatorios', error: String(e?.message ?? 'error').slice(0, 60) })), []));
      const seguidos = await seguimientos(env, deps, now);
      return [...recordados, ...seguidos];
    }
    const fetchImpl = deps.fetch ?? fetch;
    const { cuentas } = almacen(env, deps);
    if (!cuentas) { console.log(JSON.stringify({ canal: 'ig', que: 'mantenimiento', error: 'sin memoria' })); return []; }
    const r = await mantenerCuentas(env, cuentas, fetchImpl, deps.now ?? Date.now()).catch((e) => [{ error: String(e?.name ?? 'Error').slice(0, 40) }]);
    console.log(JSON.stringify({ canal: 'ig', que: 'mantenimiento', cuentas: r }));
    // ZL-159: después del mantenimiento, el semáforo de todos los negocios; si algo está en rojo, correo al equipo.
    await revisarNegocios(env, deps, deps.now ?? Date.now()).catch((e) => console.log(JSON.stringify({ canal: 'negocio', que: 'revision_diaria', error: String(e?.message ?? 'error').slice(0, 60) })));
    await recordarFeriados(env, deps, deps.now ?? Date.now()).catch((e) => console.log(JSON.stringify({ canal: 'negocio', que: 'feriados', error: String(e?.message ?? 'error').slice(0, 60) })));
    return r;
  },
};
