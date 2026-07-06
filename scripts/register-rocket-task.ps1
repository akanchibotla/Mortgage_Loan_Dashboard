<#
.SYNOPSIS
  Register (or refresh) the Windows Scheduled Task that keeps the Rocket
  Mortgage feed alive from this residential device.

.WHY THIS IS A PER-DEVICE STEP
  The runner script (rocket_residential_refresh.ps1) is committed to the repo,
  so it syncs to every device Arun clones to. The *scheduled task* itself is
  OS-local state on each Windows install -- it does NOT travel with git. So on
  each device you want to act as a Rocket refresher, run this script ONCE.
  You only need ONE device's task to fire per calendar month to keep the feed
  fresh (the monthly aggregator needs >=1 row/month). Registering it on
  several devices just adds redundancy -- the idempotent-by-date JSONL + the
  pull-rebase push mean concurrent runs never conflict.

.BEHAVIOUR
  - Weekly trigger (Sunday 18:00 local) with -StartWhenAvailable: if you were
    logged off / the device was asleep at the trigger time, the task runs as
    soon as it can once you are logged on again. For a personal laptop that is
    exactly the "I open it at least once a month" case -- opening the lid and
    unlocking IS logging on -- so a single monthly session keeps the feed fresh.
  - Runs on battery too (-AllowStartIfOnBatteries), so a laptop that is never
    plugged in still refreshes.
  - LogonType Interactive: runs while YOU are logged on, using your own git
    credentials from Windows Credential Manager (no stored password, no
    elevation). Caveat: it will NOT run when the device is on but nobody is
    logged in. If you want it to fire while logged off (e.g. an always-on
    desktop), re-register with '-LogonType S4U' -- that runs unattended but
    needs git credentials that resolve without an interactive session.
  - 30-minute hard time limit (generous enough for the slow Wayback fallback
    path when Rocket's live tiers are all blocked).

.USAGE
  powershell -ExecutionPolicy Bypass -File scripts\register-rocket-task.ps1
  # remove:  Unregister-ScheduledTask -TaskName 'MortgageDashboard-RocketRefresh' -Confirm:$false
  # run now: Start-ScheduledTask     -TaskName 'MortgageDashboard-RocketRefresh'
#>
[CmdletBinding()]
param(
    [string]$TaskName = 'MortgageDashboard-RocketRefresh',
    [string]$RepoPath = (Join-Path $HOME 'Github\Mortgage_Loan_Dashboard'),
    [ValidateSet('Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday')]
    [string]$DayOfWeek = 'Sunday',
    [string]$At = '6:00PM'
)

$ErrorActionPreference = 'Stop'

$runner = Join-Path $RepoPath 'scripts\rocket_residential_refresh.ps1'
if (-not (Test-Path $runner)) {
    throw "Runner not found at $runner -- is the repo cloned at $RepoPath?"
}

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runner`""

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $DayOfWeek -At $At

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable `
    -DontStopOnIdleEnd `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -MultipleInstances IgnoreNew

# NOTE: -AllowStartIfOnBatteries / -DontStopIfGoingOnBatteries are essential on
# a laptop: the Task Scheduler DEFAULT is to skip (and kill) tasks running on
# battery, which would silently defeat the "have a device on once a month"
# guarantee. A one-off git-commit fetch is cheap enough to run on battery.

# Run as the current interactive user (no stored credentials, no elevation).
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description 'Keeps the Mortgage_Loan_Dashboard Rocket feed alive by fetching from this residential IP (GitHub Actions is Akamai-blocked). Weekly, runs when available.' `
    -Force | Out-Null

Write-Host "Registered scheduled task '$TaskName':"
Get-ScheduledTask -TaskName $TaskName |
    Select-Object TaskName, State, @{n='NextRun';e={ (Get-ScheduledTaskInfo -TaskName $TaskName).NextRunTime }} |
    Format-List
Write-Host "Run it now to smoke-test:  Start-ScheduledTask -TaskName '$TaskName'"
