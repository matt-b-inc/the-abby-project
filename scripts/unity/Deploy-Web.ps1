<#
.SYNOPSIS
Build, verify, transfer and deploy the separate Unity Web resource in Coolify.
.DESCRIPTION
Requires an already configured Compose resource with UNITY_WEB_IMAGE and
pull_policy: never. Uses a known SSH host key. Proxmox mode uses the installed
Coolify service action; direct-host mode uses a token held only in memory.
It never creates resources, edits routing, pushes Git, or prunes older images.
#>
[CmdletBinding(SupportsShouldProcess = $true, DefaultParameterSetName = 'Build')]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_.-]*(?:@[A-Za-z0-9][A-Za-z0-9_.-]*)?$')]
    [string]$SshTarget,
    [ValidateRange(1, 65535)][int]$SshPort = 22,
    [string]$IdentityFile,
    [Parameter(Mandatory = $true)][string]$ExpectedDockerHostId,
    [uri]$CoolifyUrl,
    [ValidateSet('Application', 'Service')][string]$ResourceKind = 'Service',
    [ValidateRange(0, 999999999)][int]$ProxmoxContainerId = 0,
    [ValidateRange(0, 999999999)][int]$ExpectedCoolifyServerId = 0,
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_.-]*$')][string]$CoolifyContainerName = 'coolify',
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9_-]+$')][string]$ResourceUuid,
    [string]$ExpectedResourceName = 'abby-unity-web',
    [ValidatePattern('^[A-Za-z0-9_-]+$')][string]$ComposeProject,
    [Parameter(Mandatory = $true)][uri]$PublicUrl,
    [Security.SecureString]$ApiToken,
    [Parameter(ParameterSetName = 'Archive', Mandatory = $true)][string]$ArchivePath,
    [Parameter(ParameterSetName = 'Archive')][switch]$VerifyDeployed,
    [Parameter(ParameterSetName = 'Archive', Mandatory = $true)]
    [Parameter(ParameterSetName = 'Build')]
    [ValidatePattern('^abby-unity-web:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$')]
    [string]$ImageTag,
    [Parameter(ParameterSetName = 'Build')][string]$UnityEditor,
    [Parameter(ParameterSetName = 'Build')][switch]$SkipUnityBuild,
    [ValidateRange(30, 1800)][int]$DeploymentTimeoutSeconds = 300
)
$ErrorActionPreference = 'Stop'
if ($ProxmoxContainerId -and ($CoolifyUrl -or $ApiToken -or $ResourceKind -ne 'Service')) {
    throw 'ProxmoxContainerId uses the installed Coolify Service action; omit CoolifyUrl and ApiToken and use ResourceKind Service.'
}
if (-not $ProxmoxContainerId -and (-not $CoolifyUrl -or -not $CoolifyUrl.IsAbsoluteUri -or $CoolifyUrl.UserInfo -or $CoolifyUrl.Query -or $CoolifyUrl.Fragment -or
    ($CoolifyUrl.Scheme -ne 'https' -and -not ($CoolifyUrl.Scheme -eq 'http' -and $CoolifyUrl.IsLoopback)))) {
    throw 'CoolifyUrl must use HTTPS, or HTTP through a loopback SSH tunnel, without credentials, query or fragment.'
}
if (-not $ProxmoxContainerId -and $CoolifyUrl.AbsolutePath.TrimEnd('/') -notin @('', '/api/v1')) { throw 'CoolifyUrl must be the Coolify origin, optionally ending in /api/v1.' }
if (-not $PublicUrl.IsAbsoluteUri -or $PublicUrl.Scheme -ne 'https' -or $PublicUrl.UserInfo -or
    $PublicUrl.AbsolutePath -ne '/play/' -or $PublicUrl.Query -or $PublicUrl.Fragment) {
    throw 'PublicUrl must be the existing HTTPS app origin followed by /play/.'
}
if ([string]::IsNullOrWhiteSpace($ExpectedDockerHostId)) { throw 'Supply the Docker daemon ID verified on the intended Coolify destination.' }
if ([string]::IsNullOrWhiteSpace($ComposeProject)) { $ComposeProject = $ResourceUuid }
foreach ($taskCommand in @('docker', 'ssh', 'scp', 'tar')) {
    if (-not (Get-Command $taskCommand -ErrorAction SilentlyContinue)) { throw "Required command not found: $taskCommand" }
}
$taskSshOptions = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15')
if ($IdentityFile) {
    $IdentityFile = (Resolve-Path -LiteralPath $IdentityFile).Path
    $taskSshOptions += @('-i', $IdentityFile)
}
$taskSshArguments = $taskSshOptions + @('-p', [string]$SshPort, $SshTarget)
$taskScpArguments = $taskSshOptions + @('-P', [string]$SshPort)

