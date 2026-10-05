import { strictEqual } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import { startApp, type TestApp } from './_app.ts';

describe('cors', () => {
  let app: TestApp;

  before(async () => {
    app = await startApp({
      'ohne.config.ts': `import { defineConfig } from 'ohnejs';
export default defineConfig({
  layers: ['@ohnejs/cms'],
  dashboard: { origin: 'http://dash.test' },
  cms: { site: 'http://site.test/base' },
});
`,
    });
  });

  after(() => app.stop());

  /**
   * The CORS headers the API answers a request from `origin` with.
   */
  async function headersFor(origin: string, method = 'GET'): Promise<Headers> {
    const response = await fetch(`http://127.0.0.1:${app.port}/cms/routes/resolve?path=/`, {
      method,
      headers: { origin, 'access-control-request-method': 'GET' },
    });
    await response.body?.cancel();
    return response.headers;
  }

  it('lets the website read without credentials', async () => {
    const headers = await headersFor('http://site.test');
    strictEqual(headers.get('access-control-allow-origin'), 'http://site.test');
    strictEqual(headers.get('access-control-allow-credentials'), null);
  });

  it('keeps the dashboard credentialed', async () => {
    const headers = await headersFor('http://dash.test');
    strictEqual(headers.get('access-control-allow-origin'), 'http://dash.test');
    strictEqual(headers.get('access-control-allow-credentials'), 'true');
  });

  it('answers any other origin without CORS headers', async () => {
    strictEqual((await headersFor('http://evil.test')).get('access-control-allow-origin'), null);
  });

  it('answers the website preflight', async () => {
    const headers = await headersFor('http://site.test', 'OPTIONS');
    strictEqual(headers.get('access-control-allow-origin'), 'http://site.test');
  });
});
