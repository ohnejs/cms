import { defineHandler, useEvent } from 'ohnejs';

import { sharesOf } from '../../../src/preview/shares.ts';

/**
 * Lists the live preview links of the record at `?collection=&record=`, newest first.
 */
export default defineHandler(() => {
  const { searchParams } = useEvent().url;
  return sharesOf(searchParams.get('collection'), searchParams.get('record'));
});
