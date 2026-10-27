import type { QueryRecord, Transaction } from 'ohnejs';

import { hook, queryMetadata, queryUntyped, translate, unprocessable, useConfig } from 'ohnejs';
import { chunk, hasKey, isLocalPath, isString, isUndefined } from 'ohnejs/utils';

import { useCMSConfig } from './config.ts';
import { isLive } from './published-scope.ts';
import { type CMSRoute, isHome, NOT_FOUND_SLUG, routePath, routesIn } from './routes.ts';
import { sitePath, sitePaths } from './utils/site-path.ts';

const before = new WeakMap<Transaction, Map<string, QueryRecord>>();

/**
 * Leaves a redirect from a live page's old path to its new one whenever its slug changes.
 * Off when `Site.autoRedirect` is.
 * The page must be live before and after the write; a draft or an expired page has no address to keep.
 * A translatable slug moves the page in the written locale; any other moves it in every locale.
 * The `404` page never moves, since its path is a miss either way.
 * The rows write on the page's own transaction, so they commit or roll back with it.
 */
export function watchMoves(): void {
  hook('record:before-update', async ({ collection, matched, tx, locale }) => {
    if (!takesSlug(collection)) return;
    const site = await queryUntyped('Site').use(tx).findFirst();
    if (site?.autoRedirect === false) return;
    const meta = queryMetadata(collection);
    const fields = ['UUID', 'slug', 'status', 'publishedAt', 'expiresAt'].filter((name) =>
      hasKey(meta.fields, name),
    );
    const rows = before.get(tx) ?? new Map<string, QueryRecord>();
    before.set(tx, rows);
    for (const UUIDs of chunk(matched, 500)) {
      const builder = queryUntyped(collection)
        .use(tx)
        .unscoped()
        .select(...fields);
      if (meta.translatable === true) builder.locale(locale);
      for (const row of await builder.where({ UUID: { in: UUIDs } }).findMany()) {
        const key = `${collection}:${row.UUID as string}`;
        rows.set(key, row);
      }
    }
  });

  hook('record:after-update', async (record, { collection, tx, locale }) => {
    const key = `${collection}:${record.UUID as string}`;
    const old = before.get(tx)?.get(key);
    if (isUndefined(old)) return;
    before.get(tx)?.delete(key);
    if (!isString(old.slug) || old.slug === '' || !isString(record.slug)) return;
    if (old.slug === record.slug) return;
    const now = Date.now();
    if (!isLive(old, now) || !isLive(record, now)) return;
    const translatable = queryMetadata(collection).fields.slug?.companion === true;
    const locales = translatable ? [locale] : useConfig().collections.locales;
    for (const code of locales) {
      const route = slugRoute(collection, code);
      if (isUndefined(route)) continue;
      if (isHome(route) && [old.slug, record.slug].includes(NOT_FOUND_SLUG)) continue;
      const from = routePath(route, old.slug);
      const to = routePath(route, record.slug);
      if (!isUndefined(from) && !isUndefined(to) && from !== to) await move(tx, from, to);
    }
  });
}

/**
 * Refuses a redirect whose `to` leads back to its own `from`, directly or through other redirects.
 * A loop would send a visitor around until the browser gives up.
 */
export function refuseLoops(): void {
  const check = async (
    record: QueryRecord,
    { collection, tx }: { collection: string; tx: Transaction },
  ): Promise<void> => {
    if (collection !== 'Redirects' || !isString(record.from) || !isString(record.to)) return;
    if (!(await leadsBack(tx, record.from, record.to))) return;
    throw unprocessable(undefined, { errors: { to: translate('cms.validation.redirectLoop') } });
  };
  hook('record:after-create', check);
  hook('record:after-update', check);
}

/**
 * Whether following `to` through the stored redirects arrives at `from`.
 * A URL on the website counts as its path.
 * The walk stops at any other site, and at a cycle that does not pass `from`.
 */
async function leadsBack(tx: Transaction, from: string, to: string): Promise<boolean> {
  const site = useCMSConfig().site?.replace(/\/+$/, '');
  const seen = new Set<string>();
  let next: unknown = to;
  while (isString(next)) {
    const rest = !isUndefined(site) && next.startsWith(site) ? next.slice(site.length) : undefined;
    const target =
      !isUndefined(rest) && /^(?:[/?#]|$)/.test(rest) ? `/${rest.replace(/^\//, '')}` : next;
    if (!isLocalPath(target)) return false;
    const { pathname } = new URL(target, 'http://site');
    const path = sitePath(pathname);
    if (path === from) return true;
    if (seen.has(path)) return false;
    seen.add(path);
    const froms = sitePaths(pathname);
    next = (
      await queryUntyped('Redirects')
        .use(tx)
        .unscoped()
        .where({ from: { in: froms } })
        .findFirst()
    )?.to;
  }
  return false;
}

/**
 * Points `from` at `to`, keeping the redirect graph free of chains and cycles.
 * `to` becomes a sink: a row leaving it goes, and every row that led to `from` now leads to `to`.
 * A row already leaving `from` takes the new target instead of a second row.
 */
async function move(tx: Transaction, from: string, to: string): Promise<void> {
  const redirects = () => queryUntyped('Redirects').use(tx).unscoped();
  await redirects().where({ from: to }).delete();
  await redirects().where({ to: from }).updateOrThrow({ to });
  const target = { to, code: '301', forwardQuery: true };
  const [kept] = await redirects().where({ from }).updateOrThrow(target);
  if (isUndefined(kept)) await redirects().createOrThrow({ from, ...target });
}

/**
 * Whether a route of `collection` takes a slug, so its records can move.
 */
function takesSlug(collection: string): boolean {
  return useConfig().collections.locales.some((code) => !isUndefined(slugRoute(collection, code)));
}

/**
 * The route of `collection` in `locale` that takes a slug, or `undefined`.
 */
function slugRoute(collection: string, locale: string): CMSRoute | undefined {
  if (!hasKey(useCMSConfig().routes, collection)) return undefined;
  return routesIn(locale).find(
    (route) => route.collection === collection && route.match.params.length > 0,
  );
}
