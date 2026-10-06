import { badRequest, defineHandler, translate, useEvent, useResponse } from 'ohnejs';
import { isNull, isUndefined } from 'ohnejs/utils';

import type { Draft } from '../../../src/preview/drafts.ts';

import { draftsOf } from '../../../src/preview/drafts.ts';
import { readShare } from '../../../src/preview/shares.ts';
import { readToken } from '../../../src/preview/tokens.ts';
import { resolvePath } from '../../../src/resolve.ts';

/**
 * Resolves `?path=` to the page it shows, as the caller may read it.
 * A path no page answers is `{ kind: 'notFound' }` with `200`, so a site needs no error handling for it.
 * A live `Ohne-Preview` token lays its editor's unsaved drafts over the saved records.
 * A shared preview link's token lays the snapshot it froze.
 * Such an answer is private, never cached, and never indexed.
 */
export default defineHandler(async () => {
  const { url, request } = useEvent();
  const path = url.searchParams.get('path');
  if (isNull(path) || !path.startsWith('/')) throw badRequest(translate('cms.api.invalidPath'));
  const headers = useResponse().headers;
  headers.append('vary', 'Ohne-Preview');
  const raw = request.headers.get('ohne-preview');
  const drafts = isNull(raw) ? undefined : await previewDrafts(raw);
  if (isUndefined(drafts)) return resolvePath(path);
  headers.set('cache-control', 'private, no-store');
  headers.set('x-robots-tag', 'noindex');
  return resolvePath(path, drafts);
});

/**
 * The drafts a preview token lays over the saved records, or `undefined` when it is no live token or share.
 */
async function previewDrafts(raw: string): Promise<Draft[] | undefined> {
  const token = await readToken(raw);
  if (!isUndefined(token)) return draftsOf(token);
  const share = await readShare(raw);
  if (isUndefined(share)) return undefined;
  const { collection, record, locale, values } = share;
  return [{ collection, record, locale, values }];
}
