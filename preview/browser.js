// Served as `/cms/preview.js`. The API writes the dashboard origin in, so only that window is ever trusted.
const DASHBOARD = '__OHNE_DASHBOARD_ORIGIN__';
const PROTOCOL = 1;
const SCROLL_INSET = 32;
const FOCUS_WAIT = 500;

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

  .label {
    display: flex;
    align-items: center;
    max-width: 100%;
    height: 1.125rem;
    padding: 0 0.375rem;
    overflow: hidden;
    border-bottom-left-radius: 0.25rem;
    background-color: var(--ohne-preview, #4c7be5);
    color: var(--ohne-preview-foreground, #ffffff);
    font: 0.75rem/1rem var(--ohne-font-family, Arial, sans-serif);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .label.above {
    max-width: calc(100% + 4px);
    border-radius: 0.25rem 0.25rem 0 0;
    transform: translate3d(2px, calc(-100% - 3px), 0);
  }

  .label.faded {
    opacity: 0.64;
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
 */
function start(options) {
  const state = {
    editable: false,
    labels: {},
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
    const label = state.labels[uuid];
    if (deepest && label) {
      const chip = document.createElement('span');
      chip.className = 'label' + (box.top > 24 ? ' above' : '') + (solid ? '' : ' faded');
      chip.textContent = label;
      rect.append(chip);
    }
    return rect;
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
      redraw();
    } else if (data.type === 'state') {
      state.labels = data.labels ?? {};
      redraw();
    } else if (data.type === 'highlight') {
      state.highlighted = data.block ?? undefined;
      redraw();
    } else if (data.type === 'focus') {
      focus(data.block);
    } else if (data.type === 'refresh') {
      if (options.onRefresh) options.onRefresh();
      else location.reload();
    }
  });

  listen(
    document,
    'pointermove',
    (event) => {
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
