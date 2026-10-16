# Revisión de Proformas · publicar la web en un paso (Windows)
# Lo ejecuta actualizar.cmd (doble clic). Descarga la última versión desde GitHub,
# la sube a tu proyecto de Apps Script con clasp y actualiza la implementación
# de la aplicación web para que el link siga igual.

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repo = 'CristianSanMartin/Cristian'
# Versión de este actualizador: solo se reemplaza por uno descargado con número mayor.
$versionActualizador = 2

$carpeta = $PSScriptRoot
$archivoClasp = Join-Path $carpeta '.clasp.json'
$archivoImpl = Join-Path $carpeta '.implementacion'
$src = Join-Path $carpeta 'src'

function Paso($n, $texto) { Write-Host ''; Write-Host "[$n/5] $texto" -ForegroundColor Cyan }

if (-not (Get-Command clasp -ErrorAction SilentlyContinue)) {
  throw 'No encuentro clasp. Instálalo con: npm install -g @google/clasp  y luego: clasp login'
}

# La primera vez pide el ID del proyecto de Apps Script y crea .clasp.json.
if (-not (Test-Path $archivoClasp)) {
  Write-Host 'Primera vez: necesito el ID de tu proyecto de Apps Script.' -ForegroundColor Yellow
  Write-Host '  En el editor de Apps Script: Configuración del proyecto (engranaje) > ID de secuencia de comandos.'
  Write-Host '  También sirve pegar el link del editor completo.'
  $entrada = (Read-Host '  Pega aquí el ID').Trim()
  $scriptId = if ($entrada -match '/projects/([A-Za-z0-9_-]+)') { $Matches[1] } else { $entrada }
  if ($scriptId -notmatch '^[A-Za-z0-9_-]{20,}$') { throw "Eso no parece un ID de Apps Script: $entrada" }
  [IO.File]::WriteAllText($archivoClasp, (@{ scriptId = $scriptId; rootDir = 'src' } | ConvertTo-Json))
}
$clasp = Get-Content $archivoClasp -Raw | ConvertFrom-Json
if ($clasp.rootDir -ne 'src') {
  $clasp | Add-Member -NotePropertyName rootDir -NotePropertyValue 'src' -Force
  [IO.File]::WriteAllText($archivoClasp, ($clasp | ConvertTo-Json))
}
if (-not (Test-Path $src)) { New-Item -ItemType Directory -Path $src | Out-Null }

