import { deepStrictEqual, strictEqual } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { queryUntyped } from 'ohnejs';

import { startApp, type TestApp } from './_app.ts';

const APP = {
  'ohne.config.ts': `import { defineConfig } from 'ohnejs';
export default defineConfig({
  layers: ['@ohnejs/cms'],
  auth: { loginRateLimit: false },
  cms: { routes: { Pages: '/[...slug]' }, share: { durations: ['1h', '1d'] } },
});
`,
  'collections/Pages.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields, publishedScope } from '@ohnejs/cms';
export default defineCollection({
  fields: {
    title: field('text'),
    ...pageFields(),
    note: field('text', { nullable: true, readable: false }),
    content: field('blocks', { allow: ['Hero'] }),
  },
  api: { read: { public: true, access: publishedScope }, create: true, update: true },
});
`,
  'blocks/Hero.ts': `import { defineBlock, field } from 'ohnejs';
export default defineBlock({
  fields: { heading: field('text'), secret: field('text', { nullable: true, readable: false }) },
});
`,
};

const PASSWORD = 'Correct-Horse-42';

describe('preview shares', () => {
  let app: TestApp;
  let base: string;
  let about: string;

  /**
   * Signs `email` in and answers its session cookie.
   */
  async function signIn(email: string): Promise<string> {
    const response = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    return response.headers
      .getSetCookie()
      .map((line) => line.split(';')[0])
      .join('; ');
  }

  /**
   * Shares a snapshot of `about` with `cookie`, answering the status and the body.
   */
  async function share(
    cookie: string,
    draft: Record<string, unknown> = {},
  ): Promise<{ status: number; body: any }> {
    const response = await fetch(`${base}/cms/preview/shares`, {
      method: 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({
        collection: 'Pages',
        record: about,
        locale: 'en',
        path: '/about',
        duration: '1d',
        values: { title: 'About (shared)', slug: 'about' },
        ...draft,
      }),
    });
    return { status: response.status, body: await response.json() };
  }

  /**
   * Lists the shares of `about` with `cookie`, answering the status and the body.
   */
  async function list(cookie: string): Promise<{ status: number; body: any }> {
    const response = await fetch(
      `${base}/cms/preview/shares?collection=Pages&record=${encodeURIComponent(about)}`,
      { headers: { cookie, origin: base } },
    );
    return { status: response.status, body: await response.json() };
  }

  /**
   * Revokes the share `UUID` with `cookie`, answering the status.
   */
  async function revoke(cookie: string, UUID: string): Promise<number> {
    const response = await fetch(`${base}/cms/preview/shares/${UUID}`, {
      method: 'DELETE',
      headers: { cookie, origin: base },
    });
    await response.body?.cancel();
    return response.status;
  }

  /**
   * Resolves `path` with `token` as the preview header.
   */
  async function resolve(path: string, token: string): Promise<{ headers: Headers; body: any }> {
    const response = await fetch(`${base}/cms/routes/resolve?path=${encodeURIComponent(path)}`, {
      headers: { 'ohne-preview': token },
    });
    return { headers: response.headers, body: await response.json() };
  }

  before(async () => {
    app = await startApp(APP);
    base = `http://127.0.0.1:${app.port}`;
    for (const email of ['ada@example.com', 'bob@example.com']) {
      await queryUntyped('Users').createOrThrow({ email, password: PASSWORD, roles: ['admin'] });
    }
    await queryUntyped('Users').createOrThrow({
      email: 'eve@example.com',
      password: PASSWORD,
      roles: [],
    });
    about = (
      await queryUntyped('Pages').createOrThrow({
        status: 'published',
        title: 'About',
        slug: 'about',
        content: [{ block: 'Hero', fields: { heading: 'Hi' } }],
      })
    ).UUID as string;
  });

  after(() => app.stop());

  it('refuses a share without a session or without write access', async () => {
    strictEqual((await share('')).status, 401);
    strictEqual((await share(await signIn('eve@example.com'))).status, 403);
  });

  it('refuses a duration outside the configured ones', async () => {
    const cookie = await signIn('ada@example.com');
    strictEqual((await share(cookie, { duration: '7d' })).status, 400);
    strictEqual((await share(cookie, { duration: 3_600_000 })).status, 400);
  });

  it('shows the snapshot, untouched by later saves, after its editor logs out', async () => {
    const cookie = await signIn('ada@example.com');
    const { status, body } = await share(cookie);
    strictEqual(status, 200);
    const hour = 60 * 60 * 1000;
    strictEqual(Math.abs(body.expiresAt - (Date.now() + 24 * hour)) < 60_000, true);
    strictEqual((await resolve('/about', body.token)).body.record.title, 'About (shared)');

    await queryUntyped('Pages').where({ UUID: about }).updateOrThrow({ title: 'About (saved)' });
    await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie, origin: base } });
    const { headers, body: page } = await resolve('/about', body.token);
    strictEqual(page.record.title, 'About (shared)');
    strictEqual(headers.get('cache-control'), 'private, no-store');
    strictEqual(headers.get('x-robots-tag'), 'noindex');
  });

  it('refuses a record that was never saved, since nothing could list or revoke its link', async () => {
    const cookie = await signIn('ada@example.com');
    strictEqual((await share(cookie, { record: crypto.randomUUID() })).status, 400);
  });

  it('never lays a snapshot over a page whose slug another record holds', async () => {
    const contact = (
      await queryUntyped('Pages').createOrThrow({
        status: 'published',
        title: 'Contact',
        slug: 'contact',
      })
    ).UUID as string;
    const { body } = await share(await signIn('ada@example.com'), {
      record: contact,
      values: { title: 'Hijacked', slug: 'about' },
    });
    const { record } = (await resolve('/about', body.token)).body;
    strictEqual(record.UUID, about);
    strictEqual(record.title === 'Hijacked', false);
  });

  it('drops every field the public could not read, inside blocks too', async () => {
    const { body } = await share(await signIn('ada@example.com'), {
      values: {
        slug: 'about',
        note: 'private',
        content: [{ block: 'Hero', UUID: 'b1', fields: { heading: 'Shared', secret: 'x' } }],
      },
    });
    const { record } = (await resolve('/about', body.token)).body;
    strictEqual('note' in record, false);
    deepStrictEqual(record.content, [{ block: 'Hero', UUID: 'b1', fields: { heading: 'Shared' } }]);
  });

  it('stops at expiry and once revoked', async () => {
    const cookie = await signIn('ada@example.com');
    const expiring = (await share(cookie)).body;
    await queryUntyped('CMSShares')
      .where({ UUID: expiring.UUID })
      .updateOrThrow({ expiresAt: Date.now() - 1 });
    strictEqual((await resolve('/about', expiring.token)).body.record.title, 'About (saved)');

    const revoked = (await share(cookie)).body;
    strictEqual(await revoke(await signIn('eve@example.com'), revoked.UUID), 403);
    strictEqual(await revoke(cookie, revoked.UUID), 204);
    strictEqual((await resolve('/about', revoked.token)).body.record.title, 'About (saved)');
    strictEqual(await revoke(cookie, revoked.UUID), 404);
  });

  it('lists the live shares of a record for its editors alone', async () => {
    const ada = await signIn('ada@example.com');
    const { body: created } = await share(ada, { duration: '1h' });
    const { status, body } = await list(ada);
    strictEqual(status, 200);
    deepStrictEqual(body[0], {
      UUID: created.UUID,
      locale: 'en',
      path: '/about',
      expiresAt: created.expiresAt,
      user: 'ada@example.com',
      mine: true,
    });
    strictEqual('token' in body[0], false);

    const bob = (await list(await signIn('bob@example.com'))).body;
    strictEqual(bob.find((row: any) => row.UUID === created.UUID).mine, false);
    strictEqual((await list(await signIn('eve@example.com'))).status, 403);
    strictEqual((await list('')).status, 401);
  });
});
