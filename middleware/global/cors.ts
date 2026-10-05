import { cors, defineMiddleware, type Middleware, useEvent } from 'ohnejs';
import { dashboardOrigin } from 'ohnejs/base';
import { isUndefined } from 'ohnejs/utils';

import { useCMSConfig } from '../../src/config.ts';

let dashboard: Middleware | null = null;
let site: Middleware | null = null;

/**
 * Allows the dashboard origin credentialed requests, as the base layer does, and the website origin plain ones.
 * The website reads pages from the browser without a cookie, so it can never act as a signed-in user.
 * Shadow this file in a closer layer to change the policy, and keep both origins.
 *
 * The policies are built on the first request, once the layer stack has resolved the config.
 */
export default defineMiddleware((event) => {
  const origin = dashboardOrigin();
  dashboard ??= cors({ origin, credentials: true, exposeHeaders: ['Retry-After'] });
  site ??= siteCORS();
  return useEvent().request.headers.get('origin') === origin ? dashboard(event) : site(event);
});

/**
 * The credential-free policy for the website origin, or one that admits nobody when no site is set.
 */
function siteCORS(): Middleware {
  const { site } = useCMSConfig();
  return cors({ origin: isUndefined(site) ? [] : new URL(site).origin });
}
