# WhatsApp e Instagram de Zustro Labs

Worker `zustrolabs-whatsapp`: un número propio del estudio y los mensajes directos de @zustrolabs, con el mismo asistente que «Preguntale a Zustro» y un panel para que alguien del equipo responda.

- **Webhook de WhatsApp:** `https://zustrolabs.com/api/whatsapp`, para la Cloud API de Meta.
- **Webhook de Instagram:** `https://zustrolabs.com/api/instagram`, para los mensajes directos (ZL-111; ver «Instagram» más abajo).
- **Panel:** `https://equipo.zustrolabs.com`, detrás de Cloudflare Access. Muestra las charlas de los dos canales.
- **Cerebro:** `asistente/src/asistente.js` + `asistente/src/conocimiento.js`, con los mismos controles fijos: sin plata, sin palabras prohibidas, sin links ni correos ajenos, sin teléfonos. Solo se suma una nota de canal (`src/textos.js`).
- **Separado del Radar Croacia:** otra app de Meta, otro número, otra memoria y la clave de IA del estudio, nunca la del Radar. El código del panel y del webhook está adaptado del Radar (`radar-croacia/worker/src/`).

## Cómo funciona

| La persona escribe | Pasa esto |
|---|---|
| Lo primero que escriba | Tres botones de idioma (Español, Hrvatski, English), con el link a la privacidad y BORRAR. Al elegir, la bienvenida con los comandos y qué se guarda. |
| Cualquier pregunta | Responde el asistente con lo publicado en la página. Si la persona quiere un proyecto o algo que el asistente no sabe, le sugiere escribir PERSONA. |
| **PERSONA** / OSOBA / PERSON | El asistente se calla en esa charla y la charla aparece en el panel. Llega un aviso a `AVISO_PARA` sin número ni texto. Desde el panel se responde y, al terminar, se toca «Devolver al asistente». Si pasan 24 h sin mensajes, vuelve sola. |
| **BORRAR** / OBRIŠI / DELETE | Borra la memoria y la charla del panel. |
| **IDIOMA** / JEZIK / LANGUAGE | Vuelve a mostrar los botones de idioma. |
| Audio, foto o archivo | Pide que lo escriba. |

Por Instagram pasa lo mismo, con dos diferencias: no hay botones (el idioma se elige escribiendo «Español», «Hrvatski» o «English»; si escribe otra cosa, sigue en castellano) y las respuestas salen en trozos de hasta 1000 caracteres, porque Instagram no acepta más por mensaje.

**Qué se guarda**
Todo va en un solo Durable Object, `Atencion` (`src/atencion.js`), con almacenamiento SQLite, que entra en el plan gratis. Una alarma diaria borra lo vencido.
- `{idioma, humanoHasta}` por número, durante 90 días. Nunca el texto.
- El id de cada mensaje, durante 1 h, para no contestar dos veces un reintento de Meta.
- Cuántas respuestas de la IA tuvo cada número en el día, durante 2 días.
- Solo las charlas con PERSONA, durante 30 días desde el último mensaje. En Instagram, además, el nombre de usuario de quien escribió PERSONA (para que el equipo sepa a quién responde).
- Las personas de Instagram se guardan como `ig:<id>`, así no se mezclan con los números de WhatsApp.

Por qué un Durable Object y no KV:
- atiende de a un pedido por vez, así dos mensajes que llegan juntos no se pisan en el panel;
- no gasta la cuota gratis de escrituras de KV, que es de toda la cuenta y la usa el bot del Radar.

**Registros**
- Solo métricas: qué pasó, idioma, tokens y el motivo si el aviso no salió. Ni número ni texto.
- Los registros automáticos de cada pedido están apagados, porque la ruta del panel lleva el número.

**Límites**
- 20 mensajes por minuto por número o cuenta de Instagram. Pasado eso, silencio.
- 30 respuestas de la IA por minuto en total, entre los dos canales. Pasado eso, el asistente avisa que hay muchas consultas y sugiere PERSONA. No corta la atención humana ni BORRAR.
- 40 respuestas de la IA por persona y por día (`TOPE_DIARIO`). Pasado eso, sugiere PERSONA.
- Sin los límites configurados, no contesta.

**Controles de más para WhatsApp**
WhatsApp vuelve link cualquier cosa con forma de dominio. Por eso, además de los controles de la página, se saca cada oración que tenga:
- un dominio que no sea de zustrolabs.com;
- plata dicha sin moneda: lucas, mangos, porcentajes, descuentos, señas.

## Puesta en marcha

Lo hace Jeremías. Los secretos nunca van en el chat, en el repo ni en Jira.

