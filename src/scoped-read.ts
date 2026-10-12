import type { QueryScope } from 'ohnejs';

import { HTTPError, queryMetadata, queryUntyped } from 'ohnejs';
import { readReach } from 'ohnejs/auth';
import { intersection, isUndefined } from 'ohnejs/utils';

/**
 * A read of `collection` as the reader's read access admits it, or `undefined` when the reader may read none.
 * Its reach is the read's own: the read's middleware run once per request, and one that answers reads none.
 * An `HTTPError` the middleware or access throws reads none too, as the read itself would refuse the reader.
 * The access's `where` and `select` carry; its `limit` and `locale` do not, as a populate composes them.
 * A translatable collection reads in `locale`, as a request's `locale` param wins over the access's.
 * A non-empty `fields` narrows the select, yet never past the fields the access shows.
 * Valid only within a request.
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
  const scope = await reach(collection);
  if (scope === false) return undefined;
  const builder = queryUntyped(collection);
  if (!isUndefined(scope.where)) builder.access(scope.where);
  const select = composeFields(fields, scope.select);
  if (select.length > 0) builder.select(...select);
  if (queryMetadata(collection).translatable === true) builder.locale(locale);
  return builder;
}

/**
 * The reader's read reach into `collection`, where a thrown `HTTPError` reaches nothing.
 * Any other throw propagates, so a misconfigured access stays a `500`.
 */
async function reach(collection: string): Promise<QueryScope | false> {
  try {
    return await readReach(collection);
  } catch (error) {
    if (error instanceof HTTPError) return false;
    throw error;
  }
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
