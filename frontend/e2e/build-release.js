import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [sourceDirectory, outDir, configFile] = process.argv.slice(2);
// Prevent the actual configuration from enabling its optional upload plugin.
delete process.env.SENTRY_AUTH_TOKEN;
await build({
  configFile,
  root: sourceDirectory,
  envFile: false,
  envDir: sourceDirectory,
  publicDir: join(frontendRoot, 'public'),
  logLevel: 'warn',
  build: { outDir, emptyOutDir: true },
});
