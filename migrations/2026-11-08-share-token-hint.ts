import { defineMigration } from 'ohnejs';

export default defineMigration({
  from: null,
  to: { collection: 'CMSShares', field: 'tokenHint' },
  transform: () => '',
});
