import { defineMigration } from 'ohnejs';

export default defineMigration({
  from: null,
  to: { collection: 'Site', field: 'autoRedirect' },
  transform: () => true,
});
