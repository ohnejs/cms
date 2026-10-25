import { deepStrictEqual, match, strictEqual } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { hook, queryUntyped } from 'ohnejs';

import { startApp, type TestApp } from './_app.ts';

const TARGETS = "['Pages', 'Posts', 'Contact', 'Guides', 'Members']";

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
      Contact: '/contact',
      Guides: { en: '/guides/[slug]' },
      Members: '/members/[slug]',
    },
  },
});
`,
  'collections/Pages.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields, publishedScope } from '@ohnejs/cms';
export default defineCollection({
  fields: {
    title: field('text'),
    ...pageFields(),
    body: field('richText', { links: ${TARGETS}, allowEmpty: true, default: [] }),
    cta: field('link', { collections: ${TARGETS}, nullable: true }),
    content: field('blocks', { allow: ['Text'] }),
    details: field('object', {
      nullable: true,
      fields: { body: field('richText', { links: ${TARGETS}, allowEmpty: true, default: [] }) },
    }),
    items: field('repeater', {
      fields: { link: field('link', { collections: ${TARGETS}, nullable: true }) },
    }),
  },
  api: { read: { public: true, access: publishedScope }, create: true, update: true },
});
`,
  'collections/Posts.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields, publishedScope } from '@ohnejs/cms';
export default defineCollection({
  fields: { title: field('text', { translatable: true }), ...pageFields({ translatable: true }) },
  api: { read: { public: true, access: publishedScope } },
});
`,
  'collections/Guides.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields, publishedScope } from '@ohnejs/cms';
export default defineCollection({
  fields: { title: field('text'), ...pageFields() },
  api: { read: { public: true, access: publishedScope } },
});
`,
  'collections/Members.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields } from '@ohnejs/cms';
export default defineCollection({ fields: { name: field('text'), ...pageFields() } });
`,
  'collections/Contact.ts': `import { defineCollection, field } from 'ohnejs';
export default defineCollection({
  singleton: true,
  fields: { heading: field('text', { default: 'Write us' }) },
  api: { read: 'public' },
});
`,
  'blocks/Text.ts': `import { defineBlock, field } from 'ohnejs';
