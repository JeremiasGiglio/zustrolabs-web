// ZL-165: las charlas de cada negocio en la app («Charlas»). Viven en la misma base SQLite del negocio (Durable Object
// «Catalogo»), 30 días: lo que escribió la persona, lo que respondió el asistente y lo que contestó el negocio desde la
// app. La app nunca ve el número ni el id interno de la charla en la dirección: cada charla tiene un número propio.
// BORRAR (la persona) borra su charla al instante; el cron diario borra lo de más de 30 días.

export const RETENCION_CHARLAS_APP_MS = 30 * 86_400_000;
const MAX_TEXTO = 2000;
const DE = ['cliente', 'asistente', 'negocio', 'sistema'];

export const ESQUEMA_MENSAJES = [
  `CREATE TABLE IF NOT EXISTS charlas_app (
    id INTEGER PRIMARY KEY AUTOINCREMENT, charla TEXT NOT NULL UNIQUE, canal TEXT NOT NULL DEFAULT '', nombre TEXT NOT NULL DEFAULT '',
    previa TEXT NOT NULL DEFAULT '', ultimo INTEGER NOT NULL, ultimo_cliente INTEGER NOT NULL DEFAULT 0, vista INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS charlas_app_ultimo ON charlas_app(ultimo)`,
  `CREATE TABLE IF NOT EXISTS mensajes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, charla_id INTEGER NOT NULL, de TEXT NOT NULL, texto TEXT NOT NULL, t INTEGER NOT NULL, mal INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS mensajes_charla ON mensajes(charla_id, id)`,
];

const limpio = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').trim().slice(0, n);

/** Las operaciones de las charlas de la app, sobre la misma base del catálogo. */
export function operacionesMensajes({ sql, reloj, ErrorCatalogo }) {
  for (const q of ESQUEMA_MENSAJES) sql.exec(q);
  const filas = (q, ...p) => sql.exec(q, ...p).toArray();
  const una = (q, ...p) => filas(q, ...p)[0] ?? null;
  const armar = (c) => c && {
    id: c.id, canal: c.canal, nombre: c.nombre, previa: c.previa, ultimo: c.ultimo,
    sinLeer: c.ultimo_cliente > c.vista,
  };

  return {
    /**
     * Suma mensajes a una charla (la crea si no estaba). `lista`: [{de, texto, t?}]. `nombre`: cómo mostrarla (nombre
     * de la persona o su usuario de Instagram). → el número de la charla en la app.
     */
    guardarMensajes(charla, canal, lista = [], nombre = '') {
      const c = limpio(charla, 80);
      if (!c) throw new ErrorCatalogo('falta la charla');
      const ms = (Array.isArray(lista) ? lista : []).map((m) => ({ de: DE.includes(m?.de) ? m.de : 'sistema', texto: limpio(m?.texto, MAX_TEXTO), t: Number(m?.t) || reloj() })).filter((m) => m.texto).slice(0, 20);
      const ahora = reloj();
      let fila = una('SELECT * FROM charlas_app WHERE charla = ?', c);
      if (!fila) {
        sql.exec('INSERT INTO charlas_app (charla, canal, nombre, ultimo) VALUES (?,?,?,?)', c, limpio(canal, 4), limpio(nombre, 80), ahora);
        fila = una('SELECT * FROM charlas_app WHERE charla = ?', c);
      }
      for (const m of ms) sql.exec('INSERT INTO mensajes (charla_id, de, texto, t) VALUES (?,?,?,?)', fila.id, m.de, m.texto, m.t);
      const ultimoCliente = ms.filter((m) => m.de === 'cliente').reduce((a, m) => Math.max(a, m.t), fila.ultimo_cliente);
      const previa = ms.length ? ms.at(-1).texto.slice(0, 120) : fila.previa;
      sql.exec('UPDATE charlas_app SET ultimo = ?, ultimo_cliente = ?, previa = ?, nombre = ? WHERE id = ?',
        ms.length ? Math.max(...ms.map((m) => m.t)) : fila.ultimo, ultimoCliente, previa, limpio(nombre, 80) || fila.nombre, fila.id);
      return fila.id;
    },

    /** Para la app: las charlas más recientes (con búsqueda por nombre o texto) y cuántas tienen algo sin leer. */
    charlasApp({ q = '', cuantos = 50 } = {}) {
      const n = Math.max(1, Math.min(200, Number(cuantos) || 50));
      const b = limpio(q, 60).toLowerCase();
      const lista = b
        ? filas(`SELECT DISTINCT c.* FROM charlas_app c LEFT JOIN mensajes m ON m.charla_id = c.id
            WHERE lower(c.nombre) LIKE ? OR lower(m.texto) LIKE ? ORDER BY c.ultimo DESC LIMIT ?`, `%${b}%`, `%${b}%`, n)
        : filas('SELECT * FROM charlas_app ORDER BY ultimo DESC LIMIT ?', n);
      return { charlas: lista.map(armar), sinLeer: una('SELECT COUNT(*) AS n FROM charlas_app WHERE ultimo_cliente > vista').n };
    },

    /** Una charla con sus mensajes (y la marca como vista). `charla` (el id interno) es para el Worker, no para la app. */
    charlaApp(id, { marcar = true } = {}) {
      const c = una('SELECT * FROM charlas_app WHERE id = ?', Number(id));
      if (!c) throw new ErrorCatalogo('esa charla no existe (las charlas se guardan 30 días)');
      if (marcar) sql.exec('UPDATE charlas_app SET vista = ? WHERE id = ?', reloj(), c.id);
      const mensajes = filas('SELECT id, de, texto, t, mal FROM mensajes WHERE charla_id = ? ORDER BY id DESC LIMIT 300', c.id).reverse().map((m) => ({ ...m, mal: m.mal === 1 }));
      return { ...armar({ ...c, vista: marcar ? reloj() : c.vista }), charla: c.charla, mensajes };
    },

    /** 👎 en una respuesta del asistente (o sacarlo). → la pregunta de la persona que venía antes, para cargarla bien. */
    marcarMal(id, mal = true) {
      const m = una('SELECT * FROM mensajes WHERE id = ?', Number(id));
      if (!m || m.de !== 'asistente') throw new ErrorCatalogo('ese mensaje no es del asistente');
      sql.exec('UPDATE mensajes SET mal = ? WHERE id = ?', mal ? 1 : 0, m.id);
      const antes = una("SELECT texto FROM mensajes WHERE charla_id = ? AND id < ? AND de = 'cliente' ORDER BY id DESC LIMIT 1", m.charla_id, m.id);
      return { pregunta: antes?.texto ?? '', respuesta: m.texto };
    },

    /** BORRAR: la charla de esa persona se borra al instante. */
    olvidarCharla(charla) {
      const c = una('SELECT id FROM charlas_app WHERE charla = ?', limpio(charla, 80));
      if (!c) return 0;
      sql.exec('DELETE FROM mensajes WHERE charla_id = ?', c.id);
      sql.exec('DELETE FROM charlas_app WHERE id = ?', c.id);
      return 1;
    },

    /** Cron diario: lo de más de 30 días se borra (mensajes viejos y charlas sin nada nuevo). */
    purgarMensajes(now = reloj()) {
      const corte = now - RETENCION_CHARLAS_APP_MS;
      sql.exec('DELETE FROM mensajes WHERE t < ?', corte);
      const viejas = filas('SELECT id FROM charlas_app WHERE ultimo < ?', corte).length;
      sql.exec('DELETE FROM charlas_app WHERE ultimo < ?', corte);
      return viejas;
    },
  };
}
