import type { EffectScope, Ref } from 'ohnejs/utils';

import { deepStrictEqual } from 'node:assert';
import { registerHooks } from 'node:module';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { effectScope, isUndefined, ref } from 'ohnejs/utils';

// The dashboard runtime needs a browser, so its import here answers from the fakes a test sets.
const fake = `data:text/javascript,export const { api, attachTooltip, button, css, dashboardMeta, h, renderProse, signInCount, useT, when } = globalThis.dashboard;`;
registerHooks({
  resolve: (specifier, context, next) =>
    specifier === 'ohnejs/dashboard' ? { url: fake, shortCircuit: true } : next(specifier, context),
});

type Draft = Record<string, unknown> | undefined;
type Message = { type: string; page?: { title?: string } };
type Frame = { loads: string[]; posts: Message[]; contentWindow: object };

const frames: Frame[] = [];
const events: string[] = [];
const listeners: ((event: object) => void)[] = [];
const proses: [string, object][] = [];
const puts: string[] = [];
const signIns = ref(0);

Object.assign(globalThis, {
  window: {
    addEventListener: (_: string, fn: (event: object) => void) => listeners.push(fn),
    removeEventListener: (_: string, fn: (event: object) => void) =>
      listeners.splice(listeners.indexOf(fn), 1),
  },
  ResizeObserver: class {
    observe(): void {}
    disconnect(): void {}
  },
  dashboard: {
    css: () => {},
    useT: () => (key: string) => key,
    when: (shown: () => boolean) => shown,
    signInCount: () => signIns.value,
    button: () => ({}),
    attachTooltip: () => () => {},
    renderProse: (_: object, text: string, options: object) => proses.push([text, options]),
    dashboardMeta: () => ({
      cms: { site: 'http://site.test', previewURL: '{path}?preview={token}' },
    }),
    h: (tag: string) => {
      const frame = {
        loads: [] as string[],
        posts: [] as Message[],
        contentWindow: { postMessage: (message: Message) => frame.posts.push(message) },
        addEventListener: () => {},
        removeAttribute: () => {},
        set src(url: string) {
          frame.loads.push(url);
          events.push(`load ${url}`);
        },
      };
      if (tag === 'iframe') frames.push(frame);
      return frame;
    },
    api: async (route: string, init?: { body: string }) => {
      // Each sign-in's token names it, so the first is `t` and the one after a sign-in `t1`.
      if (route === 'POST /cms/preview/tokens')
        return { ok: true, json: async () => ({ token: `t${signIns.value || ''}` }) };
      puts.push(route);
      const { path, values } = JSON.parse(init!.body) as {
        path: string;
        values: { title: string };
      };
      events.push(`put ${path}`);
      return { ok: true, json: async () => ({ kind: 'page', path, title: values.title }) };
    },
  },
});

// A URL keeps the browser module out of this program's type check, which knows no DOM.
const source = new URL('../../../dashboard/components/cms-preview-pane.ts', import.meta.url).href;
const { previewPane } = (await import(source)) as {
  previewPane: (options: object) => { controls: () => boolean };
};

let scope: EffectScope;

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout'] });
  scope = effectScope();
  events.length = 0;
  puts.length = 0;
  signIns.value = 0;
});

afterEach(() => {
  scope.dispose();
  mock.timers.reset();
});

/**
 * Runs every pending callback, moves the clock by `ms`, then runs what that woke.
 */
async function wait(ms: number): Promise<void> {
  await new Promise(setImmediate);
  mock.timers.tick(ms);
  await new Promise(setImmediate);
}

/**
 * Mounts a pane framing `path` with `draft`, and answers it, the refs that drive it, and its frame.
 * The `options` replace the pane's own, as a saved record that derives the path does.
 * Its fake `when` hands back the condition, so `controls()` answers whether the pane frames a page.
 */
async function mount(
  path: string,
  draft: Draft,
  options: object = {},
): Promise<{
  pane: { controls: () => boolean };
  path: Ref<string>;
  draft: Ref<Draft>;
  frame: Frame;
}> {
  const refs = { path: ref(path), draft: ref(draft) };
  const pane = scope.run(() =>
    previewPane({
      path: () => refs.path.value,
      draft: () => refs.draft.value,
      fresh: () => false,
      missing: () => '',
      editable: () => true,
      focused: () => undefined,
      highlighted: () => undefined,
      blocks: () => ({}),
      saves: () => undefined,
      onSelect: () => {},
      onKey: () => {},
      onAction: () => {},
      ...options,
    }),
  );
  await wait(0);
  return { pane: pane!, ...refs, frame: frames.at(-1)! };
}

/**
 * A valid draft of the page at `slug`, titled `title`.
 */
function page(slug: string, title = 'Title', locale = 'en'): Draft {
  return { collection: 'Pages', record: 'r', locale, values: { slug, title } };
}

/**
 * Mounts a pane on the saved record at `slug`, its path derived from the record as the editor's is.
 */
