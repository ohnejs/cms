import type {
  EmittableFieldType,
  FieldInstance,
  ForeignKeyHint,
  JunctionHint,
  QueryScope,
  ShapeMember,
} from 'ohnejs';

import {
  collectBlocks,
  collectCollections,
  collectFieldTypes,
  fieldJSONType,
  ohneError,
  queryMetadata,
  readShapeType,
  runWithoutEvent,
  stackedLayers,
  useConfig,
  useLayers,
  usePrinter,
  version,
} from 'ohnejs';
import { readScope } from 'ohnejs/auth';
import { hasImageService, useUploadsConfig } from 'ohnejs/uploads';
import { errorMessage, hashText, isUndefined, pick, relativePath, uniqueArray } from 'ohnejs/utils';
import {
  type CodeBuilder,
  createCodeBuilder,
  createTypeImports,
  jsdocBlock,
  literalString,
  literalUnion,
  propertyKey,
  type TypeImports,
} from 'ohnejs/utils/codegen';

import pkg from '../../package.json' with { type: 'json' };
import { UPLOAD_FIELDS } from '../relations.ts';
import { isHome, routesIn } from '../routes.ts';
import { clientMirror } from './mirror.ts';

/**
 * A field type the site types could not describe, with every field it left `unknown`.
 */
export interface DegradedType {
  /**
   * The name the field type is registered under.
   */
  type: string;

  /**
   * Why its JSON form is unknown, as one sentence.
   */
  reason: string;

  /**
   * The file that defines the field type.
   */
  file?: string;

  /**
   * Each field it left `unknown`, as `Owner.path`.
   */
  fields: string[];
}

/**
 * The website types file and the field types it could not describe.
 */
export interface SiteTypes {
  /**
   * The source of the file a website imports.
   */
  text: string;

  /**
   * The field types whose fields read `unknown` in `text`, by name.
   */
  degraded: DegradedType[];
}

/**
 * How far from the page a shape sits: the page and its blocks, or a record loaded one hop out.
 */
type Depth = 'page' | 'related';

/**
 * One collection or block a shape is walked from.
 */
interface Definition {
  subject: 'Collection' | 'Block';
  name: string;
  file: string;
  fields: Record<string, FieldInstance>;
}

/**
 * One property of an emitted shape.
 */
type Member = ShapeMember & { optional?: boolean };

/**
 * Every shape the file declares, walked and sorted.
 */
interface SiteModel {
  locales: string[];
  variants: string[];
  upload: Member[] | undefined;
  blocks: Map<string, Member[]>;
  relatedBlocks: Map<string, Member[]>;
  related: Map<string, Member[]>;
  pages: Map<string, Member[]>;
  notFound: string[];
}

const DECLARED = [
  'Locale',
  'ImageVariant',
  'Upload',
  'Blocks',
  'Block',
  'RelatedBlocks',
  'RelatedBlock',
  'Related',
  'CMS',
  'Page',
];
const UUID_DOC = jsdocBlock("This record's unique identifier.");
const UPDATED_AT_DOC = jsdocBlock(
  'When this record was last updated, as a Unix timestamp in milliseconds.',
);
const TRANSLATIONS_DOC = jsdocBlock('The locales holding a translation of this record.');
const PATH_DOC = jsdocBlock("The record's page path, when it has a page in this locale.");

/**
 * Renders the types a website imports to read this cms, as an anonymous reader resolves its pages.
 *
 * `CMS` describes everything a resolve returns; `Page`, `Block`, `Related` and `Upload` name its parts.
 * A page and its blocks carry each relation loaded one hop out: `Related[X]`, or `Upload` for a file.
 * A related record keeps its own relations as `UUID`s, its uploads aside.
 * Each collection's read access is asked as a visitor without a session, exactly as a resolve asks it.
 * A refused collection with pages is left out, its blocks and targets with it.
 * A refused target is `Record<string, unknown>`.
 * A scope's `select` narrows a shape to the named fields, `UUID`, `_updatedAt` and `_translations` included.
 * A `readable: false` field drops at every depth.
 * A field type whose JSON form is unknown reads `unknown`, and `degraded` names it.
 * `fresh` re-imports the app's definitions past the module cache, so a long-lived process reads its edits.
 *
 * @example
 * ```ts
 * const { text, degraded } = await siteTypes()
 * reportDegraded(degraded)
 * ```
 */
