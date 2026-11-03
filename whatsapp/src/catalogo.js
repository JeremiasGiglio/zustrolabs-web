// Catálogo de un negocio (ZL-121): productos, stock, fotos e historial, en la base SQLite propia de ese negocio
// (un Durable Object «Catalogo» por negocio, objeto.js). La IA solo lo LEE (paraAsistente); lo cambian las personas
// desde negocios.zustrolabs.com (negocios.js).
// No importa nada de Cloudflare: `sql` es ctx.storage.sql del Durable Object, o un adaptador de node:sqlite en los tests.

export const MAX_PRODUCTOS = 5000;
export const MAX_IMPORTAR = 3000;
export const MAX_FOTO_BYTES = 600_000;
/** Con hasta esta cantidad de productos activos, la IA ve el catálogo entero; con más, solo los que se parecen a la pregunta. */
export const CATALOGO_ENTERO = 150;
const MAX_ELEGIDOS = 40;
const LARGOS = { nombre: 120, codigo: 40, categoria: 60, descripcion: 500, unidad: 30 };

const ESQUEMA = [
  `CREATE TABLE IF NOT EXISTS productos (
    id TEXT PRIMARY KEY, codigo TEXT, nombre TEXT NOT NULL, nombre_n TEXT NOT NULL, categoria TEXT NOT NULL DEFAULT '',
    descripcion TEXT NOT NULL DEFAULT '', precio REAL, unidad TEXT NOT NULL DEFAULT '', stock INTEGER,
    reservado INTEGER NOT NULL DEFAULT 0, activo INTEGER NOT NULL DEFAULT 1, foto TEXT, creado INTEGER, actualizado INTEGER)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS productos_codigo ON productos(codigo) WHERE codigo IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS productos_nombre ON productos(nombre_n)`,
  `CREATE TABLE IF NOT EXISTS fotos (id TEXT PRIMARY KEY, tipo TEXT NOT NULL, datos BLOB NOT NULL, bytes INTEGER NOT NULL, creado INTEGER)`,
  `CREATE TABLE IF NOT EXISTS movimientos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, producto TEXT, nombre TEXT, tipo TEXT NOT NULL, antes TEXT, despues TEXT,
    detalle TEXT NOT NULL DEFAULT '', quien TEXT NOT NULL DEFAULT '', t INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS movimientos_producto ON movimientos(producto, t)`,
];

/** Minúsculas, sin acentos ni signos: para buscar y para reconocer el mismo nombre escrito distinto. */
export const normalizar = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Patrón LIKE de SQLite (en un Durable Object, como mucho 50 bytes): se corta el texto por bytes. */
const patron = (s) => {
  let t = String(s);
  while (new TextEncoder().encode(t).length > 46) t = t.slice(0, -1);
  return `%${t}%`;
};

const nuevoId = (pref) => `${pref}${Date.now().toString(36)}${crypto.getRandomValues(new Uint32Array(2)).reduce((a, n) => a + n.toString(36), '')}`;
const texto = (v, max) => String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);

/** Error que se le puede mostrar a quien usa la app (los demás son fallas internas). */
export class ErrorCatalogo extends Error {
  constructor(mensaje, campo) {
    super(mensaje);
    this.name = 'ErrorCatalogo';
    this.campo = campo;
  }
}

/**
 * Valida y normaliza los datos de un producto. `parcial`: solo los campos que vienen (al editar).
 * precio: número ≥ 0 o vacío (sin precio). stock: entero ≥ 0 o vacío (no se controla el stock).
 */
