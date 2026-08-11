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
  - LogonType (parameter, default Interactive): 'Interactive' runs while YOU
    are logged on, using your own git credentials from Windows Credential
    Manager (no stored password, no elevation). It will NOT run when the
    device is on but nobody is logged in, so on an always-on DESKTOP pass
    '-LogonType S4U' instead -- that fires whether or not anyone is logged on,
    still without a stored password. Verify an S4U registration with one
    Start-ScheduledTask before trusting it: with no interactive desktop, a Git
    Credential Manager prompt would hang the push rather than ask.
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
    [string]$At = '6:00PM',
    # Interactive = runs only while you are logged on. Correct for a laptop,
    # where "I open the lid" IS the logon that lets -StartWhenAvailable fire.
    # S4U = runs whether or not anyone is logged on, with no stored password.
    # Correct for an always-on desktop, which would otherwise never fire while
    # sitting at the lock screen.
    #
    # This was documented in .BEHAVIOUR as the remedy for an always-on desktop
    # but was never actually exposed as a parameter -- the value was hardcoded
    # below, so following the documentation was impossible without editing the
    # file. That is exactly how ARUN_HOME ended up with no task at all.
    #
    # S4U CAVEAT, verify it before trusting it: an S4U task gets no interactive
    # desktop, so if Git Credential Manager ever needs to PROMPT for the
    # GitHub credential the push hangs instead of asking. Register, then run
    # `Start-ScheduledTask` once and confirm the push actually landed.
    [ValidateSet('Interactive','S4U')]
    [string]$LogonType = 'Interactive'
)

$ErrorActionPreference = 'Stop'

$runner = Join-Path $RepoPath 'scripts\rocket_residential_refresh.ps1'
if (-not (Test-Path $runner)) {
    throw "Runner not found at $runner -- is the repo cloned at $RepoPath?"
}

# -RepoPath is forwarded explicitly. Without it the registered task ran the
# runner with NO argument, so the runner fell back to its own default
# (~/Github/Mortgage_Loan_Dashboard) and a device registered with a custom
# -RepoPath silently refreshed the wrong path -- or exited 2 "repo not found"
# every week, in a log file that lived under that same wrong path.
$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runner`" -RepoPath `"$RepoPath`""

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

# Run as the current user, no stored password and no elevation either way.
# See the -LogonType parameter help for which value fits which kind of device.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType $LogonType

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
