import { hook, usePrinter } from 'ohnejs';
import { hmac } from 'ohnejs/utils/crypto';

import { useCMSConfig } from './config.ts';

/**
 * Tells every `cms.webhooks` URL about a committed change to a page, the site settings, or a redirect.
 * The body is `{ event, collection, uuids, at }`; `Ohne-Signature: t=<seconds>,v1=<HMAC>` signs `t.body`.
 * A failed delivery is reported and not retried.
 */
export function watchWebhooks(): void {
  hook('record:committed', ({ collection, operation, uuids }) => {
    const { routes, webhooks } = useCMSConfig();
    if (webhooks.length === 0) return;
    if (!Object.hasOwn(routes, collection) && collection !== 'Site' && collection !== 'Redirects') {
      return;
    }
    const body = JSON.stringify({ event: operation, collection, uuids, at: Date.now() });
    const t = Math.floor(Date.now() / 1000);
    for (const { url, secret } of webhooks) {
      void fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'ohne-signature': `t=${t},v1=${hmac(`${t}.${body}`, secret)}`,
        },
        body,
      })
        .then((response) => {
          if (!response.ok) usePrinter().warn(`Webhook \`${url}\` answered \`${response.status}\``);
        })
        .catch(() => usePrinter().warn(`Webhook \`${url}\` could not be reached`));
    }
  });
}
