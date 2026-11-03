<#
Zustro Labs · funciones compartidas de los scripts de alta de clientes (ZL-122).
No se corre solo: lo cargan cliente-nuevo.ps1, instagram-cliente.ps1 y, cuando exista, whatsapp-cliente.ps1
con «. "$PSScriptRoot\comun.ps1"». Windows PowerShell 5.1 o más nuevo. Guardado con BOM (sin BOM, PowerShell 5.1
lee los acentos mal).
Secretos: se piden por teclado y no se muestran ni se guardan. Para no tipearlos cada vez, se pueden poner en las
variables de entorno de tu usuario de Windows ZL_IG_ADMIN_CLAVE, ZL_IG_CONECTAR_CLAVE y ZL_IG_VERIFY_TOKEN (nunca
en un archivo del repo).
#>

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if (-not $Worker) { $Worker = "https://zustrolabs.com" }
$script:Admin = "$Worker/api/instagram/admin"
$script:App = "https://negocios.zustrolabs.com"
# El reloj del alta: lo comparten cliente-nuevo.ps1 y los scripts de cada canal (variable de este proceso).
if ($env:ZL_INICIO) { $script:Inicio = [DateTime]::Parse($env:ZL_INICIO, [Globalization.CultureInfo]::InvariantCulture) }
else { $script:Inicio = Get-Date; $env:ZL_INICIO = $script:Inicio.ToString("o", [Globalization.CultureInfo]::InvariantCulture) }
$script:Fichas = Join-Path $PSScriptRoot "..\fichas"

function Titulo($t) { Write-Host ""; Write-Host ("═" * 72) -ForegroundColor DarkGray; Write-Host "  $t" -ForegroundColor Red; Write-Host ("═" * 72) -ForegroundColor DarkGray }
function Paso($n, $t) {
  $min = [int][Math]::Floor(((Get-Date) - $script:Inicio).TotalMinutes)
  Write-Host ""; Write-Host "[$n] $t" -ForegroundColor Yellow -NoNewline; Write-Host "   (minuto $min)" -ForegroundColor DarkGray
}
function Ok($t) { Write-Host "  ✔ $t" -ForegroundColor Green }
function Falla($t) { Write-Host "  ✘ $t" -ForegroundColor Red }
function Aviso($t) { Write-Host "  ! $t" -ForegroundColor Yellow }
function Nota($t) { Write-Host "  · $t" -ForegroundColor Gray }
function Abrir($url) { Write-Host "  → $url" -ForegroundColor Cyan; try { Start-Process $url | Out-Null } catch {} }
function Seguir($t = "Apretá Enter cuando esté hecho") { Write-Host ""; Read-Host "  $t" | Out-Null }
function SiNo($pregunta) { return ((Read-Host "  $pregunta (s/n)") -match '^[sS]') }

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
  $pedido = @{ Method = $metodo; Uri = "$script:Admin$ruta"; Headers = @{ Authorization = "Bearer $script:ClaveAdmin" }; ContentType = "application/json; charset=utf-8" }
  if ($cuerpo) { $pedido.Body = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $cuerpo -Compress -Depth 5)) }
  return Invoke-RestMethod @pedido
}

function Leer-Error($err) {
  $msg = $err.Exception.Message
  try { $d = $err.ErrorDetails.Message | ConvertFrom-Json; if ($d.error) { $msg = $d.error } } catch {}
  return $msg
}

# ── El Worker ──
function Conectar-Worker {
  $script:ClaveAdmin = Secreto "Clave de administración (IG_ADMIN_CLAVE)" "ZL_IG_ADMIN_CLAVE"
  try { $estado = Llamar GET "/estado" } catch {
    Falla "No pude leer el estado: $(Leer-Error $_)"
    Nota "¿La clave es la del secreto IG_ADMIN_CLAVE del Worker zustrolabs-whatsapp?"
    exit 1
  }
  $c = $estado.configurado
  foreach ($k in @("app_estudio", "verify", "link", "ia")) { if ($c.$k) { Ok "$k configurado" } else { Falla "$k SIN configurar" } }
  if (-not ($c.app_estudio -and $c.verify -and $c.link -and $c.ia)) {
    Falla "Faltan secretos en Cloudflare (Workers & Pages → zustrolabs-whatsapp → Settings → Variables and Secrets). Ver whatsapp/README.md."
    exit 1
  }
  return $estado
}

# ── El negocio (la misma lista de negocios.zustrolabs.com) ──
function Crear-Negocio($nombre, $correos, $instagram, $whatsapp) {
  try {
    $n = Llamar POST "/negocios" @{ nombre = $nombre; emails = $correos; canales = @{ instagram = [bool]$instagram; whatsapp = [bool]$whatsapp } }
    Ok "Negocio «$($n.nombre)» creado en la app."
    return $n
  } catch { Falla "No pude crear el negocio: $(Leer-Error $_)"; exit 1 }
}

