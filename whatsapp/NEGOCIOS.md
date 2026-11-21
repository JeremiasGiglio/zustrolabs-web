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
| Reportes | el negocio y el equipo | (ZL-152) Día, semana o mes, con la hora del negocio: charlas, mensajes, respuestas, consultas (ganadas), pedidos, entregados, vendido y ticket promedio; a qué hora y qué días escriben (con las horas y los días pico); mensajes día por día; lo que más compran; WhatsApp contra Instagram. **Descargar Excel** (.xlsx con 7 hojas: Resumen, Por día, Por hora, Por día de la semana, Productos, Consultas, Pedidos) e **Imprimir o guardar PDF**. Cada mensaje se cuenta sin texto ni número (`negmet:` en el Durable Object, 120 días). La zona horaria se elige en «Cómo vendés». |
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
cada persona arranca en el idioma en que escribió, sin preguntar (ZL-153: preguntar en tres idiomas a quien dijo «hola»
no es natural); si no se reconoce, en el principal. El saludo, el menú y sus respuestas salen en ese idioma; por cada idioma que no es el principal van «## Saludo (inglés)» y «## Menú (inglés)» con las mismas
opciones (son textos fijos, sin IA: la plantilla lo explica al final). El idioma del mensaje manda (ZL-127): el sistema lo
reconoce por sus palabras, sin IA, y le ordena a la IA responder en ese; un saludo en otro idioma también lo cambia.
IDIOMA pregunta (1, 2, 3, el nombre o la bandera). Con un solo idioma no se pregunta nada. La charla de
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
| Confirma (SÍ → retiro/envío → nombre → dirección) | Sigue reservado, con número de pedido | **No vence** (ZL-157): lo acepta o lo rechaza el negocio. Recordatorio al celular a la hora y a las 20 h |
| El negocio lo acepta | Sigue reservado | Lo que elija el negocio: 2 h, 24 h (de entrada), 48 h o 7 días sin pagar |
| Marca pagado | Sigue reservado | No vence |
| Marca entregado | **Baja de verdad** (queda en el Historial) | — |
| Rechazado, cancelado o vencido | Vuelve a estar disponible | — |

- **El comprador siempre se entera (ZL-157).** Cada cambio (aceptado, pagado, entregado, rechazado, cancelado) se le
  manda solo si está dentro de las 24 h de su último mensaje (la regla de Meta, con media hora de margen; afuera ni se
  intenta, porque YCloud acepta el envío y Meta lo rechaza después sin avisar). Si no, el aviso queda guardado en su
  memoria y la tarjeta del pedido muestra «Falta avisarle al comprador» con el mensaje listo: «Mandárselo por
  WhatsApp» (wa.me con el texto escrito) o «Copiar el mensaje» + «Abrir Instagram». Desde su app el dueño no tiene
  límite de 24 h. Si el comprador vuelve a escribir antes, el asistente se lo dice primero, en el mismo mensaje de la
  respuesta. «Ya se lo mandé» lo borra; si el dueño le escribe desde su WhatsApp (eco), también.
- **Comprobantes (ZL-157):** con un pedido abierto (pendiente, aceptado o pagado), una foto, un archivo o un audio no
  los ve la IA ni se contestan: le llega un aviso al dueño («Te mandó un archivo»). Sin pedido abierto, sigue «solo
  leo mensajes de texto». Stickers, reacciones y menciones en historias no se contestan; una publicación de Instagram
  compartida recibe «no las puedo ver: ¿qué producto es?».
- **WhatsApp tiene costo desde el 1/10/2026 (ZL-158):** Meta da 1.000 mensajes de servicio gratis por número por mes y
  después cobra cada mensaje que manda el sistema (lo paga la cuenta de YCloud del negocio). Inicio muestra «WhatsApp
  este mes: X de 1.000» y avisa desde los 800; Reportes, los mensajes enviados. No cuentan los que recibe ni lo que el
  dueño escribe desde su app.
