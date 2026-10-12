import { badRequest, defineHandler, forbidden, runWithoutEvent, translate, useEvent } from 'ohnejs';
import { readReach } from 'ohnejs/auth';
import { isNull } from 'ohnejs/utils';

import { resolvePath } from '../../../src/resolve.ts';

/**
 * Whether a page a visitor sees answers at `?path=`, which leaves a redirect from that path inactive.
 * It answers `{ shadowed }` to a caller who may read redirects, and refuses everyone else.
 * The page is read as a visitor reads it, with no drafts and no read middleware.
 */
export default defineHandler(async () => {
  const path = useEvent().url.searchParams.get('path');
  if (isNull(path) || !path.startsWith('/')) throw badRequest(translate('cms.api.invalidPath'));
  if ((await readReach('Redirects')) === false) throw forbidden();
  const answer = await runWithoutEvent(() => resolvePath(path));
  return { shadowed: answer.kind === 'page' };
});
