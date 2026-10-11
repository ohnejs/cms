import { defineLayer } from 'ohnejs';
import { mapKeys } from 'ohnejs/utils';

import { CMS_DEFAULTS, CMS_STRATEGIES, cmsTypesPath } from './src/config.ts';
import { reportDegraded, siteTypes } from './src/types/site-types.ts';

export default defineLayer({
  defaults: { cms: CMS_DEFAULTS },
  strategies: mapKeys(CMS_STRATEGIES, (key) => `cms.${key}`),
  codegen: [
    {
      path: cmsTypesPath,
      code: async ({ fresh }) => {
        const { text, degraded } = await siteTypes({ fresh });
        reportDegraded(degraded);
        return text;
      },
    },
  ],
});
