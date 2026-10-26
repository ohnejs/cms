import { badRequest, defineHandler, translate, useEvent } from 'ohnejs';
import { readReach } from 'ohnejs/auth';
import { isNull } from 'ohnejs/utils';

import { asVisitor } from '../../../src/relations.ts';
import { resolvePath } from '../../../src/resolve.ts';

/**
 * Whether a visitor sees a page at `?path=`, with no drafts and no read middleware.
 * Unlike `/cms/redirects/shadowed`, a miss that carries the `404` page is no page.
 * It answers `{ live }`, always `false` to a caller who may not read the page's collection.
 */
export default defineHandler(async () => {
  const path = useEvent().url.searchParams.get('path');
  if (isNull(path) || !path.startsWith('/')) throw badRequest(translate('cms.api.invalidPath'));
  const answer = await asVisitor(() => resolvePath(path));
  return { live: answer.kind === 'page' && (await readReach(answer.collection)) !== false };
});
