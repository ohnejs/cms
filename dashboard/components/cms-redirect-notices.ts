import type { RecordEditor } from 'app/components/record-editor.ts';
import type { Child } from 'ohnejs/dashboard';

import { effectiveContentLocale } from 'app/components/content-language-switcher.ts';
import { dashboardMeta, note, useResource } from 'ohnejs/dashboard';
import { isString, isUndefined } from 'ohnejs/utils';

import { hasPages, pagePath } from './cms-meta.ts';

/**
 * On a saved page, the redirect from its path that the page replaces while it is live.
 * A user who may not read redirects sees none.
 */
export function replacedRedirect(editor: RecordEditor): Child {
  if (!hasPages(editor.collection) || editor.create) return null;
  const segment = dashboardMeta()?.collections.find((entry) => entry.name === 'Redirects')?.segment;
  if (isUndefined(segment)) return null;
  const redirects = useResource<{ records: Record<string, unknown>[] }>(
    'POST /collections/[collection]/query',
    {
      params: { collection: segment },
      body: () => {
        const from = pagePath(editor.collection, effectiveContentLocale(), editor.saved());
        return isUndefined(from) ? undefined : { where: { from }, perPage: 1 };
      },
    },
  );
  return () => {
    const row = redirects.stale() ? undefined : redirects()?.records[0];
    if (isUndefined(row)) return null;
    return note(
      { key: 'cms.liveView.replacesRedirect', params: { from: row.from, to: row.to } },
      { icon: 'arrow-forward-up' },
    );
  };
}

/**
 * On a saved redirect, whether a live page answers at its `from`, which leaves the redirect inactive.
 * The check reads the site as a visitor does, so a draft never counts.
 */
export function shadowedRedirect(editor: RecordEditor): Child {
  if (editor.collection.name !== 'Redirects' || editor.create) return null;
  const from = (): string | undefined => {
    const value = editor.saved().from;
    return isString(value) ? value : undefined;
  };
  const answer = useResource<{ shadowed: boolean }>('GET /cms/redirects/shadowed', {
    query: () => {
      const path = from();
      return isUndefined(path) ? undefined : { path };
    },
  });
  return () => {
    if (answer.stale() || answer()?.shadowed !== true) return null;
    return note({ key: 'cms.redirects.inactive', params: { from: from() } }, { icon: 'eye-off' });
  };
}
