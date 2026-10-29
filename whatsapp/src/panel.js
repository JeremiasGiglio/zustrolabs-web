// Panel de atención del WhatsApp de Zustro Labs: equipo.zustrolabs.com
// Adaptado del panel del Radar Croacia (radar-croacia/worker/src/atencion.mjs, ZL-65), separado de él.
// Cuando alguien escribe PERSONA, el asistente deja de contestar en esa charla y se guardan sus mensajes (solo
// esos, 30 días) para que alguien del equipo los lea y responda desde acá. Las charlas con el asistente no se guardan.
// Atiende los dos canales: WhatsApp (la charla se identifica con el número) e Instagram (`ig:<id>`, ZL-111).
//
// Seguridad:
// - Cloudflare Access delante del subdominio (login con los correos autorizados).
// - Además, el Worker verifica el token de Access (firma RS256, audiencia, vencimiento) y que el correo esté en
//   PANEL_EMAILS. Si falta configuración, el panel responde 503: nunca queda abierto.
// - Las acciones (responder, devolver) exigen JSON y Origin del propio panel (sin CSRF).

import { textos } from './textos.js';

export const VENTANA_MS = 24 * 3600_000; // Meta: solo se puede responder dentro de las 24 h del último mensaje (los dos canales).
export const MAX_RESPUESTA = 1000;
/** Aviso a la persona cuando la charla vuelve al asistente, en su idioma. */
export const textoDevuelta = (idioma) => textos(idioma).devuelta;
/** Un número de WhatsApp, o `ig:<cuenta>.<quien>` (ids de Instagram). */
const NUM_RE = /^(?:\d{6,16}|ig:\d{6,20}\.\d{6,20})$/;
export const NOMBRE_CANAL = { wa: "WhatsApp", ig: "Instagram" };
const canalDe = (num) => (String(num).startsWith("ig:") ? "ig" : "wa");
// Saca caracteres de control (deja salto de línea y tabulación).
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F]/g;
const sinControl = (s) => String(s ?? "").replace(CONTROL_RE, "");

/**
 * Agrega un mensaje a la charla (la crea si no existe). de: "persona" | "equipo" | "sistema".
 * Lo hace el Durable Object de una sola vez (atencion.js), así dos mensajes juntos no se pisan.
 */
export const agregar = (charlas, num, mensaje, now = Date.now(), extra = {}) => charlas.agregar(num, mensaje, now, extra);

// ───────────────────────── Aviso por mail ─────────────────────────

/** Mail corto, sin número ni texto (privacidad). Usa el binding send_email AVISO y el secreto AVISO_PARA. */
export const PANEL_URL = "https://equipo.zustrolabs.com";

