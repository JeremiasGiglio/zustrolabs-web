// Consultas de un negocio (ZL-146): lo que deja la charla cuando el cierre no es un pedido.
//
// - tipo «consulta»: la persona quiere avanzar (presupuesto, contratar, agendar) y el asistente ya la guió hasta ahí.
// - tipo «persona»: hace falta alguien del negocio (lo pidió, es un reclamo o la IA no tenía la respuesta).
//
// Viven en la misma base SQLite del negocio que los productos y los pedidos (Durable Object «Catalogo»). Una charla
// tiene como mucho una consulta abierta: si vuelve a pasar, se actualiza la misma (nunca dos tarjetas por la misma
// persona). El negocio la ve en «Pedidos y consultas» y la pasa a atendiendo, ganada o perdida. La IA nunca escribe acá:
// el código arma la consulta con lo que ya sabe la memoria (nombre, interés, resumen).

export const ESQUEMA_CONSULTAS = [
  `CREATE TABLE IF NOT EXISTS consultas (
    id INTEGER PRIMARY KEY AUTOINCREMENT, charla TEXT NOT NULL, canal TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL,
    estado TEXT NOT NULL, nombre TEXT NOT NULL DEFAULT '', interes TEXT NOT NULL DEFAULT '', resumen TEXT NOT NULL DEFAULT '',
    idioma TEXT NOT NULL DEFAULT '', nota TEXT NOT NULL DEFAULT '', creado INTEGER NOT NULL, actualizado INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS consultas_estado ON consultas(estado, actualizado)`,
  `CREATE INDEX IF NOT EXISTS consultas_charla ON consultas(charla, estado)`,
];

export const TIPOS_CONSULTA = ['consulta', 'persona'];
// «resuelta» es para un pase a una persona (un reclamo, una duda): ganada y perdida son para quien quería avanzar.
export const ESTADOS_CONSULTA = ['nueva', 'atendiendo', 'ganada', 'perdida', 'resuelta'];
const ABIERTAS = ['nueva', 'atendiendo'];

