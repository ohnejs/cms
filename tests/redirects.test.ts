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
  cms: { routes: { Pages: '/[...slug]', Posts: { en: '/blog/[slug]', de: '/artikel/[slug]' } } },
});
`,
      'collections/Pages.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields, publishedScope } from '@ohnejs/cms';
export default defineCollection({
  fields: { title: field('text', { translatable: true }), ...pageFields() },
  api: { read: { public: true, access: publishedScope } },
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

  it('tells an editor whether a page a visitor sees holds a path, and refuses anyone else', async () => {
    const base = `http://127.0.0.1:${app.port}`;
    const shadowed = async (path: string, cookie = '') => {
      const response = await fetch(`${base}/cms/redirects/shadowed?path=${path}`, {
        headers: { cookie },
      });
      return response.ok
        ? ((await response.json()) as { shadowed: boolean }).shadowed
        : response.status;
    };
    await queryUntyped('Users').createOrThrow({
      email: 'editor@example.com',
      password: PASSWORD,
      roles: ['admin'],
    });
    const login = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'editor@example.com', password: PASSWORD }),
    });
    const cookie = login.headers
      .getSetCookie()
      .map((line) => line.split(';')[0])
      .join('; ');
    await page('hidden', 'draft');
    await page('shown');
    strictEqual(await shadowed('/shown'), 403);
    strictEqual(await shadowed('/hidden', cookie), false);
    strictEqual(await shadowed('/shown', cookie), true);
  });
});
