<#
Zustro Labs · alta completa de un cliente, en unos 30 minutos (Windows PowerShell 5.1 o más nuevo). ZL-122.

Pregunta qué canales contrató el negocio (Instagram, WhatsApp o ambos) y hace todo en orden:
  1. crea el negocio en negocios.zustrolabs.com con los correos de quienes van a entrar;
  2. corre el script de cada canal: instagram-cliente.ps1 (app de Meta del cliente, conexión, ficha, prueba) y
     whatsapp-cliente.ps1 (cuenta gratis del cliente en YCloud, con coexistencia: sigue usando su app y su número);
  3. los correos en Access (te los deja copiados) y los productos (Excel o a mano en la app).
Tiempos aproximados con el cliente al lado: datos 3 min · Instagram 15–20 min · ficha 5–10 min · Access y productos 5 min.

Uso: clic derecho → «Ejecutar con PowerShell», o en una ventana de PowerShell en esta carpeta:  .\cliente-nuevo.ps1
Si Windows dice que los scripts están deshabilitados:  Set-ExecutionPolicy -Scope Process Bypass
Antes de la primera vez, tené a mano: la clave IG_ADMIN_CLAVE, la clave del link IG_CONECTAR_CLAVE y la frase
IG_VERIFY_TOKEN (o cargalas en tus variables de entorno ZL_IG_ADMIN_CLAVE, ZL_IG_CONECTAR_CLAVE, ZL_IG_VERIFY_TOKEN).
#>
param([string]$Worker = "https://zustrolabs.com")

. "$PSScriptRoot\comun.ps1"
Titulo "Zustro Labs · Cliente nuevo (unos 30 minutos)"
Nota "Necesitás al cliente al lado (o compartiendo pantalla) con: su celular con Instagram, su Facebook y su lista de"
Nota "productos (Excel si tiene). Todo lo que se pueda hacer solo, lo hace el script."

# ── 0. El Worker ──
Paso 0 "Reviso el Worker"
$estado = Conectar-Worker
# Los scripts de cada canal usan la misma clave sin volver a pedirla.
[Environment]::SetEnvironmentVariable("ZL_IG_ADMIN_CLAVE", $script:ClaveAdmin, "Process")

# ── 1. Datos del negocio ──
Paso 1 "Datos del negocio"
$nombre = (Read-Host "  Nombre del negocio (como lo dice el cliente)").Trim()
if (-not $nombre) { Falla "Falta el nombre."; exit 1 }
$correos = Read-Host "  Correos de quienes van a entrar a la app (dueño, empleados; separados por coma)"
Write-Host ""
Write-Host "  ¿Qué canales contrató?" -ForegroundColor White
Nota "[1] Instagram"
Nota "[2] WhatsApp (su número de WhatsApp Business, por YCloud)"
Nota "[3] Los dos"
$op = Read-Host "  Elegí 1, 2 o 3"
$conIg = $op -eq "1" -or $op -eq "3"
$conWa = $op -eq "2" -or $op -eq "3"
if (-not ($conIg -or $conWa)) { Falla "Opción inválida."; exit 1 }
$neg = Crear-Negocio $nombre $correos $conIg $conWa

# ── 2. Los canales ──
if ($conIg) {
  Paso 2 "Instagram"
  & "$PSScriptRoot\instagram-cliente.ps1" -Negocio $neg.id -Worker $Worker -DesdeAlta
  if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { Falla "Instagram no terminó. Cuando lo resuelvas: .\instagram-cliente.ps1 -Negocio $($neg.id)"; }
}
if ($conWa) {
  Paso 3 "WhatsApp"
  if (Test-Path "$PSScriptRoot\whatsapp-cliente.ps1") {
    & "$PSScriptRoot\whatsapp-cliente.ps1" -Negocio $neg.id -Worker $Worker -DesdeAlta
  } else {
    Aviso "WhatsApp todavía está en prueba: el negocio quedó con WhatsApp elegido, pero sin número conectado."
    Nota "Cuando esté probado con un número nuestro, se agrega con  .\whatsapp-cliente.ps1 -Negocio $($neg.id)"
    Nota "Lo que el cliente va a necesitar: su número de WhatsApp Business (la app, sigue usándola) y abrir su cuenta"
    Nota "gratis en YCloud (la conecta con un QR). Así no hace falta que seamos empresa verificada ante Meta."
  }
}

# ── 4. Quién entra y los productos ──
Paso 4 "Quién entra a la app y los productos"
Paso-Acceso $correos
Paso-Productos $nombre

Titulo "Listo"
$min = [int][Math]::Floor(((Get-Date) - $script:Inicio).TotalMinutes)
$canales = @(); if ($conIg) { $canales += "Instagram" }; if ($conWa) { $canales += "WhatsApp" }
Nota "Negocio: $nombre · canales: $($canales -join ' y ') · $min minutos"
Nota "El cliente entra a $script:App con su correo (le llega un código) y ve solo su negocio."
[Environment]::SetEnvironmentVariable("ZL_IG_ADMIN_CLAVE", $null, "Process")
$env:ZL_INICIO = $null