- **Capacidad de la IA (ZL-158):** 60 respuestas por minuto por negocio y 1.000 en toda la cuenta (Anthropic deja
  4.000 con Haiku 5.5). Si un cupo está lleno, se espera y se reintenta solo. Tope por día de cada negocio: 1.000 (los
  que tenían 300, el valor viejo, pasan a 1.000); al llegar, las charlas pasan al dueño y le llega un aviso, una vez.
  Prueba: `test/capacidad.test.js` (30 negocios en hora pico).
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
- **Lo que ya pidió (ZL-154):** antes de responder, la IA recibe entre `<compras>` los últimos 3 pedidos de esa persona
  en este negocio (número, día, estado en palabras, retiro o envío, productos con su ref y, con «Precios: sí», el total)
  y su consulta abierta. Así contesta «¿ya salió mi pedido?» con el estado real y arma «lo mismo que la otra vez» con
  las refs de antes (el código revisa el stock de hoy). Es solo lectura: nunca cambia ni cancela un pedido (eso pasa a
  una persona). No lleva la dirección, el nombre del comprador ni el motivo de un rechazo, y nunca pedidos de otra
  persona. Sale de la base del negocio (`comprasDe` en `src/pedidos.js`, `abierta()` en `src/consultas.js`).
- **Objetivo de la ficha:** `pedidos` (arma el pedido y el negocio lo confirma) o `consultas` (cuando la persona quiere
  avanzar, la IA marca `avanzar`, el código pide el nombre una sola vez y registra la consulta). **Cómo vendemos**: las
  pautas del negocio para guiar la venta.
- **La persona del negocio entra sola** cuando la pide, hay un reclamo, la IA no tiene la respuesta o se llegó al tope
  del día: el asistente se calla las horas de pausa y la charla queda en «Pedidos y consultas». Nunca se le pide a la
  persona que escriba PERSONA (la palabra igual funciona).
- Las consultas viven en la base del negocio (`src/consultas.js`): una abierta por charla, sin el texto de la charla.
- **Sin «hola» repetido (ZL-153):** a la IA se le dice si la charla ya empezó (`saludado`: hay historial o un saludo
  anterior, también después de elegir idioma o de ver el menú) y, si igual arranca con «¡Hola!», el código se lo saca
  (`sinSaludoInicial`). Lo que se vende se nombra por lo que gana la persona («una página para tu heladería»), nunca «el
  sitio web de X», y no se la manda a la página del negocio si no la pidió.
- **El nombre (ZL-153):** «Nelson me llamo», «sí, soy Ana» o «dale, me llamo Luis» guardan solo el nombre.
- **Quién escribió (ZL-153):** cada pedido y cada consulta de la app dice «Te escribió por WhatsApp: +54…» o «por
  Instagram: @usuario», con «Copiar» y el botón para responder (`wa.me/<número>` o `ig.me/m/<usuario>`). El número sale
  de la charla y el usuario de Instagram se le pide a Meta una vez y queda en la memoria de la persona. Nunca va en la
  URL de la app ni en los avisos al celular.

## Charla completa (ZL-149)

- **Audios:** no se escuchan ni se transcriben (decisión del 19/11/2026). El asistente responde «Por ahora no puedo
  escuchar audios, ¿me lo escribís?» en el idioma de la charla. No se baja ni se guarda el audio.
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

## El negocio en sus manos (ZL-159)

- **Dueño y empleados:** en Admin, de los correos del negocio se marcan los empleados (tiene que quedar al menos un
  dueño). Un empleado atiende pedidos, consultas y productos, y ve el Estado; conectar WhatsApp o Instagram, cambiar
  «Cómo vendés» y pausar el asistente lo hace el dueño (la API responde 403 «eso lo cambia el dueño del negocio»).
- **Pestaña Asistente para el negocio** (`PUT /api/n/<id>/asistente`):
  - **Pausa** (vacaciones, local cerrado), hasta 60 días, con un mensaje de ausencia opcional. A cada persona que
    escribe se le dice una sola vez cuándo vuelven y nada más; la IA no responde. BORRAR sigue andando.
  - **Aviso del día** (hasta 7 días): «hoy cerramos a las 18», «se terminó el pan de campo». Va al final de la ficha
    y manda sobre lo de arriba.
  - **Charla de prueba**: el dueño le escribe como si fuera un cliente, con su ficha y sus productos, sin mandar nada
    a nadie. Hasta 40 pruebas por día (`POST /api/n/<id>/prueba`).
  - El equipo además ve la ficha completa, como antes.
- **Búsqueda de productos con contexto:** la IA recibe los productos que vienen al caso del mensaje y de los dos
  anteriores de la persona («¿y en chocolate?»), y entiende diminutivos y plurales («tortita», «cajas»).
