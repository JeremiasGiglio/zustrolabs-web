<#
Zustro Labs · Instagram de un cliente, paso a paso (Windows, PowerShell 5.1 o más nuevo).

Conecta la cuenta de Instagram de un cliente al asistente del estudio usando la app de Meta DEL CLIENTE
(así el acceso estándar le alcanza y no hace falta la revisión de Meta). El script:
  1. revisa que el Worker esté configurado;
  2. te va abriendo los enlaces de Meta en orden y te dice qué copiar en cada uno;
  3. registra la app del cliente en el Worker;
  4. comprueba que el webhook esté bien (misma frase de verificación);
  5. arma el link de conexión y espera hasta ver la cuenta conectada.
Lo que no puede hacer por vos: crear la app en Meta (es dentro de la cuenta del cliente) y apretar los botones del
panel de Meta. Para eso te dice exactamente dónde y qué.

Uso (clic derecho → «Ejecutar con PowerShell», o en una ventana de PowerShell):
  .\instagram-cliente.ps1
  .\instagram-cliente.ps1 -Nombre "Chocolatería X"
Secretos: pide la clave de administración y la del link por teclado (no se muestran ni se guardan). Si querés evitar
teclearlas cada vez, podés ponerlas en las variables de entorno ZL_IG_ADMIN_CLAVE y ZL_IG_CONECTAR_CLAVE de tu
usuario de Windows (nunca en un archivo del repo).
Guía completa: whatsapp/INSTAGRAM_CLIENTES.md
#>
param(
  [string]$Nombre = "",
  [string]$Worker = "https://zustrolabs.com",
  [switch]$SoloEstado
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Admin = "$Worker/api/instagram/admin"
$UrlVuelta = "$Worker/api/instagram/conectar/vuelta"
$UrlWebhook = "$Worker/api/instagram"

function Titulo($t) { Write-Host ""; Write-Host ("═" * 72) -ForegroundColor DarkGray; Write-Host "  $t" -ForegroundColor Red; Write-Host ("═" * 72) -ForegroundColor DarkGray }
function Paso($n, $t) { Write-Host ""; Write-Host "[$n] $t" -ForegroundColor Yellow }
function Ok($t) { Write-Host "  ✔ $t" -ForegroundColor Green }
function Falla($t) { Write-Host "  ✘ $t" -ForegroundColor Red }
function Nota($t) { Write-Host "  · $t" -ForegroundColor Gray }
function Abrir($url) { Write-Host "  → $url" -ForegroundColor Cyan; try { Start-Process $url | Out-Null } catch {} }
function Seguir($t = "Apretá Enter cuando esté hecho") { Write-Host ""; Read-Host "  $t" | Out-Null }
function Secreto($pregunta, $variable) {
  if ($variable) {
    $v = [Environment]::GetEnvironmentVariable($variable)
    if ($v) { Nota "Usando $variable de las variables de entorno."; return $v }
  }
  $s = Read-Host "  $pregunta" -AsSecureString
  $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }
}
function Llamar($metodo, $ruta, $cuerpo = $null) {
  $args = @{ Method = $metodo; Uri = "$Admin$ruta"; Headers = @{ Authorization = "Bearer $script:ClaveAdmin" }; ContentType = "application/json; charset=utf-8" }
  if ($cuerpo) { $args.Body = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $cuerpo -Compress)) }
  return Invoke-RestMethod @args
}

Titulo "Zustro Labs · Instagram de un cliente"

# ── 0. El Worker ──
Paso 0 "Reviso el Worker ($Worker)"
$script:ClaveAdmin = Secreto "Clave de administración (IG_ADMIN_CLAVE)" "ZL_IG_ADMIN_CLAVE"
try { $estado = Llamar GET "/estado" } catch {
  Falla "No pude leer el estado: $($_.Exception.Message)"
  Nota "¿La clave es la del secreto IG_ADMIN_CLAVE del Worker zustrolabs-whatsapp? ¿Está publicada la versión con /api/instagram/admin?"
  exit 1
}
$c = $estado.configurado
foreach ($k in @("app_estudio", "verify", "link", "ia", "aviso")) { if ($c.$k) { Ok "$k configurado" } else { Falla "$k SIN configurar" } }
if (-not ($c.app_estudio -and $c.verify -and $c.link -and $c.ia)) {
  Falla "Faltan secretos en Cloudflare (Workers & Pages → zustrolabs-whatsapp → Settings → Variables and Secrets). Ver whatsapp/README.md."
  exit 1
}
Nota ("Apps de clientes registradas: " + $estado.apps.Count + " · cuentas conectadas: " + $estado.cuentas.Count)
foreach ($cu in $estado.cuentas) { Nota ("  @" + $cu.username + "  (app " + $cu.app + ", token vence en " + $cu.tokenVenceEnDias + " días)") }
if ($SoloEstado) { exit 0 }

