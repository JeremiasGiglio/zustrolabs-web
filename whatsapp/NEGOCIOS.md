# App de negocios (negocios.zustrolabs.com) · ZL-121

Donde cada negocio cliente carga lo que vende y donde el asistente mira **antes** de contestar por Instagram (y, más
adelante, por WhatsApp). Vive en el Worker `zustrolabs-whatsapp`, igual que el panel `equipo.zustrolabs.com`.

## Qué hace

Desde ZL-148 el negocio ve **tres secciones** (en el celular, una barra abajo): Inicio, Productos y Conexiones. El
equipo ve además Asistente y Admin.

| Sección | Quién | Qué |
|---|---|---|
| Inicio | el negocio y el equipo | Lo que el asistente le deja al negocio, con cuántas consultas y pedidos esperan. **Consultas** (ZL-146): nombre, resumen y botón **Responder** (abre esa charla: `wa.me` o Instagram). «La atiendo yo» calla al asistente en esa charla las horas de la ficha; si está callado, se ve hasta cuándo y «Devolver al asistente» lo vuelve a encender. Quien quería avanzar se cierra con Ganada o Perdida; un pase a una persona (reclamo, duda), con Resuelto. **Pedidos** (si están encendidos): Aceptar con un toque (cuánto se guarda sin pagar sale de «Cómo vendés»), Entregado como botón principal, «Ya pagó» opcional, Rechazar o Cancelar con motivo (dos toques). Cada cambio le llega al comprador por su chat; el de «aceptado» lleva cómo pagar y cómo retirar o recibir. Mira cada 20 segundos; con «Activar sonido y avisos», suena y avisa. |
| Productos → Lista | el negocio y el equipo | Alta y edición (nombre, código, categoría, descripción, precio, unidad, stock, foto), a la venta o pausado, stock con − y +, búsqueda, exportar a Excel (CSV con «;», como lo abre Excel en Argentina). |
| Productos → Importar Excel | el negocio y el equipo | .xlsx o .csv leídos en el navegador (sin librerías). Reconoce las columnas por el título, se pueden corregir, **muestra qué va a pasar** antes de guardar, y actualiza por código o por nombre, o reemplaza (lo que no viene se **pausa**, no se borra). Hasta 3.000 filas por vez. Planilla modelo para bajar. |
| Productos → Historial | el negocio y el equipo | Cada cambio de stock, precio o producto, con el correo de quién lo hizo y cuándo (en el celular, en tarjetas). |
| Conexiones → Estado | el negocio y el equipo | El semáforo (ZL-150): ficha, canales, cuentas, números y productos, con qué hacer si algo está en rojo. No corre la charla de prueba (no gasta IA). |
| Conexiones → WhatsApp | el negocio y el equipo | El negocio conecta su número de WhatsApp Business solo: pasos de YCloud (coexistencia), su número y su clave de API, «Conectar». Ve si está conectado, el último mensaje y si se calla cuando contesta él; «Desconectar». La clave no se vuelve a mostrar (ZL-136). |
| Conexiones → Instagram | el negocio y el equipo | El negocio pide la invitación con su usuario, la acepta en Instagram y aprieta «Conectar Instagram» (app compartida de Zustro Labs, sin Facebook). En Admin aparece el pedido con el enlace a Meta y «Invitación enviada» (ZL-137, `INSTAGRAM_CLIENTES.md`). |
| Conexiones → Cómo vendés | el negocio y el equipo | Lo carga el negocio (ZL-148): si hace retiro, envío o los dos; dónde y cuándo se retira; zonas, costo y horarios de envío; cómo se paga; cuánto se guarda un pedido aceptado sin pagar (2 h, 24 h, 48 h o 7 días). |
| Asistente | solo el equipo | La ficha del negocio (la misma de `fichas/PLANTILLA.md`) **por formulario** o en Markdown (ZL-150): empezar desde una **plantilla por rubro** (comercio con pedidos, servicios con consultas, turnos) o **armarla desde la web** del negocio (la IA lee la página y propone; lo que falta queda como [COMPLETAR …]). **Revisar todo** marca lo que choca con el sistema y corre 7 charlas de prueba (precio, objeción, cierre, pase, reclamo, fuera de tema). Activarla y una charla de prueba con los productos cargados. **El negocio no edita la ficha**: lo suyo (entrega, pago) va en «Cómo vendés». |
| Admin | solo el equipo | Nuevo negocio, quiénes entran (correos), **qué canales contrató (Instagram, WhatsApp o los dos)**, pedidos por chat, qué cuentas de Instagram son suyas, tope diario de respuestas de la IA y cuánto usó hoy y en el mes. Con un canal apagado, el asistente no responde por ahí (registro `canal_apagado`). |

