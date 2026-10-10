param(
    [string]$UnityEditor,
    [switch]$ValidateOnly,
    [switch]$RebuildScene,
    [ValidateSet('Windows', 'Web')]
    [string]$Target = 'Windows',
    [string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$taskRepository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$taskProject = Join-Path $taskRepository 'unity\AbbyCamp'
if ([string]::IsNullOrWhiteSpace($UnityEditor)) {
    $UnityEditor = Join-Path $env:ProgramFiles 'Unity\Hub\Editor\6000.6.5f1\Editor\Unity.exe'
    if (-not (Test-Path -LiteralPath $UnityEditor)) {
        throw 'Install Unity 6000.6.5f1 in Unity Hub, then rerun this script. For a custom install location, pass -UnityEditor with that Unity.exe path.'
    }
}
if (-not (Test-Path -LiteralPath $UnityEditor)) { throw "Unity editor not found: $UnityEditor" }
if (-not [string]::IsNullOrWhiteSpace($OutputDirectory)) {
    if ($ValidateOnly -or $Target -ne 'Web') { throw '-OutputDirectory applies only to a Web build.' }
    $OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
    # Avoid a trailing backslash escaping the closing quote in Windows process arguments.
    if ($OutputDirectory -eq [System.IO.Path]::GetPathRoot($OutputDirectory)) { throw 'Choose a dedicated Web output directory, not a drive root.' }
    $OutputDirectory = $OutputDirectory.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
}
$taskLogDirectory = Join-Path $taskProject 'Logs'
New-Item -ItemType Directory -Path $taskLogDirectory -Force | Out-Null
$taskLog = Join-Path $taskLogDirectory $(if ($ValidateOnly) { 'validate.log' } elseif ($Target -eq 'Web') { 'build-web.log' } else { 'build.log' })
$taskMethod = if ($ValidateOnly) {
    if ($RebuildScene) { 'AbbyCamp.Editor.CampBuild.PrepareAndValidate' } else { 'AbbyCamp.Editor.CampBuild.ValidateAll' }
} else {
    if ($Target -eq 'Web') {
        if ($RebuildScene) { 'AbbyCamp.Editor.CampBuild.RebuildAndBuildWeb' } else { 'AbbyCamp.Editor.CampBuild.BuildWeb' }
    } else {
        if ($RebuildScene) { 'AbbyCamp.Editor.CampBuild.RebuildAndBuildWindows' } else { 'AbbyCamp.Editor.CampBuild.BuildWindows' }
    }
}
$taskArguments = @('-batchmode', '-nographics', '-quit', '-projectPath', ('"' + $taskProject + '"'), '-executeMethod', $taskMethod, '-logFile', ('"' + $taskLog + '"'))
if (-not $ValidateOnly) {
    # Batch builds must select the target before Unity imports the project.
    $taskArguments += @('-buildTarget', $(if ($Target -eq 'Web') { 'WebGL' } else { 'Win64' }))
}
if (-not [string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $taskArguments += @('-abbyWebOutput', ('"' + $OutputDirectory + '"'))
}
$taskProcess = Start-Process -FilePath $UnityEditor -ArgumentList $taskArguments -WindowStyle Hidden -PassThru
Write-Host "Unity is preparing the prototype. Log: $taskLog"
$taskProcess.WaitForExit()
if ($taskProcess.ExitCode -ne 0) {
    Get-Content -LiteralPath $taskLog -Tail 60
    throw "Unity exited with code $($taskProcess.ExitCode). See $taskLog"
}
if ($ValidateOnly) {
    Write-Host 'Prototype validation passed.'
} elseif ($Target -eq 'Web') {
    $taskOutput = if ([string]::IsNullOrWhiteSpace($OutputDirectory)) { Join-Path $taskProject 'Builds\Web' } else { $OutputDirectory }
    Write-Host "Built: $taskOutput"
    Write-Host 'Serve this whole directory over HTTP/HTTPS; opening index.html as a local file will not load Unity.'
} else {
    Write-Host "Built: $(Join-Path $taskProject 'Builds\Windows\AbbyCamp.exe')"
}