export default defineBlock({
  fields: { body: field('richText', { links: ${TARGETS}, allowEmpty: true, default: [] }) },
});
`,
};

const PASSWORD = 'Correct-Horse-42';

type Link = { collection: string; record: string; hash?: string; newTab?: boolean; href?: string };

/**
 * A paragraph with one linked run per link, each with its own text so no two runs merge.
 */
function paragraph(...links: object[]): object[] {
  return [{ kind: 'paragraph', content: links.map((link, i) => ({ text: `l${i}`, link })) }];
}

/**
 * The links of a value `paragraph` built, in order.
 */
function linksOf(body: any): Link[] {
  return body[0].content.map((run: any) => run.link);
}

describe('record links', () => {
  let app: TestApp;
  let base: string;
  let cookie: string;
  let post: string;
  let home: string;
  let contact: string;
  let pages = 0;

  /**
   * Publishes a page holding `fields` and answers its path.
   */
  async function page(fields: Record<string, unknown>): Promise<string> {
    const slug = `page-${++pages}`;
    await create('Pages', { title: slug, slug, ...fields });
    return `/${slug}`;
  }

  /**
   * Resolves `path` and answers its record, read with `session` as the cookie when given.
   */
  async function read(path: string, session?: string): Promise<any> {
    const response = await fetch(`${base}/cms/routes/resolve?path=${encodeURIComponent(path)}`, {
      headers: session === undefined ? {} : { cookie: session },
    });
    return ((await response.json()) as any).record;
  }

  /**
   * Creates a published record of `collection` from `values` and answers its `UUID`.
   */
  async function create(collection: string, values: Record<string, unknown>): Promise<string> {
    return (await queryUntyped(collection).createOrThrow({ status: 'published', ...values }))
      .UUID as string;
  }

  before(async () => {
    app = await startApp(APP);
    base = `http://127.0.0.1:${app.port}`;
    await queryUntyped('Users').createOrThrow({
      email: 'ada@example.com',
      password: PASSWORD,
      roles: ['admin'],
    });
    const response = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ada@example.com', password: PASSWORD }),
    });
    cookie = response.headers
      .getSetCookie()
      .map((line) => line.split(';')[0])
      .join('; ');
    post = await create('Posts', { title: 'Hello', slug: 'hello' });
    await queryUntyped('Posts')
      .locale('de')
      .where({ UUID: post })
      .updateOrThrow({ title: 'Hallo', slug: 'hallo' });
    home = await create('Pages', { title: 'Home', slug: 'index' });
    contact = (await queryUntyped('Contact').findFirst())?.UUID as string;
  });

  after(() => app.stop());

  it('sets href at the top level, in a block, in an object and in a repeater', async () => {
    const link = { collection: 'Posts', record: post };
    const record = await read(
      await page({
        body: paragraph(link),
        cta: link,
        content: [{ block: 'Text', fields: { body: paragraph(link) } }],
        details: { body: paragraph(link) },
        items: [{ link }, { link: null }],
      }),
    );
    const resolved = { ...link, href: '/blog/hello' };
    deepStrictEqual(linksOf(record.body), [resolved]);
    deepStrictEqual(record.cta, resolved);
    deepStrictEqual(linksOf(record.content[0].fields.body), [resolved]);
    deepStrictEqual(linksOf(record.details.body), [resolved]);
    deepStrictEqual(record.items[0].link, resolved);
    strictEqual(record.items[1].link, null);
  });

  it('appends the hash and keeps newTab', async () => {
    const link = { collection: 'Posts', record: post, hash: 'intro', newTab: true };
    deepStrictEqual((await read(await page({ cta: link }))).cta, {
      ...link,
      href: '/blog/hello#intro',
    });
  });

  it("resolves a static route, the home page and a translated slug in the reader's locale", async () => {
    const path = await page({
      body: paragraph(
        { collection: 'Contact', record: contact },
        { collection: 'Pages', record: home },
        { collection: 'Posts', record: post },
      ),
    });
    deepStrictEqual(
      linksOf((await read(path)).body).map((link) => link.href),
      ['/contact', '/', '/blog/hello'],
    );
    deepStrictEqual(
      linksOf((await read(`/de${path}`)).body).map((link) => link.href),
      ['/de/contact', '/de', '/de/artikel/hallo'],
    );
  });

  it('follows a renamed slug', async () => {
    const guide = await create('Guides', { title: 'Start', slug: 'start' });
    const path = await page({ cta: { collection: 'Guides', record: guide } });
    strictEqual((await read(path)).cta.href, '/guides/start');
    await queryUntyped('Guides').where({ UUID: guide }).updateOrThrow({ slug: 'begin' });
    strictEqual((await read(path)).cta.href, '/guides/begin');
  });

  it('keeps a link to a deleted target, without href', async () => {
    const gone = await create('Guides', { title: 'Gone', slug: 'gone' });
    const path = await page({ cta: { collection: 'Guides', record: gone } });
    await queryUntyped('Guides').where({ UUID: gone }).delete();
    deepStrictEqual((await read(path)).cta, { collection: 'Guides', record: gone });
  });

  it('resolves a link to a draft for a reader with `cms.drafts` alone', async () => {
    const draft = await create('Guides', { status: 'draft', title: 'Soon', slug: 'soon' });
    const path = await page({ cta: { collection: 'Guides', record: draft } });
    strictEqual('href' in (await read(path)).cta, false);
    strictEqual((await read(path, cookie)).cta.href, '/guides/soon');
  });

  it('leaves a link into a collection the reader cannot read without href', async () => {
    const member = await create('Members', { name: 'Ada', slug: 'ada' });
    const record = await read(await page({ cta: { collection: 'Members', record: member } }));
    deepStrictEqual(record.cta, { collection: 'Members', record: member });
  });

  it('leaves a link without href where the locale has no route or no slug', async () => {
    const guide = await create('Guides', { title: 'Local', slug: 'local' });
    const lone = await create('Posts', { title: 'Lone', slug: 'lone' });
    const path = await page({
      body: paragraph(
        { collection: 'Guides', record: guide },
        { collection: 'Posts', record: lone },
      ),
    });
    deepStrictEqual(
      linksOf((await read(path)).body).map((link) => link.href),
      ['/guides/local', '/blog/lone'],
    );
    deepStrictEqual(
      linksOf((await read(`/de${path}`)).body).map((link) => link.href),
      [undefined, undefined],
    );
  });

  it('replaces a forged href in a draft and leaves a URL link alone', async () => {
    const draft = await create('Pages', { title: 'Forged', slug: 'forged' });
    const minted = await fetch(`${base}/cms/preview/tokens`, {
      method: 'POST',
      headers: { cookie, origin: base },
    });
    const { token } = (await minted.json()) as { token: string };
    const gone = await create('Guides', { title: 'Dead', slug: 'dead' });
    await queryUntyped('Guides').where({ UUID: gone }).delete();
    const url = { url: 'https://example.com', href: 'javascript:alert(1)' };
    const response = await fetch(`${base}/cms/preview/tokens/${token}`, {
      method: 'PUT',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({
        locale: 'en',
        collection: 'Pages',
        record: draft,
        path: '/forged',
        values: {
          slug: 'forged',
          body: paragraph(
            { collection: 'Posts', record: post, href: 'https://evil.example' },
            { collection: 'Guides', record: gone, href: '/forged' },
            url,
          ),
        },
      }),
    });
    deepStrictEqual(linksOf(((await response.json()) as any).record.body), [
      { collection: 'Posts', record: post, href: '/blog/hello' },
      { collection: 'Guides', record: gone },
      url,
    ]);
  });

  it('resolves more than 900 links', async () => {
    const targets: string[] = [];
    for (let i = 0; i < 905; i++) {
      targets.push(await create('Guides', { title: `Bulk ${i}`, slug: `bulk-${i}` }));
    }
    const record = await read(
      await page({
        body: paragraph(...targets.map((record) => ({ collection: 'Guides', record }))),
      }),
    );
    deepStrictEqual(
      linksOf(record.body).map((link) => link.href),
      targets.map((_, i) => `/guides/bulk-${i}`),
    );
  });
});

