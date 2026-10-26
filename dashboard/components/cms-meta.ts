import type { DashboardCollection } from 'ohnejs/dashboard';

import { dashboardMeta } from 'ohnejs/dashboard';
import {
  compileRoute,
  fillRoute,
  fitsRoute,
  hasKey,
  isNullish,
  isString,
  isUndefined,
  withoutTrailingSlash,
} from 'ohnejs/utils';

/**
 * A page the site serves in a role of its own: at `/`, or wherever nothing else answers.
 */
export type SpecialPage = 'home' | 'notFound';

const HOME_ROUTE = '/[...slug]';

declare module 'ohnejs/dashboard' {
  interface DashboardMeta {
    /**
     * The cms layer's settings, set on every discovery read.
     */
    cms?: {
      /**
       * Each collection with pages, mapped to its normalized route pattern per locale.
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
       * The slug under `/[...slug]` whose page a path nothing answers shows.
       */
      notFoundSlug: string;

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
  return hasKey(dashboardMeta()?.cms?.routes ?? {}, collection.name);
}

/**
 * The site path of a record's page in `locale`, or `undefined` when it has no page there yet.
 * A route with a param needs a slug that fits it, so `a/b` waits for a `[...slug]`.
 * A singleton's static route needs nothing, and a locale without a route has no page.
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
  const pattern = cms.routes[collection.name]?.[locale];
  if (isUndefined(pattern)) return undefined;
  const slug = record.slug;
  let inner: string;
  if (specialPage(collection, locale, slug) === 'home') inner = '/';
  else if (compileRoute(pattern).params.length === 0) inner = pattern;
  else if (isString(slug) && fitsRoute(pattern, { slug })) inner = fillRoute(pattern, { slug });
  else return undefined;
  const prefixed =
    meta.locales.length > 1 && (locale !== meta.defaultLocale || cms.prefixDefaultLocale);
  return prefixed ? `/${locale}${inner === '/' ? '' : inner}` : inner;
}

/**
 * Whether a record's page in the open locale exists only in its draft, so the site cannot show it yet.
 * That holds for a new record, and for a saved one with no slug in that locale, a translation it lacks.
 * A singleton has no slug, so its saved record always has its page.
 */
export function pageInDraft(
  collection: Pick<DashboardCollection, 'fields'>,
  create: boolean,
  saved: Readonly<Record<string, unknown>>,
): boolean {
  if (create) return true;
  return collection.fields.some((field) => field.name === 'slug') && isNullish(saved.slug);
}

/**
 * The absolute URL the live editor frames for `path`, through `cms.previewURL`.
 * It is `undefined` without a site.
 */
export function frameURL(path: string, token: string): string | undefined {
  const cms = dashboardMeta()?.cms;
  if (isUndefined(cms?.site)) return undefined;
  const target = cms.previewURL.replaceAll('{path}', path).replaceAll('{token}', token);
  return cms.site.replace(/\/+$/, '') + target;
}

/**
 * Whether a record of `collection` may be the home or not-found page in `locale`, under `/[...slug]` there.
 * Without `locale`, for a slug every locale shares, any locale's route counts.
 */
export function takesSpecialPages(
  collection: DashboardCollection,
  locale: string | undefined,
): boolean {
  const routes = dashboardMeta()?.cms?.routes[collection.name] ?? {};
  return isUndefined(locale)
    ? Object.values(routes).includes(HOME_ROUTE)
    : routes[locale] === HOME_ROUTE;
}

/**
 * The special page `slug` makes a record of `collection` in `locale`, read as `takesSpecialPages` reads it.
 */
export function specialPage(
  collection: DashboardCollection,
  locale: string | undefined,
  slug: unknown,
): SpecialPage | undefined {
  const cms = dashboardMeta()?.cms;
  if (isUndefined(cms) || !takesSpecialPages(collection, locale)) return undefined;
  if (slug === cms.homeSlug) return 'home';
  if (slug === cms.notFoundSlug) return 'notFound';
  return undefined;
}

/**
 * The address a visitor types for `path`: the site's host and base path before it, no trailing slash.
 * Without a site, it is the bare path.
 */
export function siteAddress(path: string): string {
  const site = dashboardMeta()?.cms?.site;
  if (isUndefined(site)) return path;
  const { host, pathname } = new URL(site);
  return host + withoutTrailingSlash(pathname + path);
}

/**
 * The public URL that opens `path` on the site, as `siteAddress` reads it but with its protocol.
 * It is `undefined` without a site.
 */
export function siteURL(path: string): string | undefined {
  const site = dashboardMeta()?.cms?.site;
  if (isUndefined(site)) return undefined;
  const { origin, pathname } = new URL(site);
  return origin + withoutTrailingSlash(pathname) + path;
}