- **Listas largas:** productos y pedidos de a 50, con «Ver más».
- **Excel completo:** la hoja Pedidos trae número, fecha, estado, canal, comprador, entrega, productos y total (sin la
  dirección).
- **Privacidad:** el nombre, la dirección y las notas de un pedido cerrado, y el nombre y el resumen de una consulta
  cerrada, se borran solos a los 180 días (alarma diaria del `Catalogo`, `RETENCION_DATOS_MS`); quedan los productos y
  el total para las cuentas. BORRAR en el chat los borra al instante (lo que está en curso se termina primero).
  La política modelo para cada negocio está en [`fichas/PRIVACIDAD_MODELO.md`](fichas/PRIVACIDAD_MODELO.md): el
  responsable es el negocio y Zustro Labs procesa por cuenta de él.
- **Avisos de respaldo al equipo** (correo a `AVISO_PARA`, `avisarEquipo()` en `src/panel.js`):
  - si en Inicio ningún celular tiene los avisos activados, se lo dice arriba al negocio;
  - si un pedido espera una hora y el negocio no tiene avisos al celular, correo al equipo (sin datos del comprador);
  - una vez por día, después del mantenimiento de Instagram, el semáforo de cada negocio con un canal encendido (sin
    charla de prueba, no gasta IA): si algo está en rojo, un solo correo con todo (`revisarNegocios()` en `index.js`).

## La app, profesional y fácil (ZL-165)

- **Cinco secciones con ícono**: Inicio · Charlas · Productos (o Servicios) · Mi negocio · Más (Reportes, Conexiones,
  Asistente y Avisos). El equipo ve además Admin. Lo guardado con las pestañas viejas lleva a la nueva.
- **Inicio**: la guía «Para dejar todo andando» (asistente, canal, productos, horarios, avisos; desaparece cuando está
  todo), **Hoy** (charlas, pedidos o consultas, vendido, mensajes con el local cerrado), **Te necesitan ahora** (consultas
  abiertas y pedidos para aceptar), los pedidos en curso con sus filtros y la semana en una línea. Se actualiza sola cada
  20 segundos y dice hace cuánto. Al cambiar de negocio se borra lo anterior y dice «Cargando…».
- **Charlas** (`src/mensajes.js`, en la base del negocio): lo que escribió cada persona y lo que respondió el asistente,
  **30 días** (cron diario; BORRAR la borra al instante). La app las pide por un número propio, nunca por el teléfono ni
  el id de Instagram. Desde la charla el negocio **responde** (dentro de las 24 h de Meta; si no, lo dice claro) y el
  asistente se calla ahí las horas de la ficha; «Que siga el asistente» lo devuelve. **👎** en una respuesta mala
  devuelve la pregunta para cargar la respuesta correcta como pregunta frecuente (y cuenta en las métricas, `mal`).
- **Productos**: «Se agotó» / «Volvió» con un toque, **precios en bloque** (porcentaje, por categoría, redondeo, con
  vista previa; queda en el historial), contador «Mostrando N de M», y «Qué mostrar» (productos o servicios; stock,
  unidades, códigos y categorías se pueden ocultar). Se guarda en los ajustes del negocio (`vende`, `campos`).
- **Reportes**: cuatro números grandes (personas atendidas, pedidos o consultas, vendido, mensajes con el local cerrado)
  y el resto en «Más números».
- **Avisos**: la lista de dispositivos con avisos (con su nombre), «Probar» y «Sacar» cada uno (sin mostrar el endpoint).
- **Asistente**: «Cómo trabaja» explica el objetivo de la ficha y si los pedidos por chat están encendidos.
- **Admin**: el equipo borra un **pedido de prueba** (libera lo reservado; un entregado no se borra).

## Mi negocio (ZL-164)

Pestaña «Mi negocio» de la app (`src/minegocio.js`, API `GET/PUT /api/n/<id>/mi-negocio`). Lo carga el **dueño**, sin
pasar por el equipo, y el asistente lo usa desde la próxima respuesta:

- **Horarios** con hasta dos turnos por día («Copiar el lunes a todos los días»; un turno que se pisa con el anterior no se
  guarda) y **fechas especiales** (cerrado u otro horario) que mandan sobre la semana. «Cargar feriados» suma los
  nacionales de los próximos 12 meses (Argentina con los trasladables de la Ley 27.399, Croacia y España) como cerrado,
  para que el dueño cambie los que abre. Las fechas que ya pasaron se borran al guardar.
