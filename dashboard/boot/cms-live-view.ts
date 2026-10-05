import { registerRecordView } from 'app/components/record-view.ts';

import { liveView } from '../components/cms-live-view.ts';
import { hasPages } from '../components/cms-meta.ts';

registerRecordView((collection) => (hasPages(collection) ? liveView : undefined));
