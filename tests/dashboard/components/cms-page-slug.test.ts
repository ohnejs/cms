import type { Ref } from 'ohnejs/utils';

import { deepStrictEqual, strictEqual } from 'node:assert';
import { registerHooks } from 'node:module';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { isFunction, isString, isUndefined, ref, toValue } from 'ohnejs/utils';

// The dashboard runtime needs a browser, so its imports here answer from the fakes a test sets.
const fakes: Record<string, string> = {
  'ohnejs/dashboard': `data:text/javascript,export const { attachTooltip, badge, button, css, dashboardMeta, fallbackLabel, fieldTypeFor, h, icon, joinLabel, menu, note, translateMessage, useResource } = globalThis.dashboard;`,
  'app/components/content-language-switcher.ts': `data:text/javascript,export const effectiveContentLocale = () => globalThis.contentLocale;`,
};
registerHooks({
  resolve: (specifier, context, next) =>
    Object.hasOwn(fakes, specifier)
      ? { url: fakes[specifier]!, shortCircuit: true }
      : next(specifier, context),
});

type Reading = { value?: unknown; errors?: Record<string, string> };
type Control = {
  element: unknown;
  read(): Reading;
  draft(): unknown;
  dirty(): boolean;
  error(): string;
  focus(): void;
  setErrors(errors: Record<string, string>): string;
  revert(): void;
  rebase(value: unknown): void;
  restore(value: unknown): void;
};
type Action = {
  label: string;
  icon?: string;
  href?: string;
  disabled?: () => boolean;
  onSelect?: () => void;
};
type Query = { body: () => { where: { slug: string }; locale?: string } | undefined };
type Look = { tone?: string; icon?: string; size?: number };
type Node = { tag: string; props: Record<string, unknown> | null; children: unknown[] };

/**
 * The stand-in for the builtin slug control, its text and every value restored into it.
 */
let inner: { raw: Ref<string>; routed: Ref<string>; restored: unknown[] };
let builtin = {
  display: ({ value }: { value: () => unknown }) => `slug ${String(value())}`,
  control({ initial }: { initial: unknown }): Control {
    const base = ref(initial);
    const raw = ref(isString(initial) ? initial : '');
    const routed = ref('');
    const restored: unknown[] = [];
    inner = { raw, routed, restored };
    return {
      element: 'input',
      read: () => (isUndefined(base.value) && raw.value === '' ? {} : { value: raw.value }),
      draft: () => raw.value,
      dirty: () => raw.value !== (base.value ?? ''),
      error: () => routed.value,
      focus: () => {},
      setErrors: (errors) => {
        routed.value = errors[''] ?? '';
        return '';
      },
      revert: () => {
        raw.value = String(base.value ?? '');
      },
      rebase: (value) => {
        base.value = value;
      },
      restore: (value) => {
        restored.push(value);
        raw.value = String(value ?? '');
      },
    };
  },
};

/**
 * A message as the fakes show it: its key, then its params' values.
 */
function textOf(text: string | { key: string; params: Record<string, unknown> }): string {
  return isString(text) ? text : [text.key, ...Object.values(text.params)].join(' ');
}

const menus: (() => Action[][])[] = [];
const tips = new Map<unknown, () => string>();
const looks: Record<string, Look> = {};
const queries: Query[] = [];
let holders: Record<string, Record<string, unknown>> = {};

