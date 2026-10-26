import { hook, useConfig } from 'ohnejs';
import { compileRoute, hasKey, isUndefined, mapValues } from 'ohnejs/utils';

import { NOT_FOUND_SLUG, routeEntries, useCMSConfig } from '../src/config.ts';

declare module 'ohnejs/base' {
  interface DashboardMeta {
    /**
     * The cms layer's settings the dashboard reads on every discovery read.
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

hook('dashboard:meta', (meta) => {
  const { locales } = useConfig().collections;
  const { routes, site, prefixDefaultLocale, homeSlug, previewURL, share } = useCMSConfig();
  meta.cms = {
    routes: mapValues(routes, (_, value) =>
      mapValues(
        Object.fromEntries(routeEntries(value, locales)),
        (_, pattern) => compileRoute(pattern).pattern,
      ),
    ),
    prefixDefaultLocale,
    homeSlug,
    notFoundSlug: NOT_FOUND_SLUG,
    previewURL,
    share,
  };
  if (!isUndefined(site)) meta.cms.site = site;
  for (const collection of meta.collections) {
    if (!hasKey(routes, collection.name)) continue;
    const slug = collection.fields.find((field) => field.name === 'slug' && field.type === 'slug');
    if (isUndefined(slug)) continue;
    slug.type = 'pageSlug';
    slug.options = { ...slug.options, collection: collection.name };
  }
});
