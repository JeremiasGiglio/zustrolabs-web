// Durable Object «Atencion»: una sola instancia guarda la memoria y las charlas del WhatsApp de Zustro Labs.
// La lógica está en atencion.js; acá solo se conecta con Cloudflare y se programa la limpieza diaria.
import { DurableObject } from 'cloudflare:workers';
import { crearAtencion, DIA_MS } from './atencion.js';
import { crearCatalogo, ejecutarCatalogo } from './catalogo.js';

export class Atencion extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.a = crearAtencion(ctx.storage);
  }

  async #alarma() {
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + DIA_MS);
  }

  async alarm() {
    await this.a.limpiar(Date.now());
    await this.ctx.storage.setAlarm(Date.now() + DIA_MS);
  }

  estado(num, now) { return this.a.estado(num, now); }
  async guardarEstado(num, datos, now) { await this.#alarma(); return this.a.guardarEstado(num, datos, now); }
  borrar(num) { return this.a.borrar(num); }
  async visto(id, now) { await this.#alarma(); return this.a.visto(id, now); }
  contar(num, now) { return this.a.contar(num, now); }
  charla(num, now) { return this.a.charla(num, now); }
  async agregar(num, mensajes, now, extra) { await this.#alarma(); return this.a.agregar(num, mensajes, now, extra); }
  borrarCharla(num) { return this.a.borrarCharla(num); }
  lista(now) { return this.a.lista(now); }
  cuentaIg(id) { return this.a.cuentaIg(id); }
  async guardarCuentaIg(id, datos) { await this.#alarma(); return this.a.guardarCuentaIg(id, datos); }
  borrarCuentaIg(id) { return this.a.borrarCuentaIg(id); }
  listaCuentasIg() { return this.a.listaCuentasIg(); }
  appIg(id) { return this.a.appIg(id); }
  async guardarAppIg(id, datos, now) { await this.#alarma(); return this.a.guardarAppIg(id, datos, now); }
  borrarAppIg(id) { return this.a.borrarAppIg(id); }
  listaAppsIg() { return this.a.listaAppsIg(); }
  negocio(id) { return this.a.negocio(id); }
  listaNegocios() { return this.a.listaNegocios(); }
  negociosDeEmail(email) { return this.a.negociosDeEmail(email); }
  negocioDeCuenta(cuenta) { return this.a.negocioDeCuenta(cuenta); }
  guardarNegocio(id, datos, now) { return this.a.guardarNegocio(id, datos, now); }
  fichaNegocio(id) { return this.a.fichaNegocio(id); }
  guardarFichaNegocio(id, datos, now) { return this.a.guardarFichaNegocio(id, datos, now); }
  borrarFichaNegocio(id) { return this.a.borrarFichaNegocio(id); }
  async contarUsoNegocio(id, now) { await this.#alarma(); return this.a.contarUsoNegocio(id, now); }
  usoNegocio(id, now) { return this.a.usoNegocio(id, now); }
}

// Durable Object «Catalogo»: UNA instancia por negocio (idFromName(id del negocio)), con su propia base SQLite. Así
// los productos de un negocio nunca están en la misma base que los de otro. La lógica está en catalogo.js.
export class Catalogo extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.c = crearCatalogo(ctx.storage.sql, (fn) => ctx.storage.transactionSync(fn));
  }

  /** op: una de OPERACIONES (catalogo.js). Devuelve {ok, valor} o {ok: false, error}. */
  async ejecutar(op, args) {
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + DIA_MS);
    return ejecutarCatalogo(this.c, op, args);
  }

  /** Una vez por día: borra las fotos subidas que ningún producto usa (más de un día de viejas). */
  async alarm() {
    this.c.limpiarFotos(Date.now() - DIA_MS);
    await this.ctx.storage.setAlarm(Date.now() + DIA_MS);
  }
}
