import { deepStrictEqual, strictEqual } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { queryUntyped } from 'ohnejs';

import { startApp, type TestApp } from './_app.ts';

describe('slug field', () => {
  let app: TestApp;

  before(async () => {
    const collection = `import { defineCollection, field } from 'ohnejs';
import { pageFields } from '@ohnejs/cms';
export default defineCollection({ fields: { title: field('text'), ...pageFields() } });
`;
    app = await startApp({
      'ohne.config.ts': `import { defineConfig } from 'ohnejs';
export default defineConfig({ layers: ['@ohnejs/cms'], cms: { routes: { Docs: '/[...slug]', Posts: '/blog/[slug]' } } });
`,
      'collections/Docs.ts': collection,
      'collections/Posts.ts': collection,
    });
  });

  after(() => app.stop());

  it('slugifies each segment of a written slug', async () => {
    const doc = await queryUntyped('Docs').createOrThrow({
      title: 'x',
      slug: 'Über Uns/Get Started/',
    });
    strictEqual(doc.slug, 'uber-uns/get-started');
  });

  it('takes a slash only where the route ends in a catch-all', async () => {
    const result = await queryUntyped('Posts').create({ title: 'x', slug: 'a/b' });
    deepStrictEqual(result.ok ? undefined : Object.keys(result.errors), ['slug']);
  });

  it('keeps a slug unique within its collection', async () => {
    await queryUntyped('Posts').createOrThrow({ title: 'x', slug: 'hello' });
    const result = await queryUntyped('Posts').create({ title: 'y', slug: 'Hello' });
    deepStrictEqual(result.ok ? undefined : Object.keys(result.errors), ['slug']);
  });
});
