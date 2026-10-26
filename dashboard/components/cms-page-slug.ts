import type {
  Child,
  DashboardCollection,
  DashboardField,
  FieldControl,
  FieldType,
  IconName,
  KnownFieldTypes,
  MenuAction,
  MenuGroup,
  Text,
} from 'ohnejs/dashboard';

import { effectiveContentLocale } from 'app/components/content-language-switcher.ts';
import {
  attachTooltip,
  badge,
  button,
  css,
  dashboardMeta,
  fieldTypeFor,
  h,
  icon,
  menu,
  note,
  translateMessage,
} from 'ohnejs/dashboard';
import {
  canonicalSlug,
  escapeMarkdown,
  isNull,
  isNullish,
  isString,
  isUndefined,
  onCleanup,
  ref,
  untracked,
} from 'ohnejs/utils';

import {
  pagePath,
  siteAddress,
  siteURL,
  type SpecialPage,
  specialPage,
  takesSpecialPages,
} from './cms-meta.ts';
import { slugHolder } from './cms-slug-holder.ts';

declare module 'ohnejs/dashboard' {
  interface KnownFieldTypes {
    /**
     * The slug of a collection with pages, edited as the page's address on the website.
     */
    pageSlug: { options: PageSlugFieldOptions; value: string };
  }
}

type PageSlugFieldOptions = KnownFieldTypes['slug']['options'] & { collection: string };

const KINDS: readonly SpecialPage[] = ['home', 'notFound'];

const TEXTS = {
  home: {
    icon: 'home',
    label: 'cms.address.home',
    open: 'cms.address.openHome',
    reserved: 'cms.address.reservedHome',
    taken: 'cms.address.takenHome',
    leaves: 'cms.address.leavesHome',
  },
  notFound: {
    icon: 'error-404',
    label: 'cms.address.notFound',
    open: 'cms.address.openNotFound',
    reserved: 'cms.address.reservedNotFound',
    taken: 'cms.address.takenNotFound',
    leaves: 'cms.address.leavesNotFound',
  },
} as const satisfies Record<SpecialPage, Record<string, string> & { icon: IconName }>;

css`
  .o-cms-address {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    min-width: 0;
  }

  .o-cms-address-special {
    display: flex;
    align-items: center;
    gap: 0.5em;
    min-height: calc(2em + 0.25rem);
    padding: 0.125rem 0.5em 0.125rem 0.125rem;
    background-color: hsl(var(--ohne-card));
    border: 1px solid hsl(var(--ohne-input));
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
  }

  /* Sized as a chip in the chips input, so the box reads as a filled field. */
  .o-cms-address-chip {
    flex-shrink: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    width: calc(2em - 0.125rem);
    height: calc(2em - 0.125rem);
    background-color: hsl(var(--ohne-tone));
    border-radius: calc(var(--ohne-radius) - 0.25rem);
    color: hsl(var(--ohne-tone-foreground));
  }

  .o-cms-address-special-disabled {
    background-color: hsl(var(--ohne-muted));
  }

  .o-cms-address-special > .o-cms-address-dim {
    flex: 1;
    font-size: 1em;
  }

  .o-cms-address-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.5rem;
    min-width: 0;
  }

  .o-cms-address-dim {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex: 1 1 12rem;
    min-width: 0;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.75rem;
  }

  .o-cms-address-dim > svg {
    flex-shrink: 0;
  }

  a.o-cms-address-link {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
    color: inherit;
    text-decoration: none;
  }

  a.o-cms-address-link:focus-visible {
    color: hsl(var(--ohne-foreground));
  }

  @media (hover: hover) {
    a.o-cms-address-link:hover {
      color: hsl(var(--ohne-foreground));
    }
  }

  .o-cms-address-row > .ohne-button {
    margin-left: auto;
  }
`;

/**
 * The slug of a collection with pages, read as the page's address on the website.
 * The address follows the typing, and a menu makes the page the home or the not-found page.
 * A special page shows its badge in place of its slug, whose input it locks.
 * Typing the home or not-found slug by hand blocks the save with a hint to the menu instead.
 * Everything else, the slug's own checks included, is the builtin `slug` type's, resolved on each use.
 */
export const pageSlugType: FieldType<PageSlugFieldOptions> = {
  display(context) {
    const collection = collectionOf(context.field);
    return () => {
      const kind = isUndefined(collection)
        ? undefined
        : specialPage(collection, localeOf(context.field), context.value());
      return isUndefined(kind) ? slug().display(context) : specialBadge(kind);
    };
  },
  control(context) {
    const inner = slug().control?.(context);
    const collection = collectionOf(context.field);
    const cms = dashboardMeta()?.cms;
    if (isUndefined(inner) || isUndefined(collection) || isUndefined(cms)) return inner;
    return addressControl(context.field, collection, inner, {
      initial: context.initial,
      disabled: context.disabled === true,
      onInput: context.onInput,
    });
  },
  get summary() {
    return slug().summary;
  },
  get filter() {
    return slug().filter;
  },
};

/**
 * The builtin `slug` type as the registry holds it now, so an app's own `slug` applies here too.
 */
