# Unity Web through Coolify

Unity source and the existing React/Django deployment have separate builds. A PR merge updates source; it does **not** compile or deploy the game. The Unity export, packaging contexts, logs, and screenshots stay ignored under `unity/AbbyCamp/Builds` and are not committed.

## Prepared preview — 2026-10-10

The latest local image is **`abby-unity-web:preview-20261010-v2`**. Its portable archive is on the development PC at `unity/AbbyCamp/Builds/WebHosting/b2a053249de44ad99c986f880f3e7ea0/unity-web-image.tar`, approximately 41 MB. This ignored artifact is not included in GitHub source. It was built from the successful Unity 6000.6.5f1 Web export and passed all nine hosting checks. The image has not been published or deployed.

For your local Coolify setup, use the **Local Coolify route without a registry** below: transfer/load that archive on the selected Docker host, create the separate Compose resource, and set `UNITY_WEB_IMAGE=abby-unity-web:preview-20261010-v2`. Deploy the React update as well, so its service worker allows `/play/` navigation. Then open the existing HTTPS hostname followed by `/play/` in Android Chrome.

On the phone, start in practice mode: tap the ground, greet the companion, change its appearance, and open Tasks. Rotate while signing in to check keyboard and layout behavior. Use your child account only when ready to record real completed activities. Check reopening the page and backgrounding/resuming it; browser viewport checks cannot establish real-device performance or keyboard behavior. iPhone Safari remains a separate check when Abby's phone is available.

## Build an image from the actual export

Close AbbyCamp in Unity, then run from the repository root:

```powershell
./scripts/unity/Build-Camp.ps1 -Target Web
./scripts/unity/Publish-Web.ps1 -BuildImage -ImageTag abby-unity-web:preview-1
./scripts/unity/Test-WebHosting.ps1 -ImageTag abby-unity-web:preview-1
```

This exports to `unity/AbbyCamp/Builds/Web`, stages only those browser files and the nginx configuration into a new ignored `Builds/WebHosting` directory, and builds an image. It never pushes or deploys. `Publish-Web.ps1` without `-BuildImage` creates the same portable context for a Docker build on another machine. Transfer that context as an artifact, or explicitly publish the built image to your registry. A Coolify Git-source build alone cannot find the ignored export. Use a new version tag for each tested build and do not overwrite old tags; a registry digest identifies fixed image content.

The initial export disables Unity compression. nginx applies HTTP gzip to JavaScript, Wasm, and data at runtime. Wasm is `application/wasm`; absent `.wasm`, `.data`, or other files return 404 instead of the React or Unity index. The index and build files revalidate on reload, so an update does not silently mix old and new files.

## Registry route: a separate Coolify image resource

