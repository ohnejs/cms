import { hook, useConfig } from 'ohnejs';

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
    };
  }
}

hook('dashboard:meta', (meta) => {
  const { locales } = useConfig().collections;
  const routes = Object.entries(useCMSConfig().routes).map(([collection, value]) => [
    collection,
    Object.fromEntries(routeEntries(value, locales)),
  ]);
  meta.cms = { routes: Object.fromEntries(routes) };
});
