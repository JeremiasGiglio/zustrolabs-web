# Seguridad — zustrolabs-web

Qué protege al sitio hoy, qué hay que activar una sola vez en Cloudflare y GitHub, y qué hacer si algo pasa. El sitio es estático: no hay servidor propio, base de datos ni cuentas de usuario, así que la superficie de ataque es chica. Lo que queda es proteger el dominio, el tráfico y el formulario.

## Lo que ya hace el sitio (está en el repo)

- **Sin servidor ni secretos.** HTML, CSS y JS servidos por Cloudflare Pages. No hay nada que "hackear" del lado nuestro: no hay login, no hay base de datos, no hay claves en el repo.
- **Cabeceras de seguridad** en `site/_headers`:
  - `Content-Security-Policy`: solo se cargan scripts, estilos, fuentes y conexiones de la lista (el propio sitio, Google Fonts, Cloudflare Web Analytics y FormSubmit). Nada de iframes (`frame-ancestors 'none'`), ni plugins (`object-src 'none'`), ni formularios que manden datos a otro lado (`form-action`).
  - `Strict-Transport-Security`: el navegador recuerda un año que el sitio es solo HTTPS, incluidos los subdominios.
  - `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` (cámara, micrófono, ubicación y pago bloqueados), `Cross-Origin-Opener-Policy`.
  - `upgrade-insecure-requests`: cualquier recurso `http://` se pide como `https://`.
- **Caché pensada para publicar sin sustos:** imágenes y videos una semana; `site.css` y `site.js` se revalidan en cada visita, así nadie ve estilos viejos después de un deploy.
- **Formulario de contacto:** va a FormSubmit por HTTPS, con un campo trampa (`_honey`) que descarta bots y sin pasar datos por la URL. Si el servicio falla, el visitante ve el correo y un link con el mensaje armado. FormSubmit aplica sus propios límites de envío.
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
- [ ] `hola@zustrolabs.com` tiene que ser una casilla real que alguien lea. Si es un alias, configurarlo en *Cloudflare → Email Routing* para que reenvíe a una casilla que se mire todos los días.
- [ ] El primer envío del formulario dispara un correo de activación de FormSubmit a `hola@`: **tocar "Activate"**. Hasta entonces, no llega nada.
- [ ] Si empieza a llegar spam por el formulario: activar en Cloudflare *Turnstile* (gratis, es su alternativa al captcha, sin molestar a las personas) y agregarlo al formulario. Hoy no está porque no hace falta y porque pide una clave de sitio; es la única mejora de esta lista que requiere configuración.

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
| Llega spam por el formulario | Primero *Bot Fight Mode* y la regla de rate limiting (arriba). Si sigue, Turnstile. |
| Alguien sin permiso entró a Cloudflare o GitHub | Cambiar la contraseña, revocar sesiones y tokens, revisar DNS y deployments recientes. Activar 2FA si no estaba. |
| Una clave tocó el repo por error | Revocarla en el servicio de origen **aunque ya se haya borrado del código**. El historial de git la conserva. |
| Un desconocido reporta una falla de seguridad | Responder desde hola@zustrolabs.com, agradecer, arreglar, no discutir. |

## Lo que no se hace
- No se agrega `'unsafe-eval'` a la CSP, ni se abren `frame-ancestors`, ni se permiten scripts de dominios fuera de la lista "para probar".
- No se instalan dependencias de producción: el sitio no tiene build y así se queda.
- No se guardan datos de visitantes en ningún lado nuestro. El formulario los manda y los olvida.
- No se pone el correo de contacto en la URL de nada.

## Nota técnica honesta
La CSP permite `'unsafe-inline'` en scripts y estilos porque el sitio tiene dos scripts cortos en línea (la elección del modo oscuro antes de pintar la página, y las frases que rotan en `/pantalla/`) y estilos en línea en un par de elementos. Quitarlo exigiría *nonces*, que un sitio estático sin build no puede generar. El riesgo es bajo: no hay entrada de usuario que se imprima en la página, así que no hay dónde inyectar un script. Si algún día la página imprime algo que escribió un visitante, esta nota deja de ser cierta y hay que revisar la CSP antes.
