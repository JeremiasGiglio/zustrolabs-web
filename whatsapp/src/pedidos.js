// Pedidos de un negocio (ZL-139, etapa 1: el núcleo). Viven en la misma base SQLite que los productos (el Durable
// Object «Catalogo» de cada negocio): como un Durable Object atiende un pedido a la vez, dos compradores nunca se
// llevan la última unidad al mismo tiempo.
//
// La regla de todo el sistema: la IA PROPONE (qué productos y cuántos), este código DECIDE. Acá se valida cada producto
// contra el catálogo, se reserva el stock, se calculan los precios y el total, y se controla quién puede pasar un
// pedido de un estado a otro. Nada de esto lo escribe la IA.
//
// Estados: borrador (el carrito de una charla) → pendiente (el comprador confirmó) → aceptado → pagado → entregado.
// Antes de entregado: rechazado, cancelado o vencido, y la reserva se libera. Solo el negocio acepta, marca pagado y
// entregado (lo controla la API, negocios.js); al entregar se descuenta el stock de verdad.

export const ESQUEMA_PEDIDOS = [
  `CREATE TABLE IF NOT EXISTS pedidos (
    id TEXT PRIMARY KEY, numero INTEGER, charla TEXT NOT NULL, canal TEXT NOT NULL DEFAULT '', estado TEXT NOT NULL,
    comprador TEXT NOT NULL DEFAULT '{}', total REAL, sin_precio INTEGER NOT NULL DEFAULT 0, vence INTEGER,
    creado INTEGER NOT NULL, actualizado INTEGER NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS pedidos_numero ON pedidos(numero) WHERE numero IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS pedidos_borrador ON pedidos(charla) WHERE estado = 'borrador'`,
  `CREATE INDEX IF NOT EXISTS pedidos_estado ON pedidos(estado, actualizado)`,
  `CREATE TABLE IF NOT EXISTS pedido_items (
    pedido TEXT NOT NULL, producto TEXT NOT NULL, nombre TEXT NOT NULL, cantidad INTEGER NOT NULL, precio REAL,
    unidad TEXT NOT NULL DEFAULT '', reserva INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (pedido, producto))`,
  `CREATE TABLE IF NOT EXISTS pedido_eventos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, pedido TEXT NOT NULL, estado TEXT NOT NULL, detalle TEXT NOT NULL DEFAULT '',
    quien TEXT NOT NULL DEFAULT '', t INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS pedido_eventos_pedido ON pedido_eventos(pedido, t)`,
];

export const ESTADOS = ['borrador', 'pendiente', 'aceptado', 'pagado', 'entregado', 'rechazado', 'cancelado', 'vencido'];
const ABIERTOS = ['borrador', 'pendiente', 'aceptado', 'pagado'];
/** Quién puede pasar de un estado a otro desde la app (el comprador solo arma el borrador y confirma). */
export const PASOS = {
  pendiente: ['aceptado', 'rechazado', 'cancelado'],
  aceptado: ['pagado', 'entregado', 'cancelado'],
  pagado: ['entregado', 'cancelado'],
};
export const MAX_ITEMS = 30;
export const MAX_CANTIDAD = 999;
const MIN = 60_000;
/** Cuánto dura cada reserva si nadie dice otra cosa. */
export const RESERVA = { borrador: 20 * MIN, pendiente: 120 * MIN, aceptado: 48 * 60 * MIN };

const texto = (v, max) => String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);
const nuevoId = () => `o${Date.now().toString(36)}${crypto.getRandomValues(new Uint32Array(2)).reduce((a, n) => a + n.toString(36), '')}`;
const redondo = (n) => Math.round(n * 100) / 100;

/** Los datos del comprador que se guardan (nada más): nombre, entrega o retiro, dirección y notas. */
export function datosComprador(d) {
  const entrega = ['envio', 'retiro'].includes(d?.entrega) ? d.entrega : '';
  return { nombre: texto(d?.nombre, 80), entrega, direccion: entrega === 'envio' ? texto(d?.direccion, 200) : '', notas: texto(d?.notas, 300) };
}

/**
 * Las operaciones de pedidos, sobre la misma base del catálogo.
 * @param ctx {sql, transaccion, reloj, porId(id) → fila de productos, anotar(producto, nombre, tipo, antes, despues, detalle, quien),
 *   ErrorCatalogo (el error que se le muestra a quien usa la app)}
 */
