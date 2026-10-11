import { deepStrictEqual, match, strictEqual } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { queryUntyped } from 'ohnejs';

import { startApp, type TestApp } from './_app.ts';

const APP = {
  'ohne.config.ts': `import { defineConfig } from 'ohnejs';
export default defineConfig({
  layers: ['@ohnejs/cms'],
  collections: { locales: ['en', 'de'], defaultLocale: 'en' },
  uploads: { images: { url: 'https://images.example.com' } },
  cms: {
    routes: {
      Pages: '/[...slug]',
      Posts: { en: '/blog/[slug]', de: '/artikel/[slug]' },
      Contact: '/contact',
    },
  },
});
`,
  'collections/Pages.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields, publishedScope } from '@ohnejs/cms';
export default defineCollection({
  fields: { title: field('text'), ...pageFields(), content: field('blocks', { allow: ['Hero'] }) },
  api: { read: { public: true, access: publishedScope } },
});
`,
  'collections/Posts.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields, publishedScope } from '@ohnejs/cms';
export default defineCollection({
  fields: { title: field('text', { translatable: true }), ...pageFields({ translatable: true }) },
  api: { read: { public: true, access: publishedScope } },
});
`,
  'collections/Contact.ts': `import { defineCollection, field } from 'ohnejs';
export default defineCollection({
  singleton: true,
  fields: { heading: field('text', { default: 'Write us' }) },
  api: { read: 'public' },
});
`,
  'collections/Authors.ts': `import { defineCollection, field } from 'ohnejs';
export default defineCollection({ fields: { name: field('text') }, api: { read: 'public' } });
`,
  'collections/Secrets.ts': `import { defineCollection, field } from 'ohnejs';
export default defineCollection({ fields: { code: field('text') } });
`,
  'blocks/Hero.ts': `import { defineBlock, field } from 'ohnejs';
export default defineBlock({
  fields: {
    heading: field('text'),
    photo: field('image'),
    hidden: field('image'),
    author: field('record', { collection: 'Authors' }),
    secret: field('record', { collection: 'Secrets' }),
    attachment: field('record', { collection: 'Uploads' }),
  },
});
`,
};

const published = { status: 'published' };

