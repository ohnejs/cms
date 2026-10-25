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

export async function data(uuid: string): Promise<string[]> {
  const site = await ohne.read('Site', { select: ['titleTemplate'] });
  // @ts-expect-error - \`select\` leaves \`noindex\` out
  void site.noindex;
  const author = await ohne.read('Authors', uuid);
  const posts = await ohne.list('Posts', { order: ['-title'], select: ['title'], page: 2 });
  // @ts-expect-error - \`select\` leaves \`image\` out
  void posts.records[0]?.image;
  // @ts-expect-error - a singleton takes no \`UUID\`
  await ohne.read('Site', uuid);
  // @ts-expect-error - a list takes no singleton
  await ohne.list('Site');
  // @ts-expect-error - a post has no \`views\`
  await ohne.list('Posts', { order: ['views'] });
  // @ts-expect-error - a visitor may not read \`Secrets\`
  await ohne.list('Secrets');
  // @ts-expect-error - uploads arrive inside the records that carry them
  await ohne.list('Uploads');
  return [
    site.UUID + site.titleTemplate,
    image(author?.avatar ?? null),
    ...posts.records.map((post) => (post.title ?? '') + (post.path ?? '')),
  ];
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
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
    return typecheck(dir, consumer);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Type-checks `consumer` as `consumer.ts` in `dir`, beside `@ohnejs/client`.
 * Returns what `tsc` printed and its exit code, empty when it compiled.
 */
function typecheck(dir: string, consumer: string): string {
  writeFileSync(join(dir, 'consumer.ts'), consumer);
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
      files: ['consumer.ts'],
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

  it('types each collection a visitor may read as `GET /cms/records` answers it', async () => {
    const { text } = await siteTypes();
    const records = text.slice(text.indexOf('export interface Records {'));
    deepStrictEqual(
      [...records.matchAll(/^ {2}(\w+): \{$/gm)].map(([, name]) => name).slice(0, 4),
      ['Authors', 'Pages', 'Posts', 'Site'],
    );
    match(
      records,
      /^ {2}\};\n\}\n\n\/\*\*\n \* The collections in `Records` that hold one record\./m,
    );
    for (const hidden of ['Secrets', 'Uploads', 'Users', 'CMSDrafts', 'CMSShares', 'Redirects']) {
      ok(!new RegExp(`^ {2}${hidden}: \\{`, 'm').test(records), hidden);
    }
    deepStrictEqual(members(records, 'Authors', 2), [
      'UUID',
      '_updatedAt',
      'name',
      'avatar',
      'spot',
    ]);
    const post = members(records, 'Posts', 2);
    deepStrictEqual(post.slice(0, 4), ['UUID', '_updatedAt', '_translations', 'path']);
    ok(!post.includes('note'));
    ok(!members(records, 'Site', 2).includes('path'));
    match(records, /^ {4}cover: Related\['Authors'\] \| null;$/m);
    match(text, /^export type Singleton = 'Site';$/m);
    match(text, /^ {2}records: Records;$/m);
    match(text, /^ {2}singletons: Singleton;$/m);
    match(
      text.split('\n')[1] ?? '',
      /`GET \/cms\/routes\/resolve`, `GET \/cms\/records` and `POST \/collections`/,
    );
  });

  it('names exactly the fields `GET /cms/records` answers', async () => {
    const { UUID } = await queryUntyped('Authors').createOrThrow({ name: 'Ada' });
    const { text } = await siteTypes();
    const records = text.slice(text.indexOf('export interface Records {'));
    const author = await app.get(`/cms/records/Authors/${UUID}`);
    strictEqual(author.status, 200);
    deepStrictEqual(Object.keys(author.body).sort(), members(records, 'Authors', 2).sort());
    const site = await app.get('/cms/records/Site');
    strictEqual(site.status, 200);
    deepStrictEqual(Object.keys(site.body).sort(), members(records, 'Site', 2).sort());
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
    match(text, /^export interface Creatable \{\}$/m);
    match(text, /^ {2}creatable: Creatable;$/m);
    ok(!text.includes('ImageVariant'));
  });
});

