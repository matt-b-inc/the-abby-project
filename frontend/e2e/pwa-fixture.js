import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cacheRoot = join(frontendRoot, 'node_modules', '.cache');
const runFile = promisify(execFile);

async function removeFixture(directory) {
  // Check the absolute target before recursively removing anything on Windows.
  if (dirname(directory) !== cacheRoot || !directory.startsWith(join(cacheRoot, 'abby-pwa-'))) {
    throw new Error(`Refusing to remove unexpected fixture directory: ${directory}`);
  }
  await rm(directory, { recursive: true, force: true });
}

export async function buildReleases() {
  await mkdir(cacheRoot, { recursive: true });
  const directory = await mkdtemp(join(cacheRoot, 'abby-pwa-'));
  const releases = {};
  try {
    for (const label of ['A', 'B']) {
      const releaseDirectory = join(directory, label);
      const sourceDirectory = join(releaseDirectory, 'source');
      await mkdir(sourceDirectory, { recursive: true });
      const sourceImport = (file) => relative(sourceDirectory, join(frontendRoot, 'src', file)).replaceAll('\\', '/');
      await writeFile(join(sourceDirectory, 'index.html'), `<!doctype html><html><head><title>Synthetic PWA release ${label}</title></head><body><div id="root"></div><script type="module" src="/main.jsx"></script></body></html>`);
      await writeFile(join(sourceDirectory, 'main.jsx'), `
        import { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { PwaStatusProvider } from '${sourceImport('pwa/PwaStatusProvider.jsx')}';
        import UpdateBanner from '${sourceImport('pwa/UpdateBanner.jsx')}';
        import './main.css';
        function Fixture() {
          const [lazy, setLazy] = useState('');
          return <PwaStatusProvider><UpdateBanner /><h1 id="release">Release ${label}</h1>
            <button onClick={async () => setLazy((await import('./lazy.js')).message)}>Load lazy fixture</button>
            <p id="lazy">{lazy}</p></PwaStatusProvider>;
        }
        createRoot(document.getElementById('root')).render(<Fixture />);
      `);
      await writeFile(join(sourceDirectory, 'main.css'), `#release { color: ${label === 'A' ? 'rgb(17, 34, 51)' : 'rgb(51, 34, 17)'}; }`);
      await writeFile(join(sourceDirectory, 'lazy.js'), `import './lazy.css'; export const message = 'Lazy ${label}';`);
      await writeFile(join(sourceDirectory, 'lazy.css'), `#lazy { font-weight: ${label === 'A' ? '600' : '700'}; }`);
      // Vite loads plugins in an ordinary Node process: Playwright's test-file
      // transform hook can otherwise interfere with Vite's config bundler.
      await runFile(process.execPath, [join(frontendRoot, 'e2e', 'build-release.js'),
        sourceDirectory, join(releaseDirectory, 'frontend_dist'),
        process.env.PWA_VITE_CONFIG || join(frontendRoot, 'vite.config.js'),
      ]);
      const html = await readFile(join(releaseDirectory, 'frontend_dist', 'index.html'), 'utf8');
      releases[label] = {
        directory: releaseDirectory,
        html,
        entryAssets: [...html.matchAll(/(?:src|href)="(\/static\/assets\/[^" ]+\.(?:js|css))"/g)].map((match) => match[1]),
      };
    }
  } catch (error) {
    await removeFixture(directory);
    throw error;
  }
  return {
    releases,
    cleanup: () => removeFixture(directory),
  };
}

export async function startServer(release, port = 0) {
  // Pass only process-launch essentials. Never inherit application secrets,
  // production service URLs, or settings from a developer's environment.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|USERPROFILE|VIRTUAL_ENV|PYTHONPATH|PYTHONHOME)$/i.test(key)));
  const child = spawn(process.env.PWA_PYTHON || 'python', [
    join(frontendRoot, 'e2e', 'serve_pwa.py'), release.directory, String(port),
  ], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const actualPort = await new Promise((resolvePort, reject) => {
    const timer = setTimeout(() => reject(new Error(`Django fixture startup timed out:\n${output}`)), 45_000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Django fixture exited (${code}):\n${output}`)); });
    child.stdout.on('data', () => {
      const match = output.match(/READY (\d+)/);
      if (match) { clearTimeout(timer); resolvePort(Number(match[1])); }
    });
  }).catch((error) => { child.kill(); throw error; });
  let stopPromise;
  return {
    port: actualPort,
    origin: `http://127.0.0.1:${actualPort}`,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      if (!stopPromise) {
        stopPromise = once(child, 'exit');
        child.kill();
      }
      await stopPromise;
    },
  };
}
