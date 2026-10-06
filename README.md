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

Your website reads its pages with [`@ohnejs/client`](https://github.com/ohnejs/client).

## Docs

- [The CMS](https://ohne.dev/docs/cms/setup) - pages, routes, and the live editor.
- [Your website](https://ohne.dev/docs/cms/website) - reading pages and joining the live preview.
- [Frameworks](https://ohne.dev/docs/cms/frameworks) - recipes for Nuxt, Next, React, and plain
  HTML.
- [SEO and redirects](https://ohne.dev/docs/cms/seo) - site settings, sitemap, and `robots.txt`.
- [Webhooks](https://ohne.dev/docs/cms/webhooks) - tell a caching website when pages change.
