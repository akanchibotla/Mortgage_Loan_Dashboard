<#
.SYNOPSIS
  Fetch Rocket Mortgage national rates from a RESIDENTIAL IP and push the
  refreshed data to origin/main.

.WHY
  Akamai denylists GitHub Actions' datacenter IP ranges, so the daily cron
  (.github/workflows/refresh.yml) gets HTTP 403 on every Rocket tier — the
  feed froze at 2026-06-03. From a home/residential IP the exact same
  scripts/fetch_rocket.py succeeds on Tier 1 (plain urllib, no browser).
  This runner is meant to be driven by a Windows Scheduled Task on one of
  Arun's personal machines (register with scripts/register-rocket-task.ps1).
  The monthly rate aggregator only needs >=1 successful fetch per calendar
  month, so even a weekly (or once-a-month) run keeps the chart bar non-null.

.SAFETY / IDEMPOTENCE
  - rocket.jsonl is idempotent-by-date (re-running the same day overwrites,
    never duplicates, that day's row).
  - Only the Rocket data files are staged, so this never commits unrelated
    working-tree changes.
  - Push uses the same pull --rebase retry the cron uses, so a race with the
    daily cron's push resolves cleanly (they touch disjoint files: the cron
    can't fetch Rocket, so it never modifies these paths).
  - The daily cron already triggers the Pages deploy, so this runner does NOT
    need `gh` or a Pages redeploy — the next daily cron carries the data live.
  - The repo path is derived from $HOME so this script is portable across
    every device Arun clones the repo to (repos live under ~/Github).
#>
[CmdletBinding()]
param(
    # Override for non-standard clone locations; defaults to ~/Github/<repo>.
    [string]$RepoPath = (Join-Path $HOME 'Github\Mortgage_Loan_Dashboard')
)

$ErrorActionPreference = 'Stop'
$logFile = Join-Path $RepoPath 'scripts\rocket-residential.log'

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $line = '{0}  [{1}] {2}' -f (Get-Date).ToString('u'), $Level, $Message
    # Console for interactive runs; file for scheduled (unattended) runs.
    Write-Host $line
    try { Add-Content -Path $logFile -Value $line -Encoding utf8 } catch { }
}

# Only these paths are ever committed by this runner.
$rocketPaths = @(
    'data/daily/rocket.jsonl',
    'src/data/rocket_today.json',
    'src/data/rocket_15yr_monthly.json',
    'src/data/rocket_30yr_monthly.json',
    'src/data/rocket_15yr_daily.json',
    'src/data/rocket_30yr_daily.json'
)

try {
    if (-not (Test-Path $RepoPath)) {
        Write-Log "Repo not found at $RepoPath (is it cloned on this device?)" 'ERROR'
        exit 2
    }
    Set-Location $RepoPath

    # Resolve an interpreter. Scheduled tasks don't always inherit the
    # interactive PATH, so probe the common launchers explicitly.
    $py = $null
    foreach ($cand in @('python', 'py')) {
        $cmd = Get-Command $cand -ErrorAction SilentlyContinue
        if ($cmd) { $py = $cmd.Source; break }
    }
    if (-not $py) {
        Write-Log 'No python/py interpreter on PATH; cannot fetch.' 'ERROR'
        exit 3
    }
    Write-Log "Using interpreter: $py"

    # Sync to origin first so our commit sits on top of the latest cron data.
    # --autostash guards the rare case a prior run left the tree dirty.
    Write-Log 'git pull --rebase --autostash origin main'
    git pull --rebase --autostash origin main 2>&1 | ForEach-Object { Write-Log $_ }
    if ($LASTEXITCODE -ne 0) { Write-Log 'pull --rebase failed; aborting to avoid a messy state.' 'ERROR'; exit 4 }

    Write-Log 'Fetching Rocket rates (residential IP) ...'
    & $py scripts/fetch_rocket.py 2>&1 | ForEach-Object { Write-Log $_ }
    if ($LASTEXITCODE -ne 0) {
        Write-Log 'fetch_rocket.py failed even from residential IP (upstream change?). No commit.' 'WARN'
        exit 5
    }

    & $py scripts/aggregate_rocket.py 2>&1 | ForEach-Object { Write-Log $_ }
    if ($LASTEXITCODE -ne 0) { Write-Log 'aggregate_rocket.py failed.' 'ERROR'; exit 6 }

    # Stage only the Rocket data files.
    git add -- $rocketPaths
    git diff --cached --quiet
    if ($LASTEXITCODE -eq 0) {
        Write-Log 'No Rocket data changes (already fresh for this date). Nothing to push.'
        exit 0
    }

    $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
    git commit -m "rocket: residential refresh $stamp" 2>&1 | ForEach-Object { Write-Log $_ }
    if ($LASTEXITCODE -ne 0) { Write-Log 'commit failed.' 'ERROR'; exit 7 }

    # Push with pull --rebase retry (mirrors the cron's race-safe push).
    $pushed = $false
    for ($i = 1; $i -le 5; $i++) {
        git push 2>&1 | ForEach-Object { Write-Log $_ }
        if ($LASTEXITCODE -eq 0) { $pushed = $true; Write-Log "Push succeeded on attempt $i"; break }
        Write-Log "Push attempt $i failed; rebasing on origin/main and retrying" 'WARN'
        git pull --rebase origin main 2>&1 | ForEach-Object { Write-Log $_ }
        Start-Sleep -Seconds ($i * 4)
    }
    if (-not $pushed) { Write-Log 'Push failed after 5 attempts.' 'ERROR'; exit 8 }

    Write-Log 'Rocket residential refresh complete.'
    exit 0
}
catch {
    Write-Log "Unhandled error: $($_.Exception.Message)" 'ERROR'
    exit 1
}
