// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { UNEXPECTED_TEXT, errorText, reportUnexpected } from './problems';

function rig() {
  const logged: string[] = [];
  const api = { logUiError: vi.fn(async (m: string) => void logged.push(m)) };
  const show = vi.fn();
  return { api, show, logged };
}

describe('unexpected errors', () => {
  it('are logged with their stack and shown as one Dutch message', () => {
    const { api, show, logged } = rig();
    const e = new TypeError('x is undefined');
    expect(reportUnexpected(api, show, 'error', e)).toBe(true);
    expect(logged[0]).toMatch(/^error: TypeError: x is undefined/);
    expect(show).toHaveBeenCalledWith(UNEXPECTED_TEXT);
  });

  it('a command error is logged by code and message', () => {
    expect(errorText({ code: 'internal', message: 'blocking task failed' })).toBe(
      'internal: blocking task failed',
    );
  });

  it('save conflicts and ResizeObserver noise are left alone', () => {
    const { api, show } = rig();
    expect(reportUnexpected(api, show, 'rejection', { code: 'conflict' })).toBe(false);
    expect(reportUnexpected(api, show, 'error', 'ResizeObserver loop limit exceeded')).toBe(false);
    expect(api.logUiError).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  });

  it('a failing log call does not throw', async () => {
    const api = { logUiError: vi.fn(() => Promise.reject(new Error('no bridge'))) };
    expect(reportUnexpected(api, () => {}, 'rejection', 'boom')).toBe(true);
    await Promise.resolve();
  });
});