export function operacionesPedidos({ sql, transaccion, reloj, porId, anotar, ErrorCatalogo }) {
  for (const q of ESQUEMA_PEDIDOS) sql.exec(q);
  const filas = (q, ...p) => sql.exec(q, ...p).toArray();
  const una = (q, ...p) => filas(q, ...p)[0] ?? null;
  const evento = (pedido, estado, detalle, quien) =>
    sql.exec('INSERT INTO pedido_eventos (pedido, estado, detalle, quien, t) VALUES (?,?,?,?,?)', pedido, estado, texto(detalle, 200), texto(quien, 120), reloj());

  /** Devuelve al stock lo que reservaba un pedido (solo los productos que controlan stock). */
  function liberar(pedidoId) {
    for (const it of filas('SELECT producto, reserva FROM pedido_items WHERE pedido = ? AND reserva > 0', pedidoId)) {
      sql.exec('UPDATE productos SET reservado = MAX(0, reservado - ?) WHERE id = ?', it.reserva, it.producto);
    }
    sql.exec('UPDATE pedido_items SET reserva = 0 WHERE pedido = ?', pedidoId);
  }

  function armar(p) {
    if (!p) return null;
    const items = filas('SELECT producto, nombre, cantidad, precio, unidad FROM pedido_items WHERE pedido = ? ORDER BY rowid', p.id).map((i) => ({
      id: i.producto, nombre: i.nombre, cantidad: i.cantidad, precio: i.precio ?? null, unidad: i.unidad,
      subtotal: i.precio === null || i.precio === undefined ? null : redondo(i.precio * i.cantidad),
    }));
    let comprador = {};
    try { comprador = JSON.parse(p.comprador); } catch { comprador = {}; }
    return { id: p.id, numero: p.numero ?? null, charla: p.charla, canal: p.canal, estado: p.estado, items, total: p.total ?? null,
      sinPrecio: p.sin_precio === 1, comprador, vence: p.vence ?? null, creado: p.creado, actualizado: p.actualizado };
  }

  const borradorDe = (charla) => una("SELECT * FROM pedidos WHERE charla = ? AND estado = 'borrador'", String(charla));
  const porNumero = (n) => una('SELECT * FROM pedidos WHERE numero = ?', Number(n));

  return {
    /**
     * Deja el carrito de una charla exactamente como `items` ([{id, cantidad}]): lo que propuso la IA, ya traducido a
     * ids del catálogo. Valida cada producto, reserva el stock (por `minutos`) y calcula el total.
     * Lo que no se puede (no existe, pausado, sin stock suficiente) NO entra y vuelve en `faltantes`, para que el
     * asistente lo diga. Un carrito vacío borra el borrador y libera todo. → {pedido|null, faltantes[]}
     */
    carrito(charla, items, { canal = '', minutos = RESERVA.borrador / MIN } = {}, quien = 'comprador') {
      if (!texto(charla, 200)) throw new ErrorCatalogo('falta la charla');
      if (!Array.isArray(items)) throw new ErrorCatalogo('el carrito tiene que ser una lista');
      if (items.length > MAX_ITEMS) throw new ErrorCatalogo(`un pedido puede tener hasta ${MAX_ITEMS} productos distintos`);
      return transaccion(() => {
        const now = reloj();
        let p = borradorDe(charla);
        if (p) liberar(p.id);
        // Sumar repetidos (la IA a veces manda el mismo producto dos veces).
        const pedidos = new Map();
        for (const it of items) {
          const cant = Number(it?.cantidad);
          const id = String(it?.id ?? '');
          if (!id) continue;
          pedidos.set(id, (pedidos.get(id) ?? 0) + (Number.isInteger(cant) ? cant : NaN));
        }
        const faltantes = [];
        const entran = [];
        for (const [id, cantidad] of pedidos) {
          const prod = porId(id);
          if (!prod) { faltantes.push({ id, motivo: 'no_existe' }); continue; }
          if (!prod.activo) { faltantes.push({ id, nombre: prod.nombre, motivo: 'pausado' }); continue; }
          if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_CANTIDAD) { faltantes.push({ id, nombre: prod.nombre, motivo: 'cantidad', pedido: cantidad }); continue; }
          const controla = prod.stock !== null && prod.stock !== undefined;
          const disponible = controla ? prod.stock - (prod.reservado ?? 0) : Infinity;
          if (cantidad > disponible) { faltantes.push({ id, nombre: prod.nombre, motivo: 'sin_stock', pedido: cantidad, disponible: Math.max(0, disponible) }); continue; }
          entran.push({ prod, cantidad, reserva: controla ? cantidad : 0 });
        }
        if (!entran.length) {
          if (p) {
            sql.exec('DELETE FROM pedido_items WHERE pedido = ?', p.id);
            sql.exec('DELETE FROM pedidos WHERE id = ?', p.id);
            evento(p.id, 'vacio', 'carrito vacío', quien);
          }
          return { pedido: null, faltantes };
        }
        if (!p) {
          const id = nuevoId();
          sql.exec('INSERT INTO pedidos (id, charla, canal, estado, creado, actualizado) VALUES (?,?,?,?,?,?)', id, String(charla), texto(canal, 10), 'borrador', now, now);
          p = una('SELECT * FROM pedidos WHERE id = ?', id);
          evento(id, 'borrador', 'carrito nuevo', quien);
        }
        sql.exec('DELETE FROM pedido_items WHERE pedido = ?', p.id);
        let total = 0;
        let sinPrecio = false;
        for (const e of entran) {
          sql.exec('INSERT INTO pedido_items (pedido, producto, nombre, cantidad, precio, unidad, reserva) VALUES (?,?,?,?,?,?,?)',
            p.id, e.prod.id, e.prod.nombre, e.cantidad, e.prod.precio ?? null, e.prod.unidad ?? '', e.reserva);
          if (e.reserva) sql.exec('UPDATE productos SET reservado = reservado + ? WHERE id = ?', e.reserva, e.prod.id);
          if (e.prod.precio === null || e.prod.precio === undefined) sinPrecio = true;
          else total += e.prod.precio * e.cantidad;
        }
        const vence = now + Math.max(1, Math.min(Number(minutos) || 20, 24 * 60)) * MIN;
        sql.exec('UPDATE pedidos SET total = ?, sin_precio = ?, vence = ?, actualizado = ? WHERE id = ?', redondo(total), sinPrecio ? 1 : 0, vence, now, p.id);
        return { pedido: armar(una('SELECT * FROM pedidos WHERE id = ?', p.id)), faltantes };
      });
    },

    /** El borrador de una charla (o null). */
    carritoDe(charla) {
      return armar(borradorDe(charla));
    },

    /**
     * El comprador confirmó: el borrador pasa a pendiente con número, sus datos y una reserva más larga mientras el
     * negocio lo ve. Se vuelve a comprobar que siga habiendo stock (la reserva lo asegura, salvo que haya vencido).
     */
    confirmar(charla, datos = {}, quien = 'comprador') {
      return transaccion(() => {
        const p = borradorDe(charla);
        if (!p) throw new ErrorCatalogo('no hay un carrito para confirmar');
        const now = reloj();
        if (p.vence && p.vence < now) throw new ErrorCatalogo('el carrito venció: hay que armarlo de nuevo');
        const comprador = datosComprador(datos);
        if (!comprador.nombre) throw new ErrorCatalogo('falta el nombre de quien compra', 'nombre');
        if (!comprador.entrega) throw new ErrorCatalogo('falta si es envío o retiro', 'entrega');
        if (comprador.entrega === 'envio' && !comprador.direccion) throw new ErrorCatalogo('falta la dirección de envío', 'direccion');
        const numero = (una('SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM pedidos').n);
        sql.exec('UPDATE pedidos SET estado = ?, numero = ?, comprador = ?, vence = ?, actualizado = ? WHERE id = ?',
          'pendiente', numero, JSON.stringify(comprador), now + RESERVA.pendiente, now, p.id);
        evento(p.id, 'pendiente', `pedido ${numero} confirmado`, quien);
        return armar(porNumero(numero));
      });
    },

    /**
     * El negocio cambia el estado de un pedido (Aceptar, Rechazar, Pagado, Entregado, Cancelar).
     * `horas`: al aceptar, hasta cuándo se guarda la reserva (si no se paga antes, vence sola).
     * Entregado descuenta el stock de verdad (y deja el movimiento en el historial de stock).
     */
    cambiarEstado(numero, nuevo, quien, { motivo = '', horas = null } = {}) {
      return transaccion(() => {
        const p = porNumero(numero);
        if (!p) throw new ErrorCatalogo('ese pedido no existe');
        if (!(PASOS[p.estado] ?? []).includes(nuevo)) throw new ErrorCatalogo(`un pedido ${p.estado} no puede pasar a ${nuevo}`);
        const now = reloj();
        let vence = p.vence;
        if (nuevo === 'aceptado') {
          const h = Number(horas);
          vence = now + (Number.isFinite(h) && h > 0 ? Math.min(h, 24 * 30) * 60 * MIN : RESERVA.aceptado);
        }
        if (nuevo === 'pagado') vence = null; // pagado no vence: lo cierra el negocio.
        if (['rechazado', 'cancelado'].includes(nuevo)) { liberar(p.id); vence = null; }
        if (nuevo === 'entregado') {
          for (const it of filas('SELECT producto, nombre, cantidad, reserva FROM pedido_items WHERE pedido = ?', p.id)) {
            const prod = porId(it.producto);
            if (!prod || prod.stock === null || prod.stock === undefined) continue;
            const stock = Math.max(0, prod.stock - it.cantidad);
            sql.exec('UPDATE productos SET stock = ?, reservado = MAX(0, reservado - ?), actualizado = ? WHERE id = ?', stock, it.reserva, now, prod.id);
            anotar(prod.id, prod.nombre, 'stock', prod.stock, stock, `-${it.cantidad} · pedido ${p.numero} entregado`, quien);
          }
          sql.exec('UPDATE pedido_items SET reserva = 0 WHERE pedido = ?', p.id);
          vence = null;
        }
        sql.exec('UPDATE pedidos SET estado = ?, vence = ?, actualizado = ? WHERE id = ?', nuevo, vence, now, p.id);
        evento(p.id, nuevo, motivo, quien);
        return armar(porNumero(numero));
      });
    },

    /**
     * Vence lo que pasó su hora: borradores (se borran), pendientes y aceptados sin pagar (quedan «vencido»). Libera
     * las reservas. Lo llama una alarma del Durable Object. → [{numero, charla, canal, estado anterior}] para avisar.
     */
    vencer() {
      return transaccion(() => {
        const now = reloj();
        const out = [];
        for (const p of filas("SELECT * FROM pedidos WHERE vence IS NOT NULL AND vence < ? AND estado IN ('borrador','pendiente','aceptado')", now)) {
          liberar(p.id);
          if (p.estado === 'borrador') {
            sql.exec('DELETE FROM pedido_items WHERE pedido = ?', p.id);
            sql.exec('DELETE FROM pedidos WHERE id = ?', p.id);
            evento(p.id, 'vencido', 'carrito sin confirmar', 'sistema');
          } else {
            sql.exec("UPDATE pedidos SET estado = 'vencido', vence = NULL, actualizado = ? WHERE id = ?", now, p.id);
            evento(p.id, 'vencido', `${p.estado} sin ${p.estado === 'pendiente' ? 'respuesta del negocio' : 'pago'}`, 'sistema');
            out.push({ numero: p.numero, charla: p.charla, canal: p.canal, antes: p.estado });
          }
        }
        return out;
      });
    },

    /** Cuándo hay que volver a mirar los vencimientos (para la alarma del Durable Object), o null. */
    proximoVencimiento() {
      return una("SELECT MIN(vence) AS v FROM pedidos WHERE vence IS NOT NULL AND estado IN ('borrador','pendiente','aceptado')")?.v ?? null;
    },

    /** Pedidos para el panel (sin borradores), los más nuevos primero. */
    pedidos({ estado = '', cuantos = 100 } = {}) {
      const lim = Math.max(1, Math.min(Number(cuantos) || 100, 500));
      const lista = estado && ESTADOS.includes(estado)
        ? filas('SELECT * FROM pedidos WHERE estado = ? ORDER BY actualizado DESC LIMIT ?', estado, lim)
        : filas("SELECT * FROM pedidos WHERE estado != 'borrador' ORDER BY actualizado DESC LIMIT ?", lim);
      const cuenta = Object.fromEntries(filas("SELECT estado, COUNT(*) AS n FROM pedidos WHERE estado != 'borrador' GROUP BY estado").map((r) => [r.estado, r.n]));
      return { pedidos: lista.map(armar), cuenta };
    },

    /** Un pedido con su historia. */
    pedido(numero) {
      const p = porNumero(numero);
      if (!p) throw new ErrorCatalogo('ese pedido no existe');
      return { ...armar(p), eventos: filas('SELECT estado, detalle, quien, t FROM pedido_eventos WHERE pedido = ? ORDER BY id', p.id) };
    },
  };
}

export const ABIERTOS_ESTADOS = ABIERTOS;
