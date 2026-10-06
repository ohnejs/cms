import type { DashboardCollection } from 'ohnejs/dashboard';

import { dashboardMeta } from 'ohnejs/dashboard';
import { fillRoute, isString, isUndefined } from 'ohnejs/utils';

declare module 'ohnejs/dashboard' {
  interface DashboardMeta {
    /**
     * The cms layer's settings, set on every discovery read.
     */
    cms?: {
      /**
       * Each collection with pages, mapped to its route pattern per locale.
       */
      routes: Record<string, Record<string, string>>;

      /**
       * The website origin and base path the editor frames, absent when no site is set.
       */
      site?: string;

      /**
       * Whether a path in the default locale starts with the locale too.
       */
      prefixDefaultLocale: boolean;

      /**
       * The slug under `/[...slug]` whose page shows at `/`.
       */
      homeSlug: string;

      /**
       * What the live editor frames, relative to `site`, with `{path}` and `{token}` filled in.
       */
      previewURL: string;

      /**
       * The lifetimes a shared preview link may have, and the one chosen first.
       */
      share: { durations: string[]; default: string };
    };
  }
}

/**
 * Whether `collection` has pages, so its records open in the live editor.
 */
export function hasPages(collection: DashboardCollection): boolean {
  return Object.hasOwn(dashboardMeta()?.cms?.routes ?? {}, collection.name);
}

/**
 * The site path of a record's page in `locale`, or `undefined` when it has no page there yet.
 * A route with a `[slug]` needs a slug; a singleton's static route needs nothing.
 * The home slug under `/[...slug]` is `/`, the path the site serves it at.
 */
export function pagePath(
  collection: DashboardCollection,
  locale: string,
  record: Readonly<Record<string, unknown>>,
): string | undefined {
  const meta = dashboardMeta();
  const cms = meta?.cms;
  if (isUndefined(meta) || isUndefined(cms)) return undefined;
  const routes = cms.routes[collection.name] ?? {};
  const pattern = routes[locale] ?? routes[meta.defaultLocale];
  if (isUndefined(pattern)) return undefined;
  const slug = record.slug;
  if (pattern.includes('[') && (!isString(slug) || slug === '')) return undefined;
  const inner =
    pattern === '/[...slug]' && slug === cms.homeSlug
      ? '/'
      : pattern.includes('[')
        ? fillRoute(pattern, { slug: slug as string })
        : pattern;
  const prefixed =
    meta.locales.length > 1 && (locale !== meta.defaultLocale || cms.prefixDefaultLocale);
  return prefixed ? `/${locale}${inner === '/' ? '' : inner}` : inner;
}

/**
 * The absolute URL the live editor frames for `path`, through `cms.previewURL`, or `undefined` without a site.
 */
export function frameURL(path: string, token: string): string | undefined {
  const cms = dashboardMeta()?.cms;
  if (isUndefined(cms?.site)) return undefined;
  const target = cms.previewURL.replaceAll('{path}', path).replaceAll('{token}', token);
  return cms.site.replace(/\/+$/, '') + target;
}
