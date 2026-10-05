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
 * The absolute URL of a record's page in `locale`, or `undefined` when it has no page there yet.
 * A route with a `[slug]` needs the saved slug; a singleton's static route needs nothing.
 */
export function pageURL(
  collection: DashboardCollection,
  locale: string,
  record: Readonly<Record<string, unknown>>,
): string | undefined {
  const meta = dashboardMeta();
  const cms = meta?.cms;
  if (isUndefined(meta) || isUndefined(cms?.site)) return undefined;
  const routes = cms.routes[collection.name] ?? {};
  const pattern = routes[locale] ?? routes[meta.defaultLocale];
  if (isUndefined(pattern)) return undefined;
  const slug = record.slug;
  if (pattern.includes('[') && (!isString(slug) || slug === '')) return undefined;
  const inner = pattern.includes('[') ? fillRoute(pattern, { slug: slug as string }) : pattern;
  const prefixed =
    meta.locales.length > 1 && (locale !== meta.defaultLocale || cms.prefixDefaultLocale);
  const path = prefixed ? `/${locale}${inner === '/' ? '' : inner}` : inner;
  return cms.site.replace(/\/+$/, '') + path;
}
