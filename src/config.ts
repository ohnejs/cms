import type { LocaleCode } from 'ohnejs';
import type { LayerStrategies } from 'ohnejs/utils';

import { ohneError, useCollections, useConfig, useEnv } from 'ohnejs';
import { compileRoute, isPlainObject, isString, isUndefined, withDefaults } from 'ohnejs/utils';

declare module 'ohnejs' {
  interface Config {
    /**
     * Settings for the cms layer: where the website lives and which paths show which records.
     */
    cms?: {
      /**
       * The origin of the website, with an optional base path, like `'https://example.com'`.
       * The `SITE_URL` env var takes precedence whenever it is set.
       */
      site?: string;

      /**
       * The route pattern of each collection with pages, keyed by collection name.
       * A pattern holds one `[slug]`, or one `[...slug]` whose slug may hold `/`.
       * A singleton's pattern holds no param.
       * An object gives each locale its own pattern; a locale it leaves out has no pages there.
       *
       * @default
       * {}
       *
       * @example
       * ```ts
       * {
       *   Pages: '/[...slug]',
       *   Posts: { en: '/blog/[slug]', de: '/artikel/[slug]' },
       *   Contact: '/contact',
       * }
       * ```
       */
      routes?: Record<string, string | Partial<Record<LocaleCode, string>>>;

      /**
       * Whether a path in the default locale starts with the locale too, like `/en/about`.
       * The other locales always do.
       *
       * @default
       * false
       */
      prefixDefaultLocale?: boolean;
    };
  }

  interface Env {
    /**
     * The origin of the website, with an optional base path.
     * It replaces `cms.site`.
     *
     * @default
     * undefined
     */
    SITE_URL: string | undefined;
  }

  interface KnownCapabilities {
    'cms.drafts': true;
  }
}

/**
 * The cms settings with every default applied.
 */
export interface ResolvedCMSConfig {
  /**
   * The website origin and base path, from `SITE_URL` or `cms.site`; absent when neither is set.
   */
  site: string | undefined;

  /**
   * The route pattern of each collection with pages.
   */
  routes: Record<string, string | Partial<Record<LocaleCode, string>>>;

  /**
   * Whether a path in the default locale starts with the locale too.
   */
  prefixDefaultLocale: boolean;
}

/**
 * The defaults the layer stacks under every app's `cms` settings.
 */
export const CMS_DEFAULTS = {
  routes: {},
  prefixDefaultLocale: false,
} satisfies Omit<ResolvedCMSConfig, 'site'>;

/**
 * How the cms keys merge, keyed by their path under `Config.cms`.
 * `routes` assigns, so each layer and the app add or replace one collection's pattern.
 */
export const CMS_STRATEGIES: LayerStrategies = {
  routes: 'assign',
};

useEnv().define('SITE_URL', { default: undefined });

/**
 * Returns the resolved cms settings, `Config.cms` merged over the layer defaults.
 */
export function useCMSConfig(): ResolvedCMSConfig {
  const config = withDefaults(useConfig().cms ?? {}, CMS_DEFAULTS, { strategies: CMS_STRATEGIES });
  return { ...config, site: useEnv().get('SITE_URL') ?? config.site };
}

/**
 * Checks the cms settings against the collections, throwing an error block that names the first bad one.
 * A boot file runs it, so a bad route stops the server before any page is asked for.
 */
