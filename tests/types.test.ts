import { defineCollection, field } from 'ohnejs';
import { queryScoped } from 'ohnejs/auth';

import { pageFields, publishedScope } from '../src/index.ts';

/**
 * Compile-time assertions for the cms surface an app types against, checked by `tsc` and never executed.
 */
export async function assertTypes(name: string): Promise<void> {
  defineCollection({
    fields: { title: field('text'), ...pageFields() },
    api: { read: { public: true, access: publishedScope } },
  });
  defineCollection({
    fields: { title: field('text') },
    // @ts-expect-error - the scope filters fields this collection lacks
    api: { read: { public: true, access: publishedScope } },
  });
  await queryScoped(name, 'read');
  await queryScoped('CMSShares', 'read');
  // @ts-expect-error - no such collection
  await queryScoped('CMSShraes', 'read');
}
