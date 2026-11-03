// Adaptador de node:sqlite con la forma de ctx.storage.sql de un Durable Object (exec → cursor con toArray/one),
// para probar el catálogo contra SQLite de verdad.
import { DatabaseSync } from 'node:sqlite';

export function sqlPrueba() {
  const db = new DatabaseSync(':memory:');
  const sql = {
    exec(q, ...p) {
      const st = db.prepare(q);
      const lee = /^\s*(select|with|pragma)/i.test(q) || /\breturning\b/i.test(q);
      const rows = lee ? st.all(...p) : (st.run(...p), []);
      return { toArray: () => rows.map((r) => ({ ...r })), one: () => rows[0] };
    },
  };
  // Igual que transactionSync: si algo falla adentro, no queda nada a medias.
  const transaccion = (fn) => {
    db.exec('SAVEPOINT t');
    try {
      const r = fn();
      db.exec('RELEASE t');
      return r;
    } catch (e) {
      db.exec('ROLLBACK TO t');
      db.exec('RELEASE t');
      throw e;
    }
  };
  return { db, sql, transaccion };
}
