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
// - igc:<cuenta>   → cuenta de Instagram conectada {id, username, token, tokenVence}: no vence (se renueva el token).
// Este módulo no importa nada de Cloudflare: se prueba con un almacenamiento simulado (ver test/).

export const DIA_MS = 24 * 3600_000;
export const RETENCION_MEMORIA_MS = 90 * DIA_MS;
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
      await s.put(`wa:${num}`, { idioma, humanoHasta, vence: now + RETENCION_MEMORIA_MS });
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
      const { username = '', token, tokenVence = 0 } = datos ?? {};
      await s.put(`igc:${id}`, { id: String(id), username, token, tokenVence });
    },
    async borrarCuentaIg(id) {
      await s.delete(`igc:${id}`);
    },
    async listaCuentasIg() {
      return [...(await s.list({ prefix: 'igc:' })).values()];
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
 * Adaptadores que usa el Worker: memoria {get, put, delete, visto, contar}, charlas {get, list, agregar, delete}
 * y cuentas {get, put, delete, list} (Instagram).
 * `a` es la lógica directa (tests) o el stub RPC del Durable Object (producción); `reloj` da la hora.
 */
export function adaptadores(a, reloj = () => Date.now()) {
  const memoria = {
    get: (n) => a.estado(n, reloj()),
    put: (n, d) => a.guardarEstado(n, d, reloj()),
    delete: (n) => a.borrar(n),
    visto: (id) => a.visto(id, reloj()),
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
      return c ? { id: c.id, username: c.username, token: c.token, vence: c.tokenVence } : null;
    },
    put: (id, d) => a.guardarCuentaIg(id, { username: d.username, token: d.token, tokenVence: d.vence }),
    delete: (id) => a.borrarCuentaIg(id),
    list: async () => (await a.listaCuentasIg()).map((c) => ({ id: c.id, username: c.username, token: c.token, vence: c.tokenVence })),
  };
  return { memoria, charlas, cuentas };
}
