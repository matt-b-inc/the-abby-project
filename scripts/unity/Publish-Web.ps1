param(
    [string]$ExportPath,
    [string]$ImageTag = 'abby-unity-web:local',
    [switch]$BuildImage,
    [switch]$SaveImage
)
$ErrorActionPreference = 'Stop'
if ($SaveImage -and -not $BuildImage) { throw '-SaveImage requires -BuildImage so the archive contains this export, not an older image.' }
$taskRepository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$taskProject = Join-Path $taskRepository 'unity\AbbyCamp'
if ([string]::IsNullOrWhiteSpace($ExportPath)) {
    $ExportPath = Join-Path $taskProject 'Builds\Web'
}
if (-not (Test-Path -LiteralPath $ExportPath -PathType Container)) {
    throw "Unity Web export not found: $ExportPath. Run Build-Camp.ps1 -Target Web first."
}
$taskExport = (Resolve-Path -LiteralPath $ExportPath).Path
if (-not (Test-Path -LiteralPath (Join-Path $taskExport 'index.html') -PathType Leaf)) {
    throw 'The export must contain index.html at its root.'
}
$taskBuildDirectory = Join-Path $taskExport 'Build'
foreach ($taskPattern in @('*.wasm', '*.data', '*.framework.js', '*.loader.js')) {
    if (-not (Get-ChildItem -LiteralPath $taskBuildDirectory -Filter $taskPattern -File -ErrorAction SilentlyContinue)) {
        throw "The export is missing Build/$taskPattern. Use the uncompressed Web build produced by Build-Camp.ps1."
    }
}
$taskCompressed = Get-ChildItem -LiteralPath $taskExport -Recurse -File |
    Where-Object { $_.Extension -in @('.gz', '.br', '.unityweb') } |
    Select-Object -First 1
if ($taskCompressed) {
    throw "Compressed export found: $($taskCompressed.Name). Rebuild with Web compression disabled; this host applies HTTP gzip itself."
}
if ([string]::IsNullOrWhiteSpace($ImageTag) -or $ImageTag.StartsWith('-')) {
    throw 'ImageTag must be a Docker image name, for example registry.example.com/abby/unity-web:preview-1.'
}

# A new context preserves older exports/packages and contains no application
# secrets or Unity import cache. All generated output remains under Builds.
$taskContext = Join-Path $taskProject ('Builds\WebHosting\' + [guid]::NewGuid().ToString('N'))
$taskStagedExport = Join-Path $taskContext 'unity\AbbyCamp\Builds\Web'
$taskStagedHosting = Join-Path $taskContext 'scripts\unity\hosting'
New-Item -ItemType Directory -Path $taskStagedExport, $taskStagedHosting -Force | Out-Null
Get-ChildItem -LiteralPath $taskExport -Force | Copy-Item -Destination $taskStagedExport -Recurse -Force
Copy-Item -LiteralPath (Join-Path $taskRepository 'Dockerfile.unity-web') -Destination $taskContext
Copy-Item -LiteralPath (Join-Path $taskRepository 'Dockerfile.unity-web.dockerignore') -Destination $taskContext
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'hosting\nginx.conf') -Destination $taskStagedHosting

Write-Host "Staged Unity hosting context: $taskContext"
$taskArchive = $null
if ($BuildImage) {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Install/start Docker Desktop to build the image. The staged context remains available.' }
    & docker build --file (Join-Path $taskContext 'Dockerfile.unity-web') --tag $ImageTag $taskContext
    if ($LASTEXITCODE -ne 0) { throw 'Docker image build failed. The staged context remains available.' }
    Write-Host "Built image: $ImageTag. Nothing was pushed or deployed."
    if ($SaveImage) {
        $taskArchive = Join-Path $taskContext 'unity-web-image.tar'
        & docker image save --output $taskArchive $ImageTag
        if ($LASTEXITCODE -ne 0) { throw 'Saving the image archive failed. The built image and staged context remain available.' }
        Write-Host "Saved image archive: $taskArchive"
    }
} else {
    Write-Host 'No image built. Use -BuildImage when ready, or transfer this directory to your Docker build host.'
}

# Pipeline callers can capture this object without parsing status messages.
[pscustomobject]@{ ContextPath = $taskContext; ExportPath = $taskExport; ImageTag = $ImageTag; ImageBuilt = [bool]$BuildImage; ImageArchive = $taskArchive }