export function mailAviso({ from, to, now = new Date(), canal = "wa" }) {
  const nombre = NOMBRE_CANAL[canal] ?? NOMBRE_CANAL.wa;
  const id = `${now.getTime()}.${Math.random().toString(36).slice(2)}@zustrolabs.com`;
  return [
    `From: Zustro Labs <${from}>`,
    `To: <${to}>`,
    "Subject: Zustro Labs: hay una charla esperando",
    `Message-ID: <${id}>`,
    `Date: ${now.toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    `Alguien escribió PERSONA en el ${nombre} de Zustro Labs y está esperando respuesta.`,
    "",
    `Respondé desde el panel: ${PANEL_URL}`,
    "Tenés 24 horas desde su último mensaje (regla de Meta).",
    "",
    "Por privacidad, este aviso no incluye el número ni lo que escribió.",
    "",
  ].join("\r\n");
}

/** Manda el aviso. EmailMessageImpl se inyecta en los tests (cloudflare:email solo existe en Workers). */
export async function avisar(env, EmailMessageImpl, now = new Date(), canal = "wa") {
  if (!env.AVISO?.send || !env.AVISO_PARA) return false;
  // El correo de zustrolabs.com lo maneja Zoho (ZL-107): el envío de Cloudflare sale del subdominio avisos.
  const from = env.AVISO_DESDE || "avisos@avisos.zustrolabs.com";
  const EmailMessage = EmailMessageImpl ?? (await import("cloudflare:email")).EmailMessage;
  await env.AVISO.send(new EmailMessage(from, env.AVISO_PARA, mailAviso({ from, to: env.AVISO_PARA, now, canal })));
  return true;
}

// ───────────────────────── Login (Cloudflare Access) ─────────────────────────

const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const parteJson = (s) => JSON.parse(new TextDecoder().decode(b64url(s)));

let certs = { at: 0, url: "", keys: [] };
export const _resetCerts = () => (certs = { at: 0, url: "", keys: [] });

/** Verifica el token Cf-Access-Jwt-Assertion. Devuelve el mail o null. */
export async function verificarAcceso(request, env, fetchImpl = fetch, now = Date.now()) {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return null;
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  let header, payload;
  try {
    header = parteJson(partes[0]);
    payload = parteJson(partes[1]);
  } catch {
    return null;
  }
  if (header.alg !== "RS256") return null;
  const url = `https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;
  const traer = async () => {
    const res = await fetchImpl(url);
    if (!res.ok) return false;
    certs = { at: now, url, keys: (await res.json()).keys ?? [] };
    return true;
  };
  if ((certs.url !== url || now - certs.at > 3600_000) && !(await traer())) return null;
  let jwk = certs.keys.find((k) => k.kid === header.kid);
  // Access rotó la clave: se vuelve a pedir la lista, como mucho una vez cada 5 minutos.
  if (!jwk && now - certs.at > 300_000 && (await traer())) jwk = certs.keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64url(partes[2]),
    new TextEncoder().encode(`${partes[0]}.${partes[1]}`),
  );
  if (!ok) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  if (!payload.exp || payload.exp * 1000 < now) return null;
  const email = String(payload.email ?? "").toLowerCase();
  const permitidos = String(env.PANEL_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return permitidos.includes(email) ? email : null;
}

// ───────────────────────── Panel ─────────────────────────

const SEGURIDAD = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};
const resp = (body, status, type) => new Response(body, { status, headers: { "content-type": type, ...SEGURIDAD } });
const jsonResp = (data, status = 200) => resp(JSON.stringify(data), status, "application/json; charset=utf-8");

/**
 * deps: {fetch, store (memoria del asistente), chats, send(env, message), now, origin}
 */
