import type {
  BlockNode,
  BlocksHandle,
  BlocksTree,
  Child,
  DashboardCollection,
} from 'ohnejs/dashboard';

import { effectiveContentLocale } from 'app/components/content-language-switcher.ts';
import { historyButtons } from 'app/components/history-buttons.ts';
import {
  recordEditorFooter,
  recordEditorHeading,
  useRecordEditor,
} from 'app/components/record-editor.ts';
import { sidebarExpanded, toggleSidebar, useWideShell } from 'app/components/shell.ts';
import {
  attachTooltip,
  blockIcon,
  blocksHandleOf,
  blocksTree,
  button,
  container,
  css,
  dashboardMeta,
  h,
  icon,
  iconGroup,
  resizer,
  tab,
  tabs,
  useHotkeys,
  useT,
  when,
} from 'ohnejs/dashboard';
import {
  computed,
  effect,
  isArray,
  isUndefined,
  onCleanup,
  readStored,
  ref,
  writeStored,
} from 'ohnejs/utils';

import { pagePath } from './cms-meta.ts';
import { type PreviewBlock, previewPane } from './cms-preview-pane.ts';
import { sharePopup } from './cms-share-popup.ts';

const STORAGE_KEY = 'ohne-cms-live-view';
const LEFT_WIDTH = 272;
const RIGHT_WIDTH = 400;
const MIDDLE_MIN = 320;

