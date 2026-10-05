import { hook } from 'ohnejs';

import { validateCMSConfig } from '../src/config.ts';

// Routes name collections, which register after the boot files run.
hook('schema:synced', validateCMSConfig);
