import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isRedirectTarget } from '../../../src/utils/is-redirect-target.ts';

describe('isRedirectTarget', () => {
  it('takes a path on the site and an http or https URL', () => {
    for (const value of ['/', '/new?a=1#b', 'https://x.y/a', 'http://x.y']) {
      strictEqual(isRedirectTarget(value), true, value);
    }
  });

  it('refuses a scheme a browser runs or opens instead of loading a page', () => {
    for (const value of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'java\tscript:alert(1)',
      ' javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'mailto:a@b.c',
      'tel:+123',
      'blob:https://x.y/1',
    ]) {
      strictEqual(isRedirectTarget(value), false, value);
    }
  });

  it('refuses a value a browser reads as another target than written', () => {
    for (const value of ['//evil.com', '/\\evil.com', 'https://x.y@evil.com', '#top', 'new', '']) {
      strictEqual(isRedirectTarget(value), false, value);
    }
  });
});