Use a [Docker Image resource](https://coolify.io/docs/applications/deployments/docker-image) for an image you explicitly published to a registry. Set its container port to **8080** and health path to **/health**. Keep the existing Django resource and hostname routing. Coolify pulls this resource's image during deployment; importing a local tar alone is insufficient for this resource type.

Route only `/play` and `/play/…` on the **existing HTTPS hostname** to this new resource, with higher priority than the existing host-only router. Preserve the prefix. `/api`, `/mcp`, login, and the React app keep going to the existing Django resource. This gives the game and API the same origin without new CORS or auth settings. The static host does not proxy or cache API responses.

For Coolify's Traefik proxy, a custom router rule has this shape; use a unique resource name and your existing hostname:

```text
traefik.http.routers.abby-unity-web.rule=Host(`your-existing-hostname`) && (Path(`/play`) || PathPrefix(`/play/`))
traefik.http.routers.abby-unity-web.entrypoints=https
traefik.http.routers.abby-unity-web.tls=true
traefik.http.routers.abby-unity-web.priority=100
traefik.http.routers.abby-unity-web.service=abby-unity-web
traefik.http.services.abby-unity-web.loadbalancer.server.port=8080
```

Keep the resource attached to Coolify's proxy network and retain Coolify's configured HTTPS/certificate handling. If using manual labels, enable Traefik for the resource and preserve required generated network/certificate labels. If the existing application has a custom priority of 100 or higher, use a higher priority here. Do not add a strip-prefix middleware. For a Caddy-configured Coolify proxy, configure the equivalent host and path matcher; these Traefik labels do not apply. See [Coolify's networking documentation](https://coolify.io/docs/core/networking-in-coolify).

Open `https://your-existing-hostname/play/` in Android Chrome. The game should use that same hostname for its API origin. Do not enter localhost on the phone: that points at the phone itself. Native iOS packaging remains separate.

## Local Coolify route without a registry

Build and save a portable image:

```powershell
./scripts/unity/Publish-Web.ps1 -BuildImage -SaveImage -ImageTag abby-unity-web:preview-1
```

The script prints the path to `unity-web-image.tar` in its ignored context directory. Transfer that archive to the Docker host selected by Coolify, then import it there:

```sh
docker image load --input /path/to/unity-web-image.tar
```

Create a **separate Docker Compose resource** from [compose.coolify.yml](../scripts/unity/hosting/compose.coolify.yml), with `UNITY_WEB_IMAGE=abby-unity-web:preview-1` and `UNITY_WEB_HOST` set to the existing app hostname (no scheme or path). Its external proxy network defaults to `coolify`; if the selected Coolify destination uses a different network, set `UNITY_WEB_PROXY_NETWORK` to that existing name. The explicit network and matching `traefik.docker.network` label make the proxy select the correct connection. The file sets `pull_policy: never`, uses the loaded image, and contains only the `/play` router. Do not add a host-only router for this service. It uses the existing hostname's certificate; the existing app still handles everything outside `/play`. The example assumes Traefik and the usual `https` entrypoint. Adjust those labels for your configured proxy if necessary.

A missing local image makes this deployment fail rather than fetch another image. After each new build, transfer/load its new tag and update `UNITY_WEB_IMAGE`. The tar is a deployment artifact, not a Git file. No persistent storage, database access, backend credentials, or changes to the existing Compose stack are required.

## Local verification of the same files

To check the packaged static output without an account or database:

```powershell
docker run --rm --name abby-unity-web-preview -p 127.0.0.1:8088:8080 abby-unity-web:preview-1
```

Open `http://127.0.0.1:8088/play/` and use practice mode. Stop it with Ctrl+C. This loopback preview is for the development PC. It serves exactly the files in the Coolify image; it is not a phone-accessible HTTPS preview.

For a synthetic API walkthrough, the local Web fixture serves the same ignored export alongside disposable Django APIs on one loopback origin:

```powershell
python ./scripts/unity/web_fixture_server.py --port 8089
```

Open `http://127.0.0.1:8089/play/`. Use the synthetic child account `camp-smoke` with password `only-local-smoke`. The Web build selects this page's API origin automatically. Stop with Ctrl+C; this harness also stops after 30 minutes. Use `--port 0 --ready-file unity/AbbyCamp/Logs/web-fixture-ready.json` to choose a free port and record the resulting URL for automation. The fixture uses an isolated SQLite database and synthetic accounts; it never reads the project's `.env` or database. Python needs the repository's Django dependencies. This harness validates the browser build and API interaction locally; the packaged nginx image remains the Coolify deployment artifact.

The React PWA has root scope, so its navigation fallback must exclude `/play` and `/play/…`. An already installed web app must accept its service-worker update and reload before testing Unity; otherwise its older worker may keep serving the React shell at that path. Opening a fresh browser profile also avoids an older installed worker during initial diagnosis.

`Test-WebHosting.ps1` checks the actual image in a short-lived, loopback-only container and removes it afterward. It verifies `/play/` loads, `/play` redirects to `/play/`, a present Wasm file has `Content-Type: application/wasm`, missing runtime files are 404, and `/api/auth/me/` is not served or cached by this static host. These checks validate hosting; the browser walkthrough validates gameplay and mobile layout separately.
