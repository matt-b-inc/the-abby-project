param(
    [string]$Python = (Get-Command python).Source
)
$ErrorActionPreference = 'Stop'
$taskRepository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$taskProject = Join-Path $taskRepository 'unity\AbbyCamp'
$taskExecutable = Join-Path $taskProject 'Builds\Windows\AbbyCamp.exe'
if (-not (Test-Path -LiteralPath $taskExecutable)) { throw 'Build the prototype with Build-Camp.ps1 first.' }
$taskLogDirectory = Join-Path $taskProject 'Logs'
$taskOutput = Join-Path $taskProject 'Screenshots\Smoke'
New-Item -ItemType Directory -Path $taskLogDirectory, $taskOutput -Force | Out-Null
$taskRunId = [Guid]::NewGuid().ToString('N')
$taskReadyFile = Join-Path $taskLogDirectory "fixture-$taskRunId.json"
$taskStopFile = Join-Path $taskLogDirectory "fixture-$taskRunId.stop"
$taskFixtureScript = Join-Path $PSScriptRoot 'prototype_fixture_server.py'
$taskFixtureOut = Join-Path $taskLogDirectory 'fixture-stdout.log'
$taskFixtureErr = Join-Path $taskLogDirectory 'fixture-stderr.log'
$taskPlayerLog = Join-Path $taskLogDirectory 'runtime-smoke.log'
$taskReport = Join-Path $taskOutput 'smoke-results.txt'
if (Test-Path -LiteralPath $taskReport) { Remove-Item -LiteralPath $taskReport }
$taskFixtureArguments = @(('"' + $taskFixtureScript + '"'), '--port', '0', '--ready-file', ('"' + $taskReadyFile + '"'), '--stop-file', ('"' + $taskStopFile + '"'), '--lifetime-seconds', '240', '--fail-first-log')
$taskFixture = $null
$taskPlayer = $null
try {
    $taskFixture = Start-Process -FilePath $Python -ArgumentList $taskFixtureArguments -WindowStyle Hidden -RedirectStandardOutput $taskFixtureOut -RedirectStandardError $taskFixtureErr -PassThru
    $taskReadyDeadline = [DateTime]::UtcNow.AddSeconds(30)
    while (-not (Test-Path -LiteralPath $taskReadyFile) -and [DateTime]::UtcNow -lt $taskReadyDeadline) {
        if ($taskFixture.HasExited) { throw "Fixture server exited. See $taskFixtureErr" }
        Start-Sleep -Milliseconds 250
    }
    if (-not (Test-Path -LiteralPath $taskReadyFile)) { throw "Fixture server did not become ready. See $taskFixtureErr" }
    $taskFixtureInfo = Get-Content -LiteralPath $taskReadyFile -Raw | ConvertFrom-Json
    $taskPlayerArguments = @('-screen-fullscreen', '0', '-screen-width', '1600', '-screen-height', '900', '-force-d3d11', '-logFile', ('"' + $taskPlayerLog + '"'), '--abby-smoke', '--abby-smoke-output', ('"' + $taskOutput + '"'), '--abby-api-url', $taskFixtureInfo.url, '--abby-api-user', $taskFixtureInfo.username, '--abby-api-password', $taskFixtureInfo.password)
    if ($taskFixtureInfo.fail_first_log) { $taskPlayerArguments += '--abby-smoke-failed-save' }
    Write-Host "Testing the camp against disposable Django fixtures. Screenshots: $taskOutput"
    $taskPlayer = Start-Process -FilePath $taskExecutable -ArgumentList $taskPlayerArguments -WindowStyle Hidden -PassThru
    $taskPlayerDeadline = [DateTime]::UtcNow.AddSeconds(90)
    while (-not $taskPlayer.HasExited -and [DateTime]::UtcNow -lt $taskPlayerDeadline) { Start-Sleep -Milliseconds 250 }
    if (-not $taskPlayer.HasExited) { throw "Runtime smoke timed out. See $taskPlayerLog" }
    if (-not (Test-Path -LiteralPath $taskReport)) { throw "Player exited without a smoke report. See $taskPlayerLog" }
    Get-Content -LiteralPath $taskReport
    if ($taskPlayer.ExitCode -ne 0) { throw "Runtime smoke failed. See $taskPlayerLog" }
} finally {
    if ($null -ne $taskPlayer -and -not $taskPlayer.HasExited) { Stop-Process -Id $taskPlayer.Id -Force }
    if ($null -ne $taskFixture -and -not $taskFixture.HasExited) {
        # Request graceful shutdown so Python disposes its temporary database.
        Set-Content -LiteralPath $taskStopFile -Value ''
        $taskCleanupDeadline = [DateTime]::UtcNow.AddSeconds(5)
        while (-not $taskFixture.HasExited -and [DateTime]::UtcNow -lt $taskCleanupDeadline) { Start-Sleep -Milliseconds 250 }
        if (-not $taskFixture.HasExited) { Write-Host 'Fixture cleanup will finish when its short lifetime ends.' }
    }
}
