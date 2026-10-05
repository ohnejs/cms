# @ohnejs/cms

Turns an [ohne](https://ohne.dev) app into the CMS for a website. Build the site with Nuxt, Next,
React, or plain HTML. Edit its pages in the ohne dashboard, with the live site beside the editor.

It is in early development and not ready to install yet.

## Setup

Add the layer, tell it where your website lives, and map paths to collections:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['@ohnejs/cms'],
  cms: {
    site: 'https://example.com',
    routes: {
      Pages: '/[...slug]',
      Posts: '/blog/[slug]',
    },
  },
});
```

A collection with a route gets its page fields from `pageFields()`: `slug`, `status`,
`publishedAt`, `expiresAt`, and `seo`. `publishedScope` lets visitors read only what is published:

```ts
// collections/Pages.ts
import { pageFields, publishedScope } from '@ohnejs/cms';
import { defineCollection, field } from 'ohnejs';

export default defineCollection({
  fields: {
    title: field('text'),
    ...pageFields(),
    content: field('blocks', { allow: ['Hero', 'Text'] }),
  },
  api: { read: { public: true, access: publishedScope } },
});
```

Open a page in the dashboard and you get the live editor: the blocks on the left, your website in
the middle, the fields on the right. Every keystroke shows on the site before you save.

`SITE_URL` overrides `cms.site`, so each environment can point at its own website.

## Routes

A route is a path pattern. `[slug]` matches one segment, `[...slug]` matches several. A route
without a parameter, like `'/contact'`, shows a single record.

With several locales, give a route per locale. The default locale has no prefix, the others do:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['@ohnejs/cms'],
  collections: { locales: ['en', 'de'], defaultLocale: 'en' },
  cms: {
    site: 'https://example.com',
    routes: {
      Pages: '/[...slug]',
      Posts: { en: '/blog/[slug]', de: '/artikel/[slug]' },
    },
  },
});
```

Here `/blog/hello` and `/de/artikel/hallo` are the same post. Set `prefixDefaultLocale: true` to
prefix every locale.

Two slugs are special under `/[...slug]`:

- `index` is the home page. It shows at `/`, and `/index` redirects there.
- `404` is the page your site shows when nothing else matches.

## Reading pages on your website

