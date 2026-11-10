<#
Zustro Labs · cliente-nuevo.ps1 quedó reemplazado por alta.ps1 (ZL-138), que hace todo y termina con el semáforo.
Este archivo solo lo llama, para que nadie use el recorrido viejo por costumbre.
#>
param([string]$Worker = "https://zustrolabs.com")
& "$PSScriptRoot\alta.ps1" -Worker $Worker