export async function siteTypes({ fresh = false }: { fresh?: boolean } = {}): Promise<SiteTypes> {
  const { disable } = useConfig();
  const [collections, blocks, types] = await Promise.all([
    collectCollections(stackedLayers(), { disable: disable.collections, fresh }),
    collectBlocks(stackedLayers(), { disable: disable.blocks, fresh }),
    collectFieldTypes({ fresh }),
  ]);
  const definitions = new Map<string, Definition>(
    collections.map(({ name, file, collection }) => [
      name,
      { subject: 'Collection', name, file, fields: collection.fields },
    ]),
  );
  const blockDefinitions = new Map<string, Definition>(
    blocks.map(({ name, file, block }) => [
      name,
      { subject: 'Block', name, file, fields: block.fields },
    ]),
  );
  const imports = createTypeImports(appDir(), DECLARED);
  const reach = await anonymousReach(definitions);
  const walker = createWalker(types, [...blockDefinitions.keys()], imports, reach);

  const locales = [...useConfig().collections.locales].sort();
  const routes = locales.flatMap((locale) => routesIn(locale));
  const routed = uniqueArray(routes.map((route) => route.collection)).sort();
  const pages = new Map(
    routed
      .filter((name) => reach.has(name))
      .map((name) => {
        const { select } = reach.get(name)!;
        return [
          name,
          [
            ...systemMembers(name, 'page', false, select),
            ...walker.walk(definitions.get(name)!, 'page', select),
          ],
        ];
      }),
  );
  const pageBlocks = walker.walkBlocks('page', blockDefinitions);
  const related = new Map(
    [...walker.targets].sort().map((name) => {
      const { select } = reach.get(name)!;
      return [
        name,
        [
          ...systemMembers(name, 'related', routed.includes(name), select),
          ...walker.walk(definitions.get(name)!, 'related', select),
        ],
      ];
    }),
  );
  const relatedBlocks = walker.walkBlocks('related', blockDefinitions);
  const uploads = definitions.get('Uploads');
  const upload = isUndefined(uploads) ? undefined : uploadMembers(walker, uploads);
  const variants =
    !isUndefined(uploads) && hasImageService()
      ? Object.keys(useUploadsConfig().images.variants).sort()
      : [];

  const body = render(imports, {
    locales,
    variants,
    upload,
    blocks: pageBlocks,
    relatedBlocks,
    related,
    pages,
    notFound: uniqueArray(routes.filter(isHome).map((route) => route.collection))
      .filter((name) => pages.has(name))
      .sort(),
  });
  const service = isUndefined(uploads)
    ? ''
    : ` - image service ${hasImageService() ? 'on' : 'off'}`;
  const schema = hashText(body).toString(16).padStart(8, '0');
  const banner = [
    `// Generated by @ohnejs/cms ${pkg.version} on ohne ${version} - protocol 1 - locales ${locales.join(',')}${service} - schema ${schema}. Do not edit.`,
    '// Describes `GET /cms/routes/resolve` for an anonymous reader. Relations load one hop out. Upload URLs are absolute.',
  ];
  return {
    text: `${banner.join('\n')}\n${body}`,
    degraded: [...walker.degraded.values()].sort((a, b) => a.type.localeCompare(b.type)),
  };
}

/**
 * Prints one warning per field type the site types left `unknown`, naming each field and the fix.
 * A field type from a package is fixed by overriding it in the app, since its file is not yours to edit.
 */
