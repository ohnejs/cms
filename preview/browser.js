// Served as `/cms/preview.js`. The API writes the dashboard origin in, so only that window is ever trusted.
const DASHBOARD = '__OHNE_DASHBOARD_ORIGIN__';
const PROTOCOL = 1;
const SCROLL_INSET = 32;
const FOCUS_WAIT = 500;
const TOOLBAR_MIN = { width: 196, height: 24 };

// Tabler icons, MIT: the toolbar draws them itself, since a site loads no icon set of ours.
const ICONS = {
  moveDown: '<path d="m6 9l6 6l6-6"/>',
  moveUp: '<path d="m6 15l6-6l6 6"/>',
  addAfter: '<path d="M4 20h16m-8-6V4m0 10l4-4m-4 4l-4-4"/>',
  addInside: '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0-18 0m6 0h6m-3-3v6"/>',
  addBefore: '<path d="M12 10v10m0-10l4 4m-4-4l-4 4M4 4h16"/>',
  duplicate:
    '<path d="M7 9.667A2.667 2.667 0 0 1 9.667 7h8.666A2.667 2.667 0 0 1 21 9.667v8.666A2.667 2.667 0 0 1 18.333 21H9.667A2.667 2.667 0 0 1 7 18.333z"/><path d="M4.012 16.737A2 2 0 0 1 3 15V5c0-1.1.9-2 2-2h10c.75 0 1.158.385 1.5 1"/>',
  delete:
    '<path d="M4 7h16m-10 4v6m4-6v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/>',
};

const STYLE = `
  .rect {
    position: fixed;
    display: flex;
    justify-content: flex-end;
    align-items: flex-start;
    box-sizing: border-box;
    outline: 1px dashed var(--ohne-preview, #4c7be5);
    outline-offset: 1px;
    pointer-events: none;
  }

  .rect.solid {
    outline-style: solid;
  }

  .bar {
    display: flex;
    gap: 1px;
    max-width: 100%;
    pointer-events: auto;
  }

  .bar.above {
    max-width: calc(100% + 4px);
    transform: translate3d(2px, calc(-100% - 3px), 0);
  }

  .bar.faded {
    opacity: 0.64;
  }

  .bar > *:first-child {
    border-bottom-left-radius: 0.25rem;
  }

  .bar.above > *:first-child {
    border-top-left-radius: 0.25rem;
    border-bottom-left-radius: 0;
  }

  .bar.above > *:last-child {
    border-top-right-radius: 0.25rem;
  }

  .bar button {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 1.125rem;
    height: 1.125rem;
    padding: 0;
    border: none;
    outline: none;
    background-color: var(--ohne-preview, #4c7be5);
    color: var(--ohne-preview-foreground, #ffffff);
    cursor: pointer;
  }

  .bar button:hover,
  .bar button:focus {
    background-color: var(--ohne-preview-hover, #3a6bbf);
  }

  .bar button[data-destructive]:hover,
  .bar button[data-destructive]:focus {
    background-color: var(--ohne-preview-destructive, #ef5945);
  }

  .bar button:disabled {
    pointer-events: none;
    background-color: var(--ohne-preview-disabled, #8dabef);
  }

  .bar svg {
    width: 0.875rem;
    height: 0.875rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .label {
    display: flex;
    align-items: center;
    max-width: 100%;
    height: 1.125rem;
    padding: 0 0.375rem;
    overflow: hidden;
    background-color: var(--ohne-preview, #4c7be5);
    color: var(--ohne-preview-foreground, #ffffff);
    font: 0.75rem/1rem var(--ohne-font-family, Arial, sans-serif);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
`;

let session;

/**
 * Connects this page to the ohne dashboard that frames it, once.
 * Outside a dashboard frame it does nothing and answers an inert handle.
 */
export function connect(options = {}) {
  if (window.parent === window) return { dispose() {} };
  session ??= start(options);
  return session;
}

if (new URL(import.meta.url).searchParams.has('auto')) connect();

/**
 * Says hello to the dashboard and keeps the page in step with it until disposed.
 * The preview token leaves the address bar at once, unless `keepToken`; the page refetches with it from memory.
 */
