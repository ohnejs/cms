import type * as client from '@ohnejs/client';
import type * as utils from 'ohnejs/utils';

import { deepStrictEqual, match, ok, rejects, strictEqual } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { queryUntyped, usePrinter } from 'ohnejs';

import { clientMirror, MIRRORED_TYPES } from '../src/types/mirror.ts';
import { reportDegraded, siteTypes } from '../src/types/site-types.ts';
import { startApp, type TestApp, writeApp } from './_app.ts';

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), '..');

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const MIRRORS = {
  Link: true as Same<client.Link<'Pages'>, utils.Link<'Pages'>>,
  RecordLink: true as Same<client.RecordLink<'Pages'>, utils.RecordLink<'Pages'>>,
  URLLink: true as Same<client.URLLink, utils.URLLink>,
  RichText: true as Same<client.RichText<'Pages'>, utils.RichText<'Pages'>>,
  RichTextBlock: true as Same<client.RichTextBlock<'Pages'>, utils.RichTextBlock<'Pages'>>,
  RichTextParagraph: true as Same<client.RichTextParagraph, utils.RichTextParagraph>,
  RichTextHeading: true as Same<client.RichTextHeading, utils.RichTextHeading>,
  RichTextQuote: true as Same<client.RichTextQuote, utils.RichTextQuote>,
  RichTextList: true as Same<client.RichTextList, utils.RichTextList>,
  RichTextListItem: true as Same<client.RichTextListItem, utils.RichTextListItem>,
  RichTextRun: true as Same<client.RichTextRun<'Pages'>, utils.RichTextRun<'Pages'>>,
  RichTextMark: true as Same<client.RichTextMark, utils.RichTextMark>,
  RichTextHeadingLevel: true as Same<client.RichTextHeadingLevel, utils.RichTextHeadingLevel>,
} satisfies Record<(typeof MIRRORED_TYPES)[number], true>;

const APP = {
  'ohne.config.ts': `import { defineConfig } from 'ohnejs';
export default defineConfig({
  layers: ['@ohnejs/cms', 'pin-layer'],
  collections: { locales: ['en', 'de'], defaultLocale: 'en' },
  uploads: {
    images: {
      url: 'https://images.example.com',
      variants: { card: { width: 640 }, thumbnail: { width: 160 } },
    },
  },
  cms: { routes: { Pages: '/[...slug]', Posts: { en: '/blog/[slug]', de: '/artikel/[slug]' } } },
});
`,
  'collections/Pages.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields, publishedScope } from '@ohnejs/cms';
export default defineCollection({
  fields: {
    title: field('text'),
    ...pageFields(),
    cover: field('image'),
    content: field('blocks', { allow: ['Hero', 'PostList'] }),
  },
  api: { read: { public: true, access: publishedScope } },
});
`,
  'collections/Posts.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields, publishedScope } from '@ohnejs/cms';
export default defineCollection({
  fields: {
    title: field('text', { translatable: true }),
    ...pageFields({ translatable: true }),
    image: field('image'),
    cover: field('record', { collection: 'Authors' }),
    note: field('text', { readable: false }),
    body: field('blocks', { allow: ['Quote'] }),
  },
  api: { read: { public: true, access: publishedScope } },
});
`,
  'collections/Authors.ts': `import { defineCollection, field } from 'ohnejs';
export default defineCollection({
  fields: { name: field('text'), avatar: field('image'), spot: field('pin', { nullable: true }) },
  api: { read: 'public' },
});
`,
  'collections/Secrets.ts': `import { defineCollection, field } from 'ohnejs';
export default defineCollection({ fields: { code: field('text') } });
`,
  'blocks/Hero.ts': `import { defineBlock, field } from 'ohnejs';
export default defineBlock({
  fields: {
    heading: field('text'),
    image: field('image'),
    body: field('richText', { links: ['Pages'] }),
    cta: field('link', { collections: ['Pages'] }),
    author: field('record', { collection: 'Authors' }),
    secret: field('record', { collection: 'Secrets' }),
    site: field('record', { collection: 'Site' }),
    location: field('geo'),
    columns: field('repeater', { fields: { label: field('text'), place: field('geo') } }),
  },
});
`,
  'blocks/PostList.ts': `import { defineBlock, field } from 'ohnejs';
export default defineBlock({ fields: { posts: field('records', { collection: 'Posts' }) } });
`,
  'blocks/Quote.ts': `import { defineBlock, field } from 'ohnejs';
export default defineBlock({
  fields: { text: field('text'), photo: field('image'), by: field('record', { collection: 'Authors' }) },
});
`,
  'fields/_geo.ts': 'export interface LatLng { lat: number; lng: number }\n',
  'fields/geo.ts': `import { defineField } from 'ohnejs';
export default defineField({ columnType: 'json', emitType: (ctx) => ctx.importType('./_geo.ts', 'LatLng') });
`,
  'node_modules/pin-layer/package.json': JSON.stringify({ name: 'pin-layer', type: 'module' }),
  'node_modules/pin-layer/ohne.config.ts':
    "import { defineConfig } from 'ohnejs';\nexport default defineConfig({});\n",
  'node_modules/pin-layer/fields/_pin.ts': 'export interface Pin { x: number }\n',
  'node_modules/pin-layer/fields/pin.ts': `import { defineField } from 'ohnejs';
export default defineField({ columnType: 'json', emitType: (ctx) => ctx.importType('./_pin.ts', 'Pin') });
`,
};

