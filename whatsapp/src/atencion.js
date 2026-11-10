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
      // El paso del pedido en curso (ZL-139), solo con los campos conocidos y cortos.
      const p = datos?.pedido;
      const pedido = p && ['confirmar', 'entrega', 'nombre', 'direccion'].includes(p.paso)
        ? { paso: p.paso, ...(['retiro', 'envio'].includes(p.entrega) && { entrega: p.entrega }), ...(p.nombre && { nombre: String(p.nombre).slice(0, 80) }), ...(p.direccion && { direccion: String(p.direccion).slice(0, 200) }) }
        : null;
      await s.put(`wa:${num}`, { idioma, humanoHasta, ...(pedido && { pedido }), vence: now + RETENCION_MEMORIA_MS });
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
      const { username = '', token, tokenVence = 0, app = '' } = datos ?? {};
      await s.put(`igc:${id}`, { id: String(id), username, token, tokenVence, app: String(app) });
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
      const limiteDia = Math.min(Math.max(Number(datos?.limiteDia ?? antes?.limiteDia ?? 300) || 300, 10), 5000);
      // Canales que contrató el negocio (ZL-122): Instagram, WhatsApp o ambos. Con un canal apagado, el agente no responde ahí.
      const c0 = antes?.canales ?? { instagram: true, whatsapp: false };
      const ci = datos?.canales ?? {};
      const canales = { instagram: typeof ci.instagram === 'boolean' ? ci.instagram : c0.instagram, whatsapp: typeof ci.whatsapp === 'boolean' ? ci.whatsapp : c0.whatsapp };
      // El pedido de invitación de Instagram (ZL-137): {usuario, pedido} hasta que el equipo lo atiende (null lo borra).
      const invitacionIg = datos?.invitacionIg !== undefined ? datos.invitacionIg : antes?.invitacionIg ?? null;
      // Pedidos por chat (ZL-139): apagados hasta que el equipo los enciende en Administración.
      const pedidos = typeof datos?.pedidos === 'boolean' ? datos.pedidos : antes?.pedidos === true;
      const n = { id: nid, nombre, emails, cuentas, canales, limiteDia, invitacionIg, pedidos, creado: antes?.creado ?? now, actualizado: now };
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
      return c ? { id: c.id, username: c.username, token: c.token, vence: c.tokenVence, app: c.app ?? '' } : null;
    },
    put: (id, d) => a.guardarCuentaIg(id, { username: d.username, token: d.token, tokenVence: d.vence, app: d.app }),
    delete: (id) => a.borrarCuentaIg(id),
    list: async () => (await a.listaCuentasIg()).map((c) => ({ id: c.id, username: c.username, token: c.token, vence: c.tokenVence, app: c.app ?? '' })),
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
