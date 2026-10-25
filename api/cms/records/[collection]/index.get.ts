import { defineHandler } from 'ohnejs';

import { readRecords } from '../../../../src/records.ts';

/**
 * Reads a collection as a visitor reads it: a singleton's record, or one page of its records.
 * The page is `{ records, total, page, perPage, lastPage }`, `20` records unless `perPage` says otherwise.
 * An unknown collection, one the caller may not read, and `Uploads` answer the identical `404`.
 */
export default defineHandler(({ params }) => readRecords(params.collection ?? ''));