describe('resolve', () => {
  let app: TestApp;
  let photo: string;
  let plain: string;

  before(async () => {
    app = await startApp(APP);
    const upload = (name: string, isPrivate: boolean, description?: string) =>
      queryUntyped('Uploads').createOrThrow({
        kind: 'file',
        directory: '',
        name,
        type: 'image/png',
        size: 1,
        hash: 'deadbeef',
        private: isPrivate,
        description,
      });
    photo = (await upload('photo.png', false, 'A photo')).UUID as string;
    await queryUntyped('Uploads')
      .locale('de')
      .where({ UUID: photo })
      .updateOrThrow({ description: 'Ein Foto' });
    plain = (await upload('plain.png', false, 'Plain')).UUID as string;
    const hidden = (await upload('hidden.png', true)).UUID as string;
    const folder = await queryUntyped('Uploads').createOrThrow({
      kind: 'folder',
      directory: '',
      name: 'albums',
      private: false,
    });
    const author = await queryUntyped('Authors').createOrThrow({ name: 'Ada' });
    const secret = await queryUntyped('Secrets').createOrThrow({ code: '42' });
    await queryUntyped('Pages').createOrThrow({
      ...published,
      title: 'About',
      slug: 'about',
      content: [
        {
          block: 'Hero',
          fields: {
            heading: 'Hi',
            photo,
            hidden,
            author: author.UUID,
            secret: secret.UUID,
            attachment: folder.UUID,
          },
        },
      ],
    });
    await queryUntyped('Pages').createOrThrow({
      ...published,
      title: 'Plain',
      slug: 'plain',
      content: [{ block: 'Hero', fields: { heading: 'Plain', photo: plain, hidden } }],
    });
    await queryUntyped('Pages').createOrThrow({
      ...published,
      title: 'Install',
      slug: 'docs/install',
    });
    await queryUntyped('Pages').createOrThrow({ title: 'Draft', slug: 'draft' });
    await queryUntyped('Pages').createOrThrow({
      ...published,
      title: 'Later',
      slug: 'later',
      publishedAt: Date.now() + 60_000,
    });
    await queryUntyped('Pages').createOrThrow({
      ...published,
      title: 'Gone',
      slug: 'gone',
      expiresAt: Date.now() - 60_000,
    });
    const post = await queryUntyped('Posts').createOrThrow({
      ...published,
      title: 'Hello',
      slug: 'hello',
    });
    await queryUntyped('Posts')
      .locale('de')
      .where({ UUID: post.UUID })
      .updateOrThrow({ title: 'Hallo', slug: 'hallo' });
  });

  after(() => app.stop());

  it('resolves a page by its slug', async () => {
    const { body } = await app.get('/cms/routes/resolve?path=/about');
    strictEqual(body.kind, 'page');
    strictEqual(body.collection, 'Pages');
    strictEqual(body.locale, 'en');
    strictEqual(body.path, '/about');
    strictEqual(body.record.title, 'About');
  });

  it('resolves a nested slug under a catch-all route', async () => {
    const { body } = await app.get('/cms/routes/resolve?path=/docs/install');
    strictEqual(body.record?.title, 'Install');
    strictEqual(body.path, '/docs/install');
  });

  it('hides drafts and records outside their publish window', async () => {
    for (const path of ['/draft', '/later', '/gone', '/nope']) {
      deepStrictEqual((await app.get(`/cms/routes/resolve?path=${path}`)).body, {
        kind: 'notFound',
      });
    }
  });

  it('picks the locale from the path prefix and its pattern', async () => {
    const en = (await app.get('/cms/routes/resolve?path=/blog/hello')).body;
    strictEqual(en.record.title, 'Hello');
    const de = (await app.get('/cms/routes/resolve?path=/de/artikel/hallo')).body;
    strictEqual(de.locale, 'de');
    strictEqual(de.record.title, 'Hallo');
    strictEqual(de.path, '/de/artikel/hallo');
  });

  it('refuses a path in the wrong locale or with the default locale prefixed', async () => {
    for (const path of ['/de/blog/hello', '/artikel/hallo', '/en/blog/hello']) {
      strictEqual((await app.get(`/cms/routes/resolve?path=${path}`)).body.kind, 'notFound', path);
    }
  });

  it('resolves a singleton by its static path', async () => {
    const { body } = await app.get('/cms/routes/resolve?path=/contact?ref=mail');
    strictEqual(body.collection, 'Contact');
    strictEqual(body.record.heading, 'Write us');
  });

  it('loads the relations inside blocks as the reader may read them', async () => {
    const { body } = await app.get('/cms/routes/resolve?path=/about');
    const hero = body.record.content[0];
    strictEqual(hero.block, 'Hero');
    strictEqual(hero.fields.photo.UUID, photo);
    match(
      hero.fields.photo.url,
      new RegExp(`^http://127\\.0\\.0\\.1:${app.port}/uploads/photo\\.png$`),
    );
    strictEqual(hero.fields.hidden, null);
    strictEqual(hero.fields.author.name, 'Ada');
    strictEqual(hero.fields.secret, null);
  });

  it('loads only the fields a site renders an upload with', async () => {
    const { photo: loaded } = (await app.get('/cms/routes/resolve?path=/about')).body.record
      .content[0].fields;
    deepStrictEqual(Object.keys(loaded).sort(), [
      'UUID',
      'description',
      'focalX',
      'focalY',
      'height',
      'name',
      'size',
      'type',
      'url',
      'variants',
      'width',
    ]);
    deepStrictEqual(Object.keys(loaded.variants), ['thumbnail']);
    match(loaded.variants.thumbnail, /^https:\/\/images\.example\.com\//);
  });

  it("loads an upload's description in the page's locale", async () => {
    const hero = async (path: string) =>
      (await app.get(`/cms/routes/resolve?path=${path}`)).body.record.content[0].fields;
    strictEqual((await hero('/about')).photo.description, 'A photo');
    strictEqual((await hero('/de/about')).photo.description, 'Ein Foto');
    const untranslated = (await hero('/de/plain')).photo;
    strictEqual(untranslated.UUID, plain);
    strictEqual(untranslated.description, null);
    match(untranslated.url, /\/uploads\/plain\.png$/);
  });

  it('never loads a folder', async () => {
    const { body } = await app.get('/cms/routes/resolve?path=/about');
    strictEqual(body.record.content[0].fields.attachment, null);
  });

  it('answers 400 for a path that is not a site path', async () => {
    strictEqual((await app.get('/cms/routes/resolve?path=about')).status, 400);
    strictEqual((await app.get('/cms/routes/resolve')).status, 400);
  });
});
