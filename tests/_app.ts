import type { AddressInfo } from 'node:net';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  closeDatabases,
  type HTTPServer,
  serveAPI,
  shutdownServer,
  useCollections,
  useEnv,
  useShutdown,
} from 'ohnejs';

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), '..');
const FRAMEWORK = join(PACKAGE, 'node_modules', 'ohnejs');

/**
 * A running scratch app that stacks this layer.
 */
export interface TestApp {
  port: number;
  get(path: string): Promise<{ status: number; body: any }>;
  stop(): Promise<void>;
}

/**
 * Writes an app from `files`, relative paths to sources, stacking `@ohnejs/cms`, and serves its API.
 * `ohne.config.ts` defaults to the layer alone.
 */
export async function startApp(files: Record<string, string>): Promise<TestApp> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-cms-')));
  const all = {
    'package.json': JSON.stringify({
      name: 'app',
      type: 'module',
      dependencies: { ohnejs: '*', '@ohnejs/cms': '*' },
    }),
    'ohne.config.ts':
      "import { defineConfig } from 'ohnejs';\nexport default defineConfig({ layers: ['@ohnejs/cms'] });\n",
    ...files,
  };
  for (const [path, source] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), source);
  }
  mkdirSync(join(dir, 'node_modules', '@ohnejs'), { recursive: true });
  symlinkSync(FRAMEWORK, join(dir, 'node_modules', 'ohnejs'), 'dir');
  symlinkSync(PACKAGE, join(dir, 'node_modules', '@ohnejs', 'cms'), 'dir');

  useEnv().set('SILENT', true);
  useEnv().set('DATABASE', ':memory:');
  useEnv().set('PORT', 0);
  useEnv().set('NO_COLOR', true);

  let http: HTTPServer;
  try {
    http = await serveAPI(dir);
  } catch (error) {
    await reset(dir);
    throw error;
  }
  const { port } = http.server.address() as AddressInfo;
  return {
    port,
    async get(path) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      return { status: response.status, body: await response.json() };
    },
    async stop() {
      await shutdownServer(http.server, http.gate);
      await reset(dir);
    },
  };
}

/**
 * Releases everything an app registered, so the next one boots clean.
 * Hooks stay: the layers' boot files are cached modules, so a cleared hook would never register again.
 */
async function reset(dir: string): Promise<void> {
  await closeDatabases();
  useShutdown().clear();
  useShutdown().unwatch();
  useCollections().clear();
  useEnv().fill({});
  rmSync(dir, { recursive: true, force: true });
}