- **El código calcula los hechos**: la IA recibe siempre la fecha y la hora del negocio y, con horarios, si está abierto
  ahora y cuándo abre («Estado ahora: CERRADO, abre mañana a las 9:00»). Los textos fijos («te responden por acá …»)
  dicen «hoy hasta las 20:30» o «mañana desde las 9:00» en lugar del horario escrito en la ficha.
- **Cuando está cerrado**: responder y tomar pedidos (de entrada: lo preparan cuando abran), responder sin tomar pedidos
  (no se arman pedidos por la charla) o no atender (como una pausa hasta que abre: a cada persona se le dice una vez
  cuándo abren; BORRAR sigue andando; la pausa del dueño manda sobre esto).
- **Dirección** con link al mapa, **envíos por zona** (costo, pedido mínimo, gratis desde, cuánto tarda), **formas de pago**
  (efectivo, transferencia, Mercado Pago, tarjeta) y **contacto**. Con zonas cargadas, el pedido por chat pregunta la zona
  después del nombre, avisa si no llega al mínimo (y vuelve a la entrega), y la revisión y el cierre muestran el costo y
  el total con envío; la zona y su costo quedan en el pedido. El **alias** va solo en el aviso de pedido aceptado: a la IA
  no se le da. Las formas de pago marcadas mandan sobre el texto de «Cómo vendés».
- **Lo que no supo responder**: cada pregunta que la IA no sabía (una vez por pregunta parecida, como mucho 50) con
  «Responder y guardar» (pasa a las preguntas frecuentes) o «Descartar». Las **preguntas frecuentes** se editan ahí. Estas
  dos cosas también las puede hacer un empleado.
- **Zona horaria** (pasó de «Cómo vendés» a acá) e **historial de cambios** («duena@… cambió el horario, los envíos»).
- En el cron diario, si en los próximos 7 días hay un feriado que el negocio no cargó y ese día abre, le llega un aviso al
  celular (una vez por feriado).
- El reporte suma «mensajes con el negocio cerrado» y «preguntas que no supo».
- «Cómo vendés» muestra solo lo que aplica: sin pedidos por chat no hay reserva; con solo retiro no hay envío (y al revés).

## El pedido por chat, a prueba de errores (ZL-163)

Lo que falló en vivo en la auditoría (sección 2.1 bis) y cómo quedó (`src/pedidos-charla.js`):

| Pasó | Ahora |
|---|---|
| «y una gaseosa» confirmó el pedido (la «y» valía como «yes») | Solo confirma un mensaje que es TODO afirmativo («sí», «dale, confirmo»); lo demás lo ve la IA |
| «cancela la gaseosa» anuló todo | CANCELAR anula solo si es todo el mensaje; «cancelá X» saca ese producto (IA) |
| «hacen factura A?» quedó como nombre | El nombre se valida (`nombreDePedido`): una pregunta la responde la IA y se vuelve a pedir el nombre |
| «no, mejor retiro» quedó como dirección | En cualquier paso, «mejor retiro» o «mandámelo» cambian la entrega |
| Sin revisión final | Paso `revisar`: productos, total, entrega, nombre y pago; confirma con SÍ |
| Preguntas en un paso: «Respondé 1 o 2» | La IA responde y se repite el paso con sus botones (un número suelto sigue pidiendo 1 o 2) |
| Pedía 2 y quedaba 1: lo sacaba | Suma lo que hay y lo dice («De Gaseosa queda 1: te sumé 1») |
| La reserva vencía a los 20 min aunque estuviera dando datos | Se renueva en cada paso (`renovar`) |
| El cierre no decía nombre, entrega ni pago | «¡Listo, Ana! Tu pedido N.º 3 quedó registrado (retiro en el local)…» + pago |
| Avisos de estado siempre en castellano, «figura como entregado», «ZustroLabs» y «Zustro Labs» | En el idioma de la charla, «¡Tu pedido ya está entregado!», con el nombre de la ficha |
| Un aceptado sin pagar vencía sin avisar | Aviso al dueño 2 h antes y, si vence, aviso al comprador (y al dueño), una vez cada uno (`avisosVencimiento`) |
| El dueño no podía corregir el nombre ni la dirección | «Corregir datos» en la tarjeta (`PUT /api/n/<id>/pedidos/<n>/comprador`) |
| Al aceptar, la tarjeta desaparecía | La lista pasa a «Aceptados» (o «Pagados») y la tarjeta sigue a la vista |
| La charla de prueba no probaba pedidos ni consultas | Usa un catálogo simulado (`catalogoDePrueba`): lee los productos reales, el carrito y el pedido viven en la prueba, sin reservar ni aparecer en la app |

