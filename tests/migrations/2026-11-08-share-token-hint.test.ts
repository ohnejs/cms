import { strictEqual } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';
import { queryUntyped } from 'ohnejs';

import { startApp } from '../_app.ts';

describe('share token hint migration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ohne-cms-hint-'));
  const database = join(dir, 'site.db');

  after(() => rmSync(dir, { recursive: true, force: true }));

  it('boots over shares made before `tokenHint`, with an empty hint', async () => {
    const before = await startApp({}, database);
    await queryUntyped('CMSShares').createOrThrow({
      tokenHash: 'hash',
      tokenHint: 'abcd',
      collection: 'Pages',
      record: 'r1',
      locale: 'en',
      path: '/',
      values: '{}',
      user: 'u1',
      expiresAt: Date.now() + 60_000,
    });
    await before.stop();

    const db = new DatabaseSync(database);
    db.exec('ALTER TABLE "CMSShares" DROP COLUMN "tokenHint"');
    db.exec(`DELETE FROM "ohne_migrations" WHERE "name" LIKE '%share-token-hint'`);
    db.close();

    const app = await startApp({}, database);
    try {
      const share = await queryUntyped('CMSShares').where({ tokenHash: 'hash' }).findFirst();
      strictEqual(share?.tokenHint, '');
    } finally {
      await app.stop();
    }
  });
});
