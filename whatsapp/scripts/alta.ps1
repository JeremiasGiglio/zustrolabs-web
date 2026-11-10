<#
Zustro Labs · ALTA COMPLETA de un cliente, de punta a punta (Windows PowerShell 5.1 o más nuevo). ZL-138.

Un solo script para todo lo aprendido (whatsapp/FALLAS_Y_PREVENCION.md). En unos 10 a 15 minutos:
  0. revisa el Worker;
  1. el negocio y quién entra a la app (los correos van solos a Access);
  2. la ficha del negocio: desde la plantilla, revisada, con charla de prueba y activa (sirve sin Instagram);
  3. Instagram (si lo contrató): con la app compartida de Zustro Labs (sin Facebook) o con la app propia del cliente;
  4. WhatsApp (si lo contrató): el cliente lo conecta solo en la app, o lo cargás vos con su clave de YCloud;
  5. los productos (Excel o a mano en la app);
  6. EL SEMÁFORO: revisa todo solo (Access, ficha, cuentas, números, webhook, productos, una charla de prueba) y no
     termina hasta que esté en verde, o te dice exactamente qué falta y cómo arreglarlo;
  7. te deja copiado el mensaje de bienvenida para mandarle al cliente.

Uso (en una ventana de PowerShell en esta carpeta, o clic derecho → «Ejecutar con PowerShell»):
  .\alta.ps1                         alta nueva (o seguir con un negocio que ya está)
  .\alta.ps1 -Verificar              solo el semáforo de un negocio (para revisar a un cliente que dice que no anda)
Si Windows dice que los scripts están deshabilitados:  Set-ExecutionPolicy -Scope Process Bypass
Claves: IG_ADMIN_CLAVE (y, para Instagram con la app del cliente, IG_CONECTAR_CLAVE e IG_VERIFY_TOKEN). Se piden sin
mostrarse, o se leen de tus variables de entorno ZL_IG_ADMIN_CLAVE, ZL_IG_CONECTAR_CLAVE, ZL_IG_VERIFY_TOKEN.
#>
param(
  [string]$Worker = "https://zustrolabs.com",
  [switch]$Verificar
)

. "$PSScriptRoot\comun.ps1"

# ── Ayudas de este script ──
function Leer-Negocio($id) { return (@((Llamar GET "/negocios").negocios) | Where-Object { $_.id -eq $id } | Select-Object -First 1) }

<# Espera hasta que $listo devuelva algo (lo prueba cada 5 segundos). Enter deja de esperar. #>
function Esperar($texto, $minutos, [scriptblock]$listo) {
  Write-Host "  $texto (Enter para dejar de esperar)" -ForegroundColor White
  $fin = (Get-Date).AddMinutes($minutos)
  while ((Get-Date) -lt $fin) {
    try { $r = & $listo; if ($r) { Write-Host ""; return $r } } catch {}
    for ($i = 0; $i -lt 10; $i++) {
      Start-Sleep -Milliseconds 500
      $tecla = $false
      try { $tecla = [Console]::KeyAvailable } catch {}
      if ($tecla) { [void][Console]::ReadKey($true); Write-Host ""; return $null }
    }
    Write-Host "." -NoNewline
  }
  Write-Host ""
  return $null
}

function Mostrar-Acceso($a, $correos) {
  if ($a -and $a.ok) {
    if (@($a.agregados).Count) { Ok ("Agregados a Access: " + (@($a.agregados) -join ", ") + " (ya les puede llegar el código).") }
    else { Ok "Los correos ya estaban en Access." }
    return
  }
  $motivo = "sin respuesta"; if ($a -and $a.error) { $motivo = $a.error }
  Aviso "No pude agregarlos a Access solo ($motivo)."
  Nota "Para que sea automático: secretos CF_API_TOKEN y CF_ACCOUNT_ID del Worker (ver whatsapp/NEGOCIOS.md). Por ahora, a mano:"
  Paso-Acceso $correos
}

