import '../fields/_augment.ts';
import { field } from 'ohnejs';

/**
 * Options for `pageFields`.
 */
export interface PageFieldsOptions {
  /**
   * Whether each locale has its own slug, like `/en/about` and `/de/ueber-uns`.
   *
   * @default
   * false
   */
  translatable?: boolean;
}

/**
 * The fields a collection with pages carries: `slug`, `status`, `publishedAt`, and `expiresAt`.
 * Spread them into `fields`, and read the collection through `publishedScope`.
 * A slug is unique per locale when translatable, and per collection otherwise.
 *
 * @example
 * ```ts
 * export default defineCollection({
 *   fields: { title: field('text'), ...pageFields(), content: field('blocks', { allow: ['Hero'] }) },
 *   api: { read: { public: true, access: publishedScope } },
 * })
 * ```
 */
export function pageFields(options: PageFieldsOptions = {}) {
  const translatable = options.translatable === true;
  return {
    slug: field('slug', {
      translatable,
      unique: true,
      uniquePerLocale: translatable,
      label: 'cms.fields.slug.label',
    }),
    status: field('select', {
      choices: [
        { value: 'draft', label: 'cms.fields.status.draft' },
        { value: 'published', label: 'cms.fields.status.published' },
      ],
      default: 'draft',
      label: 'cms.fields.status.label',
    }),
    publishedAt: field('dateTime', {
      nullable: true,
      label: 'cms.fields.publishedAt.label',
      description: 'cms.fields.publishedAt.description',
    }),
    expiresAt: field('dateTime', {
      nullable: true,
      label: 'cms.fields.expiresAt.label',
      description: 'cms.fields.expiresAt.description',
    }),
  };
}
