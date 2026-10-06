import type { FieldQueryMeta } from 'ohnejs';

import {
  badRequest,
  blockQueryMetadata,
  forbidden,
  HTTPError,
  queryMetadata,
  queryUntyped,
  translate,
  useBlocks,
} from 'ohnejs';
import { queryScoped } from 'ohnejs/auth';
import { isArray, isPlainObject, isString, isUndefined } from 'ohnejs/utils';

import type { PreviewToken } from './tokens.ts';

import { useCMSConfig } from '../config.ts';

/**
 * The unsaved state of one record under a preview token.
 */
export interface Draft {
  collection: string;
  record: string;
  locale: string;
  values: Record<string, unknown>;
}

/**
 * Stores the caller's unsaved state of a record under their own token, replacing the last one.
 * The caller must be allowed to update the record, or to create one when it was never saved.
 * Every field the public could not read is dropped, at any depth.
 */
export async function writeDraft(token: PreviewToken, input: unknown): Promise<Draft> {
  const draft = await checkDraft(input);
  const key = {
    tokenHash: token.tokenHash,
    collection: draft.collection,
    record: draft.record,
    locale: draft.locale,
  };
  const values = JSON.stringify(draft.values);
  const updated = await queryUntyped('CmsDrafts').where(key).updateOrThrow({ values });
  if (updated.length === 0) await queryUntyped('CmsDrafts').createOrThrow({ ...key, values });
  return draft;
}

/**
 * Every draft stored under the token.
 */
export async function draftsOf(token: PreviewToken): Promise<Draft[]> {
  const rows = await queryUntyped('CmsDrafts').where({ tokenHash: token.tokenHash }).findMany();
  return rows.map((row) => ({
    collection: row.collection as string,
    record: row.record as string,
    locale: row.locale as string,
    values: JSON.parse(row.values as string) as Record<string, unknown>,
  }));
}

/**
 * The draft body of a request, its values cleaned of every field the public could not read.
 * A malformed body is a `400`; a record the caller may not change is a `403`.
 */
export async function checkDraft(input: unknown): Promise<Draft> {
  const draft = parseDraft(input);
  await assertWritable(draft.collection, draft.record);
  draft.values = clean(draft.values, queryMetadata(draft.collection).fields);
  return draft;
}

/**
 * The draft body of a request, or a `400` naming what is wrong with it.
 */
function parseDraft(input: unknown): Draft {
  const body = isPlainObject(input) ? input : {};
  const { collection, record, locale, values } = body;
  if (
    !isString(collection) ||
    !Object.hasOwn(useCMSConfig().routes, collection) ||
    !isString(record) ||
    !isString(locale) ||
    !isPlainObject(values)
  ) {
    throw badRequest(translate('cms.preview.invalidDraft'));
  }
  return { collection, record, locale, values };
}

/**
 * Refuses a draft of a record the caller may not change.
 * That is an existing record outside their update scope, or a new one in a collection they may not create in.
 */
export async function assertWritable(collection: string, record: string): Promise<void> {
  try {
    if (await queryUntyped(collection).where({ UUID: record }).exists()) {
      const scoped = await queryScoped(collection, 'update');
      if (await scoped.where({ UUID: record }).exists()) return;
    } else {
      await queryScoped(collection, 'create');
      return;
    }
  } catch (error) {
    if (!(error instanceof HTTPError)) throw error;
  }
  throw forbidden(translate('cms.preview.notWritable'));
}

/**
 * The values with every unknown and unreadable field removed, descending into blocks and child tables.
 */
function clean(
  values: Readonly<Record<string, unknown>>,
  fields: Readonly<Record<string, FieldQueryMeta>>,
): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const meta = fields[key];
    if (isUndefined(meta) || meta.readable === false) continue;
    if (meta.kind === 'blocks') kept[key] = cleanBlocks(value);
    else if (
      (meta.kind === 'childOne' || meta.kind === 'childMany') &&
      !isUndefined(meta.subfields)
    ) {
      const subfields = meta.subfields;
      kept[key] = isArray(value)
        ? value.map((item) => (isPlainObject(item) ? clean(item, subfields) : item))
        : isPlainObject(value)
          ? clean(value, subfields)
          : value;
    } else kept[key] = value;
  }
  return kept;
}

/**
 * The block items of a draft, each item's fields cleaned by its own block's metadata.
 */
function cleanBlocks(value: unknown): unknown[] {
  if (!isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isPlainObject(item) || !isString(item.block) || isUndefined(useBlocks().get(item.block))) {
      return [];
    }
    const fields = isPlainObject(item.fields) ? item.fields : {};
    return [
      {
        block: item.block,
        UUID: isString(item.UUID) ? item.UUID : undefined,
        fields: clean(fields, blockQueryMetadata(item.block).fields),
      },
    ];
  });
}
