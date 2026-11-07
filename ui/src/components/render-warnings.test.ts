// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { renderWarningsHtml } from './render-warnings';

describe('renderWarningsHtml (F-04)', () => {
  it('is empty without warnings', () => {
    expect(renderWarningsHtml([])).toBe('');
    expect(renderWarningsHtml(undefined)).toBe('');
  });

  it('counts in Dutch and escapes every warning', () => {
    expect(renderWarningsHtml(['a'])).toContain('1 waarschuwing bij het maken van de PDF');
    const html = renderWarningsHtml(['<img src=x onerror=alert(1)>', 'b & "c"']);
    expect(html).toContain('2 waarschuwingen');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('b &amp; &quot;c&quot;');
    expect(html).not.toContain('<img');
  });
});
