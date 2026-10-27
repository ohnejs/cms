import { isLocalPath } from 'ohnejs/utils';

/**
 * A redirect's `from` as a request's path reaches it: percent-encoded, without a trailing slash.
 * A value that is no plain local path, like one with a `?` or a `#`, comes back unchanged.
 *
 * @example
 * ```ts
 * sitePath('/über/')    // -> '/%C3%BCber'
 * sitePath('/old page') // -> '/old%20page'
 * sitePath('/a?b=1')    // -> '/a?b=1'
 * sitePath('//evil')    // -> '//evil'
 * ```
 */
export function sitePath(value: string): string {
  if (!isLocalPath(value) || /[?#]/.test(value)) return value;
  const { pathname } = new URL(value, 'http://site');
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}
