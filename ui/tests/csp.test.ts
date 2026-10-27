// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APP_CSP, MOCK_CSP } from '../vite/csp';

const tauriConf = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../src-tauri/tauri.conf.json', import.meta.url)), 'utf8'),
) as { app: { security: { csp: string } } };

describe('CSP', () => {
  it('tauri.conf.json uses the CSP defined in ui/vite/csp.ts', () => {
    expect(tauriConf.app.security.csp).toBe(APP_CSP);
  });

  for (const [name, csp] of [
    ['app', APP_CSP],
    ['mock', MOCK_CSP],
  ]) {
    it(`${name}: no inline code, no eval, no remote origins`, () => {
      expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|https?:\/\/(?!ipc\.localhost)|\*/);
      expect(csp).toMatch(/style-src 'self';/);
      expect(csp).toMatch(/script-src 'self';/);
      expect(csp).toMatch(/object-src 'none'/);
    });
  }
});
