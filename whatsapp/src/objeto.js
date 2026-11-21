// Durable Object «Atencion»: una sola instancia guarda la memoria y las charlas del WhatsApp de Zustro Labs.
// La lógica está en atencion.js; acá solo se conecta con Cloudflare y se programa la limpieza diaria.
import { DurableObject } from 'cloudflare:workers';
import { crearAtencion, DIA_MS } from './atencion.js';
import { crearCatalogo, ejecutarCatalogo } from './catalogo.js';

/** ZL-159: cuánto se guardan el nombre y la dirección de un comprador en lo ya cerrado. */
export const RETENCION_DATOS_MS = 180 * 86_400_000;

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
  async sumarRafaga(num, item, now) { await this.#alarma(); return this.a.sumarRafaga(num, item, now); }
  tomarRafaga(num, id, now) { return this.a.tomarRafaga(num, id, now); }
  cursoVigente(num, id, now) { return this.a.cursoVigente(num, id, now); }
  terminarCurso(num, id, now) { return this.a.terminarCurso(num, id, now); }
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
  numeroYc(clave) { return this.a.numeroYc(clave); }
  async guardarNumeroYc(clave, datos, now) { await this.#alarma(); return this.a.guardarNumeroYc(clave, datos, now); }
  borrarNumeroYc(clave) { return this.a.borrarNumeroYc(clave); }
  listaNumerosYc() { return this.a.listaNumerosYc(); }
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
  seguimientosVencidos(now, limite) { return this.a.seguimientosVencidos(now, limite); }
  vapid() { return this.a.vapid(); }
  claveFotos() { return this.a.claveFotos(); }
  sumarNoSupo(id, p, now) { return this.a.sumarNoSupo(id, p, now); }
  async suscribirPush(id, sub, email, now) { await this.#alarma(); return this.a.suscribirPush(id, sub, email, now); }
  suscripcionesPush(id) { return this.a.suscripcionesPush(id); }
  borrarPush(id, endpoints) { return this.a.borrarPush(id, endpoints); }
  async sumarMetrica(id, clave, now, dia) { await this.#alarma(); return this.a.sumarMetrica(id, clave, now, dia); }
  async sumarMensaje(id, datos, now) { await this.#alarma(); return this.a.sumarMensaje(id, datos, now); }
  metricasDias(id, desde, hasta, now) { return this.a.metricasDias(id, desde, hasta, now); }
  metricas(id, dias, now) { return this.a.metricas(id, dias, now); }
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
    const r = ejecutarCatalogo(this.c, op, args);
    await this.programar();
    return r;
  }

  /** La alarma suena en el próximo vencimiento de una reserva (ZL-139) o, si no hay, una vez por día (fotos sueltas). */
  async programar(despuesDeSonar = false) {
    const prox = this.c.proximoVencimiento();
    const fotos = ((await this.ctx.storage.get('fotos')) ?? Date.now()) + DIA_MS;
    const quiero = Math.max(Date.now() + 1000, Math.min(prox ? prox + 1000 : Infinity, fotos));
    const actual = await this.ctx.storage.getAlarm();
    if (despuesDeSonar || !actual || quiero < actual) await this.ctx.storage.setAlarm(quiero);
  }

  /** Vence las reservas que pasaron su hora y, una vez por día, borra las fotos subidas que ningún producto usa. */
  async alarm() {
    const vencidos = this.c.vencer();
    if (vencidos.length) console.log(JSON.stringify({ canal: 'pedidos', que: 'vencidos', n: vencidos.length }));
    const ultima = (await this.ctx.storage.get('fotos')) ?? 0;
    if (Date.now() - ultima >= DIA_MS) {
      this.c.limpiarFotos(Date.now() - DIA_MS);
      // ZL-159: privacidad: los datos del comprador de lo cerrado hace más de 180 días se borran.
      const antes = Date.now() - RETENCION_DATOS_MS;
      this.c.olvidarCompradores({ antesDe: antes });
      this.c.olvidarConsultas({ antesDe: antes });
      await this.ctx.storage.put('fotos', Date.now());
    }
    await this.programar(true);
  }
}
