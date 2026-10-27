import type { BlockAction, Child } from 'ohnejs/dashboard';

import {
  api,
  attachTooltip,
  button,
  css,
  h,
  renderProse,
  signInCount,
  useT,
  when,
} from 'ohnejs/dashboard';
import { effect, isString, isUndefined, onCleanup, ref, untracked } from 'ohnejs/utils';

import { frameURL } from './cms-meta.ts';

const PROTOCOL = 1;
const HELLO_WAIT = 5000;
const PUSH_DELAY = 50;
const LOAD_DELAY = 300;

/**
 * What the preview pane shows and reports.
 */
export interface PreviewPaneOptions {
  /**
   * The site path of the page to frame; `undefined` shows `missing` instead.
   */
  path: () => string | undefined;

  /**
   * Whether the page exists only in its draft, as a new record's or a new translation's does.
   * Such a page shows `missing` until a draft of it is stored, then frames on while the form errs.
   */
  fresh: () => boolean;

  /**
   * The unsaved state to show, as a draft body.
   * It is `undefined` until the form loads.
   */
  draft: () => Record<string, unknown> | undefined;

  /**
   * Why there is no page to frame, shown in its place as markdown-lite.
   */
  missing: () => string;

  /**
   * Whether the viewer may change the record, so the site offers its block tools.
   */
  editable: () => boolean;

  /**
   * The `UUID` of the block the editor has selected.
   */
  focused: () => string | undefined;

  /**
   * The `UUID` of the block the pointer or the keyboard rests on in the tree.
   */
  highlighted: () => string | undefined;

  /**
   * What the site's toolbar needs to know of each block, by the id it marks the block with.
   */
  blocks: () => Record<string, PreviewBlock>;

  /**
   * Changes on every save, so a site without the client reloads to show the saved record.
   */
  saves: () => unknown;

  /**
   * Called when a block is clicked in the site.
   */
  onSelect: (uuid: string) => void;

  /**
   * Called when undo, redo, or save is pressed inside the site.
   */
  onKey: (action: 'undo' | 'redo' | 'save') => void;

  /**
   * Called when a block's toolbar button or key is used inside the site.
   */
  onAction: (action: BlockAction, uuid: string) => void;
}

/**
 * What the site's toolbar knows of one block.
 */
export interface PreviewBlock {
  /**
   * The block's label, shown in its chip.
   */
  label: string;

  /**
   * Whether it is first in its list, so it cannot move up.
   */
  first: boolean;

  /**
   * Whether it is last in its list, so it cannot move down.
   */
  last: boolean;

  /**
   * Whether a block can be added inside it: it holds exactly one blocks list.
   */
  inside: boolean;
}

const ACTIONS = new Set<string>([
  'moveUp',
  'moveDown',
  'addBefore',
  'addInside',
  'addAfter',
  'duplicate',
  'delete',
  'copy',
  'cut',
  'paste',
]);

/**
 * The preview pane: the frame and the parts of the footer that act on it.
 */
export interface PreviewPane {
  /**
   * The framed site, or the reason it is missing.
   */
  element: HTMLElement;

  /**
   * The frame's size readout and its Reload button.
   */
  controls: Child;
}

css`
  .o-cms-pv {
    position: relative;
    flex: 1;
    display: flex;
  }

  .o-cms-pv-iframe {
    flex: 1;
    width: 100%;
    height: 100%;
    border: none;
    /* The site reads its color scheme from this frame, so a fixed white hides a dark site's text. */
    background-color: Canvas;
    border-radius: var(--ohne-radius);
  }

  .ohne-resizing .o-cms-pv-iframe {
    pointer-events: none;
  }

  .o-cms-pv-missing {
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 1.5rem;
    border: 1px dashed hsl(var(--ohne-border));
    border-radius: var(--ohne-radius);
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.875rem;
    text-align: center;
  }

  .o-cms-pv-silent {
    position: absolute;
    right: 0.75rem;
    bottom: 0.75rem;
    left: 0.75rem;
    padding: 0.75rem;
    border-width: 1px;
    border-radius: var(--ohne-radius);
    background-color: hsl(var(--ohne-background));
    font-size: 0.8125rem;
  }

  .o-cms-pv-silent ul {
    margin: 0.375rem 0 0;
    list-style: disc;
    padding-left: 1.25rem;
    color: hsl(var(--ohne-muted-foreground));
  }

  .o-cms-pv-dimensions {
    display: inline-flex;
    align-items: center;
    margin-right: 0.25rem;
    margin-left: auto;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.6875rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
`;

