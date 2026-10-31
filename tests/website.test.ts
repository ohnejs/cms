import type { AddressInfo } from 'node:net';

import { deepStrictEqual, match, strictEqual } from 'node:assert';
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { queryUntyped } from 'ohnejs';

import { startApp, type TestApp } from './_app.ts';

const SECRET = 'a-webhook-secret-of-some-length';

describe('website', () => {
  let app: TestApp;
  let hooks: Server;
  const received: { body: string; signature: string }[] = [];

  before(async () => {
    hooks = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        received.push({ body, signature: String(request.headers['ohne-signature']) });
        response.end();
      });
    });
    await new Promise<void>((resolve) => hooks.listen(0, '127.0.0.1', resolve));
    const hookPort = (hooks.address() as AddressInfo).port;
    app = await startApp({
      'ohne.config.ts': `import { defineConfig } from 'ohnejs';
export default defineConfig({
  layers: ['@ohnejs/cms'],
  collections: { locales: ['en', 'de'], defaultLocale: 'en' },
  cms: {
    site: 'https://example.com',
    routes: { Pages: '/[...slug]', Posts: { en: '/blog/[slug]', de: '/artikel/[slug]' } },
    webhooks: [{ url: 'http://127.0.0.1:${hookPort}/hook', secret: '${SECRET}' }],
  },
});
`,
      'collections/Pages.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields, publishedScope } from '@ohnejs/cms';
export default defineCollection({
  fields: {
    title: field('text'),
    ...pageFields(),
    related: field('record', { collection: 'Posts' }),
  },
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
    });
    await queryUntyped('Site').updateOrThrow({ name: 'Acme', description: 'Default words' });
    const post = await queryUntyped('Posts').createOrThrow({
      status: 'published',
      title: 'Hello',
      slug: 'hello',
    });
    await queryUntyped('Posts')
      .locale('de')
      .where({ UUID: post.UUID })
      .updateOrThrow({ title: 'Hallo', slug: 'hallo' });
    await queryUntyped('Pages').createOrThrow({
      status: 'published',
      title: 'Home',
      slug: 'index',
    });
    await queryUntyped('Pages').createOrThrow({
      status: 'published',
      title: 'About',
      slug: 'about',
      related: post.UUID,
      seo: { title: 'About Acme', noindex: false },
    });
    await queryUntyped('Pages').createOrThrow({
      status: 'published',
      title: 'Hidden',
      slug: 'hidden',
      seo: { noindex: true },
    });
    await queryUntyped('Pages').createOrThrow({ status: 'published', title: 'Lost', slug: '404' });
    await queryUntyped('Posts').createOrThrow({
      status: 'published',
      title: 'Errors',
      slug: '404',
    });
    await queryUntyped('Redirects').createOrThrow({ from: '/404', to: '/about' });
    await queryUntyped('Redirects').createOrThrow({
      from: '/old',
      to: '/about',
      code: '308',
      forwardQuery: false,
    });
    await queryUntyped('Redirects').createOrThrow({
      from: '/go',
      to: 'https://elsewhere.test/',
      forwardQuery: true,
    });
    await queryUntyped('Redirects').createOrThrow({
      from: '/moved',
      to: '/about?tab=team#staff',
      forwardQuery: true,
    });
  });

  after(async () => {
    await app.stop();
    hooks.close();
  });

  const resolve = async (path: string) =>
    (await app.get(`/cms/routes/resolve?path=${encodeURIComponent(path)}`)).body;

  it('shows the home page at the root and redirects its own path there', async () => {
    const home = await resolve('/');
    strictEqual(home.record.title, 'Home');
    strictEqual(home.path, '/');
    deepStrictEqual(await resolve('/index'), { kind: 'redirect', to: '/', code: 301 });
    deepStrictEqual(await resolve('/index?ref=x&ohne-preview=t'), {
      kind: 'redirect',
      to: '/?ref=x&ohne-preview=t',
      code: 301,
    });
  });

  it('carries the 404 page on a path nothing answers', async () => {
    const lost = await resolve('/nope');
    strictEqual(lost.kind, 'notFound');
    strictEqual(lost.page.title, 'Lost');
  });

  it("answers the 404 page's own path as a miss in every locale, over a redirect", async () => {
    for (const path of ['/404', '/de/404']) {
      const lost = await resolve(path);
      strictEqual(lost.kind, 'notFound', path);
      strictEqual(lost.page?.title, 'Lost', path);
    }
    strictEqual((await resolve('/blog/404')).record?.title, 'Errors');
  });

  it('carries the 404 page on a path whose locale prefix is ruled out', async () => {
    for (const path of ['/en', '/en/about']) {
      const lost = await resolve(path);
      strictEqual(lost.kind, 'notFound', path);
      strictEqual(lost.page?.title, 'Lost', path);
    }
  });

  it('answers a redirect where no page does, forwarding the query when asked', async () => {
    deepStrictEqual(await resolve('/old/?ref=x'), { kind: 'redirect', to: '/about', code: 308 });
    deepStrictEqual(await resolve('/go?ref=x'), {
      kind: 'redirect',
      to: 'https://elsewhere.test/?ref=x',
      code: 301,
    });
    deepStrictEqual(await resolve('/moved?ref=x'), {
      kind: 'redirect',
      to: '/about?tab=team&ref=x#staff',
      code: 301,
    });
    deepStrictEqual(await resolve('/moved?tags=[a%2Cb,new]'), {
      kind: 'redirect',
      to: '/about?tab=team&tags=[a%2Cb,new]#staff',
      code: 301,
    });
  });

  it('carries the preview token along a redirect within the site and never to another', async () => {
    deepStrictEqual(await resolve('/moved?ohne-preview=t'), {
      kind: 'redirect',
      to: '/about?tab=team&ohne-preview=t#staff',
      code: 301,
    });
    deepStrictEqual(await resolve('/go?ohne-preview=t&ref=x'), {
      kind: 'redirect',
      to: 'https://elsewhere.test/?ref=x',
      code: 301,
    });
  });

  it("resolves SEO from the page, falling back to the site's settings", async () => {
    const about = await resolve('/about');
    deepStrictEqual(about.seo, {
      title: 'About Acme | Acme',
      description: 'Default words',
      canonical: 'https://example.com/about',
    });
    strictEqual((await resolve('/hidden')).seo.robots, 'noindex');
  });

  it('names the site in a locale without its own site name, and borrows no description', async () => {
    const post = await resolve('/de/artikel/hallo');
    strictEqual(post.seo.title, 'Hallo | Acme');
    strictEqual(post.seo.description, undefined);
  });

  it('lists the page in every locale, with the default locale as x-default', async () => {
    const post = await resolve('/blog/hello');
    deepStrictEqual(post.alternates, [
      { hreflang: 'en', href: 'https://example.com/blog/hello' },
      { hreflang: 'x-default', href: 'https://example.com/blog/hello' },
      { hreflang: 'de', href: 'https://example.com/de/artikel/hallo' },
    ]);
  });

  it('gives a related page its path, so the site can link to it', async () => {
    strictEqual((await resolve('/about')).record.related.path, '/blog/hello');
  });

  it('lists the visible pages in the sitemap, with alternates, and leaves out hidden ones', async () => {
    const response = await fetch(`http://127.0.0.1:${app.port}/cms/sitemap.xml`);
    const xml = await response.text();
    match(response.headers.get('content-type') ?? '', /application\/xml/);
    match(xml, /<loc>https:\/\/example\.com\/<\/loc>/);
    match(xml, /<loc>https:\/\/example\.com\/de\/artikel\/hallo<\/loc>/);
    match(xml, /hreflang="de" href="https:\/\/example\.com\/de\/artikel\/hallo"/);
    strictEqual(xml.includes('/hidden'), false);
    match(xml, /<loc>https:\/\/example\.com\/blog\/404<\/loc>/);
    strictEqual(xml.includes('example.com/404<'), false);
  });

  it('opens robots.txt to everyone and names the sitemap, or drops the sitemap under noindex', async () => {
    const open = await (await fetch(`http://127.0.0.1:${app.port}/cms/robots.txt`)).text();
    strictEqual(open, 'User-agent: *\nAllow: /\n\nSitemap: https://example.com/sitemap.xml\n');
    await queryUntyped('Site').updateOrThrow({ noindex: true });
    const hidden = await (await fetch(`http://127.0.0.1:${app.port}/cms/robots.txt`)).text();
    strictEqual(hidden, 'User-agent: *\nDisallow:\n');
    await queryUntyped('Site').updateOrThrow({ noindex: false });
  });

  it('signs a webhook for each committed change to a page', async () => {
    const pages = () =>
      received.find((entry) => {
        const body = JSON.parse(entry.body);
        return body.collection === 'Pages' && body.event === 'update';
      });
    await queryUntyped('Pages').where({ slug: 'about' }).updateOrThrow({ title: 'About us' });
    for (let attempt = 0; attempt < 50 && pages() === undefined; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const delivery = pages();
    const body = JSON.parse(delivery?.body ?? '{}');
    strictEqual(body.event, 'update');
    strictEqual(body.collection, 'Pages');
    const [, t, v1] = /^t=(\d+),v1=(.+)$/.exec(delivery?.signature ?? '') ?? [];
    const expected = createHmac('sha256', SECRET)
      .update(`${t}.${delivery?.body}`)
      .digest('base64url');
    strictEqual(v1, expected);
  });
  it("announces the redirect a page's move leaves behind", async () => {
    await queryUntyped('Pages').where({ slug: 'hidden' }).updateOrThrow({ slug: 'unseen' });
    const rows = await queryUntyped('Redirects')
      .where({ to: { endsWith: '/unseen' } })
      .findMany();
    const announced = () => {
      const created = received
        .map((entry) => JSON.parse(entry.body))
        .filter((body) => body.collection === 'Redirects' && body.event === 'create')
        .flatMap((body) => body.uuids);
      return rows.every((row) => created.includes(row.UUID));
    };
    for (let attempt = 0; attempt < 50 && !announced(); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    strictEqual(rows.length, 2);
    strictEqual(announced(), true);
  });
});
