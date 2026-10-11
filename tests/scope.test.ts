import { deepStrictEqual, strictEqual } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { queryUntyped } from 'ohnejs';

import { startApp, type TestApp } from './_app.ts';

const APP = {
  'ohne.config.ts': `import { defineConfig } from 'ohnejs';
export default defineConfig({
  layers: ['@ohnejs/cms'],
  collections: { locales: ['en', 'de'], defaultLocale: 'en' },
  cms: {
    routes: {
      Pages: '/[...slug]',
      Posts: '/posts/[slug]',
      Guides: '/guides/[slug]',
      Notes: '/notes/[slug]',
    },
  },
});
`,
  'collections/Pages.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields, publishedScope } from '@ohnejs/cms';
export default defineCollection({
  fields: {
    title: field('text', { translatable: true }),
    ...pageFields({ translatable: true }),
  },
  api: { read: { public: true, access: async () => ({ ...(await publishedScope()), locale: 'de' }) } },
});
`,
  'collections/Posts.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields } from '@ohnejs/cms';
export default defineCollection({
  fields: {
    ...pageFields(),
    body: field('richText', { links: ['Guides', 'Notes'], allowEmpty: true, default: [] }),
    content: field('blocks', { allow: ['Team'] }),
  },
  api: { read: 'public' },
});
`,
  'collections/Authors.ts': `import { defineCollection, field } from 'ohnejs';
export default defineCollection({
  fields: { name: field('text'), email: field('text') },
  api: { read: { public: true, access: () => ({ select: ['UUID', 'name'], limit: 1 }) } },
});
`,
  'collections/Guides.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields } from '@ohnejs/cms';
export default defineCollection({
  fields: { title: field('text'), ...pageFields() },
  api: { read: { public: true, access: () => ({ select: ['UUID', 'title'] }) } },
});
`,
  'collections/Notes.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields } from '@ohnejs/cms';
export default defineCollection({
  fields: { title: field('text'), ...pageFields() },
  api: { read: { public: true, access: () => ({ select: ['UUID', 'title', 'slug'] }) } },
});
`,
  'blocks/Team.ts': `import { defineBlock, field } from 'ohnejs';
export default defineBlock({ fields: { authors: field('records', { collection: 'Authors' }) } });
`,
};

describe('scoped reads', () => {
  let app: TestApp;
  let ada: string;
  let grace: string;

  /**
   * The links of a rich text value, in order.
   */
  function linksOf(body: any): any[] {
    return body.flatMap((node: any) => node.content.map((run: any) => run.link));
  }

  before(async () => {
    app = await startApp(APP);
    ada = (await queryUntyped('Authors').createOrThrow({ name: 'Ada', email: 'ada@example.com' }))
      .UUID as string;
    grace = (
      await queryUntyped('Authors').createOrThrow({ name: 'Grace', email: 'grace@example.com' })
    ).UUID as string;
    const guide = await queryUntyped('Guides').createOrThrow({ title: 'Setup', slug: 'setup' });
    const note = await queryUntyped('Notes').createOrThrow({ title: 'Hello', slug: 'hello' });
    await queryUntyped('Posts').createOrThrow({
      slug: 'team',
      body: [
        {
          kind: 'paragraph',
          content: [
            { text: 'guide', link: { collection: 'Guides', record: guide.UUID } },
            { text: 'note', link: { collection: 'Notes', record: note.UUID } },
          ],
        },
      ],
      content: [{ block: 'Team', fields: { authors: [ada, grace] } }],
    });
    const about = await queryUntyped('Pages').createOrThrow({
      status: 'published',
      title: 'About',
      slug: 'about',
    });
    await queryUntyped('Pages')
      .locale('de')
      .where({ UUID: about.UUID })
      .updateOrThrow({ status: 'published', title: 'Über uns', slug: 'ueber' });
  });

  after(() => app.stop());

  it("reads the route's locale over a scope's locale", async () => {
    const { status, body } = await app.get('/cms/routes/resolve?path=/about');
    strictEqual(status, 200);
    strictEqual(body.record.title, 'About');
  });

  it('loads every linked record past a scope limit', async () => {
    const { body } = await app.get('/cms/routes/resolve?path=/posts/team');
    deepStrictEqual(
      body.record.content[0].fields.authors.map((author: any) => author.UUID),
      [ada, grace],
    );
  });

  it('sets no href when the scope withholds the slug', async () => {
    const { body } = await app.get('/cms/routes/resolve?path=/posts/team');
    deepStrictEqual(
      linksOf(body.record.body).map((link) => link.href),
      [undefined, '/notes/hello'],
    );
  });

  it('carries only the fields the related scope selects', async () => {
    const { body } = await app.get('/cms/routes/resolve?path=/posts/team');
    for (const author of body.record.content[0].fields.authors) {
      strictEqual('email' in author, false);
      strictEqual(typeof author.name, 'string');
    }
  });
});