css`
  .o-cms-lv {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .o-cms-lv-header {
    padding: calc(0.75rem + 1px) 0.75rem 0.75rem;
    border-bottom-width: 1px;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .o-cms-lv-wrapper {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  .o-cms-lv-panel-left,
  .o-cms-lv-panel-right {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 17rem;
    max-width: 100%;
  }

  .o-cms-lv-panel-left {
    border-right-width: 1px;
  }

  .o-cms-lv-panel-right {
    border-left-width: 1px;
  }

  .o-cms-lv-panel-left > .ohne-tabs,
  .o-cms-lv-trees {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 0.75rem;
  }

  .o-cms-lv-trees,
  .o-cms-lv-panel-left .ohne-tabs-content {
    --ohne-card: var(--ohne-background);
    flex: 1;
    min-height: 0;
  }

  .o-cms-lv-panel-left .ohne-tabs-content:not(:first-child) {
    margin-top: 0.75rem;
  }

  .o-cms-lv-panel-left .ohne-tabs-content > div {
    height: 100%;
  }

  .o-cms-lv-panel-middle {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .o-cms-lv-panel-live {
    position: relative;
    flex: 1;
    display: flex;
    padding: 0.75rem;
  }

  .o-cms-lv-panel-right > .ohne-container {
    flex: 1;
  }

  .o-cms-lv-panel-right > .ohne-container > .ohne-container-content {
    padding: 0.75rem;
  }

  .o-cms-lv-panel-right > .ohne-resizer {
    z-index: 98;
  }

  .o-cms-lv-footer {
    display: flex;
    gap: 0.5rem;
    padding: 0.75rem;
    border-top-width: 1px;
  }

  .o-cms-lv-footer-middle {
    align-items: center;
    min-height: calc(3.5625rem);
  }

  .o-cms-lv-has-tree .o-cms-lv-panel-right .o-history-buttons {
    display: none;
  }

  .o-cms-lv-add {
    display: flex;
    gap: 0.5rem;
    margin-left: auto;
  }

  .o-cms-lv-breadcrumbs {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .o-cms-lv-breadcrumb {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 100%;
    padding: 0;
    background: none;
    border: none;
    color: hsl(var(--ohne-muted-foreground));
    font: inherit;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
  }

  .o-cms-lv-breadcrumb:hover,
  .o-cms-lv-breadcrumb:focus-visible {
    color: hsl(var(--ohne-foreground));
  }

  .o-cms-lv-breadcrumb-active,
  .o-cms-lv-breadcrumb-active:hover {
    flex-shrink: 0;
    max-width: 50%;
    color: hsl(var(--ohne-foreground));
    cursor: default;
  }

  .o-cms-lv-breadcrumb-separator {
    color: hsl(var(--ohne-muted-foreground));
  }

  .o-cms-lv-block {
    position: absolute;
    z-index: 98;
    top: 0;
    right: 0;
    bottom: 3.5625rem;
    display: flex;
    flex-direction: column;
    width: calc(100% + 1px);
    background-color: hsl(var(--ohne-background));
    border-left-width: 1px;
  }

  .o-cms-lv-block-header {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    border-bottom-width: 1px;
    font-size: 0.875rem;
  }

  .o-cms-lv-block-header > .ohne-icon {
    flex-shrink: 0;
    color: hsl(var(--ohne-muted-foreground));
  }

  .o-cms-lv-block-content {
    flex: 1;
    height: 0;
  }

  .o-cms-lv-block-content > .ohne-container {
    height: 100%;
  }

  .o-cms-lv-block-content > .ohne-container > .ohne-container-content {
    padding: 0.75rem;
  }

  .o-cms-lv-block-empty {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100%;
    padding: 0.75rem;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.875rem;
  }

  .o-cms-lv-fields {
    border: 0;
    margin: 0;
    padding: 0;
    min-inline-size: auto;
  }

  .o-cms-lv-header .o-cms-lv-share {
    margin-left: auto;
  }

  .o-cms-lv-panels {
    flex-shrink: 0;
    margin: -0.125rem 0;
  }

  @media (min-width: 1025px) {
    .o-cms-lv-panels {
      display: none;
    }
  }

  @media (max-width: 1024px) {
    .o-cms-lv-header .ohne-button {
      --ohne-size: -2;
    }

    .o-cms-lv-header .ohne-row > .ohne-button:first-child {
      display: none;
    }

    .o-cms-lv-panel-left,
    .o-cms-lv-panel-middle,
    .o-cms-lv-panel-right {
      flex: 1;
      display: none;
      /* Beats the remembered desktop width, which is set inline. */
      width: 100% !important;
      min-width: 100%;
      min-height: 0;
      border-width: 0;
    }

    .o-cms-lv-1 .o-cms-lv-panel-left,
    .o-cms-lv-2 .o-cms-lv-panel-middle,
    .o-cms-lv-3 .o-cms-lv-panel-right {
      display: flex;
    }

    .o-cms-lv-panel-left > .ohne-resizer,
    .o-cms-lv-panel-right > .ohne-resizer {
      display: none;
    }
  }
`;

/**
 * The live editor of a record with pages: its blocks as a tree, the website, and the fields, side by side.
 * Selecting one block opens its fields over the record's own; Escape or Close returns to the record.
 * The side panels resize down to `17rem`, never below a `320px` middle, and remember their widths.
 * A double click on a panel's edge resets its width.
 * Loading, saving, history, and the leave guard are the record editor's own, through `useRecordEditor`.
 */
