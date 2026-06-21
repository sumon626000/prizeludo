$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$apiDist = Join-Path $projectRoot "apps\api\dist\index.js"
$webDist = Join-Path $projectRoot "apps\web\dist\index.html"
$logDir = Join-Path $projectRoot ".local-logs"
$dockerDesktop = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"

New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Set-Location $projectRoot

function Test-LocalPort {
  param([int]$Port)

  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $connection = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if (-not $connection.AsyncWaitHandle.WaitOne(700)) {
      return $false
    }
    $client.EndConnect($connection)
    return $true
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Wait-LocalPort {
  param(
    [int]$Port,
    [int]$TimeoutSeconds
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-LocalPort -Port $Port) {
      return $true
    }
    Start-Sleep -Seconds 3
  }
  return $false
}

function Test-DockerReady {
  try {
    & docker.exe info --format "{{.ServerVersion}}" 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

function Wait-DockerReady {
  param([int]$TimeoutSeconds)

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-DockerReady) {
      return $true
    }
    Start-Sleep -Seconds 5
  }
  return $false
}

function Test-BuildRequired {
  if (-not (Test-Path $apiDist) -or -not (Test-Path $webDist)) {
    return $true
  }

  $apiBuildTime = (Get-Item $apiDist).LastWriteTimeUtc
  $webBuildTime = (Get-Item $webDist).LastWriteTimeUtc
  $apiSourceChanged = Get-ChildItem -Path (Join-Path $projectRoot "apps\api\src") -Recurse -File |
    Where-Object { $_.LastWriteTimeUtc -gt $apiBuildTime } |
    Select-Object -First 1
  $webSourceChanged = Get-ChildItem -Path (Join-Path $projectRoot "apps\web\src") -Recurse -File |
    Where-Object { $_.LastWriteTimeUtc -gt $webBuildTime } |
    Select-Object -First 1

  return ($null -ne $apiSourceChanged) -or ($null -ne $webSourceChanged)
}

if (Test-BuildRequired) {
  & npm.cmd run build *>> (Join-Path $logDir "build.log")
}

if (-not (Test-LocalPort -Port 5432)) {
  $postgresServices = Get-Service -Name "postgresql*", "postgres*", "pgsql*" -ErrorAction SilentlyContinue
  if (-not $postgresServices) {
    Add-Content -LiteralPath (Join-Path $logDir "startup.log") -Value (
      "{0:u} No PostgreSQL Windows service was found." -f (Get-Date)
    )
  }
  $postgresServices |
    Where-Object { $_.Status -ne "Running" } |
    ForEach-Object {
      $serviceName = $_.Name
      try {
        Start-Service -Name $serviceName -ErrorAction Stop
      } catch {
        Add-Content -LiteralPath (Join-Path $logDir "startup.log") -Value (
          "{0:u} Could not start PostgreSQL service {1}: {2}" -f (Get-Date), $serviceName, $_.Exception.Message
        )
      }
    }

  if (-not (Test-LocalPort -Port 5432)) {
    if (-not (Test-DockerReady) -and (Test-Path -LiteralPath $dockerDesktop)) {
      Start-Process -FilePath $dockerDesktop -WindowStyle Hidden
    }

    if (Wait-DockerReady -TimeoutSeconds 240) {
      $dockerStart = @{
        FilePath = "docker.exe"
        ArgumentList = @("compose", "up", "-d", "postgres")
        WorkingDirectory = $projectRoot
        Wait = $true
        PassThru = $true
        NoNewWindow = $true
        RedirectStandardOutput = (Join-Path $logDir "docker.out.log")
        RedirectStandardError = (Join-Path $logDir "docker.err.log")
      }
      $dockerProcess = Start-Process @dockerStart
      if ($dockerProcess.ExitCode -eq 0 -and (Wait-LocalPort -Port 5432 -TimeoutSeconds 120)) {
        & npm.cmd run db:migrate *>> (Join-Path $logDir "migration.log")
      }
    } else {
      Add-Content -LiteralPath (Join-Path $logDir "startup.log") -Value (
        "{0:u} Docker engine was not ready before timeout." -f (Get-Date)
      )
    }
  }
}

if (-not (Test-LocalPort -Port 4000) -and (Wait-LocalPort -Port 5432 -TimeoutSeconds 300)) {
  for ($attempt = 1; $attempt -le 5; $attempt++) {
    $apiProcess = @{
      FilePath = "node.exe"
      ArgumentList = @("apps/api/dist/index.js")
      WorkingDirectory = $projectRoot
      WindowStyle = "Hidden"
      RedirectStandardOutput = (Join-Path $logDir "api.out.log")
      RedirectStandardError = (Join-Path $logDir "api.err.log")
    }
    Start-Process @apiProcess
    if (Wait-LocalPort -Port 4000 -TimeoutSeconds 15) {
      break
    }
    Start-Sleep -Seconds 3
  }
}

if (-not (Test-LocalPort -Port 5173)) {
  $webProcess = @{
    FilePath = "node.exe"
    ArgumentList = @(
      "node_modules/vite/bin/vite.js",
      "preview",
      "--host", "0.0.0.0",
      "--port", "5173",
      "--strictPort"
    )
    WorkingDirectory = (Join-Path $projectRoot "apps\web")
    WindowStyle = "Hidden"
    RedirectStandardOutput = (Join-Path $logDir "web.out.log")
    RedirectStandardError = (Join-Path $logDir "web.err.log")
  }
  Start-Process @webProcess
}
