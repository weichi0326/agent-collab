param(
  [switch]$Repair
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Join-Path $Root 'app'
$PythonDir = Join-Path $Root 'python'
$VenvDir = Join-Path $PythonDir 'venv'
$VenvPython = Join-Path $VenvDir 'Scripts\python.exe'
$LocalNodeDir = Join-Path $Root '.devtools\node'

function Say($Text) {
  Write-Host "[start-check] $Text"
}

function HasCommand($Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Run($File, [string[]]$ArgumentList, $WorkingDirectory = $Root) {
  Say "> $File $($ArgumentList -join ' ')"
  Push-Location $WorkingDirectory
  try {
    & $File @ArgumentList
    if ($LASTEXITCODE -ne 0) {
      throw "Command failed with exit code ${LASTEXITCODE}: $File $($ArgumentList -join ' ')"
    }
  } finally {
    Pop-Location
  }
}

function AddPath($Path) {
  if ((Test-Path $Path) -and (($env:Path -split ';') -notcontains $Path)) {
    $env:Path = "$Path;$env:Path"
  }
}

function TestPythonExecutable($File, [string[]]$ArgumentList = @()) {
  if (-not (Test-Path $File)) { return $false }
  try {
    & $File @ArgumentList -c "import sys; print(sys.executable)" *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

function ResolvePythonCommand() {
  if (HasCommand 'python') {
    try {
      $v = (& python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
      if ($v -eq '3.12') { return [pscustomobject]@{ Exe = 'python'; Arguments = @() } }
    } catch {}
  }
  if (HasCommand 'py') {
    try {
      & py -3.12 -c "import sys" *> $null
      if ($LASTEXITCODE -eq 0) { return [pscustomobject]@{ Exe = 'py'; Arguments = @('-3.12') } }
    } catch {}
    try {
      $v = (& py -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null)
      if ($v -eq '3.12') { return [pscustomobject]@{ Exe = 'py'; Arguments = @() } }
    } catch {}
  }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'),
    (Join-Path $env:ProgramFiles 'Python312\python.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Python312\python.exe')
  )
  foreach ($candidate in $candidates) {
    if (-not (Test-Path $candidate)) { continue }
    try {
      $v = (& $candidate -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null)
      if ($v -eq '3.12') { return [pscustomobject]@{ Exe = $candidate; Arguments = @() } }
    } catch {}
  }
  return $null
}

function GetNpmCommand() {
  $local = Join-Path $LocalNodeDir 'npm.cmd'
  if (Test-Path $local) { return $local }
  $cmd = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

function GetTcpListeners($Port) {
  try {
    return @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop)
  } catch {
    return @()
  }
}

function GetText($Url) {
  try {
    return (Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2).Content
  } catch {
    return ''
  }
}

function NormalizePathText($Path) {
  if (-not $Path) { return '' }
  try {
    $resolved = [System.IO.Path]::GetFullPath($Path)
    return $resolved.TrimEnd('\').Replace('/', '\').ToLowerInvariant()
  } catch {
    return ''
  }
}

function GetCommandArgument($CommandLine, $Flag) {
  $pattern = '(?i)(?:^|\s)' + [regex]::Escape($Flag) + '\s+(?:"([^"]+)"|(\S+))'
  $match = [regex]::Match([string]$CommandLine, $pattern)
  if (-not $match.Success) { return '' }
  if ($match.Groups[1].Success) { return $match.Groups[1].Value }
  return $match.Groups[2].Value
}

function TestBackendProcessIdentity($ProcessId) {
  try {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
  } catch {
    return $false
  }
  if (-not $process) { return $false }

  $actualExe = NormalizePathText $process.ExecutablePath
  $expectedExe = NormalizePathText $VenvPython
  if (-not $actualExe -or $actualExe -ne $expectedExe) { return $false }

  $commandLine = ([string]$process.CommandLine).ToLowerInvariant()
  $expectedAppDir = NormalizePathText $PythonDir
  $actualAppDir = NormalizePathText (GetCommandArgument $process.CommandLine '--app-dir')
  $actualPort = GetCommandArgument $process.CommandLine '--port'
  return (
    [regex]::IsMatch($commandLine, '(?:^|\s)-m\s+uvicorn\s+app:app(?:\s|$)') -and
    $actualPort -eq '18081' -and
    $actualAppDir -eq $expectedAppDir
  )
}

function EnsureNodeReady() {
  AddPath $LocalNodeDir
  $npm = GetNpmCommand
  if (-not (HasCommand 'node') -or -not $npm) {
    throw "Node/npm is not available. Run the environment configurator first."
  }
  if (-not (Test-Path (Join-Path $AppDir 'node_modules\vite'))) {
    throw "Frontend dependency vite is missing. Run the environment configurator or npm install in app."
  }
  if (-not (Test-Path (Join-Path $AppDir 'node_modules\@tauri-apps\cli'))) {
    throw "Tauri CLI dependency is missing. Run the environment configurator or npm install in app."
  }
  Say "Node/npm and frontend dependencies are ready."
}

function TestBackendImport() {
  if (-not (TestPythonExecutable $VenvPython)) { return $false }
  Push-Location $PythonDir
  try {
    & $VenvPython -c "import uvicorn, fastapi, app; print('backend-import-ok')" *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  } finally {
    Pop-Location
  }
}

function RepairPythonVenv() {
  $cmd = ResolvePythonCommand
  if (-not $cmd) {
    throw "Python 3.12 is not available, so python\venv cannot be rebuilt. Install Python 3.12 with Add python.exe to PATH, then run the environment configurator."
  }
  Say "Rebuilding broken python\venv."
  $venvArgs = @($cmd.Arguments) + @('-m', 'venv')
  if (Test-Path $VenvPython) {
    $venvArgs += '--clear'
  }
  $venvArgs += $VenvDir
  Run $cmd.Exe $venvArgs
  Run $VenvPython @('-m', 'pip', 'install', '--upgrade', 'pip')
  Run $VenvPython @('-m', 'pip', 'install', '-r', (Join-Path $PythonDir 'requirements.txt'))
}

function EnsurePythonReady() {
  if (TestBackendImport) {
    Say "Python backend venv is ready."
    return
  }
  if (-not $Repair) {
    throw "python\venv is unusable or backend dependencies are broken. Run the environment configurator."
  }
  RepairPythonVenv
  if (-not (TestBackendImport)) {
    throw "python\venv was rebuilt, but backend imports still fail. Check python\requirements.txt and logs\python.log."
  }
  Say "Python backend venv repaired."
}

function EnsurePortsReady() {
  $frontListeners = GetTcpListeners 5173
  if ($frontListeners.Count -gt 0) {
    $body = GetText 'http://127.0.0.1:5173/'
    if ($body -notlike '*/src/main.tsx*' -or $body -notlike '*multi-agent-tool*') {
      $pids = ($frontListeners | Select-Object -ExpandProperty OwningProcess -Unique) -join ', '
      throw "Port 5173 is occupied by another service (PID: $pids). Close it and start again."
    }
    Say "Port 5173 already has this app's Vite server; it will be reused."
  }

  $backendListeners = GetTcpListeners 18081
  if ($backendListeners.Count -gt 0) {
    $listenerPids = @($backendListeners | Select-Object -ExpandProperty OwningProcess -Unique)
    $ownedPids = @($listenerPids | Where-Object { TestBackendProcessIdentity $_ })
    if ($ownedPids.Count -eq $listenerPids.Count) {
      Say "Port 18081 is owned by this project's exact Python interpreter and app directory; the app will reuse or replace it."
      return
    }
    $pids = $listenerPids -join ', '
    throw "Port 18081 is occupied by a process whose interpreter or --app-dir does not match this project (PID: $pids). It will not be terminated automatically."
  }
}

try {
  AddPath (Join-Path $env:USERPROFILE '.cargo\bin')
  EnsureNodeReady
  EnsurePythonReady
  EnsurePortsReady
  Say "Preflight passed."
  exit 0
} catch {
  Write-Host "[start-check] FAILED: $($_.Exception.Message)"
  exit 1
}
