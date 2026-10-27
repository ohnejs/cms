import { isLocalPath, percentDecode, uniqueArray } from 'ohnejs/utils';

/**
 * A site path as redirects store and match it: percent-decoded, without a trailing slash.
 * A value that is no plain local path, like one with a `?` or a `#`, comes back unchanged.
 *
 * @example
 * ```ts
 * sitePath('/über/')     // -> '/über'
 * sitePath('/%C3%BCber') // -> '/über'
 * sitePath('/a?b=1')     // -> '/a?b=1'
 * sitePath('//evil')     // -> '//evil'
 * ```
 */
export function sitePath(value: string): string {
  if (!isLocalPath(value) || /[?#]/.test(value)) return value;
  const { pathname } = new URL(value, 'http://site');
  const path = percentDecode(pathname) ?? pathname;
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/**
 * Every form of a request's path a stored redirect may hold: decoded, and as the request encodes it.
 * A redirect saved before `from` was decoded holds the encoded form.
 *
 * @example
 * ```ts
 * sitePaths('/%C3%BCber/') // -> ['/über', '/%C3%BCber']
 * sitePaths('/about')      // -> ['/about']
 * ```
 */
export function sitePaths(pathname: string): string[] {
  const raw = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return uniqueArray([sitePath(pathname), raw]);
}