describe('site types without a singleton', () => {
  let app: TestApp;

  before(async () => {
    app = await startApp({
      ...PLAIN,
      'collections/Site.ts': `import { defineCollection } from 'ohnejs';
import site from '../node_modules/@ohnejs/cms/collections/Site.ts';
export default defineCollection({ ...site, api: { update: true } });
`,
    });
  });

  after(async () => {
    await app.stop();
  });

  it('names none, so `read` takes a `UUID` everywhere', async () => {
    const { text } = await siteTypes();
    match(text, /^export type Singleton = never;$/m);
    const consumer = `import { createOhne } from '@ohnejs/client';
import type { CMS } from './ohne.ts';

const ohne = createOhne<CMS>({ api: 'https://cms.example.com' });

export async function titles(uuid: string): Promise<string[]> {
  const page = await ohne.read('Pages', uuid);
  const { records } = await ohne.list('Pages');
  // @ts-expect-error - \`Pages\` is no singleton
  await ohne.read('Pages');
  return [page?.title ?? '', ...records.map((record) => record.title)];
}
`;
    strictEqual(compile(text, consumer), '');
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
    for (const hidden of ['Members', 'salaryBand', 'HR only', 'Internal', 'escalationPhone']) {
      ok(!text.includes(hidden), hidden);
    }
  });

  it('types a public collection only a refused page links to as a record alone', async () => {
    const { text } = await siteTypes();
    const records = text.indexOf('export interface Records {');
    ok(!text.slice(0, records).includes('Staff'));
    deepStrictEqual(members(text.slice(records), 'Staff', 2), ['UUID', '_updatedAt', 'name']);
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
  'collections/Brands.ts': `import { defineCollection, field } from 'ohnejs';
export default defineCollection({
  fields: { name: field('text') },
  api: { read: { public: true, access: () => ({ select: ['name'] }) } },
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

const AUTHOR_CONSUMER = `import { createOhne } from '@ohnejs/client';
import type { CMS, Page } from './ohne.ts';

const ohne = createOhne<CMS>({ api: 'https://cms.example.com' });

export async function author(uuid: string): Promise<string> {
  const record = await ohne.read('Authors', uuid);
  // @ts-expect-error - the read access selects no \`email\`
  await ohne.read('Authors', uuid, { select: ['email'] });
  return record?.name ?? '';
}

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

  it('narrows a record to the fields its access selects, with no path past a withheld slug', async () => {
    const { text } = await siteTypes();
    const records = text.slice(text.indexOf('export interface Records {'));
    deepStrictEqual(members(records, 'Authors', 2), ['UUID', 'name']);
    deepStrictEqual(members(records, 'Guides', 2), ['UUID', 'title']);
  });

  it('keeps `UUID` on a record whose access withholds it', async () => {
    const { text } = await siteTypes();
    const records = text.slice(text.indexOf('export interface Records {'));
    deepStrictEqual(members(records, 'Brands', 2), ['UUID', 'name']);
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

const CREATE = {
  ...PLAIN,
  'middleware/spam.ts': `import { defineMiddleware, forbidden } from 'ohnejs';
export default defineMiddleware((event) =>
  event.request.headers.get('spam-token') === 'ok' ? undefined : forbidden('The spam check failed.'),
);
`,
  'collections/Messages.ts': `import { defineCollection, field } from 'ohnejs';
export default defineCollection({
  fields: {
    name: field('text'),
    email: field('email'),
    topic: field('select', { choices: ['sales', 'support'], nullable: true }),
    tags: field('multiSelect', { choices: ['a', 'b'] }),
    picks: field('multiSelect', { choices: ['a', 'b'], min: 1 }),
    priority: field('integer', { default: 1 }),
    reference: field('text', { immutable: true }),
    note: field('text', { readable: false }),
    status: field('text', { writable: false, nullable: true }),
    page: field('link', { collections: ['Pages'], nullable: true }),
    author: field('record', { collection: 'Authors' }),
    cc: field('records', { collection: 'Authors' }),
    to: field('records', { collection: 'Authors', min: 1 }),
  },
  api: { create: { public: true, middleware: ['spam'] } },
});
`,
  'collections/Signups.ts': `import { defineCollection, field } from 'ohnejs';
export default defineCollection({
  fields: {
    email: field('email'),
    address: field('object', { fields: { city: field('text') } }),
    items: field('repeater', { fields: { label: field('text') } }),
    body: field('blocks', { allow: ['Note'] }),
  },
  api: { create: { public: true, access: () => true } },
});
`,
  'blocks/Note.ts': `import { defineBlock, field } from 'ohnejs';
export default defineBlock({ fields: { text: field('text') } });
`,
  'collections/Authors.ts': `import { defineCollection, field } from 'ohnejs';
export default defineCollection({
  fields: { name: field('text') },
  api: { read: 'public', create: true },
});
`,
  'collections/Uploads.ts': `import { defineCollection } from 'ohnejs';
import uploads from '../node_modules/ohnejs/src/uploads/collections/Uploads.ts';
export default defineCollection({ ...uploads, api: { ...uploads.api, create: 'public' } });
`,
};

const CREATE_CONSUMER = `import { createOhne } from '@ohnejs/client';
import type { Creatable, CMS } from './ohne.ts';

const ohne = createOhne<CMS>({ api: 'https://cms.example.com' });

export async function send(message: Creatable['Messages']): Promise<string> {
  const result = await ohne.create('Messages', message, { headers: { 'spam-token': 'ok' } });
  if (result.ok) return result.UUID ?? '';
  const email: string | undefined = result.errors.email;
  return email ?? result.message;
}

export async function misuse(author: string): Promise<void> {
  await ohne.create('Messages', { name: 'Ada', email: 'ada@example.com', picks: ['a'], reference: 'r', note: 'n', to: [author] });
  await ohne.create('Signups', { email: 'ada@example.com', address: { city: 'Vienna' } });
  // @ts-expect-error - \`to\` takes at least one author
  await ohne.create('Messages', { name: 'Ada', email: 'ada@example.com', picks: ['a'], reference: 'r', note: 'n' });
  // @ts-expect-error - a create takes no \`status\`
  await ohne.create('Messages', { name: 'Ada', email: 'ada@example.com', picks: ['a'], reference: 'r', note: 'n', to: [author], status: 'x' });
  // @ts-expect-error - \`picks\` takes only its choices
  await ohne.create('Messages', { name: 'Ada', email: 'ada@example.com', picks: ['c'], reference: 'r', note: 'n', to: [author] });
  // @ts-expect-error - a visitor may not create in \`Authors\`
  await ohne.create('Authors', { name: 'Ada' });
  // @ts-expect-error - a file goes up through the uploads routes
  await ohne.create('Uploads', {});
  // @ts-expect-error - \`Site\` holds one record
  await ohne.create('Site', {});
}
`;

describe('site types for creates', () => {
  let app: TestApp;

  before(async () => {
    app = await startApp(CREATE);
  });

  after(async () => {
    await app.stop();
  });

  it('holds each collection whose create is public, middleware and `access` aside', async () => {
    const { text } = await siteTypes();
    const creatable = text.slice(text.indexOf('export interface Creatable {'));
    deepStrictEqual(
      [...creatable.matchAll(/^ {2}(\w+): \{$/gm)].map(([, name]) => name).slice(0, 2),
      ['Messages', 'Signups'],
    );
    match(creatable, /^ {2}\};\n\}\n\n\/\*\*\n \* What this cms answers a website/m);
    match(text, /^ {2}creatable: Creatable;$/m);
    const records = text.slice(text.indexOf('export interface Records {'), text.indexOf(creatable));
    ok(!records.includes('Messages'));
  });

  it('takes the fields a create writes, `immutable` and write-only ones included', async () => {
    const { text } = await siteTypes();
    const creatable = text.slice(text.indexOf('export interface Creatable {'));
    deepStrictEqual(members(creatable, 'Messages', 2), [
      'name',
      'email',
      'topic',
      'tags',
      'picks',
      'priority',
      'reference',
      'note',
      'page',
      'author',
      'cc',
      'to',
    ]);
    for (const line of [
      'name: string;',
      "topic?: 'sales' | 'support' | null;",
      "tags?: ('a' | 'b')[];",
      "picks: ('a' | 'b')[];",
      'priority?: number;',
      "page?: Link<'Pages'> | null;",
      'author?: string | null;',
      'cc?: string[];',
      'to: string[];',
      'address: unknown;',
      'items?: unknown;',
      'body?: unknown;',
    ]) {
      ok(creatable.includes(`    ${line}\n`), line);
    }
  });

  it('agrees with the framework on what a create needs', () => {
    const dir = writeApp({
      ...CREATE,
      'ohne.config.ts': PLAIN['ohne.config.ts'].replace(
        "cms: { routes: { Pages: '/[...slug]' } }",
        "cms: { routes: { Pages: '/[...slug]' }, types: 'ohne.ts' }",
      ),
    });
    try {
      strictEqual(ohne(dir, 'prepare').status, 0);
      const consumer = `import type { GeneratedInserts } from './.ohne/shared/database.ts';
import type { Creatable } from './ohne.ts';

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Optional<T> = { [K in keyof T]-?: {} extends Pick<T, K> ? K : never }[keyof T];

export const messages: Same<Creatable['Messages'], GeneratedInserts['Messages']> = true;
export const keys: Same<keyof Creatable['Signups'], keyof GeneratedInserts['Signups']> = true;
export const omitted: Same<Optional<Creatable['Signups']>, Optional<GeneratedInserts['Signups']>> = true;
`;
      strictEqual(typecheck(dir, consumer), '');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('compiles a create for a website, and rejects a misuse', async () => {
    strictEqual(compile((await siteTypes()).text, CREATE_CONSUMER), '');
  });

  it('lets a create through with only the fields it requires', async () => {
    const { UUID: author } = await queryUntyped('Authors').createOrThrow({ name: 'Ada' });
    const input = {
      name: 'Ada',
      email: 'ada@example.com',
      picks: ['a'],
      reference: 'r',
      note: 'n',
      to: [author],
    };
    const post = (headers: Record<string, string>) =>
      fetch(`http://127.0.0.1:${app.port}/collections/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(input),
      });
    strictEqual((await post({})).status, 403);
    strictEqual((await post({ 'spam-token': 'ok' })).status, 201);
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
