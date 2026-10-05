import { readFile } from 'node:fs/promises';
import { defineHandler } from 'ohnejs';
import { dashboardOrigin } from 'ohnejs/base';

const SOURCE = new URL('../../preview/browser.js', import.meta.url);

let source: string | undefined;

/**
 * Serves the preview script a framed website loads, with the dashboard origin written in.
 * It is the only window the script trusts, so a site never names it itself.
 */
export default defineHandler(async () => {
  source ??= await readFile(SOURCE, 'utf8');
  const body = source.replace("'__OHNE_DASHBOARD_ORIGIN__'", JSON.stringify(dashboardOrigin()));
  return new Response(body, {
    headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' },
  });
});
