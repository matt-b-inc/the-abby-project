param([string]$ImageTag = 'abby-unity-web:local')
$ErrorActionPreference = 'Stop'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker Desktop is required for this hosting check.' }
Add-Type -AssemblyName System.Net.Http
$taskName = 'abby-unity-host-check-' + [guid]::NewGuid().ToString('N')
$taskHandler = New-Object System.Net.Http.HttpClientHandler
$taskHandler.AllowAutoRedirect = $false
$taskClient = New-Object System.Net.Http.HttpClient($taskHandler)
$taskClient.Timeout = [TimeSpan]::FromSeconds(5)
$taskStarted = $false

function Assert-HostedResponse([string]$Path, [int]$Status, [string]$ContentType = '') {
    $taskResponse = $taskClient.GetAsync($taskOrigin + $Path).GetAwaiter().GetResult()
    try {
        if ([int]$taskResponse.StatusCode -ne $Status) { throw "$Path returned $([int]$taskResponse.StatusCode), expected $Status." }
        if ($ContentType -and $taskResponse.Content.Headers.ContentType.MediaType -ne $ContentType) { throw "$Path has the wrong Content-Type." }
        if (-not $taskResponse.Headers.CacheControl) { throw "$Path is missing Cache-Control." }
        if ($Path.StartsWith('/play') -and $Status -ne 404 -and -not $taskResponse.Headers.CacheControl.NoCache) { throw "$Path must revalidate across deployments." }
        if ($Path -eq '/play' -and $taskResponse.Headers.Location.ToString() -ne '/play/') { throw 'The /play redirect must preserve a relative /play/ path behind the HTTPS proxy.' }
        if ($Path.StartsWith('/api/') -and -not $taskResponse.Headers.CacheControl.NoStore) { throw 'An API request reaching this static host must not be cached.' }
        Write-Host "PASS $Status $Path"
    } finally { $taskResponse.Dispose() }
}

try {
    & docker run --rm $ImageTag nginx -t
    if ($LASTEXITCODE -ne 0) { throw 'nginx configuration validation failed.' }
    & docker run --detach --rm --name $taskName --publish '127.0.0.1::8080' $ImageTag | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'The disposable hosting container could not start.' }
    $taskStarted = $true
    $taskMapping = (& docker port $taskName '8080/tcp' | Select-Object -First 1).Trim()
    if ($LASTEXITCODE -ne 0 -or $taskMapping -notmatch '^127\.0\.0\.1:\d+$') { throw 'Expected a loopback-only Docker port mapping.' }
    $taskOrigin = 'http://' + $taskMapping
    $taskReady = $false
    for ($taskAttempt = 0; $taskAttempt -lt 30; $taskAttempt++) {
        try {
            $taskProbe = $taskClient.GetAsync($taskOrigin + '/health').GetAwaiter().GetResult()
            $taskReady = $taskProbe.IsSuccessStatusCode
            $taskProbe.Dispose()
            if ($taskReady) { break }
        } catch { }
        Start-Sleep -Milliseconds 100
    }
    if (-not $taskReady) { throw 'The disposable hosting container did not become ready.' }
    $taskWasm = (& docker exec $taskName find /usr/share/nginx/html/play/Build -name '*.wasm' -print -quit | Select-Object -First 1).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $taskWasm) { throw 'The image has no uncompressed Wasm runtime.' }
    $taskWasmPath = $taskWasm.Substring('/usr/share/nginx/html'.Length)
    Assert-HostedResponse '/health' 200 'text/plain'
    Assert-HostedResponse '/play' 308
    Assert-HostedResponse '/play/' 200 'text/html'
    Assert-HostedResponse $taskWasmPath 200 'application/wasm'
    Assert-HostedResponse ('/play/Build/missing-' + [guid]::NewGuid().ToString('N') + '.wasm') 404
    Assert-HostedResponse ('/play/Build/missing-' + [guid]::NewGuid().ToString('N') + '.data') 404
    Assert-HostedResponse '/api/auth/me/' 404
    Assert-HostedResponse '/play-other/' 404
    Assert-HostedResponse '/' 404
    Write-Host 'Unity hosting checks passed. The disposable container will be removed.'
} finally {
    $taskClient.Dispose()
    $taskHandler.Dispose()
    if ($taskStarted) {
        & docker rm --force $taskName | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Warning "Could not remove the check container: $taskName" }
    }
}
