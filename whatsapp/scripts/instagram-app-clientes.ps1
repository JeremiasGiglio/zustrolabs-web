<#
Zustro Labs · la app de Instagram para clientes (ZL-137). Windows PowerShell 5.1 o más nuevo.

Con esta app, cada cliente conecta su Instagram SOLO desde negocios.zustrolabs.com → pestaña Instagram, sin Facebook
y sin crear nada en Meta. La app es de Zustro Labs, en acceso estándar (sin revisión de Meta ni verificación de
empresa): por eso cada cuenta tiene que estar agregada como «Instagram Tester» de la app (hasta unas 50 por app).

Uso (en una ventana de PowerShell en esta carpeta):
  .\instagram-app-clientes.ps1                  una sola vez: crear la app en Meta y registrarla en el Worker
  .\instagram-app-clientes.ps1 -Invitaciones    las invitaciones que pidieron los negocios y cómo mandarlas
Si Windows dice que los scripts están deshabilitados: Set-ExecutionPolicy -Scope Process Bypass
Guía: whatsapp/INSTAGRAM_CLIENTES.md (sección «Desde la app de negocios»).
#>
param(
  [string]$Worker = "https://zustrolabs.com",
  [switch]$Invitaciones
)

. "$PSScriptRoot\comun.ps1"
$UrlVuelta = "$Worker/api/instagram/conectar/vuelta"
$UrlWebhook = "$Worker/api/instagram"

Titulo "Zustro Labs · app de Instagram para clientes"
Paso 0 "Reviso el Worker ($Worker)"
$estado = Conectar-Worker
$compartidas = @(@($estado.apps) | Where-Object { $_.compartida })

if ($Invitaciones) {
  Paso 1 "Invitaciones pedidas"
  $pedidas = @(@((Llamar GET "/negocios").negocios) | Where-Object { $_.invitacionIg })
  if (-not $pedidas.Count) { Ok "No hay invitaciones pendientes."; exit 0 }
  foreach ($n in $pedidas) {
    $fecha = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$n.invitacionIg.pedido).LocalDateTime.ToString("dd/MM HH:mm")
    Nota ("  " + $n.nombre + "  →  @" + $n.invitacionIg.usuario + "  (pedida el " + $fecha + ")")
  }
  Write-Host ""
  if ($compartidas.Count) { Nota "Para cada una, en la app «Zustro Labs Clientes»:" } else { Nota "Para cada una, en la app de Instagram DEL ESTUDIO (la de @zustrolabs):" }
  Nota "App roles → Roles → Add People → «Instagram Tester» → el usuario (sin @) → Add."
  Abrir "https://developers.facebook.com/apps/"
  Nota "Después avisale al negocio que acepte en instagram.com/accounts/manage_access → «Invitaciones de evaluador»"
  Nota "y que apriete «Conectar Instagram» en la app. El pedido se borra solo cuando la cuenta queda conectada."
  exit 0
}

# ZL-140: desde fines de octubre de 2026, Meta no ofrece «Instagram login» en las apps nuevas («Unified login» pide
# Facebook y un portafolio). Sin app compartida, los clientes se conectan con la app del estudio, que es anterior.
Aviso "Ojo: Meta ya no deja crear apps nuevas con «Instagram login». Sin hacer nada, los clientes usan la app del estudio."
Nota "Seguí solo si tenés OTRA app creada antes de noviembre de 2026 con «API setup with Instagram login»."
if (-not (SiNo "¿Tenés una app así para registrarla como compartida?")) { exit 0 }
if ($compartidas.Count) {
  Aviso ("Ya hay una app compartida registrada: " + (($compartidas | ForEach-Object { $_.id + " (" + $_.nombre + ")" }) -join ", ") + ".")
  if (-not (SiNo "¿Registrar otra igual? (por ejemplo, si la primera llegó a 50 evaluadores; se usa la más nueva)")) { exit 0 }
}

Paso 1 "Crear la app en Meta (con el Facebook de Zustro Labs)"
Abrir "https://developers.facebook.com/apps/creation/"
Nota "· Nombre de la app: «Zustro Labs Clientes». Correo: contact@zustrolabs.com."
Nota "· Caso de uso: «Manage messaging & content on Instagram». Portafolio comercial: ninguno. Crear app."
Nota "· Use cases → Customize → pestaña «API setup with Instagram login» (no la de Facebook login)."
Nota "· Botón «Add all required permissions»."
Nota "· Arriba: «Instagram app ID» e «Instagram app secret» (botón Show). El «App secret» de App settings → Basic"
Nota "  es el de Facebook y NO sirve acá."
Write-Host ""
$appId = (Read-Host "  Pegá el Instagram app ID").Trim()
if ($appId -notmatch '^\d{6,20}$') { Falla "El Instagram app ID son solo dígitos."; exit 1 }
$appSecret = (Secreto "Pegá el Instagram app secret (no se muestra)" $null).Trim()
if ($appSecret.Length -lt 16) { Falla "Ese secret es muy corto; copialo entero con el botón Show."; exit 1 }
try {
  Llamar POST "/apps" @{ id = $appId; secreto = $appSecret; nombre = "Zustro Labs Clientes"; compartida = $true } | Out-Null
  Ok "App $appId registrada en el Worker como la app compartida."
} catch { Falla "El Worker no aceptó la app: $(Leer-Error $_)"; exit 1 }
$appSecret = $null

Paso 2 "Configurar la misma pestaña de Meta (tres cosas)"
Nota "A) «Set up Instagram business login» → Set up → Redirect URL:"
Write-Host "       $UrlVuelta" -ForegroundColor White
Set-Clipboard -Value $UrlVuelta; Nota "   (copiada al portapapeles) → Save."
Seguir
Nota "B) «Configure webhooks»:"
Write-Host "       Callback URL: $UrlWebhook" -ForegroundColor White
Nota "   Verify token: la frase del secreto IG_VERIFY_TOKEN del Worker."
$verify = Secreto "   Escribí esa frase acá para comprobarla antes de cargarla en Meta" "ZL_IG_VERIFY_TOKEN"
try {
  $resp = Invoke-WebRequest -UseBasicParsing -Uri ("$UrlWebhook" + "?hub.mode=subscribe&hub.verify_token=" + [Uri]::EscapeDataString($verify) + "&hub.challenge=prueba123")
  if ($resp.StatusCode -eq 200 -and $resp.Content -eq "prueba123") { Ok "El Worker acepta esa frase." } else { Falla "El Worker no la aceptó. Fijate el secreto IG_VERIFY_TOKEN en Cloudflare."; exit 1 }
} catch { Falla "El Worker rechazó la frase (no coincide con IG_VERIFY_TOKEN)."; exit 1 }
$verify = $null
Set-Clipboard -Value $UrlWebhook
Nota "   Callback URL copiada: pegala, escribí la frase, «Verify and save» y, en la lista, «messages» en Subscribed."
Seguir
Nota "C) App settings → Basic: Privacy Policy URL = https://zustrolabs.com/privacidad/, Category = «Business and"
Nota "   pages», Save. Después Publish → Live. Sin Live, Meta no manda mensajes reales."
Seguir

Paso 3 "Listo"
Ok "Desde ahora, la pestaña Instagram de la app de negocios tiene el botón «Conectar Instagram» habilitado."
Nota "Cuando un negocio pide la invitación, aparece en Administración. Mandala con: .\instagram-app-clientes.ps1 -Invitaciones"
