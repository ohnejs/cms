import type { QueryRecord } from 'ohnejs';

import { HTTPError, queryMetadata, queryUntyped, useConfig } from 'ohnejs';
import { queryScoped } from 'ohnejs/auth';
import { isPlainObject, isString, isUndefined } from 'ohnejs/utils';

import { useCMSConfig } from './config.ts';
import { loadRelations } from './relations.ts';
import { routePath, routesIn } from './routes.ts';

/**
 * What a page's `<head>` says about it.
 */
export interface SEO {
  title: string;
  description?: string;
  image?: string;
  robots?: string;
  canonical: string;
}

/**
 * The page in another locale, for `hreflang`; `x-default` names the default locale's page.
 */
export interface Alternate {
  hreflang: string;
  href: string;
}

/**
 * The SEO of a page: its own `seo` fields, falling back to the `Site` settings.
 * The title runs through `Site.titleTemplate`; a page or a site marked `noindex` asks robots to stay away.
 */
export async function seoOf(record: QueryRecord, locale: string, path: string): Promise<SEO> {
  const site = await siteIn(locale);
  const own = isPlainObject(record.seo) ? record.seo : {};
  const title = textOf(own.title) ?? textOf(record.title) ?? '';
  const name = textOf(site.name) ?? '';
  const template = textOf(site.titleTemplate) ?? '{title}';
  const seo: SEO = {
    title: title === '' ? name : template.replaceAll('{title}', title).replaceAll('{site}', name),
    canonical: absolute(path),
  };
  const description = textOf(own.description) ?? textOf(site.description);
  if (!isUndefined(description)) seo.description = description;
  const image = urlOf(own.image) ?? urlOf(site.image);
  if (!isUndefined(image)) seo.image = image;
  if (own.noindex === true || site.noindex === true) seo.robots = 'noindex';
  return seo;
}

/**
 * The page in every locale its collection has a route in and the reader may see it in.
 * A translatable record answers with its own slug per locale; any other keeps one slug everywhere.
 */
export async function alternatesOf(
  collection: string,
  record: QueryRecord,
  locale: string,
): Promise<Alternate[]> {
  const { locales, defaultLocale } = useConfig().collections;
  if (locales.length < 2) return [];
  const translatable = queryMetadata(collection).translatable === true;
  const alternates: Alternate[] = [];
  for (const code of locales) {
    const route = routesIn(code).find((entry) => entry.collection === collection);
    if (isUndefined(route)) continue;
    const slug =
      code === locale || !translatable
        ? record.slug
        : (await readIn(collection, record.UUID as string, code))?.slug;
    if (route.match.params.length > 0 && !isString(slug)) continue;
    const href = absolute(routePath(route, isString(slug) ? slug : undefined));
    alternates.push({ hreflang: code, href });
    if (code === defaultLocale) alternates.push({ hreflang: 'x-default', href });
  }
  return alternates;
}

/**
 * `path` on the website, absolute when `cms.site` is set.
 */
export function absolute(path: string): string {
  const { site } = useCMSConfig();
  return isUndefined(site) ? path : site.replace(/\/+$/, '') + path;
}

/**
 * The `Site` settings in `locale`, their image loaded.
 */
async function siteIn(locale: string): Promise<QueryRecord> {
  const site = (await queryUntyped('Site').locale(locale).findFirst()) ?? {};
  await loadRelations(site, 'Site', locale);
  return site;
}

/**
 * The record in another locale, as the reader may see it there.
 */
async function readIn(
  collection: string,
  uuid: string,
  locale: string,
): Promise<QueryRecord | undefined> {
  try {
    return await (
      await queryScoped(collection, 'read')
    )
      .locale(locale)
      .where({ UUID: uuid })
      .findFirst();
  } catch (error) {
    if (error instanceof HTTPError) return undefined;
    throw error;
  }
}

/**
 * A non-empty string value, or `undefined`.
 */
function textOf(value: unknown): string | undefined {
  return isString(value) && value !== '' ? value : undefined;
}

/**
 * The URL of a loaded upload, or `undefined`.
 */
function urlOf(value: unknown): string | undefined {
  return isPlainObject(value) && isString(value.url) ? value.url : undefined;
}