Además: «quiero encargarla» ya no se toma como un nombre en el paso de la consulta (`noEsNombre`), y una pregunta en
ese paso la responde la IA y vuelve a pedir el nombre.

## La charla sin contradicciones (ZL-162)

Arreglos de lo que se vio en vivo en la auditoría del 21/11:

- **Lo que no sabe, lo ofrece** (no pasa sola la charla): la IA lo dice en una oración y marca `persona` con `motivo`
  «no_se»; el sistema agrega «¿Querés que lo averigüe el equipo y te respondan por acá?» y guarda el ofrecimiento
  (`oferta`, 2 h). Si responde que sí, pasa al equipo con la pregunta anotada (`interes` de la consulta); si dice que no,
  «Perfecto, ¿te ayudo con algo más?»; otra cosa, sigue la charla. Pasa directo solo con motivo «pidio» o «reclamo».
- **Nunca dos preguntas que se pisan:** antes de un texto fijo (pase, pedir el nombre, consulta lista) se le sacan a la
  respuesta de la IA sus preguntas finales y un «¡Dale!» inicial (`sinPreguntaFinal`). El texto del pase ya no dice
  «¡Dale!». Preguntar el precio ya no lleva directo a pedir el nombre.
- **Acuse único:** si escribe mientras espera a alguien del negocio, recibe una vez «Ya le avisé al equipo…». Sus
  mensajes no alargan la pausa (la alarga el dueño cuando contesta).
- **«Que siga el asistente»** (antes «Devolver al asistente»): el dueño puede escribir qué contestarle. Se le manda
  (dentro de las 24 h; si no, queda listo para mandar a mano), se guarda en las **preguntas frecuentes** del negocio
  (`preguntas`, hasta 100, entran en lo que sabe el asistente con `conPreguntas`) y queda en la memoria corta. Sin
  respuesta, la pregunta queda pendiente un día (`devuelta`): si la vuelve a hacer, el asistente dice que todavía no está
  confirmado y no la pasa otra vez. Se corta el ciclo devolver → pasar.
- **Mensajes seguidos → una respuesta:** si llega otro mensaje mientras se responde el anterior, la ráfaga nueva incluye
  al anterior (`cur:` en el Durable Object) y la respuesta vieja se descarta antes de tocar nada (`vigente`).
- **BORRAR** pide confirmación (BORRAR otra vez, 10 minutos), no saca la pausa y dice la verdad: los pedidos y consultas
  en curso los sigue teniendo el equipo.
- **Prompt:** una sola pregunta por mensaje; «Soy el asistente virtual de …» (sin «bot»); no sumar funciones de otros
  productos o rubros. El aviso del día y las preguntas frecuentes también permiten sus montos, links y teléfonos.
- **App:** «La atiendo yo» ya no es rojo; cada botón de la consulta explica qué hace; las horas van con fecha y en 24 h.

## Fotos de productos en la charla (ZL-161)

Si la persona pide ver un producto («¿tenés foto?», «mostrame la torta») o pregunta por uno puntual que tiene foto, el
asistente se la manda después del texto, con el nombre del producto como pie (WhatsApp por YCloud o Meta, e Instagram).

- La foto se carga en Productos (la misma de siempre). En el catálogo que ve la IA, los productos con foto y con stock
  llevan su ref y «con foto»; la IA devuelve solo refs en `fotos` (hasta 3) y el código las valida contra ese catálogo:
  nunca manda una que no existe ni la de un producto agotado.
- WhatsApp e Instagram bajan la foto de un **link público firmado que vence a los 7 días**
  (`https://zustrolabs.com/api/whatsapp/foto/<negocio>/<foto>?v=…&s=…`, `src/fotos.js`). La clave de la firma se crea
  sola y vive en el Durable Object (`claveFotos`). Sin firma, con otra foto u otro negocio, o vencido: 404.
- En la memoria corta queda «(Le mandé la foto de: …)», así no la repite. Si la charla pasa a una persona, no se manda.
- La charla de prueba muestra las fotos que mandaría. Cada foto cuenta como un mensaje de WhatsApp para Meta.