### 1. La línea
1. Sacá una línea prepaga nueva, mejor como **eSIM** (Personal, Claro o Movistar), con tu DNI.
2. **No la registres en WhatsApp**, ni en la app común ni en Business. Si ya está registrada, borrá esa cuenta de WhatsApp antes de seguir.
3. Mantenela activa con alguna recarga: Meta puede volver a pedir el código por SMS.

### 2. Meta
Todo va en el portfolio **Zustro Labs** (`1813300213155448`), sin tocar la cuenta de WhatsApp ni la app del Radar. Los menús de Meta cambian seguido: si algo no está donde dice, buscalo por el nombre.
1. **App nueva:** en developers.facebook.com → My Apps → Create app, elegí el caso de uso de WhatsApp. Nombre: «Zustro Labs WhatsApp». Portfolio: Zustro Labs.
2. **Cuenta de WhatsApp nueva y número:**
   - en la app, WhatsApp → API Setup → **Add phone number**;
   - creá ahí la cuenta «Zustro Labs», separada de «Radar Croacia»;
   - poné el nombre visible **Zustro Labs** (Meta tiene que aprobarlo) y verificá con el SMS;
   - anotá dos ids que no son secretos y se los pasás a Claude: el **Phone number ID** y el **WhatsApp Business Account ID** (`waba-id`, en WhatsApp Manager → la cuenta → información).
3. **Token:**
   - en Business settings → Users → System users, creá «Zustro WhatsApp»;
   - asignale la app nueva y la cuenta de WhatsApp nueva, con control total;
   - generá un token para la app nueva con `whatsapp_business_messaging` y `whatsapp_business_management`, sin vencimiento.
4. **Registro en la Cloud API:**
   - en el Graph API Explorer, con ese token, hacé `POST /{phone-number-id}/register` con `messaging_product=whatsapp` y un PIN de 6 dígitos que inventes;
   - el PIN guardalo vos: es la verificación en dos pasos del número.
5. **App secret:** está en App settings → Basic.
6. **Privacidad y Live:**
   - antes hay que publicar la página de privacidad (`https://zustrolabs.com/privacidad/`, va en su propio PR);
   - después, en App settings → Basic, poné esa URL como Privacy Policy URL y pasá la app a **Live**. Sin eso, Meta no manda los mensajes reales.

### 3. Cloudflare
La memoria no necesita ningún paso: el Durable Object se crea solo al publicar.

1. **Access:** en Zero Trust → Access → Applications → Add → Self-hosted.
   - Nombre: «Panel Zustro». Dominio: `equipo.zustrolabs.com`. Sesión: 24 h.
   - Política «Equipo Zustro», Allow → Include → Emails, con los correos de quienes atienden.
   - Pasale a Claude el **Application Audience (AUD) Tag**. El team domain es el mismo del Radar.
2. **Segundo PR (lo hace Claude):** `WHATSAPP_PHONE_NUMBER_ID`, `ACCESS_TEAM_DOMAIN` y `ACCESS_AUD` en `wrangler.toml`.
3. **Secretos:** desde `whatsapp/` (`npm ci` la primera vez), con `npx wrangler secret put <NOMBRE>`, cada uno:
   - `ANTHROPIC_API_KEY`: una **clave nueva** del estudio, solo para este canal, con su propio límite de gasto mensual en la consola de Anthropic. No la del Radar. Tampoco la del asistente de la página: si este canal llega al límite, la página sigue andando;
   - `WHATSAPP_TOKEN`: el del paso 2.3;
   - `WHATSAPP_APP_SECRET`: el del paso 2.5;
   - `WHATSAPP_VERIFY_TOKEN`: una frase larga que inventes, para el paso 5;
   - `PANEL_EMAILS`: los mismos correos de la política de Access, separados por coma;
   - `AVISO_PARA`: `contact@zustrolabs.com`, que ya está verificada en Email Routing.
4. **Publicar:** `npx wrangler deploy`. Crea `equipo.zustrolabs.com`, la ruta `/api/whatsapp` y el Durable Object.

### 4. Conectar el webhook
1. En la app de Meta → WhatsApp → Configuration → Webhook:
   - Callback URL `https://zustrolabs.com/api/whatsapp`;
   - Verify token: el de `WHATSAPP_VERIFY_TOKEN`;
   - Verify and save.
2. En Webhook fields, suscribite a **messages**.
3. Suscribí la app a la cuenta de WhatsApp: en el Graph API Explorer, con el token del paso 2.3, `POST /{waba-id}/subscribed_apps`.

