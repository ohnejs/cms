import type { Popup, Primitive } from 'ohnejs/dashboard';

import {
  api,
  attachTooltip,
  button,
  css,
  dashboardMeta,
  field,
  fieldLabel,
  formatDateTime,
  formatRelative,
  h,
  icon,
  popup,
  select,
  textInput,
  toast,
  useDashboardLanguage,
  useT,
  when,
} from 'ohnejs/dashboard';
import {
  effect,
  formatDuration,
  formatLocaleCode,
  isUndefined,
  onCleanup,
  parseDuration,
  ref,
  stringifySearchParams,
  untracked,
} from 'ohnejs/utils';

import { frameURL } from './cms-meta.ts';

const DURATION_ID = 'o-cms-share-duration';
const LINK_ID = 'o-cms-share-link';

/**
 * Options for `sharePopup`.
 */
export interface SharePopupOptions {
  /**
   * The site path of the page to share.
   */
  path: () => string | undefined;

  /**
   * The editor's unsaved state, as the draft body the preview pane sends.
   */
  draft: () => Record<string, unknown> | undefined;

  /**
   * Called when the popup asks to close, with its animated close function.
   * The caller awaits it and then disposes the region that created the popup.
   */
  onClose(close: () => Promise<void>): void;
}

interface ShareRow {
  UUID: string;
  locale: string;
  path: string;
  expiresAt: number;
  user: string | null;
  mine: boolean;
}

css`
  .o-cms-share-title {
    font-weight: 500;
  }

  .o-cms-share-intro {
    margin: 0 0 0.75rem;
  }

  .o-cms-share-create {
    margin-top: 0.75rem;
  }

  .o-cms-share hr {
    width: calc(100% + 1.5rem);
    margin: 0.75rem -0.75rem;
  }

  .o-cms-share-heading {
    margin-bottom: 0.5rem;
    font-weight: 500;
  }

  .o-cms-share-row {
    align-items: center;
  }

  .o-cms-share-row + .o-cms-share-row {
    margin-top: 0.5rem;
  }

  .o-cms-share-row-main {
    min-width: 0;
  }

  .o-cms-share-row-meta {
    gap: 0.75rem;
    font-size: 0.75rem;
  }

  .o-cms-share-row-meta > .ohne-row {
    gap: 0.25rem;
    min-width: 0;
  }
`;

/**
 * The share popup: freezes the editor's unsaved page into a link anyone may open until it expires.
 * The editor picks a lifetime out of `cms.share.durations` and creates the link, which shows once to copy.
 * Below it, every live link of the record lists with its locale, path, expiry, and creator, each revocable.
 * The draft is read as the popup opens, so a link holds exactly what the preview showed then.
 * Create it inside a reactive region; dispose the region after `onClose`'s close resolves.
 */
