import type { BlockNode, BlocksTree, Child, DashboardCollection } from 'ohnejs/dashboard';

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
  resizer,
  tab,
  tabs,
  useHotkeys,
  useT,
  when,
} from 'ohnejs/dashboard';
import {
  effect,
  isUndefined,
  onCleanup,
  readStored,
  ref,
  untracked,
  writeStored,
} from 'ohnejs/utils';

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

  .o-cms-lv-header .ohne-button {
    margin-right: 0.25rem;
    margin-left: 0.25rem;
  }

  .o-cms-lv-header .ohne-button:first-child {
    margin-left: 0;
  }

  .o-cms-lv-header .ohne-button:last-child {
    margin-right: 0;
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

  .o-cms-lv-placeholder {
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

  const header = h(
    'div',
    { class: 'o-cms-lv-header' },
    h('div', { class: 'ohne-row' }, menuButton(), ...recordEditorHeading(editor)),
  );

  const middleEl = h(
    'div',
    { class: 'o-cms-lv-panel-middle' },
    h(
      'div',
      { class: 'o-cms-lv-panel-live' },
      h('div', { class: 'o-cms-lv-placeholder' }, () => t('cms.liveView.noPreview')),
    ),
    h('div', { class: 'o-cms-lv-footer o-cms-lv-footer-middle' }, () => breadcrumbs()),
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
    { class: blocksFields.length === 0 ? 'o-cms-lv' : 'o-cms-lv o-cms-lv-has-tree' },
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
  const block = untracked(dashboardMeta)?.blocks.find((entry) => entry.name === node.block);
  for (const field of block?.fields ?? []) {
    if (field.type !== 'blocks') continue;
    const child = blocksHandleOf(node.form.controlOf(field.name))
      ?.nodes()
      .find((entry) => entry.own.value !== '' || entry.form.errored());
    if (!isUndefined(child)) return deepestErrored(child);
  }
  return node;
}