export function reportDegraded(degraded: readonly DegradedType[]): void {
  for (const { type, reason, file, fields } of degraded) {
    const packaged = file?.split(/[\\/]/).includes('node_modules') === true;
    usePrinter().warnBlock({
      title: `Field type \`${type}\` has no JSON type`,
      body: [
        reason,
        'These fields are `unknown` in the site types:',
        '',
        ...fields.map((field) => `- \`${field}\``),
        '',
        packaged
          ? `Override \`${type}\` in your app's \`fields/\` by spreading the layer's type and adding \`emitJSONType\`.`
          : 'Declare `emitJSONType` on the field type to describe its JSON form.',
      ].join('\n'),
      path: isUndefined(file) ? undefined : relativePath(process.cwd(), file),
    });
  }
}

/**
 * The app's own directory: the closest layer of the stack.
 */
function appDir(): string {
  return useLayers().layers().at(-1)!.path;
}

/**
 * Each collection a visitor without a session may read, mapped to the scope its read access answers.
 * An access that throws without a request fails the whole file, naming the collection's file.
 */
async function anonymousReach(
  definitions: ReadonlyMap<string, Definition>,
): Promise<Map<string, QueryScope>> {
  const reach = new Map<string, QueryScope>();
  for (const { name, file } of definitions.values()) {
    let scope: QueryScope | false;
    try {
      scope = await runWithoutEvent(() => readScope(name));
    } catch (error) {
      throw ohneError({
        title: `Read access of \`${name}\` cannot answer for a visitor`,
        body: [
          errorMessage(error),
          '',
          'The site types ask each read access with no request bound, as a visitor without a session.',
          'Answer without one, as `publishedScope` does: `useUser()` is `null` there and `tryUseEvent()` `undefined`.',
        ],
        path: file,
      });
    }
    if (scope !== false) reach.set(name, scope);
  }
  return reach;
}

/**
 * Walks shapes at either depth, recording the blocks and readable targets each walk reaches.
 */
function createWalker(
  types: ReadonlyMap<string, EmittableFieldType>,
  blocks: readonly string[],
  imports: TypeImports,
  reach: ReadonlyMap<string, QueryScope>,
) {
  const reached = { page: new Set<string>(), related: new Set<string>() };
  const targets = new Set<string>();
  const degraded = new Map<string, DegradedType>();

  const targetType = (target: string, depth: Depth): string => {
    if (target === 'Uploads') return 'Upload';
    if (depth === 'related') return 'string';
    if (!reach.has(target)) return 'Record<string, unknown>';
    targets.add(target);
    return `Related[${literalString(target)}]`;
  };

  const relationType = (hint: ForeignKeyHint | JunctionHint, depth: Depth): string => {
    const type = targetType(hint.collection, depth);
    return hint.kind === 'junction' ? `${type}[]` : `${type} | null`;
  };

  const walk = (definition: Definition, depth: Depth, select?: readonly string[]): ShapeMember[] =>
    readShapeType(
      { subject: `${definition.subject} \`${definition.name}\``, file: definition.file },
      isUndefined(select) ? definition.fields : pick(definition.fields, select),
      {
        types,
        blocks,
        imports,
        nested: definition.subject === 'Block',
        dropHidden: 'always',
        docs: 'site',
        scalar: (args) => {
          const json = fieldJSONType({ ...args, mirror: clientMirror });
          if (isUndefined(json.reason)) return json;
          const entry = degraded.get(args.type) ?? {
            type: args.type,
            reason: json.reason,
            file: types.get(args.type)?.file,
            fields: [],
          };
          entry.fields = uniqueArray([...entry.fields, `${definition.name}.${args.path}`]);
          degraded.set(args.type, entry);
          return json;
        },
        relation: ({ hint }) => relationType(hint, depth),
        blocksType: ({ allowed }) => {
          for (const block of allowed) reached[depth].add(block);
          return `${depth === 'page' ? 'Block' : 'RelatedBlock'}<${literalUnion(allowed)}>[]`;
        },
      },
    );

  const walkBlocks = (
    depth: Depth,
    definitions: ReadonlyMap<string, Definition>,
  ): Map<string, Member[]> => {
    const shapes = new Map<string, Member[]>();
    let pending = [...reached[depth]];
    while (pending.length > 0) {
      for (const name of pending) shapes.set(name, walk(definitions.get(name)!, depth));
      pending = [...reached[depth]].filter((name) => !shapes.has(name));
    }
    return new Map([...shapes].sort(([a], [b]) => a.localeCompare(b)));
  };

  return { walk, walkBlocks, targets, degraded };
}