function Invoke-UnitySsh([string]$Script) {
    # ASCII-only, validated parameters are substituted into fixed shell code.
    # Never put an API token, application environment, or password in this pipe.
    # Windows PowerShell adds CRLF to native stdin. Strip CR before POSIX sh.
    $taskRemoteOutput = ($Script.Replace("`r`n", "`n") + "`n") | & ssh @taskSshArguments 'tr -d ''\r'' | sh -se'
    if ($LASTEXITCODE -ne 0) { throw 'SSH command failed. Deployment stopped; previous images and archives are retained.' }
    return $taskRemoteOutput
}

function Invoke-UnityDockerHost([string]$Script) {
    if (-not $ProxmoxContainerId) { return (Invoke-UnitySsh $Script) }
    $taskDelimiter = 'ABBY_LXC_' + [guid]::NewGuid().ToString('N')
    return (Invoke-UnitySsh ("pct exec $ProxmoxContainerId -- sh -se <<'$taskDelimiter'`n" + $Script + "`n$taskDelimiter"))
}

function Invoke-UnityServiceAction([string]$Operation) {
    $taskPayload = @{ uuid = $ResourceUuid; name = $ExpectedResourceName; image = $ImageTag; operation = $Operation; server_id = $ExpectedCoolifyServerId } | ConvertTo-Json -Compress
    $taskPayload64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($taskPayload))
    $taskPhp = @'
<?php
try {
    require '/var/www/html/vendor/autoload.php';
    $app = require '/var/www/html/bootstrap/app.php';
    $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
    $p = json_decode(base64_decode('__PAYLOAD__'), true, flags: JSON_THROW_ON_ERROR);
    $s = App\Models\Service::where('uuid', $p['uuid'])->firstOrFail();
    if ($s->name !== $p['name']) { throw new RuntimeException('Resource name mismatch.'); }
    if ((int) $s->server_id !== (int) $p['server_id']) { throw new RuntimeException('Resource server mismatch.'); }
    if ($p['operation'] === 'get') {
        echo json_encode(['uuid' => $s->uuid, 'name' => $s->name, 'docker_compose_raw' => $s->docker_compose_raw], JSON_THROW_ON_ERROR);
    } elseif ($p['operation'] === 'start') {
        $compose = Symfony\Component\Yaml\Yaml::parse($s->docker_compose_raw);
        if (array_keys($compose['services'] ?? []) !== ['unity-web'] ||
            ($compose['services']['unity-web']['pull_policy'] ?? '') !== 'never' ||
            !str_contains($compose['services']['unity-web']['image'] ?? '', 'UNITY_WEB_IMAGE')) {
            throw new RuntimeException('Unexpected service compose configuration.');
        }
        $s->environment_variables()->updateOrCreate(
            ['key' => 'UNITY_WEB_IMAGE', 'is_preview' => false],
            ['value' => $p['image'], 'is_literal' => true, 'is_runtime' => true, 'is_buildtime' => false]
        );
        $s->unsetRelation('environment_variables');
        $activity = App\Actions\Service\StartService::run(service: $s, pullLatestImages: false);
        echo json_encode(['deployment_uuid' => $activity->uuid ?? null, 'activity_id' => $activity->id ?? null], JSON_THROW_ON_ERROR);
    } else { throw new RuntimeException('Unexpected operation.'); }
} catch (Throwable $error) {
    fwrite(STDERR, "Coolify service operation failed; inspect the selected service locally.\n");
    exit(1);
}
'@
    $taskPhp = $taskPhp.Replace('__PAYLOAD__', $taskPayload64)
    $taskPhpDelimiter = 'ABBY_PHP_' + [guid]::NewGuid().ToString('N')
    $taskActionOutput = Invoke-UnityDockerHost ("docker exec -i '$CoolifyContainerName' php <<'$taskPhpDelimiter'`n" + $taskPhp + "`n$taskPhpDelimiter")
    return (($taskActionOutput -join "`n") | ConvertFrom-Json)
}

