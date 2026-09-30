# GS Prime ERP · actualización en un paso (Windows)
# Lo ejecuta actualizar.cmd (doble clic). Descarga la última versión desde GitHub,
# reemplaza el código de esta carpeta (conserva .clasp.json), la sube con clasp
# y actualiza la implementación de la aplicación web para que el link siga igual.

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$rama = 'claude/erp-proyecto-profesional-sexsdd'
$zipUrl = "https://github.com/CristianSanMartin/Cristian/archive/refs/heads/$rama.zip"
$erp = $PSScriptRoot
# Si el script quedó en la carpeta de arriba, usa la subcarpeta erp.
if (-not (Test-Path (Join-Path $erp '.clasp.json')) -and (Test-Path (Join-Path $erp 'erp\.clasp.json'))) { $erp = Join-Path $erp 'erp' }
$archivoImpl = Join-Path $erp '.implementacion'

function Paso($n, $texto) { Write-Host ''; Write-Host "[$n/4] $texto" -ForegroundColor Cyan }

if (-not (Test-Path (Join-Path $erp '.clasp.json'))) {
  throw "No encuentro .clasp.json en $erp. Pon actualizar.cmd y actualizar.ps1 en la carpeta erp que tiene tu .clasp.json."
}
if (-not (Get-Command clasp -ErrorAction SilentlyContinue)) {
  throw 'No encuentro clasp. Instálalo con: npm install -g @google/clasp  y luego: clasp login'
}

Paso 1 'Descargando la última versión desde GitHub...'
$tmp = Join-Path $env:TEMP ('gsprime-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
Invoke-WebRequest -Uri $zipUrl -OutFile (Join-Path $tmp 'erp.zip') -UseBasicParsing
Expand-Archive -Path (Join-Path $tmp 'erp.zip') -DestinationPath $tmp
$nuevoErp = Join-Path (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName 'erp'
$config = Get-Content (Join-Path $nuevoErp 'src\server\00_Config.js') -Raw
$version = if ($config -match "version:\s*'([^']+)'") { $Matches[1] } else { '?' }
Write-Host "    Versión descargada: $version"

Paso 2 'Reemplazando el código de esta carpeta (se conserva .clasp.json)...'
# src se deja idéntico a la versión nueva (borra archivos que ya no existen);
# el resto solo se sobrescribe. actualizar.cmd no se toca porque es el que está corriendo.
robocopy (Join-Path $nuevoErp 'src') (Join-Path $erp 'src') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'No se pudo copiar la carpeta src.' }
robocopy $nuevoErp $erp /E /XD src /XF actualizar.cmd .clasp.json .implementacion /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'No se pudieron copiar los archivos.' }
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

Push-Location $erp
try {
  Paso 3 'Subiendo el código a Apps Script (clasp push)...'
  & clasp push -f
  if ($LASTEXITCODE -ne 0) { throw 'clasp push falló. Si dice que no has iniciado sesión, ejecuta: clasp login' }

  Paso 4 'Publicando la nueva versión en la aplicación web...'
  $id = if (Test-Path $archivoImpl) { (Get-Content $archivoImpl -Raw).Trim() } else { '' }
  if (-not $id) {
    $lista = (& clasp deployments | Out-String)
    $impls = @([regex]::Matches($lista, '-\s+(\S+)\s+@(\d+)(.*)') | ForEach-Object {
      [pscustomobject]@{ Id = $_.Groups[1].Value; Version = $_.Groups[2].Value; Nombre = $_.Groups[3].Value.Trim(' -') }
    })
    if ($impls.Count -eq 0) {
      Write-Host '    No encontré una implementación publicada. Créala una vez en el editor:' -ForegroundColor Yellow
      Write-Host '    Implementar > Nueva implementación > Aplicación web. La próxima vez esto se hará solo.'
    } elseif ($impls.Count -eq 1) {
      $id = $impls[0].Id
    } else {
      Write-Host '    Encontré varias implementaciones:'
      for ($i = 0; $i -lt $impls.Count; $i++) { Write-Host ("      {0}) @{1} {2}" -f ($i + 1), $impls[$i].Version, $impls[$i].Nombre) }
      $n = [int](Read-Host '    ¿Cuál es la aplicación web que usas? (número)')
      $id = $impls[$n - 1].Id
    }
    if ($id) { Set-Content -Path $archivoImpl -Value $id }
  }
  if ($id) {
    & clasp deploy -i $id -d "v$version"
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo actualizar la implementación. Hazlo a mano: Implementar > Gestionar implementaciones > editar > Versión nueva.' }
    Write-Host "    Listo: la aplicación web ya usa la versión $version (el link no cambia)." -ForegroundColor Green
  }
} finally {
  Pop-Location
}

Write-Host ''
Write-Host 'ÚLTIMO PASO (solo si la versión trae cambios de datos):' -ForegroundColor Yellow
Write-Host '  En la planilla: menú GS Prime ERP > Instalar / actualizar hojas'
Write-Host '  (o en el editor de Apps Script: función instalar > Ejecutar).'
Write-Host '  Si se te olvida, el ERP te avisa con "ERP sin instalar".'
