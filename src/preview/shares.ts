import { badRequest, notFound, queryUntyped, translate, unauthorized } from 'ohnejs';
import { useSession } from 'ohnejs/auth';
import {
  isNullish,
  isPlainObject,
  isString,
  isUndefined,
  parseDuration,
  uniqueArray,
} from 'ohnejs/utils';
import { randomToken } from 'ohnejs/utils/crypto';

import type { Draft } from './drafts.ts';

import { useCMSConfig } from '../config.ts';
import { assertWritable, checkDraft } from './drafts.ts';
import { hashToken } from './tokens.ts';

/**
 * A shared preview link, looked up by its token's hash: one record's unsaved state, frozen when it was shared.
 */
export interface Share extends Draft {
  /**
   * The share's own `UUID`.
   */
  UUID: string;

  /**
   * The website path the link shows.
   */
  path: string;

  /**
   * The `UUID` of the user who shared it.
   */
  user: string;

  /**
   * When the link stops working, in epoch milliseconds.
   */
  expiresAt: number;
}

/**
 * A live share as its record's editors see it listed.
 */
export interface ShareSummary {
  /**
   * The share's `UUID`, the one to revoke it by.
   */
  UUID: string;

  /**
   * The locale the link shows.
   */
  locale: string;

  /**
   * The website path the link shows.
   */
  path: string;

  /**
   * When the link stops working, in epoch milliseconds.
   */
  expiresAt: number;

  /**
   * The email of the editor who shared it, or `null` once their account is gone.
   */
  user: string | null;

  /**
   * Whether the caller shared it.
   */
  mine: boolean;
}

/**
 * Freezes the caller's unsaved state of a record into a link anyone may open until it expires.
 * The body is a draft with the `path` it shows and a `duration` out of `cms.share.durations`.
 * A record never saved is a `400`: its link could not be listed or revoked once it saves under its own `UUID`.
 * The token is answered here alone; only its hash is stored.
 */
export async function createShare(
  input: unknown,
): Promise<{ UUID: string; token: string; expiresAt: number }> {
  const user = await sessionUser();
  const body = isPlainObject(input) ? input : {};
  const { path, duration } = body;
  if (!isString(path) || !path.startsWith('/')) throw badRequest(translate('cms.api.invalidPath'));
  if (!isString(duration) || !useCMSConfig().share.durations.includes(duration)) {
    throw badRequest(translate('cms.share.invalidDuration'));
  }
  const { collection, record, locale, values } = await checkDraft(body);
  if (!(await queryUntyped(collection).where({ UUID: record }).exists())) {
    throw badRequest(translate('cms.share.unsaved'));
  }
  await sweep();
  const token = randomToken();
  const expiresAt = Date.now() + parseDuration(duration);
  const { UUID } = await queryUntyped('CmsShares').createOrThrow({
    tokenHash: hashToken(token),
    collection,
    record,
    locale,
    path,
    values: JSON.stringify(values),
    user,
    expiresAt,
  });
  return { UUID: UUID as string, token, expiresAt };
}

/**
 * The live share of `token`, or `undefined` when it is unknown or expired.
 * No session binds it: a link outlives its editor's login.
 */
export async function readShare(token: string): Promise<Share | undefined> {
  const row = await queryUntyped('CmsShares')
    .where({ tokenHash: hashToken(token), expiresAt: { greaterThan: Date.now() } })
    .findFirst();
  if (isUndefined(row)) return undefined;
  return {
    UUID: row.UUID as string,
    collection: row.collection as string,
    record: row.record as string,
    locale: row.locale as string,
    path: row.path as string,
    values: JSON.parse(row.values as string) as Record<string, unknown>,
    user: row.user as string,
    expiresAt: row.expiresAt as number,
  };
}

/**
 * The live shares of a record, newest first, for a caller who may change it.
 */
export async function sharesOf(collection: unknown, record: unknown): Promise<ShareSummary[]> {
  const user = await sessionUser();
  if (
    !isString(collection) ||
    !Object.hasOwn(useCMSConfig().routes, collection) ||
    !isString(record)
  ) {
    throw badRequest(translate('cms.share.invalidRecord'));
  }
  await assertWritable(collection, record);
  const rows = await queryUntyped('CmsShares')
    .where({ collection, record, expiresAt: { greaterThan: Date.now() } })
    .orderBy('_updatedAt', 'desc')
    .findMany();
  const creators = rows.map((row) => row.user as string);
  const users = await queryUntyped('Users')
    .unscoped()
    .where({ UUID: { in: uniqueArray(creators) } })
    .select('UUID', 'email')
    .findMany();
  const emails = new Map(users.map((row) => [row.UUID as string, row.email as string]));
  return rows.map((row) => ({
    UUID: row.UUID as string,
    locale: row.locale as string,
    path: row.path as string,
    expiresAt: row.expiresAt as number,
    user: emails.get(row.user as string) ?? null,
    mine: row.user === user,
  }));
}

/**
 * Ends a share before it expires, for a caller who may change its record.
 * An unknown share is a `404`.
 */
export async function revokeShare(UUID: string): Promise<void> {
  await sessionUser();
  const row = await queryUntyped('CmsShares').where({ UUID }).findFirst();
  if (isUndefined(row)) throw notFound(translate('cms.share.notFound'));
  await assertWritable(row.collection as string, row.record as string);
  await queryUntyped('CmsShares').where({ UUID }).delete();
}

/**
 * The `UUID` of the signed-in user, or a `401`.
 */
async function sessionUser(): Promise<string> {
  const user = (await useSession())?.user;
  if (isNullish(user)) throw unauthorized(translate('cms.preview.signIn'));
  return user;
}

/**
 * Deletes every expired share.
 */
async function sweep(): Promise<void> {
  await queryUntyped('CmsShares')
    .where({ expiresAt: { atMost: Date.now() } })
    .delete();
}
