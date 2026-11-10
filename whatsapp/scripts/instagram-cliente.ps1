<#
Zustro Labs · Instagram de un cliente, de punta a punta (Windows PowerShell 5.1 o más nuevo). ZL-111, ZL-113, ZL-122.

Deja la cuenta de Instagram de un negocio respondiendo con SU ficha y SUS productos, usando la app de Meta DEL CLIENTE
(acceso estándar: sin revisión de Meta ni verificación de empresa). Unos 20 minutos con el cliente al lado:
  0. revisa el Worker;                         5. vincula la cuenta al negocio (canal Instagram);
  1. el negocio (lo crea si es nuevo);          6. la ficha: la arma desde la plantilla, la revisás, chateás de
  2. lo que el cliente necesita tener;            prueba y la activás;
  3. la app de Meta (la registra en el Worker); 7. los correos en Access y los productos (si no viene de
  4. la configuración de Meta y la conexión;       cliente-nuevo.ps1);  8. la prueba real.
Lo que no puede hacer por vos: apretar los botones de Meta (es dentro de la cuenta del cliente) ni agregar los
correos en Access. Para eso te dice exactamente dónde y qué, y te deja todo copiado.

Uso (clic derecho → «Ejecutar con PowerShell», o en una ventana de PowerShell en esta carpeta):
  .\cliente-nuevo.ps1                         lo normal: alta completa, elige Instagram, WhatsApp o ambos
  .\instagram-cliente.ps1                     solo Instagram (negocio nuevo o uno que ya está)
  .\instagram-cliente.ps1 -Ficha ..\fichas\clientes\mi-negocio.md    solo cargar o actualizar la ficha
  .\instagram-cliente.ps1 -SoloEstado        ver qué cuentas hay y en qué estado
  (alta.ps1 lo llama con -SinFicha: la ficha ya la cargó por negocio)
Si Windows dice que los scripts están deshabilitados: Set-ExecutionPolicy -Scope Process Bypass
Guía completa: whatsapp/INSTAGRAM_CLIENTES.md
#>
param(
  [string]$Negocio = "",
  [string]$Ficha = "",
  [string]$Cuenta = "",
  [string]$Worker = "https://zustrolabs.com",
  [switch]$SoloEstado,
  [switch]$DesdeAlta,
  [switch]$SinFicha
)

. "$PSScriptRoot\comun.ps1"
$UrlVuelta = "$Worker/api/instagram/conectar/vuelta"
$UrlWebhook = "$Worker/api/instagram"

if (-not $DesdeAlta) { Titulo "Zustro Labs · Instagram de un cliente" }

# ── 0. El Worker ──
Paso 0 "Reviso el Worker ($Worker)"
$estado = Conectar-Worker
foreach ($cu in $estado.cuentas) {
  $fi = if ($cu.ficha -eq "estudio") { "cuenta del estudio" } elseif (-not $cu.ficha.tiene) { "SIN ficha: no responde" } elseif ($cu.ficha.activa) { "ficha activa" } else { "ficha apagada: no responde" }
  Nota ("  @" + $cu.username + "  (" + $fi + ", token vence en " + $cu.tokenVenceEnDias + " días)")
}
if ($SoloEstado) { exit 0 }
if ($Ficha) { Flujo-Ficha $Ficha $Cuenta; exit 0 }

# ── 1. El negocio ──
Paso 1 "El negocio"
if ($Negocio) {
  $neg = @((Llamar GET "/negocios").negocios) | Where-Object { $_.id -eq $Negocio } | Select-Object -First 1
  if (-not $neg) { Falla "No encuentro el negocio $Negocio."; exit 1 }
  Ok "Negocio: $($neg.nombre)"
} else { $neg = Elegir-Negocio }
$Nombre = $neg.nombre