Your website asks the cms which page a path shows, with
[`@ohnejs/client`](https://github.com/ohnejs/client):

```ts
import { createOhne } from '@ohnejs/client';

const ohne = createOhne({ api: 'https://api.example.com' });
const page = await ohne.resolve('/blog/hello');
```

The answer is one of three kinds:

- `page`: the `record` to render, its `seo`, and its `alternates` in other locales.
- `redirect`: send the visitor to `to` with the status `code`.
- `notFound`: answer `404`, and render `page` when your site has a `404` page.

Upload URLs in the record are absolute, and a related page carries its `path`, so you can link to
it. Each block reads as `{ block, UUID, fields }`.

The recipes below show the whole loop for each framework.

## Live preview

The editor frames your page with a preview token in its URL, `?ohne-preview=...`. Your site does
two things with it:

1. Passes it to `resolve`, so the cms answers with the unsaved changes.
2. Loads the preview script, which listens to the editor.

Mark each block's root element with its `UUID`, so the editor can outline and select it:

```html
<section data-ohne-block="01a10e2a-156a-785e-9eca-3511ba282500">...</section>
```

Your site must allow the dashboard to frame it. Most frameworks do by default. If your host sends
`X-Frame-Options` or a strict `Content-Security-Policy`, allow the dashboard's origin:

```http
Content-Security-Policy: frame-ancestors https://admin.example.com
```

The editor tells you when the site never answers, and names the usual causes.

## Recipes

### Nuxt

```vue
<!-- app/pages/[...slug].vue -->
<script setup lang="ts">
import { connect, createOhne } from '@ohnejs/client';
import { Hero, Text } from '#components';

const blocks = { Hero, Text };
const api = useRuntimeConfig().public.ohneAPI;
const ohne = createOhne({ api });
const route = useRoute();
const token = useState('ohne-preview', () => route.query['ohne-preview'] as string | undefined);

const { data: page } = await useAsyncData(`ohne:${route.path}`, () =>
  ohne.resolve(route.path, { token: token.value }),
);
if (page.value?.kind === 'redirect') {
  await navigateTo(page.value.to, { redirectCode: page.value.code, external: true });
}
if (page.value?.kind !== 'page') throw createError({ status: 404 });

if (token.value) {
  for (const [name, value] of Object.entries(ohne.previewHeaders())) {
    useResponseHeader(name).value = value;
  }
}

onMounted(() => {
  if (!token.value) return;
  const preview = connect({ api, onData: (next) => (page.value = next) });
  onBeforeUnmount(preview.dispose);
});

const seo = computed(() => (page.value?.kind === 'page' ? page.value.seo : undefined));
useSeoMeta({
  title: () => seo.value?.title,
  description: () => seo.value?.description,
  ogImage: () => seo.value?.image,
  robots: () => (token.value ? 'noindex' : seo.value?.robots),
});
useHead({
  link: () =>
    page.value?.kind === 'page'
      ? [
          { rel: 'canonical', href: page.value.seo.canonical },
          ...page.value.alternates.map((link) => ({ rel: 'alternate', ...link })),
        ]
      : [],
});
</script>

<template>
  <main v-if="page?.kind === 'page'">
    <h1>{{ page.record.title }}</h1>
    <component
      :is="blocks[block.block as keyof typeof blocks]"
      v-for="block in page.record.content as any[]"
      :key="block.UUID"
      :data-ohne-block="block.UUID"
      v-bind="block.fields"
    />
  </main>
</template>
```

`onData` swaps in each new state as you type, with no request.

### Next

The page renders on the server. In preview, `router.refresh()` renders it again with the token,
which `keepToken` leaves in the URL for it:

```tsx
// components/preview.tsx
'use client';

import { connect } from '@ohnejs/client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function Preview({ api }: { api: string }) {
  const router = useRouter();
  useEffect(() => connect({ api, keepToken: true, onRefresh: router.refresh }).dispose, [api, router]);
  return null;
}
```

```tsx
// app/[[...slug]]/page.tsx
import type { Metadata } from 'next';

import { createOhne } from '@ohnejs/client';
import { notFound, permanentRedirect, redirect } from 'next/navigation';

import { Preview } from '../../components/preview';

const api = process.env.NEXT_PUBLIC_OHNE_API!;
const ohne = createOhne({ api, fetchInit: { cache: 'no-store' } });

type Props = {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<{ 'ohne-preview'?: string }>;
};

async function load({ params, searchParams }: Props) {
  const { slug = [] } = await params;
  const token = (await searchParams)['ohne-preview'];
  const page = await ohne.resolve(`/${slug.join('/')}`, { token });
  if (page.kind === 'redirect') {
    if (page.code === 301 || page.code === 308) permanentRedirect(page.to);
    redirect(page.to);
  }
  if (page.kind === 'notFound') notFound();
  return { page, token };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { page, token } = await load(props);
  return {
    title: page.seo.title,
    description: page.seo.description,
    openGraph: { images: page.seo.image },
    robots: token ? 'noindex' : page.seo.robots,
    alternates: {
      canonical: page.seo.canonical,
      languages: Object.fromEntries(page.alternates.map((link) => [link.hreflang, link.href])),
    },
  };
}

export default async function Page(props: Props) {
  const { page, token } = await load(props);
  const blocks = (page.record.content ?? []) as { block: string; UUID: string; fields: any }[];
  return (
    <main>
      <h1>{String(page.record.title)}</h1>
      {blocks.map((block) => (
        <section key={block.UUID} data-ohne-block={block.UUID}>
          {block.fields.heading}
        </section>
      ))}
      {token && <Preview api={api} />}
    </main>
  );
}
```

### React

A page rendered in the browser fetches itself and takes each new state from `onData`:

```jsx
// src/page.jsx
import { connect, createOhne } from '@ohnejs/client';
import { useEffect, useState } from 'react';

const api = import.meta.env.VITE_OHNE_API;
const ohne = createOhne({ api });
const token = ohne.token(location.href);

export function Page() {
  const [page, setPage] = useState();

  useEffect(() => {
    ohne.resolve(location.pathname, { token }).then((next) => {
      if (next.kind === 'redirect') location.replace(next.to);
      else setPage(next);
    });
    if (token) return connect({ api, onData: setPage }).dispose;
  }, []);

  useEffect(() => {
    if (page?.kind === 'page') document.title = page.seo.title;
  }, [page]);

  if (!page) return null;
  if (page.kind === 'notFound') return <h1>Not found</h1>;
  return (
    <main>
      <h1>{page.record.title}</h1>
      {page.record.content?.map((block) => (
        <section key={block.UUID} data-ohne-block={block.UUID}>
          {block.fields.heading}
        </section>
      ))}
    </main>
  );
}
```

A page rendered in the browser is hard for search engines to read. Prefer a server-rendered
framework for a public site.

### Any server

With no framework, render HTML on the server. `renderHead` writes the `<head>` tags, and
`previewScript` loads the preview, which fetches the page again and swaps the `<body>`:

```js
// server.js
import { createServer } from 'node:http';

import { createOhne, escapeHTML } from '@ohnejs/client';

const ohne = createOhne({ api: process.env.OHNE_API });

createServer(async (request, response) => {
  const path = new URL(request.url, 'http://site').pathname;
  const token = ohne.token(request.url);
  const page = await ohne.resolve(path, { token });

  if (page.kind === 'redirect') {
    response.writeHead(page.code, { location: page.to }).end();
    return;
  }
  if (page.kind === 'notFound') {
    response.writeHead(404, { 'content-type': 'text/html' }).end('<h1>Not found</h1>');
    return;
  }

  const blocks = (page.record.content ?? []).map(
    (block) =>
      `<section data-ohne-block="${block.UUID}">${escapeHTML(block.fields.heading)}</section>`,
  );
  response.writeHead(200, {
    'content-type': 'text/html',
    ...(token ? ohne.previewHeaders() : {}),
  });
  response.end(`<!doctype html>
<html>
  <head>${ohne.renderHead(page, { token })}</head>
  <body>
    <h1>${escapeHTML(page.record.title)}</h1>
    ${blocks.join('')}
    ${token ? ohne.previewScript() : ''}
  </body>
</html>`);
}).listen(3000);
```

## Site settings and SEO

The `Site` collection in the dashboard holds the site's name, a title template like
`{title} | {site}`, and the description and share image a page falls back to.

Each page has its own `seo` group: title, description, image, and a switch that hides it from
search engines. `resolve` merges the two into `seo`, ready for the `<head>`.

Hiding the whole site in `Site` asks search engines to skip every page, and closes `robots.txt`.

## Redirects

Add a redirect in the `Redirects` collection: a `from` path, a `to` path or URL, and a status.
`resolve` answers it before any page, so your site needs no code of its own for it. Turn on
**Keep the query** to carry `?query` parameters over.

## Sitemap and robots.txt

The cms serves both, built from every page visitors may see:

- `/cms/sitemap.xml`, with `hreflang` alternates between locales.
- `/cms/robots.txt`, naming the sitemap.

Serve them from your site's root. In Next, a rewrite does it:

```ts
// next.config.ts
import type { NextConfig } from 'next';

const api = process.env.OHNE_API;

export default {
  async rewrites() {
    return [
      { source: '/sitemap.xml', destination: `${api}/cms/sitemap.xml` },
      { source: '/robots.txt', destination: `${api}/cms/robots.txt` },
    ];
  },
} satisfies NextConfig;
```

A page hidden from search engines, and the `404` page, stay out of the sitemap.

## Webhooks

A website that caches pages needs to know when they change. List the URLs to tell:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['@ohnejs/cms'],
  cms: {
    site: 'https://example.com',
    routes: { Pages: '/[...slug]' },
    webhooks: [{ url: 'https://example.com/api/ohne', secret: process.env.WEBHOOK_SECRET! }],
  },
});
```

Every change to a page, the site settings, or a redirect sends a signed `POST`. Check the signature
before you trust it:

```ts
// app/api/ohne/route.ts
import { verifyWebhook } from '@ohnejs/client';
import { revalidatePath } from 'next/cache';

export async function POST(request: Request) {
  const event = await verifyWebhook(request, process.env.WEBHOOK_SECRET!);
  if (event === null) return new Response(null, { status: 401 });
  revalidatePath('/', 'layout');
  return new Response(null, { status: 204 });
}
```

A failed delivery is not retried. The cms logs it.
