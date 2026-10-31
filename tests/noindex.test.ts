import { strictEqual } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { queryUntyped } from 'ohnejs';

import { startApp, type TestApp } from './_app.ts';

describe('cms.noindex', () => {
  let app: TestApp;

  before(async () => {
    app = await startApp({
      'ohne.config.ts': `import { defineConfig } from 'ohnejs';
export default defineConfig({
  layers: ['@ohnejs/cms'],
  cms: { site: 'https://example.com', noindex: true, routes: { Pages: '/[...slug]' } },
});
`,
      'collections/Pages.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields, publishedScope } from '@ohnejs/cms';
export default defineCollection({
  fields: { title: field('text'), ...pageFields() },
  api: { read: { public: true, access: publishedScope } },
});
`,
    });
    await queryUntyped('Pages').createOrThrow({
      status: 'published',
      title: 'About',
      slug: 'about',
    });
  });

  after(() => app.stop());

  const text = async (path: string) => (await fetch(`http://127.0.0.1:${app.port}${path}`)).text();

  it('marks every page noindex while the site settings do not', async () => {
    strictEqual((await queryUntyped('Site').findFirst())?.noindex, false);
    const page = (await app.get('/cms/routes/resolve?path=%2Fabout')).body;
    strictEqual(page.seo.robots, 'noindex');
  });

  it('lists nothing in the sitemap', async () => {
    strictEqual((await text('/cms/sitemap.xml')).includes('<url>'), false);
  });

  it('keeps robots.txt open with no sitemap', async () => {
    strictEqual(await text('/cms/robots.txt'), 'User-agent: *\nDisallow:\n');
  });
});
