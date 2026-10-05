import type { QueryRecord } from 'ohnejs';

import { HTTPError, queryMetadata } from 'ohnejs';
import { queryScoped } from 'ohnejs/auth';
import { decodeRouteParams, isString, isUndefined } from 'ohnejs/utils';

import { loadRelations } from './relations.ts';
import { type CMSRoute, routePath, routesIn, splitLocale } from './routes.ts';

/**
 * What a site path resolves to: a page, or nothing.
 */
export type Resolved =
  | {
      kind: 'page';
      collection: string;
      UUID: string;
      locale: string;
      path: string;
      record: QueryRecord;
    }
  | { kind: 'notFound' };

/**
 * Resolves a site path to the record a route pattern matches, read as the caller may read it.
 * The path's locale prefix picks the locale; the most specific pattern that finds a record wins.
 * The record's relations load one level deep, at the top and inside its blocks.
 */
export async function resolvePath(raw: string): Promise<Resolved> {
  const split = splitLocale(new URL(raw, 'http://site').pathname);
  if (isUndefined(split)) return { kind: 'notFound' };
  for (const route of routesIn(split.locale)) {
    const params = route.match(split.path);
    if (params === null) continue;
    const slug = decodeRouteParams(params).slug;
    const record = await readPage(route, slug);
    if (isUndefined(record)) continue;
    await loadRelations(record, route.collection, route.locale);
    return {
      kind: 'page',
      collection: route.collection,
      UUID: record.UUID as string,
      locale: route.locale,
      path: routePath(route, isString(record.slug) ? record.slug : slug),
      record,
    };
  }
  return { kind: 'notFound' };
}

/**
 * The record `route` shows for `slug`, or `undefined` when the caller may not see one.
 */
async function readPage(
  route: CMSRoute,
  slug: string | undefined,
): Promise<QueryRecord | undefined> {
  let builder;
  try {
    builder = await queryScoped(route.collection, 'read');
  } catch (error) {
    if (error instanceof HTTPError) return undefined;
    throw error;
  }
  if (queryMetadata(route.collection).translatable === true) builder.locale(route.locale);
  if (!isUndefined(slug)) builder.where({ slug });
  return builder.findFirst();
}
