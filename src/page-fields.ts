import type {} from 'ohnejs/uploads';

import { field, useConfig } from 'ohnejs';
import { canonicalizeLanguage, fitsRoute, isUndefined } from 'ohnejs/utils';

import { routeEntries, useCMSConfig } from './config.ts';

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
 * The fields a collection with pages carries: `slug`, `status`, `publishedAt`, `expiresAt`, and `seo`.
 * Spread them into `fields`, and read the collection through `publishedScope`.
 * A slug is unique per locale when translatable, and per collection otherwise.
 * It must fit every route it renders through: its own locale's when translatable, else every locale's.
 * So it holds `/` only where each such route ends in `[...slug]`.
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
      nested: true,
      validators: [
        (value, ctx) =>
          fits(value, ctx.collection, translatable ? ctx.locale : undefined)
            ? undefined
            : 'cms.validation.slugNested',
      ],
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
    seo: field('object', {
      translatable,
      nullable: true,
      label: 'cms.fields.seo.label',
      fields: {
        title: field('text', { nullable: true, label: 'cms.fields.seo.title.label' }),
        description: field('text', {
          nullable: true,
          multiline: true,
          label: 'cms.fields.seo.description.label',
        }),
        image: field('image', { label: 'cms.fields.seo.image.label' }),
        noindex: field('boolean', {
          default: false,
          display: 'switch',
          label: 'cms.fields.seo.noindex.label',
          description: 'cms.fields.seo.noindex.description',
        }),
      },
    }),
  };
}

/**
 * Whether `slug` fits every route of `collection` it renders through: `locale`'s alone when given, else all.
 * The write carries `locale` canonical, so each configured tag is compared in its canonical form.
 * Without such a route it has no address to fit, so it only keeps out of `/`.
 */
function fits(slug: string, collection: string, locale: string | undefined): boolean {
  const value = useCMSConfig().routes[collection];
  const patterns = isUndefined(value)
    ? []
    : routeEntries(value, useConfig().collections.locales)
        .filter(([code]) => isUndefined(locale) || canonicalizeLanguage(code) === locale)
        .map(([, pattern]) => pattern);
  if (patterns.length === 0) return !slug.includes('/');
  return patterns.every((pattern) => fitsRoute(pattern, { slug }));
}