export function validateCMSConfig(): void {
  const { site, routes } = useCMSConfig();
  if (!isUndefined(site) && !URL.canParse(site)) {
    throw ohneError({
      title: `Invalid \`cms.site\` value \`${site}\``,
      body: ['It is an origin with an optional base path, such as `https://example.com`.'],
    });
  }
  const { locales } = useConfig().collections;
  const seen = new Map<string, string>();
  for (const [collection, value] of Object.entries(routes)) {
    const entry = useCollections().get(collection);
    if (isUndefined(entry)) {
      throw ohneError({
        title: `Unknown collection \`${collection}\` in \`cms.routes\``,
        body: ['Each key of `cms.routes` names a collection.'],
      });
    }
    if (!isUndefined(entry.collection.dashboard?.recordPath)) {
      throw ohneError({
        title: `Collection \`${collection}\` has a route and a \`recordPath\``,
        body: [
          'A collection with pages opens its records in the live editor, which `recordPath` sends away from.',
          `Remove \`dashboard.recordPath\` from \`${collection}\`, or its pattern from \`cms.routes\`.`,
        ],
      });
    }
    for (const [locale, pattern] of routeEntries(value, locales)) {
      if (!(locales as readonly string[]).includes(locale)) {
        throw ohneError({
          title: `Unknown locale \`${locale}\` in \`cms.routes.${collection}\``,
          body: [`The locales are ${locales.map((code) => `\`${code}\``).join(', ')}.`],
        });
      }
      validatePattern(
        collection,
        pattern,
        entry.collection.singleton === true,
        'slug' in entry.collection.fields,
        locales,
      );
      const shape = `${locale} ${patternShape(pattern)}`;
      const clash = seen.get(shape);
      if (!isUndefined(clash)) {
        throw ohneError({
          title: `Routes of \`${clash}\` and \`${collection}\` match the same paths`,
          body: [
            `Both patterns match the same paths in \`${locale}\`, so one would never be reached.`,
            'Give one of them a static segment of its own, like `/blog/[slug]`.',
          ],
        });
      }
      seen.set(shape, collection);
    }
  }
}

/**
 * The `[locale, pattern]` pairs of one `cms.routes` value; a string applies to every locale.
 */
export function routeEntries(
  value: string | Partial<Record<string, string>>,
  locales: readonly string[],
): [string, string][] {
  if (isString(value)) return locales.map((locale) => [locale, value]);
  return Object.entries(isPlainObject(value) ? value : {}).filter(
    (entry): entry is [string, string] => isString(entry[1]),
  );
}

/**
 * Rejects a pattern whose params a collection cannot fill.
 */
function validatePattern(
  collection: string,
  pattern: string,
  singleton: boolean,
  hasSlug: boolean,
  locales: readonly string[],
): void {
  const where = `\`cms.routes.${collection}\``;
  if (!pattern.startsWith('/')) {
    throw ohneError({
      title: `Invalid pattern \`${pattern}\` in ${where}`,
      body: ['A pattern starts with `/`.'],
    });
  }
  const { params } = compileRoute(pattern);
  if (singleton) {
    if (params.length === 0) return;
    throw ohneError({
      title: `Pattern \`${pattern}\` in ${where} has a param`,
      body: [`\`${collection}\` is a singleton, so its one page has one path without params.`],
    });
  }
  if (params.length !== 1 || params[0] !== 'slug') {
    throw ohneError({
      title: `Pattern \`${pattern}\` in ${where} needs one \`[slug]\``,
      body: [
        'A pattern of a collection holds exactly one `[slug]` or `[...slug]`, the record it shows.',
      ],
    });
  }
  if (!hasSlug) {
    throw ohneError({
      title: `Collection \`${collection}\` has a route but no \`slug\` field`,
      body: ['Add the page fields: `fields: { ...pageFields(), ... }` from `@ohnejs/cms`.'],
    });
  }
  if (locales.length < 2) return;
  const first = pattern.split('/')[1] ?? '';
  if (locales.includes(first)) {
    throw ohneError({
      title: `Pattern \`${pattern}\` in ${where} starts with a locale`,
      body: [
        `A path's first segment \`${first}\` already names its locale; start the pattern with another word.`,
      ],
    });
  }
}

/**
 * The pattern with every param reduced to a placeholder, so two patterns that match the same paths compare equal.
 */
function patternShape(pattern: string): string {
  return pattern
    .replace(/\[\.\.\.[^\]]+\]/g, '*')
    .replace(/\[[^\]]+\]/g, ':')
    .replace(/\/+$/, '');
}
