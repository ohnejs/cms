import type { AddressInfo } from 'node:net';

import { deepStrictEqual, ok } from 'node:assert';
import { createServer, type Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { queryUntyped } from 'ohnejs';

import { startApp, type TestApp } from './_app.ts';

describe('webhooks', () => {
  let app: TestApp;
  let hooks: Server;
  const received: { collection: string; event: string }[] = [];

  /**
   * Whether an `update` of `collection` arrived, waiting up to a second for it.
   */
  async function updated(collection: string): Promise<boolean> {
    const arrived = () =>
      received.some((entry) => entry.collection === collection && entry.event === 'update');
    for (let attempt = 0; attempt < 50 && !arrived(); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return arrived();
  }

  before(async () => {
    hooks = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        received.push(JSON.parse(body));
        response.end();
      });
    });
    await new Promise<void>((resolve) => hooks.listen(0, '127.0.0.1', resolve));
    const port = (hooks.address() as AddressInfo).port;
    app = await startApp({
      'ohne.config.ts': `import { defineConfig } from 'ohnejs';
export default defineConfig({
  layers: ['@ohnejs/cms'],
  cms: { webhooks: [{ url: 'http://127.0.0.1:${port}/hook', secret: 'a-webhook-secret-of-some-length' }] },
});
`,
      'collections/Settings.ts': `import { defineCollection, field } from 'ohnejs';
export default defineCollection({
  singleton: true,
  fields: { copyright: field('text', { default: '(c) Acme' }) },
  api: { read: 'public' },
});
`,
      'collections/Members.ts': `import { defineCollection, field } from 'ohnejs';
export default defineCollection({ fields: { name: field('text') } });
`,
      'collections/Staff.ts': `import { defineCollection, field } from 'ohnejs';
export default defineCollection({ fields: { name: field('text') }, api: { read: true } });
`,
    });
  });

  after(async () => {
    await app.stop();
    hooks.close();
  });

  it('fires for a public read and stays silent for a closed or guarded one', async () => {
    await queryUntyped('Members').createOrThrow({ name: 'Ada' });
    await queryUntyped('Staff').createOrThrow({ name: 'Grace' });
    await queryUntyped('Settings').updateOrThrow({ copyright: '(c) Acme 2026' });
    ok(await updated('Settings'));
    deepStrictEqual(
      received.filter((entry) => ['Members', 'Staff'].includes(entry.collection)),
      [],
    );
  });
});
