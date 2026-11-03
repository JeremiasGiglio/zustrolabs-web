# Instagram para un cliente: guía completa

Cómo dejar la cuenta de Instagram de un cliente respondiendo con el asistente, con el Worker `zustrolabs-whatsapp` que ya atiende @zustrolabs. Escrito después de pelearnos dos días con Meta: cada paso de acá existe porque algo falló sin él.

**La idea:** cada cliente tiene **su propia app de Meta**, creada en **su** cuenta de Facebook. Para la cuenta de Instagram que uno mismo administra, Meta deja usar la API con el acceso estándar: **no hace falta App Review ni verificación de negocio**. Nuestro Worker atiende muchas apps a la vez (la del estudio y una por cliente), con los mismos límites y el mismo panel.

**La herramienta:** `scripts\instagram-cliente.ps1` (Windows, PowerShell). Te lleva paso a paso, abre cada enlace, comprueba lo que se puede comprobar y registra la app del cliente en el Worker. Lo que no puede hacer es apretar los botones del panel de Meta (es dentro de la cuenta del cliente): para eso te dice dónde y qué.

## Qué hace falta tener, y quién lo crea

| Qué | Quién | Dónde |
|---|---|---|
| Cuenta de Instagram **profesional** (Empresa o Creador) | el cliente | app de Instagram → Configuración → Tipo de cuenta y herramientas → Cambiar a cuenta profesional · https://help.instagram.com/502981923235522 |
| «Permitir acceso a los mensajes» encendido | el cliente | Instagram → Configuración → Mensajes y respuestas a historias → Controles de mensajes → Herramientas conectadas |
| Cuenta de Facebook (cualquiera; **no hace falta página**) | el cliente | https://www.facebook.com |
| Registro como desarrollador de Meta (verifica teléfono/correo, acepta términos) | el cliente, con vos al lado | https://developers.facebook.com/async/registration/ |
| App de Meta con el caso de uso «Manage messaging & content on Instagram» | el cliente, con vos al lado | https://developers.facebook.com/apps/creation/ |
| Worker configurado (secretos `IG_APP_ID`, `IG_APP_SECRET`, `IG_VERIFY_TOKEN`, `IG_CONECTAR_CLAVE`, `IG_ADMIN_CLAVE`, `ANTHROPIC_API_KEY`) | Jeremías, una vez | Cloudflare → Workers & Pages → `zustrolabs-whatsapp` → Settings → Variables and Secrets |

No hace falta: página de Facebook, portafolio comercial (Business Manager), usuario del sistema, tokens generados a mano, verificación del negocio, Tech Provider. Todo eso lo probamos con la variante «Facebook Login» y no sirvió.

## El recorrido (lo que el script va pidiendo)

### 0. El Worker
`.\instagram-cliente.ps1` pide la clave de administración y muestra qué está configurado y qué cuentas hay. Si falta algo, lo dice y para.

### 1. El cliente
Las tres cosas de la tabla (cuenta profesional, acceso a mensajes, Facebook).

### 2. La app de Meta del cliente
Con el cliente al lado o por pantalla compartida, entrado en Facebook con **su** cuenta:
1. https://developers.facebook.com/async/registration/ si nunca usó Meta for Developers.
2. https://developers.facebook.com/apps/creation/ → nombre de la app = nombre del negocio → caso de uso **Manage messaging & content on Instagram** → sin portafolio → crear.
3. En la app: **Use cases → Customize → «API setup with Instagram login»** (no la de Facebook login, no la «Unified»).
   - Botón **Add all required permissions**.
   - Arriba: **Instagram app ID** e **Instagram app secret** (Show). Son los de Instagram; el «App secret» de App settings → Basic es otro y no sirve.
4. El script registra id y secret en el Worker (`POST /api/instagram/admin/apps`). El secret nunca se muestra ni se guarda en tu PC.

### 3. Tres cosas más en esa pestaña
- **Paso 4 «Set up Instagram business login»** → Set up → Redirect URL: `https://zustrolabs.com/api/instagram/conectar/vuelta` → Save.
- **Paso 3 «Configure webhooks»** → Callback URL `https://zustrolabs.com/api/instagram` + Verify token = la frase de `IG_VERIFY_TOKEN` (la misma para todos los clientes) → **Verify and save** → en la lista, **messages** en Subscribed. El script comprueba antes que la frase sea la correcta contra el Worker, así Meta no da «verificación fallida».
- **App settings → Basic:** Privacy Policy URL `https://zustrolabs.com/privacidad/` (o la del cliente), Category «Business and pages», Save. **Publish → Live.** Sin Live, Meta no manda mensajes reales (solo los de prueba del panel).

