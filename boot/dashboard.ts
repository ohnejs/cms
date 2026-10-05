import { hook, useConfig } from 'ohnejs';
import { isUndefined, mapValues } from 'ohnejs/utils';

import { routeEntries, useCMSConfig } from '../src/config.ts';

declare module 'ohnejs/base' {
  interface DashboardMeta {
    /**
     * The cms layer's settings the dashboard reads on every discovery read.
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

hook('dashboard:meta', (meta) => {
  const { locales } = useConfig().collections;
  const { routes, site, prefixDefaultLocale } = useCMSConfig();
  meta.cms = {
    routes: mapValues(routes, (_, value) => Object.fromEntries(routeEntries(value, locales))),
    prefixDefaultLocale,
  };
  if (!isUndefined(site)) meta.cms.site = site;
});
