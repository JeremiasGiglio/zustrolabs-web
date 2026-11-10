// Los correos de cada negocio en Cloudflare Access (ZL-138). Sin esto, el equipo tenía que agregarlos a mano en la
// política de la app «Negocios» y, si se olvidaba, al cliente nunca le llegaba el código para entrar.
//
// Necesita dos secretos del Worker: CF_API_TOKEN (un token con permiso «Access: Apps and Policies — Edit», solo eso)
// y CF_ACCOUNT_ID. Sin ellos no hace nada y el script avisa que va a mano. Solo AGREGA correos: nunca saca a nadie
// (sacar a alguien por error deja al equipo afuera); quitar un correo sigue siendo a mano.

const CF = 'https://api.cloudflare.com/client/v4';
// Lo que se reenvía de la política al guardarla (el resto lo pone Cloudflare: ids, fechas, contadores).
const CAMPOS = ['name', 'decision', 'include', 'exclude', 'require', 'session_duration', 'approval_required', 'approval_groups',
  'isolation_required', 'purpose_justification_required', 'purpose_justification_prompt', 'connection_rules', 'mfa_config'];

export const accesoConfigurado = (env) => Boolean(env?.CF_API_TOKEN && env?.CF_ACCOUNT_ID);

const correoValido = (c) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}$/i.test(String(c ?? ''));

async function cf(env, fetchImpl, metodo, ruta, cuerpo) {
  const r = await fetchImpl(`${CF}/accounts/${encodeURIComponent(env.CF_ACCOUNT_ID)}${ruta}`, {
    method: metodo,
    headers: { authorization: `Bearer ${env.CF_API_TOKEN}`, 'content-type': 'application/json' },
    ...(cuerpo && { body: JSON.stringify(cuerpo) }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d?.success === false) {
    const msg = d?.errors?.[0]?.message ?? `respondió ${r.status}`;
    throw new Error(r.status === 401 || r.status === 403 ? 'el token de Cloudflare no tiene permiso de Access' : `Cloudflare: ${String(msg).slice(0, 80)}`);
  }
  return d.result;
}

const esDelHost = (app, host) => app?.domain === host || (app?.self_hosted_domains ?? []).includes(host)
  || (app?.destinations ?? []).some((d) => d?.uri === host);

/** La política «Allow» de la app de Access de ese dominio → {app, politica, reusable}. */
async function politicaDe(env, fetchImpl, host) {
  const apps = (await cf(env, fetchImpl, 'GET', '/access/apps?per_page=100')) ?? [];
  const app = apps.find((a) => esDelHost(a, host));
  if (!app) throw new Error(`no encuentro la app de Access de ${host}`);
  for (const p of app.policies ?? []) {
    const reusable = p.reusable === true;
    const pol = p.include ? p : await cf(env, fetchImpl, 'GET', reusable ? `/access/policies/${p.id}` : `/access/apps/${app.id}/policies/${p.id}`);
    if (pol?.decision === 'allow') return { app, politica: pol, reusable };
  }
  throw new Error(`la app de Access de ${host} no tiene una política «Allow»`);
}

const correosDe = (politica) => new Set((politica.include ?? []).map((r) => String(r?.email?.email ?? '').toLowerCase()).filter(Boolean));

/** Los correos que hoy deja pasar la política (Set), o null si no está configurado o no se pudo leer. */
export async function correosEnAcceso(env, fetchImpl, host) {
  if (!accesoConfigurado(env)) return null;
  try {
    return correosDe((await politicaDe(env, fetchImpl, host)).politica);
  } catch (e) {
    console.log(JSON.stringify({ canal: 'acceso', que: 'leer', ok: false, error: String(e?.message ?? e).slice(0, 80) }));
    return null;
  }
}

/**
 * Agrega a la política los correos que falten. → {ok, agregados[], ya[]} o {ok: false, error, faltan[]}.
 * Nunca tira: un error de Cloudflare no impide guardar el negocio (el script y la app avisan que va a mano).
 */
export async function agregarAAcceso(env, fetchImpl, host, emails) {
  const pedidos = [...new Set((emails ?? []).map((c) => String(c).trim().toLowerCase()).filter(correoValido))];
  if (!pedidos.length) return { ok: true, agregados: [], ya: [] };
  if (!accesoConfigurado(env)) return { ok: false, error: 'sin configurar (CF_API_TOKEN, CF_ACCOUNT_ID)', faltan: pedidos };
  try {
    const { app, politica, reusable } = await politicaDe(env, fetchImpl, host);
    const hay = correosDe(politica);
    const faltan = pedidos.filter((c) => !hay.has(c));
    if (!faltan.length) return { ok: true, agregados: [], ya: pedidos };
    const nueva = Object.fromEntries(CAMPOS.filter((k) => politica[k] !== undefined).map((k) => [k, politica[k]]));
    nueva.include = [...(politica.include ?? []), ...faltan.map((email) => ({ email: { email } }))];
    if (!reusable && politica.precedence !== undefined) nueva.precedence = politica.precedence;
    await cf(env, fetchImpl, 'PUT', reusable ? `/access/policies/${politica.id}` : `/access/apps/${app.id}/policies/${politica.id}`, nueva);
    console.log(JSON.stringify({ canal: 'acceso', que: 'agregados', n: faltan.length }));
    return { ok: true, agregados: faltan, ya: pedidos.filter((c) => hay.has(c)) };
  } catch (e) {
    const error = String(e?.message ?? e).slice(0, 120);
    console.log(JSON.stringify({ canal: 'acceso', que: 'agregar', ok: false, error }));
    return { ok: false, error, faltan: pedidos };
  }
}
