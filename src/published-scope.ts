import type { AccessScope } from 'ohnejs';

import { useUser, userCan } from 'ohnejs/auth';

/**
 * The read access of a collection with pages: published records, inside their publish window.
 * A record is published when its `status` is `published`, `publishedAt` is empty or past, and `expiresAt` empty or future.
 * A user with the `cms.drafts` capability reads every record, drafts included.
 *
 * @example
 * ```ts
 * api: { read: { public: true, access: publishedScope } }
 * ```
 */
export async function publishedScope(): Promise<AccessScope | true> {
  const user = await useUser();
  if (user !== null && userCan(user, 'cms.drafts')) return true;
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
