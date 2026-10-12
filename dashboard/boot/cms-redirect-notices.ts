import { registerRecordNotice } from 'app/components/record-view.ts';

import { replacedRedirect, shadowedRedirect } from '../components/cms-redirect-notices.ts';

registerRecordNotice(replacedRedirect);
registerRecordNotice(shadowedRedirect);
