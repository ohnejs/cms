import { isFetchableURL, isLocalPath, isNull, isSafeHref } from 'ohnejs/utils';

/**
 * Whether a redirect may send a visitor to `value`: a path on the site, or an `http:` or `https:` URL.
 * Any other scheme, like `javascript:`, would run or open something in the browser instead of a page.
 *
 * @example
 * ```ts
 * isRedirectTarget('/new?a=1')            // -> true
 * isRedirectTarget('https://x.y/a')       // -> true
 * isRedirectTarget('javascript:alert(1)') // -> false
 * isRedirectTarget('mailto:a@b.c')        // -> false
 * isRedirectTarget('//evil.com')          // -> false
 * ```
 */
export function isRedirectTarget(value: string): boolean {
  const url = URL.parse(value);
  return isSafeHref(value) && (isLocalPath(value) || (!isNull(url) && isFetchableURL(url)));
}
