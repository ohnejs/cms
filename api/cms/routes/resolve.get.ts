import { badRequest, defineHandler, translate, useEvent, useResponse } from 'ohnejs';

import { draftsOf } from '../../../src/preview/drafts.ts';
import { readToken } from '../../../src/preview/tokens.ts';
import { resolvePath } from '../../../src/resolve.ts';

/**
 * Resolves `?path=` to the page it shows, as the caller may read it.
 * A path no page answers is `{ kind: 'notFound' }` with `200`, so a site needs no error handling for it.
 * A live `Ohne-Preview` token lays its editor's unsaved drafts over the saved records.
 * Such an answer is private, never cached, and never indexed.
 */
export default defineHandler(async () => {
  const { url, request } = useEvent();
  const path = url.searchParams.get('path');
  if (path === null || !path.startsWith('/')) throw badRequest(translate('cms.api.invalidPath'));
  const headers = useResponse().headers;
  headers.append('vary', 'Ohne-Preview');
  const raw = request.headers.get('ohne-preview');
  const token = raw === null ? undefined : await readToken(raw);
  if (token === undefined) return resolvePath(path);
  headers.set('cache-control', 'private, no-store');
  headers.set('x-robots-tag', 'noindex');
  return resolvePath(path, await draftsOf(token));
});
