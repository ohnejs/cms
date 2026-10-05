import { defineLayer } from 'ohnejs';
import { mapKeys } from 'ohnejs/utils';

import { CMS_DEFAULTS, CMS_STRATEGIES } from './src/config.ts';

export default defineLayer({
  defaults: { cms: CMS_DEFAULTS },
  strategies: mapKeys(CMS_STRATEGIES, (key) => `cms.${key}`),
});
