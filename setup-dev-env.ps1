param(
  [switch]$CheckOnly,
  [switch]$SkipBuildTools,
  [switch]$SkipVerify
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Join-Path $Root 'app'
$PythonDir = Join-Path $Root 'python'
$VenvDir = Join-Path $PythonDir 'venv'
$VenvPython = Join-Path $VenvDir 'Scripts\python.exe'
$DevToolsDir = Join-Path $Root '.devtools'
$DownloadsDir = Join-Path $DevToolsDir 'downloads'
$LocalNodeDir = Join-Path $DevToolsDir 'node'
$CargoConfig = Join-Path $AppDir '.cargo\config.toml'
$TauriPythonDist = Join-Path $AppDir 'src-tauri\python-dist'

function Say($Text) {
  Write-Host "[setup] $Text"
}

function HasCommand($Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function EnsureDir($Path) {
  if (-not (Test-Path $Path)) {
    New-Item -ItemType Directory -Force $Path | Out-Null
  }
}

function AddPath($Path) {
  if ((Test-Path $Path) -and (($env:Path -split ';') -notcontains $Path)) {
    $env:Path = "$Path;$env:Path"
  }
}

function DownloadFile($Url, $Destination) {
  EnsureDir (Split-Path -Parent $Destination)
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

  $lastError = $null
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    if (Test-Path $Destination) { Remove-Item $Destination -Force }
    Say "Downloading $Url (attempt $attempt/3)"
    try {
      Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing -TimeoutSec 600
      if ((Test-Path $Destination) -and ((Get-Item $Destination).Length -gt 0)) { return }
      throw "Downloaded file is empty."
    } catch {
      $lastError = $_
      Say "PowerShell download failed: $($_.Exception.Message)"
      Start-Sleep -Seconds (2 * $attempt)
    }
  }

  if (HasCommand 'curl.exe') {
    for ($attempt = 1; $attempt -le 3; $attempt++) {
      if (Test-Path $Destination) { Remove-Item $Destination -Force }
      Say "Downloading with curl.exe (attempt $attempt/3)"
      & curl.exe -L --fail --retry 5 --retry-delay 2 --connect-timeout 30 --max-time 900 -o $Destination $Url
      if (($LASTEXITCODE -eq 0) -and (Test-Path $Destination) -and ((Get-Item $Destination).Length -gt 0)) { return }
      Start-Sleep -Seconds (2 * $attempt)
    }
  }

  if (HasCommand 'Start-BitsTransfer') {
    if (Test-Path $Destination) { Remove-Item $Destination -Force }
    Say "Downloading with BITS"
    try {
      Start-BitsTransfer -Source $Url -Destination $Destination -ErrorAction Stop
      if ((Test-Path $Destination) -and ((Get-Item $Destination).Length -gt 0)) { return }
    } catch {
      $lastError = $_
      Say "BITS download failed: $($_.Exception.Message)"
    }
  }

  throw "Failed to download $Url. Last error: $lastError"
}

function DownloadFirstAvailable([string[]]$Urls, $Destination) {
  $lastError = $null
  foreach ($url in $Urls) {
    try {
      DownloadFile $url $Destination
      return $url
    } catch {
      $lastError = $_
      Say "Download source failed, trying next source if available."
    }
  }
  throw "All download sources failed for $Destination. Last error: $lastError"
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

function TestPythonExecutable($File, [string[]]$ArgumentList = @()) {
  if (-not $File) { return $false }
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

function EnsurePython() {
  $cmd = ResolvePythonCommand
  if ($cmd) {
    $script = "import sys; print(sys.executable); print(sys.version)"
    $result = & $cmd.Exe @($cmd.Arguments) -c $script 2>$null
    Say "Python found: $($result[0])"
    Say "Python version: $($result[1])"
    return $cmd
  }

  if ($CheckOnly) {
    Say "Missing: Python 3.12. Please install Python first, then run this script."
    return $null
  }

  throw @"
Python 3.12 was not found.

This bootstrap assumes the user installs Python first. Install Python 3.12 from python.org,
check "Add python.exe to PATH" during installation, then run this script again.
"@
}

function GetNpmCommand() {
  if (Test-Path (Join-Path $LocalNodeDir 'npm.cmd')) {
    return (Join-Path $LocalNodeDir 'npm.cmd')
  }
  $cmd = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

function EnsureNode() {
  if ((HasCommand 'node') -and (GetNpmCommand)) {
    Say "Node found: $(& node --version), npm $(& (GetNpmCommand) --version)"
    return
  }

  if (Test-Path (Join-Path $LocalNodeDir 'node.exe')) {
    AddPath $LocalNodeDir
    Say "Using local Node: $(& node --version), npm $(& (GetNpmCommand) --version)"
    return
  }

  if ($CheckOnly) {
    Say "Missing: Node.js. It will be downloaded to .devtools\node."
    return
  }

  EnsureDir $DevToolsDir
  EnsureDir $DownloadsDir

  $indexUrl = 'https://nodejs.org/dist/index.json'
  Say "Resolving latest Node.js LTS..."
  $indexPath = Join-Path $DownloadsDir 'node-index.json'
  DownloadFile $indexUrl $indexPath
  $releases = Get-Content -Raw -Encoding UTF8 $indexPath | ConvertFrom-Json
  $release = $releases | Where-Object { $_.lts -ne $false } | Select-Object -First 1
  if (-not $release) {
    throw "Could not resolve latest Node.js LTS from $indexUrl"
  }

  $version = $release.version
  $zipName = "node-$version-win-x64.zip"
  $zipPath = Join-Path $DownloadsDir $zipName
  $url = "https://nodejs.org/dist/$version/$zipName"
  DownloadFile $url $zipPath

  $extractDir = Join-Path $DownloadsDir "node-$version"
  if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
  Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
  $inner = Join-Path $extractDir "node-$version-win-x64"
  if (Test-Path $LocalNodeDir) { Remove-Item $LocalNodeDir -Recurse -Force }
  Move-Item $inner $LocalNodeDir
  AddPath $LocalNodeDir

  Say "Node installed locally: $(& node --version), npm $(& (GetNpmCommand) --version)"
}

function EnsureCargoMirror() {
  if ($CheckOnly) {
    if (Test-Path $CargoConfig) { Say "Cargo mirror config exists." }
    else { Say "Missing: app\.cargo\config.toml. It will be created for faster Rust downloads." }
    return
  }

  EnsureDir (Split-Path -Parent $CargoConfig)
  $content = @'
[source.crates-io]
replace-with = "rsproxy-sparse"

[source.rsproxy-sparse]
registry = "sparse+https://rsproxy.cn/index/"

[net]
git-fetch-with-cli = true
retry = 5

[http]
timeout = 600
multiplexing = false
'@
  Set-Content -Path $CargoConfig -Value $content -Encoding ascii
  Say "Cargo mirror config is ready."
}

function AddCargoPath() {
  $cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
  AddPath $cargoBin
}

function EnsureRust() {
  AddCargoPath
  if ((HasCommand 'rustc') -and (HasCommand 'cargo')) {
    Say "Rust found: $(& rustc --version)"
    return
  }

  if ($CheckOnly) {
    Say "Missing: Rust. It will be installed with rustup-init.exe."
    return
  }

  EnsureDir $DownloadsDir
  $rustup = Join-Path $DownloadsDir 'rustup-init.exe'
  DownloadFile 'https://win.rustup.rs/x86_64' $rustup

  Run $rustup @(
    '-y',
    '--default-host', 'x86_64-pc-windows-msvc',
    '--default-toolchain', 'stable-x86_64-pc-windows-msvc',
    '--profile', 'minimal'
  )
  AddCargoPath

  Run 'rustup' @('toolchain', 'install', 'stable-x86_64-pc-windows-msvc')
  Run 'rustup' @('default', 'stable-x86_64-pc-windows-msvc')
  Say "Rust installed: $(& rustc --version)"
}

function HasMsvcBuildTools() {
  if (HasCommand 'cl') { return $true }
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  if (Test-Path $vswhere) {
    $install = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    return -not [string]::IsNullOrWhiteSpace($install)
  }
  return $false
}

function EnsureBuildTools() {
  if ($SkipBuildTools) {
    Say "Skipping MSVC build tools check."
    return
  }
  if (HasMsvcBuildTools) {
    Say "MSVC build tools found."
    return
  }

  if ($CheckOnly) {
    Say "Missing: Visual Studio Build Tools 2022. It will be downloaded from Microsoft."
    return
  }

  EnsureDir $DownloadsDir
  $installer = Join-Path $DownloadsDir 'vs_BuildTools.exe'
  DownloadFile 'https://aka.ms/vs/17/release/vs_BuildTools.exe' $installer

  Say "Installing Visual Studio Build Tools. A UAC prompt may appear. This can take a long time."
  $installerArgs = @(
    '--wait',
    '--passive',
    '--norestart',
    '--add', 'Microsoft.VisualStudio.Workload.VCTools',
    '--includeRecommended'
  )
  Say "> $installer $($installerArgs -join ' ')"
  $p = Start-Process -FilePath $installer -ArgumentList $installerArgs -Wait -PassThru
  if (($p.ExitCode -ne 0) -and ($p.ExitCode -ne 3010)) {
    throw "Visual Studio Build Tools installer failed with exit code $($p.ExitCode)."
  }
  if ($p.ExitCode -eq 3010) {
    Say "Visual Studio Build Tools installed. A restart may be required."
  }

  if (-not (HasMsvcBuildTools)) {
    throw "Visual Studio Build Tools installation finished, but MSVC was not detected. Restart this terminal or run the script again."
  }
}

function EnsureWebView2Runtime() {
  $regPaths = @(
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
  )
  foreach ($p in $regPaths) {
    if (Test-Path $p) {
      Say "WebView2 Runtime found."
      return
    }
  }

  $webViewExeCandidates = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\EdgeWebView\Application\*\msedgewebview2.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\EdgeWebView\Application\*\msedgewebview2.exe'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft\EdgeWebView\Application\*\msedgewebview2.exe')
  )
  foreach ($pattern in $webViewExeCandidates) {
    if (Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue | Select-Object -First 1) {
      Say "WebView2 Runtime found."
      return
    }
  }

  if ($CheckOnly) {
    Say "WebView2 Runtime was not detected. It will be downloaded from Microsoft if needed."
    return
  }

  EnsureDir $DownloadsDir
  $installer = Join-Path $DownloadsDir 'MicrosoftEdgeWebview2Setup.exe'
  DownloadFirstAvailable @(
    'https://go.microsoft.com/fwlink/p/?LinkId=2124703',
    'https://go.microsoft.com/fwlink/?linkid=2124701'
  ) $installer
  Run $installer @('/silent', '/install')
}

function EnsurePythonVenv($PythonCommand) {
  if (-not $PythonCommand) {
    if ($CheckOnly) { return }
    throw "Python 3.12 is required before creating python\venv."
  }

  $venvExists = Test-Path $VenvPython
  $venvUsable = $false
  if ($venvExists) {
    $venvUsable = TestPythonExecutable $VenvPython
    if ($venvUsable) {
      Say "Python venv already exists and is usable."
    } else {
      Say "Existing python\venv is broken and will be rebuilt."
    }
  }

  if ($CheckOnly) {
    if (-not $venvExists) {
      Say "Missing: python\venv. It will be created."
    } elseif (-not $venvUsable) {
      Say "Broken: python\venv exists but cannot run. It will be rebuilt."
    }
    return
  }

  if (-not $venvUsable) {
    $venvArgs = @($PythonCommand.Arguments) + @('-m', 'venv')
    if ($venvExists) {
      $venvArgs += '--clear'
    }
    $venvArgs += $VenvDir
    Run $PythonCommand.Exe $venvArgs
  }

  if (-not (TestPythonExecutable $VenvPython)) {
    throw "python\venv was created but cannot run. Please reinstall Python 3.12, ensure it is executable, then rerun the environment configurator."
  }

  Run $VenvPython @('-m', 'pip', 'install', '--upgrade', 'pip')
  Run $VenvPython @('-m', 'pip', 'install', '-r', (Join-Path $PythonDir 'requirements.txt'))
  $DevReq = Join-Path $PythonDir 'requirements-dev.txt'
  if (Test-Path $DevReq) {
    Run $VenvPython @('-m', 'pip', 'install', '-r', $DevReq)
  }
}

function EnsureNodeModules() {
  $NodeModules = Join-Path $AppDir 'node_modules'
  if ($CheckOnly) {
    if (Test-Path $NodeModules) { Say "node_modules already exists." }
    else { Say "Missing: app\node_modules. It will be created by npm install." }
    return
  }

  $npm = GetNpmCommand
  if (-not $npm) { throw "npm was not found after Node setup." }
  Run $npm @('install') $AppDir
}

function EnsureTauriDevResources() {
  if ($CheckOnly) {
    if (Test-Path $TauriPythonDist) { Say "Tauri python-dist placeholder exists." }
    else { Say "Missing: app\src-tauri\python-dist. It will be created for dev builds." }
    return
  }
  EnsureDir $TauriPythonDist
}

function VerifyProject() {
  if ($CheckOnly -or $SkipVerify) { return }
  $npm = GetNpmCommand
  Run $npm @('run', 'lint') $AppDir
  Run $npm @('test') $AppDir
  Run 'cargo' @('fetch') (Join-Path $AppDir 'src-tauri')
  Run 'cargo' @('check') (Join-Path $AppDir 'src-tauri')
  Run $VenvPython @('-m', 'unittest', 'discover', '-s', 'tests') $PythonDir
}

Say "Project root: $Root"
Say "Mode: $(if ($CheckOnly) { 'check only' } else { 'install/update' })"

$pythonCommand = EnsurePython
EnsureNode
EnsureCargoMirror
EnsureRust
EnsureBuildTools
EnsureWebView2Runtime
EnsurePythonVenv $pythonCommand
EnsureNodeModules
EnsureTauriDevResources
VerifyProject

Say "All done. To start the desktop app, run startup batch file in this folder."
