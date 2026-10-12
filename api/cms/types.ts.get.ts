import { defineHandler, isFresh, sendNotModified, useConfig, useResponse } from 'ohnejs';
import { isUndefined } from 'ohnejs/utils';
import { etag } from 'ohnejs/utils/etag';

import { siteTypes } from '../../src/types/site-types.ts';

const texts = new WeakMap<object, string>();

/**
 * Serves the types a website imports, describing what an anonymous reader resolves.
 * It is public like the pages it describes, and renders once per resolved config.
 * Shadow this file in a closer layer and add `requireUser()` when your pages are not public.
 */
export default defineHandler(async () => {
  const config = useConfig();
  let text = texts.get(config);
  if (isUndefined(text)) {
    text = (await siteTypes()).text;
    texts.set(config, text);
  }
  useResponse().headers.set('etag', etag(text));
  if (isFresh()) return sendNotModified();
  return new Response(text, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' },
  });
});