## Cómo está armado (y por qué)

- **Una base por negocio.** Cada negocio tiene su propio Durable Object «Catalogo» (SQLite): productos, fotos e historial
  de un negocio nunca están en la misma base que los de otro. Gratis en el plan de Cloudflare (5 GB en total, 100.000
  escrituras por día; una importación de 1.000 filas son unas 2.000).
- **El registro** (nombre, correos, cuentas, ficha, uso) está en el Durable Object `Atencion` que ya existía.
- **Quién ve qué.** Cloudflare Access pide el correo y manda un código. El Worker verifica el token y decide: el equipo
  (`PANEL_EMAILS`) ve todos los negocios; cualquier otro correo, **solo** los negocios donde está. Pedir el negocio de
  otro responde «no existe» (no se revela qué negocios hay).
- **Los cambios** piden la cabecera `x-zl: 1` y el mismo origen: otra página no puede mandar pedidos con la sesión.
- **La IA solo lee.** Antes de cada respuesta, el Worker busca en el catálogo del negocio dueño de la cuenta que recibió
  el mensaje (todo, si hay hasta 150 productos activos; si no, los 40 que más se parecen al mensaje). Lo agotado va
  marcado «AGOTADO: no ofrecer»; los precios van solo si la ficha dice «Precios: sí», y son los únicos (con los de la
  ficha) que la respuesta puede nombrar: cualquier otro monto se saca antes de mandar.
- **Tope por negocio.** Cada negocio tiene su tope diario de respuestas de la IA (300 por defecto): uno con mucho
  movimiento no deja sin respuesta a los demás. El uso queda contado por día (sirve para facturar).
- **Fotos.** Se achican en el navegador (800 px, webp) y se guardan en la base del negocio (hasta 600 KB; se revisan los
  primeros bytes: solo webp, jpeg o png). Por ahora se ven en la app; mandarlas por chat es la etapa siguiente.

## Puesta en marcha (una sola vez)

1. **Unir el PR.** La Action `Publicar` publica el Worker y crea el dominio `negocios.zustrolabs.com` sola. Hasta el paso
   3, la app responde «Todavía no está configurado» (503): nunca queda abierta.
2. **La app de Access.** Cloudflare → Zero Trust → Access → Applications → Add an application → Self-hosted:
   - Application name: `Negocios`; Session duration: 1 week (que el negocio no tenga que entrar todos los días).
   - Public hostname: `negocios.zustrolabs.com`.
   - Policy: nombre `Negocios y equipo`, Action **Allow**, Include → **Emails** → tu correo y el de cada persona de cada
     negocio. Login method: **One-time PIN** (el código por mail).
   - Guardar. En la app creada, **Overview → Application Audience (AUD) Tag**: copiarlo.
3. **La audiencia en el Worker.** El AUD del paso 2 y el dominio del equipo de Access van en `whatsapp/wrangler.toml`
   (`NEGOCIOS_ACCESS_AUD`, `ACCESS_TEAM_DOMAIN`; hecho el 3/11/2026, ZL-122). **No** cargarlos como variables de texto en
   el panel de Cloudflare: cada deploy reemplaza las variables de texto por las del archivo. El correo del equipo sí va
   como **secreto** (no se borra): Workers & Pages → `zustrolabs-whatsapp` → Settings → Variables and Secrets → Add →
   Type **Secret** → `PANEL_EMAILS` = tu correo (varios, separados por coma) → Deploy.
