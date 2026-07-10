param(
  [switch]$CheckOnly,
  [switch]$SkipBuildTools
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Join-Path $Root 'app'
$PythonDir = Join-Path $Root 'python'
$VenvPython = Join-Path $PythonDir 'venv\Scripts\python.exe'

function Say($Text) {
  Write-Host "[setup] $Text"
}

function HasCommand($Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Run($File, [string[]]$Args, $WorkingDirectory = $Root) {
  Say "> $File $($Args -join ' ')"
  Push-Location $WorkingDirectory
  try {
    & $File @Args
    if ($LASTEXITCODE -ne 0) {
      throw "Command failed with exit code ${LASTEXITCODE}: $File $($Args -join ' ')"
    }
  } finally {
    Pop-Location
  }
}

function InstallWithWinget($Id, $Name, [string[]]$ExtraArgs = @()) {
  if ($CheckOnly) {
    Say "Missing: $Name. Install suggestion: winget install --id $Id"
    return
  }
  if (-not (HasCommand 'winget')) {
    throw "Missing $Name, and winget is not available. Please install $Name manually, then run this script again."
  }
  Say "Installing $Name with winget. This may take a while."
  $args = @('install', '--id', $Id, '--exact', '--accept-package-agreements', '--accept-source-agreements') + $ExtraArgs
  Run 'winget' $args
}

function EnsurePython() {
  if (HasCommand 'python') {
    $v = (& python --version 2>&1)
    Say "Python found: $v"
    return
  }
  InstallWithWinget 'Python.Python.3.12' 'Python 3.12'
}

function EnsureNode() {
  if ((HasCommand 'node') -and (HasCommand 'npm')) {
    Say "Node found: $(& node --version), npm $(& npm --version)"
    return
  }
  InstallWithWinget 'OpenJS.NodeJS.LTS' 'Node.js LTS'
}

function EnsureRust() {
  if ((HasCommand 'rustc') -and (HasCommand 'cargo')) {
    Say "Rust found: $(& rustc --version)"
    return
  }
  InstallWithWinget 'Rustlang.Rustup' 'Rustup / Rust toolchain'
  if (-not $CheckOnly) {
    Run 'rustup' @('toolchain', 'install', 'stable-msvc')
    Run 'rustup' @('default', 'stable-msvc')
  }
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
  InstallWithWinget 'Microsoft.VisualStudio.2022.BuildTools' 'Visual Studio Build Tools 2022' @(
    '--override', '--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
  )
}

function EnsurePythonVenv() {
  if (Test-Path $VenvPython) {
    Say "Python venv already exists."
  } elseif ($CheckOnly) {
    Say "Missing: python\venv. It will be created by python -m venv python\venv."
    return
  } else {
    Run 'python' @('-m', 'venv', (Join-Path $PythonDir 'venv'))
  }

  if (-not $CheckOnly) {
    Run $VenvPython @('-m', 'pip', 'install', '--upgrade', 'pip')
    Run $VenvPython @('-m', 'pip', 'install', '-r', (Join-Path $PythonDir 'requirements.txt'))
  }
}

function EnsureNodeModules() {
  $NodeModules = Join-Path $AppDir 'node_modules'
  if ($CheckOnly) {
    if (Test-Path $NodeModules) { Say "node_modules already exists." }
    else { Say "Missing: app\node_modules. It will be created by npm install." }
    return
  }
  Run 'npm.cmd' @('install') $AppDir
}

function VerifyProject() {
  if ($CheckOnly) { return }
  Run 'npm.cmd' @('run', 'lint') $AppDir
  Run 'npm.cmd' @('test') $AppDir
  Run 'cargo' @('check') (Join-Path $AppDir 'src-tauri')
  Run $VenvPython @('-m', 'unittest', 'discover', '-s', 'tests') $PythonDir
}

Say "Project root: $Root"
Say "Mode: $(if ($CheckOnly) { 'check only' } else { 'install/update' })"

EnsurePython
EnsureNode
EnsureRust
EnsureBuildTools
EnsurePythonVenv
EnsureNodeModules
VerifyProject

Say "All done. To start the desktop app, run the start-dev batch file in this folder."
