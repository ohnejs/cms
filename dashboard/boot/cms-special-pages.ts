import { registerDeleteNotice, registerRecordNotice } from 'app/components/record-view.ts';
import { registerFieldType } from 'ohnejs/dashboard';

import { pageSlugType } from '../components/cms-page-slug.ts';
import { missingHome, specialPageDeleteNotice } from '../components/cms-special-pages.ts';

registerFieldType('pageSlug', pageSlugType);
registerRecordNotice(missingHome);
registerDeleteNotice(specialPageDeleteNotice);
