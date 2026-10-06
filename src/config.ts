import type { Config, LocaleCode } from 'ohnejs';
import type { LayerStrategies } from 'ohnejs/utils';

import { ohneError, useCollections, useConfig, useEnv } from 'ohnejs';
import {
  compileRoute,
  isNull,
  isPlainObject,
  isString,
  isUndefined,
  parseDuration,
  withDefaults,
} from 'ohnejs/utils';

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

      /**
       * What the live editor frames, relative to `site`: `{path}` is the page's path, `{token}` the preview token.
       * A site whose framework needs a preview route of its own, like Next's draft mode, points it there.
       *
       * @default
       * '{path}?ohne-preview={token}'
       *
       * @example
       * ```ts
       * '/api/preview?token={token}&path={path}'
       * ```
       */
      previewURL?: string;

      /**
       * The slug of the page `/` shows, under a `[...slug]` route; its own path redirects to `/`.
       *
       * @default
       * 'index'
       */
      homeSlug?: string;

      /**
       * The URLs told about every change to a page, the site settings, or a redirect, so a website can refresh.
       * Each request is signed with the hook's `secret`; check it with `verifyWebhook` from `@ohnejs/client`.
       *
       * @default
       * []
       */
      webhooks?: { url: string; secret: string }[];

      /**
       * How long a shared preview link may last.
       * An editor picks one of `durations` when sharing, with `default` chosen first.
       * A layer or app that sets it replaces the whole setting.
       *
       * @default
       * { durations: ['1h', '1d', '7d', '30d'], default: '1d' }
       */
      share?: {
        /**
         * The lifetimes an editor picks from, each a duration like `'1h'` or `'7 days'`.
         *
         * @default
         * ['1h', '1d', '7d', '30d']
         */
        durations?: string[];

        /**
         * The lifetime chosen first, one of `durations`.
         * Omitted, it is the first of `durations`, or `'1d'` for the built-in list.
         */
        default?: string;
      };
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

  /**
   * What the live editor frames, relative to `site`, with `{path}` and `{token}` filled in.
   */
  previewURL: string;

  /**
   * The slug of the page `/` shows.
   */
  homeSlug: string;

  /**
   * The URLs told about every change, each with the secret that signs its requests.
   */
  webhooks: { url: string; secret: string }[];

  /**
   * The lifetimes a shared preview link may have, and the one chosen first.
   */
  share: { durations: string[]; default: string };
}

/**
 * The defaults the layer stacks under every app's `cms` settings.
 */
export const CMS_DEFAULTS = {
  routes: {},
  prefixDefaultLocale: false,
  previewURL: '{path}?ohne-preview={token}',
  homeSlug: 'index',
  webhooks: [],
  share: { durations: ['1h', '1d', '7d', '30d'], default: '1d' },
} satisfies Omit<ResolvedCMSConfig, 'site'>;

/**
 * How the cms keys merge, keyed by their path under `Config.cms`.
 * `routes` assigns, so each layer and the app add or replace one collection's pattern.
 */
export const CMS_STRATEGIES: LayerStrategies = {
  routes: 'assign',
  webhooks: 'replace',
  share: 'replace',
};

useEnv().define('SITE_URL', { default: undefined });

/**
 * Returns the resolved cms settings, `Config.cms` merged over the layer defaults.
 */
export function useCMSConfig(): ResolvedCMSConfig {
  const config = withDefaults(useConfig().cms ?? {}, CMS_DEFAULTS, { strategies: CMS_STRATEGIES });
  const share: NonNullable<NonNullable<Config['cms']>['share']> = config.share;
  const durations = share.durations ?? CMS_DEFAULTS.share.durations;
  return {
    ...config,
    site: useEnv().get('SITE_URL') ?? config.site,
    share: { durations, default: share.default ?? durations[0]! },
  };
}

/**
 * Checks the cms settings against the collections, throwing an error block that names the first bad one.
 * A boot file runs it, so a bad route stops the server before any page is asked for.
 */
export function validateCMSConfig(): void {
  const { site, routes, previewURL, webhooks, share } = useCMSConfig();
  validateShare(share);
  for (const hook of webhooks) {
    const url = URL.parse(hook.url);
    const local = url?.hostname === 'localhost' || url?.hostname === '127.0.0.1';
    if (isNull(url) || !(url.protocol === 'https:' || (url.protocol === 'http:' && local))) {
      throw ohneError({
        title: `Invalid \`cms.webhooks\` URL \`${hook.url}\``,
        body: ['A webhook URL is `https`, or `http` on `localhost`.'],
      });
    }
    if (!isString(hook.secret) || hook.secret.length < 16) {
      throw ohneError({
        title: `Webhook \`${hook.url}\` needs a secret`,
        body: ['Give it a `secret` of 16 characters or more, and check it on the website.'],
      });
    }
  }
  if (!previewURL.startsWith('/') && !previewURL.startsWith('{path}')) {
    throw ohneError({
      title: `Invalid \`cms.previewURL\` value \`${previewURL}\``,
      body: ['It is a path on the website, starting with `/` or `{path}`, holding `{token}`.'],
    });
  }
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
 * Rejects a share lifetime that does not parse to a positive duration, and a `default` outside `durations`.
 */
function validateShare({ durations, default: initial }: ResolvedCMSConfig['share']): void {
  if (durations.length === 0) {
    throw ohneError({
      title: '`cms.share.durations` is empty',
      body: ["List the lifetimes an editor may give a shared link, like `['1d', '7d']`."],
    });
  }
  for (const duration of durations) {
    if (lifetime(duration) > 0) continue;
    throw ohneError({
      title: `Invalid \`cms.share.durations\` value \`${duration}\``,
      body: ["A duration is a positive length of time, like `'1h'`, `'7d'`, or `'2 weeks'`."],
    });
  }
  if (!durations.includes(initial)) {
    throw ohneError({
      title: `\`cms.share.default\` \`${initial}\` is not a share duration`,
      body: [`Pick one of ${durations.map((duration) => `\`${duration}\``).join(', ')}.`],
    });
  }
}

/**
 * The milliseconds `duration` spans, or `NaN` when it does not parse.
 */
function lifetime(duration: string): number {
  try {
    return parseDuration(duration);
  } catch {
    return Number.NaN;
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
