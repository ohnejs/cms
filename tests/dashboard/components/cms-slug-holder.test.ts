import type { EffectScope } from 'ohnejs/utils';

import { deepStrictEqual, strictEqual } from 'node:assert';
import { registerHooks } from 'node:module';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { effect, effectScope, isUndefined, ref } from 'ohnejs/utils';

// The dashboard runtime needs a browser, so its import here answers from the fakes a test sets.
const fake = `data:text/javascript,export const { fallbackLabel, joinLabel, useResource } = globalThis.dashboard;`;
registerHooks({
  resolve: (specifier, context, next) =>
    specifier === 'ohnejs/dashboard' ? { url: fake, shortCircuit: true } : next(specifier, context),
});

type Body = { where: { slug: string }; select: string[]; perPage: number; locale?: string };

const bodies: (Body | undefined)[] = [];
const state = ref('ready');
const stale = ref(false);
let rows: Record<string, Record<string, unknown>> = {};

Object.assign(globalThis, {
  dashboard: {
    fallbackLabel: (uuid: string) => `#${uuid}`,
    joinLabel: (row: { title?: string }) => row.title ?? '',
    useResource: (_: string, options: { body: () => Body | undefined }) => {
      const body = ref<Body | undefined>(undefined);
      effect(() => {
        body.value = options.body();
        bodies.push(body.value);
      });
      const answer = (): unknown => {
        if (isUndefined(body.value)) return undefined;
        const row = rows[body.value.where.slug];
        return { records: isUndefined(row) ? [] : [row] };
      };
      return Object.assign(answer, { state: () => state.value, stale: () => stale.value });
    },
  },
});

// A URL keeps the browser module out of this program's type check, which knows no DOM.
const source = new URL('../../../dashboard/components/cms-slug-holder.ts', import.meta.url).href;
const { slugHolder } = (await import(source)) as {
  slugHolder: (
    collection: object,
    locale: () => string | undefined,
    slug: () => string | undefined,
  ) => () => unknown;
};

const pages = { name: 'Pages', segment: 'pages', labelFields: ['title'], fields: [] };
let scope: EffectScope;

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout'] });
  scope = effectScope();
  bodies.length = 0;
  state.value = 'ready';
  stale.value = false;
  rows = { contact: { UUID: 'c1', title: 'Contact' } };
});

afterEach(() => {
  scope.dispose();
  mock.timers.reset();
});

/**
 * Runs the pending effects, moves the clock by `ms`, then runs what that woke.
 */
async function wait(ms: number): Promise<void> {
  await Promise.resolve();
  mock.timers.tick(ms);
  await Promise.resolve();
}

/**
 * Builds the lookup over a typed slug that starts at `initial`, in `locale`.
 */
function mount(initial: string | undefined, locale?: string) {
  const slug = ref(initial);
  const holder = scope.run(() =>
    slugHolder(
      pages,
      () => locale,
      () => slug.value,
    ),
  )!;
  return { slug, holder };
}

describe('slugHolder', () => {
  it('answers null and asks nothing without a slug', () => {
    const { holder } = mount(undefined);
    deepStrictEqual([holder(), bodies], [null, [undefined]]);
  });

  it('asks for the first slug at once and names its holder', () => {
    const { holder } = mount('contact');
    deepStrictEqual(
      [holder(), bodies],
      [
        { title: 'Contact', href: '/collections/pages/c1' },
        [{ where: { slug: 'contact' }, select: ['UUID', 'title'], perPage: 1 }],
      ],
    );
  });

  it('collapses a burst of typing into one request, unsure until it settles', async () => {
    const { slug, holder } = mount(undefined);
    slug.value = 'c';
    await wait(100);
    slug.value = 'co';
    await wait(100);
    slug.value = 'con';
    const typing = holder();
    await wait(250);
    deepStrictEqual(
      [typing, holder(), bodies.map((body) => body?.where.slug)],
      [undefined, null, [undefined, 'con']],
    );
  });

  it('is unsure while the answer is on its way', () => {
    stale.value = true;
    const { holder } = mount('contact');
    strictEqual(holder(), undefined);
  });

  it('falls back to the short id of a holder without a label', () => {
    rows = { contact: { UUID: 'c1' } };
    deepStrictEqual(mount('contact').holder(), { title: '#c1', href: '/collections/pages/c1' });
  });

  it('asks and links in the locale of a translatable slug', () => {
    const { holder } = mount('contact', 'de');
    deepStrictEqual(
      [bodies[0]?.locale, holder()],
      ['de', { title: 'Contact', href: '/collections/pages/c1?locale=de' }],
    );
  });

  it('answers null on a read that fails or is forbidden', () => {
    const { holder } = mount('contact');
    state.value = 'forbidden';
    const forbidden = holder();
    state.value = 'error';
    deepStrictEqual([forbidden, holder()], [null, null]);
  });
});
