import { deepStrictEqual, match, strictEqual } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { queryUntyped, useDatabase } from 'ohnejs';

import { startApp, type TestApp } from './_app.ts';

describe('a stored slug its route cannot take', () => {
  let app: TestApp;
  let uuid: string;

  before(async () => {
    app = await startApp({
      'ohne.config.ts': `import { defineConfig } from 'ohnejs';
export default defineConfig({
  layers: ['@ohnejs/cms'],
  collections: { locales: ['en', 'de'], defaultLocale: 'en' },
  cms: { site: 'https://example.com', routes: { Posts: { en: '/blog/[slug]', de: '/artikel/[...slug]' } } },
});
`,
      'collections/Posts.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields, publishedScope } from '@ohnejs/cms';
export default defineCollection({
  fields: { title: field('text'), ...pageFields() },
  api: { read: { public: true, access: publishedScope } },
});
`,
    });
    await queryUntyped('Site').updateOrThrow({ autoRedirect: true });
    await queryUntyped('Posts').createOrThrow({ title: 'Fit', slug: 'fit', status: 'published' });
    const post = await queryUntyped('Posts').createOrThrow({
      title: 'Unfit',
      slug: 'unfit',
      status: 'published',
    });
    uuid = post.UUID as string;
    // A write refuses this slug now, so the row stands in for data stored before the rule or a route edit.
    await useDatabase().run('UPDATE "Posts" SET "slug" = ? WHERE "UUID" = ?', ['a/b', uuid]);
  });

  after(() => app.stop());

  const resolve = async (path: string) =>
    (await app.get(`/cms/routes/resolve?path=${encodeURIComponent(path)}`)).body;

  it('leaves the page out of the sitemap only where it has no address', async () => {
    const response = await fetch(`http://127.0.0.1:${app.port}/cms/sitemap.xml`);
    strictEqual(response.status, 200);
    const xml = await response.text();
    match(xml, /<loc>https:\/\/example\.com\/blog\/fit<\/loc>/);
    match(xml, /<loc>https:\/\/example\.com\/de\/artikel\/a\/b<\/loc>/);
    strictEqual(xml.includes('/blog/a'), false);
  });

  it('serves the page where it fits, without an alternate where it does not', async () => {
    const page = await resolve('/de/artikel/a/b');
    strictEqual(page.kind, 'page');
    deepStrictEqual(
      page.alternates.map((alternate: { hreflang: string }) => alternate.hreflang),
      ['de'],
    );
    strictEqual((await resolve('/blog/a%2Fb')).kind, 'notFound');
  });

  it('saves a fitting slug over it, moving only the address it had', async () => {
    await queryUntyped('Posts').where({ UUID: uuid }).updateOrThrow({ slug: 'a-b' });
    const moved = (await queryUntyped('Redirects').findMany()).map((row) => [row.from, row.to]);
    deepStrictEqual(moved, [['/de/artikel/a/b', '/de/artikel/a-b']]);
  });
});