export async function panel(request, env, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now();
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.PANEL_EMAILS) {
    return jsonResp({ error: "panel sin configurar" }, 503);
  }
  const email = await verificarAcceso(request, env, fetchImpl, now);
  if (!email) return jsonResp({ error: "sin acceso" }, 401);

  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "GET" && path === "/") return resp(HTML, 200, "text/html; charset=utf-8");
  if (request.method === "GET" && path === "/app.js") return resp(APP_JS, 200, "text/javascript; charset=utf-8");
  if (request.method === "GET" && path === "/app.css") return resp(APP_CSS, 200, "text/css; charset=utf-8");

  const chats = deps.chats;
  const store = deps.store;
  if (!chats) return jsonResp({ error: "falta la memoria (ATENCION)" }, 503);

  if (request.method === "GET" && path === "/api/charlas") {
    const lista = (await chats.list()).map((c) => ({
      ...c,
      canal: canalDe(c.num),
      quedaMs: Math.max(0, (c.ultimoPersona || 0) + VENTANA_MS - now),
    }));
    return jsonResp({ charlas: lista, yo: email });
  }

  const m = /^\/api\/charlas\/(ig:\d+\.\d+|\d+)(?:\/(responder|devolver))?$/.exec(path);
  if (!m || !NUM_RE.test(m[1])) return jsonResp({ error: "no existe" }, 404);
  const num = m[1];
  const accion = m[2];

  if (request.method === "GET" && !accion) {
    const chat = await chats.get(num);
    if (!chat) return jsonResp({ error: "no existe" }, 404);
    return jsonResp({ ...chat, canal: canalDe(num), quedaMs: Math.max(0, (chat.ultimoPersona || 0) + VENTANA_MS - now) });
  }

  if (request.method !== "POST" || !accion) return jsonResp({ error: "método no permitido" }, 405);
  // Sin CSRF: solo JSON y solo desde el propio panel.
  const origin = deps.origin ?? `https://${url.host}`;
  if (request.headers.get("Origin") !== origin) return jsonResp({ error: "origen no permitido" }, 403);
  if (!String(request.headers.get("content-type") ?? "").startsWith("application/json")) {
    return jsonResp({ error: "se espera JSON" }, 415);
  }
  const chat = await chats.get(num);
  if (!chat) return jsonResp({ error: "no existe" }, 404);
  const enVentana = (chat.ultimoPersona || 0) + VENTANA_MS > now;

  if (accion === "responder") {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResp({ error: "pedido inválido" }, 400);
    }
    const texto = sinControl(body?.texto).trim();
    if (!texto) return jsonResp({ error: "el mensaje está vacío" }, 400);
    if (texto.length > MAX_RESPUESTA) return jsonResp({ error: `hasta ${MAX_RESPUESTA} caracteres` }, 400);
    if (!enVentana)
      return jsonResp({ error: `pasaron más de 24 h desde su último mensaje: ${NOMBRE_CANAL[canalDe(num)]} no deja responder` }, 409);
    try {
      await deps.send(env, {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: num,
        type: "text",
        text: { preview_url: false, body: texto },
      });
    } catch (e) {
      // Solo el código de Meta: el texto del error podría traer datos.
      console.log(JSON.stringify({ canal: "panel", ok: false, error: String(e?.code ?? e?.name ?? "Error").slice(0, 40) }));
      return jsonResp({ error: `${NOMBRE_CANAL[canalDe(num)]} no aceptó el mensaje. Probá de nuevo en un rato.` }, 502);
    }
    // El mensaje ya salió: si guardarlo falla, se avisa sin error, para que nadie lo reenvíe dos veces.
    try {
      // Responder reabre la charla (si estaba devuelta) y el asistente sigue callado mientras atiende una persona.
      const actualizada = await agregar(chats, num, { de: "equipo", texto }, now, { abierta: true });
      const st = (await store?.get(num)) ?? {};
      await store?.put(num, { ...st, humanoHasta: now + VENTANA_MS });
      console.log(JSON.stringify({ canal: "panel", que: "responder" }));
      return jsonResp({ ok: true, chat: { ...actualizada, canal: canalDe(num), quedaMs: Math.max(0, (actualizada.ultimoPersona || 0) + VENTANA_MS - now) } });
    } catch (e) {
      console.log(JSON.stringify({ canal: "panel", que: "responder", guardado: false, error: String(e?.name ?? "Error").slice(0, 40) }));
      return jsonResp({ ok: true, guardado: false, aviso: "Se mandó, pero no se pudo guardar en la charla. No lo reenvíes." });
    }
  }

  // devolver: el asistente vuelve a atender esa charla.
  const st = (await store?.get(num)) ?? {};
  await store?.put(num, { ...st, humanoHasta: 0 });
  const actualizada = await agregar(chats, num, { de: "sistema", texto: "Charla devuelta al asistente." }, now, {
    abierta: false,
  });
  if (enVentana) {
    await deps
      .send(env, {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: num,
        type: "text",
        text: { preview_url: false, body: textoDevuelta(st.idioma) },
      })
      .catch(() => {}); // si falla el aviso, la charla igual vuelve al asistente
  }
  console.log(JSON.stringify({ canal: "panel", que: "devolver" }));
  return jsonResp({
    ok: true,
    chat: { ...actualizada, canal: canalDe(num), quedaMs: Math.max(0, (actualizada.ultimoPersona || 0) + VENTANA_MS - now) },
  });
}