# ── 2. El cliente ──
Paso 2 "Lo que el cliente tiene que tener (si no, lo hacemos con él en este orden)"
Nota "a) Una cuenta de Instagram PROFESIONAL (Empresa o Creador). Si es personal: Instagram → Configuración →"
Nota "   Tipo de cuenta y herramientas → Cambiar a cuenta profesional."
Abrir "https://help.instagram.com/502981923235522"
Nota "b) En esa cuenta: Configuración → Mensajes y respuestas a historias → Controles de mensajes →"
Nota "   Herramientas conectadas → «Permitir acceso a los mensajes» ENCENDIDO. (Meta lo apaga solo a veces: revisarlo.)"
Nota "c) Una cuenta de Facebook del cliente (cualquiera, no hace falta página) para crear la app de Meta."
Seguir "Apretá Enter cuando el cliente tenga las tres cosas"

# ── 3. La app de Meta del cliente ──
Paso 3 "Crear la app de Meta (en el Facebook DEL CLIENTE, con él al lado o compartiendo pantalla)"
Nota "1. Si nunca usó Meta for Developers, registrarse como desarrollador (verifica teléfono o correo):"
Abrir "https://developers.facebook.com/async/registration/"
Nota "2. Crear la app:"
Abrir "https://developers.facebook.com/apps/creation/"
Nota "   · Nombre de la app: «$Nombre». Correo: el del cliente."
Nota "   · Caso de uso: «Manage messaging & content on Instagram». Portafolio comercial: ninguno. Crear app."
Nota "3. En la app: Use cases → Customize → pestaña «API setup with Instagram login» (no la de Facebook login)."
Nota "   · Botón «Add all required permissions»."
Nota "   · Arriba: «Instagram app ID» e «Instagram app secret» (botón Show). SON los de Instagram: el «App secret»"
Nota "     de App settings → Basic es el de Facebook y NO sirve acá."
Write-Host ""
$appId = (Read-Host "  Pegá el Instagram app ID").Trim()
if ($appId -notmatch '^\d{6,20}$') { Falla "El Instagram app ID son solo dígitos."; exit 1 }
$appSecret = (Secreto "Pegá el Instagram app secret (no se muestra)" $null).Trim()
if ($appSecret.Length -lt 16) { Falla "Ese secret es muy corto; copialo entero con el botón Show."; exit 1 }
try {
  Llamar POST "/apps" @{ id = $appId; secreto = $appSecret; nombre = $Nombre } | Out-Null
  Ok "App $appId registrada en el Worker como «$Nombre»."
} catch { Falla "El Worker no aceptó la app: $(Leer-Error $_)"; exit 1 }
$appSecret = $null

