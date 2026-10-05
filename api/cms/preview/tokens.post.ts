import { defineHandler } from 'ohnejs';

import { mintToken } from '../../../src/preview/tokens.ts';

/**
 * Mints a preview token for the signed-in editor, tied to their session.
 */
export default defineHandler(() => mintToken());