/**
 * The members every record of `collection` carries besides its fields, those outside `select` left out.
 * A related record of a collection with pages carries a `path` in a locale where it has one.
 */
function systemMembers(
  collection: string,
  depth: Depth,
  routed: boolean,
  select?: readonly string[],
): Member[] {
  const members: Member[] = [
    { name: 'UUID', type: 'string', doc: UUID_DOC },
    { name: '_updatedAt', type: 'number', doc: UPDATED_AT_DOC },
  ];
  if (queryMetadata(collection).translatable === true) {
    members.push({
      name: '_translations',
      type: 'Locale[]',
      doc: TRANSLATIONS_DOC,
      optional: depth === 'related',
    });
  }
  const selected = members.filter(({ name }) => isUndefined(select) || select.includes(name));
  if (routed) selected.push({ name: 'path', type: 'string', doc: PATH_DOC, optional: true });
  return selected;
}

/**
 * The members of `Upload`: the stored fields a site may see, then its absolute `url`.
 */
function uploadMembers(walker: ReturnType<typeof createWalker>, uploads: Definition): Member[] {
  const shown = UPLOAD_FIELDS.filter((name) => name !== 'UUID');
  const fields = walker.walk({ ...uploads, fields: pick(uploads.fields, shown) }, 'related');
  return [
    { name: 'UUID', type: 'string', doc: jsdocBlock("This upload's unique identifier.") },
    ...fields.map((member) =>
      member.name === 'description'
        ? {
            ...member,
            doc: jsdocBlock(
              "The alternative text, in the page's locale; `null` when it has no translation there.",
            ),
          }
        : member,
    ),
    { name: 'url', type: 'string', doc: jsdocBlock("The file's absolute URL.") },
  ];
}

/**
 * Renders every declaration of the file below its banner.
 */