function slug(): FieldType<PageSlugFieldOptions> {
  return fieldTypeFor({ type: 'slug', kind: 'column' }) as FieldType<PageSlugFieldOptions>;
}

/**
 * The collection a page slug belongs to.
 */
function collectionOf(
  field: DashboardField<PageSlugFieldOptions>,
): DashboardCollection | undefined {
  const name = field.options?.collection;
  return dashboardMeta()?.collections.find((collection) => collection.name === name);
}

/**
 * The locale a slug answers for: the content locale when it is translatable, else every locale.
 */
function localeOf(field: DashboardField): string | undefined {
  return field.translatable ? effectiveContentLocale() : undefined;
}

/**
 * The badge a special page shows in a cell, in place of its slug.
 */
function specialBadge(kind: SpecialPage): HTMLElement {
  return badge(TEXTS[kind].label, { icon: TEXTS[kind].icon, tone: 'accent' });
}

/**
 * The icon a special page shows in its locked box, named by its tooltip.
 */
function specialIcon(kind: SpecialPage): HTMLElement {
  const label = (): string => translateMessage(TEXTS[kind].label);
  const chip = h(
    'span',
    { class: 'o-cms-address-chip ohne-tone-accent', role: 'img', 'aria-label': label },
    icon(TEXTS[kind].icon),
  );
  onCleanup(attachTooltip(chip, label));
  return chip;
}

/**
 * The address `shown` on one truncated line, a link opening `href` in a new tab when there is one.
 */
function addressText(shown: string, href: string | undefined): Child {
  const text = h('span', { class: 'ohne-truncate', title: shown }, shown);
  if (isUndefined(href)) return text;
  return h(
    'a',
    { class: 'o-cms-address-link', href, target: '_blank', rel: 'noopener noreferrer' },
    text,
  );
}

/**
 * Wraps the builtin slug control `inner` with the address line, the special-page menu, and its notes.
 * The inner control stays mounted throughout, so its checks, history, and server messages hold.
 */