Object.assign(globalThis, {
  contentLocale: 'en',
  dashboard: {
    css: () => {},
    dashboardMeta: () => (globalThis as { meta?: unknown }).meta,
    fallbackLabel: (uuid: string) => `#${uuid}`,
    joinLabel: (row: { title?: string }) => row.title ?? '',
    fieldTypeFor: () => builtin,
    translateMessage: textOf,
    h: (tag: string, props: Node['props'], ...children: unknown[]): Node => ({
      tag,
      props,
      children,
    }),
    icon: (name: string) => ({ icon: name }),
    attachTooltip: (el: unknown, content: () => string) => {
      tips.set(el, content);
      return () => {};
    },
    badge: (content: string, options: Look) => {
      looks[content] = options;
      return { badge: `${content} ${options.icon}` };
    },
    note: (content: Parameters<typeof textOf>[0], options: Look) => {
      looks[textOf(content)] = options;
      return { note: textOf(content) };
    },
    button: () => ({ trigger: true }),
    menu: (trigger: object, groups: () => Action[][]) => {
      menus.push(groups);
      return trigger;
    },
    useResource: (_: string, options: Query) => {
      queries.push(options);
      const answer = (): unknown => {
        const body = options.body();
        if (isUndefined(body)) return undefined;
        const row = holders[body.where.slug];
        return { records: isUndefined(row) ? [] : [row] };
      };
      return Object.assign(answer, { state: () => 'ready', stale: () => false });
    },
  },
});

// A URL keeps the browser module out of this program's type check, which knows no DOM.
const source = new URL('../../../dashboard/components/cms-page-slug.ts', import.meta.url).href;
const { pageSlugType } = (await import(source)) as {
  pageSlugType: {
    display(context: object): () => unknown;
    control(context: object): Control;
  };
};

/**
 * Sets the dashboard meta to the Pages `routes`, with `locales`, the first the default, unprefixed.
 * The `cms` entries replace the layer's own, as a missing site does.
 */
function routed(
  routes: Record<string, string>,
  locales = ['en'],
  cms: Record<string, unknown> = {},
): void {
  Object.assign(globalThis, {
    meta: {
      locales,
      defaultLocale: locales[0],
      collections: [{ name: 'Pages', segment: 'pages', labelFields: ['title'], fields: [] }],
      cms: {
        routes: { Pages: routes },
        site: 'https://example.com',
        homeSlug: 'index',
        notFoundSlug: '404',
        prefixDefaultLocale: false,
        ...cms,
      },
    },
  });
}

/**
 * A Pages slug field, shared across locales unless `translatable`.
 */
function slugField(translatable = false): object {
  return {
    name: 'slug',
    type: 'pageSlug',
    kind: 'column',
    translatable,
    options: { nested: true, collection: 'Pages' },
  };
}

/**
 * Builds the control over `initial`, and answers it with the discrete inputs it reported.
 */
function mount(
  initial: unknown,
  options: { translatable?: boolean; disabled?: boolean } = {},
): { control: Control; inputs: unknown[] } {
  const inputs: unknown[] = [];
  const control = pageSlugType.control({
    field: slugField(options.translatable),
    initial,
    mode: 'edit',
    path: 'slug',
    disabled: options.disabled,
    language: () => 'en',
    onInput: (discrete?: boolean) => inputs.push(discrete),
  });
  return { control, inputs };
}

/**
 * What the control shows, in order: its texts, badges, notes, links, the inner input, and the menu trigger.
 */
function shown(node: unknown): string[] {
  if (isFunction<() => unknown>(node)) return shown(node());
  if (Array.isArray(node)) return node.flatMap(shown);
  if (isString(node)) return [node];
  if (node === null || isUndefined(node) || Object.hasOwn(node as object, 'icon')) return [];
  const entry = node as Record<string, unknown>;
  if (Object.hasOwn(entry, 'badge')) return [`badge ${String(entry.badge)}`];
  if (Object.hasOwn(entry, 'note')) return [`note ${String(entry.note)}`];
  if (Object.hasOwn(entry, 'trigger')) return ['trigger'];
  const { tag, props, children } = node as Node;
  if (toValue(props?.hidden) === true) return [];
  if (props?.role === 'img') return [`chip ${String(toValue(props['aria-label']))}`];
  return [...(tag === 'a' ? [`link ${String(props?.href)}`] : []), ...children.flatMap(shown)];
}

/**
 * The first element in `node` with `tag`.
 */