Add-Type -AssemblyName System.Net.Http
$taskApiHandler = New-Object System.Net.Http.HttpClientHandler
$taskApiHandler.AllowAutoRedirect = $false
$taskApiClient = New-Object System.Net.Http.HttpClient($taskApiHandler)
$taskApiClient.Timeout = [TimeSpan]::FromSeconds(30)
$taskPublicHandler = New-Object System.Net.Http.HttpClientHandler
$taskPublicHandler.AllowAutoRedirect = $false
$taskPublicClient = New-Object System.Net.Http.HttpClient($taskPublicHandler)
$taskPublicClient.Timeout = [TimeSpan]::FromSeconds(60)
$taskApiBase = if ($CoolifyUrl) { $CoolifyUrl.GetLeftPart([UriPartial]::Authority) + '/api/v1' } else { $null }
$taskPublicOrigin = $PublicUrl.GetLeftPart([UriPartial]::Authority)
$taskResourceCollection = if ($ResourceKind -eq 'Service') { 'services' } else { 'applications' }
$taskResourcePath = '/' + $taskResourceCollection + '/' + $ResourceUuid

function Invoke-UnityCoolify([string]$Method, [string]$Path, $Body = $null) {
    $taskRequest = New-Object System.Net.Http.HttpRequestMessage((New-Object System.Net.Http.HttpMethod($Method)), ($taskApiBase + $Path))
    if ($null -ne $Body) {
        $taskRequest.Content = New-Object System.Net.Http.StringContent(($Body | ConvertTo-Json -Compress), [Text.Encoding]::UTF8, 'application/json')
    }
    try {
        $taskResponse = $taskApiClient.SendAsync($taskRequest).GetAwaiter().GetResult()
        try {
            if (-not $taskResponse.IsSuccessStatusCode) {
                # Responses can contain environment values. Report only status.
                throw "Coolify $Method $Path returned HTTP $([int]$taskResponse.StatusCode)."
            }
            $taskJson = $taskResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            if ($taskJson) { return ($taskJson | ConvertFrom-Json) }
        } finally { $taskResponse.Dispose() }
    } finally { $taskRequest.Dispose() }
}

function Assert-UnityAppHealth {
    $taskResponse = $taskPublicClient.GetAsync($taskPublicOrigin + '/health').GetAwaiter().GetResult()
    try {
        if (-not $taskResponse.IsSuccessStatusCode) { throw "The existing Abby app health check returned HTTP $([int]$taskResponse.StatusCode)." }
    } finally { $taskResponse.Dispose() }
}

function Assert-UnityComposeScope([string]$Compose) {
    # Accept the explicit block-map shape of our supplied Compose template.
    # Reject aliases/flow maps instead of guessing what services they expand to.
    $taskLines = $Compose -split '\r?\n'
    $taskHeaders = @(for ($taskLineIndex = 0; $taskLineIndex -lt $taskLines.Count; $taskLineIndex++) {
        if ($taskLines[$taskLineIndex] -match '^services:\s*(?:#.*)?$') { $taskLineIndex }
    })
    if ($taskHeaders.Count -ne 1) { throw 'Use the supplied explicit services block; aliases, flow maps and multiple services blocks are unsupported.' }
    $taskServiceIndent = $null
    $taskServiceNames = @()
    for ($taskLineIndex = $taskHeaders[0] + 1; $taskLineIndex -lt $taskLines.Count; $taskLineIndex++) {
        $taskLine = $taskLines[$taskLineIndex]
        if ($taskLine -match '^\s*(?:#.*)?$') { continue }
        if ($taskLine -match '^\S') { break }
        if ($taskLine -match '\t') { throw 'Compose indentation must use spaces.' }
        $taskIndent = $taskLine.Length - $taskLine.TrimStart().Length
        if ($null -eq $taskServiceIndent) { $taskServiceIndent = $taskIndent }
        if ($taskIndent -lt $taskServiceIndent) { throw 'Unexpected services block indentation.' }
        if ($taskIndent -eq $taskServiceIndent) {
            if ($taskLine.Trim() -notmatch '^([A-Za-z0-9_-]+):\s*(?:#.*)?$') { throw 'Use explicit service mappings from the supplied Compose template.' }
            $taskServiceNames += $Matches[1]
        }
    }
    if ($taskServiceNames.Count -ne 1 -or $taskServiceNames[0] -cne 'unity-web') { throw 'The selected resource must contain only the unity-web service.' }
}

