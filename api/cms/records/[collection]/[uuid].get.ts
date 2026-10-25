import { defineHandler } from 'ohnejs';

import { readRecord } from '../../../../src/records.ts';

/**
 * Reads one record by its `UUID` as a visitor reads it, or answers `404` when the caller may not see it.
 */
export default defineHandler(({ params }) =>
  readRecord(params.collection ?? '', params.uuid ?? ''),
);
