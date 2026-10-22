# Seguridad — zustrolabs-web

Qué protege al sitio hoy, qué hay que activar una sola vez en Cloudflare y GitHub, y qué hacer si algo pasa. El sitio es estático: no hay base de datos ni cuentas de usuario. Hay dos partes con código del lado del servidor: el Worker del formulario (`worker/`), que valida, manda un correo y no guarda nada, y el Worker del asistente (`asistente/`), que responde preguntas con la IA sobre lo publicado en la página y tampoco guarda nada. Lo que queda es proteger el dominio, el tráfico y el formulario.

## Lo que ya hace el sitio (está en el repo)

- **Sin secretos en el repo.** HTML, CSS y JS servidos por Cloudflare Pages. No hay login ni base de datos. El único secreto (la casilla a la que llegan las consultas) vive en Cloudflare, como secreto del Worker.
- **Cabeceras de seguridad** en `site/_headers`:
  - `Content-Security-Policy`: solo se cargan scripts, estilos, fuentes y conexiones de la lista (el propio sitio, Google Fonts y Cloudflare Web Analytics). Nada de iframes (`frame-ancestors 'none'`), ni plugins (`object-src 'none'`), ni formularios ni conexiones que manden datos a otro sitio (`form-action 'self'`, `connect-src 'self'`).
  - `Strict-Transport-Security`: el navegador recuerda un año que el sitio es solo HTTPS, incluidos los subdominios.
  - `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` (cámara, micrófono, ubicación y pago bloqueados), `Cross-Origin-Opener-Policy`.
  - `upgrade-insecure-requests`: cualquier recurso `http://` se pide como `https://`.
- **Caché pensada para publicar sin sustos:** imágenes y videos una semana; `site.css` y `site.js` se revalidan en cada visita y cada HTML los pide con la versión de su contenido (`?v=<hash>`, `npm run versionar`), así nadie ve estilos viejos después de un deploy. Lo que no existe responde `404.html` con estado 404, para que la caché no guarde la portada en lugar de otro archivo (ZL-71).
- **Formulario de contacto, con un Worker propio** (`worker/`, en `zustrolabs.com/api/contacto`). Los detalles están en `worker/README.md`.
  - Solo acepta POST en JSON desde `zustrolabs.com` o `www`: otro sitio no puede usarlo.
  - Cuerpo de 8 KB como máximo y campos validados y acotados.
  - Contra bots: campo trampa y tiempo mínimo de 2,5 s.
  - Límites de 5 por minuto por IP (por /64 en IPv6) y de 30 por minuto en total. Si faltan, no manda nada.
  - El destino sale de un secreto. El correo del visitante solo se acepta en ASCII seguro y el asunto va codificado: nadie puede agregar destinatarios ni cabeceras.
  - No guarda nada. Los logs solo llevan métricas, sin los registros automáticos de cada pedido.
  - Si falla, el visitante ve el correo y un link con el mensaje armado.
- **Asistente con IA, con un Worker propio** (`asistente/`, en `zustrolabs.com/api/chat`). Los detalles están en `asistente/README.md`.
  - Mismo origen, mismos chequeos de método, tipo y tamaño que el formulario.
  - Límites de 10 preguntas por minuto por IP y 60 por minuto en total (también es el tope de gasto). Si faltan, no responde.
  - La clave de la IA es un secreto del Worker, propia del estudio y separada de la del Radar.
  - La IA solo conoce lo publicado en la página. Su salida pasa por controles fijos: sin links, sin teléfonos, sin plata, sin palabras prohibidas y con botones elegidos de una lista cerrada.
  - No guarda la charla. Los logs solo llevan métricas.
- **Sin cookies ni rastreo propio.** Si se activa Cloudflare Web Analytics, tampoco usa cookies.
- **Páginas de apoyo (`/expo/`, `/pantalla/`)** fuera de los buscadores (`noindex`).
- **Tests automáticos** que, entre otras cosas, verifican que no haya precios ni datos prohibidos, que los links externos lleven `rel="noopener"`, que el único contacto sea el correo y que las cabeceras de seguridad sigan en su lugar.

## Lista para activar una sola vez (20 minutos)

### Cloudflare (dashboard del dominio zustrolabs.com)
- [ ] **SSL/TLS → Overview:** modo *Full (strict)*.
- [ ] **SSL/TLS → Edge Certificates:** *Always Use HTTPS* activado. *Minimum TLS Version* 1.2. (HSTS ya viene por cabecera; no hace falta activarlo también acá.)
- [ ] **DNS → Settings:** **DNSSEC** activado (evita que alguien "secuestre" el dominio en DNS).
- [ ] **Security → Bots:** *Bot Fight Mode* activado. Frena la mayoría del tráfico automático gratis.
- [ ] **Security → WAF → Managed rules:** el *Cloudflare Managed Ruleset* gratuito activado.
- [ ] **Security → WAF → Rate limiting rules:** una regla (el plan gratis incluye una): si una misma IP hace más de 60 pedidos en 10 segundos a `zustrolabs.com/*`, responder con *Managed Challenge* durante 1 minuto. Esto corta scrapers y ataques baratos sin molestar a personas.
- [ ] **Security → Settings:** *Security Level* en *Medium*, *Browser Integrity Check* activado.
- [ ] **Saber dónde está el botón de emergencia:** *Security → Settings → Under Attack Mode*. Si el sitio se cae por tráfico, se activa y cada visitante pasa por una verificación de 5 segundos. Se desactiva cuando pasa.
- [ ] **Workers & Pages → el proyecto → Settings:** *Preview deployments* con *Access policy* (solo el equipo ve las vistas previas de los PR), si no quieren que se puedan adivinar las URL de prueba.
- [ ] **Cuenta de Cloudflare:** **2FA** (doble factor) obligatorio para todos los que entren. Es la medida que más vale de toda esta lista.

