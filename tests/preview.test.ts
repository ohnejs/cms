import { deepStrictEqual, strictEqual } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { queryUntyped } from 'ohnejs';

import { startApp, type TestApp } from './_app.ts';

const APP = {
  'ohne.config.ts': `import { defineConfig } from 'ohnejs';
export default defineConfig({
  layers: ['@ohnejs/cms'],
  auth: { loginRateLimit: false },
  collections: { locales: ['en', 'de'], defaultLocale: 'en' },
  cms: { routes: { Posts: '/blog/[slug]', Pages: '/[...slug]' } },
});
`,
  'collections/Pages.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields, publishedScope } from '@ohnejs/cms';
export default defineCollection({
  fields: {
    title: field('text'),
    ...pageFields(),
    note: field('text', { nullable: true, readable: false }),
    link: field('link', { collections: ['Pages'], nullable: true }),
    photo: field('image'),
    content: field('blocks', { allow: ['Hero'] }),
  },
  api: { read: { public: true, access: publishedScope }, create: true, update: true },
});
`,
  'collections/Posts.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields, publishedScope } from '@ohnejs/cms';
export default defineCollection({
  fields: { title: field('text', { translatable: true }), ...pageFields({ translatable: true }) },
  api: { read: { public: true, access: publishedScope }, create: true, update: true },
});
`,
  'blocks/Hero.ts': `import { defineBlock, field } from 'ohnejs';
export default defineBlock({
  fields: {
    heading: field('text'),
    secret: field('text', { nullable: true, readable: false }),
    columns: field('repeater', { fields: { body: field('blocks', { allow: ['Quote'] }) } }),
  },
});
`,
  'blocks/Quote.ts': `import { defineBlock, field } from 'ohnejs';
export default defineBlock({ fields: { text: field('text') } });
`,
};

const PASSWORD = 'Correct-Horse-42';