### 4. Conectar la cuenta
El script arma el link `https://zustrolabs.com/api/instagram/conectar?clave=…&app=<id>` y lo deja en el portapapeles. El cliente lo abre en un navegador donde esté entrado en Instagram con la cuenta del negocio, acepta los dos permisos y ve «Listo». El script espera y muestra la cuenta conectada. El token dura 60 días; el Worker lo renueva solo (cron diario) y comprueba la suscripción.

### 5. Prueba
Desde **otra** cuenta de Instagram, «hola» → saludo con idiomas → «Español» → una pregunta. Si no responde, los registros del Worker (Observability) dicen por qué; la tabla está en el script y abajo.

## Los errores que ya tuvimos (y que el script evita)

| Síntoma | Causa real | Qué hace ahora |
|---|---|---|
| Meta decía «verificación fallida» del webhook | La URL con `?hub.mode=…` caía en la página 404: la ruta del Worker no tenía `*` | Ruta `zustrolabs.com/api/instagram*` |
| «Verificación fallida» con todo bien | La frase en Meta no era la misma que `IG_VERIFY_TOKEN` (no se puede ver en Cloudflare) | El script la comprueba contra el Worker antes de que la pegues en Meta |
| El webhook verificaba pero no llegaba nada | La URL se había tipeado pero nunca se apretó **Verify and save**; o faltaba suscribir **messages** | Lista explícita, y el script espera confirmación |
| Firma inválida (`que: firma`) | Se cargó el App secret de Facebook en vez del **Instagram app secret** | El script pide el de la pestaña de Instagram y lo registra él |
| Nada llegaba con la variante Facebook Login | Página, usuario del sistema, suscripción de la página, permisos… demasiadas piezas | Variante Instagram login: la cuenta se conecta sola |
| «No pude leer la página / ninguna página» en el script viejo | El usuario del sistema no tenía la página asignada | Ya no hay usuario del sistema ni página |
| Un token quedó pegado en el chat | Se copió la salida entera de la terminal | Los secretos se piden por teclado, no se muestran, y el Worker nunca los devuelve |
| Mensajes de prueba desde la misma cuenta | Instagram no entrega a uno mismo | Probar desde otra cuenta |
| «Es necesario verificar el negocio» | Era el camino de App Review para atender cuentas ajenas con **nuestra** app | Cada cliente usa su propia app: acceso estándar alcanza |
| `cuenta_desconocida` en los registros | Llegó un mensaje para una cuenta que no se conectó (o se desconectó) | Reabrir el link de conexión |
| Publicaba pero no respondía | La app estaba en modo desarrollo | Publish → Live, siempre |

## Lo que todavía es manual, y lo que falta

- Apretar los botones de Meta (crear app, permisos, redirect URL, webhook, Live): 10 minutos con el cliente al lado. Meta no deja hacerlo por API.
- **El cerebro del cliente.** Hoy todas las cuentas conectadas responden con el asistente de Zustro Labs (lo que dice la landing). Para un cliente hace falta su propio conocimiento (productos, horarios, stock) y sus reglas: es el ticket siguiente (asistente por cuenta, con `conocimiento` propio y, en el caso de la chocolatería, el stock). Hasta entonces, conectar la cuenta de un cliente sirve para dejar todo listo y probar el canal.
- Ventana de 24 h para responder (regla de Meta); después, el equipo responde desde el panel solo si la persona vuelve a escribir.
- Solo texto: fotos y audios reciben «solo leo texto».

## Administración (lo que usa el script)

Todo con `Authorization: Bearer <IG_ADMIN_CLAVE>`, en `https://zustrolabs.com/api/instagram/admin/…`:
- `GET /estado` → configuración, apps y cuentas (sin secretos ni tokens).
- `POST /apps` `{id, secreto, nombre}` → registra la app de un cliente; devuelve el link de conexión.
- `DELETE /apps/<id>` → quita la app y desconecta sus cuentas.
- `DELETE /cuentas/<id>` → desconecta una cuenta.

Costos por cliente: Cloudflare gratis; IA con Haiku, centavos por charla (la clave del estudio tiene tope mensual). Meta no cobra los mensajes de Instagram.
