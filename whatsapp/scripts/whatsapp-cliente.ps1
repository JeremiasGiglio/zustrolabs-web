<#
Zustro Labs · WhatsApp de un cliente, de punta a punta (Windows PowerShell 5.1 o más nuevo). ZL-135.

Deja el número de WhatsApp Business de un negocio respondiendo con SU ficha y SUS productos, a través de la cuenta
gratis de YCloud DEL CLIENTE, con coexistencia: el cliente sigue usando su app de WhatsApp Business con el mismo
número y no pierde sus charlas. Unos 15 minutos con el cliente al lado:
  0. revisa el Worker;                          5. el número y la conexión con el Worker (crea el webhook solo);
  1. el negocio;                                6. la ficha (tiene que estar activa);
  2. lo que el cliente tiene que saber;          7. la prueba real (espera el primer mensaje);
  3. la cuenta de YCloud y la coexistencia;      8. la prueba de la pausa (cuando el dueño contesta él);
  4. la clave de API (se pide sin mostrarla);    9. los correos en Access y los productos (si no viene de cliente-nuevo.ps1).
Lo que no puede hacer por vos: crear la cuenta de YCloud ni escanear el QR (es dentro de la cuenta y el celular del
cliente). Para eso te dice exactamente dónde y qué.

Uso (clic derecho → «Ejecutar con PowerShell», o en una ventana de PowerShell en esta carpeta):
  .\cliente-nuevo.ps1                 lo normal: alta completa, elige Instagram, WhatsApp o ambos
  .\whatsapp-cliente.ps1              solo WhatsApp (negocio nuevo o uno que ya está)
  .\whatsapp-cliente.ps1 -SoloEstado  ver qué números hay conectados
  .\whatsapp-cliente.ps1 -Desconectar sacar un número (borra el webhook en YCloud)
Si Windows dice que los scripts están deshabilitados: Set-ExecutionPolicy -Scope Process Bypass
Guía completa: whatsapp/WHATSAPP_CLIENTES.md · lo que ya falló y cómo evitarlo: whatsapp/FALLAS_Y_PREVENCION.md
#>
param(
  [string]$Negocio = "",
  [string]$Worker = "https://zustrolabs.com",
  [switch]$SoloEstado,
  [switch]$Desconectar,
  [switch]$DesdeAlta
)

. "$PSScriptRoot\comun.ps1"

function Numeros { return @((Llamar GET "/ycloud").numeros) }
function Nombre-De($id) {
  $n = @((Llamar GET "/negocios").negocios) | Where-Object { $_.id -eq $id } | Select-Object -First 1
  if ($n) { return $n.nombre } else { return "(negocio $id)" }
}

if (-not $DesdeAlta) { Titulo "Zustro Labs · WhatsApp de un cliente" }

# ── 0. El Worker ──
Paso 0 "Reviso el Worker ($Worker)"
$estado = Conectar-Worker
$conectados = Numeros
foreach ($x in $conectados) {
  $ult = if ($x.ultimo) { "último mensaje: " + ([DateTimeOffset]::FromUnixTimeMilliseconds([int64]$x.ultimo).LocalDateTime.ToString("dd/MM HH:mm")) } else { "todavía sin mensajes" }
  $eco = if ($x.ecos) { "se calla cuando contesta el dueño" } else { "SIN aviso cuando contesta el dueño" }
  Nota ("  " + $x.numero + "  ·  " + (Nombre-De $x.negocio) + "  ·  " + $ult + "  ·  " + $eco)
}
if (-not $conectados.Count) { Nota "  Todavía no hay números de WhatsApp conectados por YCloud." }
if ($SoloEstado) { exit 0 }

if ($Desconectar) {
  if (-not $conectados.Count) { exit 0 }
  for ($i = 0; $i -lt $conectados.Count; $i++) { Nota ("[" + ($i + 1) + "] " + $conectados[$i].numero + "  ·  " + (Nombre-De $conectados[$i].negocio)) }
  $k = 0; [void][int]::TryParse((Read-Host "  ¿Cuál sacás?"), [ref]$k)
  if ($k -lt 1 -or $k -gt $conectados.Count) { Falla "Número inválido."; exit 1 }
  $sel = $conectados[$k - 1]
  if (-not (SiNo "¿Seguro? El asistente deja de responder en $($sel.numero) (el cliente sigue usando su app normalmente)")) { exit 0 }
  try {
    $r = Llamar DELETE "/ycloud/$($sel.clave)"
    Ok "Desconectado. Webhook borrado en YCloud: $($r.webhookBorrado)"
  } catch { Falla "No pude desconectarlo: $(Leer-Error $_)"; exit 1 }
  exit 0
}

