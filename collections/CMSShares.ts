import { defineCollection, field } from 'ohnejs';

/**
 * The preview links editors share, each a snapshot of one record's unsaved state at one path.
 * A link lives until `expiresAt` or until it is revoked, outliving the session that made it.
 * Only its token's hash is stored.
 * `user` is the `UUID` of the editor who made it, and `values` the snapshot as JSON, cleaned as a draft is.
 * It has no API, so it never shows in the dashboard.
 */
export default defineCollection({
  fields: {
    tokenHash: field('text', { unique: true }),
    collection: field('text'),
    record: field('text'),
    locale: field('text'),
    path: field('text'),
    values: field('text'),
    user: field('text'),
    expiresAt: field('dateTime', { index: true }),
  },
  compositeIndexes: [{ fields: ['collection', 'record'] }],
});
