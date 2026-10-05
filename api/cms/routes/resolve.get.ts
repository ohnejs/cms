import { badRequest, defineHandler, translate, useEvent } from 'ohnejs';

import { resolvePath } from '../../../src/resolve.ts';

/**
 * Resolves `?path=` to the page it shows, as the caller may read it.
 * A path no page answers is `{ kind: 'notFound' }` with `200`, so a site needs no error handling for it.
 */
export default defineHandler(async () => {
  const path = useEvent().url.searchParams.get('path');
  if (path === null || !path.startsWith('/')) throw badRequest(translate('cms.api.invalidPath'));
  return resolvePath(path);
});