export function liveView(collection: DashboardCollection, uuid: string | undefined): Child {
  useWideShell();
  const t = useT();
  const editor = useRecordEditor(collection, uuid);
  const { form, state, busy } = editor;

  const blocksFields = collection.fields.filter((field) => field.type === 'blocks');
  const draftKey = crypto.randomUUID();
  const active = ref(blocksFields[0]?.name ?? '');
  const trees = new Map<string, BlocksTree>(
    blocksFields.map((field) => [
      field.name,
      blocksTree(() => blocksHandleOf(form.value?.controlOf(field.name))),
    ]),
  );
  const tree = (): BlocksTree | undefined => trees.get(active.value);
  const selected = (): BlockNode | undefined => {
    const nodes = tree()?.selected() ?? [];
    return nodes.length === 1 ? nodes[0] : undefined;
  };
  const deselect = (): void => tree()?.select([]);

  effect(() => {
    for (const field of blocksFields) {
      const handle = blocksHandleOf(form.value?.controlOf(field.name));
      if (isUndefined(handle)) continue;
      handle.onReveal = (node) => {
        active.value = field.name;
        const target = deepestErrored(node);
        trees.get(field.name)?.select([target.$key]);
        setTimeout(() => {
          if (!target.form.focusError()) target.form.focus();
        });
      };
    }
  });

  const { listen } = useHotkeys();
  listen('close', () => {
    if (!isUndefined(selected())) deselect();
  });

  const stored = readStored(STORAGE_KEY, { left: LEFT_WIDTH, right: RIGHT_WIDTH });
  const left = ref(stored.left);
  const right = ref(stored.right);
  const remember = (): void => writeStored(STORAGE_KEY, { left: left.value, right: right.value });

  const panel = ref<number>(blocksFields.length === 0 ? 2 : 1);
  const panels = iconGroup(panel, {
    size: -1,
    showTooltips: true,
    choices: () => [
      ...(blocksFields.length === 0
        ? []
        : [{ value: 1, icon: 'cube' as const, title: t('cms.liveView.blocks') }]),
      { value: 2, icon: 'device-desktop' as const, title: t('cms.liveView.preview') },
      { value: 3, icon: 'forms' as const, title: t('cms.liveView.fields') },
    ],
  });
  panels.classList.add('o-cms-lv-panels');

  const path = (): string | undefined =>
    pagePath(
      collection,
      effectiveContentLocale(),
      editor.create ? { slug: form.value?.controlOf('slug')?.read().value } : editor.saved(),
    );

  const draft = computed((): Record<string, unknown> | undefined => {
    void editor.revision.value;
    const reading = form.value?.read();
    if (isUndefined(reading) || !isUndefined(reading.errors)) return undefined;
    const values = (reading.value ?? {}) as Record<string, unknown>;
    for (const field of blocksFields) {
      stampBlocks(values[field.name], blocksHandleOf(form.value?.controlOf(field.name)));
    }
    return {
      collection: collection.name,
      record: editor.id() === '' ? draftKey : editor.id(),
      locale: effectiveContentLocale(),
      values,
    };
  });

  const sharing = ref(false);
  const header = h(
    'div',
    { class: 'o-cms-lv-header' },
    h(
      'div',
      { class: 'ohne-row' },
      menuButton(),
      ...recordEditorHeading(editor),
      shareButton(),
      panels,
    ),
    when(
      () => sharing.value,
      () => {
        sharePopup({
          path,
          draft: () => draft.value,
          onClose: (close) =>
            void close().then(() => {
              sharing.value = false;
            }),
        });
        return null;
      },
    ),
  );

  const pane = previewPane({
    path,
    draft: () => draft.value,
    missing: () =>
      t(
        isUndefined(dashboardMeta()?.cms?.site) ? 'cms.liveView.noPreview' : 'cms.liveView.addSlug',
      ),
    editable: editor.canWrite,
    focused: () => idOf(selected()),
    highlighted: () => idOf(tree()?.highlighted()),
    blocks: () => {
      const blocks: Record<string, PreviewBlock> = {};
      const walk = (list: BlocksHandle | undefined): void => {
        const nodes = list?.nodes() ?? [];
        nodes.forEach((node, index) => {
          const children = childLists(node);
          blocks[blockID(node)] = {
            label: blockLabel(node),
            first: index === 0,
            last: index === nodes.length - 1,
            inside: children.length === 1 && (children[0]?.offered.length ?? 0) > 0,
          };
          children.forEach(walk);
        });
      };
      for (const field of blocksFields) walk(blocksHandleOf(form.value?.controlOf(field.name)));
      return blocks;
    },
    saves: editor.saved,
    onSelect: (uuid) => {
      const found = find(uuid);
      found?.tree.select([found.node.$key]);
    },
    onAction: (action, uuid) => {
      const found = find(uuid);
      found?.tree.run(action, [found.node.$key]);
    },
    onKey: (action) => {
      if (action === 'save') {
        void editor.save();
        return;
      }
      const state = action === 'undo' ? editor.history.undo() : editor.history.redo();
      if (!isUndefined(state)) editor.restore(state);
    },
  });

  const middleEl = h(
    'div',
    { class: 'o-cms-lv-panel-middle' },
    h('div', { class: 'o-cms-lv-panel-live' }, pane.element),
    h(
      'div',
      { class: 'o-cms-lv-footer o-cms-lv-footer-middle' },
      () => breadcrumbs(),
      pane.controls,
    ),
  );

  const maxOf = (side: () => number) => (): number =>
    Math.max(MIDDLE_MIN, side() + middleEl.clientWidth - MIDDLE_MIN);

  const leftEl =
    blocksFields.length === 0
      ? null
      : h(
          'div',
          { class: 'o-cms-lv-panel-left', style: () => `width: ${left.value}px` },
          blocksFields.length === 1
            ? h('div', { class: 'o-cms-lv-trees' }, trees.get(active.value)?.element)
            : tabs(
                () => blocksFields.map((field) => tab(field.name, trees.get(field.name)?.element)),
                {
                  list: () =>
                    blocksFields.map((field) => {
                      const errors = errorCount(field.name);
                      return {
                        name: field.name,
                        label: field.label,
                        bubble:
                          errors === 0
                            ? undefined
                            : { content: String(errors), variant: 'destructive' as const },
                      };
                    }),
                  active: () => active.value,
                  onChange: (name) => {
                    active.value = name;
                  },
                },
              ),
          h(
            'div',
            { class: 'o-cms-lv-footer' },
            when(
              () => editor.canWrite() && !isUndefined(form.value),
              () => historyButtons(editor.history, editor.restore),
            ),
            h('div', { class: 'o-cms-lv-add' }, () => (editor.canWrite() ? addButton() : null)),
          ),
          edge(
            left,
            'right',
            LEFT_WIDTH,
            maxOf(() => left.value),
          ),
        );

  const rightEl = h(
    'div',
    { class: 'o-cms-lv-panel-right', style: () => `width: ${right.value}px` },
    () => {
      const node = selected();
      return isUndefined(node) ? null : blockPanel(node);
    },
    recordFields(),
    recordEditorFooter(editor),
    edge(
      right,
      'left',
      RIGHT_WIDTH,
      maxOf(() => right.value),
    ),
  );

  const clamp = (): void => {
    left.value = Math.min(left.value, maxOf(() => left.value)());
    queueMicrotask(() => {
      right.value = Math.min(right.value, maxOf(() => right.value)());
    });
  };
  window.addEventListener('resize', clamp);
  onCleanup(() => window.removeEventListener('resize', clamp));

  return h(
    'div',
    {
      class: () =>
        `o-cms-lv o-cms-lv-${panel.value}` +
        (blocksFields.length === 0 ? '' : ' o-cms-lv-has-tree'),
    },
    header,
    h('div', { class: 'o-cms-lv-wrapper' }, leftEl, middleEl, rightEl),
  );

  /**
   * The header's sidebar toggle: accent while the sidebar is open.
   */
  function menuButton(): HTMLElement {
    const el = button(icon('menu-2'), { variant: 'outline', onClick: toggleSidebar });
    effect(() => {
      el.classList.toggle('ohne-button-accent', sidebarExpanded());
      el.classList.toggle('ohne-button-outline', !sidebarExpanded());
    });
    return el;
  }

  /**
   * The header's Share button, opening the share popup.
   * It waits for a saved record, a page to show, a readable draft, and the right to change the record.
   */
  function shareButton(): HTMLElement {
    const el = button(icon('share'), {
      variant: 'outline',
      class: 'o-cms-lv-share',
      disabled: () =>
        !editor.canWrite() ||
        editor.create ||
        isUndefined(dashboardMeta()?.cms?.site) ||
        isUndefined(path()) ||
        isUndefined(draft.value),
      onClick: () => {
        sharing.value = true;
      },
    });
    onCleanup(attachTooltip(el, () => t('cms.liveView.share.title')));
    return el;
  }

  /**
   * A panel's resize strip on `side`; a double click resets the width to `initial`.
   */
  function edge(
    width: typeof left,
    side: 'left' | 'right',
    initial: number,
    max: () => number,
  ): HTMLElement {
    const el = resizer(width, {
      side,
      min: LEFT_WIDTH,
      max,
      onCommit: remember,
    });
    el.addEventListener('dblclick', () => {
      width.value = Math.min(initial, max());
      remember();
    });
    return el;
  }

  /**
   * The active tree's "Add block" button, opening the block picker at the top level.
   */
  function addButton(): HTMLElement {
    const el = button(icon('cube-plus'), {
      variant: 'outline',
      onClick: () => tree()?.addTopLevel(),
    });
    onCleanup(attachTooltip(el, () => t('dashboard.blocks.addTopLevel')));
    return el;
  }

  /**
   * The errored blocks at the top level of the blocks field `name`, for its tab's bubble.
   */
  function errorCount(name: string): number {
    const nodes = blocksHandleOf(form.value?.controlOf(name))?.nodes() ?? [];
    return nodes.filter((node) => node.own.value !== '' || node.form.errored()).length;
  }

  /**
   * The path of the selected block under the preview: its ancestors select, the block itself is plain text.
   */
  function breadcrumbs(): Child {
    const node = selected();
    if (isUndefined(node)) return null;
    const path = tree()?.pathTo(node) ?? [];
    return h(
      'div',
      { class: 'o-cms-lv-breadcrumbs' },
      path.flatMap((entry, index) => {
        const label = blockLabel(entry);
        const crumb =
          index === path.length - 1
            ? h(
                'span',
                { class: 'o-cms-lv-breadcrumb o-cms-lv-breadcrumb-active ohne-truncate' },
                label,
              )
            : h(
                'button',
                {
                  type: 'button',
                  class: 'o-cms-lv-breadcrumb ohne-truncate',
                  onClick: () => tree()?.select([entry.$key]),
                },
                label,
              );
        return index === 0
          ? [crumb]
          : [h('span', { class: 'o-cms-lv-breadcrumb-separator' }, '/'), crumb];
      }),
    );
  }

  /**
   * The selected block's fields over the record's own, with its icon, label, and a Close button.
   */
  function blockPanel(node: BlockNode): HTMLElement {
    const block = dashboardMeta()?.blocks.find((entry) => entry.name === node.block);
    const close = button([icon('x'), h('span', null, () => t('dashboard.close'))], {
      size: -2,
      variant: 'secondary',
      class: 'ohne-ml-auto',
      onClick: deselect,
    });
    const own = (block?.fields ?? []).some(
      (field) => field.name !== 'UUID' && field.type !== 'blocks',
    );
    return h(
      'div',
      { class: 'o-cms-lv-block' },
      h(
        'div',
        { class: 'o-cms-lv-block-header' },
        icon(blockIcon(block)),
        h('span', { class: 'ohne-truncate' }, block?.label ?? node.block),
        close,
      ),
      h(
        'div',
        { class: 'o-cms-lv-block-content' },
        own
          ? container(
              h('fieldset', { class: 'o-cms-lv-fields', disabled: () => busy.value }, () =>
                node.form.render({ hide: (field) => field.type === 'blocks' }),
              ),
            )
          : h('div', { class: 'o-cms-lv-block-empty' }, () => t('dashboard.noFieldsToDisplay')),
      ),
    );
  }

  /**
   * The record's own fields, without its blocks, inert while a block's fields cover them.
   */
  function recordFields(): HTMLElement {
    return container(
      h('div', { inert: () => !isUndefined(selected()) }, () => {
        if (state.value !== 'ready') return null;
        return h('fieldset', { class: 'o-cms-lv-fields', disabled: () => busy.value }, () =>
          form.value?.render({ hide: (field) => field.type === 'blocks' }),
        );
      }),
    );
  }

  /**
   * Every block of the blocks field `name`, at every depth, in tree order.
   */
  function nodesOf(name: string): BlockNode[] {
    const walk = (nodes: readonly BlockNode[]): BlockNode[] =>
      nodes.flatMap((node) => [node, ...childLists(node).flatMap((list) => walk(list.nodes()))]);
    return walk(blocksHandleOf(form.value?.controlOf(name))?.nodes() ?? []);
  }

  /**
   * The block the website marks with `uuid` and the tree showing it, made the active tab.
   */
  function find(uuid: string): { node: BlockNode; tree: BlocksTree } | undefined {
    for (const field of blocksFields) {
      const node = nodesOf(field.name).find((entry) => blockID(entry) === uuid);
      const shown = trees.get(field.name);
      if (isUndefined(node) || isUndefined(shown)) continue;
      active.value = field.name;
      return { node, tree: shown };
    }
    return undefined;
  }

  /**
   * The label of a block instance, as the tree shows it.
   */
  function blockLabel(node: BlockNode): string {
    return dashboardMeta()?.blocks.find((entry) => entry.name === node.block)?.label ?? node.block;
  }
}

