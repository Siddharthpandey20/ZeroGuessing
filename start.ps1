# One command to bring the whole app up, e.g. after restarting the PC:
#     powershell -ExecutionPolicy Bypass -File .\start.ps1
# 1. starts Docker Desktop if it isn't running and waits for it
# 2. starts the Postgres + pgvector container (your users, chats and documents live in its volume, so they are kept)
# 3. opens the API (http://localhost:8000) and the web app (http://localhost:5173) in two new windows
# Options: -NoFrontend, -NoBackend (only the database, e.g. to run tests)
param([switch]$NoFrontend, [switch]$NoBackend)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"

function Test-Docker {
    $ErrorActionPreference = "SilentlyContinue"  # "daemon not running" on stderr must not stop the script
    docker info --format "{{.ServerVersion}}" *> $null
    return $LASTEXITCODE -eq 0
}

# ---- 1. Docker Desktop
if (-not (Test-Docker)) {
    $exe = @("$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe", "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe") |
        Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $exe) { throw "Docker Desktop is not installed (or not in the usual folder). Start it by hand, then run this again." }
    Write-Host "Starting Docker Desktop..."
    Start-Process $exe
    $deadline = (Get-Date).AddMinutes(4)
    while (-not (Test-Docker)) {
        if ((Get-Date) -gt $deadline) { throw "Docker Desktop did not start within 4 minutes. Open it by hand and check for errors." }
        Start-Sleep 3
    }
}
Write-Host "Docker is running."

# ---- 2. database
if (-not (Test-Path (Join-Path $root ".env")) -and -not (Test-Path (Join-Path $backend ".env"))) {
    throw "No .env found. Copy backend\.env.example to .env (repo root) or backend\.env and fill it in."
}
$busy = docker ps --filter "publish=5433" --format "{{.Names}}" | Where-Object { $_ -ne "zeroguess-db-1" }
if ($busy) { throw "Port 5433 is used by another container ($busy). Stop it: docker stop $busy" }
Push-Location $backend
try {
    docker compose up -d db
    if ($LASTEXITCODE -ne 0) { throw "docker compose up failed (see above)." }
    if (-not (docker port zeroguess-db-1 5432)) {
        # left over from a start whose port bind failed: it runs but is unreachable. Recreate it (data is in the volume)
        docker compose up -d --force-recreate db
    }
    $deadline = (Get-Date).AddMinutes(2)
    while ((docker inspect -f "{{.State.Health.Status}}" zeroguess-db-1) -ne "healthy") {
        if ((Get-Date) -gt $deadline) { throw "The database did not become healthy. Logs: docker compose logs db" }
        Start-Sleep 2
    }
    if (-not (docker compose exec -T db psql -U zeroguess -tAc "SELECT 1 FROM pg_database WHERE datname='zeroguess_test'")) {
        docker compose exec -T db psql -U zeroguess -c "CREATE DATABASE zeroguess_test" | Out-Null  # for `uv run pytest`
    }
} finally { Pop-Location }
Write-Host "Database is up on localhost:5433."

# ---- 3. API and web app
if (-not $NoBackend) {
    Start-Process powershell -WorkingDirectory $backend -ArgumentList "-NoExit", "-Command", "uv sync; uv run uvicorn app.main:app --reload --port 8000"
    Write-Host "API starting in a new window: http://localhost:8000/docs"
}
if (-not $NoFrontend) {
    $cmd = if (Test-Path (Join-Path $frontend "node_modules")) { "npm run dev" } else { "npm ci; npm run dev" }
    Start-Process powershell -WorkingDirectory $frontend -ArgumentList "-NoExit", "-Command", $cmd
    Write-Host "Web app starting in a new window: http://localhost:5173"
}
