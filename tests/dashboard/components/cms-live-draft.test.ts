import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { registerHooks } from 'node:module';
import { describe, it } from 'node:test';

// The dashboard runtime needs a browser, so its import here answers from the fakes a test sets.
const fake = `data:text/javascript,export const { blocksHandleOf, dashboardMeta } = globalThis.dashboard;`;
registerHooks({
  resolve: (specifier, context, next) =>
    specifier === 'ohnejs/dashboard' ? { url: fake, shortCircuit: true } : next(specifier, context),
});

type Control = { handle?: { nodes: () => object[] } };

Object.assign(globalThis, {
  dashboard: {
    blocksHandleOf: (control: Control | undefined) => control?.handle,
    dashboardMeta: () => ({ blocks: [] }),
  },
});

// A URL keeps the browser module out of this program's type check, which knows no DOM.
const source = new URL('../../../dashboard/components/cms-live-draft.ts', import.meta.url).href;
const { liveValues } = (await import(source)) as {
  liveValues: (form: object, blocksFields: readonly string[]) => Record<string, unknown>;
};

/**
 * A form whose snapshot answers `values`, recording the arguments of each call.
 */
function formOf(values: Record<string, unknown>, controls: Record<string, Control> = {}) {
  const asked: unknown[][] = [];
  const form = {
    snapshot: (...args: unknown[]) => {
      asked.push(args);
      return structuredClone(values);
    },
    controlOf: (name: string) => controls[name],
  };
  return { form, asked };
}

describe('liveValues', () => {
  it("answers the form's snapshot, asked without a fallback so the form keeps its own last value", () => {
    const { form, asked } = formOf({ slug: 's', lede: 'x' });
    deepStrictEqual(liveValues(form, []), { slug: 's', lede: 'x' });
    deepStrictEqual(asked, [[]]);
  });

  it('marks each block with its `UUID`, or a draft id that holds until its first save', () => {
    const nodes = [
      { block: 'Hero', form: {} },
      { block: 'Quote', uuid: 'b2', form: {} },
    ];
    const { form } = formOf(
      {
        content: [
          { block: 'Hero', fields: {} },
          { block: 'Quote', UUID: 'b2', fields: {} },
        ],
      },
      { content: { handle: { nodes: () => nodes } } },
    );
    const [hero, quote] = liveValues(form, ['content']).content as Record<string, unknown>[];
    ok(typeof hero?.UUID === 'string');
    strictEqual(quote?.UUID, 'b2');
    const [again] = liveValues(form, ['content']).content as Record<string, unknown>[];
    strictEqual(again?.UUID, hero.UUID);
  });
});