// ───────────────────────── Página ─────────────────────────

export const HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Atención · Zustro Labs</title>
<link rel="stylesheet" href="/app.css">
</head><body>
<header><b>Zustro Labs</b> · Atención <span id="yo"></span></header>
<main>
  <section id="lista" aria-label="Charlas"><h1>Charlas</h1><p class="vacio" id="vacio">No hay charlas por ahora.</p><ul id="charlas"></ul></section>
  <section id="charla" aria-label="Charla seleccionada" hidden>
    <button type="button" id="volver" class="link">← Charlas</button>
    <h2 id="titulo"></h2><p id="ventana" class="ventana"></p>
    <ol id="mensajes" aria-live="polite"></ol>
    <form id="form"><label for="texto">Tu respuesta</label>
      <textarea id="texto" maxlength="1000" rows="3" required></textarea>
      <div class="acciones"><button type="submit" id="enviar">Enviar</button>
      <button type="button" id="devolver" class="sec">Devolver al asistente</button></div>
      <p id="estado" role="status"></p>
    </form>
  </section>
</main>
<script src="/app.js"></script>
</body></html>`;

export const APP_CSS = `:root{--rojo:#C8102E;--tinta:#1B2230;--gris:#5A6270;--fondo:#f6f7f9}
*{box-sizing:border-box}body{margin:0;font:16px/1.45 system-ui,sans-serif;color:var(--tinta);background:var(--fondo)}
header{background:#fff;border-bottom:3px solid var(--rojo);padding:12px 16px}header span{color:var(--gris);font-size:14px;margin-left:8px}
main{max-width:760px;margin:0 auto;padding:16px}h1,h2{font-size:20px;margin:8px 0}
ul{list-style:none;padding:0;margin:0}li.charla button{width:100%;text-align:left;background:#fff;border:1px solid #dde1e7;border-radius:8px;padding:12px;margin:0 0 8px;font:inherit;cursor:pointer}
li.charla button:focus-visible,button:focus-visible,textarea:focus-visible{outline:3px solid var(--rojo);outline-offset:2px}
.abierta{color:var(--rojo);font-weight:600}.cerrada{color:var(--gris)}.vacio{color:var(--gris)}
ol{list-style:none;padding:0;margin:12px 0;display:flex;flex-direction:column;gap:8px}
ol li{padding:8px 12px;border-radius:10px;max-width:85%;overflow-wrap:anywhere;white-space:pre-wrap}
.persona{background:#fff;border:1px solid #dde1e7;align-self:flex-start}.equipo{background:var(--tinta);color:#fff;align-self:flex-end}
.sistema{align-self:center;color:var(--gris);font-size:14px}.hora{display:block;font-size:12px;opacity:.7}
label{display:block;font-weight:600;margin:8px 0 4px}textarea{width:100%;font:inherit;padding:8px;border-radius:8px;border:1px solid #c5cad3}
.acciones{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}button{font:inherit;padding:10px 14px;border-radius:8px;border:0;background:var(--rojo);color:#fff;cursor:pointer}
button.sec{background:#fff;color:var(--tinta);border:1px solid #c5cad3}button.link{background:none;color:var(--tinta);padding:0;text-decoration:underline}
button:disabled{opacity:.5;cursor:not-allowed}.ventana{color:var(--gris);font-size:14px}`;

export const APP_JS = `(function(){
"use strict";
var $=function(id){return document.getElementById(id)};
var actual=null;
function hora(t){return new Date(t).toLocaleString("es-AR",{dateStyle:"short",timeStyle:"short"})}
var CANAL={wa:"WhatsApp",ig:"Instagram"};function canal(c){return CANAL[c&&c.canal]||CANAL.wa}
function quien(c){if(c.canal==="ig")return "Instagram · "+(c.nombre?"@"+c.nombre:"id "+String(c.num).split(".").pop());return "+"+c.num}
function queda(ms,c){if(c&&c.abierta===false&&ms>0)return "La atiende el asistente. Si hace falta, todavía podés escribirle durante "+Math.floor(ms/3600000)+" h "+Math.floor(ms%3600000/60000)+" min.";if(ms<=0)return "Pasaron más de 24 h: "+canal(c)+" ya no deja responder.";var h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000);return "Podés responder durante "+h+" h "+m+" min más."}
function api(path,opts){opts=opts||{};opts.headers=Object.assign({"content-type":"application/json"},opts.headers||{});opts.credentials="same-origin";
  return fetch(path,opts).then(function(r){return r.json().then(function(d){if(!r.ok)throw new Error(d.error||("error "+r.status));return d})})}
function lista(){api("/api/charlas").then(function(d){
  $("yo").textContent=d.yo||"";var ul=$("charlas");ul.textContent="";$("vacio").hidden=d.charlas.length>0;
  d.charlas.forEach(function(c){var li=document.createElement("li");li.className="charla";var b=document.createElement("button");b.type="button";
    var n=document.createElement("strong");n.textContent=quien(c);var e=document.createElement("span");
    e.className=c.abierta?"abierta":"cerrada";e.textContent=(c.abierta?" · esperando":" · devuelta al asistente")+" · "+String(c.idioma||"es").toUpperCase();
    var t=document.createElement("span");t.className="hora";t.textContent="Último mensaje: "+hora(c.ultimo);
    b.appendChild(n);b.appendChild(e);b.appendChild(t);b.addEventListener("click",function(){abrir(c.num)});li.appendChild(b);ul.appendChild(li)})
}).catch(function(e){$("vacio").hidden=false;$("vacio").textContent=e.message})}
function pintar(c){actual=c.num;$("lista").hidden=true;$("charla").hidden=false;$("titulo").textContent=quien(c)+" · "+String(c.idioma||"es").toUpperCase()+(c.idioma&&c.idioma!=="es"?" (respondé en ese idioma)":"");$("ventana").textContent=queda(c.quedaMs,c);$("enviar").textContent="Enviar por "+canal(c);
  var ol=$("mensajes");ol.textContent="";c.mensajes.forEach(function(m){var li=document.createElement("li");li.className=m.de;
    var s=document.createElement("span");s.className="hora";var q=m.de==="equipo"?"Equipo":m.de==="persona"?"Persona":"";s.textContent=(q?q+" · ":"")+hora(m.t);
    li.appendChild(document.createTextNode(m.texto));li.appendChild(s);ol.appendChild(li)});
  $("enviar").disabled=c.quedaMs<=0;$("devolver").disabled=!c.abierta;}
function abrir(num){$("estado").textContent="";api("/api/charlas/"+num).then(pintar).catch(function(e){$("estado").textContent=e.message})}
$("volver").addEventListener("click",function(){actual=null;$("charla").hidden=true;$("lista").hidden=false;lista()});
$("form").addEventListener("submit",function(ev){ev.preventDefault();var t=$("texto").value.trim();if(!t||!actual)return;$("enviar").disabled=true;$("estado").textContent="Enviando…";
  api("/api/charlas/"+actual+"/responder",{method:"POST",body:JSON.stringify({texto:t})}).then(function(d){$("texto").value="";if(d.guardado===false){$("estado").textContent=d.aviso;$("enviar").disabled=false;return}$("estado").textContent="Enviado.";pintar(d.chat)})
  .catch(function(e){$("estado").textContent=e.message;$("enviar").disabled=false})});
$("devolver").addEventListener("click",function(){if(!actual)return;api("/api/charlas/"+actual+"/devolver",{method:"POST",body:"{}"}).then(function(d){$("estado").textContent="La charla volvió al asistente.";pintar(d.chat)})
  .catch(function(e){$("estado").textContent=e.message})});
setInterval(function(){if(actual)abrir(actual);else lista()},60000);
lista();
})();`;
