import { strictEqual } from 'node:assert';
import { register } from 'node:module';
import { describe, it } from 'node:test';

// The dashboard runtime needs a browser, so its one import here answers the meta a test sets.
const meta = 'data:text/javascript,export const dashboardMeta = () => globalThis.cmsMeta;';
register(
  `data:text/javascript,export const resolve = (spec, ctx, next) => spec === 'ohnejs/dashboard' ? { url: ${JSON.stringify(meta)}, shortCircuit: true } : next(spec, ctx);`,
);
type Collection = { name: string };
type CMSMeta = {
  pagePath: (
    collection: Collection,
    locale: string,
    record: Readonly<Record<string, unknown>>,
  ) => string | undefined;
  specialPage: (
    collection: Collection,
    locale: string | undefined,
    slug: unknown,
  ) => 'home' | 'notFound' | undefined;
  takesSpecialPages: (collection: Collection, locale: string | undefined) => boolean;
  siteAddress: (path: string) => string;
  siteURL: (path: string) => string | undefined;
  pageInDraft: (
    collection: { fields: { name: string }[] },
    create: boolean,
    saved: Readonly<Record<string, unknown>>,
  ) => boolean;
};

// A URL keeps the browser module out of this program's type check, which knows no DOM.
const source = new URL('../dashboard/components/cms-meta.ts', import.meta.url).href;
const { pagePath, specialPage, takesSpecialPages, siteAddress, siteURL, pageInDraft } =
  (await import(source)) as CMSMeta;

const posts = { name: 'Posts' };

/**
 * Sets the dashboard meta to `routes` for Posts, with `locales`, the first the default, unprefixed.
 * The `cms` entries replace the layer's own, as a site or another home slug does.
 */
function routed(
  routes: Record<string, string>,
  locales = ['en'],
  cms: Record<string, unknown> = {},
): void {
  Object.assign(globalThis, {
    cmsMeta: {
      locales,
      defaultLocale: locales[0],
      cms: {
        routes: { Posts: routes },
        homeSlug: 'index',
        notFoundSlug: '404',
        prefixDefaultLocale: false,
        ...cms,
      },
    },
  });
}

describe('pagePath', () => {
  it('fills a bracket or a colon param with a slug that fits', () => {
    routed({ en: '/blog/[slug]' });
    strictEqual(pagePath(posts, 'en', { slug: 'hello' }), '/blog/hello');
    strictEqual(pagePath(posts, 'en', { slug: 'a/b' }), undefined);
    routed({ en: '/blog/:slug' });
    strictEqual(pagePath(posts, 'en', { slug: 'hello' }), '/blog/hello');
    strictEqual(pagePath(posts, 'en', {}), undefined);
    strictEqual(pagePath(posts, 'en', { slug: 'a/b' }), undefined);
  });

  it('gives a locale without a route no page, as the site does', () => {
    routed({ en: '/blog/[slug]' }, ['en', 'de']);
    strictEqual(pagePath(posts, 'de', { slug: 'hello' }), undefined);
    strictEqual(pagePath(posts, 'en', { slug: 'hello' }), '/blog/hello');
  });

  it('serves the home slug under `/[...slug]` at `/`, whatever slug the home page carries', () => {
    routed({ en: '/[...slug]', de: '/[...slug]' }, ['en', 'de']);
    strictEqual(pagePath(posts, 'en', { slug: 'index' }), '/');
    strictEqual(pagePath(posts, 'de', { slug: 'index' }), '/de');
    strictEqual(pagePath(posts, 'en', { slug: 'a/b' }), '/a/b');
    routed({ en: '/[...slug]' }, ['en'], { homeSlug: 'start' });
    strictEqual(pagePath(posts, 'en', { slug: 'start' }), '/');
    strictEqual(pagePath(posts, 'en', { slug: 'index' }), '/index');
  });
});

describe('specialPage', () => {
  it('names the home and not-found slugs under `/[...slug]` only', () => {
    routed({ en: '/[...slug]', de: '/seiten/[...slug]' }, ['en', 'de', 'fr']);
    strictEqual(specialPage(posts, 'en', 'index'), 'home');
    strictEqual(specialPage(posts, 'en', '404'), 'notFound');
    strictEqual(specialPage(posts, 'en', 'about'), undefined);
    strictEqual(specialPage(posts, 'de', 'index'), undefined);
    strictEqual(specialPage(posts, 'fr', 'index'), undefined);
    routed({ en: '/blog/[slug]' });
    strictEqual(specialPage(posts, 'en', 'index'), undefined);
    routed({ en: '/about' });
    strictEqual(specialPage(posts, 'en', 'index'), undefined);
  });

  it('asks every locale for a slug they share', () => {
    routed({ en: '/[...slug]', de: '/seiten/[...slug]' }, ['en', 'de']);
    strictEqual(specialPage(posts, undefined, 'index'), 'home');
    strictEqual(takesSpecialPages(posts, undefined), true);
    strictEqual(takesSpecialPages(posts, 'de'), false);
    routed({ en: '/blog/[slug]' });
    strictEqual(takesSpecialPages(posts, undefined), false);
  });
});

describe('siteAddress', () => {
  it('reads a path as the address a visitor types, without the protocol', () => {
    routed({}, ['en'], { site: 'https://example.com' });
    strictEqual(siteAddress('/about'), 'example.com/about');
    strictEqual(siteAddress('/'), 'example.com');
    routed({}, ['en'], { site: 'https://example.com/base/' });
    strictEqual(siteAddress('/about'), 'example.com/base/about');
    strictEqual(siteAddress('/'), 'example.com/base');
    routed({});
    strictEqual(siteAddress('/about'), '/about');
  });
});

describe('siteURL', () => {
  it('reads a path as the public URL that opens it, none without a site', () => {
    routed({}, ['en'], { site: 'https://example.com' });
    strictEqual(siteURL('/about'), 'https://example.com/about');
    routed({}, ['en'], { site: 'http://example.com:7412/base/' });
    strictEqual(siteURL('/'), 'http://example.com:7412/base/');
    routed({});
    strictEqual(siteURL('/about'), undefined);
  });
});

describe('pageInDraft', () => {
  const pages = { fields: [{ name: 'slug' }] };

  it('holds for a new record and for a locale its saved record has no slug in', () => {
    strictEqual(pageInDraft(pages, true, {}), true);
    strictEqual(pageInDraft(pages, false, { slug: null }), true);
    strictEqual(pageInDraft(pages, false, { slug: 'about' }), false);
  });

  it('never holds for a saved singleton, whose page needs no slug', () => {
    strictEqual(pageInDraft({ fields: [{ name: 'title' }] }, false, {}), false);
  });
});