Paso 1 'Buscando la última versión en GitHub...'
# Se publica la rama con el cambio más reciente en la carpeta apps-script (la web),
# así no hay que decirle al programa cuál es la rama nueva.
$api = "https://api.github.com/repos/$repo"
# (el "| ForEach-Object" separa la lista: en PowerShell 7 Invoke-RestMethod la entrega como un solo objeto)
try { $todas = @(Invoke-RestMethod -Uri "$api/branches?per_page=100" -UseBasicParsing | ForEach-Object { $_ }) }
catch { throw 'No pude leer el repositorio en GitHub. Revisa tu conexión a internet.' }
$mejor = $null
foreach ($b in $todas) {
  $c = @(Invoke-RestMethod -Uri "$api/commits?sha=$([uri]::EscapeDataString($b.name))&path=apps-script&per_page=1" -UseBasicParsing | ForEach-Object { $_ })
  if ($c.Count -eq 0 -or -not $c[0].sha) { continue }
  $f = [datetime]$c[0].commit.committer.date
  if (-not $mejor -or $f -gt $mejor.Fecha) { $mejor = [pscustomobject]@{ Rama = $b.name; Sha = $b.commit.sha; Fecha = $f; Mensaje = $c[0].commit.message } }
}
if (-not $mejor) { throw 'No encontré la carpeta apps-script en ninguna rama del repositorio.' }
$rama = $mejor.Rama
$sha = $mejor.Sha
$version = "$($mejor.Fecha.ToLocalTime().ToString('yyyy-MM-dd HH:mm')) $($sha.Substring(0, 7))"
Write-Host "    Rama: $rama"
Write-Host "    Versión: $version - $(($mejor.Mensaje -split "`n")[0])"

Paso 2 'Descargando...'
$tmp = Join-Path $env:TEMP ('proformas-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
Invoke-WebRequest -Uri "https://github.com/$repo/archive/$sha.zip" -OutFile (Join-Path $tmp 'web.zip') -UseBasicParsing
Expand-Archive -Path (Join-Path $tmp 'web.zip') -DestinationPath $tmp
$raiz = (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName
$nuevo = Join-Path $raiz 'apps-script'
if (-not (Test-Path (Join-Path $nuevo 'index.html'))) { throw 'La descarga no trae la carpeta apps-script.' }
# src queda idéntico a apps-script del repo; solo se conserva tu appsscript.json.
robocopy $nuevo $src /MIR /XF appsscript.json /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'No se pudieron copiar los archivos.' }
# El actualizador se actualiza solo si la rama trae uno más nuevo (sirve desde la próxima vez).
$nuevoPs1 = Join-Path $raiz 'publicar\actualizar.ps1'
if (Test-Path $nuevoPs1) {
  $texto = Get-Content $nuevoPs1 -Raw
  $v = if ($texto -match '\$versionActualizador\s*=\s*(\d+)') { [int]$Matches[1] } else { 0 }
  if ($v -gt $versionActualizador) {
    Copy-Item $nuevoPs1 (Join-Path $carpeta 'actualizar.ps1') -Force
    Write-Host "    El actualizador también se actualizó (versión $v)."
  }
}
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

Push-Location $carpeta
try {
  if (-not (Test-Path (Join-Path $src 'appsscript.json'))) {
    Paso 3 'Primera vez: copiando la configuración (appsscript.json) de tu proyecto...'
    # Se baja solo el manifiesto actual para no cambiar zona horaria, permisos ni acceso de la app web.
    $tmpPull = Join-Path $env:TEMP ('proformas-pull-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmpPull | Out-Null
    [IO.File]::WriteAllText((Join-Path $tmpPull '.clasp.json'), (@{ scriptId = $clasp.scriptId; rootDir = '.' } | ConvertTo-Json))
    Push-Location $tmpPull
    try { & clasp pull | Out-Null } finally { Pop-Location }
    if (-not (Test-Path (Join-Path $tmpPull 'appsscript.json'))) {
      throw 'No pude leer tu proyecto de Apps Script. Revisa el ID en .clasp.json, ejecuta clasp login con la cuenta dueña del proyecto y activa la API en https://script.google.com/home/usersettings'
    }
    Copy-Item (Join-Path $tmpPull 'appsscript.json') $src
    Remove-Item $tmpPull -Recurse -Force -ErrorAction SilentlyContinue
  } else {
    Paso 3 'Se conserva tu appsscript.json.'
  }

  Paso 4 'Subiendo el código a Apps Script (clasp push)...'
  & clasp push -f
  if ($LASTEXITCODE -ne 0) { throw 'clasp push falló. Si dice que no has iniciado sesión, ejecuta: clasp login' }

  Paso 5 'Publicando la nueva versión en la aplicación web...'
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
    # Google a veces responde "The service is currently unavailable": se reintenta unas veces.
    for ($intento = 1; $intento -le 4; $intento++) {
      & clasp deploy -i $id -d "$version"
      if ($LASTEXITCODE -eq 0) { break }
      if ($intento -lt 4) {
        Write-Host "    Google no respondió (intento $intento de 4). Reintento en $(5 * $intento) segundos..." -ForegroundColor Yellow
        Start-Sleep -Seconds (5 * $intento)
      }
    }
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo actualizar la implementación. Hazlo a mano: Implementar > Gestionar implementaciones > editar > Versión nueva.' }
    Write-Host "    Listo: la aplicación web ya usa la versión $version (el link no cambia)." -ForegroundColor Green
  }
} finally {
  Pop-Location
}