# ── 1. El cliente ──
Paso 1 "Datos del cliente"
if (-not $Nombre) { $Nombre = Read-Host "  Nombre del cliente (como querés verlo en la lista)" }
Write-Host ""
Write-Host "  Lo que el cliente tiene que tener ANTES (si no, lo hacemos con él en este orden):" -ForegroundColor White
Nota "a) Una cuenta de Instagram PROFESIONAL (Empresa o Creador). Si es personal: Instagram → Configuración →"
Nota "   Tipo de cuenta y herramientas → Cambiar a cuenta profesional."
Abrir "https://help.instagram.com/502981923235522"
Nota "b) En esa cuenta: Configuración → Mensajes y respuestas a historias → Controles de mensajes →"
Nota "   Herramientas conectadas → «Permitir acceso a los mensajes» ENCENDIDO. (Meta lo apaga solo a veces: revisarlo.)"
Nota "c) Una cuenta de Facebook del cliente (cualquiera, no hace falta página) para crear la app de Meta."
Seguir "Apretá Enter cuando el cliente tenga las tres cosas"

# ── 2. La app de Meta del cliente ──
Paso 2 "Crear la app de Meta (en la cuenta de Facebook DEL CLIENTE, con él al lado o compartiendo pantalla)"
Nota "1. Entrar a Meta for Developers con el Facebook del cliente. Si es la primera vez, le pide registrarse como"
Nota "   desarrollador (verifica teléfono o correo y acepta los términos):"
Abrir "https://developers.facebook.com/async/registration/"
Nota "2. Crear la app:"
Abrir "https://developers.facebook.com/apps/creation/"
Nota "   · Nombre de la app: el nombre del negocio (p. ej. «$Nombre»). Correo: el del cliente."
Nota "   · Caso de uso: «Manage messaging & content on Instagram» (Gestionar mensajes y contenido en Instagram)."
Nota "   · Portafolio comercial: ninguno / omitir, salvo que el cliente ya tenga uno. Crear app."
Nota "3. En la app: Use cases → Customize → pestaña «API setup with Instagram login»."
Nota "   · Botón «Add all required permissions» (paso 1 de esa pestaña)."
Nota "   · Arriba están «Instagram app ID» e «Instagram app secret» (botón Show). SON los de Instagram, no los de"
Nota "     App settings → Basic (ese es el secret de Facebook y NO sirve acá)."
Write-Host ""
$appId = (Read-Host "  Pegá el Instagram app ID").Trim()
if ($appId -notmatch '^\d{6,20}$') { Falla "El Instagram app ID son solo dígitos."; exit 1 }
$appSecret = (Secreto "Pegá el Instagram app secret (no se muestra)" $null).Trim()
if ($appSecret.Length -lt 16) { Falla "Ese secret es muy corto; copialo entero con el botón Show."; exit 1 }
try {
  $alta = Llamar POST "/apps" @{ id = $appId; secreto = $appSecret; nombre = $Nombre }
  Ok "App $appId registrada en el Worker como «$Nombre»."
} catch { Falla "El Worker no aceptó la app: $($_.Exception.Message)"; exit 1 }
$appSecret = $null