4. **Access automático (ZL-138), una sola vez.** Para que los correos de cada negocio se agreguen solos a la política:
   - Cloudflare → My Profile → API Tokens → Create Token → Custom token. Nombre: `zustrolabs-whatsapp Access`.
     Permiso: **Account → Access: Apps and Policies → Edit**, solo esa cuenta. Sin vencimiento o con recordatorio.
   - Workers & Pages → `zustrolabs-whatsapp` → Settings → Variables and Secrets → Add → Type **Secret**:
     `CF_API_TOKEN` = el token, y `CF_ACCOUNT_ID` = el Account ID (está en la página principal de la cuenta) → Deploy.
   - Sin estos dos, todo funciona igual, pero al guardar un negocio te avisa qué correos agregar a mano. Solo agrega:
     sacar un correo de Access sigue siendo a mano.
5. Entrar a https://negocios.zustrolabs.com con tu correo → pestaña **Administración**.

## Alta de un cliente

Antes de la primera, leer [`FALLAS_Y_PREVENCION.md`](FALLAS_Y_PREVENCION.md): lo que ya nos falló y cómo evitarlo.

**Lo normal (ZL-138):** `whatsapp\scripts\alta.ps1` hace todo en 10 a 15 minutos: el negocio y sus correos (que van
solos a Access), la ficha del negocio con charla de prueba, Instagram (app compartida o la del cliente), WhatsApp (el
cliente desde la app o con su clave), los productos y, al final, **el semáforo** (`GET /api/instagram/admin/negocios/<id>/verificar`):
revisa Access, ficha, cuentas, números, que el webhook apunte a zustrolabs.com, productos y una charla de prueba, y dice
qué hacer con cada cosa en rojo. `.\alta.ps1 -Verificar` corre solo el semáforo (para un cliente que dice que no anda).
Deja copiado el mensaje de bienvenida para el cliente. A mano, en la app:

1. **Administración → Nuevo negocio:** nombre y correos de quienes van a entrar.
2. **Access:** con `CF_API_TOKEN` se agregan solos al guardar; si no, Administración avisa cuáles agregar a mano en la política de la app «Negocios».
3. **Instagram:** lo normal, el cliente lo hace desde su pestaña Instagram (ZL-137; nosotros lo agregamos como evaluador
   con `scripts\instagram-app-clientes.ps1 -Invitaciones`). Si no, conectar la cuenta con `scripts/instagram-cliente.ps1` (ver `INSTAGRAM_CLIENTES.md`) y, en
   Administración, marcar esa cuenta en el negocio → Guardar.
4. **Productos:** el cliente sube su Excel (Importar Excel) o los carga a mano.
5. **Asistente:** pegar la ficha completa, Revisar, probar la charla (usa los productos) y Guardar con «Activa».
6. Prueba real desde otra cuenta de Instagram.

## Varios idiomas (ZL-126)

En la ficha, «Idioma: castellano, inglés, croata» (el primero es el principal). Con más de uno, el primer mensaje de
cada persona pregunta en cuál seguir (1, 2, 3, el nombre o la bandera) y el saludo, el menú y sus respuestas salen en
ese idioma; por cada idioma que no es el principal van «## Saludo (inglés)» y «## Menú (inglés)» con las mismas
opciones (son textos fijos, sin IA: la plantilla lo explica al final). El idioma del mensaje manda (ZL-127): el sistema lo
reconoce por sus palabras, sin IA, y le ordena a la IA responder en ese; un saludo en otro idioma también lo cambia.
IDIOMA vuelve a preguntar. Con un solo idioma no se pregunta nada. La charla de
prueba de la pestaña Asistente sigue entre mensajes (idioma, PERSONA) y se reinicia con «Reiniciar charla».

## La cuenta de Instagram del estudio (ZL-124)

@zustrolabs (conectada con la app de Meta del estudio) responde con lo de la landing, salvo que esté **vinculada a un
negocio con la ficha activa**: entonces responde con esa ficha y su catálogo, igual que un cliente. PERSONA sigue yendo al
panel del equipo (`equipo.zustrolabs.com`) con aviso por correo, y el chat de la landing y el WhatsApp del estudio no
cambian. Para usarlo:

1. **Administración → el negocio ZustroLabs** → marcar la cuenta «(cuenta del estudio)» → Guardar.
2. **Productos:** cargarlos (por ejemplo, Importar Excel).
3. **Asistente:** la ficha de Zustro Labs (con «Precios: no», por el HZZ), Revisar, probar y Guardar con «Activa».

