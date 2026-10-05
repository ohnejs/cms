import type { QueryRecord } from 'ohnejs';

import { HTTPError, queryMetadata, queryUntyped } from 'ohnejs';
import { queryScoped } from 'ohnejs/auth';
import { decodeRouteParams, isString, isUndefined } from 'ohnejs/utils';

import type { Draft } from './preview/drafts.ts';

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
 * With `drafts`, an editor's unsaved state wins over the saved record, and a draft's slug finds its page.
 * The record's relations load one level deep, at the top and inside its blocks.
 */
export async function resolvePath(raw: string, drafts: readonly Draft[] = []): Promise<Resolved> {
  const split = splitLocale(new URL(raw, 'http://site').pathname);
  if (isUndefined(split)) return { kind: 'notFound' };
  for (const route of routesIn(split.locale)) {
    const params = route.match(split.path);
    if (params === null) continue;
    const slug = decodeRouteParams(params).slug;
    const record = await readPage(route, slug, drafts);
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
 * The record `route` shows for `slug`, its draft laid over it, or `undefined` when the caller sees none.
 */
async function readPage(
  route: CMSRoute,
  slug: string | undefined,
  drafts: readonly Draft[],
): Promise<QueryRecord | undefined> {
  const translatable = queryMetadata(route.collection).translatable === true;
  const own = drafts.filter(
    (draft) =>
      draft.collection === route.collection && (draft.locale === route.locale || !translatable),
  );
  const drafted = own.find((draft) => isUndefined(slug) || draft.values.slug === slug);
  if (!isUndefined(drafted)) {
    const saved = await readTrusted(route, drafted.record, translatable);
    return { ...saved, ...drafted.values, UUID: drafted.record };
  }
  const saved = await readScoped(route, slug, translatable);
  if (isUndefined(saved)) return undefined;
  const draft = own.find((entry) => entry.record === saved.UUID);
  return isUndefined(draft) ? saved : { ...saved, ...draft.values, UUID: saved.UUID };
}

/**
 * The saved record by `slug`, as the caller's read access admits it.
 */
async function readScoped(
  route: CMSRoute,
  slug: string | undefined,
  translatable: boolean,
): Promise<QueryRecord | undefined> {
  let builder;
  try {
    builder = await queryScoped(route.collection, 'read');
  } catch (error) {
    if (error instanceof HTTPError) return undefined;
    throw error;
  }
  if (translatable) builder.locale(route.locale);
  if (!isUndefined(slug)) builder.where({ slug });
  return builder.findFirst();
}

/**
 * The saved state of a drafted record, whatever its publish state, since its editor previews it.
 * A record that was never saved reads as `{}`.
 */
async function readTrusted(
  route: CMSRoute,
  record: string,
  translatable: boolean,
): Promise<QueryRecord> {
  const builder = queryUntyped(route.collection).where({ UUID: record });
  if (translatable) builder.locale(route.locale);
  return (await builder.findFirst()) ?? {};
}
