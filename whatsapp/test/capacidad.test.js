// Capacidad de la IA (ZL-158): con los topes de wrangler.toml, 30 negocios en hora pico se atienden sin que nadie
// tenga que volver a escribir, y un negocio con un pico enorme no frena a los demás.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cupoDeIa } from '../src/index.js';

// Los topes tal como se publican (si alguien los baja, esta prueba lo nota).
const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const tope = (nombre) => Number(new RegExp(`name = "${nombre}"[\\s\\S]*?limit = (\\d+), period = 60`).exec(toml)?.[1]);

/** Un limitador como el de Cloudflare: cuenta por clave dentro del mismo minuto. */
function limitador(limite) {
  const cuenta = new Map();
  return {
    limit: async ({ key }) => {
      const n = (cuenta.get(key) ?? 0) + 1;
      cuenta.set(key, n);
      return { success: n <= limite };
    },
    nuevoMinuto: () => cuenta.clear(),
  };
}
const armar = () => ({ LIMITE_NEGOCIO: limitador(tope('LIMITE_NEGOCIO')), LIMITE_GLOBAL: limitador(tope('LIMITE_GLOBAL')) });

test('los topes publicados: 60 por minuto por negocio y 1.000 en total', () => {
  assert.equal(tope('LIMITE_NEGOCIO'), 60);
  assert.equal(tope('LIMITE_GLOBAL'), 1000);
});

test('30 negocios en hora pico (25 respuestas por minuto cada uno, 750 en total): todos con cupo', async () => {
  const env = armar();
  let ok = 0;
  for (let i = 0; i < 25; i++) for (let n = 0; n < 30; n++) if ((await cupoDeIa(env, `neg${n}`, { esperaCupoMs: 0 })()) === 'ok') ok++;
  assert.equal(ok, 750);
});

test('un negocio con un pico enorme (100 en un minuto) no frena a los otros 29', async () => {
  const env = armar();
  let grande = 0;
  for (let i = 0; i < 100; i++) if ((await cupoDeIa(env, 'grande', { esperaCupoMs: 0 })()) === 'ok') grande++;
  assert.equal(grande, 60, 'el grande usa su cupo del minuto');
  for (let n = 0; n < 29; n++) assert.equal(await cupoDeIa(env, `chico${n}`, { esperaCupoMs: 0 })(), 'ok');
  // Al minuto siguiente, el grande vuelve a tener cupo.
  env.LIMITE_NEGOCIO.nuevoMinuto();
  env.LIMITE_GLOBAL.nuevoMinuto();
  assert.equal(await cupoDeIa(env, 'grande', { esperaCupoMs: 0 })(), 'ok');
});

test('cupo lleno: espera y reintenta solo, en vez de pedirle a la persona que vuelva a escribir', async () => {
  let llamadas = 0;
  const env = { LIMITE_GLOBAL: { limit: async () => ({ success: ++llamadas > 1 }) } };
  const esperas = [];
  const r = await cupoDeIa(env, null, { esperaCupoMs: 4000, dormir: async (ms) => esperas.push(ms) })();
  assert.equal(r, 'ok');
  assert.deepEqual(esperas, [4000]);
  // Si sigue lleno después de los reintentos, recién ahí avisa.
  const lleno = { LIMITE_GLOBAL: { limit: async () => ({ success: false }) } };
  const esperas2 = [];
  assert.equal(await cupoDeIa(lleno, null, { esperaCupoMs: 4000, dormir: async (ms) => esperas2.push(ms) })(), 'global');
  assert.deepEqual(esperas2, [4000, 4000], 'dos esperas de 4 s: entra en el tiempo que da Cloudflare');
});
