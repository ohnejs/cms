import { strictEqual } from 'node:assert';
import { register } from 'node:module';
import { describe, it } from 'node:test';

// The dashboard runtime needs a browser, so its one import here answers the meta a test sets.
const meta = 'data:text/javascript,export const dashboardMeta = () => globalThis.cmsMeta;';
register(
  `data:text/javascript,export const resolve = (spec, ctx, next) => spec === 'ohnejs/dashboard' ? { url: ${JSON.stringify(meta)}, shortCircuit: true } : next(spec, ctx);`,
);
type PagePath = (
  collection: { name: string },
  locale: string,
  record: Readonly<Record<string, unknown>>,
) => string | undefined;

// A URL keeps the browser module out of this program's type check, which knows no DOM.
const source = new URL('../dashboard/components/cms-meta.ts', import.meta.url).href;
const { pagePath } = (await import(source)) as { pagePath: PagePath };

const posts = { name: 'Posts' };

/**
 * Sets the dashboard meta to `routes` for Posts, with `locales`, the first the default, unprefixed.
 */
function routed(routes: Record<string, string>, locales = ['en']): void {
  Object.assign(globalThis, {
    cmsMeta: {
      locales,
      defaultLocale: locales[0],
      cms: { routes: { Posts: routes }, homeSlug: 'index', prefixDefaultLocale: false },
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
});