const texto = (v, max) => String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Las operaciones de consultas, sobre la misma base del catálogo. */
export function operacionesConsultas({ sql, reloj, ErrorCatalogo }) {
  for (const q of ESQUEMA_CONSULTAS) sql.exec(q);
  const filas = (q, ...p) => sql.exec(q, ...p).toArray();
  const una = (q, ...p) => filas(q, ...p)[0] ?? null;
  const armar = (f) => f && { numero: f.id, charla: f.charla, canal: f.canal, tipo: f.tipo, estado: f.estado, nombre: f.nombre, interes: f.interes, resumen: f.resumen, idioma: f.idioma, nota: f.nota, creado: f.creado, actualizado: f.actualizado };

  return {
    /**
     * Registra (o actualiza, si la charla ya tiene una abierta) una consulta. Lo nuevo no borra lo que ya había: un dato
     * vacío deja el anterior, y «persona» gana sobre «consulta» (hace falta alguien). → la consulta y si es nueva.
     */
    crearConsulta(charla, datos = {}) {
      const c = texto(charla, 80);
      if (!c) throw new ErrorCatalogo('falta la charla');
      const tipo = TIPOS_CONSULTA.includes(datos.tipo) ? datos.tipo : 'consulta';
      const d = { nombre: texto(datos.nombre, 60), interes: texto(datos.interes, 120), resumen: texto(datos.resumen, 300), idioma: texto(datos.idioma, 5), canal: texto(datos.canal, 4) };
      const ahora = reloj();
      const abierta = una(`SELECT * FROM consultas WHERE charla = ? AND estado IN ('nueva','atendiendo') ORDER BY id DESC LIMIT 1`, c);
      if (abierta) {
        const t = abierta.tipo === 'persona' || tipo === 'persona' ? 'persona' : 'consulta';
        sql.exec('UPDATE consultas SET tipo = ?, nombre = ?, interes = ?, resumen = ?, idioma = ?, estado = ?, actualizado = ? WHERE id = ?',
          t, d.nombre || abierta.nombre, d.interes || abierta.interes, d.resumen || abierta.resumen, d.idioma || abierta.idioma, 'nueva', ahora, abierta.id);
        return { consulta: armar(una('SELECT * FROM consultas WHERE id = ?', abierta.id)), nueva: false };
      }
      sql.exec('INSERT INTO consultas (charla, canal, tipo, estado, nombre, interes, resumen, idioma, creado, actualizado) VALUES (?,?,?,?,?,?,?,?,?,?)',
        c, d.canal, tipo, 'nueva', d.nombre, d.interes, d.resumen, d.idioma, ahora, ahora);
      return { consulta: armar(una('SELECT * FROM consultas ORDER BY id DESC LIMIT 1')), nueva: true };
    },

    /** Para la app: las de un estado (o las abiertas primero y después las últimas cerradas) y cuántas nuevas hay. */
    consultas({ estado = '', cuantos = 100 } = {}) {
      const n = Math.max(1, Math.min(200, Number(cuantos) || 100));
      const lista = ESTADOS_CONSULTA.includes(estado)
        ? filas('SELECT * FROM consultas WHERE estado = ? ORDER BY actualizado DESC LIMIT ?', estado, n)
        : filas(`SELECT * FROM consultas ORDER BY CASE WHEN estado IN ('nueva','atendiendo') THEN 0 ELSE 1 END, actualizado DESC LIMIT ?`, n);
      const nuevas = una(`SELECT COUNT(*) AS n FROM consultas WHERE estado = 'nueva'`)?.n ?? 0;
      return { consultas: lista.map(armar), nuevas };
    },

    /** Lo que hace el negocio desde la app: atendiendo, ganada o perdida, con una nota opcional. */
    cambiarConsulta(numero, estado, nota = '') {
      if (!ESTADOS_CONSULTA.includes(estado)) throw new ErrorCatalogo('estado inválido');
      const f = una('SELECT * FROM consultas WHERE id = ?', Number(numero));
      if (!f) throw new ErrorCatalogo('esa consulta no existe');
      sql.exec('UPDATE consultas SET estado = ?, nota = ?, actualizado = ? WHERE id = ?', estado, texto(nota, 300) || f.nota, reloj(), f.id);
      return armar(una('SELECT * FROM consultas WHERE id = ?', f.id));
    },

    /** Números para el dueño (ZL-151): consultas desde `desde` y cuántas se ganaron. */
    numerosConsultas(desde) {
      const d = Number(desde) || 0;
      return {
        consultas: una('SELECT COUNT(*) AS n FROM consultas WHERE creado >= ?', d)?.n ?? 0,
        ganadas: una(`SELECT COUNT(*) AS n FROM consultas WHERE estado = 'ganada' AND actualizado >= ?`, d)?.n ?? 0,
      };
    },

    /** Una consulta por número (para la app: responder, devolver al asistente). */
    consulta(numero) {
      const f = una('SELECT * FROM consultas WHERE id = ?', Number(numero));
      if (!f) throw new ErrorCatalogo('esa consulta no existe');
      return armar(f);
    },

    /** ¿La charla tiene una consulta abierta? (para no volver a pedir el nombre ni duplicar). */
    consultaAbierta(charla) {
      return armar(una(`SELECT * FROM consultas WHERE charla = ? AND estado IN (${ABIERTAS.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 1`, texto(charla, 80), ...ABIERTAS));
    },
  };
}

/**
 * Lo que necesita la charla de un negocio para registrar consultas (lo arma index.js con el Catalogo del negocio).
 * @param o {cat: {ejecutar(op, args)}, charla, canal: 'ig'|'wa'}
 */
export function consultasDeCharla({ cat, charla, canal }) {
  return {
    /** → {numero, nueva} o null si no se pudo (la charla sigue igual: nunca se corta por esto). */
    async registrar(datos) {
      const r = await cat.ejecutar('crearConsulta', [charla, { ...datos, canal }]).catch(() => null);
      return r?.ok ? { numero: r.valor.consulta.numero, nueva: r.valor.nueva } : null;
    },
  };
}
