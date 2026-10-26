import { deepStrictEqual } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { queryUntyped } from 'ohnejs';

import { startApp, type TestApp } from './_app.ts';

describe('dashboard meta', () => {
  let app: TestApp;

  before(async () => {
    app = await startApp({
      'ohne.config.ts': `import { defineConfig } from 'ohnejs';
export default defineConfig({
  layers: ['@ohnejs/cms'],
  collections: { locales: ['en', 'de'], defaultLocale: 'en' },
  cms: { routes: { Pages: '/[...slug]/', Posts: { de: '/artikel/[slug]' } } },
});
`,
      'collections/Pages.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields } from '@ohnejs/cms';
export default defineCollection({
  fields: { title: field('text'), ...pageFields() },
  api: { read: 'public' },
});
`,
      'collections/Posts.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields } from '@ohnejs/cms';
export default defineCollection({ fields: { title: field('text'), ...pageFields() } });
`,
      'collections/Tags.ts': `import { defineCollection, field } from 'ohnejs';
export default defineCollection({ fields: { slug: field('slug') }, api: { read: 'public' } });
`,
    });
    await queryUntyped('Users').createOrThrow({
      email: 'admin@example.com',
      password: 'Correct-Horse-42',
      roles: ['admin'],
    });
  });

  after(() => app.stop());

  it('lists each routed collection with its normalized pattern per locale and a page slug', async () => {
    const base = `http://127.0.0.1:${app.port}`;
    const login = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'Correct-Horse-42' }),
    });
    const cookie = login.headers
      .getSetCookie()
      .map((line) => line.split(';')[0])
      .join('; ');
    const meta = (await (await fetch(`${base}/dashboard`, { headers: { cookie } })).json()) as {
      cms?: unknown;
      collections: { name: string; fields: { name: string; type: string; options?: object }[] }[];
    };
    deepStrictEqual(meta.cms, {
      routes: { Pages: { en: '/[...slug]', de: '/[...slug]' }, Posts: { de: '/artikel/[slug]' } },
      prefixDefaultLocale: false,
      homeSlug: 'index',
      notFoundSlug: '404',
      previewURL: '{path}?ohne-preview={token}',
      share: { durations: ['1h', '1d', '7d', '30d'], default: '1d' },
    });
    const slug = (collection: string) =>
      meta.collections
        .find((entry) => entry.name === collection)
        ?.fields.find((field) => field.name === 'slug');
    deepStrictEqual(slug('Pages')?.type, 'pageSlug');
    deepStrictEqual(slug('Pages')?.options, { nested: true, collection: 'Pages' });
    deepStrictEqual(slug('Tags')?.type, 'slug');
  });
});
