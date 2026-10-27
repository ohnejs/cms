import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { sitePath, sitePaths } from '../../../src/utils/site-path.ts';

describe('sitePath', () => {
  it('decodes a path, typed or as a request carries it, without its trailing slash', () => {
    strictEqual(sitePath('/über/'), '/über');
    strictEqual(sitePath('/%C3%BCber'), '/über');
    strictEqual(sitePath('/old%20page'), '/old page');
    strictEqual(sitePath('/100%zz'), '/100%zz');
    strictEqual(sitePath('/'), '/');
  });

  it('leaves a value that is no plain local path for the validator', () => {
    for (const value of ['/a?b=1', '/a#top', '//evil', 'old', ''])
      strictEqual(sitePath(value), value);
  });

  it('lists the decoded path and the encoded one an older row may hold', () => {
    deepStrictEqual(sitePaths('/%C3%BCber/'), ['/über', '/%C3%BCber']);
    deepStrictEqual(sitePaths('/about'), ['/about']);
    deepStrictEqual(sitePaths('/'), ['/']);
  });
});