/**
 * Frames the website at a record's page and keeps it in step with the editor, keystroke by keystroke.
 * It mints a preview token, frames the page through `cms.previewURL`, and stores each draft under the token.
 * The page the draft yields is posted into the frame, which applies it or fetches it again.
 * Only messages from that frame, at that page's origin, are trusted; none is ever posted to `'*'`.
 * A site that never says hello within five seconds gets a note naming the usual causes.
 * It then reloads on every save, so even a site without the client shows the saved record.
 */
export function previewPane(options: PreviewPaneOptions): PreviewPane {
  const t = useT();
  const iframe = h('iframe', { class: 'o-cms-pv-iframe' }) as HTMLIFrameElement;
  const connected = ref(false);
  const silent = ref(false);
  const size = ref({ width: 0, height: 0 });
  const token = ref<string | undefined>(undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stored: string | undefined;
  // A frame loaded before its path had a draft shows the site without it, which streamed data cannot fix.
  let stale = false;
  let missed: unknown;
  const kept = ref(false);

  let mints = 0;
  effect(() => {
    // A token belongs to the session it was minted in, so a sign-in in place needs a new one.
    void signInCount();
    const mint = ++mints;
    void untracked(() => api('POST /cms/preview/tokens')).then(async (response) => {
      if (!response.ok) return;
      const { token: minted } = (await response.json()) as { token: string };
      if (mint === mints) token.value = minted;
    });
  });

  const url = (): string | undefined => {
    const path = options.path();
    if (isUndefined(path) || isUndefined(token.value)) return undefined;
    return options.fresh() && !kept.value ? undefined : frameURL(path, token.value);
  };

  effect(() => {
    if (!options.fresh()) kept.value = false;
  });

  const origin = (): string | undefined => {
    const target = url();
    return isUndefined(target) ? undefined : new URL(target).origin;
  };

  const post = (type: string, payload: Record<string, unknown> = {}): void => {
    const target = untracked(origin);
    if (!untracked(() => connected.value) || isUndefined(target)) return;
    iframe.contentWindow?.postMessage({ ohne: PROTOCOL, type, ...payload }, target);
  };

  let loadTimer: ReturnType<typeof setTimeout> | undefined;
  let framed: string | undefined;
  const load = (): void => {
    const target = untracked(url);
    if (isUndefined(target)) return;
    connected.value = false;
    silent.value = false;
    stale = stored !== untracked(options.path);
    missed = undefined;
    clearTimeout(loadTimer);
    framed = target;
    iframe.src = target;
  };

  // A page the draft names, like a new one by its slug, exists only once that draft is stored.
  effect(() => {
    const target = url();
    clearTimeout(loadTimer);
    // A save hands over a new record, which reruns this with the same address.
    if (target === framed) return;
    stale = false;
    if (isUndefined(target)) {
      // The frame leaves the DOM, and back in it would load its old address before the draft lands.
      framed = undefined;
      iframe.removeAttribute('src');
      return;
    }
    loadTimer = setTimeout(() => void flush().then(load), LOAD_DELAY);
  });

  let first = true;
  effect(() => {
    void options.saves();
    if (first) first = false;
    else if (!isUndefined(framed) && !untracked(() => connected.value)) {
      untracked(load);
      // The page framed is the saved record, which the draft stored after it only repeats.
      stale = false;
    }
  });

  let pending: (Record<string, unknown> & { path: string | undefined }) | undefined;
  let pushing: Promise<void> = Promise.resolve();
  let pushTimer: ReturnType<typeof setTimeout> | undefined;

  // One request at a time, the newest draft winning, so a slow answer never lands after a newer one.
  const flush = (): Promise<void> => {
    clearTimeout(pushTimer);
    pushing = pushing.then(async () => {
      const draft = pending;
      pending = undefined;
      if (isUndefined(draft) || isUndefined(token.value)) return;
      const response = await api(`PUT /cms/preview/tokens/${token.value}`, {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      }).catch(() => undefined);
      const page: unknown = response?.ok ? await response.json().catch(() => undefined) : undefined;
      if (isUndefined(page)) return;
      stored = draft.path;
      // A draft that lands after a switch to another page must not open that page's frame.
      const framing = !isUndefined(draft.path) && draft.path === untracked(options.path);
      if (framing && untracked(options.fresh)) kept.value = true;
      if (!isUndefined(pending)) return;
      if (stale) load();
      else if (untracked(() => connected.value)) post('data', { page });
      else missed = page;
    });
    return pushing;
  };

  const queue = (draft: Record<string, unknown>, path: string | undefined): void => {
    pending = { ...draft, path };
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => void flush(), PUSH_DELAY);
  };

  effect(() => {
    const draft = options.draft();
    if (isUndefined(token.value) || isUndefined(draft)) return;
    // The path is the draft's own, as the slug it names may change before the push runs.
    queue(draft, untracked(options.path));
  });

  // A new page's path can turn up after its draft, as when an address another page held frees.
  effect(() => {
    const path = options.path();
    if (isUndefined(path) || path === stored || !untracked(options.fresh)) return;
    const draft = untracked(options.draft);
    if (isUndefined(untracked(() => token.value)) || isUndefined(draft)) return;
    if (pending?.path !== path) queue(draft, path);
  });

  iframe.addEventListener('load', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!connected.value) silent.value = true;
    }, HELLO_WAIT);
  });

  const onMessage = (event: MessageEvent): void => {
    const data = event.data as {
      ohne?: unknown;
      type?: unknown;
      block?: unknown;
      action?: unknown;
      op?: unknown;
    };
    if (event.source !== iframe.contentWindow || event.origin !== untracked(origin)) return;
    if (data?.ohne !== PROTOCOL) return;
    if (data.type === 'hello') {
      connected.value = true;
      silent.value = false;
      post('setup', { v: PROTOCOL, editable: untracked(options.editable), texts: texts() });
      post('state', { blocks: untracked(options.blocks) });
      post('focus', { block: untracked(options.focused) ?? null });
      if (!isUndefined(missed)) post('data', { page: missed });
      missed = undefined;
    } else if (data.type === 'select' && isString(data.block)) {
      options.onSelect(data.block);
    } else if (
      data.type === 'key' &&
      (data.action === 'undo' || data.action === 'redo' || data.action === 'save')
    ) {
      options.onKey(data.action);
    } else if (data.type === 'action' && ACTIONS.has(String(data.op)) && isString(data.block)) {
      options.onAction(data.op as BlockAction, data.block);
    }
  };
  window.addEventListener('message', onMessage);

  const resize = new ResizeObserver(([entry]) => {
    if (entry) size.value = { width: entry.contentRect.width, height: entry.contentRect.height };
  });
  resize.observe(iframe);

  onCleanup(() => {
    clearTimeout(timer);
    clearTimeout(loadTimer);
    clearTimeout(pushTimer);
    window.removeEventListener('message', onMessage);
    resize.disconnect();
  });

  effect(() => {
    const block = options.focused();
    if (connected.value) untracked(() => post('focus', { block: block ?? null }));
  });
  effect(() => {
    const block = options.highlighted();
    if (connected.value) untracked(() => post('highlight', { block: block ?? null }));
  });
  effect(() => {
    const blocks = options.blocks();
    if (connected.value) untracked(() => post('state', { blocks }));
  });

  /**
   * The toolbar's button titles, in the dashboard's language.
   */
  function texts(): Record<string, string> {
    return {
      moveUp: t('dashboard.sort.moveUp'),
      moveDown: t('dashboard.sort.moveDown'),
      addBefore: t('dashboard.sort.addBefore'),
      addInside: t('dashboard.sort.addInside'),
      addAfter: t('dashboard.sort.addAfter'),
      duplicate: t('dashboard.duplicate'),
      delete: t('dashboard.delete'),
    };
  }

  iframe.addEventListener('mouseleave', () => post('highlight', { block: null }));

  const reason = h('div', { class: 'ohne-prose ohne-text' });
  effect(() => renderProse(reason, options.missing(), { links: false }));

  const reload = button(() => t('cms.liveView.reload'), {
    icon: 'refresh',
    iconOnly: true,
    variant: 'outline',
    onClick: load,
  });

  const dimensions = h(
    'span',
    { class: 'o-cms-pv-dimensions' },
    () => `${Math.round(size.value.width)} × ${Math.round(size.value.height)}`,
  );
  onCleanup(attachTooltip(dimensions, () => t('cms.liveView.dimensions')));

  return {
    element: h(
      'div',
      { class: 'o-cms-pv' },
      when(
        () => !isUndefined(url()),
        () => iframe,
        () => h('div', { class: 'o-cms-pv-missing' }, reason),
      ),
      when(
        () => silent.value,
        () =>
          h(
            'div',
            { class: 'o-cms-pv-silent' },
            h('strong', null, () => t('cms.liveView.silent.title')),
            h(
              'ul',
              null,
              h('li', null, () => t('cms.liveView.silent.client')),
              h('li', null, () => t('cms.liveView.silent.framing')),
              h('li', null, () => t('cms.liveView.silent.origin')),
            ),
          ),
      ),
    ),
    controls: when(
      () => !isUndefined(url()),
      () => [dimensions, reload],
    ),
  };
}
