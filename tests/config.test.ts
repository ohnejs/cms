import { rejects } from 'node:assert';
import { describe, it } from 'node:test';

import { startApp } from './_app.ts';

const PAGES = `import { defineCollection, field } from 'ohnejs';
import { pageFields } from '@ohnejs/cms';
export default defineCollection({ fields: { title: field('text'), ...pageFields() } });
`;

/**
 * An app config stacking the layer with `cms` set to the given source.
 */
const config = (cms: string, locales = "['en']") => `import { defineConfig } from 'ohnejs';
export default defineConfig({
  layers: ['@ohnejs/cms'],
  collections: { locales: ${locales}, defaultLocale: 'en' },
  cms: ${cms},
});
`;

/**
 * Boots an app with `files` and expects it to stop with a title matching `title`.
 */
async function refuses(files: Record<string, string>, title: RegExp): Promise<void> {
  await rejects(
    async () => (await startApp(files)).stop(),
    (error: Error) => title.test(error.message),
  );
}

describe('cms config', () => {
  it('refuses a route of an unknown collection', async () => {
    await refuses(
      { 'ohne.config.ts': config("{ routes: { Nope: '/[slug]' } }") },
      /Unknown collection `Nope`/,
    );
  });

  it('refuses a pattern without exactly one slug', async () => {
    await refuses(
      {
        'ohne.config.ts': config("{ routes: { Pages: '/pages' } }"),
        'collections/Pages.ts': PAGES,
      },
      /needs one `\[slug\]`/,
    );
    await refuses(
      { 'ohne.config.ts': config("{ routes: { Pages: '/[id]' } }"), 'collections/Pages.ts': PAGES },
      /needs one `\[slug\]`/,
    );
  });

  it('refuses a route of a collection without a slug field', async () => {
    await refuses(
      {
        'ohne.config.ts': config("{ routes: { Notes: '/[slug]' } }"),
        'collections/Notes.ts':
          "import { defineCollection, field } from 'ohnejs';\nexport default defineCollection({ fields: { title: field('text') } });\n",
      },
      /has a route but no `slug` field/,
    );
  });

  it('refuses two patterns that match the same paths', async () => {
    await refuses(
      {
        'ohne.config.ts': config("{ routes: { Pages: '/[slug]', Posts: '/[slug]' } }"),
        'collections/Pages.ts': PAGES,
        'collections/Posts.ts': PAGES,
      },
      /match the same paths/,
    );
  });

  it('refuses a pattern that starts with a locale code', async () => {
    await refuses(
      {
        'ohne.config.ts': config("{ routes: { Pages: '/de/[slug]' } }", "['en', 'de']"),
        'collections/Pages.ts': PAGES,
      },
      /starts with a locale/,
    );
  });

  it('refuses a route in a locale the app does not have', async () => {
    await refuses(
      {
        'ohne.config.ts': config("{ routes: { Pages: { fr: '/[slug]' } } }"),
        'collections/Pages.ts': PAGES,
      },
      /Unknown locale `fr`/,
    );
  });

  it('refuses a site that is not a URL', async () => {
    await refuses(
      { 'ohne.config.ts': config("{ site: 'example.com' }") },
      /Invalid `cms.site` value/,
    );
  });
});
