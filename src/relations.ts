import type { FieldQueryMeta, QueryRecord } from 'ohnejs';
import type { RecordLink } from 'ohnejs/utils';

import { AsyncLocalStorage } from 'node:async_hooks';
import {
  blockQueryMetadata,
  queryMetadata,
  queryUntyped,
  runWithoutEvent,
  useEnv,
  useEvent,
} from 'ohnejs';
import {
  chunk,
  groupBy,
  isArray,
  isPlainObject,
  isString,
  isUndefined,
  pick,
  uniqueArray,
} from 'ohnejs/utils';

import { type CMSRoute, routePath, routesIn } from './routes.ts';
import { scopedRead } from './scoped-read.ts';

/**
 * The stored fields of a loaded upload a site may see.
 * An allowlist, so a field an app adds to `Uploads` never reaches the site.
 */
export const UPLOAD_FIELDS = [
  'UUID',
  'name',
  'type',
  'size',
  'width',
  'height',
  'description',
  'focalX',
  'focalY',
] as const;

/**
 * The API origin `asVisitor` carries out of the request it leaves.
 */
const origins = new AsyncLocalStorage<string>();

/**
 * Where one relation value sits: the object holding it and its key.
 */
interface Slot {
  holder: Record<string, unknown>;
  key: string;
  target: string;
  many: boolean;
}

/**
 * Loads every relation of a page record one level deep, at the top and inside its blocks and composites.
 * A relation reads as its reader may read the target, so a draft or a hidden record stays out.
 * Public uploads load whatever the reader's role, since their files are public already; private ones never do.
 * A loaded upload carries only what a site renders it with, and its URLs become absolute.
 * A loaded record of a collection with pages carries its `path`, so a site links to it.
 * The loaded records keep their own record relations as `UUID`s.
 * Their uploads load too, at every depth, since an upload is a public file and never a scoped record.
 * A record link carries `href`, its target's path, when the reader can open that page.
 */
export async function loadRelations(
  record: QueryRecord,
  collection: string,
  locale: string,
): Promise<void> {
  const slots: Slot[] = [];
  const links: RecordLink[] = [];
  collect(record, queryMetadata(collection).fields, slots, links);
  const wanted = new Map<string, Set<string>>();
  for (const slot of slots) {
    const ids = wanted.get(slot.target) ?? new Set<string>();
    for (const id of idsOf(slot.holder[slot.key])) ids.add(id);
    wanted.set(slot.target, ids);
  }
  const loaded = new Map<string, Map<string, QueryRecord>>();
  for (const [target, ids] of wanted) {
    loaded.set(target, await readTargets(target, [...ids], locale));
  }
  swap(slots, loaded);
  const nested: Slot[] = [];
  for (const [target, records] of loaded) {
    if (target === 'Uploads') continue;
    const fields = queryMetadata(target).fields;
    for (const record of records.values()) collect(record, fields, nested, []);
  }
  const uploads = nested.filter((slot) => slot.target === 'Uploads');
  const ids = uniqueArray(uploads.flatMap((slot) => idsOf(slot.holder[slot.key])));
  swap(uploads, new Map([['Uploads', await readTargets('Uploads', ids, locale)]]));
  await resolveLinks(links, locale);
}

/**
 * Replaces each slot's `UUID`s with the `loaded` records they name, dropping those the reader may not see.
 */
function swap(slots: readonly Slot[], loaded: ReadonlyMap<string, Map<string, QueryRecord>>): void {
  for (const { holder, key, target, many } of slots) {
    const records = loaded.get(target) ?? new Map<string, QueryRecord>();
    const value = holder[key];
    holder[key] = many
      ? idsOf(value).flatMap((id) => records.get(id) ?? [])
      : (records.get(isString(value) ? value : '') ?? null);
  }
}

/**
 * Records every relation slot and record link under `value`, descending into blocks and child tables.
 */
function collect(
  value: Record<string, unknown>,
  fields: Readonly<Record<string, FieldQueryMeta>>,
  slots: Slot[],
  links: RecordLink[],
): void {
  for (const [key, meta] of Object.entries(fields)) {
    const held = value[key];
    if ((meta.kind === 'record' || meta.kind === 'records') && !isUndefined(meta.target)) {
      if (!isUndefined(held))
        slots.push({ holder: value, key, target: meta.target, many: meta.kind === 'records' });
    } else if (meta.kind === 'column') {
      for (const entry of meta.fieldType?.links?.(held) ?? []) links.push(entry.link);
    } else if (meta.kind === 'blocks') {
      for (const item of isArray(held) ? held : []) {
        if (!isPlainObject(item) || !isString(item.block) || !isPlainObject(item.fields)) continue;
        collect(item.fields, blockQueryMetadata(item.block).fields, slots, links);
      }
    } else if (
      (meta.kind === 'childOne' || meta.kind === 'childMany') &&
      !isUndefined(meta.subfields)
    ) {
      for (const item of isArray(held) ? held : [held]) {
        if (isPlainObject(item)) collect(item, meta.subfields, slots, links);
      }
    }
  }
}

