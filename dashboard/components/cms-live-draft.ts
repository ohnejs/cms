import type { BlockNode, BlocksHandle, FieldForm } from 'ohnejs/dashboard';

import { blocksHandleOf, dashboardMeta } from 'ohnejs/dashboard';
import { isArray, isUndefined } from 'ohnejs/utils';

const draftIDs = new WeakMap<object, string>();

/**
 * The values of `form` the website previews, as far as they parse, every block marked with its id.
 * Required fields go unchecked, so the page follows each edit while one is still empty.
 * A field that fails to parse keeps the value of the form's previous snapshot, so nothing malformed shows.
 */
export function liveValues(
  form: FieldForm,
  blocksFields: readonly string[],
): Record<string, unknown> {
  const values = form.snapshot();
  for (const name of blocksFields) stampBlocks(values[name], blocksHandleOf(form.controlOf(name)));
  return values;
}

/**
 * The id the website marks a block with: its `UUID`, or a draft id that holds until its first save.
 */
export function blockID(node: BlockNode): string {
  if (!isUndefined(node.uuid)) return node.uuid;
  let id = draftIDs.get(node.form);
  if (isUndefined(id)) {
    id = crypto.randomUUID();
    draftIDs.set(node.form, id);
  }
  return id;
}

/**
 * The names of the `blocks` fields a block holds.
 */
export function childFields(node: BlockNode): string[] {
  const block = dashboardMeta()?.blocks.find((entry) => entry.name === node.block);
  return (block?.fields ?? [])
    .filter((field) => field.type === 'blocks')
    .map((field) => field.name);
}

/**
 * Gives every block item of a snapshot the id the website marks it with, at every depth.
 * The items follow the list's nodes one to one, as a blocks snapshot answers one item per node.
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