Volver atrás = apagar la ficha o desmarcar la cuenta: vuelve a responder con lo de la landing, nunca queda muda. Con la
ficha vinculada pero apagada, el registro dice `estudio_ficha_inactiva` (o `estudio_sin_ficha`, `estudio_ficha_invalida`,
`estudio_canal_apagado` si el negocio tiene Instagram apagado: a diferencia de un cliente, la del estudio no se calla).
Ojo: con la ficha activa, el asistente sabe **solo** lo que dicen la ficha y el catálogo (no el equipo ni la historia de
la landing, salvo que estén en la ficha).

## Pedidos por chat (ZL-139)

Se encienden por negocio en **Administración → «Pedidos por chat»** (apagados de entrada). La regla: **la IA propone,
el código decide**. La IA solo devuelve qué productos (la `ref` de cada uno en el catálogo) y cuántos; el código
(`src/pedidos.js`, `src/pedidos-charla.js`) valida cada producto, reserva el stock, calcula precios y total, y hace
las preguntas fijas (retiro o envío, nombre, dirección). El pago lo marca solo el negocio.

| Momento | Stock | Cuánto dura |
|---|---|---|
| El comprador arma el carrito | Se **reserva** (no baja: el disponible sí) | **20 minutos** sin confirmar; después se libera solo |
| Confirma (SÍ → retiro/envío → nombre → dirección) | Sigue reservado, con número de pedido | **2 horas** para que el negocio lo acepte |
| El negocio lo acepta | Sigue reservado | Lo que elija el negocio: 2 h, 24 h (de entrada), 48 h o 7 días sin pagar |
| Marca pagado | Sigue reservado | No vence |
| Marca entregado | **Baja de verdad** (queda en el Historial) | — |
| Rechazado, cancelado o vencido | Vuelve a estar disponible | — |

- Lo agotado (contando reservas) no entra al carrito y el asistente lo dice («quedan 2», «no queda»). Si un cambio no se
  puede, el carrito queda como estaba.
- CANCELAR anula el carrito; PEDIDO lo muestra. Mientras se pregunta retiro o envío, 1 y 2 son eso (no el menú).
- Con «Precios: no» en la ficha, el resumen no muestra montos («el total te lo confirma el negocio»).
- El stock no puede bajar de lo reservado, ni se puede borrar un producto reservado (se pausa).
- Las reservas vencen al consultar cualquier cosa del catálogo y con una alarma del Durable Object.
- La charla de prueba de la pestaña Asistente no arma pedidos (no reserva stock de verdad).

## Charla natural y cierre (ZL-146)

- **Un mensaje por respuesta** (Meta cobra cada mensaje): saludo, presentación y menú van juntos.
- **Memoria corta:** la IA ve los últimos 8 mensajes de las últimas 48 h y, entre `<cliente>`, el nombre y un resumen de
  la persona (90 días). Quien ya conocemos y saluda no recibe el menú fijo: la IA lo saluda y retoma lo que charlaron.
  En un pedido, si ya sabemos el nombre, no se lo vuelve a preguntar. BORRAR lo borra todo.
- **Objetivo de la ficha:** `pedidos` (arma el pedido y el negocio lo confirma) o `consultas` (cuando la persona quiere
  avanzar, la IA marca `avanzar`, el código pide el nombre una sola vez y registra la consulta). **Cómo vendemos**: las
  pautas del negocio para guiar la venta.
- **La persona del negocio entra sola** cuando la pide, hay un reclamo, la IA no tiene la respuesta o se llegó al tope
  del día: el asistente se calla las horas de pausa y la charla queda en «Pedidos y consultas». Nunca se le pide a la
  persona que escriba PERSONA (la palabra igual funciona).
- Las consultas viven en la base del negocio (`src/consultas.js`): una abierta por charla, sin el texto de la charla.

## Charla completa (ZL-149)

- **Audios:** se transcriben con Whisper en Workers AI (binding `AI`; gratis hasta 10.000 neuronas por día, unos 210
  minutos) y se responden como texto. El audio no se guarda. Si no se entiende, el asistente pide repetirlo.