export function sharePopup(options: SharePopupOptions): Popup {
  const t = useT();
  const language = useDashboardLanguage();
  const share = untracked(dashboardMeta)?.cms?.share;
  const draft = untracked(options.draft);
  const duration = ref<Primitive>(share?.default ?? '');
  const link = ref('');
  const creating = ref(false);
  const revoking = ref<string | undefined>(undefined);
  const shares = ref<ShareRow[] | undefined>(undefined);

  const refresh = async (): Promise<void> => {
    if (isUndefined(draft)) return;
    const query = stringifySearchParams({
      collection: String(draft.collection),
      record: String(draft.record),
    });
    const response = await api(`GET /cms/preview/shares?${query}`).catch(() => undefined);
    if (response?.ok) shares.value = (await response.json()) as ShareRow[];
    else toast(t('dashboard.unreachable'), { type: 'error' });
  };
  void refresh();

  const create = async (): Promise<void> => {
    const path = untracked(options.path);
    if (creating.value || isUndefined(path) || isUndefined(draft)) return;
    creating.value = true;
    const response = await api('POST /cms/preview/shares', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...draft, path, duration: duration.value }),
    }).catch(() => undefined);
    creating.value = false;
    if (!response?.ok) {
      toast(t('cms.liveView.share.createFailed'), { type: 'error' });
      return;
    }
    const { token } = (await response.json()) as { token: string };
    link.value = frameURL(path, token) ?? '';
    void refresh();
  };

  const copy = (): void => {
    // An insecure origin has no `navigator.clipboard`, so the write throws inside the promise chain.
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(link.value))
      .then(() => toast(t('cms.liveView.share.copied'), { type: 'success' }))
      .catch(() => toast(t('cms.liveView.share.copyFailed'), { type: 'error' }));
  };

  const revoke = async (uuid: string): Promise<void> => {
    if (!isUndefined(revoking.value)) return;
    revoking.value = uuid;
    const response = await api(`DELETE /cms/preview/shares/${uuid}`).catch(() => undefined);
    revoking.value = undefined;
    if (!response?.ok) toast(t('cms.liveView.share.revokeFailed'), { type: 'error' });
    await refresh();
  };

  const linkInput = (): HTMLElement => {
    const copyButton = button(icon('clipboard'), { variant: 'outline', onClick: copy });
    onCleanup(attachTooltip(copyButton, () => t('cms.liveView.share.copy')));
    const el = textInput(link, {
      id: LINK_ID,
      onFocus: (event) => (event.target as HTMLInputElement).select(),
      suffix: copyButton,
    });
    const input = el.querySelector('input');
    if (input) input.readOnly = true;
    return field([
      fieldLabel(h('label', { for: LINK_ID }, () => t('cms.liveView.share.link'))),
      el,
    ]);
  };

  const row = (entry: ShareRow): HTMLElement => {
    const revokeButton = button(icon('trash-x'), {
      size: -2,
      variant: 'outline',
      destructiveHover: true,
      disabled: () => !isUndefined(revoking.value),
      onClick: () => void revoke(entry.UUID),
    });
    onCleanup(attachTooltip(revokeButton, () => t('cms.liveView.share.revoke')));
    const expires = h(
      'span',
      { class: 'ohne-row' },
      icon('clock'),
      h('span', { class: 'ohne-truncate' }, () => formatRelative(entry.expiresAt)),
    );
    onCleanup(
      attachTooltip(expires, () =>
        t('cms.liveView.share.expires', { when: formatDateTime(entry.expiresAt) }),
      ),
    );
    const multilingual = (dashboardMeta()?.locales.length ?? 0) > 1;
    return h(
      'div',
      { class: 'o-cms-share-row ohne-justify-between' },
      h(
        'div',
        { class: 'o-cms-share-row-main' },
        h(
          'div',
          { class: 'ohne-row' },
          multilingual
            ? h('span', { class: 'ohne-shrink-0 ohne-muted' }, formatLocaleCode(entry.locale))
            : null,
          h('span', { class: 'ohne-truncate' }, entry.path),
        ),
        h(
          'div',
          { class: 'o-cms-share-row-meta ohne-row ohne-muted' },
          expires,
          h(
            'span',
            { class: 'ohne-row' },
            icon('user'),
            h('span', { class: 'ohne-truncate' }, () =>
              entry.mine
                ? t('cms.liveView.share.you')
                : (entry.user ?? t('cms.liveView.share.gone')),
            ),
          ),
        ),
      ),
      revokeButton,
    );
  };

  const closeButton = button(icon('x'), {
    size: -2,
    variant: 'ghost',
    class: 'ohne-ml-auto',
    onClick: () => options.onClose(handle.close),
  });
  effect(() => {
    closeButton.title = t('dashboard.close');
  });

  const handle = popup(
    h(
      'div',
      { class: 'o-cms-share' },
      h('p', { class: 'o-cms-share-intro ohne-muted' }, () => t('cms.liveView.share.intro')),
      field([
        fieldLabel(h('label', { for: DURATION_ID }, () => t('cms.liveView.share.expiresAfter'))),
        select(
          duration,
          () =>
            (share?.durations ?? []).map((value) => ({
              value,
              label: formatDuration(parseDuration(value), {
                locale: language.value,
                style: 'long',
              }),
            })),
          { id: DURATION_ID },
        ),
      ]),
      h(
        'div',
        { class: 'o-cms-share-create ohne-row' },
        button([icon('link'), h('span', null, () => t('cms.liveView.share.create'))], {
          class: 'ohne-ml-auto',
          disabled: () => creating.value,
          onClick: () => void create(),
        }),
      ),
      when(
        () => link.value !== '',
        () => [h('hr'), linkInput()],
      ),
      h('hr'),
      h('div', { class: 'o-cms-share-heading' }, () => t('cms.liveView.share.active')),
      () => {
        const list = shares.value;
        if (isUndefined(list)) return null;
        if (list.length === 0) {
          return h('div', { class: 'ohne-muted' }, () => t('cms.liveView.share.none'));
        }
        return list.map(row);
      },
    ),
    {
      size: -1,
      width: '30rem',
      header: h(
        'div',
        { class: 'ohne-row' },
        h('span', { class: 'o-cms-share-title' }, () => t('cms.liveView.share.title')),
        closeButton,
      ),
      onClose: () => options.onClose(handle.close),
    },
  );

  return handle;
}
