# Fallas y prevención: alta de una cuenta de Instagram · ZL-128

Todo lo que nos falló hasta el 4/11/2026 y todo lo que puede fallar al dar de alta la cuenta de un negocio, con cómo
se nota y cómo se evita. **Es la lista de controles que tienen que hacer los scripts de alta** (`cliente-nuevo.ps1`,
`instagram-cliente.ps1`): cada fila dice si ya está automatizada, si se puede automatizar o si es manual.

La regla que sale de todo esto: **una cuenta está lista solo cuando se probó como la va a usar un cliente nuevo**,
desde otra cuenta de Instagram que nunca le escribió, con la versión publicada.

## 1. Lo que nos falló (y ya está arreglado)

| # | Síntoma | Causa real | Arreglo y cómo se evita | Ticket |
|---|---|---|---|---|
| 1 | La app de negocios se quedaba en «Cargando…» | Wrangler empaqueta con `keepNames`: agrega `__name()` y renombra funciones; el código que la página arma con `.toString()` no existía en el navegador | Las pruebas del navegador empaquetan el Worker igual que Wrangler | ZL-123 |
| 2 | «null» suelto en la cabecera | `append()` escribe `null` para lo que no hay | `poner()`, que saltea lo vacío; prueba con un correo sin negocio | ZL-123 |
| 3 | El login de Access mostraba solo «Cloudflare» (pedía cuenta de Cloudflare) | One-time PIN no estaba encendido en Zero Trust | Encender One-time PIN; en la app «negocios», solo ese método e *Instant Auth* | — |
| 4 | El código de entrada no llegaba | El correo no estaba en la política de Access (un número mal tipeado). Access igual dice «te mandamos un código» | Mismo correo en la política y en «Quiénes entran»; *Policy tester* | — |
| 5 | Con dos cuentas en el navegador, entraba con la equivocada | La sesión de Access queda en el navegador | Probar en incógnito | — |
| 6 | Se perdía el acceso de administrador después de cada publicación | `PANEL_EMAILS` estaba cargada como variable de **texto**; cada `wrangler deploy` reemplaza las de texto por las del repo | Cargarla como **Secret** (los secretos sobreviven) | — |
| 7 | La ficha pegada daba «falta Nombre, falta Saludo…» | Se copió desde un visor que muestra el Markdown «lindo» y se perdieron `##`, `###` y `-` | Copiar desde el Bloc de notas o desde un bloque de código; la revisión dice qué falta | — |
| 8 | Toda pregunta libre respondía «Uy, ahora no puedo responder» | La IA de las fichas se validaba con el esquema de la landing; las pruebas reemplazaban justo esa llamada | Validador propio; prueba que pasa por la llamada real con la respuesta de la API simulada | ZL-125 |
| 9 | @zustrolabs seguía respondiendo con lo de la landing | La cuenta no estaba marcada en el negocio y la ficha no estaba activa | Vincular + «Activa»; el registro dice `estudio_sin_ficha` / `estudio_ficha_inactiva` | ZL-124 |
| 10 | Le escribían en inglés y saludaba en castellano | La ficha tenía un solo idioma | Fichas con varios idiomas: pregunta el idioma y trae el saludo y el menú traducidos | ZL-126 |
| 11 | La charla de prueba no recordaba nada | Cada mensaje se simulaba desde cero con «hola» | La prueba guarda idioma y PERSONA; botón «Reiniciar charla» | ZL-126 |
| 12 | Con castellano guardado, «Hello» y «how are u» seguían en castellano | El idioma guardado pesaba más que el del mensaje, y pedirle a la IA que eligiera no alcanzó | El sistema reconoce el idioma del mensaje sin IA y se lo ordena a la IA; un saludo en otro idioma cambia la charla | ZL-127 |
| 13 | «Sigue igual» justo después de unir un PR | Se probó antes de que terminara la publicación (CI y después `Publicar`, unos 10 minutos) | Esperar `Publicar` en verde y buscar algo nuevo en la pantalla (por ejemplo, un botón) | — |
| 14 | La prueba desde el Instagram propio engañaba | Esa cuenta ya tenía idioma guardado (y a veces la pausa de PERSONA) | Probar desde una cuenta que nunca escribió, o escribir IDIOMA / BORRAR antes | — |
| 15 | Antes: el tono del agente no cambiaba | La persona ya tenía un idioma guardado de charlas viejas | Saludos y «¿qué hacen?» siempre reciben la presentación y el menú | ZL-115 |
| 16 | El script de PowerShell rompía los acentos | Windows PowerShell 5.1 lee los `.ps1` sin BOM como ANSI | Los `.ps1` van con BOM (hay una prueba) | ZL-122 |
| 17 | WhatsApp conectado desde la app no respondía, y en los logs de YCloud todo daba 200 | El webhook se creaba con la dirección de la página (`negocios.zustrolabs.com`), detrás de Cloudflare Access: YCloud recibía la página de inicio de sesión y el mensaje nunca llegaba | El webhook va siempre a `https://zustrolabs.com/api/whatsapp/ycloud/<clave>`, con test. Un número conectado antes: en YCloud → Developers → Webhooks, editar solo el dominio de la URL. Regla: **nada que llame una máquina de afuera apunta a `negocios.` ni a `equipo.`** | ZL-136 |

