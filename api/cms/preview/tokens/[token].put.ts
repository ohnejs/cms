import { defineHandler, readJSONBody, useResponse } from 'ohnejs';
import { isPlainObject, isString } from 'ohnejs/utils';

import { draftsOf, writeDraft } from '../../../../src/preview/drafts.ts';
import { ownToken } from '../../../../src/preview/tokens.ts';
import { asVisitor } from '../../../../src/relations.ts';
import { resolvePath } from '../../../../src/resolve.ts';

/**
 * Stores the editor's unsaved state of a record under their token.
 * It answers the page at the body's `path` as the website now sees it, so the editor can push it straight in.
 */
export default defineHandler(async ({ params }) => {
  const token = await ownToken(params.token ?? '');
  const body = await readJSONBody<unknown>();
  await writeDraft(token, body);
  useResponse().headers.set('cache-control', 'private, no-store');
  const path =
    isPlainObject(body) && isString(body.path) && body.path.startsWith('/') ? body.path : undefined;
  if (path === undefined) return { kind: 'notFound' };
  const drafts = await draftsOf(token);
  return asVisitor(() => resolvePath(path, drafts));
});