# ── 4. Configurar Meta y conectar ──
Paso 4 "Configurar la misma pestaña de Meta (tres cosas) y conectar la cuenta"
Nota "A) Paso «Set up Instagram business login» → Set up → Redirect URL:"
Write-Host "       $UrlVuelta" -ForegroundColor White
Set-Clipboard -Value $UrlVuelta; Nota "   (copiada al portapapeles) → Save."
Seguir
Nota "B) Paso «Configure webhooks»:"
Write-Host "       Callback URL: $UrlWebhook" -ForegroundColor White
Nota "   Verify token: la frase del secreto IG_VERIFY_TOKEN del Worker (la misma para todos los clientes)."
$verify = Secreto "   Escribí esa frase acá para comprobarla antes de cargarla en Meta" "ZL_IG_VERIFY_TOKEN"
try {
  $resp = Invoke-WebRequest -UseBasicParsing -Uri ("$UrlWebhook" + "?hub.mode=subscribe&hub.verify_token=" + [Uri]::EscapeDataString($verify) + "&hub.challenge=prueba123")
  if ($resp.StatusCode -eq 200 -and $resp.Content -eq "prueba123") { Ok "El Worker acepta esa frase: es la correcta." } else { Falla "El Worker no la aceptó. Fijate el secreto IG_VERIFY_TOKEN en Cloudflare."; exit 1 }
} catch { Falla "El Worker rechazó la frase (no coincide con IG_VERIFY_TOKEN). Cargá la correcta antes de seguir."; exit 1 }
Set-Clipboard -Value $UrlWebhook
Nota "   Callback URL copiada. Pegala, escribí la frase y apretá «Verify and save» (tiene que quedar sin error)."
Nota "   Después, en la lista de campos, «messages» en Subscribed."
$verify = $null
Seguir
Nota "C) App settings → Basic: Privacy Policy URL = https://zustrolabs.com/privacidad/ (o la del cliente),"
Nota "   Category = «Business and pages», Save. Después Publish → Live. Sin Live, Meta no manda mensajes reales."
Seguir
$claveLink = Secreto "Clave del link (IG_CONECTAR_CLAVE)" "ZL_IG_CONECTAR_CLAVE"
$link = "$Worker/api/instagram/conectar?clave=" + [Uri]::EscapeDataString($claveLink) + "&app=$appId"
$claveLink = $null
Set-Clipboard -Value $link
Write-Host ""
Write-Host "  El link de conexión quedó copiado. Abrilo con el cliente (o mandáselo):" -ForegroundColor White
Nota "· En un navegador donde esté ENTRADO en Instagram con la cuenta del negocio → Permitir → «Listo»."
Nota "· El link vence a los 15 minutos de abrirlo: si tarda, se vuelve a abrir."
Write-Host "  Espero la cuenta conectada (hasta 15 minutos)…" -ForegroundColor White
$fin = (Get-Date).AddMinutes(15); $nueva = $null
while ((Get-Date) -lt $fin) {
  Start-Sleep -Seconds 10
  try { $e = Llamar GET "/estado"; $nueva = $e.cuentas | Where-Object { $_.app -eq $appId } | Select-Object -First 1 } catch {}
  if ($nueva) { break }
  Write-Host "." -NoNewline
}
Write-Host ""
if (-not $nueva) { Falla "Todavía no se conectó. Cuando lo haga, corré  .\instagram-cliente.ps1 -SoloEstado  para verla."; exit 1 }
Ok ("Conectada: @" + $nueva.username + " (el token dura 60 días y el Worker lo renueva solo).")

# ── 5. Vincularla al negocio ──
Paso 5 "Vincular @$($nueva.username) a «$Nombre»"
Vincular-Cuenta $neg $nueva.id "instagram"

# ── 6. La ficha ──
$rutaFicha = "(la del negocio, cargada por alta.ps1)"
if (-not $SinFicha) {
  Paso 6 "La ficha del negocio (cómo habla el asistente de @$($nueva.username))"
  Nota "Hasta que tenga una ficha activa, la cuenta NO responde (nunca como Zustro Labs)."
  $rutaFicha = Preparar-Ficha $Nombre
  Flujo-Ficha $rutaFicha $nueva.id
}

# ── 7. Access y productos (cliente-nuevo.ps1 lo hace una sola vez para todos los canales) ──
if (-not $DesdeAlta) {
  Paso 7 "Quién entra a la app y los productos"
  Paso-Acceso (($neg.emails) -join ",")
  Paso-Productos $Nombre
}

# ── 8. Prueba ──
Paso 8 "Prueba real"
Nota "Desde OTRA cuenta de Instagram (no la del negocio), mandar «hola» a @$($nueva.username)."
Nota "Tiene que llegar el saludo del negocio y su menú. Después un número y una pregunta sobre un producto."
Nota "Si no responde: Cloudflare → Workers & Pages → zustrolabs-whatsapp → Observability. Buscá «que»:"
Nota "  «sin_ficha» o «ficha_inactiva» = falta cargar o activar la ficha (-Ficha) · «canal_apagado» = en la app, el"
Nota "  negocio tiene Instagram apagado · «cuenta_desconocida» = la cuenta no está conectada · «firma» = el secret"
Nota "  cargado no es el de Instagram · nada = Meta no manda: revisar Live, «messages» y «Permitir acceso a los mensajes»."
if (-not $DesdeAlta) {
  Titulo "Listo"
  Nota "Negocio: $Nombre · app de Meta $appId · @$($nueva.username) · ficha: $rutaFicha"
  $min = [int][Math]::Floor(((Get-Date) - $script:Inicio).TotalMinutes)
  Nota "Tiempo: $min minutos. El token se renueva solo y la suscripción se revisa todos los días."
}