function Elegir-Negocio {
  $lista = @((Llamar GET "/negocios").negocios)
  for ($i = 0; $i -lt $lista.Count; $i++) {
    $n = $lista[$i]
    $canales = @(); if ($n.canales.instagram) { $canales += "Instagram" }; if ($n.canales.whatsapp) { $canales += "WhatsApp" }
    Nota ("[" + ($i + 1) + "] " + $n.nombre + "  (" + ($canales -join " y ") + "; " + @($n.cuentas).Count + " cuenta(s) de Instagram)")
  }
  Nota "[N] Uno nuevo"
  $r = Read-Host "  ¿Cuál?"
  if ($r -match '^[nN]$' -or -not $lista.Count) {
    $nombre = Read-Host "  Nombre del negocio (como lo dice el cliente)"
    $correos = Read-Host "  Correos de quienes van a entrar a la app (separados por coma)"
    return (Crear-Negocio $nombre $correos $true $false)
  }
  $k = 0; [void][int]::TryParse($r, [ref]$k)
  if ($k -lt 1 -or $k -gt $lista.Count) { Falla "Número inválido."; exit 1 }
  return $lista[$k - 1]
}

function Vincular-Cuenta($negocio, $cuentaId, $canal) {
  $n = @((Llamar GET "/negocios").negocios) | Where-Object { $_.id -eq $negocio.id } | Select-Object -First 1
  $cuentas = @($n.cuentas) + @($cuentaId) | Select-Object -Unique
  $canales = @{ instagram = [bool]$n.canales.instagram; whatsapp = [bool]$n.canales.whatsapp }
  $canales[$canal] = $true
  try {
    Llamar PUT ("/negocios/" + $n.id) @{ cuentas = @($cuentas); canales = $canales } | Out-Null
    Ok "Cuenta vinculada a «$($n.nombre)» y canal $canal encendido."
  } catch { Falla "No pude vincular la cuenta: $(Leer-Error $_)"; exit 1 }
}

# ── La ficha del negocio ──
function Sin-Acentos($s) {
  $d = $s.Normalize([Text.NormalizationForm]::FormD)
  return (-join ($d.ToCharArray() | Where-Object { [Globalization.CharUnicodeInfo]::GetUnicodeCategory($_) -ne 'NonSpacingMark' }))
}

<# Arma fichas\clientes\<negocio>.md desde la plantilla (si no existe) con el nombre ya puesto, y la abre en el Bloc de
   notas para completarla con el cliente. Devuelve la ruta. #>
function Preparar-Ficha($nombre) {
  $slug = ((Sin-Acentos $nombre).ToLower() -replace '[^a-z0-9]+', '-').Trim('-')
  $dir = Join-Path $script:Fichas "clientes"
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $ruta = Join-Path $dir "$slug.md"
  if (-not (Test-Path $ruta)) {
    $t = [IO.File]::ReadAllText((Join-Path $script:Fichas "PLANTILLA.md"), [Text.Encoding]::UTF8)
    $t = $t.Replace("- Nombre: [COMPLETAR nombre del negocio]", "- Nombre: $nombre")
    [IO.File]::WriteAllText($ruta, $t, (New-Object Text.UTF8Encoding $false))
    Ok "Ficha nueva: $ruta (desde la plantilla, con el nombre puesto)."
  } else { Nota "Ya había una ficha: $ruta" }
  Nota "Se abre en el Bloc de notas. Completala con el cliente: todo lo que diga [COMPLETAR …]. Guardá y cerrá para seguir."
  Nota "Lo que más importa: el menú, los horarios, cómo se pide y cuándo pasar a una persona. Los productos van en la app."
  Start-Process notepad.exe -ArgumentList "`"$ruta`"" -Wait
  return $ruta
}

function Mostrar-Revision($r) {
  if ($r.errores -and $r.errores.Count) { foreach ($e in $r.errores) { Falla $e }; return $false }
  Ok ("Ficha de «" + $r.nombre + "» · idioma " + $r.idioma + " · trato " + $r.trato + " · precios " + $(if ($r.precios) { "sí" } else { "no" }) + " · pausa " + $r.pausaHoras + " h")
  Nota "Menú:"; foreach ($o in $r.menu) { Nota ("   " + $o) }
  if ($r.pendientes -and $r.pendientes.Count) {
    Aviso ("Falta completar ([COMPLETAR …]): " + ($r.pendientes -join " · "))
    Nota "  Se puede probar y guardar apagada, pero no activar hasta completarla."
  }
  return $true
}
function Mostrar-Respuestas($item) {
  foreach ($t in $item.respuestas) { Write-Host ""; foreach ($l in ($t -split "`n")) { Write-Host ("    │ " + $l) -ForegroundColor White } }
  if ($item.notas -and $item.notas.Count) { Nota ("(controles: " + ($item.notas -join ", ") + ": se sacó algo que no estaba en la ficha ni en los productos)") }
}

