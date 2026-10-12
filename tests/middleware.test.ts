import { deepStrictEqual, match, ok, strictEqual } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { queryUntyped, usePrinter } from 'ohnejs';

import { reportGuarded, siteTypes } from '../src/types/site-types.ts';
import { startApp, type TestApp } from './_app.ts';

const APP = {
  'ohne.config.ts': `import { defineConfig } from 'ohnejs';
export default defineConfig({
  layers: ['@ohnejs/cms'],
  auth: { loginRateLimit: false },
  cms: {
    site: 'https://example.com',
    routes: { Pages: '/[...slug]', Secrets: '/secret/[slug]', Notes: '/note/[slug]' },
  },
});
`,
  'collections/Pages.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields } from '@ohnejs/cms';
export default defineCollection({
  fields: {
    title: field('text'),
    secret: field('record', { collection: 'Secrets', allowEmpty: true }),
    note: field('record', { collection: 'Notes', allowEmpty: true }),
    body: field('richText', { links: ['Secrets'], allowEmpty: true, default: [] }),
    ...pageFields(),
  },
  api: { read: 'public' },
});
`,
  'collections/Secrets.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields } from '@ohnejs/cms';
export default defineCollection({
  fields: { title: field('text'), ...pageFields() },
  api: { read: { public: true, middleware: ['require-auth'] } },
});
`,
  'collections/Notes.ts': `import { defineCollection, field } from 'ohnejs';
import { requireUser } from 'ohnejs/auth';
import { pageFields } from '@ohnejs/cms';
export default defineCollection({
  fields: { title: field('text'), ...pageFields() },
  api: { read: { public: true, access: async () => (await requireUser(), {}) } },
});
`,
};

const PASSWORD = 'Correct-Horse-42';

describe('a read guarded by middleware', () => {
  let app: TestApp;
  let base: string;
  let secret: string;
  let note: string;
  let cookie: string;

  /**
   * Resolves `path`, signed in when `cookie` is given.
   */
  async function resolve(path: string, cookie?: string): Promise<any> {
    const response = await fetch(`${base}/cms/routes/resolve?path=${encodeURIComponent(path)}`, {
      headers: cookie === undefined ? {} : { cookie },
    });
    strictEqual(response.status, 200);
    return response.json();
  }

  /**
   * The sitemap, signed in when `cookie` is given.
   */
  async function sitemap(cookie?: string): Promise<string> {
    const response = await fetch(`${base}/cms/sitemap.xml`, {
      headers: cookie === undefined ? {} : { cookie },
    });
    strictEqual(response.status, 200);
    return response.text();
  }

  before(async () => {
    app = await startApp(APP);
    base = `http://127.0.0.1:${app.port}`;
    await queryUntyped('Users').createOrThrow({
      email: 'ada@example.com',
      password: PASSWORD,
      roles: ['admin'],
    });
    secret = (await queryUntyped('Secrets').createOrThrow({ title: 'Plans', slug: 'plans' }))
      .UUID as string;
    note = (await queryUntyped('Notes').createOrThrow({ title: 'Note', slug: 'note' }))
      .UUID as string;
    await queryUntyped('Pages').createOrThrow({
      title: 'About',
      slug: 'about',
      secret,
      note,
      body: [
        {
          kind: 'paragraph',
          content: [{ text: 'plans', link: { collection: 'Secrets', record: secret } }],
        },
      ],
    });
    const response = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ada@example.com', password: PASSWORD }),
    });
    cookie = response.headers
      .getSetCookie()
      .map((line) => line.split(';')[0])
      .join('; ');
  });

  after(() => app.stop());

  it('answers `401` on its own read anonymously', async () => {
    strictEqual((await fetch(`${base}/collections/secrets`)).status, 401);
  });

  it('resolves no page of it anonymously', async () => {
    strictEqual((await resolve('/secret/plans')).kind, 'notFound');
  });

  it('loads no related record and links no href anonymously', async () => {
    const { record } = await resolve('/about');
    strictEqual(record.secret, null);
    strictEqual(record.body[0].content[0].link.href, undefined);
  });

  it('leaves it out of the sitemap anonymously', async () => {
    const xml = await sitemap();
    match(xml, /\/about</);
    ok(!xml.includes('/secret/plans'));
  });

  it('reads an access that throws an HTTP error as reaching nothing anonymously', async () => {
    strictEqual((await resolve('/note/note')).kind, 'notFound');
    strictEqual((await resolve('/about')).record.note, null);
    ok(!(await sitemap()).includes('/note/note'));
  });

  it('shows it all to a signed-in reader', async () => {
    const page = await resolve('/secret/plans', cookie);
    strictEqual(page.kind, 'page');
    strictEqual(page.record.title, 'Plans');
    const { record } = await resolve('/about', cookie);
    strictEqual(record.secret.UUID, secret);
    strictEqual(record.note.UUID, note);
    strictEqual(record.body[0].content[0].link.href, '/secret/plans');
    ok((await sitemap(cookie)).includes('/secret/plans'));
  });

  it('is left out of the site types, which warn naming its file', async () => {
    const { text, guarded } = await siteTypes();
    match(text, /secret: Record<string, unknown> \| null;/);
    ok(!text.includes('Secrets: {'));
    deepStrictEqual(
      guarded.map(({ name }) => name),
      ['Secrets'],
    );
    const out: string[] = [];
    usePrinter().configure({ silent: false, color: false, stream: { write: (s) => out.push(s) } });
    try {
      reportGuarded(guarded);
    } finally {
      usePrinter().configure({ silent: true, stream: process.stderr });
    }
    strictEqual(out.length, 1);
    match(out[0] ?? '', /Site types leave out Secrets/);
    match(out[0] ?? '', /move the check into the read's access/);
    match(out[0] ?? '', /collections[\\/]Secrets\.ts/);
  });
});
