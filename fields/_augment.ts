/**
 * Declares this layer's field types in `LayerFields`, for every program that checks the layer's source.
 * The scanner skips `_`-prefixed files, so it contributes types alone.
 */
declare module 'ohnejs' {
  interface LayerFields {
    /**
     * The part of a page's path that names it, like `about` or `docs/install`.
     */
    slug: typeof import('./slug.ts').default;
  }
}

export {};