const PLAIN = {
  'ohne.config.ts': `import { defineConfig } from 'ohnejs';
export default defineConfig({ layers: ['@ohnejs/cms'], cms: { routes: { Pages: '/[...slug]' } } });
`,
  'collections/Pages.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields, publishedScope } from '@ohnejs/cms';
export default defineCollection({
  fields: { title: field('text'), ...pageFields() },
  api: { read: { public: true, access: publishedScope } },
});
`,
};

const CONSUMER = `import { createOhne, richTextToHTML } from '@ohnejs/client';
import type { Block, CMS, ImageVariant, Page, Related, Upload } from './ohne.ts';

const ohne = createOhne<CMS>({ api: 'https://cms.example.com' });

export function image(upload: Upload | null): string {
  return upload ? (upload.variants?.card ?? upload.url) : '';
}

export function renderBlock(item: Block): string {
  switch (item.block) {
    case 'Hero':
      return item.fields.heading + image(item.fields.image) + richTextToHTML(item.fields.body);
    case 'PostList':
      return item.fields.posts.map((post) => (post.title ?? '') + image(post.image)).join('');
    case 'Quote':
      return item.fields.text + (item.fields.by?.name ?? '');
    default: {
      const unhandled: never = item;
      return unhandled;
    }
  }
}

export function cover(post: Related['Posts']): string {
  // @ts-expect-error - a related record's own relation stays a \`UUID\`
  return post.cover?.url ?? '';
}

// @ts-expect-error - no such block
export type Missing = Block<'Nope'>;

// @ts-expect-error - no such variant
export const variant: ImageVariant = 'hero';

export function title(page: Page<'Pages'>): string {
  return page.title;
}

export async function render(path: string): Promise<string> {
  const page = await ohne.resolve(path);
  if (page.kind !== 'page') return page.kind === 'notFound' ? (page.page?.title ?? '') : '';
  // @ts-expect-error - no such collection
  if (page.collection === 'Nope') return '';
  if (page.collection === 'Posts') {
    // @ts-expect-error - a post has no \`content\`
    return page.record.content;
  }
  return page.record.content.map(renderBlock).join('');
}
`;

const { FORCE_COLOR: _, ...uncolored } = process.env;

/**
 * Runs the `ohne` CLI with `args` in the app at `dir`, without color.
 */
function ohne(dir: string, ...args: string[]) {
  return spawnSync(join(PACKAGE, 'node_modules', '.bin', 'ohne'), [...args, '--cwd', dir], {
    encoding: 'utf8',
    env: { ...uncolored, NO_COLOR: '1' },
  });
}

/**
 * The member names of the shape `owner` declares at `indent` in `text`.
 */
function members(text: string, owner: string, indent: number): string[] {
  const pad = ' '.repeat(indent);
  const shape = new RegExp(`^${pad}${owner}: \\{\\n([\\s\\S]*?)^${pad}\\};`, 'm');
  const body = shape.exec(text)?.[1] ?? '';
  return [...body.matchAll(new RegExp(`^${pad}  (\\w+)\\??:`, 'gm'))].map(([, name]) => name!);
}

/**
 * Type-checks `consumer` against `types` as `ohne.ts`, with `@ohnejs/client` alone installed.
 * Returns what `tsc` printed and its exit code, empty when it compiled.
 */
function compile(types: string, consumer: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-site-')));
  try {
    writeFileSync(join(dir, 'ohne.ts'), types);
    writeFileSync(join(dir, 'consumer.ts'), consumer);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          module: 'nodenext',
          target: 'esnext',
          lib: ['esnext', 'dom'],
          types: [],
          noEmit: true,
          allowImportingTsExtensions: true,
          verbatimModuleSyntax: true,
        },
        include: ['*.ts'],
      }),
    );
    mkdirSync(join(dir, 'node_modules', '@ohnejs'), { recursive: true });
    symlinkSync(
      realpathSync(join(PACKAGE, 'node_modules', '@ohnejs', 'client')),
      join(dir, 'node_modules', '@ohnejs', 'client'),
      'dir',
    );
    const { stdout, stderr, status } = spawnSync(
      join(PACKAGE, 'node_modules', '.bin', 'tsc'),
      ['-p', dir],
      { encoding: 'utf8' },
    );
    return `${stdout}${stderr}${status === 0 ? '' : `exit ${status}`}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('site types', () => {
  let app: TestApp;

  before(async () => {
    app = await startApp(APP);
  });

  after(async () => {
    await app.stop();
  });

  it('serves the file at `/cms/types.ts` with an `etag`', async () => {
    const response = await fetch(`http://127.0.0.1:${app.port}/cms/types.ts`);
    strictEqual(response.status, 200);
    strictEqual(response.headers.get('content-type'), 'text/plain; charset=utf-8');
    strictEqual(await response.text(), (await siteTypes()).text);
    const tag = response.headers.get('etag');
    ok(tag);
    const cached = await fetch(`http://127.0.0.1:${app.port}/cms/types.ts`, {
      // A conditional `fetch` adds `cache-control: no-cache` unless one is set, and that is never fresh.
      headers: { 'if-none-match': tag, 'cache-control': 'max-age=0' },
    });
    strictEqual(cached.status, 304);
  });

  it('renders the same bytes every time', async () => {
    strictEqual((await siteTypes()).text, (await siteTypes()).text);
  });

  it('exports the names a website imports', async () => {
    const { text } = await siteTypes();
    for (const name of ['Locale', 'ImageVariant', 'Block', 'Page']) {
      match(text, new RegExp(`^export type ${name}\\b`, 'm'));
    }
    for (const name of ['Upload', 'Blocks', 'Related', 'CMS']) {
      match(text, new RegExp(`^export interface ${name} \\{`, 'm'));
    }
    match(text, /^interface RelatedBlocks \{/m);
    match(text, /^type RelatedBlock</m);
    match(text, /^export interface Related \{[\s\S]*?\n {2}Site: \{/m);
    match(text, /notFound: CMS\['pages'\]\['Pages'\];/);
  });

  it('types relations one hop out, and an unreadable target as a plain record', async () => {
    const { text } = await siteTypes();
    match(text, /author: Related\['Authors'\] \| null;/);
    match(text, /secret: Record<string, unknown> \| null;/);
    match(text, /posts: Related\['Posts'\]\[\];/);
    match(text, /cover: string \| null;/);
    match(text, /by: string \| null;/);
    match(text, /body: RelatedBlock<'Quote'>\[\];/);
    ok(!text.includes('Secrets: {'));
    ok(!text.includes('note:'));
  });

  it('imports the mirrored types once, from `@ohnejs/client`', async () => {
    const { text } = await siteTypes();
    deepStrictEqual(text.match(/^import .*$/gm), [
      "import type { Link, RichText } from '@ohnejs/client';",
    ]);
  });

  it('names each field type it could not describe', async () => {
    const { degraded } = await siteTypes();
    deepStrictEqual(
      degraded.map(({ type, fields }) => ({ type, fields })),
      [
        { type: 'geo', fields: ['Hero.location', 'Hero.columns[].place'] },
        { type: 'pin', fields: ['Authors.spot'] },
      ],
    );
    const out: string[] = [];
    usePrinter().configure({ silent: false, color: false, stream: { write: (s) => out.push(s) } });
    try {
      reportDegraded(degraded);
    } finally {
      usePrinter().configure({ silent: true, stream: process.stderr });
    }
    const [geo, pin] = out;
    match(geo ?? '', /Field type geo has no JSON type/);
    match(geo ?? '', /emitType imports \.\/_geo\.ts, which a website cannot resolve\./);
    match(geo ?? '', /- Hero\.columns\[\]\.place/);
    match(geo ?? '', /Declare emitJSONType on the field type/);
    match(pin ?? '', /Override pin in your app's fields\/ by spreading the layer's type/);
    match(pin ?? '', /node_modules\/pin-layer\/fields\/pin\.ts/);
  });

  it('compiles for a website, and rejects a misuse', async () => {
    strictEqual(compile((await siteTypes()).text, CONSUMER), '');
  });

  it('reads the mirrored types from `@ohnejs/client` alone', () => {
    ok(Object.values(MIRRORS).every(Boolean));
    strictEqual(clientMirror('ohnejs/utils', 'RichText'), '@ohnejs/client');
    strictEqual(clientMirror('ohnejs/utils', 'pick'), undefined);
    strictEqual(clientMirror('./link.ts', 'Link'), undefined);
  });
});

describe('site types without rich text', () => {
  let app: TestApp;

  before(async () => {
    app = await startApp(PLAIN);
  });

  after(async () => {
    await app.stop();
  });

  it('imports nothing', async () => {
    const { text, degraded } = await siteTypes();
    strictEqual(text.match(/^import /m), null);
    deepStrictEqual(degraded, []);
    match(text, /^export interface Blocks \{\}$/m);
    ok(!text.includes('ImageVariant'));
  });
});

describe('site types beside a private routed collection', () => {
  let app: TestApp;

  before(async () => {
    app = await startApp({
      ...PLAIN,
      'ohne.config.ts': `import { defineConfig } from 'ohnejs';
export default defineConfig({
  layers: ['@ohnejs/cms'],
  cms: { routes: { Pages: '/[...slug]', Members: '/members/[slug]' } },
});
`,
      'collections/Pages.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields, publishedScope } from '@ohnejs/cms';
export default defineCollection({
  fields: { title: field('text'), lang: field('lang'), ...pageFields() },
  api: { read: { public: true, access: publishedScope } },
});
`,
      'collections/Members.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields } from '@ohnejs/cms';
export default defineCollection({
  fields: {
    ...pageFields(),
    salaryBand: field('select', { choices: ['executive', 'staff'], description: 'HR only' }),
    manager: field('record', { collection: 'Staff' }),
    body: field('blocks', { allow: ['Internal'] }),
  },
  api: { read: {} },
});
`,
      'collections/Staff.ts': `import { defineCollection, field } from 'ohnejs';
export default defineCollection({ fields: { name: field('text') }, api: { read: 'public' } });
`,
      'blocks/Internal.ts': `import { defineBlock, field } from 'ohnejs';
export default defineBlock({ fields: { escalationPhone: field('text') } });
`,
      'fields/lang.ts': `import { defineField } from 'ohnejs';
export default defineField({
  columnType: 'text',
  emitJSONType: (ctx) => ctx.importType('i18n-kit', 'Locale'),
});
`,
    });
  });

  after(async () => {
    await app.stop();
  });

  it('leaves out what an anonymous reader cannot resolve', async () => {
    const text = await (await fetch(`http://127.0.0.1:${app.port}/cms/types.ts`)).text();
    match(text, /^ {4}Pages: \{/m);
    for (const hidden of [
      'Members',
      'salaryBand',
      'HR only',
      'Internal',
      'escalationPhone',
      'Staff',
    ]) {
      ok(!text.includes(hidden), hidden);
    }
  });

  it('aliases an imported type named like one of its own', async () => {
    const { text } = await siteTypes();
    match(text, /^import type \{ Locale as Locale2 \} from 'i18n-kit';$/m);
    match(text, /^export type Locale = 'en';$/m);
    match(text, /lang: Locale2;/);
  });
});

const READ_ACCESS = {
  'ohne.config.ts': `import { defineConfig } from 'ohnejs';
export default defineConfig({
  layers: ['@ohnejs/cms'],
  cms: {
    routes: {
      Pages: '/[...slug]',
      Guides: '/guides/[slug]',
      Vault: '/vault/[slug]',
      Members: '/members/[slug]',
    },
  },
});
`,
  'collections/Pages.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields, publishedScope } from '@ohnejs/cms';
export default defineCollection({
  fields: { title: field('text'), ...pageFields(), author: field('record', { collection: 'Authors' }) },
  api: { read: { public: true, access: publishedScope } },
});
`,
  'collections/Authors.ts': `import { defineCollection, field } from 'ohnejs';
export default defineCollection({
  fields: { name: field('text'), email: field('text') },
  api: { read: { public: true, access: () => ({ select: ['UUID', 'name'] }) } },
});
`,
  'collections/Guides.ts': `import { defineCollection, field } from 'ohnejs';
import { pageFields } from '@ohnejs/cms';
export default defineCollection({
  fields: { title: field('text'), ...pageFields() },
  api: { read: { public: true, access: () => ({ select: ['UUID', 'title'] }) } },
});
`,
  'collections/Vault.ts': `import { defineCollection, field } from 'ohnejs';
import { useUser } from 'ohnejs/auth';
import { pageFields } from '@ohnejs/cms';
export default defineCollection({
  fields: {
    ...pageFields(),
    secretCode: field('text'),
    content: field('blocks', { allow: ['Secret'] }),
  },
  api: { read: { public: true, access: async () => (await useUser()) !== null } },
});
`,
  'collections/Members.ts': `import { defineCollection } from 'ohnejs';
import { requireUser } from 'ohnejs/auth';
import { pageFields } from '@ohnejs/cms';
export default defineCollection({
  fields: { ...pageFields() },
  api: { read: { public: true, access: async () => Boolean(await requireUser()) } },
});
`,
  'blocks/Secret.ts': `import { defineBlock, field } from 'ohnejs';
export default defineBlock({ fields: { escalationPhone: field('text') } });
`,
};

const AUTHOR_CONSUMER = `import type { Page } from './ohne.ts';

export function byline(page: Page<'Pages'>): string {
  return page.author?.name ?? '';
}

export function contact(page: Page<'Pages'>): string {
  // @ts-expect-error - the read access selects no \`email\`
  return page.author?.email ?? '';
}
`;

describe('site types under read access', () => {
  let app: TestApp;
  let base: string;

  before(async () => {
    app = await startApp(READ_ACCESS);
    base = `http://127.0.0.1:${app.port}`;
    await queryUntyped('Users').createOrThrow({
      email: 'ada@example.com',
      password: 'Correct-Horse-42',
      roles: ['admin'],
    });
  });

  after(async () => {
    await app.stop();
  });

  it('asks as a visitor without a session, even when a signed-in user fetches first', async () => {
    const login = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ada@example.com', password: 'Correct-Horse-42' }),
    });
    strictEqual(login.status, 200);
    const cookie = login.headers
      .getSetCookie()
      .map((line) => line.split(';')[0])
      .join('; ');
    const text = await (await fetch(`${base}/cms/types.ts`, { headers: { cookie } })).text();
    match(text, /^ {4}Guides: \{/m);
    ok(!text.includes('Vault'));
    ok(!text.includes('secretCode'));
  });

  it('narrows a related record to the fields its access selects', async () => {
    const text = await (await fetch(`${base}/cms/types.ts`)).text();
    deepStrictEqual(members(text, 'Authors', 2), ['UUID', 'name']);
    ok(!text.includes('email'));
  });

  it('narrows a page to the fields its access selects', async () => {
    const { text } = await siteTypes();
    deepStrictEqual(members(text, 'Guides', 4), ['UUID', 'title']);
  });

  it('keeps every field of an unnarrowed page', async () => {
    const { text } = await siteTypes();
    const page = members(text, 'Pages', 4);
    ok(page.includes('status'));
    ok(page.includes('_updatedAt'));
    match(text, /author: Related\['Authors'\] \| null;/);
  });

  it('leaves out what a visitor without a session is refused', async () => {
    const { text } = await siteTypes();
    for (const hidden of ['Vault', 'Members', 'Secret', 'escalationPhone']) {
      ok(!text.includes(hidden), hidden);
    }
  });

  it('rejects reading a field the access does not select', async () => {
    strictEqual(compile((await siteTypes()).text, AUTHOR_CONSUMER), '');
  });

  it('gives the same bytes from `ohne prepare`, `ohne cms types` and the route', async () => {
    const served = await (await fetch(`${base}/cms/types.ts`)).text();
    const dir = writeApp({
      ...READ_ACCESS,
      'ohne.config.ts': READ_ACCESS['ohne.config.ts'].replace(
        '  cms: {',
        "  cms: {\n    types: 'web/prepared.ts',",
      ),
    });
    try {
      strictEqual(ohne(dir, 'prepare').status, 0);
      strictEqual(ohne(dir, 'cms', 'types', '--out', 'web/command.ts').status, 0);
      strictEqual(readFileSync(join(dir, 'web', 'prepared.ts'), 'utf8'), served);
      strictEqual(readFileSync(join(dir, 'web', 'command.ts'), 'utf8'), served);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('site types beside an access that needs a request', () => {
  let app: TestApp;

  before(async () => {
    app = await startApp({
      ...PLAIN,
      'collections/Blocked.ts': `import { defineCollection, field, useEvent } from 'ohnejs';
export default defineCollection({
  fields: { name: field('text') },
  api: { read: { public: true, access: () => useEvent().ip === '' } },
});
`,
    });
  });

  after(async () => {
    await app.stop();
  });

  it('fails naming the collection and its file', async () => {
    await rejects(siteTypes(), (error: { title?: string; path?: string }) => {
      strictEqual(error.title, 'Read access of `Blocked` cannot answer for a visitor');
      match(error.path ?? '', /[\\/]collections[\\/]Blocked\.ts$/);
      return true;
    });
    strictEqual((await fetch(`http://127.0.0.1:${app.port}/cms/types.ts`)).status, 500);
  });
});

describe('`cms.types`', () => {
  const out = join(realpathSync(mkdtempSync(join(tmpdir(), 'ohne-types-'))), 'web', 'ohne.ts');
  const files = {
    ...PLAIN,
    'ohne.config.ts': `import { defineConfig } from 'ohnejs';
export default defineConfig({
  layers: ['@ohnejs/cms'],
  cms: { routes: { Pages: '/[...slug]' }, types: ${JSON.stringify(out)} },
});
`,
  };

  after(() => {
    rmSync(dirname(dirname(out)), { recursive: true, force: true });
  });

  it('is not written by serving', async () => {
    await (await startApp(files)).stop();
    ok(!existsSync(out));
  });

  const prepare = (dir: string) => ohne(dir, 'prepare');

  it('is written by `ohne prepare`, and left alone while current', async () => {
    const dir = writeApp(files);
    try {
      strictEqual(prepare(dir).status, 0);
      const written = statSync(out).mtimeMs;
      strictEqual(prepare(dir).status, 0);
      strictEqual(statSync(out).mtimeMs, written);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const app = await startApp(files);
    try {
      strictEqual(readFileSync(out, 'utf8'), (await siteTypes()).text);
    } finally {
      await app.stop();
    }
  });

  it('rejects an empty path before `ohne prepare` or `ohne cms types` writes', () => {
    const dir = writeApp({
      ...files,
      'ohne.config.ts': files['ohne.config.ts'].replace(JSON.stringify(out), "''"),
    });
    try {
      for (const args of [['prepare'], ['cms', 'types']]) {
        const { status, stderr, stdout } = ohne(dir, ...args);
        strictEqual(status, 1);
        match(stderr + stdout, /Invalid `?cms\.types`? value/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a path inside `.ohne` from `ohne cms types` exactly as `ohne prepare` does', () => {
    const dir = writeApp({
      ...files,
      'ohne.config.ts': files['ohne.config.ts'].replace(JSON.stringify(out), "'.ohne/ohne.ts'"),
    });
    const block = (args: string[]) => {
      const { status, stderr, stdout } = ohne(dir, ...args);
      strictEqual(status, 1);
      const output = stderr + stdout;
      return output.slice(output.indexOf('Codegen path'));
    };
    try {
      const prepared = block(['prepare']);
      match(prepared, /^Codegen path \.ohne\/ohne\.ts is inside the codegen directory/);
      strictEqual(block(['cms', 'types']), prepared);
      strictEqual(block(['cms', 'types', '--out', '.ohne/ohne.ts']), prepared);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('names the file when `--out` is a directory', () => {
    const dir = writeApp({ ...PLAIN, 'web/ohne.ts/.keep': '' });
    try {
      const { status, stderr, stdout } = ohne(dir, 'cms', 'types', '--out', 'web/ohne.ts');
      const output = stderr + stdout;
      strictEqual(status, 1);
      strictEqual(output.split('Cannot write codegen file').length, 2);
      match(output, /Cannot write codegen file \S*web\/ohne\.ts\n/);
      match(output, /a directory sits at that path\./);
      ok(!output.includes('EISDIR'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
