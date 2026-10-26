import type { RecordEditor } from 'app/components/record-editor.ts';
import type { Child, DashboardCollection, Text } from 'ohnejs/dashboard';

import { effectiveContentLocale } from 'app/components/content-language-switcher.ts';
import { api, dashboardMeta, fallbackLabel, joinLabel, note, useResource } from 'ohnejs/dashboard';
import { effect, hasRoute, isUndefined, untracked } from 'ohnejs/utils';

import { hasPages, pagePath, specialPage, takesSpecialPages } from './cms-meta.ts';

/**
 * On a page that may be the home page, the notice that visitors see no home page in this locale.
 * It names the record that holds the home slug when one is readable, and says so on that record itself.
 * Without a holder, it shows only to an editor who may change this page's address.
 * It follows the address the form reads, so a page chosen as the home page drops it before the save.
 * The check reads the site as a visitor does, again after each save.
 */
export function missingHome(editor: RecordEditor): Child {
  const { collection } = editor;
  const meta = dashboardMeta();
  const cms = meta?.cms;
  const locale = untracked(effectiveContentLocale);
  if (isUndefined(meta) || isUndefined(cms) || !hasPages(collection)) return null;
  if (!hasRoute(meta.routes, 'GET /cms/routes/live') || !takesSpecialPages(collection, locale)) {
    return null;
  }
  const path = pagePath(collection, locale, { slug: cms.homeSlug });
  const slug = collection.fields.find((field) => field.name === 'slug');
  const translatable = slug?.translatable === true;
  const choosable = (): boolean =>
    editor.canWrite() && slug?.writable === true && (editor.create || slug.immutable !== true);
  const address = (): unknown => {
    const control = editor.form.value?.controlOf('slug');
    return isUndefined(control) ? editor.saved().slug : control.read().value;
  };
  const live = useResource<{ live: boolean }>('GET /cms/routes/live', { query: { path } });
  const missing = (): boolean => !live.stale() && live()?.live === false;
  const holder = useResource<{ records: Record<string, unknown>[] }>(
    'POST /collections/[collection]/query',
    {
      params: { collection: collection.segment },
      body: () =>
        missing()
          ? {
              where: { slug: cms.homeSlug },
              select: ['UUID', ...collection.labelFields],
              perPage: 1,
              ...(translatable ? { locale } : {}),
            }
          : undefined,
    },
  );

  let first = true;
  effect(() => {
    void editor.saved();
    if (first) first = false;
    else void untracked(live.reload);
  });

  return () => {
    if (!missing()) return null;
    const kind = specialPage(collection, locale, address());
    if (!editor.create && specialPage(collection, locale, editor.saved().slug) === 'home') {
      return kind === 'home' ? note('cms.home.unpublished', { icon: 'home' }) : null;
    }
    if (kind === 'home') return null;
    if (holder.busy()) return null;
    const row = holder.stale() ? undefined : holder()?.records[0];
    if (!isUndefined(row)) {
      const title = joinLabel(row, collection) || fallbackLabel(String(row.UUID));
      return note({ key: 'cms.home.heldNotLive', params: { title } }, { icon: 'home' });
    }
    if (!choosable()) return null;
    // A hand-typed home slug is refused with a hint under the field that already says this.
    const typed = editor.form.value?.controlOf('slug')?.draft?.();
    if (isUndefined(kind) && specialPage(collection, locale, typed) === 'home') return null;
    const other = kind === 'notFound';
    return meta.locales.length > 1
      ? note(
          { key: other ? 'cms.home.missingOtherIn' : 'cms.home.missingIn', params: { locale } },
          { icon: 'home' },
        )
      : note(other ? 'cms.home.missingOther' : 'cms.home.missing', { icon: 'home' });
  };
}

/**
 * The line the home or the not-found page adds to its delete confirmation.
 * It says what the website shows once the page is gone.
 * A delete removes every locale, so a translatable slug is read in each locale that takes special pages.
 */
export async function specialPageDeleteNotice(
  collection: DashboardCollection,
  uuid: string,
): Promise<Text | undefined> {
  const meta = dashboardMeta();
  if (isUndefined(meta)) return undefined;
  const slug = collection.fields.find((field) => field.name === 'slug');
  const scopes = slug?.translatable === true ? meta.locales : [undefined];
  const locales = scopes.filter((locale) => takesSpecialPages(collection, locale));
  const kinds = await Promise.all(
    locales.map(async (locale) =>
      specialPage(collection, locale, await slugIn(collection, uuid, locale)),
    ),
  );
  if (kinds.includes('home')) return 'cms.delete.home';
  return kinds.includes('notFound') ? 'cms.delete.notFound' : undefined;
}

/**
 * The slug the record `uuid` holds in `locale`, `undefined` when the read fails.
 */
async function slugIn(
  collection: DashboardCollection,
  uuid: string,
  locale: string | undefined,
): Promise<unknown> {
  const response = await api(`POST /collections/${collection.segment}/query`, {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      where: { UUID: uuid },
      select: ['slug'],
      perPage: 1,
      ...(isUndefined(locale) ? {} : { locale }),
    }),
  }).catch(() => undefined);
  if (response?.ok !== true) return undefined;
  const page = (await response.json()) as { records: Record<string, unknown>[] };
  return page.records[0]?.slug;
}
