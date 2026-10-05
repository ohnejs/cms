import { HTTPError, queryMetadata, queryUntyped, useConfig } from 'ohnejs';
import { queryScoped } from 'ohnejs/auth';
import { escapeXML, isPlainObject, isString } from 'ohnejs/utils';

import { routePath, routesIn } from './routes.ts';
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
 * Pages marked `noindex`, and the `404` page, stay out; a site marked `noindex` lists nothing.
 */
export async function sitemap(): Promise<string> {
  const site = await queryUntyped('Site').findFirst();
  const entries = site?.noindex === true ? new Map<string, Entry>() : await collect();
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
        if (record.slug === '404') continue;
        if (isPlainObject(record.seo) && record.seo.noindex === true) continue;
        if (route.match.params.length > 0 && !isString(record.slug)) continue;
        const key = `${route.collection}:${record.UUID as string}`;
        const entry = entries.get(key) ?? { updated: 0, paths: new Map() };
        entry.updated = Math.max(entry.updated, Number(record._updatedAt) || 0);
        entry.paths.set(locale, routePath(route, isString(record.slug) ? record.slug : undefined));
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
  try {
    const builder = await queryScoped(collection, 'read');
    if (queryMetadata(collection).translatable === true) builder.locale(locale);
    return await builder.findMany();
  } catch (error) {
    if (error instanceof HTTPError) return [];
    throw error;
  }
}

/**
 * The `robots.txt` of the website: everything open with the sitemap named, or everything closed under `noindex`.
 */
export async function robots(): Promise<string> {
  const site = await queryUntyped('Site').findFirst();
  if (site?.noindex === true) return 'User-agent: *\nDisallow: /\n';
  return `User-agent: *\nAllow: /\n\nSitemap: ${absolute('/sitemap.xml')}\n`;
}
