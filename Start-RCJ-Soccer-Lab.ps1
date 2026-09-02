param(
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$vinextCli = Join-Path $projectRoot 'node_modules\vinext\dist\cli.js'
$localUrl = 'http://localhost:3000/'

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) {
  $nodeCommand.Source
} else {
  Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}

if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
  throw 'Node.js 22 or newer is required. Install Node.js, then run this launcher again.'
}

$env:PATH = "$(Split-Path -Parent $nodePath);$env:PATH"

if (-not (Test-Path -LiteralPath $vinextCli -PathType Leaf)) {
  $pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
  $pnpmPath = if ($pnpmCommand) {
    $pnpmCommand.Source
  } else {
    Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd'
  }

  if (-not (Test-Path -LiteralPath $pnpmPath -PathType Leaf)) {
    throw 'Project dependencies are missing and pnpm could not be found.'
  }

  Write-Host 'Preparing RCJ Soccer Lab for its first local run...'
  & $pnpmPath install
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $vinextCli -PathType Leaf)) {
    throw 'The project dependencies could not be installed.'
  }
}

try {
  $existingResponse = Invoke-WebRequest -Uri $localUrl -UseBasicParsing -TimeoutSec 2
  if ($existingResponse.StatusCode -eq 200) {
    if (-not $NoBrowser) {
      Start-Process $localUrl
    }
    Write-Host "RCJ Soccer Lab is already running at $localUrl" -ForegroundColor Green
    exit 0
  }
} catch {
  # Port is free; start a new local server below.
}

$server = Start-Process `
  -FilePath $nodePath `
  -ArgumentList @($vinextCli, 'dev', '--host', '127.0.0.1') `
  -WorkingDirectory $projectRoot `
  -WindowStyle Hidden `
  -PassThru

try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
    if ($server.HasExited) {
      throw "The local server stopped before it was ready (exit code $($server.ExitCode))."
    }

    try {
      $response = Invoke-WebRequest -Uri $localUrl -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) {
        $ready = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }

  if (-not $ready) {
    throw 'The local server did not become ready within 30 seconds.'
  }

  if (-not $NoBrowser) {
    Start-Process $localUrl
  }

  Write-Host ''
  Write-Host 'RCJ Soccer Lab is running locally:' -ForegroundColor Green
  Write-Host $localUrl -ForegroundColor Cyan
  Write-Host 'Press Enter to stop the local server.'
  Read-Host | Out-Null
} finally {
  if (-not $server.HasExited) {
    Stop-Process -Id $server.Id
    $server.WaitForExit()
  }
}