export function validarProducto(d, { parcial = false } = {}) {
  const out = {};
  const hay = (k) => Object.prototype.hasOwnProperty.call(d ?? {}, k);
  if (!parcial || hay('nombre')) {
    out.nombre = texto(d?.nombre, LARGOS.nombre);
    if (!out.nombre) throw new ErrorCatalogo('falta el nombre', 'nombre');
  }
  for (const k of ['codigo', 'categoria', 'descripcion', 'unidad']) if (!parcial || hay(k)) out[k] = texto(d?.[k], LARGOS[k]);
  if ('codigo' in out && !out.codigo) out.codigo = null;
  if (!parcial || hay('precio')) {
    const v = d?.precio;
    if (v === '' || v === null || v === undefined) out.precio = null;
    else {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 1e10) throw new ErrorCatalogo('el precio tiene que ser un número mayor o igual a 0', 'precio');
      out.precio = Math.round(n * 100) / 100;
    }
  }
  if (!parcial || hay('stock')) {
    const v = d?.stock;
    if (v === '' || v === null || v === undefined) out.stock = null;
    else {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 1e7) throw new ErrorCatalogo('el stock tiene que ser un número entero, 0 o más', 'stock');
      out.stock = n;
    }
  }
  if (!parcial || hay('activo')) out.activo = d?.activo === false || d?.activo === 0 || d?.activo === '0' ? 0 : 1;
  if (hay('foto')) out.foto = d.foto ? texto(d.foto, 60) : null;
  return out;
}

const fila = (r) =>
  r && {
    id: r.id, codigo: r.codigo ?? '', nombre: r.nombre, categoria: r.categoria, descripcion: r.descripcion, precio: r.precio ?? null,
    unidad: r.unidad, stock: r.stock ?? null, reservado: r.reservado ?? 0, activo: r.activo === 1, foto: r.foto ?? null, actualizado: r.actualizado,
  };

const resumir = (v) => (v === null || v === undefined ? '' : String(v));

