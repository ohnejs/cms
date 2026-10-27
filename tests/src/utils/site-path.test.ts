import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { sitePath } from '../../../src/utils/site-path.ts';

describe('sitePath', () => {
  it('encodes a path as a request carries it, without its trailing slash', () => {
    strictEqual(sitePath('/über/'), '/%C3%BCber');
    strictEqual(sitePath('/old page'), '/old%20page');
    strictEqual(sitePath('/%C3%BCber'), '/%C3%BCber');
    strictEqual(sitePath('/'), '/');
  });

  it('leaves a value that is no plain local path for the validator', () => {
    for (const value of ['/a?b=1', '/a#top', '//evil', 'old', ''])
      strictEqual(sitePath(value), value);
  });
});
