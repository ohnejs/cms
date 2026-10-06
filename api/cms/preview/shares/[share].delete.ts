import { defineHandler } from 'ohnejs';

import { revokeShare } from '../../../../src/preview/shares.ts';

/**
 * Revokes a preview link before it expires, answering `204`.
 */
export default defineHandler(async ({ params }): Promise<null> => {
  await revokeShare(params.share ?? '');
  return null;
});
