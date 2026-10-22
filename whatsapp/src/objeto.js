// Durable Object «Atencion»: una sola instancia guarda la memoria y las charlas del WhatsApp de Zustro Labs.
// La lógica está en atencion.js; acá solo se conecta con Cloudflare y se programa la limpieza diaria.
import { DurableObject } from 'cloudflare:workers';
import { crearAtencion, DIA_MS } from './atencion.js';

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
}