function addressControl(
  field: DashboardField<PageSlugFieldOptions>,
  collection: DashboardCollection,
  inner: FieldControl,
  context: { initial: unknown; disabled: boolean; onInput(discrete?: boolean): void },
): FieldControl {
  const cms = dashboardMeta()!.cms!;
  // The form rebuilds on a locale switch, so the control answers for the locale it was built in.
  const locale = untracked(effectiveContentLocale);
  const scope = field.translatable ? locale : undefined;
  const takes = takesSpecialPages(collection, scope);
  const kindOf = (value: unknown): SpecialPage | undefined => specialPage(collection, scope, value);
  const reserved = (kind: SpecialPage): string =>
    kind === 'home' ? cms.homeSlug : cms.notFoundSlug;

  const base = ref(context.initial);
  const special = ref(kindOf(context.initial));

  const typed = (): string => {
    const draft = inner.draft?.();
    return isString(draft) ? canonicalSlug(draft, field.options) : '';
  };
  const clash = (): SpecialPage | undefined =>
    isUndefined(special.value) ? kindOf(typed()) : undefined;
  const leaving = (): SpecialPage | undefined => {
    const held = kindOf(base.value);
    return held === special.value ? undefined : held;
  };

  const holders = { home: holder('home'), notFound: holder('notFound') };
  // A record's saved address never clashes with itself, as the save's uniqueness check reads it.
  const taken = slugHolder(
    collection,
    () => scope,
    () => {
      if (context.disabled || !isUndefined(special.value) || !isUndefined(clash()))
        return undefined;
      const value = typed();
      return value === '' || value === base.value ? undefined : value;
    },
  );

  const choose = (kind: SpecialPage): void => {
    special.value = kind;
    context.onInput(true);
  };
  const own = (): void => {
    special.value = undefined;
    if (!isUndefined(kindOf(base.value))) inner.restore?.('');
    context.onInput(true);
    queueMicrotask(() => inner.focus());
  };

  const trigger =
    takes && !context.disabled
      ? menu(
          button(
            [h('span', null, () => translateMessage('cms.address.special')), icon('chevron-down')],
            { variant: 'ghost', size: -2 },
          ),
          () => groups(),
        )
      : null;

  const element = h(
    'div',
    { class: 'o-cms-address' },
    () => (isUndefined(special.value) ? null : specialBox(special.value)),
    h('div', { hidden: () => !isUndefined(special.value) }, inner.element),
    h(
      'div',
      { class: 'o-cms-address-row', hidden: () => isNull(trigger) && isUndefined(address()) },
      () => addressLine(),
      trigger,
    ),
    () => notice(),
  );

  return {
    element,
    read() {
      if (!isUndefined(special.value)) return { value: reserved(special.value) };
      const kind = clash();
      if (!isUndefined(kind)) return { errors: { '': translateMessage(hint(kind)) } };
      return inner.read();
    },
    draft: () => (isUndefined(special.value) ? inner.draft?.() : reserved(special.value)),
    setErrors: (errors) => inner.setErrors(errors),
    error: () => inner.error(),
    dirty: () =>
      isUndefined(special.value) ? inner.dirty() : reserved(special.value) !== base.value,
    focus() {
      if (isUndefined(special.value) || isNull(trigger)) inner.focus();
      else trigger.focus();
    },
    revert() {
      inner.revert();
      special.value = kindOf(base.value);
    },
    rebase(value) {
      inner.rebase(value);
      base.value = value;
      special.value = kindOf(value);
    },
    restore(value) {
      special.value = kindOf(value);
      if (isUndefined(special.value)) inner.restore?.(value);
    },
  };

  /**
   * The record of `collection` that holds `kind`, read only while this record could take it from it.
   */
  function holder(kind: SpecialPage): ReturnType<typeof slugHolder> {
    return slugHolder(
      collection,
      () => scope,
      () =>
        !takes || context.disabled || kindOf(base.value) === kind ? undefined : reserved(kind),
    );
  }

  /**
   * The menu: each special page this record is not, then the way back to an address of its own.
   * A page another record holds is disabled, with a link to that record.
   */
  function groups(): readonly MenuGroup[] {
    const pick: MenuGroup = KINDS.filter((kind) => kind !== special.value).flatMap(
      (kind): MenuAction[] => {
        const row = { label: TEXTS[kind].label, icon: TEXTS[kind].icon };
        const held = holders[kind]();
        if (isNullish(held)) return [{ ...row, onSelect: () => choose(kind) }];
        return [
          { ...row, disabled: () => true },
          { label: TEXTS[kind].open, icon: 'arrow-right', href: held.href },
        ];
      },
    );
    return [
      pick,
      isUndefined(special.value)
        ? []
        : [{ label: 'cms.address.own', icon: 'pencil', onSelect: own }],
    ];
  }

  /**
   * The locked box a special page shows in place of the input: its badge and where it shows.
   * The home address links to the public page once this record is the home page there.
   */
  function specialBox(kind: SpecialPage): HTMLElement {
    return h(
      'div',
      {
        class: `o-cms-address-special${context.disabled ? ' o-cms-address-special-disabled' : ''}`,
      },
      specialIcon(kind),
      h(
        'span',
        { class: 'o-cms-address-dim' },
        kind === 'home'
          ? homeAddress()
          : addressText(translateMessage('cms.address.notFoundHint'), undefined),
      ),
    );
  }

  /**
   * The home page's address, a link while this record is the saved home page, the one the site serves.
   */
  function homeAddress(): Child {
    const path = pagePath(collection, homeLocale(), { slug: cms.homeSlug }) ?? '/';
    const live = kindOf(base.value) === 'home';
    return addressText(siteAddress(path), live ? siteURL(path) : undefined);
  }

  /**
   * The site path the typed slug gives the page, while it has its own.
   * A hand-typed home or not-found slug has none, as it cannot save, nor one another record holds.
   */
  function address(): string | undefined {
    if (!isUndefined(special.value) || !isUndefined(clash()) || !isNullish(taken())) {
      return undefined;
    }
    return pagePath(collection, locale, { slug: typed() });
  }

  /**
   * The line showing `address` as a visitor reaches it, a link to the public page while it is the saved one.
   */
  function addressLine(): Child {
    const path = address();
    if (isUndefined(path)) return null;
    const live = !isUndefined(base.value) && typed() === base.value;
    return h(
      'span',
      { class: 'o-cms-address-dim' },
      icon('world'),
      addressText(siteAddress(path), live ? siteURL(path) : undefined),
    );
  }

  /**
   * The warning under the address: a reserved slug typed by hand, then one another record holds.
   * Else it is the special page this record leaves.
   * A hint gives way to the error the save routes in.
   */
  function notice(): Child {
    const kind = clash();
    if (!isUndefined(kind) && inner.error() === '') return warning(hint(kind));
    const holder = taken();
    if (!isNullish(holder) && inner.error() === '') {
      return warning({
        key: 'cms.address.taken',
        params: { title: escapeMarkdown(holder.title), href: holder.href },
      });
    }
    const left = leaving();
    return isUndefined(left) ? null : warning(TEXTS[left].leaves);
  }

  /**
   * Why a hand-typed `kind` slug cannot save: the record that holds it, else the menu that makes it.
   */
  function hint(kind: SpecialPage): Text {
    const held = holders[kind]();
    if (isNullish(held)) return TEXTS[kind].reserved;
    return {
      key: TEXTS[kind].taken,
      params: { title: escapeMarkdown(held.title), href: held.href },
    };
  }

  /**
   * A note that the save will not do what the reader expects.
   */
  function warning(text: Text): HTMLElement {
    return note(text, { tone: 'warning', icon: 'alert-triangle' });
  }

  /**
   * The locale whose home address a shared slug shows: the current one when it has a home, else the first.
   */
  function homeLocale(): string {
    if (takesSpecialPages(collection, locale)) return locale;
    const locales = Object.keys(cms.routes[collection.name] ?? {});
    return locales.find((entry) => takesSpecialPages(collection, entry)) ?? locale;
  }
}