# ── 1. El negocio ──
Paso 1 "El negocio"
if ($Negocio) {
  $neg = @((Llamar GET "/negocios").negocios) | Where-Object { $_.id -eq $Negocio } | Select-Object -First 1
  if (-not $neg) { Falla "No encuentro el negocio $Negocio."; exit 1 }
  Ok "Negocio: $($neg.nombre)"
} else { $neg = Elegir-Negocio }
$Nombre = $neg.nombre

# ── 2. Lo que el cliente tiene que saber ──
Paso 2 "Lo que el cliente tiene que saber (leéselo o mandáselo antes de conectar)"
Nota "· Sigue usando su app de WhatsApp Business con el mismo número. Sus charlas NO se borran."
Nota "· Al conectar puede traer a YCloud los últimos 6 meses de charlas (para que el asistente tenga contexto)."
Nota "· En las charlas individuales dejan de andar: mensajes temporales, «ver una vez», ubicación en tiempo real y"
Nota "  listas de difusión (las que tiene quedan solo para leer). Los grupos siguen en la app, pero el asistente no los ve."
Nota "· Se desvinculan WhatsApp Web y las computadoras: después las vuelve a vincular. WhatsApp para Windows NO funciona"
Nota "  con esto: tiene que usar web.whatsapp.com."
Nota "· Tiene que abrir la app de WhatsApp Business al menos cada 14 días: si no, Meta corta la conexión."
Nota "· Cuando él contesta una charla desde su celular, el asistente se calla en esa charla unas horas."
Write-Host ""
Nota "Antes de seguir, en SU celular:"
Nota "a) Actualizar WhatsApp Business (versión 2.24.17 o más nueva) desde la tienda de apps."
Nota "b) Copia de seguridad: WhatsApp Business → Configuración → Chats → Copia de seguridad → Guardar."
Seguir "Apretá Enter cuando la app esté actualizada y con la copia hecha"

# ── 3. YCloud y la coexistencia ──
Paso 3 "La cuenta gratis de YCloud del cliente y la conexión del número (en SU computadora o compartiendo pantalla)"
Nota "1. Crear la cuenta (plan gratis, sin tarjeta), con el correo del cliente:"
Abrir "https://www.ycloud.com/console#/entry/register"
Nota "2. En la consola: WhatsApp accounts → Create Channel → «WhatsApp Business APP Coexistence» → Get started →"
Nota "   I'm ready to start → «Connect by QR code» (no hace falta Facebook)."
Nota "3. Nombre del negocio: EXACTAMENTE como figura en sus papeles (YCloud lo puede verificar después)."
Nota "   Sitio web: el suyo, o marcar «My business does not have a website or profile page»."
Nota "4. El número de WhatsApp Business → en el celular aparece para escanear el QR → autorizar → elegir SINCRONIZAR el"
Nota "   historial. Dejar la app ABIERTA hasta que termine (los mensajes nuevos aparecen recién después)."
Nota "5. Si la cuenta no aparece en YCloud después de autorizar: en el celular, desvincular YCloud y repetir el paso 2."
Seguir "Apretá Enter cuando el número figure en WhatsApp accounts de YCloud"

# ── 4. La clave de API ──
Paso 4 "La clave de API de la cuenta de YCloud del cliente"
Nota "En la consola de YCloud, la sección para desarrolladores (Developers) → API Keys → crear o copiar la clave."
Nota "Si no la encontrás: el buscador de la consola, «API key». La clave NO se muestra acá ni se guarda en la PC: va"
Nota "directo al Worker, que la usa para responder y para crear el webhook. Nunca la pegues en un chat."
$apiKey = (Secreto "Pegá la clave de API de YCloud (no se muestra)" $null).Trim()
if ($apiKey.Length -lt 16) { Falla "Esa clave es muy corta: copiala entera."; exit 1 }

# ── 5. El número y la conexión con el Worker ──
Paso 5 "El número y la conexión con el Worker"
Nota "El número de WhatsApp Business del cliente, con código de país (Argentina: +54 9 y el número sin 0 ni 15)."
$numero = (Read-Host "  Número (por ejemplo +54 9 341 123 4567)").Trim()
if (($numero -replace '[\s()-]', '') -notmatch '^\+?\d{8,15}$') { Falla "Ese número no tiene el formato internacional."; exit 1 }
try {
  $r = Llamar POST "/ycloud" @{ negocio = $neg.id; numero = $numero; apiKey = $apiKey }
  Ok "Conectado: $($r.numero) → «$Nombre». El webhook quedó creado en la cuenta de YCloud del cliente."
  if ($r.ecos) { Ok "Cuando el dueño conteste desde su celular, el asistente se va a callar en esa charla." }
  else {
    Aviso "YCloud no aceptó el aviso de las respuestas del dueño en esta cuenta: el asistente NO va a saber cuándo"
    Aviso "contesta él. Hasta resolverlo, el dueño puede pedirle al cliente que escriba PERSONA."
  }
  $clave = $r.clave
} catch { Falla "El Worker no pudo conectarlo: $(Leer-Error $_)"; exit 1 }
$apiKey = $null