function Mostrar-Semaforo($v) {
  foreach ($c in @($v.controles)) {
    if ($c.estado -eq "ok") { Ok $c.texto }
    elseif ($c.estado -eq "aviso") { Aviso $c.texto; if ($c.arreglo) { Nota ("    → " + $c.arreglo) } }
    else { Falla $c.texto; if ($c.arreglo) { Nota ("    → " + $c.arreglo) } }
  }
}

<# El semáforo hasta verde (o hasta que decidas seguir). Devuelve $true si quedó en verde. #>
function Semaforo($neg) {
  while ($true) {
    Nota "Reviso todo (incluye una charla de prueba con la IA; tarda unos segundos)…"
    try { $v = Llamar GET ("/negocios/" + $neg.id + "/verificar") } catch { Falla "No pude verificar: $(Leer-Error $_)"; return $false }
    Write-Host ""
    Mostrar-Semaforo $v
    Write-Host ""
    if ($v.verde) { Ok "TODO EN VERDE: «$($neg.nombre)» está respondiendo."; return $true }
    Falla "Hay cosas en rojo: arreglalas (dice cómo en cada una)."
    $r = Read-Host "  Enter = revisar de nuevo · S = seguir así (queda pendiente)"
    if ($r -match '^[sS]$') { return $false }
  }
}

