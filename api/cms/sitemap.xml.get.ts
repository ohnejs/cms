import { defineHandler } from 'ohnejs';

import { sitemap } from '../../src/sitemap.ts';

/**
 * The website's sitemap, for the website to serve at `/sitemap.xml`.
 */
export default defineHandler(async () => {
  return new Response(await sitemap(), {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
});