## Comentarios de Instagram (ZL-160)

El asistente también responde los comentarios de las publicaciones, con la misma ficha y el mismo catálogo (precios si
la ficha lo permite, dónde está, horarios, stock). Lo enciende el **dueño** en Conexiones → Instagram («Responder
comentarios», `PUT /api/n/<id>/instagram/comentarios {activo, modo}`); arranca apagado.

| Modo | En público | Por privado |
|---|---|---|
| `publico_privado` (recomendado) | Una frase corta que responde y dice que le escribimos por privado | El detalle, de 1 a 3 oraciones, con una pregunta para seguir |
| `privado` | Nada | Igual |

- **Qué se contesta:** comentarios nuevos (menos de 24 h) y de primer nivel; las respuestas dentro de un hilo (donde
  caen también las nuestras) y los de la propia cuenta, no. Sin IA: solo emojis, menos de tres letras o una mención a
  un amigo (`esRuido`).
- **Qué hace la IA** (`src/comentarios.js`): clasifica (consulta, elogio, reclamo, otro) y escribe las dos respuestas.
  Pasan por `controlarNegocio` (links, teléfonos, correos y montos que no están en la ficha o el catálogo) y se les
  sacan las @menciones. Elogio: gracias en público, nada por privado. Reclamo, o una consulta que no está en la ficha:
  nada en ningún lado y aviso al celular del dueño. Lee el texto de la publicación como dato.
- **El privado** va por `comment_id` (Meta: uno por comentario, dentro de 7 días). Queda en la memoria corta de esa
  persona (`ig:<cuenta>.<quien>`): si contesta, la charla sigue sabiendo qué comentó y qué le dijimos.
- **Frenos:** una respuesta por comentario (`visto('cm:<id>')`), el límite por persona (`LIMITE`, clave `igc:`),
  200 comentarios con IA por negocio y por día (`TOPE_COMENTARIOS_DIA`, métrica `comentariosIa`), el cupo de IA del
  negocio, la pausa del asistente y el canal de Instagram del negocio.
- **Permiso:** `instagram_business_manage_comments` y el campo `comments` del webhook. Al conectar se guarda si lo dio
  (`permisoComentarios` en la cuenta); la suscripción pide `messages,comments` solo con el permiso y, si Meta rechaza
  `comments`, deja `messages` (nunca se pierden los mensajes). Si Meta responde sin permiso, la cuenta queda marcada,
  la app pide «Conectar Instagram» de nuevo y el semáforo lo avisa.
- **Números:** métrica `comentarios` (los que respondió) → «Comentarios respondidos» en Reportes, por día y en el Excel.
- **Registro:** `"que":"comentario"` con `r` y el tipo; nunca el texto ni el usuario.

## Lo que falta (próximas etapas)

- **Fotos por chat** y **planilla de Google en vivo**.
- **Cobro en línea** (Mercado Pago) y el alias de pago en el mensaje de «aceptado».
- **Plantillas de Meta** para avisar al comprador pasadas las 24 h sin que lo mande el dueño (requiere aprobarlas en
  Meta y tienen costo por mensaje).
- Decididos para más adelante: decir en la charla que es un asistente automático, y el ícono para iPhone de la app
  instalada.

## WhatsApp de cada cliente (ZL-135)

Cada cliente conecta su número de WhatsApp Business a **su propia cuenta gratis de YCloud** con coexistencia (sigue
usando su app y no pierde las charlas) y `scripts\whatsapp-cliente.ps1` lo conecta al Worker con la clave de API de
esa cuenta. Responde con la misma ficha y los mismos productos que Instagram, y se calla en una charla cuando el dueño
contesta desde su celular. Detalle en [`WHATSAPP_CLIENTES.md`](WHATSAPP_CLIENTES.md).

## Archivos

`src/catalogo.js` (base de un negocio) · `src/negocios.js` (API y permisos) · `src/negocios-ui.js` (la página) ·
`src/lector.js` (Excel y CSV) · `src/objeto.js` (Durable Objects) · tests en `test/catalogo.test.js`,
`test/negocios.test.js`, `test/lector.test.js`, `test/alertas.test.js` (ZL-159), `test/comentarios.test.js` (ZL-160) y, en un navegador,
`tests/negocios.spec.ts`.
