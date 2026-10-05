import type { FieldQueryMeta, QueryRecord } from 'ohnejs';

import {
  blockQueryMetadata,
  HTTPError,
  queryMetadata,
  queryUntyped,
  useEnv,
  useEvent,
} from 'ohnejs';
import { queryScoped } from 'ohnejs/auth';
import { isArray, isPlainObject, isString, isUndefined } from 'ohnejs/utils';

import { routePath, routesIn } from './routes.ts';

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
 * Upload URLs become absolute, so a site on another origin can show them.
 * A loaded record of a collection with pages carries its `path`, so a site links to it.
 * The loaded records keep their own relations as `UUID`s.
 */
export async function loadRelations(
  record: QueryRecord,
  collection: string,
  locale: string,
): Promise<void> {
  const slots: Slot[] = [];
  collect(record, queryMetadata(collection).fields, slots);
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
  for (const { holder, key, target, many } of slots) {
    const records = loaded.get(target) ?? new Map<string, QueryRecord>();
    const value = holder[key];
    holder[key] = many
      ? idsOf(value).flatMap((id) => records.get(id) ?? [])
      : (records.get(isString(value) ? value : '') ?? null);
  }
}

/**
 * Records every relation slot under `value`, descending into blocks and child tables.
 */
function collect(
  value: Record<string, unknown>,
  fields: Readonly<Record<string, FieldQueryMeta>>,
  slots: Slot[],
): void {
  for (const [key, meta] of Object.entries(fields)) {
    const held = value[key];
    if ((meta.kind === 'record' || meta.kind === 'records') && !isUndefined(meta.target)) {
      if (!isUndefined(held))
        slots.push({ holder: value, key, target: meta.target, many: meta.kind === 'records' });
    } else if (meta.kind === 'blocks') {
      for (const item of isArray(held) ? held : []) {
        if (!isPlainObject(item) || !isString(item.block) || !isPlainObject(item.fields)) continue;
        collect(item.fields, blockQueryMetadata(item.block).fields, slots);
      }
    } else if (
      (meta.kind === 'childOne' || meta.kind === 'childMany') &&
      !isUndefined(meta.subfields)
    ) {
      for (const item of isArray(held) ? held : [held]) {
        if (isPlainObject(item)) collect(item, meta.subfields, slots);
      }
    }
  }
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
    target === 'Uploads' ? await readPublicUploads(ids) : await readScoped(target, ids, locale);
  const route = routesIn(locale).find((entry) => entry.collection === target);
  if (!isUndefined(route)) {
    for (const record of records) {
      if (route.match.params.length === 0 || isString(record.slug)) {
        record.path = routePath(route, isString(record.slug) ? record.slug : undefined);
      }
    }
  }
  return new Map(records.map((record) => [record.UUID as string, record]));
}

/**
 * The public uploads among `ids`, with absolute URLs.
 */
async function readPublicUploads(ids: string[]): Promise<QueryRecord[]> {
  const uploads = await queryUntyped('Uploads')
    .where({ UUID: { in: ids }, private: false })
    .findMany();
  for (const upload of uploads) absolutize(upload);
  return uploads;
}

/**
 * The `ids` of `target` the reader's own read access admits; none when the reader may not read it at all.
 */
async function readScoped(target: string, ids: string[], locale: string): Promise<QueryRecord[]> {
  let builder;
  try {
    builder = await queryScoped(target, 'read');
  } catch (error) {
    if (error instanceof HTTPError) return [];
    throw error;
  }
  if (queryMetadata(target).translatable === true) builder.locale(locale);
  return builder.where({ UUID: { in: ids } }).findMany();
}

/**
 * Prefixes the upload's root-relative URLs with the API origin.
 */
function absolutize(upload: QueryRecord): void {
  const origin = apiOrigin();
  if (isString(upload.url) && upload.url.startsWith('/')) upload.url = origin + upload.url;
  if (!isPlainObject(upload.variants)) return;
  for (const [name, url] of Object.entries(upload.variants)) {
    if (isString(url) && url.startsWith('/')) upload.variants[name] = origin + url;
  }
}

/**
 * The origin a site reaches the API at: `API_URL`'s, or the current request's.
 */
function apiOrigin(): string {
  const configured = useEnv().get('API_URL');
  return new URL(configured ?? useEvent().url).origin;
}
