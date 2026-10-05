import { defineHandler } from 'ohnejs';

import { robots } from '../../src/sitemap.ts';

/**
 * The website's `robots.txt`, for the website to serve at `/robots.txt`.
 */
export default defineHandler(async () => {
  return new Response(await robots(), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
});
