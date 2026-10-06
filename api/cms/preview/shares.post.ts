import { defineHandler, readJSONBody } from 'ohnejs';

import { createShare } from '../../../src/preview/shares.ts';

/**
 * Freezes the editor's unsaved state of a record into a preview link that lasts the body's `duration`.
 * It answers the link's token, which is never shown again.
 */
export default defineHandler(async () => createShare(await readJSONBody<unknown>()));
