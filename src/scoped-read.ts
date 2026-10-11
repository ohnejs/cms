import { queryMetadata, queryUntyped } from 'ohnejs';
import { readScope } from 'ohnejs/auth';
import { intersection, isUndefined } from 'ohnejs/utils';

/**
 * A read of `collection` as the reader's read access admits it, or `undefined` when the reader may read none.
 * The access's `where` and `select` carry; its `limit` and `locale` do not, as a populate composes them.
 * A translatable collection reads in `locale`, as a request's `locale` param wins over the access's.
 * A non-empty `fields` narrows the select, yet never past the fields the access shows.
 *
 * @example
 * ```ts
 * const posts = await scopedRead('Posts', 'de', ['UUID', 'slug'])
 * if (posts === undefined) return []
 * ```
 */
export async function scopedRead(
  collection: string,
  locale: string,
  fields: readonly string[] = [],
): Promise<ReturnType<typeof queryUntyped> | undefined> {
  const scope = await readScope(collection);
  if (scope === false) return undefined;
  const builder = queryUntyped(collection);
  if (!isUndefined(scope.where)) builder.access(scope.where);
  const select = composeFields(fields, scope.select);
  if (select.length > 0) builder.select(...select);
  if (queryMetadata(collection).translatable === true) builder.locale(locale);
  return builder;
}

/**
 * The fields a read selects: the `allowed` ones when it wants none, else their intersection.
 * An empty intersection keeps `allowed`, so a read that wants only withheld fields never widens.
 */
function composeFields(wanted: readonly string[], allowed: string[] | undefined): string[] {
  if (isUndefined(allowed)) return [...wanted];
  if (wanted.length === 0) return allowed;
  const shared = intersection(wanted, allowed);
  return shared.length > 0 ? shared : allowed;
}
