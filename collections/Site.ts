import type {} from 'ohnejs/uploads';

import { defineCollection, field } from 'ohnejs';

/**
 * The website's own settings: its name, how page titles read, and what a page without its own SEO shows.
 */
export default defineCollection({
  singleton: true,
  api: { read: 'public', update: true },
  dashboard: { icon: 'world' },
  fields: {
    name: field('text', { translatable: true, default: 'Website', label: 'cms.site.name.label' }),
    titleTemplate: field('text', {
      default: '{title} | {site}',
      label: 'cms.site.titleTemplate.label',
      description: 'cms.site.titleTemplate.description',
    }),
    description: field('text', {
      nullable: true,
      multiline: true,
      translatable: true,
      label: 'cms.site.description.label',
    }),
    image: field('image', { label: 'cms.site.image.label' }),
    noindex: field('boolean', {
      default: false,
      display: 'switch',
      label: 'cms.site.noindex.label',
      description: 'cms.site.noindex.description',
    }),
  },
});
