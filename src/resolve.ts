import type { QueryRecord } from 'ohnejs';

import { queryMetadata, queryUntyped, useConfig } from 'ohnejs';
import {
  decodeRouteParams,
  isEmpty,
  isNull,
  isString,
  isUndefined,
  percentDecode,
} from 'ohnejs/utils';

import type { Draft } from './preview/drafts.ts';

import { useCMSConfig } from './config.ts';
import { loadRelations } from './relations.ts';
import { type CMSRoute, isHome, routePath, routesIn, splitLocale } from './routes.ts';
import { scopedRead } from './scoped-read.ts';
import { type Alternate, alternatesOf, type SEO, seoOf } from './seo.ts';

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
      seo: SEO;
      alternates: Alternate[];
    }
  | { kind: 'redirect'; to: string; code: 301 | 302 | 307 | 308 }
  | { kind: 'notFound'; page?: QueryRecord };

/**
 * Resolves a site path to the record a route pattern matches, read as the caller may read it.
 *
 * The path's locale prefix picks the locale; the most specific pattern that finds a record wins.
 * `/` shows the home page, the slug `cms.homeSlug` under `/[...slug]`.
 * That slug's own path redirects to `/`.
 * A redirect whose `from` is the path answers only when no page does, so a live page shadows it.
 * A path nothing answers carries the page with the slug `404`, when there is one.
 * A path whose locale prefix is ruled out carries the default locale's.
 * With `drafts`, an editor's unsaved state wins over the saved record.
 * A draft's slug finds its page, unless another saved record holds that slug.
 * The record's relations load one level deep, at the top and inside its blocks.
 * The loaded records keep their own record relations as `UUID`s.
 * Their uploads load too, at every depth, since an upload is a public file and never a scoped record.
 */
export async function resolvePath(raw: string, drafts: readonly Draft[] = []): Promise<Resolved> {
  const url = new URL(raw, 'http://site');
  const split = splitLocale(url.pathname);
  if (isUndefined(split)) {
    return (await redirectOf(url)) ?? (await missIn(useConfig().collections.defaultLocale, drafts));
  }
  const { homeSlug } = useCMSConfig();
  const home = split.path === '/' || isEmpty(split.path);
  for (const route of routesIn(split.locale)) {
    const params = home && isHome(route) ? { slug: homeSlug } : route.match(split.path);
    if (isNull(params)) continue;
    const slug = decodeRouteParams(params).slug;
    const record = await readPage(route, slug, drafts);
    if (isUndefined(record)) continue;
    const path = routePath(route, isString(record.slug) ? record.slug : slug);
    if (isUndefined(path)) continue;
    if (!home && isHome(route) && slug === homeSlug)
      return { kind: 'redirect', to: path, code: 301 };
    await loadRelations([record], route.collection, route.locale);
    return {
      kind: 'page',
      collection: route.collection,
      UUID: record.UUID as string,
      locale: route.locale,
      path,
      record,
      seo: await seoOf(record, route.locale, path),
      alternates: await alternatesOf(route.collection, record, route.locale),
    };
  }
  return (await redirectOf(url)) ?? (await missIn(split.locale, drafts));
}

/**
 * The redirect whose `from` is the path, trailing slash aside, or `undefined`.
 * `forwardQuery` carries the request's query over to the target.
 */
async function redirectOf(url: URL): Promise<Resolved | undefined> {
  const from = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
  const row = await queryUntyped('Redirects').where({ from }).findFirst();
  if (isUndefined(row) || !isString(row.to)) return undefined;
  const to = row.forwardQuery === true ? forward(row.to, url) : row.to;
  return { kind: 'redirect', to, code: Number(row.code) as 301 | 302 | 307 | 308 };
}

/**
 * `to` with the request's query appended after its own, its hash kept last.
 * Both queries keep their bytes, so a structured value like `tags=[a,b]` still reads as a list.
 * The preview token goes along to a path of the site, so a preview follows a moved page.
 * It never goes to another site, where a share token would land in logs and referers.
 */
function forward(to: string, url: URL): string {
  if (isEmpty(url.search)) return to;
  const target = new URL(to, url);
  const own = target.origin === url.origin;
  const pairs = url.search
    .slice(1)
    .split('&')
    .filter((pair) => own || percentDecode(pair.split('=')[0]!) !== 'ohne-preview');
  target.search = [target.search.slice(1), ...pairs].filter((pair) => !isEmpty(pair)).join('&');
  return own ? target.pathname + target.search + target.hash : target.href;
}

/**
 * A miss in `locale`, carrying the page with the slug `404` under the root catch-all when there is one.
 */
async function missIn(locale: string, drafts: readonly Draft[]): Promise<Resolved> {
  const route = routesIn(locale).find(isHome);
  if (isUndefined(route)) return { kind: 'notFound' };
  const page = await readPage(route, '404', drafts);
  if (isUndefined(page)) return { kind: 'notFound' };
  await loadRelations([page], route.collection, route.locale);
  return { kind: 'notFound', page };
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
  if (!isUndefined(drafted) && !(await heldElsewhere(route, slug, drafted.record, translatable))) {
    const saved = await readTrusted(route, drafted.record, translatable);
    return { ...saved, ...drafted.values, UUID: drafted.record };
  }
  const saved = await readScoped(route, slug);
  if (isUndefined(saved)) return undefined;
  const draft = own.find((entry) => entry.record === saved.UUID);
  return isUndefined(draft) ? saved : { ...saved, ...draft.values, UUID: saved.UUID };
}

/**
 * The saved record by `slug`, as the caller's read access admits it.
 * The route's locale wins over the scope's, as a request's `locale` param does.
 */
async function readScoped(
  route: CMSRoute,
  slug: string | undefined,
): Promise<QueryRecord | undefined> {
  const builder = await scopedRead(route.collection, route.locale);
  if (isUndefined(builder)) return undefined;
  if (!isUndefined(slug)) builder.where({ slug });
  return builder.findFirst();
}

/**
 * Whether a saved record other than `record` holds `slug`, whatever its publish state.
 * Such a slug stays its holder's, so a draft can never lay itself over a page its editor may not change.
 */
async function heldElsewhere(
  route: CMSRoute,
  slug: string | undefined,
  record: string,
  translatable: boolean,
): Promise<boolean> {
  if (isUndefined(slug)) return false;
  const builder = queryUntyped(route.collection).where({
    slug,
    UUID: { not: { equalsTo: record } },
  });
  if (translatable) builder.locale(route.locale);
  return builder.exists();
}

/**
 * The saved state of a drafted record, whatever its publish state, since its editor previews it.
 * A record that was never saved reads as its system fields alone.
 */
async function readTrusted(
  route: CMSRoute,
  record: string,
  translatable: boolean,
): Promise<QueryRecord> {
  const builder = queryUntyped(route.collection).where({ UUID: record });
  if (translatable) builder.locale(route.locale);
  return (
    (await builder.findFirst()) ?? {
      UUID: record,
      _updatedAt: Date.now(),
      ...(translatable ? { _translations: [] } : {}),
    }
  );
}
