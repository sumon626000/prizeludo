param(
  [switch]$Rebuild
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$LogDir = Join-Path $Root "logs"
$ApiLog = Join-Path $LogDir "local-api.log"
$ApiErr = Join-Path $LogDir "local-api.err.log"
$WebLog = Join-Path $LogDir "local-web.log"
$WebErr = Join-Path $LogDir "local-web.err.log"
$BuildLog = Join-Path $LogDir "local-build.log"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $Root

function Write-LocalLog {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -Path (Join-Path $LogDir "autostart.log") -Value $line
}

function Test-PortListening {
  param([int]$Port)
  $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  return $null -ne $connection
}

function Start-NpmApp {
  param(
    [string]$Name,
    [string[]]$Arguments,
    [string]$StdOut,
    [string]$StdErr
  )

  Write-LocalLog "Starting $Name..."
  Start-Process `
    -FilePath "npm.cmd" `
    -ArgumentList $Arguments `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $StdOut `
    -RedirectStandardError $StdErr
}

$ApiBuilt = Test-Path (Join-Path $Root "apps/api/dist/index.js")
$WebBuilt = Test-Path (Join-Path $Root "apps/web/dist/index.html")
if ($Rebuild -or -not ($ApiBuilt -and $WebBuilt)) {
  Write-LocalLog "Build missing or rebuild requested. Running npm run build..."
  & npm.cmd run build *> $BuildLog
  Write-LocalLog "Build finished."
}

if (Test-PortListening 4000) {
  Write-LocalLog "API already listening on http://localhost:4000"
} else {
  Start-NpmApp `
    -Name "PrizeJito API" `
    -Arguments @("run", "start", "-w", "@khan-ludo/api") `
    -StdOut $ApiLog `
    -StdErr $ApiErr
}

if (Test-PortListening 5173) {
  Write-LocalLog "Web already listening on http://localhost:5173"
} else {
  Start-NpmApp `
    -Name "PrizeJito Web" `
    -Arguments @("run", "preview", "-w", "@khan-ludo/web") `
    -StdOut $WebLog `
    -StdErr $WebErr
}

Write-LocalLog "Local startup complete. Web: http://localhost:5173 API: http://localhost:4000/api/health"
