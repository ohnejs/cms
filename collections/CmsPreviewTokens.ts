import { defineCollection, field } from 'ohnejs';

/**
 * The preview tokens editors frame their website with, one per open live editor.
 * A token lives as long as its login session, eight hours at most; only its hash is stored.
 * It has no API, so it never shows in the dashboard.
 */
export default defineCollection({
  fields: {
    tokenHash: field('text', { unique: true }),
    session: field('text', { index: true }),
    expiresAt: field('dateTime', { index: true }),
  },
});
