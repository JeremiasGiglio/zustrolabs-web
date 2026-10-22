// Punto de entrada del Worker en Cloudflare: el manejador (index.js) y el Durable Object de la memoria (objeto.js).
// index.js no importa nada de Cloudflare, así se prueba con `node --test`.
export { default } from './index.js';
export { Atencion } from './objeto.js';
