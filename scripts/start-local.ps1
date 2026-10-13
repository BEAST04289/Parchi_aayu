<#
  Parchi local demo startup (Windows). Everything runs on this laptop; nothing is exposed beyond 127.0.0.1
  except the Next.js app itself (which listens on all interfaces so a phone on the same Wi-Fi can reach it).

  Usage (from the repo root):
    powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1          # production build + start
    powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1 -Dev     # next dev
    powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1 -SkipBuild

  Steps: load .env.local -> Ollama up + model present -> ML service (OCR/speech) up -> warm both models
  -> Next.js -> wait for /api/health ready=true.
#>
param([switch]$Dev, [switch]$SkipBuild, [int]$Port = 3000)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$logs = Join-Path $root '.data\logs'
New-Item -ItemType Directory -Force $logs | Out-Null

$pidFile = Join-Path $root '.data\pids.json'
function Record($name, $proc) {
  $list = @(); if (Test-Path $pidFile) { $list = @(Get-Content $pidFile -Raw | ConvertFrom-Json) }
  $list += [pscustomobject]@{ name = $name; pid = $proc.Id; started = (Get-Date).ToString('s') }
  ConvertTo-Json @($list) | Set-Content -Encoding utf8 $pidFile
}
function Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "XX  $m" -ForegroundColor Red; exit 1 }
function Wait-Http($url, $seconds) {
  # True as soon as the URL answers with any HTTP status (a 503 "not ready" still means the server is up).
  $end = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $end) {
    try { Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 5 | Out-Null; return $true }
    catch { if ($_.Exception.Response) { return $true } }
    Start-Sleep -Milliseconds 800
  }
  return $false
}
function Get-Body($url) {
  try { return (Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 10).Content }
  catch { if ($_.Exception.Response) { $sr = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream()); return $sr.ReadToEnd() } else { return $null } }
}

# 1. Environment (values never printed)
Step 'Loading .env.local'
if (-not (Test-Path '.env.local')) { Fail '.env.local missing. Copy .env.example and fill SESSION_SECRET, STAFF_PASSCODE, ML_SERVICE_TOKEN.' }
foreach ($line in Get-Content '.env.local') {
  if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process') }
}
foreach ($k in 'SESSION_SECRET', 'STAFF_PASSCODE', 'ML_SERVICE_TOKEN') { if (-not [Environment]::GetEnvironmentVariable($k, 'Process')) { Fail "$k is not set in .env.local" } }
$ollamaUrl = if ($env:OLLAMA_URL) { $env:OLLAMA_URL } else { 'http://127.0.0.1:11434' }
$model = if ($env:OLLAMA_MODEL) { $env:OLLAMA_MODEL } else { 'qwen3-vl:4b-instruct' }
$mlUrl = if ($env:ML_SERVICE_URL) { $env:ML_SERVICE_URL } else { 'http://127.0.0.1:8765' }

# 2. Ollama
Step "Ollama at $ollamaUrl"
if (-not (Wait-Http "$ollamaUrl/api/version" 2)) {
  $ollama = (Get-Command ollama -ErrorAction SilentlyContinue).Source
  if (-not $ollama) { Fail 'Ollama is not installed. Install it from https://ollama.com/download, then rerun.' }
  Start-Process -FilePath $ollama -ArgumentList 'serve' -WindowStyle Hidden -RedirectStandardError "$logs\ollama.log"
  if (-not (Wait-Http "$ollamaUrl/api/version" 30)) { Fail 'Ollama did not start.' }
}
$tags = (Invoke-RestMethod "$ollamaUrl/api/tags").models.name
if ($tags -notcontains $model) { Fail "Model $model is not pulled. Run: ollama pull $model" }
Write-Host "    model $model present"

# 3. ML service (OCR + speech)
Step "ML service at $mlUrl"
$py = Join-Path $root 'services\ml\.venv\Scripts\python.exe'
if (-not (Test-Path $py)) { Fail 'services\ml\.venv missing. Run: python -m venv services\ml\.venv; services\ml\.venv\Scripts\python.exe -m pip install -r services\ml\requirements.txt' }
if (-not (Wait-Http "$mlUrl/health" 1)) {
  $proc = Start-Process -FilePath $py -ArgumentList 'services\ml\server.py' -WindowStyle Hidden -RedirectStandardOutput "$logs\ml.out.log" -RedirectStandardError "$logs\ml.err.log" -PassThru
  Record 'ml-service' $proc
  if (-not (Wait-Http "$mlUrl/health" 60)) { Fail "ML service did not start. See $logs\ml.err.log" }
}

# 4. Warm models so the first patient upload is not a cold start
Step 'Warming OCR'
$h = @{ 'x-ml-token' = $env:ML_SERVICE_TOKEN }
try { Invoke-RestMethod -Method Post -Uri "$mlUrl/warmup?what=ocr" -Headers $h -Body 'x' -TimeoutSec 180 | Out-Null } catch { Fail "OCR warm-up failed: $($_.Exception.Message)" }
Step "Warming $model (loads into GPU memory; first time can take a minute)"
try { Invoke-RestMethod -Method Post -Uri "$ollamaUrl/api/generate" -ContentType 'application/json' -Body (@{ model = $model; prompt = 'ok'; stream = $false; keep_alive = '30m'; options = @{ num_ctx = 4096; num_predict = 1 } } | ConvertTo-Json) -TimeoutSec 300 | Out-Null } catch { Fail "Model warm-up failed: $($_.Exception.Message)" }

# 5. Next.js
Step "Next.js on port $Port"
$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($busy) { Fail "Port $Port is already in use (pid $($busy[0].OwningProcess)). Run scripts\stop-local.ps1 or choose -Port." }
if ($Dev) {
  $proc = Start-Process -FilePath 'npm.cmd' -ArgumentList 'run', 'dev', '--', '-p', "$Port" -WindowStyle Hidden -RedirectStandardOutput "$logs\next.out.log" -RedirectStandardError "$logs\next.err.log" -PassThru
  Record 'next-dev' $proc
} else {
  if (-not $SkipBuild) { npm run build; if ($LASTEXITCODE -ne 0) { Fail 'next build failed' } }
  $proc = Start-Process -FilePath 'npx.cmd' -ArgumentList 'next', 'start', '-p', "$Port" -WindowStyle Hidden -RedirectStandardOutput "$logs\next.out.log" -RedirectStandardError "$logs\next.err.log" -PassThru
  Record 'next-start' $proc
}
if (-not (Wait-Http "http://localhost:$Port/api/health" 120)) { Fail "Next.js did not answer. See $logs\next.err.log" }
Step 'Readiness'
$body = Get-Body "http://localhost:$Port/api/health"
Write-Host $body
if ($body -notmatch '"ready":true') { Write-Host 'Not ready yet: see the JSON above.' -ForegroundColor Yellow }
Write-Host ''
Write-Host "Staff:  http://localhost:$Port/staff" -ForegroundColor Green
Write-Host "Logs:   $logs"
Write-Host 'Stop:   scripts\stop-local.ps1'
