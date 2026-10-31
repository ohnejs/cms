import { queryUntyped, useConfig } from 'ohnejs';
import { escapeXML, isPlainObject, isString, isUndefined } from 'ohnejs/utils';

import { useCMSConfig } from './config.ts';
import { isHome, NOT_FOUND_SLUG, routePath, routesIn } from './routes.ts';
import { scopedRead } from './scoped-read.ts';
import { absolute } from './seo.ts';

/**
 * One page of the sitemap, in every locale it has.
 */
interface Entry {
  updated: number;
  paths: Map<string, string>;
}

/**
 * The sitemap of every page the public may see, one `<url>` per page and locale.
 * A page in several locales lists the others as `hreflang` alternates.
 * Pages marked `noindex`, and the `404` page under `/[...slug]`, stay out.
 * A site under `noindex` lists nothing.
 */
export async function sitemap(): Promise<string> {
  const entries = (await hidden()) ? new Map<string, Entry>() : await collect();
  const urls = [...entries.values()].flatMap((entry) =>
    [...entry.paths.values()].map((path) => {
      const alternates =
        entry.paths.size < 2
          ? ''
          : [...entry.paths]
              .map(
                ([locale, other]) =>
                  `<xhtml:link rel="alternate" hreflang="${escapeXML(locale)}" href="${escapeXML(absolute(other))}"/>`,
              )
              .join('');
      const lastmod = new Date(entry.updated).toISOString();
      return `<url><loc>${escapeXML(absolute(path))}</loc><lastmod>${lastmod}</lastmod>${alternates}</url>`;
    }),
  );
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">' +
    urls.join('') +
    '</urlset>\n'
  );
}

/**
 * Every listed page, keyed by collection and `UUID`, with its path in each locale.
 */
async function collect(): Promise<Map<string, Entry>> {
  const entries = new Map<string, Entry>();
  for (const locale of useConfig().collections.locales) {
    for (const route of routesIn(locale)) {
      for (const record of await readAll(route.collection, locale)) {
        if (isHome(route) && record.slug === NOT_FOUND_SLUG) continue;
        if (isPlainObject(record.seo) && record.seo.noindex === true) continue;
        const path = routePath(route, isString(record.slug) ? record.slug : undefined);
        if (isUndefined(path)) continue;
        const key = `${route.collection}:${record.UUID as string}`;
        const entry = entries.get(key) ?? { updated: 0, paths: new Map() };
        entry.updated = Math.max(entry.updated, Number(record._updatedAt) || 0);
        entry.paths.set(locale, path);
        entries.set(key, entry);
      }
    }
  }
  return entries;
}

/**
 * Every record of `collection` the public may read in `locale`, or none when it may read nothing.
 */
async function readAll(collection: string, locale: string) {
  return (await scopedRead(collection, locale))?.findMany() ?? [];
}

/**
 * The `robots.txt` of the website.
 * It opens everything and names the sitemap, or answers an open file with no sitemap under `noindex`.
 * Crawlers must read a page to see its `noindex` meta.
 */
export async function robots(): Promise<string> {
  if (await hidden()) return 'User-agent: *\nDisallow:\n';
  return `User-agent: *\nAllow: /\n\nSitemap: ${absolute('/sitemap.xml')}\n`;
}

/**
 * Whether the site is under `noindex`, from `cms.noindex` or the site settings.
 */
async function hidden(): Promise<boolean> {
  return useCMSConfig().noindex || (await queryUntyped('Site').findFirst())?.noindex === true;
}
