// Worker «zustrolabs-asistente»: atiende POST zustrolabs.com/api/chat («Preguntale a Zustro»).
// La lógica está en asistente.js; acá no hay nada más que conectarla.
import { crearHandler } from './asistente.js';

export default { fetch: crearHandler() };
