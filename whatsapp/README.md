# WhatsApp e Instagram de Zustro Labs

Worker `zustrolabs-whatsapp`: un número propio del estudio y los mensajes directos de @zustrolabs, con el mismo asistente que «Preguntale a Zustro» y un panel para que alguien del equipo responda.

- **Webhook de WhatsApp:** `https://zustrolabs.com/api/whatsapp`, para la Cloud API de Meta.
- **Webhook de Instagram:** `https://zustrolabs.com/api/instagram`, para los mensajes directos; las cuentas se conectan en `/api/instagram/conectar` (ZL-111; ver «Instagram» más abajo).
- **Panel:** `https://equipo.zustrolabs.com`, detrás de Cloudflare Access. Muestra las charlas de los dos canales.
- **Cerebro:** `asistente/src/asistente.js` + `asistente/src/conocimiento.js`, con los mismos controles fijos: sin plata, sin palabras prohibidas, sin links ni correos ajenos, sin teléfonos. Solo se suma una nota de canal (`src/textos.js`).
- **Separado del Radar Croacia:** otra app de Meta, otro número, otra memoria y la clave de IA del estudio, nunca la del Radar. El código del panel y del webhook está adaptado del Radar (`radar-croacia/worker/src/`).

## Cómo funciona

| La persona escribe | Pasa esto |
|---|---|
| Lo primero que escriba | Saludo con emojis y tres botones de idioma (Español, Hrvatski, English). Al elegir: «¿Cómo estás?», quiénes somos y un menú de cinco cosas que puede lograr con el estudio (ZL-115). Tono de captación: sin aviso de privacidad ni lista de comandos en la charla; la política sigue en la página y en la app de Meta, y BORRAR sigue andando. |
| Un saludo («hola», «buenas», «hola, ¿cómo te va?») o «¿qué hacen?», «¿qué me ofrecés?», «info» | Presentación y menú, sin gastar IA, también si eligió idioma otro día. Si todavía no eligió idioma y saluda, se le repregunta; si pregunta qué hacemos, se toma el idioma de la pregunta. «Hablo en inglés», «prefiero castellano» o «na hrvatskom» cambian el idioma. |
| **1** a **5** (después del menú) | La explicación fija de esa opción, con lo que gana su negocio, una pregunta sobre su negocio y cómo pedir una persona. No gasta IA. |
| **MENÚ** / IZBORNIK / MENU | Vuelve a mostrar el menú. |
| Cualquier pregunta | Responde el asistente con lo publicado en la página, en tono cálido y con emojis: pregunta por el negocio, recomienda la solución que sirve y cierra con una pregunta. Si quiere avanzar, pregunta valores o algo que no sabe, le sugiere escribir PERSONA. |
| **PERSONA** / OSOBA / PERSON (también «asesor», «operador», «hablar con alguien») | El asistente se calla en esa charla y la charla aparece en el panel. Llega un aviso a `AVISO_PARA` sin número ni texto. Desde el panel se responde y, al terminar, se toca «Devolver al asistente». Si pasan 24 h sin mensajes, vuelve sola. |
| **BORRAR** / OBRIŠI / DELETE | Borra la memoria y la charla del panel. |
| **IDIOMA** / JEZIK / LANGUAGE | Vuelve a mostrar los botones de idioma (mientras elige, 1, 2 y 3 son idiomas). |
| Audio, foto o archivo | Pide que lo escriba. |

Por Instagram pasa lo mismo, con dos diferencias: no hay botones (el idioma se elige con 1, 2 o 3, con su nombre o con la bandera; si escribe otra cosa, sigue en castellano) y las respuestas salen en trozos de hasta 1000 caracteres, porque Instagram no acepta más por mensaje.

**Qué se guarda**
Todo va en un solo Durable Object, `Atencion` (`src/atencion.js`), con almacenamiento SQLite, que entra en el plan gratis. Una alarma diaria borra lo vencido.
- `{idioma, humanoHasta}` por número, durante 90 días. Nunca el texto.
- El id de cada mensaje, durante 1 h, para no contestar dos veces un reintento de Meta.
- Cuántas respuestas de la IA tuvo cada número en el día, durante 2 días.
- Solo las charlas con PERSONA, durante 30 días desde el último mensaje. En Instagram, además, el nombre de usuario de quien escribió PERSONA (para que el equipo sepa a quién responde).
- Las personas de Instagram se guardan como `ig:<cuenta>.<quien>`, así no se mezclan con los números de WhatsApp ni entre cuentas.
- Las cuentas de Instagram conectadas (id, usuario y token), sin vencimiento: el token se renueva solo.

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
1. Desde otro celular, escribile al número: tienen que aparecer el saludo y los botones de idioma; al tocar uno, la bienvenida y el menú.
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