Las fallas de Meta (webhook, firma, Live, `messages`, Facebook Login) están en
[`INSTAGRAM_CLIENTES.md`](INSTAGRAM_CLIENTES.md#los-errores-que-ya-tuvimos-y-que-el-script-evita).

## 2. Lo que puede fallar en una cuenta nueva, paso por paso

Columna «Auto»: ✅ ya lo hace el script · 🔧 se puede automatizar (ver sección 4) · ✋ manual (Meta o el cliente).

### A. Antes de empezar (una sola vez por Worker)

| Qué puede fallar | Cómo se nota | Cómo evitarlo | Auto |
|---|---|---|---|
| Falta un secreto del Worker (`IG_APP_ID`, `IG_APP_SECRET`, `IG_VERIFY_TOKEN`, `IG_CONECTAR_CLAVE`, `IG_ADMIN_CLAVE`, `ANTHROPIC_API_KEY`) | `/estado` → `configurado` con algo en `false`; registro `config` | El paso 0 del script lee `/estado` y frena | ✅ |
| `PANEL_EMAILS` como texto | Después de publicar, «Tu correo todavía no está en ningún negocio» | Tipo **Secret** | 🔧 |
| One-time PIN apagado o la app «negocios» con «Cloudflare» como método | La pantalla de Access pide entrar con Cloudflare | Zero Trust → Identity providers → One-time PIN; en la app, solo ese | 🔧 |
| Hay un PR unido sin publicar | El arreglo «no anda» | Mirar la Action `Publicar` | 🔧 |

### B. El cliente

| Qué puede fallar | Cómo se nota | Cómo evitarlo | Auto |
|---|---|---|---|
| La cuenta de Instagram es personal | Meta no la deja conectar | Pasarla a profesional (Empresa o Creador) | ✋ |
| «Permitir acceso a los mensajes» apagado (Meta lo apaga solo a veces) | No llega nada al Worker | Encenderlo; revisarlo en cada alta y si deja de responder | ✋ |
| El cliente no tiene Facebook | No puede crear la app de Meta | Que cree uno solo para esto ([facebook.com/r.php](https://www.facebook.com/r.php) y [registro de desarrollador](https://developers.facebook.com/async/registration/)). Alternativa sin probar: la app en nuestra cuenta y el cliente como *Instagram Tester* | ✋ |

### C. La app de Meta

| Qué puede fallar | Cómo se nota | Cómo evitarlo | Auto |
|---|---|---|---|
| Se carga el App secret de Facebook en vez del de Instagram | Registro `firma` | Copiarlo de la pestaña «API setup with Instagram login» | ✅ (el script lo pide de ahí) |
| La frase del webhook no coincide con `IG_VERIFY_TOKEN` | Meta: «verificación fallida» | El script la prueba contra el Worker antes | ✅ |
| No se apretó **Verify and save** o falta suscribir **messages** | No llega nada | El script lo pide y espera confirmación | ✅ (confirmación manual) |
| La app quedó en modo desarrollo | Responde a las pruebas del panel, no a mensajes reales | Publish → **Live** | ✋ |
| El link de conexión venció (15 minutos) o se abrió con otra cuenta | No aparece la cuenta en `/estado` | Abrirlo en un navegador con la cuenta del negocio iniciada | ✅ (espera y avisa) |
| La app que se registra es la del estudio | El Worker la rechaza | Una app por cliente | ✅ |

### D. El negocio en la app

| Qué puede fallar | Cómo se nota | Cómo evitarlo | Auto |
|---|---|---|---|
| La cuenta no quedó marcada en el negocio | Cliente: no responde; estudio: responde con la landing | Vincular-Cuenta en el script, o Administración → marcar → Guardar | ✅ |
| Instagram apagado en los canales del negocio | Registro `canal_apagado` | Revisar los canales | 🔧 |
| Los correos del negocio no están en la política de Access | El código no llega | Pegar en Access los mismos correos de «Quiénes entran» | 🔧 (hoy el script los deja copiados) |
| Correo mal escrito (un número, un punto) | El código no llega | Comparar las dos listas; *Policy tester* | 🔧 |

### E. La ficha

| Qué puede fallar | Cómo se nota | Cómo evitarlo | Auto |
|---|---|---|---|
| Se perdió el Markdown al pegar | Revisar: «falta la sección…» | Copiar del Bloc de notas | ✅ (el script la sube desde el archivo) |
| Quedan `[COMPLETAR …]` | No deja activarla | Completar | ✅ |
| Varios idiomas sin el saludo o el menú traducidos, o con otra cantidad de opciones | Revisar lo dice | `## Saludo (inglés)`, `## Menú (inglés)` con las mismas opciones | ✅ |
| El horario de PERSONA solo en castellano | En inglés o croata no se nombra | `- Cuándo responde una persona (inglés): …` | ✅ |
| Guardada sin «Activa» | Registro `ficha_inactiva` (cliente: no responde) | Activarla | ✅ |
| Precios: la ficha dice «sí» y el negocio no quiere publicarlos | Responde montos | «Precios: no» (en Zustro Labs, siempre «no» por el HZZ) | ✋ |
| La ficha repite productos que ya están en la app | Dos lugares que mantener; si no coinciden, manda la app | Productos solo en la app; el menú habla en general | ✋ |
| Traducciones sin revisar | Un nativo lo nota | Revisión de un nativo (croata: ZL-63) | ✋ |

### F. Los productos

| Qué puede fallar | Cómo se nota | Cómo evitarlo | Auto |
|---|---|---|---|
| Stock en 0 en servicios | «AGOTADO: no ofrecer»: no los ofrece | Stock vacío para servicios (cuenta como disponible) | 🔧 (avisar en la importación) |
| Columnas del Excel con otros nombres | La vista previa no las reconoce | Corregirlas en la vista previa o usar la planilla modelo | ✅ |
| Descripciones pobres | Respuestas pobres | Descripciones claras: es lo que usa la IA | ✋ |
| Más de 150 productos activos | La IA ve los 40 que más se parecen a la pregunta | Nombres y descripciones con las palabras que usa el cliente | ✋ |

### G. La prueba final

| Qué puede fallar | Cómo se nota | Cómo evitarlo | Auto |
|---|---|---|---|
| Se prueba desde la misma cuenta del negocio | Instagram no entrega a uno mismo | Otra cuenta | ✋ |
| Se prueba desde una cuenta con historia | No pregunta el idioma, o no responde (pausa de PERSONA) | Cuenta nueva, o BORRAR antes | ✋ |
| Se prueba antes de publicar | «Sigue igual» | Esperar `Publicar` | 🔧 |
| Se da por buena sin probar los tres caminos | Una falla aparece con el primer cliente | Probar: saludo, un número del menú, una pregunta libre sobre un producto, otro idioma y PERSONA | 🔧 (con `/ficha/probar`) |

### H. WhatsApp por YCloud (ZL-135)

| Qué puede fallar | Cómo se nota | Cómo evitarlo | Auto |
|---|---|---|---|
| Se elige «WhatsApp Business API» en vez de «Coexistence» | La app deja de funcionar con ese número | Siempre **WhatsApp Business APP Coexistence** | ✋ |
| WhatsApp Business viejo | El QR no conecta | 2.24.17 o más nueva | ✋ (el script lo pide) |
| Se cierra la app durante la sincronización | Los mensajes nuevos no llegan a YCloud | App abierta hasta que termine | ✋ |
| Nombre del negocio distinto al de los papeles | Problemas al verificar en YCloud | Exactamente como en los papeles | ✋ |
| La clave de API incompleta o de otra cuenta | El Worker dice «YCloud no aceptó la clave» | Copiarla entera de la cuenta del cliente | ✅ |
| La cuenta no acepta el aviso de respuestas del dueño | El asistente no se calla cuando contesta el dueño | El script avisa; mientras, PERSONA | ✅ (avisa) |
| El cliente no abre la app en 14 días | Meta corta la conexión: deja de llegar todo | Recordárselo; revisar `-SoloEstado` (último mensaje) | 🔧 |
| Usa WhatsApp para Windows | Esos mensajes no los ve el asistente | web.whatsapp.com | ✋ |
| Se recrea el webhook a mano en YCloud | Registro `firma` | `-Desconectar` y volver a conectar | ✅ |

### I. La app compartida de Instagram (ZL-137)

| Qué puede fallar | Cómo se nota | Cómo evitarlo | Auto |
|---|---|---|---|
| La app compartida no está registrada | El botón «Conectar Instagram» está apagado y dice «Todavía no está disponible» | `instagram-app-clientes.ps1` una vez | ✅ |
| La cuenta no es Instagram Tester (o no aceptó) | Instagram muestra un error al apretar «Conectar Instagram» | `-Invitaciones`, agregarla como Instagram Tester y que acepte en manage_access | ✋ |
| La app no está en Live | Conecta, pero no llegan los mensajes | Publish → Live en la app compartida | ✋ |
| Se llenó (unas 50 cuentas) | Meta no deja agregar más evaluadores | Registrar otra app con el script: se usa la más nueva | ✅ |
| El link de conectar venció (1 hora) | «el link venció o no es válido» al volver | Apretar «Conectar Instagram» de nuevo | ✅ |

## 3. Qué dice cada registro

Cloudflare → Workers & Pages → `zustrolabs-whatsapp` → Observability. Buscar por `que`:

| `que` | Qué quiere decir | Qué hacer |
|---|---|---|
| `firma` | El secret cargado no es el **Instagram** app secret | Volver a registrar la app con el script |
| `cuenta_desconocida` | Llegó un mensaje para una cuenta no conectada | Reabrir el link de conexión |
| `sin_ficha` / `ficha_inactiva` / `ficha_invalida` | Cliente sin ficha, apagada o con errores: no responde | Cargar o activar la ficha |
| `estudio_sin_ficha` / `estudio_ficha_inactiva` / `estudio_ficha_invalida` / `estudio_canal_apagado` | La cuenta del estudio responde con la landing, y por qué | Igual que arriba, en el negocio del estudio |
| `canal_apagado` | El negocio tiene Instagram apagado | Encenderlo en Administración |
| `config` | Faltan los límites o un secreto del Worker | Revisar `/estado` |
| `limite` | Esa persona mandó demasiados mensajes por minuto | Nada: es el freno al abuso |
| `viejo` | Meta reenvió un mensaje muy viejo | Nada |
| `error` | Falló la IA o el envío (el motivo va al lado) | Leer el motivo; si es `esquema`, avisar al equipo |
| Una respuesta con `"estudio":"ficha"` | La cuenta del estudio respondió con su ficha | Todo bien |
| Ningún registro | Meta no está mandando nada | Revisar Live, `messages` y «Permitir acceso a los mensajes» |

## 4. Para automatizar (lo que falta en los scripts)

En orden de cuánto nos ahorra:

1. **Prueba automática al final del alta**, con `POST /api/instagram/admin/ficha/probar` y la cuenta nueva:
   «hola» → pregunta de idioma o saludo; «1» → opción del menú; una pregunta libre → `que: ia` sin `error`; «Hello how
   are you» → respuesta en inglés si la ficha lo tiene; «persona» → mensaje de PERSONA. Frena si algo falla.
2. **Chequeo de `/estado` al terminar:** la cuenta conectada, con `negocio` igual al del alta, ficha activa, Instagram
   encendido y token con más de 50 días.
3. **Access por API** (token de Cloudflare con permiso de Access, como secreto del repo o de la PC, nunca en el chat):
   agregar los correos del negocio a la política de «negocios», comprobar que One-time PIN esté encendido y que la app
   tenga solo ese método.
4. **`PANEL_EMAILS` como Secret:** `wrangler secret list` tiene que mostrarlo. Si no está, el script avisa antes de
   publicar.
5. **Esperar la publicación:** antes de probar, que la última Action `Publicar` de `main` esté en verde.
6. **Avisos en la importación:** stock 0 en algo que parece un servicio, descripciones vacías, nombres repetidos.
7. **Recordatorio a los 30 días:** volver a mirar «Permitir acceso a los mensajes» y el token de cada cuenta.

Lo que no se puede automatizar: los botones de Meta (crear la app, permisos, redirect URL, webhook, Live), que la
cuenta sea profesional, «Permitir acceso a los mensajes» y la prueba real desde otra cuenta.

## 5. Reglas para nosotros, al programar

- **Probar como en producción:** el Worker empaquetado como lo hace Wrangler, y la llamada a la IA con la respuesta de
  la API simulada, no la función entera reemplazada.
- **Lo que tiene que pasar siempre no se le pide a la IA:** el idioma, los precios, los links y el stock los controla
  el sistema; la IA redacta.
- **Cada arreglo viene con la prueba que lo habría encontrado**, y se comprueba que esa prueba falla con el código viejo.
- **Nada de datos personales en el repo:** los correos de los clientes van en la app y en Access; las fichas reales,
  en `fichas/clientes/` (no se sube).
