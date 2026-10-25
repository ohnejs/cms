import { deepStrictEqual, match, ok, strictEqual } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { queryUntyped } from 'ohnejs';

import { startApp, type TestApp } from './_app.ts';

const APP = {
  'ohne.config.ts': `import { defineConfig } from 'ohnejs';
export default defineConfig({
  layers: ['@ohnejs/cms'],
  auth: { loginRateLimit: false },
  collections: { locales: ['en', 'de'], defaultLocale: 'en' },
  cms: {
    routes: {
      Pages: '/[...slug]',
      Posts: { en: '/blog/[slug]', de: '/artikel/[slug]' },
      Guides: '/guides/[slug]',
    },
  },
});
`,
  'collections/Pages.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields, publishedScope } from '@ohnejs/cms';
export default defineCollection({
  fields: { title: field('text'), ...pageFields() },
  api: { read: { public: true, access: publishedScope } },
});
`,
  'collections/Posts.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields, publishedScope } from '@ohnejs/cms';
export default defineCollection({
  fields: {
    title: field('text', { translatable: true }),
    ...pageFields({ translatable: true }),
    category: field('text', { nullable: true }),
    image: field('image'),
    author: field('record', { collection: 'Authors' }),
  },
  api: { read: { public: true, access: publishedScope } },
});
`,
  'collections/Settings.ts': `import { defineCollection, field } from 'ohnejs';
export default defineCollection({
  singleton: true,
  fields: {
    copyright: field('text', { default: '(c) Acme' }),
    menu: field('repeater', {
      fields: {
        label: field('text'),
        link: field('link', { collections: ['Pages', 'Posts'], nullable: true }),
      },
    }),
  },
  api: { read: 'public' },
});
`,
  'collections/Authors.ts': `import { defineCollection, field } from 'ohnejs';
export default defineCollection({
  fields: { name: field('text'), email: field('text', { nullable: true }) },
  api: { read: { public: true, access: () => ({ select: ['UUID', 'name'] }) } },
});
`,
  'collections/Guides.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields } from '@ohnejs/cms';
export default defineCollection({
  fields: { title: field('text'), ...pageFields() },
  api: { read: { public: true, access: () => ({ select: ['UUID', 'title'] }) } },
});
`,
  'collections/Brands.ts': `import { defineCollection, field } from 'ohnejs';
export default defineCollection({
  fields: { name: field('text') },
  api: { read: { public: true, access: () => ({ select: ['name'] }) } },
});
`,
  'collections/Members.ts': `import { defineCollection, field } from 'ohnejs';
export default defineCollection({ fields: { name: field('text') } });
`,
  'collections/Staff.ts': `import { defineCollection, field } from 'ohnejs';
export default defineCollection({ fields: { name: field('text') }, api: { read: true } });
`,
  'collections/Closed.ts': `import { defineCollection, field } from 'ohnejs';
export default defineCollection({
  fields: { name: field('text') },
  api: { read: { public: true, access: () => false } },
});
`,
  'collections/Locked.ts': `import { defineCollection, field } from 'ohnejs';
export default defineCollection({
  fields: { name: field('text') },
  api: { read: { public: true, middleware: ['require-auth'] } },
});
`,
  'collections/Marked.ts': `import { defineCollection, field } from 'ohnejs';
export default defineCollection({
  fields: { name: field('text') },
  api: { read: { public: true, middleware: ['mark'] } },
});
`,
  'middleware/mark.ts': `import { defineMiddleware, useResponse } from 'ohnejs';
export default defineMiddleware(() => {
  useResponse().headers.set('x-mark', 'ran');
});
`,
};

const PASSWORD = 'Correct-Horse-42';
const HOUR = 3_600_000;

describe('records', () => {
  let app: TestApp;
  let base: string;
  let photo: string;
  let ada: string;
  let about: string;
  let draft: string;
  const posts: string[] = [];

  /**
   * Fetches `path` from the API, with `cookie` when given, and answers its status, headers and JSON.
   */
  async function get(
    path: string,
    cookie?: string,
  ): Promise<{ status: number; headers: Headers; body: any }> {
    const response = await fetch(`${base}${path}`, {
      headers: cookie === undefined ? {} : { cookie },
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }

  before(async () => {
    app = await startApp(APP);
    base = `http://127.0.0.1:${app.port}`;
    photo = (
      await queryUntyped('Uploads').createOrThrow({
        kind: 'file',
        directory: '',
        name: 'photo.png',
        type: 'image/png',
        size: 1,
        hash: 'deadbeef',
        private: false,
      })
    ).UUID as string;
    ada = (await queryUntyped('Authors').createOrThrow({ name: 'Ada', email: 'ada@example.com' }))
      .UUID as string;
    about = (
      await queryUntyped('Pages').createOrThrow({
        status: 'published',
        title: 'About',
        slug: 'about',
      })
    ).UUID as string;
    for (let i = 1; i <= 5; i++) {
      const post = await queryUntyped('Posts').createOrThrow({
        status: 'published',
        title: `Post ${i}`,
        slug: `post-${i}`,
        publishedAt: Date.now() - (10 - i) * HOUR,
        category: i % 2 === 0 ? 'design' : 'code',
        image: photo,
        author: ada,
      });
      posts.push(post.UUID as string);
    }
    await queryUntyped('Posts')
      .locale('de')
      .where({ UUID: posts[0] })
      .updateOrThrow({ title: 'Beitrag 1', slug: 'beitrag-1' });
    draft = (await queryUntyped('Posts').createOrThrow({ title: 'Draft', slug: 'draft' }))
      .UUID as string;
    await queryUntyped('Posts').createOrThrow({
      status: 'published',
      title: 'Soon',
      slug: 'soon',
      publishedAt: Date.now() + HOUR,
    });
    await queryUntyped('Posts').createOrThrow({
      status: 'published',
      title: 'Gone',
      slug: 'gone',
      expiresAt: Date.now() - HOUR,
    });
    await queryUntyped('Settings').updateOrThrow({
      menu: [
        { label: 'About', link: { collection: 'Pages', record: about } },
        { label: 'First', link: { collection: 'Posts', record: posts[0] } },
      ],
    });
    for (const name of ['Members', 'Staff', 'Closed', 'Locked', 'Marked']) {
      await queryUntyped(name).createOrThrow({ name: 'x' });
    }
  });

  after(() => app.stop());

  it('answers a page of published records with its pager', async () => {
    const { status, body } = await get('/cms/records/Posts');
    strictEqual(status, 200);
    deepStrictEqual(Object.keys(body).sort(), ['lastPage', 'page', 'perPage', 'records', 'total']);
    strictEqual(body.total, 5);
    strictEqual(body.page, 1);
    strictEqual(body.perPage, 20);
    strictEqual(body.lastPage, 1);
    deepStrictEqual(body.records.map((record: any) => record.title).sort(), [
      'Post 1',
      'Post 2',
      'Post 3',
      'Post 4',
      'Post 5',
    ]);
  });

  it('orders, filters and pages', async () => {
    const { body } = await get('/cms/records/Posts?order=[-publishedAt]&page=2&perPage=2');
    deepStrictEqual(
      body.records.map((record: any) => record.title),
      ['Post 3', 'Post 2'],
    );
    strictEqual(body.lastPage, 3);
    const design = await get('/cms/records/Posts?where={category:design}');
    deepStrictEqual(design.body.records.map((record: any) => record.title).sort(), [
      'Post 2',
      'Post 4',
    ]);
    const past = await get('/cms/records/Posts?page=9');
    deepStrictEqual(past.body.records, []);
    strictEqual(past.body.lastPage, 1);
  });

  it('never widens the access with a where', async () => {
    const { body } = await get('/cms/records/Posts?where={status:draft}');
    deepStrictEqual(body.records, []);
  });

  it('stops perPage at 100', async () => {
    strictEqual((await get('/cms/records/Posts?perPage=101')).body.perPage, 100);
  });

  it('refuses every param a list does not take', async () => {
    for (const param of ['populate=[author]', 'limit=2', 'offset=1', 'foo=1']) {
      const { status, body } = await get(`/cms/records/Posts?${param}`);
      const name = param.split('=')[0];
      strictEqual(status, 400, param);
      strictEqual(body.message, `Param \`${name}\` is not supported here`);
      deepStrictEqual(body.data, { code: 'unknownParam', path: name });
    }
  });

  it('answers the identical 404 for whatever a visitor may not read', async () => {
    const unknown = await get('/cms/records/Nope');
    strictEqual(unknown.status, 404);
    for (const name of ['Members', 'Staff', 'Closed', 'Locked', 'Uploads', 'constructor']) {
      const { status, body } = await get(`/cms/records/${name}`);
      strictEqual(status, 404, name);
      deepStrictEqual(body, unknown.body, name);
    }
  });

  it("runs the collection's read middleware", async () => {
    const { status, headers } = await get('/cms/records/Marked');
    strictEqual(status, 200);
    strictEqual(headers.get('x-mark'), 'ran');
  });

  it('opens a read guarded by middleware to the reader it admits', async () => {
    await queryUntyped('Users').createOrThrow({
      email: 'ada@example.com',
      password: PASSWORD,
      roles: ['admin'],
    });
    const login = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ada@example.com', password: PASSWORD }),
    });
    const cookie = login.headers
      .getSetCookie()
      .map((line) => line.split(';')[0])
      .join('; ');
    strictEqual((await get('/cms/records/Locked', cookie)).body.total, 1);
  });

  it('answers a singleton as its record, with loaded links', async () => {
    const { status, body } = await get('/cms/records/Settings');
    strictEqual(status, 200);
    strictEqual(body.copyright, '(c) Acme');
    strictEqual(typeof body.UUID, 'string');
    deepStrictEqual(
      body.menu.map((item: any) => item.link.href),
      ['/about', '/blog/post-1'],
    );
    const de = await get('/cms/records/Settings?locale=de');
    deepStrictEqual(
      de.body.menu.map((item: any) => item.link.href),
      ['/de/about', '/de/artikel/beitrag-1'],
    );
  });

  it('refuses a list param on a singleton', async () => {
    for (const param of ['page=1', 'perPage=5', 'where={copyright:x}', 'order=[copyright]']) {
      strictEqual((await get(`/cms/records/Settings?${param}`)).status, 400, param);
    }
  });

  it('reads one record by UUID, and 404 outside the scope', async () => {
    const { status, body } = await get(`/cms/records/Posts/${posts[1]}`);
    strictEqual(status, 200);
    strictEqual(body.title, 'Post 2');
    strictEqual(body.path, '/blog/post-2');
    strictEqual((await get(`/cms/records/Posts/${draft}`)).status, 404);
    strictEqual((await get('/cms/records/Posts/not-a-uuid')).status, 404);
    strictEqual((await get(`/cms/records/Members/${posts[1]}`)).status, 404);
    strictEqual((await get(`/cms/records/Posts/${posts[1]}?page=1`)).status, 400);
  });

  it('loads uploads absolute and relations one level deep', async () => {
    const { body } = await get(`/cms/records/Posts/${posts[0]}`);
    strictEqual(body.image.UUID, photo);
    match(body.image.url, new RegExp(`^${base}/uploads/photo\\.png$`));
    deepStrictEqual(body.author, { UUID: ada, name: 'Ada' });
  });

  it('carries UUID and path whatever select names, and leaves slug out', async () => {
    const { body } = await get('/cms/records/Posts?select=[title]&order=[title]&perPage=1');
    deepStrictEqual(body.records, [{ UUID: posts[0], title: 'Post 1', path: '/blog/post-1' }]);
    const slugged = await get(`/cms/records/Posts/${posts[0]}?select=[slug]`);
    deepStrictEqual(slugged.body, { UUID: posts[0], slug: 'post-1', path: '/blog/post-1' });
  });

  it('never widens past an access that withholds slug, so no path arrives', async () => {
    const guide = (await queryUntyped('Guides').createOrThrow({ title: 'Guide', slug: 'guide' }))
      .UUID as string;
    for (const query of ['', '?select=[title]']) {
      const { body } = await get(`/cms/records/Guides${query}`);
      deepStrictEqual(body.records, [{ UUID: guide, title: 'Guide' }], query);
    }
  });

  it('carries UUID where the access select leaves it out', async () => {
    const brand = (await queryUntyped('Brands').createOrThrow({ name: 'Acme' })).UUID as string;
    for (const query of ['', '?select=[name]']) {
      const { body } = await get(`/cms/records/Brands${query}`);
      deepStrictEqual(body.records, [{ UUID: brand, name: 'Acme' }], query);
    }
    deepStrictEqual((await get(`/cms/records/Brands/${brand}`)).body, {
      UUID: brand,
      name: 'Acme',
    });
  });

  it('reads in the asked locale, paths included', async () => {
    const post = await get(`/cms/records/Posts/${posts[0]}?locale=de`);
    strictEqual(post.body.title, 'Beitrag 1');
    strictEqual(post.body.path, '/de/artikel/beitrag-1');
    const page = await get(`/cms/records/Pages/${about}?locale=de`);
    strictEqual(page.body.path, '/de/about');
    strictEqual((await get('/cms/records/Pages?locale=fr')).status, 400);
  });

  it('refuses a field the access hides', async () => {
    for (const query of ['where={email:ada@example.com}', 'select=[email]', 'order=[email]']) {
      strictEqual((await get(`/cms/records/Authors?${query}`)).status, 400, query);
    }
    const { body } = await get('/cms/records/Authors');
    ok(!('email' in body.records[0]));
  });
});