<# Revisa la ficha, deja chatear de prueba (con los productos del negocio de esa cuenta), la carga y la activa. #>
function Flujo-Ficha($ruta, $cuentaId) {
  if (-not $ruta) { $ruta = Read-Host "  Ruta del archivo de la ficha (p. ej. ..\fichas\clientes\mi-negocio.md)" }
  $ruta = $ruta.Trim('"').Trim()
  if (-not (Test-Path $ruta)) { Falla "No encuentro $ruta"; exit 1 }
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

  if (-not $cuentaId) {
    $e = Llamar GET "/estado"
    $clientes = @($e.cuentas | Where-Object { $_.ficha -ne "estudio" })
    if (-not $clientes.Count) { Falla "No hay cuentas de clientes conectadas. Conectá la cuenta primero."; exit 1 }
    for ($i = 0; $i -lt $clientes.Count; $i++) {
      $f = $clientes[$i].ficha
      $estadoFicha = if (-not $f.tiene) { "sin ficha" } elseif ($f.activa) { "ficha activa: " + $f.nombre } else { "ficha apagada: " + $f.nombre }
      Nota ("[" + ($i + 1) + "] @" + $clientes[$i].username + "  (" + $estadoFicha + ")")
    }
    $k = 0; [void][int]::TryParse((Read-Host "  Número de la cuenta"), [ref]$k)
    if ($k -lt 1 -or $k -gt $clientes.Count) { Falla "Número inválido."; exit 1 }
    $cuentaId = $clientes[$k - 1].id
  }

  Write-Host ""
  Nota "Chat de prueba (no se manda nada a Instagram ni se guarda). Así saluda a alguien que escribe «hola»:"
  $p = Llamar POST "/ficha/probar" @{ texto = $texto; mensajes = @("hola"); cuenta = $cuentaId }
  Mostrar-Respuestas $p.charla[0]
  Write-Host ""
  Nota "Escribí como si fueras un cliente (un número del menú, una pregunta, PERSONA…). Enter vacío para terminar."
  while ($true) {
    $m = Read-Host "  Cliente"
    if (-not $m) { break }
    try {
      $p = Llamar POST "/ficha/probar" @{ texto = $texto; mensajes = @("hola", $m); cuenta = $cuentaId }
      Mostrar-Respuestas $p.charla[1]
    } catch { Falla "No pude probar: $(Leer-Error $_)" }
  }

  $activar = $false
  if ($rev.pendientes -and $rev.pendientes.Count) { Aviso "Como falta completar, se guarda APAGADA: no va a responder hasta que la actives." }
  else { $activar = SiNo "¿La dejo respondiendo a los clientes ahora?" }
  try {
    $r = Llamar PUT ("/cuentas/" + $cuentaId + "/ficha") @{ texto = $texto; activa = $activar }
    if ($activar) { Ok "Ficha cargada y ACTIVA en @$($r.cuenta)." } else { Ok "Ficha cargada APAGADA en @$($r.cuenta)." }
  } catch { Falla "El Worker no la aceptó: $(Leer-Error $_)"; exit 1 }
  Nota "Para cambiar algo después: editá el archivo y corré  .\instagram-cliente.ps1 -Ficha `"$ruta`"  (pisa la anterior)."
  Nota "También se edita en $script:App → Asistente (solo el equipo)."
}

# ── Lo que queda a mano: los correos en Access, y los productos ──
function Paso-Acceso($correos) {
  $lista = ($correos -split ',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  if (-not $lista) { Nota "Sin correos para agregar."; return }
  Set-Clipboard -Value ($lista -join "`r`n")
  Nota "Los correos quedaron copiados al portapapeles (uno por línea):"
  foreach ($c in $lista) { Write-Host "       $c" -ForegroundColor White }
  Nota "Cloudflare → Zero Trust → Access controls → Applications → «negocios» → Policies → «Negocios y equipo» →"
  Nota "Include → Emails → pegalos → Save. Sin esto, Access no los deja entrar a la app."
  Abrir "https://one.dash.cloudflare.com/"
  Seguir "Apretá Enter cuando estén agregados"
}

function Paso-Productos($nombre) {
  Nota "En $script:App (con tu correo) → elegí «$nombre» → Importar Excel (o + Nuevo producto)."
  Nota "Si el cliente tiene su lista en Excel: «Bajar planilla modelo» o su propio archivo; primero muestra qué va a pasar."
  Nota "El asistente consulta estos productos antes de cada respuesta: sin productos, solo usa la ficha."
  Abrir $script:App
}
