import type {
  CollectedCollection,
  EmittableFieldType,
  FieldInstance,
  FieldJSONType,
  ForeignKeyHint,
  JunctionHint,
  QueryScope,
  ShapeMember,
  ShapeScalarArgs,
} from 'ohnejs';

import {
  collectBlocks,
  collectCollections,
  collectFieldTypes,
  endpointOf,
  fieldJSONType,
  ohneError,
  queryMetadata,
  readShapeType,
  resolveFieldOptions,
  runWithoutEvent,
  stackedLayers,
  useConfig,
  useLayers,
  usePrinter,
  version,
} from 'ohnejs';
import { readScope } from 'ohnejs/auth';
import { hasImageService, useUploadsConfig } from 'ohnejs/uploads';
import {
  errorMessage,
  hasKey,
  hashText,
  isNumber,
  isUndefined,
  pick,
  relativePath,
  uniqueArray,
} from 'ohnejs/utils';
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
import { type CMSRoute, isHome, routesIn } from '../routes.ts';
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
 * A collection the site types left out because its read runs middleware.
 */
export interface GuardedCollection {
  /**
   * The collection's name.
   */
  name: string;

  /**
   * The file that defines the collection.
   */
  file: string;
}

/**
 * The website types file, the field types it could not describe, and the collections it left out.
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

  /**
   * The collections left out of `text` because their read runs middleware, by name.
   */
  guarded: GuardedCollection[];
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
  records: Map<string, Member[]>;
  singletons: string[];
  creatable: Map<string, Member[]>;
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
  'Records',
  'Singleton',
  'Creatable',
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
 * `Records` holds each collection a visitor may read but `Uploads`, as `GET /cms/records` answers it.
 * `Singleton` names those of them that hold one record.
 * `Creatable` holds each collection a visitor may create a record in, with the fields a create takes.
 * A page, a record and their blocks carry relations loaded one hop out: `Related[X]`, or `Upload` for a file.
 * A related record keeps its own relations as `UUID`s, its uploads aside.
 * Each collection's read access is asked as a visitor without a session, exactly as a resolve asks it.
 * A refused collection with pages is left out, its blocks and targets with it.
 * So is one whose read runs middleware, which cannot run without a request, and `guarded` names it.
 * A refused target is `Record<string, unknown>`.
 * A scope's `select` narrows a shape to the named fields, `UUID`, `_updatedAt` and `_translations` included.
 * A `Records` shape keeps its `UUID` regardless, as `GET /cms/records` always answers it.
 * A `readable: false` field drops at every depth.
 * A field type whose JSON form is unknown reads `unknown`, and `degraded` names it.
 * `fresh` re-imports the app's definitions past the module cache, so a long-lived process reads its edits.
 *
 * @example
 * ```ts
 * const { text, degraded, guarded } = await siteTypes()
 * reportDegraded(degraded)
 * reportGuarded(guarded)
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
  const { reach, guarded } = await anonymousReach(collections);
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
  const records = new Map(
    [...reach.keys()]
      .filter((name) => name !== 'Uploads')
      .sort()
      .map((name) => {
        const { select } = reach.get(name)!;
        const shown = isUndefined(select) ? select : [...select, 'UUID'];
        return [
          name,
          [
            ...systemMembers(name, 'page', carriesPath(routes, name, select), shown),
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
          ...systemMembers(name, 'related', carriesPath(routes, name, select), select),
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
    records,
    singletons: [...records.keys()].filter((name) => queryMetadata(name).singleton === true),
    creatable: creatableIn(collections, walker, definitions),
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
    '// Describes `GET /cms/routes/resolve`, `GET /cms/records` and `POST /collections` for a visitor without a session. Relations load one hop out. Upload URLs are absolute.',
  ];
  return {
    text: `${banner.join('\n')}\n${body}`,
    degraded: [...walker.degraded.values()].sort((a, b) => a.type.localeCompare(b.type)),
    guarded,
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
 * Prints one warning per collection the site types left out because its read runs middleware.
 */
export function reportGuarded(guarded: readonly GuardedCollection[]): void {
  for (const { name, file } of guarded) {
    usePrinter().warnBlock({
      title: `Site types leave out \`${name}\``,
      body: [
        'Its read runs middleware, which the site types cannot run without a request.',
        "To type it, move the check into the read's access, which the site types ask as a visitor.",
      ].join('\n'),
      path: relativePath(process.cwd(), file),
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
 * One whose read runs middleware is `guarded` instead, as only a request can run them.
 * An access that throws without a request fails the whole file, naming the collection's file.
 */