function start(options) {
  const token = takeToken(options.keepToken === true);
  const state = {
    editable: false,
    texts: {},
    blocks: {},
    hovered: undefined,
    highlighted: undefined,
    focused: undefined,
    pending: undefined,
  };
  const stops = [];

  const host = document.createElement('div');
  host.style.cssText = 'position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  const layer = document.createElement('div');
  shadow.append(style, layer);
  document.documentElement.append(host);

  const post = (type, payload = {}) =>
    window.parent.postMessage({ ohne: PROTOCOL, type, ...payload }, DASHBOARD);

  const listen = (target, type, handler, capture = false) => {
    target.addEventListener(type, handler, capture);
    stops.push(() => target.removeEventListener(type, handler, capture));
  };

  let frame = 0;
  const redraw = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  };

  function draw() {
    layer.replaceChildren();
    const focused = elementOf(state.focused);
    const shown = new Map();
    for (const uuid of [state.hovered, state.highlighted]) {
      for (const el of chainOf(elementOf(uuid))) shown.set(el, false);
    }
    for (const el of chainOf(focused)) shown.set(el, el === focused);
    for (const [el, solid] of shown) layer.append(rectOf(el, solid));
  }

  function rectOf(el, solid) {
    const box = el.getBoundingClientRect();
    const rect = document.createElement('div');
    rect.className = solid ? 'rect solid' : 'rect';
    rect.style.cssText = `top: ${box.top}px; left: ${box.left}px; width: ${box.width}px; height: ${box.height}px;`;
    const uuid = el.getAttribute('data-ohne-block');
    const deepest =
      el === elementOf(state.focused) ||
      el === elementOf(state.highlighted) ||
      el === elementOf(state.hovered);
    const block = state.blocks[uuid];
    if (!deepest || !block) return rect;
    const bar = document.createElement('div');
    bar.className = 'bar' + (box.top > 24 ? ' above' : '') + (solid ? '' : ' faded');
    const roomy = box.width >= TOOLBAR_MIN.width && box.height >= TOOLBAR_MIN.height;
    if (state.editable && roomy) {
      for (const op of Object.keys(ICONS)) {
        if (op === 'addInside' && !block.inside) continue;
        bar.append(
          buttonOf(op, uuid, (op === 'moveUp' && block.first) || (op === 'moveDown' && block.last)),
        );
      }
    }
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = block.label;
    bar.append(label);
    rect.append(bar);
    return rect;
  }

  function buttonOf(op, uuid, disabled) {
    const button = document.createElement('button');
    button.type = 'button';
    button.title = state.texts[op] ?? op;
    button.disabled = disabled;
    if (op === 'delete') button.dataset.destructive = '';
    button.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[op]}</svg>`;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      post('action', { op, block: uuid });
    });
    return button;
  }

  function focus(uuid) {
    state.focused = uuid ?? undefined;
    state.pending = undefined;
    const el = elementOf(state.focused);
    if (!el && state.focused)
      state.pending = { uuid: state.focused, until: Date.now() + FOCUS_WAIT };
    if (el && !document.hasFocus()) {
      const top = el.getBoundingClientRect().top + window.scrollY - SCROLL_INSET;
      window.scrollTo({ top, behavior: 'smooth' });
    }
    redraw();
  }

  listen(window, 'message', (event) => {
    const data = event.data;
    if (event.source !== window.parent || event.origin !== DASHBOARD) return;
    if (!data || data.ohne !== PROTOCOL) return;
    if (data.type === 'setup') {
      state.editable = data.editable === true;
      state.texts = data.texts ?? {};
      redraw();
    } else if (data.type === 'state') {
      state.blocks = data.blocks ?? {};
      redraw();
    } else if (data.type === 'highlight') {
      state.highlighted = data.block ?? undefined;
      redraw();
    } else if (data.type === 'focus') {
      focus(data.block);
    } else if (data.type === 'data') {
      if (options.onData) options.onData(data.page);
      else if (options.onRefresh) options.onRefresh();
      else void refetch(token);
    }
  });

  listen(
    document,
    'pointermove',
    (event) => {
      if (event.target === host) return;
      const uuid = blockOf(event.target);
      if (uuid === state.hovered) return;
      state.hovered = uuid;
      redraw();
    },
    true,
  );

  listen(document.documentElement, 'pointerleave', () => {
    state.hovered = undefined;
    redraw();
  });

  listen(
    document,
    'click',
    (event) => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (link && !samePage(link)) event.preventDefault();
      const uuid = blockOf(event.target);
      if (!uuid) return;
      event.preventDefault();
      focus(uuid);
      post('select', { block: uuid });
    },
    true,
  );

  listen(
    window,
    'keydown',
    (event) => {
      const mod = event.metaKey || event.ctrlKey;
      const op = state.editable && state.focused && !typing() ? blockKey(event, mod) : undefined;
      if (op === 'parent') {
        event.preventDefault();
        const parent = elementOf(state.focused)?.parentElement?.closest('[data-ohne-block]');
        const uuid = parent?.getAttribute('data-ohne-block');
        if (uuid) {
          focus(uuid);
          post('select', { block: uuid });
        }
        return;
      }
      if (op) {
        event.preventDefault();
        post('action', { op, block: state.focused });
        return;
      }
      if (!mod) return;
      const key = event.key.toLowerCase();
      const action =
        key === 's'
          ? 'save'
          : (key === 'z' && event.shiftKey) || (key === 'y' && event.ctrlKey)
            ? 'redo'
            : key === 'z'
              ? 'undo'
              : undefined;
      if (!action) return;
      event.preventDefault();
      post('key', { action });
    },
    true,
  );

  listen(window, 'focus', () => post('focus'));
  listen(window, 'blur', () => post('blur'));
  listen(window, 'scroll', redraw, true);
  listen(window, 'resize', redraw);

  const mutations = new MutationObserver(() => {
    if (state.pending && Date.now() > state.pending.until) state.pending = undefined;
    if (state.pending && elementOf(state.pending.uuid)) focus(state.pending.uuid);
    redraw();
  });
  mutations.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  stops.push(() => mutations.disconnect());

  post('hello', { v: PROTOCOL });

  return {
    dispose() {
      for (const stop of stops.splice(0)) stop();
      cancelAnimationFrame(frame);
      host.remove();
      session = undefined;
    },
  };
}

/**
 * The block action a key press asks for while a block is selected, or `undefined`.
 */
function blockKey(event, mod) {
  const key = event.key;
  if (!mod && (key === 'Delete' || key === 'Backspace')) return 'delete';
  if (!mod && key === 'Enter') return event.shiftKey ? 'addBefore' : 'addAfter';
  if (!mod && key === 'Escape') return 'parent';
  if (!mod) return undefined;
  if (key === 'ArrowUp') return 'moveUp';
  if (key === 'ArrowDown') return 'moveDown';
  const letter = key.toLowerCase();
  if (letter === 'd') return 'duplicate';
  if (letter === 'c' && !getSelection()?.toString()) return 'copy';
  if (letter === 'x' && !getSelection()?.toString()) return 'cut';
  if (letter === 'v') return 'paste';
  return undefined;
}

/**
 * Whether the visitor is typing into the page, where keys belong to the text.
 */
function typing() {
  const el = document.activeElement;
  return (
    el instanceof HTMLElement &&
    (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
  );
}

/**
 * The preview token from the address bar, removed from it unless `keep`, so it never lands in a bookmark.
 * A framework that renders again from the URL on the server, like Next, keeps it.
 */
function takeToken(keep) {
  const url = new URL(location.href);
  const token = url.searchParams.get('ohne-preview');
  if (token === null || keep) return token ?? undefined;
  url.searchParams.delete('ohne-preview');
  history.replaceState(history.state, '', url);
  return token;
}

/**
 * Renders the page again from the server with the token and swaps its body in, keeping the scroll.
 */
async function refetch(token) {
  const url = new URL(location.href);
  if (token) url.searchParams.set('ohne-preview', token);
  const html = await (await fetch(url)).text();
  const next = new DOMParser().parseFromString(html, 'text/html').body;
  const { scrollX, scrollY } = window;
  document.body.replaceWith(next);
  window.scrollTo(scrollX, scrollY);
}

/**
 * The element marked with `uuid`, or `null`.
 */
function elementOf(uuid) {
  return uuid ? document.querySelector(`[data-ohne-block="${CSS.escape(uuid)}"]`) : null;
}

/**
 * The block element and every marked ancestor, innermost first.
 */
function chainOf(el) {
  const chain = [];
  for (let at = el; at; at = at.parentElement?.closest('[data-ohne-block]') ?? null) chain.push(at);
  return chain;
}

/**
 * The `UUID` of the innermost block holding `target`, or `undefined`.
 */
function blockOf(target) {
  if (!(target instanceof Element)) return undefined;
  return target.closest('[data-ohne-block]')?.getAttribute('data-ohne-block') ?? undefined;
}

/**
 * Whether the link only moves within this page, the one kind of navigation the preview allows.
 */
function samePage(link) {
  const url = new URL(link.href, location.href);
  return url.origin === location.origin && url.pathname === location.pathname && url.hash !== '';
}
