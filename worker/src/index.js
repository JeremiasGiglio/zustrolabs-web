// Worker «zustrolabs-contacto»: atiende POST zustrolabs.com/api/contacto.
// La lógica está en contacto.js; acá solo se conecta con el binding send_email de Cloudflare.
import { EmailMessage } from 'cloudflare:email';
import { crearHandler } from './contacto.js';

const fetch = crearHandler({
  async enviar(mime, { de, para }, env) {
    await env.CORREO.send(new EmailMessage(de, para, mime));
  },
});

export default { fetch };
