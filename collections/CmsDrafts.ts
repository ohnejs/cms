import { defineCollection, field } from 'ohnejs';

/**
 * The unsaved state of each record an editor has open, kept under that editor's preview token.
 * `record` is the record's `UUID`, or a draft id while it has never been saved.
 * `values` is the form's state as JSON, with every field the public could not read removed.
 */
export default defineCollection({
  fields: {
    tokenHash: field('text', { index: true }),
    collection: field('text'),
    record: field('text'),
    locale: field('text'),
    values: field('text'),
  },
  compositeIndexes: [{ fields: ['tokenHash', 'collection', 'record', 'locale'], unique: true }],
});
