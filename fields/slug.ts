import { defineField, useConfig } from 'ohnejs';
import { isUndefined, slugify } from 'ohnejs/utils';

import { routeEntries, useCMSConfig } from '../src/config.ts';

const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The `slug` field type: the part of a page's path that names it, like `about` or `docs/install`.
 *
 * A write slugifies each `/`-separated segment, so `Über uns` stores as `uber-uns`.
 * A slug holds `/` only in a collection whose route ends in `[...slug]`.
 */
export default defineField({
  columnType: 'text',
  sanitizers: [
    (value) =>
      value
        .split('/')
        .map((segment) => slugify(segment))
        .filter((segment) => segment !== '')
        .join('/'),
  ],
  validators: [
    (value, ctx) => {
      const segments = value.split('/');
      if (!segments.every((segment) => SEGMENT.test(segment))) return 'cms.validation.slug';
      if (segments.length > 1 && !nests(ctx.collection)) return 'cms.validation.slugNested';
      return undefined;
    },
  ],
});

/**
 * Whether a route of `collection` takes a slug with `/`, through a `[...slug]`.
 */
function nests(collection: string | undefined): boolean {
  const value = isUndefined(collection) ? undefined : useCMSConfig().routes[collection];
  if (isUndefined(value)) return false;
  return routeEntries(value, useConfig().collections.locales).some(([, pattern]) =>
    pattern.includes('[...slug]'),
  );
}