function render(imports: TypeImports, model: SiteModel): string {
  const code = createCodeBuilder();
  const statements = imports.statements();
  if (statements.length > 0) code.lines(statements).line();
  declare(
    code,
    'A locale a page is read in.',
    `export type Locale = ${literalUnion(model.locales)};`,
  );
  if (model.variants.length > 0) {
    declare(
      code,
      'A configured image variant.',
      `export type ImageVariant = ${literalUnion(model.variants)};`,
    );
  }
  if (!isUndefined(model.upload)) {
    const members: Member[] = [...model.upload];
    if (model.variants.length > 0) {
      members.push({
        name: 'variants',
        type: 'Record<ImageVariant, string>',
        doc: jsdocBlock('One absolute URL per variant, present for an image the service renders.'),
        optional: true,
      });
    }
    code.line(
      jsdocBlock(
        'A public file a page carries.\nA private upload or a folder reads `null`, or drops from its list.',
      ),
    );
    emitObject(code, 'export interface Upload', '', members, (member) => emitMember(code, member));
    code.line();
  }
  code.line(
    jsdocBlock("Each block's fields as a page carries them, relations loaded one hop out."),
  );
  emitShapes(
    code,
    'export interface Blocks',
    '',
    model.blocks,
    (name) => `The \`${name}\` block's fields.`,
  );
  code.line();
  declare(
    code,
    'One item of a blocks field on a page, narrowed by `block`.',
    [
      'export type Block<B extends keyof Blocks = keyof Blocks> = {',
      '  [K in B]: { block: K; UUID: string; fields: Blocks[K] };',
      '}[B];',
    ].join('\n'),
  );
  if (model.relatedBlocks.size > 0) {
    code.line(
      jsdocBlock("Each block's fields as a related record carries them, relations as `UUID`s."),
    );
    emitShapes(
      code,
      'interface RelatedBlocks',
      '',
      model.relatedBlocks,
      (name) => `The \`${name}\` block's fields.`,
    );
    code.line();
    declare(
      code,
      'One item of a blocks field on a related record, narrowed by `block`.',
      [
        'type RelatedBlock<B extends keyof RelatedBlocks = keyof RelatedBlocks> = {',
        '  [K in B]: { block: K; UUID: string; fields: RelatedBlocks[K] };',
        '}[B];',
      ].join('\n'),
    );
  }
  code.line(jsdocBlock('Each record a page loads one hop out, its own relations as `UUID`s.'));
  emitShapes(
    code,
    'export interface Related',
    '',
    model.related,
    (name) => `A record of \`${name}\` as a page loads it.`,
  );
  code.line();
  const notFound = model.notFound.map((name) => `CMS['pages'][${literalString(name)}]`);
  code.line(jsdocBlock('What this cms resolves, for `createOhne<CMS>`.'));
  code.line('export interface CMS {');
  code.indent(() => {
    code.line(jsdocBlock('The resolve protocol this file describes.')).line('protocol: 1;').line();
    code.line(jsdocBlock('The locale a page is read in.')).line('locale: Locale;').line();
    code.line(jsdocBlock('Each collection with pages, its record as its page resolves it.'));
    emitShapes(
      code,
      'pages:',
      ';',
      model.pages,
      (name) => `A record of \`${name}\` as its page resolves it.`,
    );
    code.line();
    code.line(
      jsdocBlock("The page a path no route answers carries: the `[...slug]` route's `404` record."),
    );
    code.line(`notFound: ${notFound.length === 0 ? 'never' : notFound.join(' | ')};`);
  });
  code.line('}').line();
  code.line(jsdocBlock('A record of collection `C` as its page resolves it.'));
  code.line(
    "export type Page<C extends keyof CMS['pages'] = keyof CMS['pages']> = CMS['pages'][C];",
  );
  return code.toString();
}

/**
 * Emits one documented type declaration and the blank line after it.
 */
function declare(code: CodeBuilder, doc: string, declaration: string): void {
  code.line(jsdocBlock(doc)).line(declaration).line();
}

/**
 * Emits `open {`, each entry a blank line apart, then `}end`; no entries collapse to `open {}end`.
 */
function emitObject<T>(
  code: CodeBuilder,
  open: string,
  end: string,
  entries: readonly T[],
  emit: (entry: T) => void,
): void {
  if (entries.length === 0) {
    code.line(`${open} {}${end}`);
    return;
  }
  code.line(`${open} {`);
  code.indent(() =>
    entries.forEach((entry, i) => {
      if (i > 0) code.line();
      emit(entry);
    }),
  );
  code.line(`}${end}`);
}

/**
 * Emits an object type of named shapes, each under the doc `docOf` writes for it.
 */
function emitShapes(
  code: CodeBuilder,
  open: string,
  end: string,
  shapes: ReadonlyMap<string, readonly Member[]>,
  docOf: (name: string) => string,
): void {
  emitObject(code, open, end, [...shapes], ([name, members]) => {
    code.line(jsdocBlock(docOf(name)));
    emitObject(code, `${propertyKey(name)}:`, ';', members, (member) => emitMember(code, member));
  });
}

/**
 * Emits one property under its doc.
 */
function emitMember(code: CodeBuilder, member: Member): void {
  code.line(member.doc);
  code.line(`${propertyKey(member.name)}${member.optional === true ? '?' : ''}: ${member.type};`);
}
