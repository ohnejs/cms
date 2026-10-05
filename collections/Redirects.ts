import { defineCollection, field } from 'ohnejs';

/**
 * Paths that send a visitor elsewhere, checked before any page.
 */
export default defineCollection({
  api: { read: true, create: true, update: true, delete: true },
  dashboard: {
    icon: 'arrow-forward-up',
    recordLabel: 'from',
    table: { columns: ['from', 'to', 'code'] },
  },
  fields: {
    from: field('text', {
      unique: true,
      label: 'cms.redirects.from.label',
      description: 'cms.redirects.from.description',
      sanitizers: [(value) => (value.length > 1 ? value.replace(/\/+$/, '') : value)],
      validators: [(value) => (value.startsWith('/') ? undefined : 'cms.validation.path')],
    }),
    to: field('text', {
      label: 'cms.redirects.to.label',
      description: 'cms.redirects.to.description',
      validators: [
        (value) =>
          value.startsWith('/') || URL.canParse(value) ? undefined : 'cms.validation.target',
      ],
    }),
    code: field('select', {
      choices: [
        { value: '301', label: 'cms.redirects.code.301' },
        { value: '302', label: 'cms.redirects.code.302' },
        { value: '307', label: 'cms.redirects.code.307' },
        { value: '308', label: 'cms.redirects.code.308' },
      ],
      default: '301',
      label: 'cms.redirects.code.label',
    }),
    forwardQuery: field('boolean', {
      default: false,
      label: 'cms.redirects.forwardQuery.label',
      description: 'cms.redirects.forwardQuery.description',
    }),
  },
});
