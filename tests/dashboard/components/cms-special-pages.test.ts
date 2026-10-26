import type { Ref } from 'ohnejs/utils';

import { deepStrictEqual } from 'node:assert';
import { registerHooks } from 'node:module';
import { beforeEach, describe, it } from 'node:test';
import { isFunction, isUndefined, nextTick, ref } from 'ohnejs/utils';

// The dashboard runtime needs a browser, so its imports here answer from the fakes a test sets.
const fakes: Record<string, string> = {
  'ohnejs/dashboard': `data:text/javascript,export const { api, dashboardMeta, fallbackLabel, joinLabel, note, useResource } = globalThis.dashboard;`,
  'app/components/content-language-switcher.ts': `data:text/javascript,export const effectiveContentLocale = () => 'en';`,
};
registerHooks({
  resolve: (specifier, context, next) =>
    Object.hasOwn(fakes, specifier)
      ? { url: fakes[specifier]!, shortCircuit: true }
      : next(specifier, context),
});

type Options = { query?: { path: string }; body?: () => { where: { slug: string } } | undefined };

const reads: { route: string; options: Options }[] = [];
let live = false;
let holder: Record<string, unknown> | undefined;
let reloads = 0;
// The slug each locale's read of a record answers, under `*` for a read in no locale.
let slugs: Record<string, string> = {};
// The records the reads asked for.
let asked: unknown[] = [];

Object.assign(globalThis, {
  dashboard: {
    api: async (route: string, init: { body: string }) => {
      const { locale, where } = JSON.parse(init.body) as { locale?: string; where: unknown };
      asked.push([route, where]);
      if (!Object.hasOwn(slugs, locale ?? '*')) return new Response(null, { status: 500 });
      return Response.json({ records: [{ slug: slugs[locale ?? '*'] }] });
    },
    dashboardMeta: () => (globalThis as { meta?: unknown }).meta,
    fallbackLabel: (uuid: string) => `#${uuid}`,
    joinLabel: (row: { title?: string }) => row.title ?? '',
    note: (content: string | { key: string; params: object }) => content,
    useResource: (route: string, options: Options) => {
      reads.push({ route, options });
      const answer = (): unknown => {
        if (route === 'GET /cms/routes/live') return { live };
        if (isUndefined(options.body?.())) return undefined;
        return { records: isUndefined(holder) ? [] : [holder] };
      };
      return Object.assign(answer, {
        stale: () => false,
        busy: () => false,
        reload: async () => {
          reloads++;
        },
      });
    },
  },
});

// A URL keeps the browser module out of this program's type check, which knows no DOM.
const source = new URL('../../../dashboard/components/cms-special-pages.ts', import.meta.url).href;
const { missingHome, specialPageDeleteNotice } = (await import(source)) as {
  missingHome: (editor: object) => unknown;
  specialPageDeleteNotice: (collection: object, uuid: string) => Promise<unknown>;
};

const pages = {
  name: 'Pages',
  segment: 'pages',
  labelFields: ['title'],
  fields: [{ name: 'slug', translatable: false, writable: true }],
};

/**
 * Sets the dashboard meta to the Pages `route` in `locales`, the first the default, unprefixed.
 */
function routed(route: string, locales = ['en']): void {
  Object.assign(globalThis, {
    meta: {
      locales,
      defaultLocale: locales[0],
      routes: ['GET /cms/routes/live'],
      collections: [pages],
      cms: {
        routes: { Pages: Object.fromEntries(locales.map((locale) => [locale, route])) },
        homeSlug: 'index',
        notFoundSlug: '404',
        prefixDefaultLocale: false,
      },
    },
  });
}

/**
 * A form whose slug control holds the address `draft` shows, or none when `draft` is absent.
 * A `refused` address reads as an error, as a hand-typed reserved slug does.
 */
function formOf(draft?: Ref<string>, refused = false): Ref<object | undefined> {
  const control = {
    draft: () => draft?.value,
    read: () => (refused ? { errors: { '': 'reserved' } } : { value: draft?.value }),
  };
  return ref(
    isUndefined(draft)
      ? undefined
      : { controlOf: (name: string) => (name === 'slug' ? control : undefined) },
  );
}

/**
 * What `notice` renders now.
 */
function render(notice: unknown): unknown {
  return isFunction<() => unknown>(notice) ? notice() : notice;
}

/**
 * What the notice on a saved Pages record at `slug` shows, its address control at `draft` if given.
 */
function noticeOn(slug: string, canWrite = true, draft?: Ref<string>): unknown {
  return render(
    missingHome({
      collection: pages,
      create: false,
      saved: () => ({ slug }),
      canWrite: () => canWrite,
      form: formOf(draft),
    }),
  );
}

/**
 * The notice on an unsaved Pages record whose address control holds `draft`, `refused` if given.
 */
function noticeOnNew(draft: Ref<string>, refused = false): unknown {
  return missingHome({
    collection: pages,
    create: true,
    saved: () => ({}),
    canWrite: () => true,
    form: formOf(draft, refused),
  });
}