try {
    if ($ProxmoxContainerId) {
        $taskResource = Invoke-UnityServiceAction 'get'
    } else {
        if (-not $ApiToken) { $ApiToken = Read-Host 'Coolify API token (held only in memory)' -AsSecureString }
        if (-not $ApiToken.Length) { throw 'A Coolify API token is required.' }
        $taskTokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ApiToken)
        try {
            $taskApiClient.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskTokenPointer))
        } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskTokenPointer) }
        $taskResource = Invoke-UnityCoolify 'GET' $taskResourcePath
    }
    if ($taskResource.uuid -cne $ResourceUuid -or $taskResource.name -cne $ExpectedResourceName) {
        throw 'Coolify resource identity/name did not match. No build or remote change was made.'
    }
    if (-not $ProxmoxContainerId -and $ResourceKind -eq 'Service' -and [int]$taskResource.server_id -ne $ExpectedCoolifyServerId) {
        throw 'The selected service is not assigned to the expected Coolify server.'
    }
    if ($ResourceKind -eq 'Application' -and $taskResource.build_pack -ne 'dockercompose') {
        throw 'The local archive flow requires a Docker Compose application, not a Docker Image resource that pulls from a registry.'
    }
    $taskCompose = [string]$taskResource.docker_compose_raw
    if ($taskCompose -notmatch '\bUNITY_WEB_IMAGE\b' -or $taskCompose -notmatch 'pull_policy:\s*["'']?never\b') {
        throw 'The selected Compose resource must reference UNITY_WEB_IMAGE and set pull_policy: never. Configure the supplied hosting compose first.'
    }
    Assert-UnityComposeScope $taskCompose
    Assert-UnityAppHealth
    $taskRemoteHostId = [string](Invoke-UnityDockerHost "docker info --format '{{.ID}}'" | Select-Object -Last 1)
    if ($taskRemoteHostId.Trim() -cne $ExpectedDockerHostId.Trim()) { throw 'The SSH target is not the verified Coolify Docker daemon. No remote change was made.' }

    if ($PSCmdlet.ParameterSetName -eq 'Build') {
        if (-not $ImageTag) { $ImageTag = 'abby-unity-web:release-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8) }
        & docker image inspect $ImageTag *> $null
        if ($LASTEXITCODE -eq 0) { throw 'That image tag already exists locally. Choose a new version tag to preserve rollback images.' }
        if (-not $SkipUnityBuild) {
            $taskBuildParameters = @{ Target = 'Web' }
            if ($UnityEditor) { $taskBuildParameters.UnityEditor = $UnityEditor }
            & (Join-Path $PSScriptRoot 'Build-Camp.ps1') @taskBuildParameters
        }
        $taskPackage = @(& (Join-Path $PSScriptRoot 'Publish-Web.ps1') -BuildImage -SaveImage -ImageTag $ImageTag) |
            Where-Object { $_.ImageArchive } | Select-Object -Last 1
        if (-not $taskPackage) { throw 'Packaging did not return an image archive.' }
        $ArchivePath = $taskPackage.ImageArchive
    }
    $ArchivePath = (Resolve-Path -LiteralPath $ArchivePath).Path
    $taskManifestOutput = & tar -xOf $ArchivePath 'manifest.json'
    if ($LASTEXITCODE -ne 0) { throw 'The archive is not a readable Docker image archive.' }
    $taskManifest = @(($taskManifestOutput -join "`n") | ConvertFrom-Json)
    if ($taskManifest.Count -ne 1 -or @($taskManifest[0].RepoTags).Count -ne 1 -or $taskManifest[0].RepoTags[0] -cne $ImageTag -or
        $taskManifest[0].Config -notmatch '^(?:blobs/sha256/)?([a-f0-9]{64})(?:\.json)?$') {
        throw 'The archive must contain exactly the selected Unity image/tag.'
    }
    $taskConfigId = 'sha256:' + $Matches[1]
    $taskAcceptedImageIds = @($taskConfigId)
    $taskArchiveMembers = @(& tar -tf $ArchivePath)
    if ($LASTEXITCODE -ne 0) { throw 'Could not list the image archive.' }
    if ($taskArchiveMembers -contains 'index.json') {
        $taskIndexOutput = & tar -xOf $ArchivePath 'index.json'
        if ($LASTEXITCODE -ne 0) { throw 'Could not read the OCI image index.' }
        $taskIndex = ($taskIndexOutput -join "`n") | ConvertFrom-Json
        if (@($taskIndex.manifests).Count -ne 1 -or $taskIndex.manifests[0].digest -notmatch '^sha256:[a-f0-9]{64}$') { throw 'Expected a single versioned image in the OCI index.' }
        $taskAcceptedImageIds += $taskIndex.manifests[0].digest
    }
    $taskImageOutput = @(& docker image inspect --format '{{.Id}}' $ImageTag 2>$null)
    if ($LASTEXITCODE -ne 0) {
        & docker image load --input $ArchivePath | Write-Host
        if ($LASTEXITCODE -ne 0) { throw 'Could not load the archive into local Docker for verification.' }
        $taskImageOutput = @(& docker image inspect --format '{{.Id}}' $ImageTag)
    }
    $taskImageId = [string]($taskImageOutput | Select-Object -Last 1)
    if ($LASTEXITCODE -ne 0 -or $taskAcceptedImageIds -cnotcontains $taskImageId) { throw 'The archive and local image have different content. No transfer was made.' }
    & (Join-Path $PSScriptRoot 'Test-WebHosting.ps1') -ImageTag $ImageTag
    $taskHashLines = @(& docker run --rm --entrypoint sh $ImageTag -c 'find /usr/share/nginx/html/play -type f -exec sha256sum {} \;')
    if ($LASTEXITCODE -ne 0 -or -not $taskHashLines.Count) { throw 'Could not fingerprint the verified image files.' }
    $taskHostedFiles = foreach ($taskLine in $taskHashLines) {
        if ($taskLine -notmatch '^(?<Hash>[a-f0-9]{64})\s+/usr/share/nginx/html(?<Path>/play/(?:[A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+)$') { throw 'Unexpected path in the image fingerprint; deployment stopped.' }
        [pscustomobject]@{ Path = $Matches.Path; Hash = $Matches.Hash }
    }
    $taskArchiveHash = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $taskRemoteDirectory = '/var/tmp/abby-unity-web-' + [guid]::NewGuid().ToString('N')
    $taskRemoteArchive = $taskRemoteDirectory + '/unity-web-image.tar'
    if (-not $VerifyDeployed -and -not $PSCmdlet.ShouldProcess("$ExpectedResourceName ($ResourceUuid) on $SshTarget", "Transfer/load $ImageTag and deploy it through Coolify")) {
        Write-Host 'Remote transfer, image load, configuration update and deployment were skipped.'
        return
    }

    $taskDeployment = $null
    if (-not $VerifyDeployed) {
    Invoke-UnitySsh "umask 077`nmkdir '$taskRemoteDirectory'" | Out-Null
    & scp @taskScpArguments $ArchivePath ($SshTarget + ':' + $taskRemoteArchive)
    if ($LASTEXITCODE -ne 0) { throw "Archive transfer failed. The local archive remains at $ArchivePath." }
    if ($ProxmoxContainerId) {
        Invoke-UnityDockerHost "umask 077`nmkdir '$taskRemoteDirectory'" | Out-Null
        Invoke-UnitySsh "pct push $ProxmoxContainerId '$taskRemoteArchive' '$taskRemoteArchive' --perms 0600" | Out-Null
    }
    $taskImportScript = @'
existing=$(docker image inspect --format '{{.Id}}' '__TAG__' 2>/dev/null || true)
if [ -n "$existing" ]; then
    case "$existing" in
        __ACCEPTED__) ;;
        *) printf '%s\n' 'Refusing to overwrite a different image at that version tag.' >&2; exit 1 ;;
    esac