# ── 6. La ficha ──
Paso 6 "La ficha del negocio (cómo habla el asistente)"
$activa = $false
for ($i = 0; $i -lt 3 -and -not $activa; $i++) {
  $n = @((Llamar GET "/negocios").negocios) | Where-Object { $_.id -eq $neg.id } | Select-Object -First 1
  $activa = [bool]$n.asistente.activo
  if ($activa) { Ok "La ficha de «$Nombre» está activa: el mismo asistente responde por Instagram y por WhatsApp." }
  else {
    Aviso "«$Nombre» todavía no tiene la ficha activa: sin ella, el número NO responde."
    Nota "En $script:App → «$Nombre» → pestaña Asistente: pegar la ficha (fichas/PLANTILLA.md), Revisar, probar y"
    Nota "Guardar con «Activa». (Si el negocio también tiene Instagram, es la misma ficha.)"
    Abrir $script:App
    Seguir "Apretá Enter cuando esté guardada con «Activa»"
  }
}
if (-not $activa) { Aviso "Sigo sin ficha activa: la prueba de abajo no va a recibir respuesta." }

# ── 7. Prueba real ──
Paso 7 "Prueba real"
Nota "Desde OTRO celular (no el del negocio), mandale «hola» al $($r.numero) por WhatsApp."
$desde = [DateTimeOffset]::Now.ToUnixTimeMilliseconds() - 60000
Write-Host "  Espero el mensaje (hasta 5 minutos)…" -ForegroundColor White
$fin = (Get-Date).AddMinutes(5); $llego = $false
while ((Get-Date) -lt $fin) {
  Start-Sleep -Seconds 10
  try { $x = Numeros | Where-Object { $_.clave -eq $clave } | Select-Object -First 1; if ($x -and $x.ultimo -and [int64]$x.ultimo -ge $desde) { $llego = $true; break } } catch {}
  Write-Host "." -NoNewline
}
Write-Host ""
if ($llego) { Ok "El mensaje llegó al Worker." }
else {
  Falla "No llegó nada en 5 minutos."
  Nota "· ¿El número figura en WhatsApp accounts de YCloud? ¿Terminó la sincronización (app abierta)?"
  Nota "· En YCloud → Developers → Webhooks tiene que estar el de zustrolabs.com, activo."
  Nota "· Cloudflare → Workers & Pages → zustrolabs-whatsapp → Observability, buscar «yc»: «firma» = el secreto no"
  Nota "  coincide (desconectar con -Desconectar y volver a conectar); nada = YCloud no está mandando."
}
if ($llego -and -not (SiNo "¿Llegó al otro celular el saludo y el menú del negocio?")) {
  Nota "Observability, buscar «yc»: «sin_ficha» o «ficha_inactiva» = la ficha; «canal_apagado» = WhatsApp apagado en"
  Nota "Administración; «ycloud 401» = la clave de API cambió o se borró; «limite» = muchos mensajes seguidos."
}
Nota "Probá también: un número del menú, una pregunta sobre un producto y «persona»."

# ── 8. La pausa ──
if ($r.ecos) {
  Paso 8 "La pausa cuando contesta el dueño"
  Nota "Desde el celular del NEGOCIO, contestá a mano esa misma charla. Después mandá otro mensaje desde el otro celular:"
  Nota "el asistente NO tiene que responder: se calla las «Horas de pausa» de la ficha, y cada mensaje nuevo del cliente"
  Nota "las renueva mientras siga la charla. Para que el asistente vuelva antes en esa charla, el cliente escribe BORRAR."
}

# ── 9. Access y productos (cliente-nuevo.ps1 lo hace una sola vez para todos los canales) ──
if (-not $DesdeAlta) {
  Paso 9 "Quién entra a la app y los productos"
  Paso-Acceso (($neg.emails) -join ",")
  Paso-Productos $Nombre
  Titulo "Listo"
  $min = [int][Math]::Floor(((Get-Date) - $script:Inicio).TotalMinutes)
  Nota "Negocio: $Nombre · WhatsApp $($r.numero) · $min minutos"
  Nota "Recordale al cliente: abrir WhatsApp Business al menos cada 14 días, y que WhatsApp para Windows no anda."
}