/** Precio para leer: «$ 2.500» o «$ 1.250,50». */
export const pesos = (n) => `$ ${Number(n).toLocaleString('es-AR', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

const VACIAS = new Set('que como cuanto cuanta cuantos cuantas tenes tienen tiene hay para con sin por los las del una uno unos unas esta este esto ese esa quiero queria quisiera precio precios sale salen cuesta cuestan vale valen stock busco necesito algo alguna alguno mas the and for you have hola buenas dia'.split(' '));

/**
 * @param sql ctx.storage.sql (o un adaptador con exec(query, ...params) → {toArray(), one()})
 * @param transaccion (fn) => fn() atómica (ctx.storage.transactionSync en el Durable Object)
 */
export function crearCatalogo(sql, transaccion = (fn) => fn(), reloj = () => Date.now()) {
  for (const q of ESQUEMA) sql.exec(q);
  const filas = (q, ...p) => sql.exec(q, ...p).toArray();
  const una = (q, ...p) => filas(q, ...p)[0] ?? null;
  const anotar = (producto, nombre, tipo, antes, despues, detalle, quien) =>
    sql.exec('INSERT INTO movimientos (producto, nombre, tipo, antes, despues, detalle, quien, t) VALUES (?,?,?,?,?,?,?,?)',
      producto, nombre, tipo, resumir(antes), resumir(despues), texto(detalle, 200), texto(quien, 120), reloj());
  const porId = (id) => una('SELECT * FROM productos WHERE id = ?', String(id));
  const porCodigo = (c) => (c ? una('SELECT * FROM productos WHERE codigo = ?', c) : null);
  const porNombre = (n) => una('SELECT * FROM productos WHERE nombre_n = ? ORDER BY creado LIMIT 1', normalizar(n));
  const contar = () => una('SELECT COUNT(*) AS n FROM productos').n;

  function insertar(v, quien, detalle = 'alta') {
    if (contar() >= MAX_PRODUCTOS) throw new ErrorCatalogo(`el catálogo llegó al máximo de ${MAX_PRODUCTOS} productos`);
    if (v.codigo && porCodigo(v.codigo)) throw new ErrorCatalogo(`ya hay un producto con el código ${v.codigo}`, 'codigo');
    const id = nuevoId('p');
    const t = reloj();
    sql.exec(
      'INSERT INTO productos (id, codigo, nombre, nombre_n, categoria, descripcion, precio, unidad, stock, activo, foto, creado, actualizado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, v.codigo ?? null, v.nombre, normalizar(v.nombre), v.categoria ?? '', v.descripcion ?? '', v.precio ?? null, v.unidad ?? '', v.stock ?? null, v.activo ?? 1, v.foto ?? null, t, t,
    );
    anotar(id, v.nombre, 'alta', '', v.stock, detalle, quien);
    return fila(porId(id));
  }

  function cambiar(actual, v, quien, detalle = 'edición') {
    if (v.codigo && v.codigo !== actual.codigo) {
      const otro = porCodigo(v.codigo);
      if (otro && otro.id !== actual.id) throw new ErrorCatalogo(`ya hay un producto con el código ${v.codigo}`, 'codigo');
    }
    const campos = Object.keys(v).filter((k) => v[k] !== (actual[k] ?? (k === 'codigo' || k === 'precio' || k === 'stock' || k === 'foto' ? null : '')));
    if (!campos.length) return { producto: fila(actual), cambio: false };
    const sets = campos.map((k) => `${k} = ?`);
    const vals = campos.map((k) => v[k]);
    if (campos.includes('nombre')) { sets.push('nombre_n = ?'); vals.push(normalizar(v.nombre)); }
    sql.exec(`UPDATE productos SET ${sets.join(', ')}, actualizado = ? WHERE id = ?`, ...vals, reloj(), actual.id);
    for (const k of campos) {
      if (k === 'foto') continue;
      anotar(actual.id, v.nombre ?? actual.nombre, k === 'stock' ? 'stock' : k === 'precio' ? 'precio' : k === 'activo' ? 'estado' : 'dato', k === 'activo' ? (actual.activo ? 'activo' : 'pausado') : actual[k], k === 'activo' ? (v.activo ? 'activo' : 'pausado') : v[k], k === 'stock' || k === 'precio' || k === 'activo' ? detalle : `${detalle}: ${k}`, quien);
    }
    if (campos.includes('foto') && actual.foto) sql.exec('DELETE FROM fotos WHERE id = ?', actual.foto);
    return { producto: fila(porId(actual.id)), cambio: true };
  }

  return {
    resumen() {
      const r = una(`SELECT COUNT(*) AS total, SUM(activo) AS activos,
        SUM(CASE WHEN activo = 1 AND stock IS NOT NULL AND stock - reservado <= 0 THEN 1 ELSE 0 END) AS agotados FROM productos`);
      return { total: r.total ?? 0, activos: r.activos ?? 0, agotados: r.agotados ?? 0 };
    },

    /** Lista para la app: búsqueda por nombre, código, categoría o descripción; con o sin pausados. */
    lista({ q = '', categoria = '', pausados = true, desde = 0, cuantos = 200 } = {}) {
      const where = [];
      const p = [];
      const nq = normalizar(q);
      if (nq) {
        where.push("(nombre_n LIKE ? OR codigo LIKE ? OR lower(categoria) LIKE ? OR lower(descripcion) LIKE ?)");
        p.push(patron(nq), patron(String(q).trim()), patron(nq), patron(nq));
      }
      if (categoria) { where.push('categoria = ?'); p.push(String(categoria)); }
      if (!pausados) where.push('activo = 1');
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = una(`SELECT COUNT(*) AS n FROM productos ${w}`, ...p).n;
      const n = Math.min(Math.max(Number(cuantos) || 200, 1), 500);
      const productos = filas(`SELECT * FROM productos ${w} ORDER BY categoria, nombre_n LIMIT ? OFFSET ?`, ...p, n, Math.max(Number(desde) || 0, 0)).map(fila);
      const categorias = filas("SELECT categoria, COUNT(*) AS n FROM productos WHERE categoria <> '' GROUP BY categoria ORDER BY categoria").map((r) => ({ nombre: r.categoria, n: r.n }));
      return { productos, total, categorias };
    },

    obtener(id) {
      return fila(porId(id));
    },

    crear(datos, quien) {
      return transaccion(() => insertar(validarProducto(datos), quien));
    },

    actualizar(id, datos, quien) {
      return transaccion(() => {
        const actual = porId(id);
        if (!actual) throw new ErrorCatalogo('ese producto ya no existe');
        return cambiar(actual, validarProducto(datos, { parcial: true }), quien).producto;
      });
    },

    borrar(id, quien) {
      return transaccion(() => {
        const actual = porId(id);
        if (!actual) return false;
        sql.exec('DELETE FROM productos WHERE id = ?', actual.id);
        if (actual.foto) sql.exec('DELETE FROM fotos WHERE id = ?', actual.foto);
        anotar(actual.id, actual.nombre, 'baja', actual.stock, '', 'borrado', quien);
        return true;
      });
    },

    /**
     * Suma o resta stock de forma atómica: nunca queda negativo ni por debajo de lo reservado.
     * Si el producto no controla stock (vacío), avisa en vez de inventar un número.
     */
    moverStock(id, delta, quien, motivo = 'ajuste') {
      const d = Number(delta);
      if (!Number.isInteger(d) || d === 0 || Math.abs(d) > 1e6) throw new ErrorCatalogo('la cantidad tiene que ser un número entero distinto de 0');
      return transaccion(() => {
        const actual = porId(id);
        if (!actual) throw new ErrorCatalogo('ese producto ya no existe');
        if (actual.stock === null || actual.stock === undefined) throw new ErrorCatalogo('este producto no controla stock: cargá una cantidad primero');
        const nuevo = actual.stock + d;
        if (nuevo < 0) throw new ErrorCatalogo(`no hay tanto stock: quedan ${actual.stock}`);
        if (nuevo < (actual.reservado ?? 0)) throw new ErrorCatalogo(`hay ${actual.reservado} reservadas en pedidos: el stock no puede bajar de eso`);
        sql.exec('UPDATE productos SET stock = ?, actualizado = ? WHERE id = ?', nuevo, reloj(), actual.id);
        anotar(actual.id, actual.nombre, 'stock', actual.stock, nuevo, `${d > 0 ? '+' : ''}${d} · ${motivo}`, quien);
        return fila(porId(actual.id));
      });
    },

    /**
     * Importa filas de un Excel o CSV ya leído en el navegador ({nombre, codigo, precio, stock, categoria, …}).
     * - clave 'codigo' o 'nombre': cómo se reconoce un producto que ya existe;
     * - modo 'actualizar': crea los nuevos y actualiza los que están; 'reemplazar': además PAUSA (no borra) los que
     *   no vienen en el archivo;
     * - probar: no guarda nada, solo dice qué pasaría (vista previa).
     * Una fila con error no frena las demás: se informa con su número.
     */
    importar(filasIn, { modo = 'actualizar', clave = 'codigo', probar = false } = {}, quien = '') {
      if (!Array.isArray(filasIn)) throw new ErrorCatalogo('no llegaron filas');
      if (filasIn.length > MAX_IMPORTAR) throw new ErrorCatalogo(`el archivo tiene ${filasIn.length} filas: el máximo por vez es ${MAX_IMPORTAR}`);
      if (!['actualizar', 'reemplazar'].includes(modo)) throw new ErrorCatalogo('modo inválido');
      const r = { creados: 0, actualizados: 0, sinCambios: 0, pausados: 0, errores: [], muestra: [] };
      const vistos = new Set();
      const correr = () => {
        filasIn.forEach((f, i) => {
          const n = Number(f?._fila) || i + 2; // fila del archivo como la muestra Excel (la 1 son los títulos)
          let v;
          try {
            const datos = { ...f };
            // En una importación, una columna vacía no borra lo que había (salvo stock/precio si vienen).
            for (const k of Object.keys(datos)) if (datos[k] === undefined) delete datos[k];
            v = validarProducto(datos, { parcial: true });
          } catch (e) {
            r.errores.push({ fila: n, motivo: e.message });
            return;
          }
          const k = clave === 'codigo' && v.codigo ? `c:${v.codigo}` : `n:${normalizar(v.nombre)}`;
          if (!v.nombre && !(clave === 'codigo' && v.codigo)) { r.errores.push({ fila: n, motivo: 'falta el nombre' }); return; }
          if (vistos.has(k)) { r.errores.push({ fila: n, motivo: 'repetida en el archivo (vale la primera)' }); return; }
          vistos.add(k);
          const actual = (clave === 'codigo' && v.codigo ? porCodigo(v.codigo) : null) ?? (v.nombre ? porNombre(v.nombre) : null);
          try {
            if (!actual) {
              if (!v.nombre) { r.errores.push({ fila: n, motivo: `no existe un producto con el código ${v.codigo} y falta el nombre para crearlo` }); return; }
              if (!probar) insertar({ ...validarProducto({ nombre: v.nombre }), ...v }, quien, 'importación');
              else if (v.codigo && porCodigo(v.codigo)) throw new ErrorCatalogo(`ya hay un producto con el código ${v.codigo}`);
              r.creados++;
              if (r.muestra.length < 20) r.muestra.push({ fila: n, accion: 'crear', nombre: v.nombre });
            } else {
              const sinNombre = { ...v };
              if (clave === 'codigo' && !sinNombre.nombre) delete sinNombre.nombre;
              if (actual.activo === 0 && !('activo' in f)) sinNombre.activo = 1;
              const cambia = Object.keys(sinNombre).some((c) => sinNombre[c] !== (actual[c] ?? (['codigo', 'precio', 'stock', 'foto'].includes(c) ? null : '')));
              if (!cambia) { r.sinCambios++; return; }
              if (!probar) cambiar(actual, sinNombre, quien, 'importación');
              r.actualizados++;
              if (r.muestra.length < 20) r.muestra.push({ fila: n, accion: 'actualizar', nombre: actual.nombre });
            }
          } catch (e) {
            if (!(e instanceof ErrorCatalogo)) throw e;
            r.errores.push({ fila: n, motivo: e.message });
          }
        });
        if (modo === 'reemplazar') {
          for (const p of filas('SELECT * FROM productos WHERE activo = 1')) {
            const k1 = p.codigo ? `c:${p.codigo}` : null;
            if ((k1 && vistos.has(k1)) || vistos.has(`n:${p.nombre_n}`)) continue;
            if (!probar) cambiar(p, { activo: 0 }, quien, 'importación (no estaba en el archivo)');
            r.pausados++;
          }
        }
      };
      if (probar) correr();
      else transaccion(correr);
      return r;
    },

    /** Todo el catálogo para exportarlo a Excel (sin las fotos). */
    exportar() {
      return filas('SELECT * FROM productos ORDER BY categoria, nombre_n').map(fila);
    },

    historial({ producto = '', cuantos = 100 } = {}) {
      const n = Math.min(Math.max(Number(cuantos) || 100, 1), 500);
      const q = producto ? filas('SELECT * FROM movimientos WHERE producto = ? ORDER BY id DESC LIMIT ?', String(producto), n) : filas('SELECT * FROM movimientos ORDER BY id DESC LIMIT ?', n);
      return q.map((m) => ({ producto: m.producto, nombre: m.nombre, tipo: m.tipo, antes: m.antes, despues: m.despues, detalle: m.detalle, quien: m.quien, t: m.t }));
    },

    /** Guarda una foto ya achicada en el navegador (webp, jpeg o png, hasta MAX_FOTO_BYTES). */
    guardarFoto(bytes, tipo) {
      const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      if (!b.length) throw new ErrorCatalogo('la foto está vacía');
      if (b.length > MAX_FOTO_BYTES) throw new ErrorCatalogo('la foto es muy pesada (máximo 600 KB después de achicarla)');
      const real = tipoDeImagen(b);
      if (!real || real !== tipo) throw new ErrorCatalogo('solo fotos webp, jpeg o png');
      const id = nuevoId('f');
      sql.exec('INSERT INTO fotos (id, tipo, datos, bytes, creado) VALUES (?,?,?,?,?)', id, real, b, b.length, reloj());
      return id;
    },

    foto(id) {
      const f = una('SELECT tipo, datos FROM fotos WHERE id = ?', String(id));
      return f ? { tipo: f.tipo, datos: f.datos instanceof Uint8Array ? f.datos : new Uint8Array(f.datos) } : null;
    },

    /** Borra fotos que ya no usa ningún producto (subidas y abandonadas). */
    limpiarFotos(antesDe) {
      const r = filas('SELECT id FROM fotos WHERE creado < ? AND id NOT IN (SELECT foto FROM productos WHERE foto IS NOT NULL)', antesDe);
      for (const { id } of r) sql.exec('DELETE FROM fotos WHERE id = ?', id);
      return r.length;
    },

    /**
     * Lo que ve la IA antes de responder: los productos activos (todos si son pocos; si no, los que más se parecen al
     * mensaje), con precio solo si el negocio permite precios, y el stock como «hay stock», «quedan N» o «AGOTADO».
     * Devuelve el texto y los montos que la respuesta puede nombrar (controlarNegocio).
     */
    paraAsistente(mensaje = '', { precios = false } = {}) {
      const activos = una('SELECT COUNT(*) AS n FROM productos WHERE activo = 1').n;
      let elegidos;
      let resto = 0;
      if (activos <= CATALOGO_ENTERO) {
        elegidos = filas('SELECT * FROM productos WHERE activo = 1 ORDER BY categoria, nombre_n');
      } else {
        const palabras = [...new Set(normalizar(mensaje).split(' ').filter((w) => w.length >= 3 && !VACIAS.has(w)))].slice(0, 6);
        const puntos = new Map();
        for (const w of palabras) {
          const raiz = (w.length > 4 ? w.slice(0, -1) : w).slice(0, 20); // «bombones» encuentra «bombón», «cajas» encuentra «caja»
          for (const p of filas("SELECT * FROM productos WHERE activo = 1 AND (nombre_n LIKE ? OR lower(categoria) LIKE ? OR lower(descripcion) LIKE ?) LIMIT 200", patron(raiz), patron(raiz), patron(raiz))) {
            const prev = puntos.get(p.id) ?? { p, n: 0 };
            prev.n += p.nombre_n.includes(raiz) ? 3 : 1;
            puntos.set(p.id, prev);
          }
        }
        elegidos = [...puntos.values()].sort((a, b) => b.n - a.n).slice(0, MAX_ELEGIDOS).map((x) => x.p);
        if (!elegidos.length) elegidos = filas('SELECT * FROM productos WHERE activo = 1 ORDER BY actualizado DESC LIMIT 25');
        resto = activos - elegidos.length;
      }
      const montos = [];
      const lineas = elegidos.map((p) => {
        const disp = p.stock === null || p.stock === undefined ? null : p.stock - (p.reservado ?? 0);
        const stock = disp === null ? 'hay stock' : disp <= 0 ? 'AGOTADO: no ofrecer' : disp <= 5 ? `quedan ${disp}` : 'hay stock';
        let precio = '';
        if (precios && p.precio !== null && p.precio !== undefined) {
          precio = ` · ${pesos(p.precio)}${p.unidad ? ` por ${p.unidad}` : ''}`;
          montos.push(pesos(p.precio).replace(/\D/g, ''), String(p.precio).replace(/\D/g, ''));
        }
        const extra = [p.codigo ? `código ${p.codigo}` : '', p.descripcion].filter(Boolean).join('. ');
        return `- ${p.nombre}${p.categoria ? ` (${p.categoria})` : ''}${precio} · ${stock}${extra ? ` · ${extra}` : ''}`;
      });
      const nota = resto > 0 ? `\n(Hay ${resto} productos más que no se muestran: si no está lo que busca, pedí más detalles o ofrecé una persona.)` : '';
      return { texto: lineas.length ? lineas.join('\n') + nota : '(El negocio todavía no cargó productos.)', montos: [...new Set(montos.filter(Boolean))], cuantos: elegidos.length, activos };
    },
  };
}

/** webp, jpeg o png según los primeros bytes (no se confía en lo que dice el navegador). */
export function tipoDeImagen(b) {
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  return null;
}

/** Operaciones que se pueden pedir al catálogo desde afuera (el Worker, por RPC). */
export const OPERACIONES = ['resumen', 'lista', 'obtener', 'crear', 'actualizar', 'borrar', 'moverStock', 'importar', 'exportar', 'historial', 'guardarFoto', 'foto', 'paraAsistente'];

/**
 * Corre una operación y devuelve {ok: true, valor} o {ok: false, error, campo}: los errores para mostrar cruzan el RPC
 * del Durable Object como datos (una excepción perdería el tipo). Las fallas internas sí se tiran.
 */
export function ejecutarCatalogo(c, op, args = []) {
  if (!OPERACIONES.includes(op)) return { ok: false, error: 'operación desconocida' };
  try {
    return { ok: true, valor: c[op](...args) };
  } catch (e) {
    if (e instanceof ErrorCatalogo) return { ok: false, error: e.message, campo: e.campo };
    throw e;
  }
}