<# La ficha del NEGOCIO: plantilla, revisión, charla de prueba (con sus productos) y activación. #>
function Ficha-Negocio($neg) {
  $actual = $null
  try { $actual = Llamar GET ("/negocios/" + $neg.id + "/ficha") } catch {}
  if ($actual -and $actual.activa) {
    Ok "Ya tiene una ficha activa: «$($actual.nombre)»."
    if (-not (SiNo "¿La cambiás ahora?")) { return }
  }
  $ruta = Preparar-Ficha $neg.nombre
  while ($true) {
    $texto = [IO.File]::ReadAllText((Resolve-Path $ruta).Path, [Text.Encoding]::UTF8)
    Nota "Reviso la ficha…"
    try { $rev = Llamar POST "/ficha/revisar" @{ texto = $texto } } catch {
      try { $rev = ($_.ErrorDetails.Message | ConvertFrom-Json) } catch { Falla "El Worker no respondió: $(Leer-Error $_)"; exit 1 }
    }
    if (Mostrar-Revision $rev) { break }
    if (-not (SiNo "Tiene errores. ¿La abro para corregirla?")) { exit 1 }
    Start-Process notepad.exe -ArgumentList "`"$ruta`"" -Wait
  }
  Write-Host ""
  Nota "Charla de prueba con sus productos (no se manda nada ni se guarda). Así saluda a quien escribe «hola»:"
  try {
    $p = Llamar POST "/ficha/probar" @{ texto = $texto; mensajes = @("hola"); negocio = $neg.id }
    Mostrar-Respuestas $p.charla[0]
  } catch { Falla "No pude probar: $(Leer-Error $_)" }
  Write-Host ""
  Nota "Escribí como un comprador (un número del menú, una pregunta por un producto, PERSONA…). Enter vacío para seguir."
  while ($true) {
    $m = Read-Host "  Comprador"
    if (-not $m) { break }
    try { $p = Llamar POST "/ficha/probar" @{ texto = $texto; mensajes = @("hola", $m); negocio = $neg.id }; Mostrar-Respuestas $p.charla[1] }
    catch { Falla "No pude probar: $(Leer-Error $_)" }
  }
  $activar = $false
  if (@($rev.pendientes).Count) { Aviso "Falta completar: se guarda APAGADA (no responde hasta activarla)." }
  else { $activar = SiNo "¿La dejo respondiendo a los compradores ahora?" }
  try {
    Llamar PUT ("/negocios/" + $neg.id + "/ficha") @{ texto = $texto; activa = $activar } | Out-Null
    if ($activar) { Ok "Ficha guardada y ACTIVA." } else { Ok "Ficha guardada APAGADA." }
  } catch { Falla "El Worker no la aceptó: $(Leer-Error $_)"; exit 1 }
  Nota "Para cambiarla después: editá $ruta y corré de nuevo este script con el mismo negocio (o la pestaña Asistente)."
}

<# Instagram con la app compartida de Zustro Labs: el cliente no necesita Facebook ni crear nada en Meta. #>
function Instagram-Compartida($neg) {
  $estado = Llamar GET "/estado"
  $app = @($estado.apps) | Where-Object { $_.compartida } | Sort-Object creado -Descending | Select-Object -First 1
  if (-not $app) {
    Aviso "Todavía no está creada la app de Instagram para clientes (se hace una sola vez, unos 10 minutos)."
    if (-not (SiNo "¿La creamos ahora?")) { return $false }
    & "$PSScriptRoot\instagram-app-clientes.ps1" -Worker $Worker
    $estado = Llamar GET "/estado"
    $app = @($estado.apps) | Where-Object { $_.compartida } | Sort-Object creado -Descending | Select-Object -First 1
    if (-not $app) { Falla "Sigue sin estar registrada."; return $false }
  }
  Nota "Lo que tiene que tener el cliente (si no, lo hace ahora desde su celular):"
  Nota "a) Cuenta de Instagram PROFESIONAL (Empresa o Creador): Configuración → Tipo de cuenta y herramientas."
  Nota "b) Configuración → Mensajes y respuestas a historias → Controles de mensajes → Herramientas conectadas →"
  Nota "   «Permitir acceso a los mensajes» ENCENDIDO (Meta lo apaga solo a veces)."
  $usuario = ""
  if ($neg.invitacionIg -and $neg.invitacionIg.usuario) { $usuario = $neg.invitacionIg.usuario; Nota "Pidió la invitación para @$usuario desde la app." }
  $otro = (Read-Host "  Usuario de Instagram del negocio, sin @ (Enter = $usuario)").Trim().TrimStart('@')
  if ($otro) { $usuario = $otro }
  if ($usuario -notmatch '^[A-Za-z0-9._]{1,30}$') { Falla "Ese usuario no parece de Instagram."; return $false }
  Set-Clipboard -Value $usuario
  Write-Host ""
  Nota "1) Agregalo como evaluador de la app (el usuario quedó copiado): Add People → «Instagram Tester» → pegar → Add."
  Abrir "https://developers.facebook.com/apps/$($app.id)/roles/roles/"
  Seguir "Apretá Enter cuando esté agregado"
  Nota "2) El cliente acepta, entrado con la cuenta del negocio: instagram.com/accounts/manage_access →"
  Nota "   pestaña «Invitaciones de evaluador» → Aceptar."
  try { $link = (Llamar POST ("/negocios/" + $neg.id + "/instagram-link")).url } catch { Falla "No pude armar el link: $(Leer-Error $_)"; return $false }
  Set-Clipboard -Value $link
  Nota "3) El link para conectar quedó copiado (vale 1 hora): que lo abra donde está entrado en Instagram → Permitir."
  Nota "   (También puede apretar «Conectar Instagram» en su pestaña Instagram de $script:App.)"
  $antes = @($neg.cuentas).Count
  $listo = Esperar "Espero la cuenta conectada" 30 { $x = Leer-Negocio $neg.id; if (@($x.cuentas).Count -gt $antes) { $x } }
  if (-not $listo) { Aviso "Todavía no se conectó. El semáforo lo va a marcar; el link se puede volver a pedir corriendo el script de nuevo."; return $false }
  Ok "Instagram conectado y vinculado a «$($neg.nombre)»."
  return $true
}

function WhatsApp-Negocio($neg) {
  Nota "Necesita: su número en la app WhatsApp Business (2.24.17 o más nueva), una copia de seguridad de las charlas, y"
  Nota "su cuenta GRATIS de YCloud (es suya: así no hace falta que seamos empresa verificada ante Meta)."
  Nota "[1] Lo conecta el cliente solo en su pestaña WhatsApp de la app (recomendado: su clave nunca pasa por nosotros)"
  Nota "[2] Lo cargo yo ahora con su clave de API de YCloud (el cliente la escribe acá, no se muestra)"
  $op = Read-Host "  Elegí 1 o 2"
  if ($op -eq "2") {
    & "$PSScriptRoot\whatsapp-cliente.ps1" -Negocio $neg.id -Worker $Worker -DesdeAlta
    return
  }
  Nota "Pasos para el cliente (en la compu, con el celular a mano):"
  Nota "1) Crear la cuenta en YCloud (gratis):"
  Abrir "https://www.ycloud.com/console#/entry/register"
  Nota "2) WhatsApp → Create Channel → «WhatsApp Business APP Coexistence» → conectar con el QR desde la app de"
  Nota "   WhatsApp Business del celular. Elegir sincronizar los últimos 6 meses. El nombre, igual que en sus papeles."
  Nota "3) Developers → API Keys → copiar la clave."
  Nota "4) En $script:App → su negocio → pestaña WhatsApp: su número con código de país, la clave y «Conectar»."
  Nota "Ojo: WhatsApp para Windows no funciona con coexistencia (web.whatsapp.com sí); abrir la app cada 14 días."
  $listo = Esperar "Espero el número conectado" 30 { @((Llamar GET "/ycloud").numeros) | Where-Object { $_.negocio -eq $neg.id } | Select-Object -First 1 }
  if ($listo) { Ok "WhatsApp conectado: $($listo.numero)." } else { Aviso "Todavía no se conectó. El semáforo lo va a marcar." }
}

function Mensaje-Bienvenida($neg, $conIg, $conWa) {
  $l = @()
  $l += "¡Hola! Ya está listo el asistente de $($neg.nombre)."
  $l += ""
  $l += "• Tu app: $script:App. Entrás con tu correo ($((@($neg.emails)) -join ', ')): te llega un código, sin contraseña."
  $l += "  Ahí cargás y actualizás tus productos y el stock (también desde Excel). El asistente los mira antes de responder."
  if ($conWa) {
    $l += "• WhatsApp: seguís usando tu app de WhatsApp Business como siempre. Si contestás vos una charla, el asistente se calla en esa charla por un rato."
    $l += "  Importante: abrí la app de WhatsApp Business al menos una vez cada 14 días (si no, Meta corta la conexión). WhatsApp para Windows no funciona con esto; web.whatsapp.com sí."
  }
  if ($conIg) {
    $l += "• Instagram: no apagues «Permitir acceso a los mensajes» (Configuración → Mensajes y respuestas a historias → Herramientas conectadas)."
  }
  $l += "• Si alguien escribe PERSONA, el asistente se calla y te avisa."
  $l += ""
  $l += "Si algo no responde, escribinos a contact@zustrolabs.com y lo revisamos."
  return ($l -join "`r`n")
}

# ── 0. El Worker ──
if ($Verificar) { Titulo "Zustro Labs · Semáforo de un negocio" } else { Titulo "Zustro Labs · Alta de un cliente (10 a 15 minutos)" }
Paso 0 "Reviso el Worker ($Worker)"
$estado = Conectar-Worker
[Environment]::SetEnvironmentVariable("ZL_IG_ADMIN_CLAVE", $script:ClaveAdmin, "Process")

if ($Verificar) {
  Paso 1 "¿Qué negocio?"
  $neg = Elegir-Negocio
  [void](Semaforo $neg)
  exit 0
}

# ── 1. El negocio ──
Paso 1 "El negocio y quién entra a la app"
Nota "Necesitás al cliente al lado (o compartiendo pantalla) con: su celular, su lista de productos (Excel si tiene)"
Nota "y los correos de quienes van a entrar a la app."
$lista = @((Llamar GET "/negocios").negocios)
$neg = $null
if ($lista.Count -and (SiNo "¿Es un negocio que ya está en la app (seguir con uno a medio dar de alta)?")) { $neg = Elegir-Negocio }
if ($neg) {
  $conIg = [bool]$neg.canales.instagram; $conWa = [bool]$neg.canales.whatsapp
  Ok "Sigo con «$($neg.nombre)»."
} else {
  $nombre = (Read-Host "  Nombre del negocio (como lo dice el cliente)").Trim()
  if (-not $nombre) { Falla "Falta el nombre."; exit 1 }
  $correos = Read-Host "  Correos de quienes van a entrar a la app (dueño, empleados; separados por coma)"
  Write-Host ""
  Write-Host "  ¿Qué canales contrató?" -ForegroundColor White
  Nota "[1] Instagram   [2] WhatsApp   [3] Los dos"
  $op = Read-Host "  Elegí 1, 2 o 3"
  $conIg = $op -eq "1" -or $op -eq "3"
  $conWa = $op -eq "2" -or $op -eq "3"
  if (-not ($conIg -or $conWa)) { Falla "Opción inválida."; exit 1 }
  try {
    $neg = Llamar POST "/negocios" @{ nombre = $nombre; emails = $correos; canales = @{ instagram = [bool]$conIg; whatsapp = [bool]$conWa } }
    Ok "Negocio «$($neg.nombre)» creado."
  } catch { Falla "No pude crear el negocio: $(Leer-Error $_)"; exit 1 }
  Mostrar-Acceso $neg.acceso $correos
}

# ── 2. La ficha ──
Paso 2 "La ficha (qué sabe y cómo habla el asistente)"
Nota "Lo que más importa: el menú, los horarios, cómo se pide y cuándo pasar a una persona. Los productos van en la app."
Ficha-Negocio $neg

# ── 3. Instagram ──
if ($conIg) {
  Paso 3 "Instagram"
  Nota "[1] Con la app de Zustro Labs para clientes (recomendado: el cliente no necesita Facebook, unos 5 minutos)"
  Nota "[2] Con una app de Meta del propio cliente (si ya la tiene, o si la compartida llegó a 50 cuentas; 20 minutos)"
  if ((Read-Host "  Elegí 1 o 2") -eq "2") {
    & "$PSScriptRoot\instagram-cliente.ps1" -Negocio $neg.id -Worker $Worker -DesdeAlta -SinFicha
  } else { [void](Instagram-Compartida $neg) }
}

# ── 4. WhatsApp ──
if ($conWa) {
  Paso 4 "WhatsApp (sigue usando su app y su número; no pierde las charlas)"
  WhatsApp-Negocio $neg
}

# ── 5. Productos ──
Paso 5 "Productos"
Paso-Productos $neg.nombre
Seguir "Apretá Enter cuando estén cargados (o para seguir sin productos)"

# ── 6. El semáforo ──
Paso 6 "Semáforo: reviso que todo esté bien"
$neg = Leer-Negocio $neg.id
$verde = Semaforo $neg

# ── 7. Bienvenida ──
Paso 7 "Mensaje para el cliente"
$msg = Mensaje-Bienvenida $neg $conIg $conWa
Set-Clipboard -Value $msg
Write-Host ""
foreach ($linea in ($msg -split "`r`n")) { Write-Host ("    │ " + $linea) -ForegroundColor White }
Write-Host ""
Nota "Quedó copiado: pegalo en un mail o un mensaje al cliente."

Titulo $(if ($verde) { "Listo" } else { "Quedó pendiente" })
$min = [int][Math]::Floor(((Get-Date) - $script:Inicio).TotalMinutes)
$canales = @(); if ($conIg) { $canales += "Instagram" }; if ($conWa) { $canales += "WhatsApp" }
Nota "Negocio: $($neg.nombre) · canales: $($canales -join ' y ') · $min minutos"
Nota "Última prueba, la real: desde OTRO celular o cuenta, mandá «hola» al negocio."
if (-not $verde) { Nota "Cuando arregles lo que falta:  .\alta.ps1 -Verificar" }
[Environment]::SetEnvironmentVariable("ZL_IG_ADMIN_CLAVE", $null, "Process")
$env:ZL_INICIO = $null