beforeEach(() => {
  reads.length = 0;
  live = false;
  holder = undefined;
  reloads = 0;
  routed('/[...slug]');
});

describe('missingHome', () => {
  it('tells a page that the website has no live home page', () => {
    deepStrictEqual(
      [noticeOn('about'), reads[0]?.options.query],
      ['cms.home.missing', { path: '/' }],
    );
  });

  it('names the locale when the website has several', () => {
    routed('/[...slug]', ['en', 'de']);
    deepStrictEqual(noticeOn('about'), { key: 'cms.home.missingIn', params: { locale: 'en' } });
  });

  it('names the home page visitors cannot see, and tells the home page itself', () => {
    holder = { UUID: 'h1', title: 'Start' };
    deepStrictEqual(
      [noticeOn('about'), noticeOn('index')],
      [{ key: 'cms.home.heldNotLive', params: { title: 'Start' } }, 'cms.home.unpublished'],
    );
  });

  it('asks no one to choose a home page who cannot change the address', () => {
    holder = { UUID: 'h1', title: 'Start' };
    const held = noticeOn('about', false);
    holder = undefined;
    deepStrictEqual(
      [noticeOn('about', false), held],
      [null, { key: 'cms.home.heldNotLive', params: { title: 'Start' } }],
    );
    pages.fields[0]!.writable = false;
    const locked = noticeOn('about');
    pages.fields[0]!.writable = true;
    deepStrictEqual(locked, null);
  });

  it('shows nothing while visitors see a home page', () => {
    live = true;
    deepStrictEqual(noticeOn('about'), null);
  });

  it('shows nothing and reads nothing under a route of its own', () => {
    routed('/blog/[slug]');
    deepStrictEqual([noticeOn('about'), reads], [null, []]);
  });

  it('reads the site again after each save', async () => {
    const saved = ref({ slug: 'about' });
    missingHome({
      collection: pages,
      create: false,
      saved: () => saved.value,
      canWrite: () => true,
      form: formOf(),
    });
    saved.value = { slug: 'index' };
    await nextTick();
    deepStrictEqual(reloads, 1);
  });

  it('drops the notice once an unsaved page is made the home page', () => {
    const draft = ref('about');
    const notice = noticeOnNew(draft);
    const before = render(notice);
    draft.value = 'index';
    deepStrictEqual([before, render(notice)], ['cms.home.missing', null]);
  });

  it('leaves a hand-typed home slug to its field hint, and tells a refused not-found slug', () => {
    deepStrictEqual(
      [render(noticeOnNew(ref('index'), true)), render(noticeOnNew(ref('404'), true))],
      [null, 'cms.home.missing'],
    );
  });

  it('shows no notice on the home page while it leaves for an address of its own', () => {
    deepStrictEqual(noticeOn('index', true, ref('about')), null);
  });

  it('asks the not-found page for another page as the home page, never itself', () => {
    const own = noticeOn('404');
    const fresh = render(noticeOnNew(ref('404')));
    routed('/[...slug]', ['en', 'de']);
    deepStrictEqual(
      [own, fresh, noticeOn('404')],
      [
        'cms.home.missingOther',
        'cms.home.missingOther',
        { key: 'cms.home.missingOtherIn', params: { locale: 'en' } },
      ],
    );
  });
});

describe('specialPageDeleteNotice', () => {
  /**
   * The line deleting the Pages record `u1`, saved at `slug`, adds.
   */
  const deleting = async (slug: string): Promise<unknown> => {
    slugs = { '*': slug };
    return specialPageDeleteNotice(pages, 'u1');
  };

  beforeEach(() => {
    asked = [];
  });

  it('tells what the website shows once the home or the not-found page is gone', async () => {
    const lines = [await deleting('index'), await deleting('404'), await deleting('about')];
    deepStrictEqual(
      [lines, asked[0]],
      [
        ['cms.delete.home', 'cms.delete.notFound', undefined],
        ['POST /collections/pages/query', { UUID: 'u1' }],
      ],
    );
  });

  it('warns of a page the record is in another locale, since the delete removes every locale', async () => {
    routed('/[...slug]', ['en', 'de']);
    const translated = {
      ...pages,
      fields: [{ name: 'slug', translatable: true, writable: true }],
    };
    const lines = [];
    const held: Record<string, string>[] = [
      { en: 'about', de: 'index' },
      { en: 'about', de: '404' },
      { en: 'about' },
    ];
    for (const answers of held) {
      slugs = answers;
      lines.push(await specialPageDeleteNotice(translated, 'u1'));
    }
    deepStrictEqual(lines, ['cms.delete.home', 'cms.delete.notFound', undefined]);
  });

  it('adds nothing and reads nothing under a route of its own', async () => {
    routed('/blog/[slug]');
    deepStrictEqual([await deleting('index'), asked], [undefined, []]);
  });

  it('adds nothing when the read fails', async () => {
    slugs = {};
    deepStrictEqual(await specialPageDeleteNotice(pages, 'u1'), undefined);
  });
});
