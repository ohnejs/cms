import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { after, before, beforeEach, describe, it } from 'node:test';
import { queryUntyped } from 'ohnejs';

import { startApp, type TestApp } from './_app.ts';

const PASSWORD = 'Correct-Horse-42';

describe('redirects', () => {
  let app: TestApp;

  before(async () => {
    app = await startApp({
      'ohne.config.ts': `import { defineConfig } from 'ohnejs';
export default defineConfig({
  layers: ['@ohnejs/cms'],
  auth: { loginRateLimit: false },
  collections: { locales: ['en', 'de'], defaultLocale: 'en' },
  cms: {
    routes: {
      Pages: '/[...slug]',
      Posts: { en: '/blog/[slug]', de: '/artikel/[slug]' },
      Members: '/members/[slug]',
    },
  },
});
`,
      'collections/Pages.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields, publishedScope } from '@ohnejs/cms';
export default defineCollection({
  fields: { title: field('text', { translatable: true }), ...pageFields(), photo: field('image') },
  api: { read: { public: true, access: publishedScope } },
});
`,
      'collections/Members.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields, publishedScope } from '@ohnejs/cms';
export default defineCollection({
  fields: { title: field('text'), ...pageFields() },
  api: { read: { public: true, middleware: ['require-auth'], access: publishedScope } },
});
`,
      'collections/Posts.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields, publishedScope } from '@ohnejs/cms';
export default defineCollection({
  fields: { title: field('text'), ...pageFields({ translatable: true }) },
  api: { read: { public: true, access: publishedScope } },
});
`,
    });
  });

  after(() => app.stop());

  beforeEach(async () => {
    await queryUntyped('Redirects')
      .where({ from: { startsWith: '/' } })
      .delete();
    await queryUntyped('Pages')
      .where({ UUID: { not: { equalsTo: '' } } })
      .delete();
    await queryUntyped('Posts')
      .where({ UUID: { not: { equalsTo: '' } } })
      .delete();
    await queryUntyped('Site').updateOrThrow({ autoRedirect: true });
  });

  const resolve = async (path: string) =>
    (await app.get(`/cms/routes/resolve?path=${encodeURIComponent(path)}`)).body;

  const redirects = async () =>
    (await queryUntyped('Redirects').orderBy('from').findMany()).map((row) => [row.from, row.to]);

  const page = async (slug: string, status = 'published') =>
    (await queryUntyped('Pages').createOrThrow({ title: slug, slug, status })).UUID as string;

  const rename = (UUID: string, input: Record<string, unknown>) =>
    queryUntyped('Pages').where({ UUID }).updateOrThrow(input);

  it("leaves a 301 from a live page's old path in every locale its slug serves", async () => {
    await rename(await page('about'), { slug: 'team' });
    deepStrictEqual(await redirects(), [
      ['/about', '/team'],
      ['/de/about', '/de/team'],
    ]);
    deepStrictEqual(await resolve('/about?ref=x'), {
      kind: 'redirect',
      to: '/team?ref=x',
      code: 301,
    });
  });

  it('moves a translatable slug only in the locale written', async () => {
    const post = await queryUntyped('Posts').createOrThrow({
      title: 'Hi',
      status: 'published',
      slug: 'hi',
    });
    await queryUntyped('Posts')
      .locale('de')
      .where({ UUID: post.UUID })
      .updateOrThrow({ slug: 'hallo' });
    await queryUntyped('Posts')
      .locale('de')
      .where({ UUID: post.UUID })
      .updateOrThrow({ slug: 'servus' });
    deepStrictEqual(await redirects(), [['/de/artikel/hallo', '/de/artikel/servus']]);
  });

  it('leaves nothing for a page that is not live before and after the write', async () => {
    await rename(await page('draft', 'draft'), { slug: 'still-draft' });
    await rename(await page('going'), { slug: 'gone', status: 'draft' });
    await rename(await page('unseen', 'draft'), { slug: 'debut', status: 'published' });
    const scheduled = await page('later');
    await rename(scheduled, { publishedAt: Date.now() + 60_000 });
    await rename(scheduled, { slug: 'much-later' });
    deepStrictEqual(await redirects(), []);
  });

  it('leaves nothing while `Site.autoRedirect` is off', async () => {
    await queryUntyped('Site').updateOrThrow({ autoRedirect: false });
    await rename(await page('quiet'), { slug: 'silent' });
    deepStrictEqual(await redirects(), []);
  });

  it('collapses a chain onto the newest path', async () => {
    const UUID = await page('a');
    await rename(UUID, { slug: 'b' });
    await rename(UUID, { slug: 'c' });
    deepStrictEqual(await redirects(), [
      ['/a', '/c'],
      ['/b', '/c'],
      ['/de/a', '/de/c'],
      ['/de/b', '/de/c'],
    ]);
  });

  it('never loops when a page moves back', async () => {
    const UUID = await page('first');
    await rename(UUID, { slug: 'second' });
    await rename(UUID, { slug: 'first' });
    deepStrictEqual(await redirects(), [
      ['/de/second', '/de/first'],
      ['/second', '/first'],
    ]);
    strictEqual((await resolve('/first')).kind, 'page');
  });

  it('retargets a hand-made row leaving the old path instead of adding a second', async () => {
    await queryUntyped('Redirects').createOrThrow({ from: '/old', to: '/elsewhere', code: '302' });
    await rename(await page('old'), { slug: 'new' });
    const row = await queryUntyped('Redirects').where({ from: '/old' }).findFirst();
    strictEqual(row?.to, '/new');
    strictEqual(row?.code, '301');
  });

  it('writes nothing when the update fails its uniqueness check', async () => {
    await page('taken');
    const outcome = await queryUntyped('Pages')
      .where({ UUID: await page('free') })
      .update({ slug: 'taken' });
    ok(!outcome.ok);
    deepStrictEqual(await redirects(), []);
  });

  it('lets a live page answer over a redirect, which returns once the page goes', async () => {
    await queryUntyped('Redirects').createOrThrow({ from: '/promo', to: '/sale' });
    const promo = await page('promo', 'draft');
    deepStrictEqual(await resolve('/promo'), { kind: 'redirect', to: '/sale', code: 301 });
    await rename(promo, { status: 'published' });
    strictEqual((await resolve('/promo')).kind, 'page');
    await rename(promo, { expiresAt: Date.now() - 1 });
    deepStrictEqual(await resolve('/promo'), { kind: 'redirect', to: '/sale', code: 301 });
  });

  const signIn = async (email: string) => {
    await queryUntyped('Users').createOrThrow({ email, password: PASSWORD, roles: ['admin'] });
    const login = await fetch(`http://127.0.0.1:${app.port}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    return login.headers
      .getSetCookie()
      .map((line) => line.split(';')[0])
      .join('; ');
  };

  it('leaves no redirect into or out of the 404 page', async () => {
    await rename(await page('404'), { slug: 'oops' });
    await rename(await page('broken'), { slug: '404' });
    deepStrictEqual(await redirects(), []);
    await rename(await page('index'), { slug: 'start' });
    deepStrictEqual(await redirects(), [
      ['/', '/start'],
      ['/de', '/de/start'],
    ]);
  });

  it('tells an editor whether a page a visitor sees holds a path, and refuses anyone else', async () => {
    const shadowed = async (path: string, cookie = '') => {
      const response = await fetch(
        `http://127.0.0.1:${app.port}/cms/redirects/shadowed?path=${path}`,
        { headers: { cookie } },
      );
      return response.ok
        ? ((await response.json()) as { shadowed: boolean }).shadowed
        : response.status;
    };
    const cookie = await signIn('editor@example.com');
    const photo = await queryUntyped('Uploads').createOrThrow({
      kind: 'file',
      directory: '',
      name: 'photo.png',
      type: 'image/png',
      size: 1,
      hash: 'deadbeef',
    });
    for (const from of ['/hidden', '/shown', '/404']) {
      await queryUntyped('Redirects').createOrThrow({ from, to: '/elsewhere' });
    }
    await page('hidden', 'draft');
    await rename(await page('shown'), { photo: photo.UUID });
    strictEqual(await shadowed('/shown'), 403);
    strictEqual(await shadowed('/hidden', cookie), false);
    strictEqual(await shadowed('/shown', cookie), true);
    strictEqual(await shadowed('/404', cookie), false);
    await page('404');
    strictEqual(await shadowed('/404', cookie), true);
  });

  it('tells whether a visitor sees a page at a path, whatever the caller may read', async () => {
    const cookie = await signIn('author@example.com');
    const live = async (path: string) => {
      const response = await fetch(
        `http://127.0.0.1:${app.port}/cms/routes/live?path=${encodeURIComponent(path)}`,
        { headers: { cookie } },
      );
      return response.ok ? ((await response.json()) as { live: boolean }).live : response.status;
    };
    const home = await page('index', 'draft');
    strictEqual(await live('/'), false);
    await rename(home, { status: 'published' });
    strictEqual(await live('/'), true);
    await rename(home, { slug: 'start' });
    strictEqual(await live('/'), false);
    strictEqual(await live('about'), 400);
  });

  it('tells no one who may not read a page that it is live', async () => {
    await queryUntyped('Members').createOrThrow({
      title: 'Secret',
      slug: 'secret',
      status: 'published',
    });
    const live = async (cookie?: string) =>
      (
        (await (
          await fetch(`http://127.0.0.1:${app.port}/cms/routes/live?path=%2Fmembers%2Fsecret`, {
            headers: cookie === undefined ? {} : { cookie },
          })
        ).json()) as { live: boolean }
      ).live;
    deepStrictEqual([await live(), await live(await signIn('member@example.com'))], [false, true]);
  });
});