const BATCH_APP = {
  'ohne.config.ts': `import { defineConfig } from 'ohnejs';
export default defineConfig({
  layers: ['@ohnejs/cms'],
  cms: { routes: { Pages: '/[...slug]', Posts: '/blog/[slug]' } },
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
export default defineCollection({
  fields: {
    title: field('text'),
    ...pageFields(),
    image: field('image'),
    author: field('record', { collection: 'Authors' }),
    tags: field('records', { collection: 'Tags' }),
    cta: field('link', { collections: ['Pages', 'Posts'], nullable: true }),
  },
  api: { read: 'public' },
});
`,
  'collections/Authors.ts': `import { defineCollection, field } from 'ohnejs';
export default defineCollection({
  fields: { name: field('text'), avatar: field('image') },
  api: { read: 'public' },
});
`,
  'collections/Tags.ts': `import { defineCollection, field } from 'ohnejs';
export default defineCollection({ fields: { name: field('text') }, api: { read: 'public' } });
`,
};

describe('relations of a list', () => {
  let app: TestApp;
  let statements = 0;

  /**
   * Reads `path` from the API and answers its JSON and the statements the read ran.
   */
  async function counted(path: string): Promise<{ body: any; statements: number }> {
    statements = 0;
    const body = (await app.get(path)).body;
    return { body, statements };
  }

  before(async () => {
    hook('query:filter', () => {
      statements++;
    });
    app = await startApp(BATCH_APP);
    const upload = async (name: string) =>
      (
        await queryUntyped('Uploads').createOrThrow({
          kind: 'file',
          directory: '',
          name,
          type: 'image/png',
          size: 1,
          hash: 'deadbeef',
          private: false,
        })
      ).UUID as string;
    const page = await queryUntyped('Pages').createOrThrow({
      status: 'published',
      title: 'Home',
      slug: 'index',
    });
    for (let i = 0; i < 50; i++) {
      const author = await queryUntyped('Authors').createOrThrow({
        name: `Author ${i}`,
        avatar: await upload(`avatar-${i}.png`),
      });
      const tag = await queryUntyped('Tags').createOrThrow({ name: `Tag ${i}` });
      await queryUntyped('Posts').createOrThrow({
        status: 'published',
        title: `Post ${String(i).padStart(2, '0')}`,
        slug: `post-${i}`,
        image: await upload(`image-${i}.png`),
        author: author.UUID,
        tags: [tag.UUID],
        cta: { collection: 'Pages', record: page.UUID },
      });
    }
  });

  after(() => app.stop());

  it('loads a page of records as it loads each record alone', async () => {
    const { body } = await app.get('/cms/records/Posts?perPage=50&order=[title]');
    strictEqual(body.records.length, 50);
    for (const record of body.records) {
      deepStrictEqual(record, (await app.get(`/cms/records/Posts/${record.UUID}`)).body);
    }
    const first = body.records[0];
    match(first.image.url, /\/uploads\/image-0\.png$/);
    match(first.author.avatar.url, /\/uploads\/avatar-0\.png$/);
    strictEqual(first.tags[0].name, 'Tag 0');
    strictEqual(first.cta.href, '/');
  });

  it('runs as many statements for 50 records as for 10', async () => {
    const ten = await counted('/cms/records/Posts?perPage=10');
    const fifty = await counted('/cms/records/Posts?perPage=50');
    strictEqual(ten.body.records.length, 10);
    strictEqual(fifty.body.records.length, 50);
    strictEqual(fifty.statements, ten.statements);
  });
});