describe('preview drafts', () => {
  let app: TestApp;
  let base: string;
  let about: string;
  let hidden: string;

  /**
   * Signs `email` in and answers its session cookie.
   */
  async function signIn(email: string): Promise<string> {
    const response = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    return response.headers
      .getSetCookie()
      .map((line) => line.split(';')[0])
      .join('; ');
  }

  /**
   * Mints a preview token with `cookie`, answering the status and the token.
   */
  async function mint(cookie: string): Promise<{ status: number; token: string }> {
    const response = await fetch(`${base}/cms/preview/tokens`, {
      method: 'POST',
      headers: { cookie, origin: base },
    });
    const body = (await response.json()) as { token?: string };
    return { status: response.status, token: body.token ?? '' };
  }

  /**
   * Stores a draft under `token` with `cookie`, answering the response.
   */
  function put(cookie: string, token: string, draft: Record<string, unknown>): Promise<Response> {
    return fetch(`${base}/cms/preview/tokens/${token}`, {
      method: 'PUT',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ locale: 'en', collection: 'Pages', ...draft }),
    });
  }

  /**
   * Resolves `path`, with `token` as the preview header when given.
   */
  async function resolve(path: string, token?: string): Promise<{ headers: Headers; body: any }> {
    const response = await fetch(`${base}/cms/routes/resolve?path=${encodeURIComponent(path)}`, {
      headers: token === undefined ? {} : { 'ohne-preview': token },
    });
    return { headers: response.headers, body: await response.json() };
  }

  before(async () => {
    app = await startApp(APP);
    base = `http://127.0.0.1:${app.port}`;
    for (const email of ['ada@example.com', 'bob@example.com']) {
      await queryUntyped('Users').createOrThrow({ email, password: PASSWORD, roles: ['admin'] });
    }
    about = (
      await queryUntyped('Pages').createOrThrow({
        status: 'published',
        title: 'About',
        slug: 'about',
        content: [{ block: 'Hero', fields: { heading: 'Hi' } }],
      })
    ).UUID as string;
    hidden = (await queryUntyped('Pages').createOrThrow({ title: 'Hidden', slug: 'hidden' }))
      .UUID as string;
  });

  after(() => app.stop());

  it('shows an editor their unsaved title, and everyone else the saved one', async () => {
    const cookie = await signIn('ada@example.com');
    const { token } = await mint(cookie);
    const response = await put(cookie, token, {
      record: about,
      path: '/about',
      values: { title: 'About (draft)', slug: 'about' },
    });
    strictEqual(((await response.json()) as any).record.title, 'About (draft)');
    strictEqual((await resolve('/about', token)).body.record.title, 'About (draft)');
    strictEqual((await resolve('/about')).body.record.title, 'About');
  });

  it('previews an unpublished page and a never saved one for their editor alone', async () => {
    const cookie = await signIn('ada@example.com');
    const { token } = await mint(cookie);
    await put(cookie, token, { record: hidden, values: { title: 'Hidden', slug: 'hidden' } });
    await put(cookie, token, { record: 'new-draft', values: { title: 'Fresh', slug: 'fresh' } });
    strictEqual((await resolve('/hidden', token)).body.record.title, 'Hidden');
    strictEqual((await resolve('/fresh', token)).body.record.title, 'Fresh');
    strictEqual((await resolve('/fresh', token)).body.UUID, 'new-draft');
    deepStrictEqual((await resolve('/hidden')).body, { kind: 'notFound' });
    deepStrictEqual((await resolve('/fresh')).body, { kind: 'notFound' });
  });

  it('drops every field the public could not read, inside blocks too', async () => {
    const cookie = await signIn('ada@example.com');
    const { token } = await mint(cookie);
    await put(cookie, token, {
      record: about,
      values: {
        slug: 'about',
        note: 'private',
        content: [{ block: 'Hero', UUID: 'b1', fields: { heading: 'Draft', secret: 'x' } }],
      },
    });
    const { body } = await resolve('/about', token);
    strictEqual('note' in body.record, false);
    deepStrictEqual(body.record.content, [
      { block: 'Hero', UUID: 'b1', fields: { heading: 'Draft' } },
    ]);
  });

  it('keys every new block item and composite row of a draft with a UUID', async () => {
    const cookie = await signIn('ada@example.com');
    const { token } = await mint(cookie);
    await put(cookie, token, {
      record: about,
      values: {
        slug: 'about',
        content: [
          {
            block: 'Hero',
            fields: { columns: [{ body: [{ block: 'Quote', fields: { text: 'Hi' } }] }] },
          },
        ],
      },
    });
    const [hero] = (await resolve('/about', token)).body.record.content;
    strictEqual(typeof hero.UUID, 'string');
    strictEqual(typeof hero.fields.columns[0].UUID, 'string');
    strictEqual(typeof hero.fields.columns[0].body[0].UUID, 'string');
  });

  it('keeps the stored UUID of a saved composite row', async () => {
    const saved = await queryUntyped('Pages').createOrThrow({
      status: 'published',
      title: 'Columns',
      slug: 'columns',
      content: [{ block: 'Hero', fields: { heading: 'Hi', columns: [{ body: [] }] } }],
    });
    const stored: any = await queryUntyped('Pages').where({ UUID: saved.UUID }).findFirst();
    const row = stored.content[0].fields.columns[0];
    const cookie = await signIn('ada@example.com');
    const { token } = await mint(cookie);
    await put(cookie, token, {
      record: saved.UUID,
      values: { slug: 'columns', content: [{ block: 'Hero', fields: { columns: [row] } }] },
    });
    const [hero] = (await resolve('/columns', token)).body.record.content;
    strictEqual(hero.fields.columns[0].UUID, row.UUID);
  });

  it('reads a never saved record as its system fields', async () => {
    const cookie = await signIn('ada@example.com');
    const { token } = await mint(cookie);
    await put(cookie, token, { record: 'new-page', values: { title: 'New', slug: 'new' } });
    await put(cookie, token, {
      collection: 'Posts',
      record: 'new-post',
      values: { title: 'New', slug: 'new-post' },
    });
    const page = (await resolve('/new', token)).body.record;
    strictEqual(typeof page._updatedAt, 'number');
    strictEqual('_translations' in page, false);
    const post = (await resolve('/blog/new-post', token)).body.record;
    strictEqual(typeof post._updatedAt, 'number');
    deepStrictEqual(post._translations, []);
  });

  it('answers a draft as the website reads it, not as its editor', async () => {
    const photo = await queryUntyped('Uploads').createOrThrow({
      kind: 'file',
      directory: '',
      name: 'photo.png',
      type: 'image/png',
      size: 1,
      hash: 'deadbeef',
    });
    const cookie = await signIn('ada@example.com');
    const { token } = await mint(cookie);
    const response = await put(cookie, token, {
      record: about,
      path: '/about',
      values: { slug: 'about', link: { collection: 'Pages', record: hidden }, photo: photo.UUID },
    });
    const { record } = (await response.json()) as any;
    deepStrictEqual(record.link, { collection: 'Pages', record: hidden });
    strictEqual(record.photo.url, `${base}/uploads/photo.png`);
    deepStrictEqual(record, (await resolve('/about', token)).body.record);
  });

  it("refuses a draft under another session's token", async () => {
    const { token } = await mint(await signIn('ada@example.com'));
    const bob = await signIn('bob@example.com');
    const response = await put(bob, token, { record: about, values: { title: 'Bob' } });
    strictEqual(response.status, 403);
  });

  it('refuses a draft nested more than 64 levels deep', async () => {
    const cookie = await signIn('ada@example.com');
    const { token } = await mint(cookie);
    const nested = (depth: number): unknown => (depth === 0 ? 'deep' : [nested(depth - 1)]);
    const draft = (depth: number) =>
      put(cookie, token, { record: about, values: { title: nested(depth) } });
    strictEqual((await draft(60)).status, 200);
    strictEqual((await draft(64)).status, 400);
  });

  it('refuses to mint a token without a session', async () => {
    strictEqual((await mint('')).status, 401);
  });

  it('ignores the drafts of an expired token or an ended session', async () => {
    const cookie = await signIn('ada@example.com');
    const { token } = await mint(cookie);
    await put(cookie, token, { record: about, values: { title: 'Gone', slug: 'about' } });
    strictEqual((await resolve('/about', token)).body.record.title, 'Gone');
    await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie, origin: base } });
    strictEqual((await resolve('/about', token)).body.record.title, 'About');

    const again = await signIn('ada@example.com');
    const fresh = await mint(again);
    await put(again, fresh.token, { record: about, values: { title: 'Stale', slug: 'about' } });
    await queryUntyped('CMSPreviewTokens')
      .where({ expiresAt: { greaterThan: 0 } })
      .updateOrThrow({ expiresAt: Date.now() - 1 });
    strictEqual((await resolve('/about', fresh.token)).body.record.title, 'About');

    await mint(await signIn('ada@example.com'));
    const left = await queryUntyped('CMSDrafts').findMany();
    strictEqual(
      left.some((row) => JSON.parse(row.values as string).title === 'Stale'),
      false,
    );
  });

  it('answers a preview read privately, never cached or indexed', async () => {
    const cookie = await signIn('ada@example.com');
    const { token } = await mint(cookie);
    const { headers } = await resolve('/about', token);
    strictEqual(headers.get('cache-control'), 'private, no-store');
    strictEqual(headers.get('x-robots-tag'), 'noindex');
    strictEqual((await resolve('/about', 'made-up')).headers.get('cache-control'), null);
  });
});