### GitHub
- [ ] **2FA** en todas las cuentas con acceso al repo.
- [ ] **Branch protection en `main`:** *Require a pull request before merging* y *Require status checks to pass* (la CI). Sin esto, las reglas de `REGLAS.md` dependen de la buena voluntad.
- [ ] **Dependabot** (Settings → Code security): avisos de seguridad y actualizaciones de las dependencias de test.
- [ ] **Secret scanning** activado (viene por defecto en repos públicos; comprobar).

### Correo y formulario
- [ ] `contact@zustrolabs.com` tiene que ser una casilla real que alguien lea: es la casilla de Zoho Mail del estudio (ZL-107; `hola@` queda como alias para quien la tenga guardada).
- [ ] **Publicar el Worker del formulario** (una vez, desde `worker/`): `npx wrangler deploy` y `npx wrangler secret put DESTINO`, con una casilla **verificada** en *Email Routing → Destination addresses*. Ver `worker/README.md`.
- [ ] **Publicar el Worker del asistente** (una vez, desde `asistente/`): crear una clave propia en la consola de Anthropic, con límite de gasto, `npx wrangler secret put ANTHROPIC_API_KEY` y `npx wrangler deploy`. Ver `asistente/README.md`.
- [ ] Mandar una consulta de prueba desde zustrolabs.com y comprobar que llega y que «Responder» va al visitante.
- [ ] Si hay una *Redirect Rule* de `www` al dominio sin `www`, que excluya `/api/*`.
- [ ] Si empieza a llegar spam por el formulario: activar *Turnstile* de Cloudflare (gratis, sin captchas molestos) en el formulario y en el Worker. El campo trampa y el tiempo mínimo los controla el navegador, así que un script dedicado los puede saltear; hoy lo que de verdad frena el abuso son los dos límites. Turnstile pide una clave de sitio (pública) y una secreta (secreto del Worker).

### Dominio
- [ ] **Bloqueo de transferencia** (*Registrar lock*) activado en donde esté registrado el dominio, y los datos de contacto del registro al día.
- [ ] Renovación automática del dominio activada. Un dominio vencido es la forma más tonta de perder el sitio.

## En cada publicación
- `npm run check` en verde (la CI lo exige).
- Si se agregó un script, estilo o conexión a un servicio nuevo: actualizar la CSP en `site/_headers` **y** anotarlo en este documento. Si no está en la lista, el navegador lo bloquea; eso es lo correcto.
- Mirar la página publicada en un celular y en una computadora.

## Si algo pasa

| Qué | Qué hacer |
|---|---|
| El sitio se cae o va lento por tráfico raro | Cloudflare → Security → *Under Attack Mode* activado. Mirar *Security → Events* para ver de dónde viene. Desactivar cuando se calme. |
| Se publicó algo roto | Workers & Pages → el proyecto → Deployments → en el deployment anterior, **Rollback**. Es un clic y tarda segundos. |
| Llega spam por el formulario | Mirar los logs del Worker (`resultado`). Bajar `LIMITE_GLOBAL` en `worker/wrangler.toml` y volver a publicar. Si sigue, Turnstile. En una emergencia: *Workers & Pages → zustrolabs-contacto → Settings → Domains & Routes*, sacar las rutas; la página ofrece el correo. |
| Gasto raro o abuso del asistente | Bajar `LIMITE_GLOBAL` en `asistente/wrangler.toml` y volver a publicar. En una emergencia: *Workers & Pages → zustrolabs-asistente → Settings → Domains & Routes*, sacar las rutas; la página muestra el aviso con el correo. Si la clave se filtró, revocarla en la consola de Anthropic. |
| Alguien sin permiso entró a Cloudflare o GitHub | Cambiar la contraseña, revocar sesiones y tokens, revisar DNS y deployments recientes. Activar 2FA si no estaba. |
| Una clave tocó el repo por error | Revocarla en el servicio de origen **aunque ya se haya borrado del código**. El historial de git la conserva. |
| Un desconocido reporta una falla de seguridad | Responder desde contact@zustrolabs.com, agradecer, arreglar, no discutir. |

## Lo que no se hace
- No se agrega `'unsafe-eval'` a la CSP, ni se abren `frame-ancestors`, ni se permiten scripts de dominios fuera de la lista "para probar".
- No se instalan dependencias de producción: el sitio no tiene build y así se queda.
- No se guardan datos de visitantes en ningún lado nuestro. El Worker los manda por correo y los olvida; en sus logs no va nada personal.
- No se agrega un servicio de terceros para el formulario: va por el Worker propio.
- No se pone el correo de contacto en la URL de nada.

## Nota técnica honesta
La CSP permite `'unsafe-inline'` en scripts y estilos porque el sitio tiene dos scripts cortos en línea (la elección del modo oscuro antes de pintar la página, y las frases que rotan en `/pantalla/`) y estilos en línea en un par de elementos. Quitarlo exigiría *nonces*, que un sitio estático sin build no puede generar. El riesgo es bajo. Desde ZL-105 la página sí muestra texto que no escribimos nosotros: la pregunta del visitante y la respuesta del asistente. Por eso `site.js` los mete siempre con `textContent`, nunca como HTML, y los botones de cada respuesta salen de una lista fija de la página, no de la IA. Hay tests que intentan inyectar HTML y scripts en la respuesta y verifican que se muestren como texto. Si algún día la página imprime algo de afuera como HTML, esta nota deja de ser cierta y hay que revisar la CSP antes. Hay tests que verifican que `site.js` no use `innerHTML` ni `eval`, y que un intento de XSS en el formulario no se ejecute.
