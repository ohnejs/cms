import type { RouteMatcher } from 'ohnejs/utils';

import { useConfig } from 'ohnejs';
import { compareSpecificity, compileRoute, fillRoute } from 'ohnejs/utils';

import { routeEntries, useCMSConfig } from './config.ts';

/**
 * One pattern a path may match: a collection's route in one locale.
 */
export interface CMSRoute {
  /**
   * The collection whose records the pattern shows.
   */
  collection: string;

  /**
   * The locale the pattern belongs to.
   */
  locale: string;

  /**
   * The compiled pattern, without the locale prefix.
   */
  match: RouteMatcher;
}

/**
 * Every route of `locale`, most specific first, so `/blog/[slug]` is tried before `/[...slug]`.
 */
export function routesIn(locale: string): CMSRoute[] {
  const { locales } = useConfig().collections;
  return Object.entries(useCMSConfig().routes)
    .flatMap(([collection, value]) =>
      routeEntries(value, locales)
        .filter(([code]) => code === locale)
        .map(([, pattern]) => ({ collection, locale, match: compileRoute(pattern) })),
    )
    .sort((a, b) => compareSpecificity(a.match.pattern, b.match.pattern));
}

/**
 * Splits a site path into its locale and the path the routes match.
 * A path starts with its locale unless it is in the default locale and `prefixDefaultLocale` is off.
 * Answers `undefined` for a path its locale prefix rules out, like `/en/about` with an unprefixed `en`.
 *
 * @example
 * ```ts
 * splitLocale('/de/artikel/hallo') // -> { locale: 'de', path: '/artikel/hallo' }
 * splitLocale('/about')            // -> { locale: 'en', path: '/about' }
 * ```
 */
export function splitLocale(path: string): { locale: string; path: string } | undefined {
  const { locales, defaultLocale } = useConfig().collections;
  const prefixed = useCMSConfig().prefixDefaultLocale;
  if (locales.length < 2) return { locale: defaultLocale, path };
  const first = path.split('/')[1] ?? '';
  if (!(locales as readonly string[]).includes(first)) {
    return prefixed ? undefined : { locale: defaultLocale, path };
  }
  if (first === defaultLocale && !prefixed) return undefined;
  return { locale: first, path: `/${path.split('/').slice(2).join('/')}` };
}

/**
 * The site path of a record shown by `route`, its locale prefix included.
 */
export function routePath(route: CMSRoute, slug: string | undefined): string {
  const { locales, defaultLocale } = useConfig().collections;
  const inner =
    route.match.params.length === 0
      ? route.match.pattern
      : fillRoute(route.match.pattern, { slug: slug ?? '' });
  const prefixed =
    locales.length > 1 && (route.locale !== defaultLocale || useCMSConfig().prefixDefaultLocale);
  return prefixed ? `/${route.locale}${inner === '/' ? '' : inner}` : inner;
}
