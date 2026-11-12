#Requires -Version 5.1
<#
.SYNOPSIS
  Crea .env a partir de .env.example con contraseñas y tokens aleatorios.
.DESCRIPTION
  No sobrescribe un .env existente salvo con -Forzar.
  Uso: .\scripts\init-env.ps1
  Si PowerShell bloquea el script: powershell -ExecutionPolicy Bypass -File .\scripts\init-env.ps1
#>
param([switch]$Forzar)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$plantilla = Join-Path $raiz '.env.example'
$destino = Join-Path $raiz '.env'

if ((Test-Path -LiteralPath $destino) -and -not $Forzar) {
    Write-Host 'Ya existe .env y no se modificó.'
    Write-Host "Para regenerarlo use -Forzar; después borre los volúmenes con 'docker compose down -v',"
    Write-Host 'porque InfluxDB y Grafana conservan las credenciales de la primera ejecución.'
    exit 1
}

# Caracteres alfanuméricos con un generador criptográfico. Se descartan los bytes
# >= 248 (62 x 4) para que todos los caracteres tengan la misma probabilidad.
function Get-Aleatorio([int]$Largo) {
    $alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    $generador = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $byte = New-Object byte[] 1
    $texto = New-Object System.Text.StringBuilder
    try {
        while ($texto.Length -lt $Largo) {
            $generador.GetBytes($byte)
            if ($byte[0] -lt 248) { [void]$texto.Append($alfabeto[$byte[0] % 62]) }
        }
    } finally {
        $generador.Dispose()
    }
    return $texto.ToString()
}

$tokenAdmin = Get-Aleatorio 64
$valores = @{
    INFLUX_ADMIN_PASSWORD  = Get-Aleatorio 24
    INFLUX_ADMIN_TOKEN     = $tokenAdmin
    NODERED_INFLUX_TOKEN   = $tokenAdmin
    GRAFANA_INFLUX_TOKEN   = $tokenAdmin
    NR_ADMIN_PASSWORD      = Get-Aleatorio 20
    NR_CREDENTIAL_SECRET   = Get-Aleatorio 40
    GRAFANA_ADMIN_PASSWORD = Get-Aleatorio 20
}

$lineas = foreach ($linea in (Get-Content -LiteralPath $plantilla -Encoding UTF8)) {
    $clave = ($linea -split '=', 2)[0]
    if ($linea -match '=' -and $valores.ContainsKey($clave)) { "$clave=$($valores[$clave])" } else { $linea }
}

# UTF-8 sin BOM y saltos de línea LF: Docker Compose lee el archivo sin sorpresas.
$utf8SinBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($destino, (($lineas -join "`n") + "`n"), $utf8SinBom)

Write-Host 'Se creó .env con credenciales aleatorias.'
Write-Host "Usuarios: Node-RED y Grafana 'admin'. Consulte las contraseñas con:"
Write-Host "  Select-String -Path .env -Pattern 'NR_ADMIN_PASSWORD|GRAFANA_ADMIN_PASSWORD'"