async function mountSaved(
  slug: string,
): Promise<{ saved: Ref<{ slug: string }>; draft: Ref<Draft>; frame: Frame }> {
  const saved = ref({ slug });
  const mounted = await mount(`/${slug}`, page(slug), {
    path: () => `/${saved.value.slug}`,
    saves: () => saved.value,
  });
  await wait(300);
  return { saved, ...mounted };
}

/**
 * Has `frame` say hello, as the site's client does once it runs.
 */
function hello(frame: Frame): void {
  for (const fn of listeners) {
    fn({
      source: frame.contentWindow,
      origin: 'http://site.test',
      data: { ohne: 1, type: 'hello' },
    });
  }
}

/**
 * The titles of the pages posted into `frame`.
 */
function titles(frame: Frame): (string | undefined)[] {
  return frame.posts
    .filter((message) => message.type === 'data')
    .map((message) => message.page?.title);
}

describe('previewPane', () => {
  it('mints a new token when the editor signs in again, and frames and drafts under it', async () => {
    const { draft, frame } = await mount('/a', page('a'));
    await wait(300);
    signIns.value++;
    await wait(0);
    draft.value = page('a', 'Renamed');
    await wait(300);
    deepStrictEqual(frame.loads, ['http://site.test/a?preview=t', 'http://site.test/a?preview=t1']);
    deepStrictEqual(puts.at(-1), 'PUT /cms/preview/tokens/t1');
  });

  it('shows why there is no page as prose, without links', async () => {
    const reason = ref('This address belongs to `Contact`.');
    await mount('/new', undefined, { missing: () => reason.value });
    reason.value = 'Add an address';
    await wait(0);
    deepStrictEqual(proses.slice(-2), [
      ['This address belongs to `Contact`.', { links: false }],
      ['Add an address', { links: false }],
    ]);
  });

  it('loads a page framed before its first draft again once the draft is stored', async () => {
    const { draft, frame } = await mount('/about', undefined);
    await wait(300);
    deepStrictEqual(frame.loads.length, 1);
    draft.value = page('about');
    await wait(50);
    deepStrictEqual(frame.loads.length, 2);
    hello(frame);
    draft.value = page('about', 'Edited');
    await wait(50);
    deepStrictEqual([frame.loads.length, titles(frame)], [2, ['Edited']]);
  });

  it('loads a slug changed while the form was invalid again once the draft is stored', async () => {
    const { path, draft, frame } = await mount('/a', page('a'));
    await wait(300);
    hello(frame);
    draft.value = undefined;
    path.value = '/b';
    await wait(300);
    deepStrictEqual(frame.loads.length, 2);
    draft.value = page('b');
    await wait(50);
    deepStrictEqual(frame.loads.length, 3);
  });

  it('loads a slug changed while a valid draft waited again once the new draft is stored', async () => {
    const { path, draft, frame } = await mount('/a', page('a'));
    await wait(300);
    hello(frame);
    draft.value = page('a', 'Edited');
    draft.value = undefined;
    path.value = '/b';
    await wait(300);
    deepStrictEqual(frame.loads.length, 2);
    draft.value = page('b');
    await wait(50);
    deepStrictEqual(frame.loads.length, 3);
  });

  it('posts the newest draft stored before the frame said hello', async () => {
    const { draft, frame } = await mount('/about', undefined);
    await wait(300);
    draft.value = page('about', 'H');
    await wait(50);
    draft.value = page('about', 'He');
    await wait(50);
    draft.value = page('about', 'Hello');
    await wait(50);
    hello(frame);
    deepStrictEqual([frame.loads.length, titles(frame)], [2, ['Hello']]);
  });

  it('streams the edits of a page that had a draft from the start, never loading it again', async () => {
    const { draft, frame } = await mount('/x', page('x'));
    await wait(300);
    hello(frame);
    draft.value = page('x', 'B');
    await wait(50);
    draft.value = page('x', 'C');
    await wait(50);
    deepStrictEqual([frame.loads.length, titles(frame)], [1, ['B', 'C']]);
  });

  it('loads a new slug typed with a valid draft once', async () => {
    const { path, draft, frame } = await mount('/a', undefined);
    await wait(300);
    path.value = '/ab';
    draft.value = page('ab');
    await wait(300);
    deepStrictEqual(frame.loads.length, 2);
  });

  it('never loads a connected frame again on a save that keeps its path', async () => {
    const { saved, frame } = await mountSaved('about');
    hello(frame);
    saved.value = { slug: 'about' };
    await wait(300);
    deepStrictEqual(frame.loads.length, 1);
  });

  it('loads a frame that never said hello once on a save that keeps its path', async () => {
    const { saved, frame } = await mountSaved('about');
    saved.value = { slug: 'about' };
    await wait(300);
    deepStrictEqual(frame.loads.length, 2);
  });

  it('loads the new page once on a save that changes the slug', async () => {
    const { saved, draft, frame } = await mountSaved('a');
    hello(frame);
    draft.value = page('b');
    await wait(50);
    saved.value = { slug: 'b' };
    await wait(300);
    deepStrictEqual(frame.loads, ['http://site.test/a?preview=t', 'http://site.test/b?preview=t']);
  });

  it('never loads a connected frame again when its slug moves and returns before the load', async () => {
    const { saved, frame } = await mountSaved('a');
    hello(frame);
    saved.value = { slug: 'b' };
    await wait(50);
    saved.value = { slug: 'a' };
    await wait(300);
    deepStrictEqual(frame.loads, ['http://site.test/a?preview=t']);
  });

  it('loads the new page of a frame that never said hello once on a save that changes the slug', async () => {
    const { saved, draft, frame } = await mountSaved('a');
    draft.value = page('b');
    await wait(50);
    saved.value = { slug: 'b' };
    await wait(300);
    deepStrictEqual(frame.loads, ['http://site.test/a?preview=t', 'http://site.test/b?preview=t']);
  });

  it('loads the new page of a frame that never said hello once when the save rereads its draft', async () => {
    const { saved, draft, frame } = await mountSaved('a');
    draft.value = page('b');
    await wait(50);
    saved.value = { slug: 'b' };
    draft.value = page('b');
    await wait(300);
    deepStrictEqual(frame.loads, ['http://site.test/a?preview=t', 'http://site.test/b?preview=t']);
  });

  it('a first record read before the frame loads waits for the draft', async () => {
    const loaded = ref<{ slug?: string }>({});
    const path = (): string | undefined =>
      isUndefined(loaded.value.slug) ? undefined : `/${loaded.value.slug}`;
    const { draft, frame } = await mount('', undefined, { path, saves: () => loaded.value });
    loaded.value = { slug: 'new' };
    draft.value = page('new');
    await wait(300);
    await wait(0);
    deepStrictEqual(
      [events, frame.loads],
      [['put /new', 'load http://site.test/new?preview=t'], ['http://site.test/new?preview=t']],
    );
  });

  it('frames a page only its draft holds once its first draft is stored, loading it once', async () => {
    const { pane, draft, frame } = await mount('/new', undefined, { fresh: () => true });
    await wait(300);
    const before = [pane.controls(), [...frame.loads]];
    draft.value = page('new');
    await wait(50);
    await wait(300);
    deepStrictEqual(
      [before, pane.controls(), events],
      [[false, []], true, ['put /new', 'load http://site.test/new?preview=t']],
    );
  });

  it('keeps framing a page only its draft holds when its form errs again', async () => {
    const { pane, draft, frame } = await mount('/new', undefined, { fresh: () => true });
    draft.value = page('new');
    await wait(50);
    await wait(300);
    draft.value = undefined;
    await wait(300);
    deepStrictEqual([pane.controls(), frame.loads.length], [true, 1]);
  });

  it('stores the draft again for a new page whose path turns up after it, then streams its edits', async () => {
    const at = ref<string | undefined>(undefined);
    const { pane, draft, frame } = await mount('', undefined, {
      fresh: () => true,
      path: () => at.value,
    });
    draft.value = page('new');
    await wait(50);
    at.value = '/new';
    await wait(50);
    await wait(300);
    hello(frame);
    draft.value = page('new', 'Edited');
    await wait(50);
    deepStrictEqual(
      [pane.controls(), events, titles(frame)],
      [
        true,
        ['put undefined', 'put /new', 'load http://site.test/new?preview=t', 'put /new'],
        ['Edited'],
      ],
    );
  });

  it('loads a new page again after its address leaves and returns, once the draft is stored', async () => {
    const at = ref<string | undefined>('/a');
    const { draft, frame } = await mount('', undefined, {
      fresh: () => true,
      path: () => at.value,
    });
    draft.value = page('a');
    await wait(50);
    await wait(300);
    events.length = 0;
    at.value = undefined;
    draft.value = page('ax');
    await wait(50);
    at.value = '/a';
    draft.value = page('a');
    await wait(50);
    await wait(300);
    deepStrictEqual(
      [events, frame.loads.at(-1)],
      [
        ['put undefined', 'put /a', 'load http://site.test/a?preview=t'],
        'http://site.test/a?preview=t',
      ],
    );
  });

  it('waits again for the draft of a translation the record has no row in', async () => {
    const fresh = ref(false);
    const { pane, path, draft, frame } = await mount('/about', page('about'), {
      fresh: () => fresh.value,
    });
    await wait(300);
    fresh.value = true;
    path.value = '/de/about';
    draft.value = undefined;
    const waiting = pane.controls();
    draft.value = page('about', 'Title', 'de');
    await wait(50);
    await wait(300);
    deepStrictEqual(
      [waiting, pane.controls(), frame.loads.at(-1)],
      [false, true, 'http://site.test/de/about?preview=t'],
    );
  });
});