### 5. Prueba
1. Desde otro celular, escribile al número: tienen que aparecer los botones de idioma.
2. Preguntá «¿qué hacen?»: responde el asistente.
3. Escribí PERSONA:
   - llega el aviso a contact@;
   - la charla aparece en `equipo.zustrolabs.com`;
   - respondé desde ahí y tocá «Devolver al asistente».
4. Escribí BORRAR: la charla desaparece del panel.

**Si el aviso no llega**
- En Observability del Worker buscá `"que":"persona"`. `avisoError: "sin_config"` quiere decir que falta `AVISO_PARA`.
- Otro nombre de error casi siempre significa que el destino no está verificado en Email Routing.

## Instagram

Los mensajes directos de **@zustrolabs** entran por `https://zustrolabs.com/api/instagram` y se responden desde la página de Facebook «Zustro Labs» a la que está vinculada la cuenta (app de Meta **Zustro Labs**, `4678708989064685`, variante «Instagram API con inicio de sesión de Facebook»). Código en `src/instagram.js`; el resto (asistente, comandos, memoria, panel) es el mismo de WhatsApp.

Lo que hay que hacer una vez (Jeremías; secretos nunca en el chat, en el repo ni en Jira):

1. **Página de privacidad publicada:** `https://zustrolabs.com/privacidad/` tiene que estar en línea (Pages) y cargada en la app → App settings → Basic → Privacy Policy URL.
2. **Permisos del token:** en Business settings → Users → System users → `zustro-redes`, con la app Zustro Labs, la página Zustro Labs y la cuenta de Instagram zustrolabs asignadas, generá un token **sin vencimiento** con `instagram_basic`, `instagram_manage_messages`, `pages_messaging`, `pages_manage_metadata` y `pages_show_list`.
3. **Ids y suscripción de la página**, desde `whatsapp/`:
   ```
   IG_TOKEN='el token' node scripts/instagram-suscribir.mjs
   ```
   Imprime `IG_ID` e `IG_PAGE_ID` (van en `wrangler.toml`, en un PR), suscribe la página a los avisos de mensajes y, si el token que pasaste es de usuario, muestra el **token de página** que necesita el Worker.
4. **Secretos:** `npx wrangler secret put` para `IG_TOKEN` (el de página del paso 3), `IG_APP_SECRET` (App settings → Basic → App secret de la app Zustro Labs, no el de la de WhatsApp) e `IG_VERIFY_TOKEN` (una frase larga que inventes).
5. **Publicar:** `npx wrangler deploy` (crea la ruta `/api/instagram` y el cron).
6. **Webhook en Meta:** en la app → Webhooks → elegí **Instagram** → Callback URL `https://zustrolabs.com/api/instagram`, Verify token el de `IG_VERIFY_TOKEN`, «Verify and save», y suscribí el campo **messages**.
7. **La cuenta:** en la app de Instagram → Configuración → Mensajes y respuestas a historias → Herramientas conectadas → **Permitir el acceso a los mensajes** (si no, Meta no manda nada).
8. **Live:** App settings → Basic → cambiar el modo a **Live**. Mientras esté en desarrollo, solo llegan los mensajes de la gente con rol en la app.
9. **Prueba:** desde otra cuenta de Instagram, escribí a @zustrolabs: tiene que llegar el saludo con los idiomas. Después, PERSONA → la charla aparece en el panel marcada «Instagram» con el usuario.

Cosas que conviene saber:
- La ventana para responder es de **24 h** desde el último mensaje de la persona, como en WhatsApp. Meta deja 7 días con la etiqueta de agente humano, pero pide una revisión de la app: queda para más adelante.
- Un cron diario (`[triggers]` en `wrangler.toml`) revisa que la página siga suscripta a los avisos y la vuelve a suscribir si hace falta. En Observability se ve como `"que":"suscripcion"`.
- Instagram no manda botones, así que el saludo y los comandos van en texto.
- No se bajan las fotos ni los audios: solo se lee texto.

## Costos
- **WhatsApp e Instagram:** responder dentro de las 24 h de que la persona escribió es gratis.
- **Cloudflare:** Workers, Durable Objects (SQLite) y Access en planes gratis. No usa KV.
- **IA:** cada respuesta va con la clave propia del canal, que tiene su límite mensual. Los topes de 30 por minuto y 40 por número y por día frenan los picos.

## Desarrollo
- Tests: `npm test` acá, o `npm run test:worker` en la raíz, que también corre los del formulario y el asistente. No usan red: Meta, el modelo y el correo se simulan.
- Si cambia `asistente/src/conocimiento.js`, este canal lo toma en la próxima publicación de este Worker.
