import type { TypeMirror } from 'ohnejs';

/**
 * The `ohnejs/utils` types `@ohnejs/client` exports under the same name and shape.
 */
export const MIRRORED_TYPES = [
  'Link',
  'RecordLink',
  'URLLink',
  'RichText',
  'RichTextBlock',
  'RichTextParagraph',
  'RichTextHeading',
  'RichTextQuote',
  'RichTextList',
  'RichTextListItem',
  'RichTextRun',
  'RichTextMark',
  'RichTextHeadingLevel',
] as const;

/**
 * Reads a link or rich text type from `@ohnejs/client`, which a website installs, instead of `ohnejs/utils`.
 * Any other type has no mirror, so a website cannot import it.
 */
export const clientMirror: TypeMirror = (path, exportName) =>
  path === 'ohnejs/utils' && (MIRRORED_TYPES as readonly string[]).includes(exportName)
    ? '@ohnejs/client'
    : undefined;
