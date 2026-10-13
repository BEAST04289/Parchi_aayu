<#
  Stops only processes that belong to this Parchi checkout: the ones recorded by start-local.ps1 in
  .data\pids.json, plus listeners on the app/ML ports whose command line points into this repo.
  Anything else on those ports is reported and left alone. Ollama is left running.
#>
param([int]$Port = 3000, [int]$MlPort = 8765)
$root = (Split-Path -Parent $PSScriptRoot)
$pidFile = Join-Path $root '.data\pids.json'

function Belongs($procId) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
  if (-not $p) { return $null }
  if ($p.CommandLine -and $p.CommandLine.ToLower().Contains($root.ToLower())) { return $p }
  # npx/npm wrappers started from the repo: accept if a child process belongs to the repo.
  $kids = Get-CimInstance Win32_Process -Filter "ParentProcessId=$procId" -ErrorAction SilentlyContinue
  foreach ($k in $kids) { if ($k.CommandLine -and $k.CommandLine.ToLower().Contains($root.ToLower())) { return $p } }
  # Windows venv launchers re-exec the base interpreter: the listener's PARENT carries the repo path.
  $par = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)" -ErrorAction SilentlyContinue
  if ($par -and $par.CommandLine -and $par.CommandLine.ToLower().Contains($root.ToLower())) { return $par }
  return $null
}
function StopTree($procId, $why) {
  & taskkill.exe /PID $procId /T /F 2>$null | Out-Null
  Write-Host "stopped pid $procId ($why)"
}

$candidates = @()
if (Test-Path $pidFile) { $candidates += (Get-Content $pidFile -Raw | ConvertFrom-Json) | ForEach-Object { [pscustomobject]@{ pid = $_.pid; why = "started by start-local: $($_.name)" } } }
foreach ($p in $Port, $MlPort) {
  foreach ($c in (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)) { $candidates += [pscustomobject]@{ pid = $c.OwningProcess; why = "listening on $p" } }
}
foreach ($c in ($candidates | Where-Object { $_.pid } | Sort-Object pid -Unique)) {
  $p = Belongs $c.pid
  if ($p) { StopTree $p.ProcessId $c.why }
  elseif (Get-Process -Id $c.pid -ErrorAction SilentlyContinue) { Write-Host "left pid $($c.pid) alone ($($c.why)): it does not belong to $root" -ForegroundColor Yellow }
}
if (Test-Path $pidFile) { Remove-Item $pidFile }
