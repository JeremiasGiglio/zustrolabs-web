// Evals del asistente con la IA real: node evals/correr.mjs  (necesita ANTHROPIC_API_KEY en el entorno).
// Cuenta como falla: lo que el caso pide y no está, lo que no debe y está, y que los controles hayan tenido que
// sacar algo en un caso «limpio» (quiere decir que el modelo no cumplió las reglas solo).
// Sale con código 1 si pasa menos del umbral (EVAL_UMBRAL, 0,9 por defecto) o si hubo una falla de reglas.
import { readFileSync, writeFileSync } from 'node:fs';
import { armarPedidoApi, controlar, llamarClaude, MODELO } from '../src/asistente.js';

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) { console.log('Sin ANTHROPIC_API_KEY: no se corren las evals.'); process.exit(process.env.CI ? 0 : 1); }
const { casos } = JSON.parse(readFileSync(new URL('./casos.json', import.meta.url), 'utf8'));
const umbral = Number(process.env.EVAL_UMBRAL || 0.9);
const modelo = process.env.MODELO || MODELO;
const REGLAS = new Set(['plata', 'prohibida', 'telefono', 'correo']);

const resultados = [];
for (const c of casos) {
  const fallas = [];
  let r;
  try {
    const { salida } = await llamarClaude(armarPedidoApi({ idioma: c.idioma, mensajes: [{ role: 'user', content: c.pregunta }] }, { modelo }), { apiKey });
    r = controlar(salida, c.idioma);
  } catch (e) {
    fallas.push(`error: ${e.message}`);
  }
  if (r) {
    if ('fuera_de_tema' in c && r.fuera_de_tema !== c.fuera_de_tema) fallas.push(`fuera_de_tema=${r.fuera_de_tema}`);
    if ('escribirnos' in c && r.escribirnos !== c.escribirnos) fallas.push(`escribirnos=${r.escribirnos}`);
    for (const s of c.secciones ?? []) if (!r.secciones.includes(s)) fallas.push(`falta sección ${s}`);
    for (const e of c.enlaces ?? []) if (!r.enlaces.includes(e)) fallas.push(`falta enlace ${e}`);
    for (const re of c.debe ?? []) if (!new RegExp(re, 'iu').test(r.respuesta)) fallas.push(`no dice /${re}/`);
    for (const re of c.no_debe ?? []) if (new RegExp(re, 'iu').test(r.respuesta)) fallas.push(`dice /${re}/`);
    if (c.limpio) for (const n of r.notas) if (REGLAS.has(n) || n === 'link') fallas.push(`control: ${n}`);
  }
  const regla = fallas.some((f) => f.startsWith('control:') && !f.endsWith('link'));
  resultados.push({ id: c.id, ok: fallas.length === 0, regla, fallas, respuesta: r?.respuesta ?? '' });
  console.log(`${fallas.length ? '✗' : '✓'} ${c.id}${fallas.length ? `  ${fallas.join(' · ')}` : ''}`);
}
const ok = resultados.filter((x) => x.ok).length;
const reglas = resultados.filter((x) => x.regla).length;
console.log(`\n${ok}/${resultados.length} casos (${modelo}). Fallas de reglas: ${reglas}.`);
writeFileSync(new URL('./ultimo-resultado.json', import.meta.url), JSON.stringify({ modelo, fecha: new Date().toISOString(), ok, total: resultados.length, resultados }, null, 1) + '\n');
process.exit(ok / resultados.length >= umbral && reglas === 0 ? 0 : 1);
