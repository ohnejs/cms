# @ohnejs/cms

Turns an [ohne](https://ohne.dev) app into the CMS for a website. Build the website with Nuxt, Next,
React, or plain HTML. Your editors edit its pages in the ohne dashboard, with the live website
beside the form.

## Install

You need Node 26 or newer.

```sh
pnpm add @ohnejs/cms
```

## Connecting ohne

List the layer after `ohnejs/uploads`, say where your website lives, and map paths to collections:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base', 'ohnejs/uploads', '@ohnejs/cms'],
  cms: {
    site: 'https://example.com',
    routes: { Pages: '/[...slug]' },
  },
});
```

Your website reads its pages with [`@ohnejs/client`](https://github.com/ohnejs/client). A link to a
record, in a `richText` or `link` field, arrives with an `href` to that record's page whenever the
reader can open it.

## Site data

A menu, a footer, or a list of posts lives in records, not pages. Your website reads them by
collection name:

```text
GET /cms/records/Site
GET /cms/records/Posts?order=[-publishedAt]&page=2&perPage=10
GET /cms/records/Authors/0192f0c4-7d3e-7c4a-9b1f-2a6e5c8d0f13
```

A singleton, a collection that holds one record, answers that record. Any other collection answers
one page: `{ records, total, page, perPage, lastPage }`, 20 records by default and at most 100.
With a `UUID` it answers that record, or `404`.

Each read goes through the collection's own read access, so a collection read with `publishedScope`
shows a visitor its published records only. A collection the reader may not read answers `404`, and
so does `Uploads`: files arrive inside the records that carry them, with absolute URLs. A record
with a page carries its `path`.

A list takes `where`, `order`, `select`, `page`, `perPage` and `locale`; a single record takes
`select` and `locale`. Any other param is a `400`.

[`@ohnejs/client`](https://github.com/ohnejs/client) reads them with `read` and `list`, typed by your
`ohne.ts`: `Records` holds each collection a visitor may read, and `Singleton` names the ones that
hold one record.

## Docs

- [The CMS](https://ohne.dev/docs/cms/setup) - pages, routes, and the live editor.
- [Your website](https://ohne.dev/docs/cms/website) - reading pages and joining the live preview.
- [Frameworks](https://ohne.dev/docs/cms/frameworks) - recipes for Nuxt, Next, React, and plain
  HTML.
- [Monorepo](https://ohne.dev/docs/project/monorepo#adding-the-cms) - the CMS and your Nuxt or Next
  website in one repository.
- [SEO and redirects](https://ohne.dev/docs/cms/seo) - site settings, sitemap, and `robots.txt`.
- [Webhooks](https://ohne.dev/docs/cms/webhooks) - tell a caching website when pages change.
