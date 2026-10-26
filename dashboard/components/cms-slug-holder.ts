import type { DashboardCollection } from 'ohnejs/dashboard';

import { fallbackLabel, joinLabel, useResource } from 'ohnejs/dashboard';
import { debounce, effect, isUndefined, onCleanup, recordHref, ref, untracked } from 'ohnejs/utils';

const SETTLE_DELAY = 250;

/**
 * The record that holds an address, as the editor names and links it.
 */
export interface SlugHolder {
  /**
   * The record's label, or its short id when it has none.
   */
  title: string;

  /**
   * The record's page in the dashboard, in the locale it holds the address in.
   */
  href: string;
}

/**
 * The record of `collection` that holds `slug` in `locale`, asked once the typing settles.
 * It is `null` without a slug, when no record holds it, or when the viewer may not read the one that does.
 * It is `undefined` while the answer for the newest slug is on its way.
 * Without `locale`, the slug is one every locale shares.
 * Callers that ask for the same slug share one request.
 */
export function slugHolder(
  collection: DashboardCollection,
  locale: () => string | undefined,
  slug: () => string | undefined,
): () => SlugHolder | null | undefined {
  const settled = ref(untracked(slug));
  const settle = debounce((next: string | undefined) => {
    settled.value = next;
  }, SETTLE_DELAY);
  effect(() => {
    const next = slug();
    if (next === untracked(() => settled.value)) settle.cancel();
    else settle(next);
  });
  onCleanup(settle.cancel);

  const scoped = (): { locale?: string } => {
    const scope = locale();
    return isUndefined(scope) ? {} : { locale: scope };
  };
  const answer = useResource<{ records: Record<string, unknown>[] }>(
    'POST /collections/[collection]/query',
    {
      params: { collection: collection.segment },
      body: () =>
        isUndefined(settled.value)
          ? undefined
          : {
              where: { slug: settled.value },
              select: ['UUID', ...collection.labelFields],
              perPage: 1,
              ...scoped(),
            },
    },
  );

  return () => {
    const current = slug();
    if (isUndefined(current)) return null;
    if (current !== settled.value) return undefined;
    const state = answer.state();
    if (state === 'error' || state === 'forbidden') return null;
    const records = answer.stale() ? undefined : answer()?.records;
    if (isUndefined(records)) return undefined;
    const row = records[0];
    if (isUndefined(row)) return null;
    const uuid = String(row.UUID);
    return {
      title: joinLabel(row, collection) || fallbackLabel(uuid),
      href: recordHref(collection, uuid, scoped()),
    };
  };
}