fi
printf '%s  %s\n' '__SHA__' '__ARCHIVE__' | sha256sum --check --status
docker image load --input '__ARCHIVE__'
loaded=$(docker image inspect --format '{{.Id}}' '__TAG__')
case "$loaded" in
    __ACCEPTED__) ;;
    *) printf '%s\n' 'Loaded image identity does not match the archive.' >&2; exit 1 ;;
esac
'@
    $taskImportScript = $taskImportScript.Replace('__ACCEPTED__', ($taskAcceptedImageIds -join '|')).Replace('__TAG__', $ImageTag).Replace('__SHA__', $taskArchiveHash).Replace('__ARCHIVE__', $taskRemoteArchive)
    Invoke-UnityDockerHost $taskImportScript | Write-Host
    if ($ProxmoxContainerId) { $taskDeployment = Invoke-UnityServiceAction 'start' }
    else {
        Invoke-UnityCoolify 'PATCH' ($taskResourcePath + '/envs') @{ key = 'UNITY_WEB_IMAGE'; value = $ImageTag; is_preview = $false; is_literal = $true; is_multiline = $false } | Out-Null
        $taskDeployment = Invoke-UnityCoolify 'POST' ($taskResourcePath + '/start')
    }
    Write-Host "Coolify deployment requested for $ExpectedResourceName."
    } else { $taskRemoteArchive = $null }
    Write-Host 'Waiting for the exact Unity image to be healthy.'
    $taskDeadline = [DateTime]::UtcNow.AddSeconds($DeploymentTimeoutSeconds)
    $taskRunning = $false
    $taskProbeScript = @'