async function anonymousReach(
  collections: readonly CollectedCollection[],
): Promise<{ reach: Map<string, QueryScope>; guarded: GuardedCollection[] }> {
  const reach = new Map<string, QueryScope>();
  const guarded: GuardedCollection[] = [];
  for (const { name, file, collection } of collections) {
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
    if (scope === false) continue;
    const { middleware = [] } = endpointOf(collection.api, 'read') ?? {};
    if (middleware.length > 0) guarded.push({ name, file });
    else reach.set(name, scope);
  }
  return { reach, guarded: guarded.sort((a, b) => a.name.localeCompare(b.name)) };
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

  const json = (definition: Definition, args: ShapeScalarArgs): FieldJSONType => {
    const type = fieldJSONType({ ...args, mirror: clientMirror });
    if (isUndefined(type.reason)) return type;
    const entry = degraded.get(args.type) ?? {
      type: args.type,
      reason: type.reason,
      file: types.get(args.type)?.file,
      fields: [],
    };
    entry.fields = uniqueArray([...entry.fields, `${definition.name}.${args.path}`]);
    degraded.set(args.type, entry);
    return type;
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
        scalar: (args) => json(definition, args),
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

  const walkInput = (definition: Definition): Member[] => {
    const fields = Object.fromEntries(
      Object.entries(definition.fields).filter(([, instance]) => {
        const registered = types.get(instance.type);
        if (isUndefined(registered)) return true;
        return (
          resolveFieldOptions(registered.fieldType, { ...instance.options }).writable !== false
        );
      }),
    );
    const bases = new Map<string, string>();
    const docs = readShapeType(
      { subject: `Collection \`${definition.name}\``, file: definition.file },
      fields,
      {
        types,
        blocks,
        imports,
        docs: 'site',
        scalar: (args) => {
          if (args.path !== args.name) return { base: 'unknown', nullable: false };
          const type = json(definition, args);
          bases.set(args.name, type.base);
          return type;
        },
        relation: () => 'string',
        blocksType: () => 'unknown',
      },
    );
    return docs.map(({ name, doc }) => ({
      name,
      doc,
      ...inputType(name, fields[name]!, types.get(fields[name]!.type)!.fieldType, bases.get(name)),
    }));
  };

  return { walk, walkBlocks, walkInput, targets, degraded };
}

/**
 * Each collection a visitor may create a record in, mapped to the fields a create takes.
 * Its create is exposed `public`, since a site's request carries no session.
 * A singleton and `Uploads` take no create from a site, so they are left out.
 * Create middleware and a create `access` judge each request, so neither leaves a collection out.
 */
function creatableIn(
  collections: readonly CollectedCollection[],
  walker: ReturnType<typeof createWalker>,
  definitions: ReadonlyMap<string, Definition>,
): Map<string, Member[]> {
  return new Map(
    collections
      .filter(
        ({ name, collection }) =>
          endpointOf(collection.api, 'create')?.public === true &&
          name !== 'Uploads' &&
          queryMetadata(name).singleton !== true,
      )
      .map(({ name }) => name)
      .sort()
      .map((name) => [name, walker.walkInput(definitions.get(name)!)]),
  );
}

/**
 * The type one top-level field takes in a create, and whether a create may omit it.
 * It follows the framework's own create input, so the site and the API agree on what a create needs.
 * A column takes its JSON type `base`, a `record` a `UUID`, a `records` list its `UUID`s.
 * A composite or blocks field takes `unknown`, which the API validates.
 */
function inputType(
  name: string,
  instance: FieldInstance,
  fieldType: EmittableFieldType['fieldType'],
  base = 'unknown',
): { type: string; optional: boolean } {
  const options = resolveFieldOptions(fieldType, { ...instance.options });
  const hint = fieldType.schema?.({ name, options });
  const listOptional =
    hasKey(options, 'default') || hasKey(options, 'when') || !forbidsEmpty(options);
  if (hint?.kind === 'junction') return { type: 'string[]', optional: listOptional };
  if (hint?.kind === 'blocks' || (hint?.kind === 'child' && hint.cardinality === 'many')) {
    return { type: 'unknown', optional: listOptional };
  }
  const nullable = options.nullable === true;
  const optional = nullable || columnDefaulted(options, fieldType);
  if (hint?.kind === 'child') return { type: 'unknown', optional };
  const type = hint?.kind === 'foreignKey' ? 'string' : base;
  return { type: nullable ? `${type} | null` : type, optional };
}

/**
 * Whether a column field is defaulted: by its own `default`, or by its type's `defaultValue`.
 * A `jsonList` type's default is its empty list, which a field that `forbidsEmpty` cannot take, unless gated.
 */
function columnDefaulted(
  options: Readonly<Record<string, unknown>>,
  fieldType: { defaultValue?: unknown; jsonList?: true },
): boolean {
  if (hasKey(options, 'default')) return true;
  if (isUndefined(fieldType.defaultValue)) return false;
  return !(fieldType.jsonList === true && forbidsEmpty(options)) || hasKey(options, 'when');
}

/**
 * Whether a list field's options rule out the empty list: `allowEmpty: false`, or a `min` of at least 1.
 */
function forbidsEmpty(options: Readonly<Record<string, unknown>>): boolean {
  return options.allowEmpty === false || (isNumber(options.min) && options.min >= 1);
}

/**
 * Whether a record of `collection` can carry a `path`: it has a route its `select` can fill.
 * A route with a param reads `slug`, which the access may withhold.
 * A read never widens past the access, so a withheld `slug` leaves such a route no `path`.
 */
function carriesPath(
  routes: readonly CMSRoute[],
  collection: string,
  select?: readonly string[],
): boolean {
  return routes.some(
    (route) =>
      route.collection === collection &&
      (route.match.params.length === 0 || isUndefined(select) || select.includes('slug')),
  );
}

/**
 * The members every record of `collection` carries besides its fields, those outside `select` left out.
 * A `routed` record, related or read by itself, carries a `path` in a locale where it has one.
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
  code.line(
    jsdocBlock('Each record a page or a record loads one hop out, its own relations as `UUID`s.'),
  );
  emitShapes(
    code,
    'export interface Related',
    '',
    model.related,
    (name) => `A record of \`${name}\` as it loads one hop out.`,
  );
  code.line();
  code.line(
    jsdocBlock('Each collection a visitor may read, its record as `GET /cms/records` answers it.'),
  );
  emitShapes(
    code,
    'export interface Records',
    '',
    model.records,
    (name) => `A record of \`${name}\` as a visitor reads it, relations loaded one hop out.`,
  );
  code.line();
  declare(
    code,
    'The collections in `Records` that hold one record.',
    `export type Singleton = ${literalUnion(model.singletons)};`,
  );
  code.line(
    jsdocBlock(
      'Each collection a visitor may create a record in, with the fields a create takes.\nA composite or blocks field takes `unknown`, which the API validates.',
    ),
  );
  emitShapes(
    code,
    'export interface Creatable',
    '',
    model.creatable,
    (name) => `The fields a create in \`${name}\` takes.`,
  );
  code.line();
  const notFound = model.notFound.map((name) => `CMS['pages'][${literalString(name)}]`);
  code.line(jsdocBlock('What this cms answers a website, for `createOhne<CMS>`.'));
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
    code.line(`notFound: ${notFound.length === 0 ? 'never' : notFound.join(' | ')};`).line();
    code.line(jsdocBlock('Each collection a visitor may read, for `read` and `list`.'));
    code.line('records: Records;').line();
    code.line(
      jsdocBlock('The collections that hold one record, which `read` takes without a `UUID`.'),
    );
    code.line('singletons: Singleton;').line();
    code.line(jsdocBlock('Each collection a visitor may create a record in, for `create`.'));
    code.line('creatable: Creatable;');
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
