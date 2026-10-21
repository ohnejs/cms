import { deepStrictEqual, strictEqual } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { queryMetadata, queryUntyped } from 'ohnejs';

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
      'collections/Tags.ts': `import { defineCollection, field } from 'ohnejs';
export default defineCollection({ fields: { slug: field('slug') } });
`,
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

  it('tells the dashboard a page slug keeps its slashes', () => {
    strictEqual(queryMetadata('Docs').fields.slug?.options?.nested, true);
  });

  it('leaves a slug outside the page fields to core', async () => {
    const tag = await queryUntyped('Tags').createOrThrow({ slug: 'AC/DC' });
    strictEqual(tag.slug, 'ac-dc');
  });

  it('keeps a slug unique within its collection', async () => {
    await queryUntyped('Posts').createOrThrow({ title: 'x', slug: 'hello' });
    const result = await queryUntyped('Posts').create({ title: 'y', slug: 'Hello' });
    deepStrictEqual(result.ok ? undefined : Object.keys(result.errors), ['slug']);
  });
});

describe('slug field across locales', () => {
  let app: TestApp;

  before(async () => {
    const page = (translatable: boolean) => `import { defineCollection, field } from 'ohnejs';
import { pageFields } from '@ohnejs/cms';
export default defineCollection({ fields: { title: field('text'), ...pageFields({ translatable: ${translatable} }) } });
`;
    app = await startApp({
      'ohne.config.ts': `import { defineConfig } from 'ohnejs';
export default defineConfig({
  layers: ['@ohnejs/cms'],
  collections: { locales: ['en', 'de'], defaultLocale: 'en' },
  cms: {
    routes: {
      Guides: { en: '/guides/[slug]', de: '/docs/[...slug]' },
      Shared: { en: '/s/[slug]', de: '/t/[...slug]' },
      Partial: { en: '/[...slug]' },
    },
  },
});
`,
      'collections/Guides.ts': page(true),
      'collections/Shared.ts': page(false),
      'collections/Partial.ts': page(true),
    });
  });

  after(() => app.stop());

  const failsAt = async (write: Promise<{ ok: boolean; errors?: object }>) => {
    const result = await write;
    return result.ok ? undefined : Object.keys(result.errors ?? {});
  };

  it("holds a translated slug to its own locale's route", async () => {
    deepStrictEqual(await failsAt(queryUntyped('Guides').create({ title: 'x', slug: 'a/b' })), [
      'slug',
    ]);
    const nested = await queryUntyped('Guides').locale('de').create({ title: 'x', slug: 'a/b' });
    strictEqual(nested.ok, true);
    const filled = await queryUntyped('Guides').create(
      { title: 'y', slug: 'flat' },
      { locales: { de: { slug: 'c/d' } } },
    );
    strictEqual(filled.ok, true);
  });

  it("holds a shared slug to every locale's route", async () => {
    deepStrictEqual(await failsAt(queryUntyped('Shared').create({ title: 'x', slug: 'a/b' })), [
      'slug',
    ]);
    strictEqual((await queryUntyped('Shared').create({ title: 'y', slug: 'c' })).ok, true);
  });

  it('refuses a slash in a locale without a route', async () => {
    deepStrictEqual(
      await failsAt(queryUntyped('Partial').locale('de').create({ title: 'x', slug: 'a/b' })),
      ['slug'],
    );
  });
});

describe('slug field under a locale tag written loosely', () => {
  let app: TestApp;

  before(async () => {
    app = await startApp({
      'ohne.config.ts': `import { defineConfig } from 'ohnejs';
export default defineConfig({
  layers: ['@ohnejs/cms'],
  collections: { locales: ['en', 'de-at'], defaultLocale: 'en' },
  cms: { routes: { Posts: { en: '/blog/[slug]', 'de-at': '/[...slug]' } } },
});
`,
      'collections/Posts.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields } from '@ohnejs/cms';
export default defineCollection({ fields: { title: field('text'), ...pageFields({ translatable: true }) } });
`,
    });
  });

  after(() => app.stop());

  it('matches the route of the canonical tag the write carries', async () => {
    const nested = await queryUntyped('Posts').locale('de-at').create({ title: 'x', slug: 'a/b' });
    strictEqual(nested.ok, true);
    strictEqual((await queryUntyped('Posts').create({ title: 'y', slug: 'c/d' })).ok, false);
  });
});