/**
 * The innermost block under `node` whose own fields hold an error, so a failed save lands on it.
 */
function deepestErrored(node: BlockNode): BlockNode {
  for (const list of childLists(node)) {
    const child = list.nodes().find((entry) => entry.own.value !== '' || entry.form.errored());
    if (!isUndefined(child)) return deepestErrored(child);
  }
  return node;
}

const draftIDs = new WeakMap<object, string>();

/**
 * The id the website marks a block with: its `UUID`, or a draft id that holds until its first save.
 */
function blockID(node: BlockNode): string {
  if (!isUndefined(node.uuid)) return node.uuid;
  let id = draftIDs.get(node.form);
  if (isUndefined(id)) {
    id = crypto.randomUUID();
    draftIDs.set(node.form, id);
  }
  return id;
}

/**
 * The website id of `node`, or `undefined` without one.
 */
function idOf(node: BlockNode | undefined): string | undefined {
  return isUndefined(node) ? undefined : blockID(node);
}

/**
 * Gives every block item of a draft value the id the website marks it with, at every depth.
 * The items follow the list's nodes one to one, since a draft is read only while no control errs.
 */
function stampBlocks(value: unknown, list: BlocksHandle | undefined): void {
  if (!isArray<Record<string, unknown>[]>(value) || isUndefined(list)) return;
  const nodes = list.nodes();
  value.forEach((item, index) => {
    const node = nodes[index];
    if (isUndefined(node)) return;
    item.UUID = blockID(node);
    const fields = (item.fields ?? {}) as Record<string, unknown>;
    for (const child of childFields(node)) {
      stampBlocks(fields[child], blocksHandleOf(node.form.controlOf(child)));
    }
  });
}

/**
 * The names of the `blocks` fields a block holds.
 */
function childFields(node: BlockNode): string[] {
  const block = dashboardMeta()?.blocks.find((entry) => entry.name === node.block);
  return (block?.fields ?? [])
    .filter((field) => field.type === 'blocks')
    .map((field) => field.name);
}

/**
 * The lists of the `blocks` fields a block holds.
 */
function childLists(node: BlockNode): BlocksHandle[] {
  return childFields(node).flatMap((name) => blocksHandleOf(node.form.controlOf(name)) ?? []);
}