# ── 3. Lo que va en la pestaña «API setup with Instagram login» ──
Paso 3 "Configurar la misma pestaña de Meta (tres cosas)"
Nota "A) Paso 4 «Set up Instagram business login» → botón Set up → Redirect URL:"
Write-Host "       $UrlVuelta" -ForegroundColor White
Set-Clipboard -Value $UrlVuelta; Nota "   (ya está copiada al portapapeles) → Save."
Seguir
Nota "B) Paso 3 «Configure webhooks»:"
Write-Host "       Callback URL: $UrlWebhook" -ForegroundColor White
Nota "   Verify token: la frase del secreto IG_VERIFY_TOKEN del Worker (la misma para todos los clientes)."
$verify = Secreto "   Escribí esa frase acá para comprobarla antes de cargarla en Meta" "ZL_IG_VERIFY_TOKEN"
try {
  $resp = Invoke-WebRequest -UseBasicParsing -Uri ("$UrlWebhook" + "?hub.mode=subscribe&hub.verify_token=" + [Uri]::EscapeDataString($verify) + "&hub.challenge=prueba123")
  if ($resp.StatusCode -eq 200 -and $resp.Content -eq "prueba123") { Ok "El Worker acepta esa frase: es la correcta." } else { Falla "El Worker no la aceptó. Fijate el secreto IG_VERIFY_TOKEN en Cloudflare."; exit 1 }
} catch { Falla "El Worker rechazó la frase (no coincide con IG_VERIFY_TOKEN). Cargá la correcta antes de seguir."; exit 1 }
Set-Clipboard -Value $UrlWebhook; Nota "   Callback URL copiada al portapapeles. Pegala, escribí la frase y apretá «Verify and save»."
Nota "   Tiene que quedar sin error. Después, en la lista de campos, poné «messages» en Subscribed."
$verify = $null
Seguir
Nota "C) App settings → Basic (menú izquierdo): Privacy Policy URL = https://zustrolabs.com/privacidad/ (o la del"
Nota "   cliente si tiene), Category = «Business and pages», Save. Luego Publish (menú izquierdo) → Publish → Live."
Nota "   Sin Live, Meta no manda mensajes reales."
Seguir

# ── 4. Conectar la cuenta ──
Paso 4 "Conectar la cuenta de Instagram del cliente"
$claveLink = Secreto "Clave del link (IG_CONECTAR_CLAVE)" "ZL_IG_CONECTAR_CLAVE"
$link = "$Worker/api/instagram/conectar?clave=" + [Uri]::EscapeDataString($claveLink) + "&app=$appId"
$claveLink = $null
Set-Clipboard -Value $link
Write-Host ""
Write-Host "  El link de conexión quedó copiado al portapapeles. Mandáselo al cliente (o abrilo con él):" -ForegroundColor White
Nota "· Tiene que abrirlo en un navegador donde esté ENTRADO en Instagram con la cuenta del negocio."
Nota "· Instagram le muestra los dos permisos → Permitir → ve «Listo: la cuenta @… quedó conectada»."
Nota "· El link vence a los 15 minutos de abrirlo: si tarda, se vuelve a abrir."
Write-Host ""
Write-Host "  Espero a que aparezca la cuenta conectada (hasta 15 minutos)…" -ForegroundColor White
$fin = (Get-Date).AddMinutes(15); $nueva = $null
while ((Get-Date) -lt $fin) {
  Start-Sleep -Seconds 10
  try { $e = Llamar GET "/estado"; $nueva = $e.cuentas | Where-Object { $_.app -eq $appId } | Select-Object -First 1 } catch {}
  if ($nueva) { break }
  Write-Host "." -NoNewline
}
Write-Host ""
if (-not $nueva) { Falla "Todavía no se conectó. Cuando lo haga, corré el script con -SoloEstado para verla."; exit 1 }
Ok ("Conectada: @" + $nueva.username + " (token vence en " + $nueva.tokenVenceEnDias + " días; el Worker lo renueva solo).")

# ── 5. Prueba ──
Paso 5 "Prueba"
Nota "Desde OTRA cuenta de Instagram (no la del negocio), mandar «hola» a @$($nueva.username)."
Nota "En segundos tiene que llegar el saludo con los idiomas. Después «Español» y una pregunta."
Nota "Si no responde: Cloudflare → Workers & Pages → zustrolabs-whatsapp → Observability. Buscá «que»:"
Nota "  «aviso» con eventos 0 = Meta mandó algo que no es un mensaje (eco, visto) · «cuenta_desconocida» = la cuenta"
Nota "  no está conectada · «firma» = el secret cargado no es el de Instagram · nada = Meta no manda: revisar Live,"
Nota "  «messages» suscripto y «Permitir acceso a los mensajes»."
Write-Host ""
Titulo "Listo. Resumen"
Nota "Cliente: $Nombre · app $appId · cuenta @$($nueva.username)"
Nota "Lo que queda a mano siempre: nada. El token se renueva solo y la suscripción se revisa todos los días."
Nota "Para ver todo: .\instagram-cliente.ps1 -SoloEstado"
