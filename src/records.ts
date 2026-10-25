import type {
  HTTPError,
  QueryRecord,
  QueryScope,
  UntypedQueryBuilder,
  WireErrorData,
} from 'ohnejs';
import type { SearchParamValue } from 'ohnejs/utils';

import {
  applyQuery,
  badRequest,
  notFound,
  parseWireQuery,
  queryMetadata,
  queryUntyped,
  resolveGuards,
  scopedMetadata,
  translate,
  useConfig,
  useSearchParams,
} from 'ohnejs';
import { readReach } from 'ohnejs/auth';
import {
  canonicalizeLanguage,
  isNull,
  isString,
  isUndefined,
  omit,
  uniqueArray,
} from 'ohnejs/utils';

import { loadRelations } from './relations.ts';
import { setPaths } from './routes.ts';

/**
 * One page of a collection's records, with what a pager needs.
 */
export type RecordPage = Awaited<ReturnType<UntypedQueryBuilder['paginate']>>;

/**
 * The params a list takes.
 */
const LIST_PARAMS = ['where', 'order', 'select', 'page', 'perPage', 'locale'];

/**
 * The params a singleton or a read by `UUID` takes.
 */
const RECORD_PARAMS = ['select', 'locale'];

/**
 * The page size a list takes when the request names none.
 */
const PER_PAGE = 20;

/**
 * Reads a collection as its REST read admits the caller: a singleton's record, or one page of a list.
 * Exposure, guard, read middleware and `access` all apply, so a visitor reads published records only.
 * An unknown, closed or refused collection, and `Uploads`, answer the identical `404`.
 * A list takes `where`, `order`, `select`, `page`, `perPage` and `locale`; a singleton `select` and `locale`.
 * Any other param is a `400`, and `perPage` stops at `100`.
 * Every record loads as `resolve` loads a page: relations one level deep, uploads absolute, links with `href`.
 * A routed record carries its `path` in the read's locale, and its `UUID`, whatever `select` names.
 */
export async function readRecords(collection: string): Promise<QueryRecord | RecordPage> {
  const scope = await reachOf(collection);
  if (queryMetadata(collection).singleton === true) {
    const read = await prepare(collection, scope, RECORD_PARAMS);
    return finish(read, await read.builder.findFirst());
  }
  const read = await prepare(collection, scope, LIST_PARAMS);
  const page = await read.builder.paginate(read.page ?? 1, read.perPage ?? PER_PAGE);
  await read.load(page.records);
  return page;
}

/**
 * Reads the record `uuid` of a collection as `readRecords` reads a singleton, or answers `404`.
 */
export async function readRecord(collection: string, uuid: string): Promise<QueryRecord> {
  const scope = await reachOf(collection);
  const read = await prepare(collection, scope, RECORD_PARAMS);
  return finish(read, await read.builder.where({ UUID: uuid }).findFirst());
}

/**
 * A prepared read: its builder, its requested window, and how its records load.
 */
interface Read {
  builder: UntypedQueryBuilder;
  page: number | null;
  perPage: number | null;
  load(records: QueryRecord[]): Promise<void>;
}

/**
 * The caller's read scope of `collection`, or a `404` when the caller may read none of it.
 */
async function reachOf(collection: string): Promise<QueryScope> {
  const scope = collection === 'Uploads' ? false : await readReach(collection);
  if (scope === false) throw notFound();
  return scope;
}

/**
 * Parses the request's params against the scope and builds the read they ask for.
 * `UUID`, and `slug` for a `path`, join a narrowed `select`; a `slug` the request did not name leaves again.
 * `UUID` joins even past an access that withholds it, so every record names itself.
 */
async function prepare(
  collection: string,
  scope: QueryScope,
  allowed: readonly string[],
): Promise<Read> {
  const params = useSearchParams();
  for (const param of Object.keys(params)) {
    if (!allowed.includes(param)) throw unsupportedParam(param);
  }
  const meta = queryMetadata(collection);
  const locale = readLocale(params.locale, scope);
  const parsed = await parseWireQuery(
    omit(params, ['locale']),
    scopedMetadata(meta, scope),
    resolveGuards({ maxPerPage: 100, maxLimit: 100 }),
    readReach,
  );
  const slugged = !isUndefined(meta.fields.slug);
  const select = isNull(parsed.select)
    ? null
    : uniqueArray([...parsed.select, 'UUID', ...(slugged ? ['slug'] : [])]);
  const hidden = !isNull(parsed.select) && !parsed.select.includes('slug');
  const shown = isUndefined(scope.select)
    ? scope
    : { ...scope, select: uniqueArray([...scope.select, 'UUID']) };
  const builder = applyQuery(queryUntyped(collection), { ...parsed, select }, shown);
  if (meta.translatable === true) builder.locale(locale);
  return {
    builder,
    page: parsed.page,
    perPage: parsed.perPage,
    async load(records) {
      await loadRelations(records, collection, locale);
      setPaths(records, collection, locale);
      if (hidden) for (const record of records) delete record.slug;
    },
  };
}

/**
 * Loads a read's one record, or answers `404` when the caller sees none.
 */
async function finish(read: Read, record: QueryRecord | undefined): Promise<QueryRecord> {
  if (isUndefined(record)) throw notFound();
  await read.load([record]);
  return record;
}

/**
 * The locale a read loads in: the request's, else the scope's, else the default.
 * Every collection takes it, since paths and relations read in it even where no field is translatable.
 */
function readLocale(value: SearchParamValue | undefined, scope: QueryScope): string {
  const { locales, defaultLocale } = useConfig().collections;
  if (isUndefined(value)) return scope.locale ?? defaultLocale;
  const canonical = isString(value) ? canonicalizeLanguage(value) : null;
  if (isNull(canonical) || !(locales as readonly string[]).includes(canonical)) {
    const data: WireErrorData = { code: 'invalidLocale', path: 'locale' };
    throw badRequest(translate('query.invalidLocale', { locale: String(value) }), data);
  }
  return canonical;
}

/**
 * A param the read does not take, with the wire's own error code.
 */
function unsupportedParam(param: string): HTTPError {
  const data: WireErrorData = { code: 'unknownParam', path: param };
  return badRequest(translate('cms.api.unsupportedParam', { param }), data);
}
