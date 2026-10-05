import type { DashboardCollection } from 'ohnejs/dashboard';

import { dashboardMeta } from 'ohnejs/dashboard';

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
    };
  }
}

/**
 * Whether `collection` has pages, so its records open in the live editor.
 */
export function hasPages(collection: DashboardCollection): boolean {
  return Object.hasOwn(dashboardMeta()?.cms?.routes ?? {}, collection.name);
}
