import { forbidden, queryUntyped, translate, unauthorized } from 'ohnejs';
import { useSession } from 'ohnejs/auth';
import { isNull, isUndefined } from 'ohnejs/utils';
import { digest, randomToken } from 'ohnejs/utils/crypto';

const LIFETIME = 8 * 60 * 60 * 1000;

/**
 * A preview token row, looked up by the token's hash.
 */
export interface PreviewToken {
  tokenHash: string;
  session: string;
  expiresAt: number;
}

/**
 * Mints a preview token for the signed-in editor's session, and sweeps the expired ones.
 * It expires with the session, and after eight hours at the latest.
 */
export async function mintToken(): Promise<{ token: string; expiresAt: number }> {
  const session = await useSession();
  if (isNull(session)) throw unauthorized(translate('cms.preview.signIn'));
  await sweep();
  const token = randomToken();
  const expiresAt = Math.min(Date.now() + LIFETIME, session.expiresAt);
  await queryUntyped('CmsPreviewTokens').createOrThrow({
    tokenHash: hashToken(token),
    session: session.UUID,
    expiresAt,
  });
  return { token, expiresAt };
}

/**
 * The live row of `token`, or `undefined` when it is unknown, expired, or its session has ended.
 */
export async function readToken(token: string): Promise<PreviewToken | undefined> {
  const row = (await queryUntyped('CmsPreviewTokens')
    .where({ tokenHash: hashToken(token) })
    .findFirst()) as PreviewToken | undefined;
  if (isUndefined(row) || row.expiresAt <= Date.now()) return undefined;
  const session = await queryUntyped('Sessions')
    .unscoped()
    .where({ UUID: row.session, expiresAt: { greaterThan: Date.now() } })
    .exists();
  return session ? row : undefined;
}

/**
 * The live row of `token` when it belongs to the caller's own session; anything else is refused.
 */
export async function ownToken(token: string): Promise<PreviewToken> {
  const row = await readToken(token);
  const session = await useSession();
  if (isUndefined(row) || isNull(session) || session.UUID !== row.session) {
    throw forbidden(translate('cms.preview.invalidToken'));
  }
  return row;
}

/**
 * Deletes every expired token and the drafts kept under it.
 */
async function sweep(): Promise<void> {
  const hashes = await queryUntyped('CmsPreviewTokens')
    .where({ expiresAt: { atMost: Date.now() } })
    .pluck('tokenHash');
  if (hashes.length === 0) return;
  await queryUntyped('CmsDrafts')
    .where({ tokenHash: { in: hashes } })
    .delete();
  await queryUntyped('CmsPreviewTokens')
    .where({ tokenHash: { in: hashes } })
    .delete();
}

/**
 * The stored form of a token: its SHA-256, base64url-encoded.
 */
export function hashToken(token: string): string {
  return digest('sha256', token).toBase64({ alphabet: 'base64url', omitPadding: true });
}