Los mensajes directos de **@zustrolabs** (y, cuando corresponda, los de la cuenta de un cliente) entran por `https://zustrolabs.com/api/instagram` y se responden con la **Instagram API con inicio de sesión de Instagram** (`graph.instagram.com`): sin página de Facebook, sin usuario del sistema, sin scripts. Cada cuenta se conecta sola entrando con su Instagram en un link; el Worker guarda su token en el Durable Object, lo renueva cada 60 días y la suscribe a los avisos. Código en `src/instagram.js`; el resto (asistente, comandos, memoria, panel) es el mismo de WhatsApp.

### Puesta en marcha (una sola vez, Jeremías)
Todo en la app de Meta **Zustro Labs** (`4678708989064685`) → Use cases → Customize → **API setup with Instagram login**. Secretos nunca en el chat, en el repo ni en Jira.

1. **Claves de la app de Instagram.** En esa pestaña, paso «Generate access tokens» / «Set up Instagram business login», aparecen el **Instagram app ID** y el **Instagram app secret** (son otros que los de la app de Facebook). El id va en `wrangler.toml` como `IG_APP_ID` (PR); el secret, en Cloudflare como `IG_APP_SECRET` (reemplaza al de Facebook si estaba cargado).
2. **Vuelta del login.** En «Business login settings» → OAuth redirect URIs, agregá `https://zustrolabs.com/api/instagram/conectar/vuelta`.
3. **Webhooks**, en la misma pestaña (no en el producto Webhooks general): Callback URL `https://zustrolabs.com/api/instagram`, Verify token = el secreto `IG_VERIFY_TOKEN`, y suscribí el campo **messages**.
4. **Secretos** en Cloudflare (Workers & Pages → `zustrolabs-whatsapp` → Settings → Variables and Secrets): `IG_APP_SECRET`, `IG_VERIFY_TOKEN`, `IG_CONECTAR_CLAVE` (una frase larga inventada: es la clave del link de conexión) y, si no estaban, `ANTHROPIC_API_KEY` y `AVISO_PARA`.
5. **Privacidad y Live:** `https://zustrolabs.com/privacidad/` como Privacy Policy URL y la app en **Live** (ya está).

### Conectar una cuenta (la del estudio o la de un cliente)
1. La persona entra a Instagram en el navegador con la cuenta profesional que quiere conectar y, en esa cuenta, tiene activado Configuración → Mensajes → Herramientas conectadas → **Permitir acceso a los mensajes**.
2. Abre `https://zustrolabs.com/api/instagram/conectar?clave=<IG_CONECTAR_CLAVE>` (el link se lo mandamos nosotros; sin la clave no hace nada).
3. Instagram le pide confirmar los permisos (`instagram_business_basic`, `instagram_business_manage_messages`) → acepta → ve «Listo: la cuenta @… quedó conectada y suscripta».
4. Desde ese momento el asistente responde en esa cuenta. Para desconectarla: la persona quita la app desde Instagram (Configuración → Apps y sitios web) o nosotros borramos la cuenta del Durable Object.

### Cosas que conviene saber
- **Acceso estándar vs avanzado.** Con el acceso estándar (el de toda app nueva) Meta deja atender las cuentas que el portafolio **posee o administra**: @zustrolabs. Para la cuenta de un cliente hace falta **acceso avanzado** a `instagram_business_manage_messages`: App Review y, casi siempre, verificación del negocio con CUIT. Está pendiente de decidir con qué CUIT.
- La ventana para responder es de **24 h** desde el último mensaje de la persona, como en WhatsApp. Meta deja 7 días con la etiqueta de agente humano, pero pide revisión de la app: queda para más adelante.
- Los tokens duran 60 días; el cron diario (`[triggers]`) los renueva cuando quedan menos de 15 y comprueba la suscripción de cada cuenta. En Observability se ve como `"que":"mantenimiento"`.
- Cada aviso de Meta deja un registro `"que":"aviso"` (forma y cantidad, sin ids ni texto); una firma inválida, `"que":"firma"`; un mensaje para una cuenta no conectada, `"que":"cuenta_desconocida"`.
- Instagram no manda botones, así que el saludo y los comandos van en texto. No se bajan las fotos ni los audios: solo se lee texto.
- Las personas se guardan como `ig:<cuenta>.<quien>`: la misma persona escribiendo a dos cuentas son dos charlas distintas.

## Costos
- **WhatsApp e Instagram:** responder dentro de las 24 h de que la persona escribió es gratis.
- **Cloudflare:** Workers, Durable Objects (SQLite) y Access en planes gratis. No usa KV.
- **IA:** cada respuesta va con la clave propia del canal, que tiene su límite mensual. Los topes de 30 por minuto y 40 por número y por día frenan los picos.

## Desarrollo
- Tests: `npm test` acá, o `npm run test:worker` en la raíz, que también corre los del formulario y el asistente. No usan red: Meta, el modelo y el correo se simulan.
- Si cambia `asistente/src/conocimiento.js`, este canal lo toma en la próxima publicación de este Worker.