function find(node: unknown, tag: string): Node | undefined {
  if (isFunction<() => unknown>(node)) return find(node(), tag);
  if (Array.isArray(node)) return node.map((child) => find(child, tag)).find(Boolean);
  if (node === null || typeof node !== 'object' || !Object.hasOwn(node, 'tag')) return undefined;
  return (node as Node).tag === tag ? (node as Node) : find((node as Node).children, tag);
}

/**
 * Lets a typed address settle and its holder lookup run.
 */
async function settle(): Promise<void> {
  await Promise.resolve();
  mock.timers.tick(250);
  await Promise.resolve();
}

/**
 * The rows of the newest menu.
 */
function rows(): Action[] {
  return menus.at(-1)?.().flat() ?? [];
}

/**
 * Picks the newest menu's row labeled `label`.
 */
function pick(label: string): void {
  rows()
    .find((row) => row.label === label)
    ?.onSelect?.();
}

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout'] });
  menus.length = 0;
  queries.length = 0;
  holders = {};
  Object.assign(globalThis, { contentLocale: 'en' });
  routed({ en: '/[...slug]' });
});

afterEach(() => {
  mock.timers.reset();
});

describe('pageSlugType', () => {
  it('locks the home page to its icon and the site root, asking for no holder of it', () => {
    const { control } = mount('index');
    deepStrictEqual([control.read(), control.dirty()], [{ value: 'index' }, false]);
    deepStrictEqual(shown(control.element), [
      'chip cms.address.home',
      'link https://example.com/',
      'example.com',
      'trigger',
    ]);
    deepStrictEqual(
      queries.map((query) => query.body()?.where.slug),
      [undefined, '404', undefined],
    );
  });

  it('makes a page the not-found page from the menu, and reverts to its address', () => {
    const { control, inputs } = mount('about');
    deepStrictEqual(shown(control.element), [
      'input',
      'link https://example.com/about',
      'example.com/about',
      'trigger',
    ]);
    pick('cms.address.notFound');
    deepStrictEqual(
      [control.read(), control.dirty(), control.draft(), inputs],
      [{ value: '404' }, true, '404', [true]],
    );
    strictEqual(shown(control.element)[0], 'chip cms.address.notFound');
    control.revert();
    deepStrictEqual([control.read(), shown(control.element)[0]], [{ value: 'about' }, 'input']);
  });

  it('warns that the home page leaves its role, for its own address or the other special page', () => {
    const { control } = mount('index');
    pick('cms.address.notFound');
    deepStrictEqual(shown(control.element).at(-1), 'note cms.address.leavesHome');
    pick('cms.address.own');
    deepStrictEqual(
      [inner.restored, control.read(), shown(control.element)],
      [[''], { value: '' }, ['input', 'trigger', 'note cms.address.leavesHome']],
    );
  });

  it('refuses the home slug typed by hand, pointing to the menu until the save shows it', () => {
    const { control } = mount('about');
    inner.raw.value = 'Index';
    strictEqual(control.read().errors?.[''], 'cms.address.reservedHome');
    strictEqual(shown(control.element).at(-1), 'note cms.address.reservedHome');
    control.setErrors({ '': 'cms.address.reservedHome' });
    strictEqual(shown(control.element).at(-1), 'trigger');
  });

  it('shows no address for the home or not-found slug typed by hand, only the hint', () => {
    const { control } = mount('about');
    inner.raw.value = 'index';
    const home = shown(control.element);
    inner.raw.value = '404';
    deepStrictEqual(
      [home, shown(control.element)],
      [
        ['input', 'trigger', 'note cms.address.reservedHome'],
        ['input', 'trigger', 'note cms.address.reservedNotFound'],
      ],
    );
  });

  it('names the page that holds the home slug typed by hand, rather than pointing to the menu', () => {
    holders = { index: { UUID: 'h1', title: 'Start' } };
    const { control } = mount('about');
    inner.raw.value = 'Index';
    deepStrictEqual(
      [control.read().errors?.[''], shown(control.element).at(-1)],
      [
        'cms.address.takenHome Start /collections/pages/h1',
        'note cms.address.takenHome Start /collections/pages/h1',
      ],
    );
  });

  it('offers no special page under a route of its own, where `index` is a page like any', () => {
    routed({ en: '/blog/[slug]' });
    const { control } = mount('index');
    deepStrictEqual(
      [control.read(), shown(control.element), menus.length],
      [
        { value: 'index' },
        ['input', 'link https://example.com/blog/index', 'example.com/blog/index'],
        0,
      ],
    );
  });

  it('disables a special page another record holds, linking to that record', () => {
    holders = { index: { UUID: 'h1', title: 'Start' } };
    mount('about');
    const [home, open, notFound] = rows();
    deepStrictEqual(
      [home?.label, home?.disabled?.(), open, notFound?.label],
      [
        'cms.address.home',
        true,
        { label: 'cms.address.openHome', icon: 'arrow-right', href: '/collections/pages/h1' },
        'cms.address.notFound',
      ],
    );
  });

  it('asks for the holder in the content locale of a translatable slug', () => {
    routed({ en: '/[...slug]', de: '/[...slug]' }, ['en', 'de']);
    Object.assign(globalThis, { contentLocale: 'de' });
    holders = { index: { UUID: 'h1', title: 'Start' } };
    mount('about', { translatable: true });
    deepStrictEqual(
      [queries[0]?.body()?.locale, rows()[1]?.href],
      ['de', '/collections/pages/h1?locale=de'],
    );
  });

  it('judges a shared slug by every locale, showing the home address of the one that has it', () => {
    routed({ en: '/[...slug]', de: '/seiten/[...slug]' }, ['en', 'de']);
    Object.assign(globalThis, { contentLocale: 'de' });
    const { control } = mount('index');
    deepStrictEqual(shown(control.element), [
      'chip cms.address.home',
      'link https://example.com/',
      'example.com',
      'trigger',
    ]);
  });

  it('shows a locked control without the menu and asks for no holder', () => {
    const { control } = mount('about', { disabled: true });
    deepStrictEqual(
      [shown(control.element), queries.map((query) => query.body())],
      [
        ['input', 'link https://example.com/about', 'example.com/about'],
        [undefined, undefined, undefined],
      ],
    );
  });

  it('takes the special page a save or an undo lands', () => {
    const { control } = mount('about');
    control.rebase('404');
    deepStrictEqual([control.read(), control.dirty()], [{ value: '404' }, false]);
    control.restore('index');
    deepStrictEqual(
      [control.read(), control.dirty(), inner.restored],
      [{ value: 'index' }, true, []],
    );
  });

  it('shows the bare path without a site', () => {
    routed({ en: '/[...slug]' }, ['en'], { site: undefined });
    const { control } = mount('about');
    strictEqual(shown(control.element)[1], '/about');
  });

  it('names the page that holds a typed address, linking to it, and still reads the value', async () => {
    holders = { contact: { UUID: 'c1', title: 'Contact' } };
    const { control } = mount(undefined);
    inner.raw.value = 'contact';
    await settle();
    deepStrictEqual(
      [
        control.read(),
        shown(control.element),
        looks['cms.address.taken Contact /collections/pages/c1'],
      ],
      [
        { value: 'contact' },
        ['input', 'trigger', 'note cms.address.taken Contact /collections/pages/c1'],
        { tone: 'warning', icon: 'alert-triangle' },
      ],
    );
  });

  it('escapes the holder title, so its own brackets never end the link', async () => {
    holders = { contact: { UUID: 'c1', title: 'Blog [old]' } };
    const { control } = mount(undefined);
    inner.raw.value = 'contact';
    await settle();
    strictEqual(
      shown(control.element).at(-1),
      'note cms.address.taken Blog \\[old\\] /collections/pages/c1',
    );
  });

  it('asks for no holder of its own saved address', async () => {
    holders = { contact: { UUID: 'c1', title: 'Contact' } };
    const { control } = mount('contact');
    await settle();
    deepStrictEqual(
      [queries.at(-1)?.body(), shown(control.element).at(-1)],
      [undefined, 'trigger'],
    );
  });

  it('names the holder of an address edited on a saved page, until the save shows its own error', async () => {
    holders = { contact: { UUID: 'c1', title: 'Contact' } };
    const { control } = mount('about');
    inner.raw.value = 'contact';
    await settle();
    const hinted = shown(control.element);
    control.setErrors({ '': 'unique' });
    deepStrictEqual(
      [hinted, shown(control.element)],
      [
        ['input', 'trigger', 'note cms.address.taken Contact /collections/pages/c1'],
        ['input', 'trigger'],
      ],
    );
  });

  it('asks for the holder of a typed translatable address in the content locale', async () => {
    routed({ en: '/[...slug]', de: '/[...slug]' }, ['en', 'de']);
    Object.assign(globalThis, { contentLocale: 'de' });
    holders = { contact: { UUID: 'c1', title: 'Kontakt' } };
    const { control } = mount(undefined, { translatable: true });
    inner.raw.value = 'contact';
    await settle();
    deepStrictEqual(
      [queries.at(-1)?.body()?.locale, shown(control.element).at(-1)],
      ['de', 'note cms.address.taken Kontakt /collections/pages/c1?locale=de'],
    );
  });

  it('links the saved address to the public page in a new tab, and an edited one not', () => {
    const { control } = mount('about');
    const link = find(control.element, 'a');
    inner.raw.value = 'about-us';
    deepStrictEqual(
      [link?.props, shown(control.element)],
      [
        {
          class: 'o-cms-address-link',
          href: 'https://example.com/about',
          target: '_blank',
          rel: 'noopener noreferrer',
        },
        ['input', 'example.com/about-us', 'trigger'],
      ],
    );
  });

  it('links the saved home page, never one just picked or the not-found page', () => {
    const { control } = mount('about');
    pick('cms.address.home');
    const picked = shown(control.element);
    pick('cms.address.notFound');
    deepStrictEqual(
      [picked, shown(control.element)],
      [
        ['chip cms.address.home', 'example.com', 'trigger'],
        ['chip cms.address.notFound', 'cms.address.notFoundHint', 'trigger'],
      ],
    );
  });

  it('shows the special page as an accent icon its tooltip names, a badge in a cell', () => {
    const { control } = mount('index');
    const chip = find(control.element, 'span')!;
    shown(pageSlugType.display({ field: slugField(), value: () => 'index' }));
    deepStrictEqual(
      [chip.props?.class, chip.children, tips.get(chip)?.(), looks['cms.address.home']],
      [
        'o-cms-address-chip ohne-tone-accent',
        [{ icon: 'home' }],
        'cms.address.home',
        { icon: 'home', tone: 'accent' },
      ],
    );
  });

  it('warns in its tone that the home page leaves its role', () => {
    mount('index');
    pick('cms.address.notFound');
    deepStrictEqual(looks['cms.address.leavesHome'], { tone: 'warning', icon: 'alert-triangle' });
  });

  it('displays a special page as its badge and any other slug as the builtin does', () => {
    const field = slugField();
    const display = (value: string): unknown =>
      shown(pageSlugType.display({ field, value: () => value }));
    deepStrictEqual(
      [display('index'), display('about')],
      [['badge cms.address.home home'], ['slug about']],
    );
    routed({ en: '/blog/[slug]' });
    deepStrictEqual(display('index'), ['slug index']);
  });

  it('follows a `slug` type registered after it', () => {
    const before = builtin;
    builtin = { ...before, display: () => 'custom' };
    deepStrictEqual(shown(pageSlugType.display({ field: slugField(), value: () => 'about' })), [
      'custom',
    ]);
    builtin = before;
  });
});
