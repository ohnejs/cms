import type { AccessScope } from 'ohnejs';

import { useUser, userCan } from 'ohnejs/auth';
import { hasKey, isNull, isNumber } from 'ohnejs/utils';

/**
 * The read access of a collection with pages: published records, inside their publish window.
 * Such a record's `status` is `published`, its `publishedAt` empty or past, its `expiresAt` empty or future.
 * A user with the `cms.drafts` capability reads every record, drafts included.
 *
 * @example
 * ```ts
 * api: { read: { public: true, access: publishedScope } }
 * ```
 */
export async function publishedScope(): Promise<
  AccessScope<'status' | 'publishedAt' | 'expiresAt'> | true
> {
  const user = await useUser();
  if (!isNull(user) && userCan(user, 'cms.drafts')) return true;
  const now = Date.now();
  return {
    where: {
      status: 'published',
      and: [
        { or: [{ publishedAt: { isNull: true } }, { publishedAt: { atMost: now } }] },
        { or: [{ expiresAt: { isNull: true } }, { expiresAt: { greaterThan: now } }] },
      ],
    },
  };
}

/**
 * Whether a visitor sees `record` at `now` under `publishedScope`, which this rule mirrors.
 * A record without a `status` counts as live, since its collection does not publish.
 *
 * @example
 * ```ts
 * isLive({ status: 'published', publishedAt: null }) // -> true
 * isLive({ status: 'draft' })                        // -> false
 * isLive({ title: 'Notes' })                         // -> true
 * ```
 */
export function isLive(record: Readonly<Record<string, unknown>>, now = Date.now()): boolean {
  if (!hasKey(record, 'status')) return true;
  const { status, publishedAt, expiresAt } = record;
  return (
    status === 'published' &&
    !(isNumber(publishedAt) && publishedAt > now) &&
    !(isNumber(expiresAt) && expiresAt <= now)
  );
}