- **Ráfagas:** quien manda varios mensajes seguidos recibe una sola respuesta. Cada mensaje se suma en el Durable
  Object (`sumarRafaga`) y, después de 6 segundos, solo el último la toma entera (`tomarRafaga`).
- **Botones:** el menú, el «¿Lo confirmamos?» y «¿Retiro o envío?» van con botones (hasta 3) o una lista (WhatsApp por
  YCloud) y respuestas rápidas (Instagram). Al tocarlos llega el id, que vale como escribirlo. Si YCloud no acepta el
  interactivo, va el texto con las opciones numeradas.
- **Cómo vendés en la charla:** el asistente sabe retiro, envío y pago; si el negocio solo hace retiro o solo envío,
  el pedido no lo pregunta; la pregunta de entrega dice dónde, cuándo y cuánto.
- **Pase con red:** cuando el asistente le pasa la charla al equipo (o la persona escribe PERSONA), se calla 15
  minutos. Si nadie la tomó (no respondió desde su app ni tocó «La atiendo yo»), vuelve y lo dice una vez («Mientras el
  equipo te responde, sigo yo»). Si la tomó, se calla las horas de la ficha.

## Que no se escape ninguna venta (ZL-151)

- **Avisos al celular:** Web Push estándar (`src/push.js`, RFC 8291 + VAPID), sin servicios de terceros. Las claves
  VAPID se crean solas y viven en el Durable Object. En Inicio, «Avisos en este celular» pide permiso, suscribe el
  celular (`/api/n/<id>/push`) y manda uno de prueba. Llega un aviso por cada pedido nuevo, cada consulta que quiere
  avanzar y cada pase al equipo, sin nombres ni números en la pantalla bloqueada. La app se instala en la pantalla de
  inicio (manifiesto, ícono con el damero y service worker); en iPhone, los avisos andan solo con la app instalada.
- **Seguimiento con permiso:** si una consulta queda sin nombre, un recordatorio a las 2 h; si un carrito queda sin
  confirmar, a los 10 minutos (se guarda 20). Solo dentro de las 24 h del último mensaje, sin BAJA y sin alguien del
  negocio atendiendo, como mucho dos por charla. Cada mensaje dice cómo cortarlo (BAJA). Lo manda el cron de cada 10
  minutos (`seguimientos()` en `index.js`, índice `seg:` en el Durable Object).
- **Números para el dueño:** en Inicio, los últimos 7 días: charlas atendidas, consultas, pedidos y ventas cerradas
  (consultas ganadas más pedidos entregados, con el total vendido). `GET /api/n/<id>/numeros`.

## Lo que falta (próximas etapas)

- **Pedidos, etapa 2:** avisos al celular con la app cerrada (Web Push), aviso por correo de pedido nuevo, el alias
  de pago en el mensaje de «aceptado», y avisarle al comprador cuando su pedido vence.
- **Fotos por chat** y **planilla de Google en vivo**.
- **Privacidad:** cuando haya pedidos se guardan datos de los compradores: hace falta una política modelo para cada
  negocio (responsable: el negocio; Zustro Labs procesa por cuenta de él) y el plazo de borrado.

## WhatsApp de cada cliente (ZL-135)

Cada cliente conecta su número de WhatsApp Business a **su propia cuenta gratis de YCloud** con coexistencia (sigue
usando su app y no pierde las charlas) y `scripts\whatsapp-cliente.ps1` lo conecta al Worker con la clave de API de
esa cuenta. Responde con la misma ficha y los mismos productos que Instagram, y se calla en una charla cuando el dueño
contesta desde su celular. Detalle en [`WHATSAPP_CLIENTES.md`](WHATSAPP_CLIENTES.md).

## Archivos

`src/catalogo.js` (base de un negocio) · `src/negocios.js` (API y permisos) · `src/negocios-ui.js` (la página) ·
`src/lector.js` (Excel y CSV) · `src/objeto.js` (Durable Objects) · tests en `test/catalogo.test.js`,
`test/negocios.test.js`, `test/lector.test.js` y, en un navegador, `tests/negocios.spec.ts`.
