import { defineHandler, isFresh, sendNotModified, useResponse } from 'ohnejs';
import { etag } from 'ohnejs/utils/etag';

import { siteTypes } from '../../src/types/site-types.ts';

let text: string | undefined;

/**
 * Serves the types a website imports, describing what an anonymous reader resolves.
 * It is public like the pages it describes.
 * Shadow this file in a closer layer and add `requireUser()` when your pages are not public.
 */
export default defineHandler(async () => {
  text ??= (await siteTypes()).text;
  useResponse().headers.set('etag', etag(text));
  if (isFresh()) return sendNotModified();
  return new Response(text, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' },
  });
});