/**
 * Sets each link's `href` to its target's path in `locale`, as the reader may read the target.
 * A forged `href` never survives, since a draft skips the sanitizer that drops it.
 * A link whose target is missing, hidden, or without a route or a fitting slug in `locale` keeps no `href`.
 */
async function resolveLinks(links: readonly RecordLink[], locale: string): Promise<void> {
  for (const link of links) delete link.href;
  const routes = routesIn(locale);
  for (const [target, group = []] of Object.entries(groupBy(links, (link) => link.collection))) {
    const route = routes.find((entry) => entry.collection === target);
    if (isUndefined(route)) continue;
    const paths = await readPaths(route, uniqueArray(group.map((link) => link.record)));
    for (const link of group) {
      const path = paths.get(link.record);
      if (!isUndefined(path)) link.href = link.hash ? `${path}#${link.hash}` : path;
    }
  }
}

/**
 * The site paths of the `ids` the reader may read under `route`, keyed by `UUID`.
 * Only a route with a param reads `slug`, since a collection behind a static route may have none.
 */
async function readPaths(route: CMSRoute, ids: string[]): Promise<Map<string, string>> {
  const dynamic = route.match.params.length > 0;
  const records = await readScoped(
    route.collection,
    ids,
    route.locale,
    dynamic ? ['UUID', 'slug'] : ['UUID'],
  );
  const paths = new Map<string, string>();
  for (const record of records) {
    const path = routePath(route, isString(record.slug) ? record.slug : undefined);
    if (!isUndefined(path)) paths.set(record.UUID as string, path);
  }
  return paths;
}

/**
 * The `UUID`s a relation value holds: one for a `record`, a list for `records`.
 */
function idsOf(value: unknown): string[] {
  if (isString(value)) return [value];
  return isArray(value) ? value.filter(isString) : [];
}

/**
 * Reads the `ids` of `target` the reader may see, keyed by `UUID`.
 */
async function readTargets(
  target: string,
  ids: string[],
  locale: string,
): Promise<Map<string, QueryRecord>> {
  if (ids.length === 0) return new Map();
  const records =
    target === 'Uploads'
      ? await readPublicUploads(ids, locale)
      : await readScoped(target, ids, locale);
  const route = routesIn(locale).find((entry) => entry.collection === target);
  if (!isUndefined(route)) {
    for (const record of records) {
      const path = routePath(route, isString(record.slug) ? record.slug : undefined);
      if (!isUndefined(path)) record.path = path;
    }
  }
  return new Map(records.map((record) => [record.UUID as string, record]));
}

/**
 * The public files among `ids` in `locale`, with absolute URLs and only `UPLOAD_FIELDS`.
 * The read selects what `decorateUpload` needs to build `url` and `variants` too.
 */
async function readPublicUploads(ids: string[], locale: string): Promise<QueryRecord[]> {
  const shown = [...UPLOAD_FIELDS, 'url', 'variants'];
  const uploads: QueryRecord[] = [];
  for (const batch of chunk(ids, 900)) {
    const found = await queryUntyped('Uploads')
      .locale(locale)
      .select(...UPLOAD_FIELDS, 'kind', 'private', 'directory')
      .where({ UUID: { in: batch }, kind: 'file', private: false })
      .findMany();
    uploads.push(...found.map((upload) => absolutize(pick(upload, shown))));
  }
  return uploads;
}

/**
 * The `ids` of `target` the reader's own read access admits; none when the reader may not read it at all.
 * A non-empty `fields` selects just those, within what the access shows.
 */
async function readScoped(
  target: string,
  ids: string[],
  locale: string,
  fields: readonly string[] = [],
): Promise<QueryRecord[]> {
  const records: QueryRecord[] = [];
  for (const batch of chunk(ids, 900)) {
    const builder = await scopedRead(target, locale, fields);
    if (isUndefined(builder)) return [];
    records.push(...(await builder.where({ UUID: { in: batch } }).findMany()));
  }
  return records;
}

/**
 * Prefixes the upload's root-relative URLs with the API origin, in place, and answers the upload.
 */
function absolutize(upload: QueryRecord): QueryRecord {
  const origin = apiOrigin();
  if (isString(upload.url) && upload.url.startsWith('/')) upload.url = origin + upload.url;
  if (!isPlainObject(upload.variants)) return upload;
  for (const [name, url] of Object.entries(upload.variants)) {
    if (isString(url) && url.startsWith('/')) upload.variants[name] = origin + url;
  }
  return upload;
}

/**
 * Runs `fn` as a visitor without a session, from inside any request.
 * Every access and every `href` then answers as the website reads it.
 * Upload URLs keep the origin the request reached the API at.
 *
 * @example
 * ```ts
 * await asVisitor(() => resolvePath('/about')) // -> the page as a visitor reads it
 * ```
 */
export function asVisitor<R>(fn: () => R): R {
  return origins.run(apiOrigin(), () => runWithoutEvent(fn));
}

/**
 * The origin a site reaches the API at: `API_URL`'s, or the current request's.
 */
function apiOrigin(): string {
  const configured = useEnv().get('API_URL');
  return new URL(configured ?? origins.getStore() ?? useEvent().url).origin;
}
