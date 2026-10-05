import type { Child } from 'ohnejs/dashboard';

import { attachTooltip, button, css, h, icon, useT, when } from 'ohnejs/dashboard';
import { effect, isUndefined, onCleanup, ref, untracked } from 'ohnejs/utils';

const PROTOCOL = 1;
const HELLO_WAIT = 5000;

/**
 * What the preview pane shows and reports.
 */
export interface PreviewPaneOptions {
  /**
   * The page to frame, absolute; `undefined` shows `missing` instead.
   */
  url: () => string | undefined;

  /**
   * Why there is no page to frame, shown in its place.
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
   * Each block's label by its `UUID`, for the chip the site draws.
   */
  labels: () => Record<string, string>;

  /**
   * Changes on every save, so the frame reloads to show the saved record.
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
}

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
    background-color: white;
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
 * Frames the website at a record's page and keeps it in step with the editor.
 * Only messages from that frame, at that page's origin, are trusted; none is ever posted to `'*'`.
 * A site that never says hello within five seconds gets a note naming the usual causes.
 * Every save reloads the frame, so even a site without the client shows the saved record.
 */
export function previewPane(options: PreviewPaneOptions): PreviewPane {
  const t = useT();
  const iframe = h('iframe', { class: 'o-cms-pv-iframe' }) as HTMLIFrameElement;
  const connected = ref(false);
  const silent = ref(false);
  const size = ref({ width: 0, height: 0 });
  let timer: ReturnType<typeof setTimeout> | undefined;

  const origin = (): string | undefined => {
    const url = options.url();
    return isUndefined(url) ? undefined : new URL(url).origin;
  };

  const post = (type: string, payload: Record<string, unknown> = {}): void => {
    const target = untracked(origin);
    if (!untracked(() => connected.value) || isUndefined(target)) return;
    iframe.contentWindow?.postMessage({ ohne: PROTOCOL, type, ...payload }, target);
  };

  const load = (): void => {
    const url = untracked(options.url);
    if (isUndefined(url)) return;
    connected.value = false;
    silent.value = false;
    iframe.src = url;
  };

  // A save that also moves the page, as a changed slug does, still loads it once.
  effect(() => {
    void options.url();
    void options.saves();
    untracked(load);
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
    };
    if (event.source !== iframe.contentWindow || event.origin !== untracked(origin)) return;
    if (data?.ohne !== PROTOCOL) return;
    if (data.type === 'hello') {
      connected.value = true;
      silent.value = false;
      post('setup', { v: PROTOCOL, editable: untracked(options.editable) });
      post('state', { labels: untracked(options.labels) });
      post('focus', { block: untracked(options.focused) ?? null });
    } else if (data.type === 'select' && typeof data.block === 'string') {
      options.onSelect(data.block);
    } else if (
      data.type === 'key' &&
      (data.action === 'undo' || data.action === 'redo' || data.action === 'save')
    ) {
      options.onKey(data.action);
    }
  };
  window.addEventListener('message', onMessage);

  const resize = new ResizeObserver(([entry]) => {
    if (entry) size.value = { width: entry.contentRect.width, height: entry.contentRect.height };
  });
  resize.observe(iframe);

  onCleanup(() => {
    clearTimeout(timer);
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
    const labels = options.labels();
    if (connected.value) untracked(() => post('state', { labels }));
  });

  iframe.addEventListener('mouseleave', () => post('highlight', { block: null }));

  const reload = button(icon('refresh'), { variant: 'outline', onClick: load });
  onCleanup(attachTooltip(reload, () => t('cms.liveView.reload')));

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
        () => !isUndefined(options.url()),
        () => iframe,
        () => h('div', { class: 'o-cms-pv-missing' }, () => options.missing()),
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
      () => !isUndefined(options.url()),
      () => [dimensions, reload],
    ),
  };
}
