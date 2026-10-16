// Formulario de contacto de zustrolabs.com: valida la consulta y la manda por correo con Email Routing.
// Este módulo no importa nada de Cloudflare: así se prueba con `node --test` (ver worker/test/).
// No guarda nada. En los logs solo van métricas (resultado e idioma), nunca datos de la persona.

export const LIMITES = {
  cuerpoBytes: 8 * 1024,
  nombre: 100,
  email: 254,
  telefono: 40,
  tema: 80,
  mensaje: 1000,
  pagina: 100,
  esperaMinimaMs: 2500,
};

const IDIOMAS = new Set(['es', 'en', 'hr']);
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const TEL_RE = /^[\d+()\s.-]{6,40}$/;
// Controles: todo menos tab y salto de línea (estos dos solo se aceptan en el mensaje).
const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u2028\u2029]/g;

/** Una línea: sin saltos ni caracteres de control (evita inyección de cabeceras). */
export function unaLinea(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(CONTROL_RE, ' ').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);
}

/** Texto libre: conserva los saltos de línea, normaliza CRLF y saca el resto de los controles. */
export function textoLibre(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/\r\n?/g, '\n').replace(CONTROL_RE, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

/**
 * Valida lo que manda el navegador. Devuelve { ok: true, datos } o { ok: false, error }.
 * Los campos que no se conocen se ignoran.
 */
export function validar(entrada) {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return { ok: false, error: 'formato' };
  const largos = ['nombre', 'email', 'telefono', 'tema', 'mensaje'];
  for (const k of largos) {
    const v = entrada[k];
    if (v !== undefined && typeof v !== 'string') return { ok: false, error: 'formato' };
  }
  // Más largo de lo que el formulario permite: no viene de la página.
  if ((entrada.mensaje || '').length > LIMITES.mensaje * 2) return { ok: false, error: 'mensaje' };

  const emailCrudo = (entrada.email || '').trim();
  if (/[\r\n]/.test(emailCrudo)) return { ok: false, error: 'email' };

  const datos = {
    nombre: unaLinea(entrada.nombre, LIMITES.nombre),
    email: emailCrudo.slice(0, LIMITES.email + 1),
    telefono: unaLinea(entrada.telefono, LIMITES.telefono),
    tema: unaLinea(entrada.tema, LIMITES.tema),
    mensaje: textoLibre(entrada.mensaje, LIMITES.mensaje),
    pagina: unaLinea(entrada.pagina, LIMITES.pagina),
    idioma: IDIOMAS.has(entrada.idioma) ? entrada.idioma : 'es',
  };

  if (!datos.nombre) return { ok: false, error: 'nombre' };
  if (!datos.email && !datos.telefono) return { ok: false, error: 'contacto' };
  if (datos.email && (datos.email.length > LIMITES.email || !EMAIL_RE.test(datos.email))) return { ok: false, error: 'email' };
  if (datos.telefono && !TEL_RE.test(datos.telefono)) return { ok: false, error: 'telefono' };
  if (!datos.mensaje) return { ok: false, error: 'mensaje' };
  if (datos.pagina && !/^\/[A-Za-z0-9/_-]*$/.test(datos.pagina)) datos.pagina = '/';
  return { ok: true, datos };
}

/** Señales de bot: campo trampa lleno o formulario enviado demasiado rápido. */
export function pareceBot(entrada) {
  if (typeof entrada.web === 'string' && entrada.web.trim() !== '') return true;
  const t = Number(entrada.t);
  return !Number.isFinite(t) || t < LIMITES.esperaMinimaMs;
}

function base64Utf8(texto) {
  const bytes = new TextEncoder().encode(texto);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Cabecera con texto no ASCII (RFC 2047). */
export function cabeceraUtf8(texto) {
  return `=?UTF-8?B?${base64Utf8(unaLinea(texto, 200))}?=`;
}

/**
 * Arma el correo en MIME. Todo lo que escribió la persona va en el cuerpo (base64);
 * en las cabeceras solo entran el asunto codificado y el Reply-To ya validado.
 */
export function armarMime({ de, para, datos, fecha = new Date(), id }) {
  const asunto = `Consulta desde la web · ${datos.tema || 'Sin tema'} · ${datos.nombre}`;
  const cuerpo = [
    `Nombre: ${datos.nombre}`,
    `Correo: ${datos.email || '—'}`,
    `Teléfono: ${datos.telefono || '—'}`,
    `Qué necesita: ${datos.tema || '—'}`,
    `Página: ${datos.pagina || '/'} (${datos.idioma})`,
    '',
    datos.mensaje,
    '',
    '—',
    'Enviado desde el formulario de zustrolabs.com. Respondé este correo para contestarle.',
  ].join('\r\n');
  const b64 = base64Utf8(cuerpo).replace(/.{1,76}/g, '$&\r\n').trimEnd();
  const cabeceras = [
    `From: ${cabeceraUtf8('Zustro Labs · Web')} <${de}>`,
    `To: <${para}>`,
    datos.email ? `Reply-To: <${datos.email}>` : null,
    `Subject: ${cabeceraUtf8(asunto)}`,
    `Date: ${fecha.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${id}@zustrolabs.com>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean);
  return `${cabeceras.join('\r\n')}\r\n\r\n${b64}\r\n`;
}

function json(estado, cuerpo) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

async function leerCuerpo(request, max) {
  const declarado = Number(request.headers.get('Content-Length') || '0');
  if (declarado > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const partes = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel(); return null; }
    partes.push(value);
  }
  const todo = new Uint8Array(total);
  let i = 0;
  for (const p of partes) { todo.set(p, i); i += p.byteLength; }
  return new TextDecoder().decode(todo);
}

/**
 * Crea el manejador del Worker.
 * - enviar(mime, { de, para }): manda el correo (en producción, con el binding send_email).
 * - log(objeto): métricas sin datos personales.
 */
export function crearHandler({ enviar, log = (o) => console.log(JSON.stringify(o)), ahora = () => new Date(), uuid = () => crypto.randomUUID() }) {
  return async function fetch(request, env) {
    const metrica = (resultado, extra = {}) => log({ evento: 'contacto', resultado, ...extra });
    const origenes = String(env.ORIGENES || '').split(',').map((s) => s.trim()).filter(Boolean);

    if (request.method !== 'POST') {
      metrica('metodo');
      return new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });
    }
    const origen = request.headers.get('Origin');
    if (!origen || !origenes.includes(origen)) { metrica('origen'); return json(403, { ok: false, error: 'origen' }); }
    if (!/^application\/json\b/i.test(request.headers.get('Content-Type') || '')) { metrica('tipo'); return json(415, { ok: false, error: 'tipo' }); }

    if (env.LIMITE) {
      const ip = request.headers.get('CF-Connecting-IP') || 'sin-ip';
      const { success } = await env.LIMITE.limit({ key: ip });
      if (!success) { metrica('limite'); return json(429, { ok: false, error: 'limite' }); }
    }

    const texto = await leerCuerpo(request, LIMITES.cuerpoBytes);
    if (texto === null) { metrica('grande'); return json(413, { ok: false, error: 'grande' }); }
    let entrada;
    try { entrada = JSON.parse(texto); } catch { metrica('json'); return json(400, { ok: false, error: 'json' }); }
    if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) { metrica('json'); return json(400, { ok: false, error: 'json' }); }

    // A un bot se le contesta como si hubiera salido bien: no aprende nada y no llega ningún correo.
    if (pareceBot(entrada)) { metrica('bot'); return json(200, { ok: true }); }

    const v = validar(entrada);
    if (!v.ok) { metrica('invalido', { campo: v.error }); return json(422, { ok: false, error: v.error }); }

    if (!env.DESTINO || !env.REMITENTE) { metrica('config'); return json(500, { ok: false, error: 'config' }); }
    const mime = armarMime({ de: env.REMITENTE, para: env.DESTINO, datos: v.datos, fecha: ahora(), id: uuid() });
    try {
      await enviar(mime, { de: env.REMITENTE, para: env.DESTINO }, env);
    } catch (e) {
      metrica('envio', { motivo: String((e && e.name) || 'Error').slice(0, 40) });
      return json(502, { ok: false, error: 'envio' });
    }
    metrica('ok', { idioma: v.datos.idioma });
    return json(200, { ok: true });
  };
}