container=$(docker ps -q --filter 'label=com.docker.compose.project=__PROJECT__' --filter 'label=com.docker.compose.service=unity-web')
if [ -n "$container" ]; then
    docker inspect --format '{{.Image}} {{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $container
fi
'@
    $taskProbeScript = $taskProbeScript.Replace('__PROJECT__', $ComposeProject)
    do {
        $taskStates = @(Invoke-UnityDockerHost $taskProbeScript)
        if ($taskStates.Count -eq 1 -and @($taskAcceptedImageIds | ForEach-Object { $_ + ' healthy' }) -ccontains $taskStates[0]) { $taskRunning = $true; break }
        Start-Sleep -Seconds 5
    } while ([DateTime]::UtcNow -lt $taskDeadline)
    if (-not $taskRunning) { throw 'The exact Unity container did not become healthy before timeout. Check the selected resource in Coolify; no automatic rollback or image cleanup was performed.' }

    # Cloudflare adds challenge/analytics tags to HTML. Fingerprint the runtime
    # and styles exactly; check the public HTML's Unity canvas/loader separately.
    foreach ($taskFile in ($taskHostedFiles | Where-Object { -not $_.Path.EndsWith('.html') })) {
        $taskResponse = $taskPublicClient.GetAsync($taskPublicOrigin + $taskFile.Path, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        try {
            if (-not $taskResponse.IsSuccessStatusCode) { throw "Public Unity file $($taskFile.Path) returned HTTP $([int]$taskResponse.StatusCode)." }
            $taskStream = $taskResponse.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
            $taskHasher = [Security.Cryptography.SHA256]::Create()
            try { $taskPublicHash = [BitConverter]::ToString($taskHasher.ComputeHash($taskStream)).Replace('-', '').ToLowerInvariant() }
            finally { $taskHasher.Dispose(); $taskStream.Dispose() }
            if ($taskPublicHash -cne $taskFile.Hash) { throw "Public Unity file $($taskFile.Path) does not match the loaded image. Check /play routing and caches." }
        } finally { $taskResponse.Dispose() }
    }
    $taskResponse = $taskPublicClient.GetAsync($PublicUrl).GetAwaiter().GetResult()
    try {
        if (-not $taskResponse.IsSuccessStatusCode -or $taskResponse.Content.Headers.ContentType.MediaType -ne 'text/html') { throw 'The public /play/ page is not serving Unity HTML.' }
        $taskHtml = $taskResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        $taskLoader = $taskHostedFiles | Where-Object { $_.Path.EndsWith('.loader.js') } | Select-Object -First 1
        if ($taskHtml -notmatch '<canvas\b[^>]*\bid=["'']unity-canvas["'']' -or -not $taskHtml.Contains($taskLoader.Path.Substring('/play/'.Length))) {
            throw 'The public /play/ HTML does not reference the Unity canvas and matching loader.'
        }
    } finally { $taskResponse.Dispose() }
    Assert-UnityAppHealth
    if ($VerifyDeployed) { Write-Host "Existing deployment verified: $PublicUrl ($ImageTag). No remote change was made." }
    else { Write-Host "Deployed and verified: $PublicUrl ($ImageTag). Older images and archives remain available." }
    [pscustomobject]@{ PublicUrl = $PublicUrl.AbsoluteUri; ResourceUuid = $ResourceUuid; ImageTag = $ImageTag; ImageId = $taskImageId; LocalArchive = $ArchivePath; RemoteArchive = $taskRemoteArchive; DeploymentUuid = $taskDeployment.deployment_uuid; ActivityId = $taskDeployment.activity_id; VerificationOnly = [bool]$VerifyDeployed }
} finally {
    $taskApiClient.DefaultRequestHeaders.Authorization = $null
    $taskApiClient.Dispose(); $taskApiHandler.Dispose()
    $taskPublicClient.Dispose(); $taskPublicHandler.Dispose()
}
