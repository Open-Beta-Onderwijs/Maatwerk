// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { formatGreeting } from './greet';

describe('formatGreeting', () => {
  it('shows the message and the core version', () => {
    expect(formatGreeting({ message: 'Hallo, Jan!', coreVersion: '0.1.0' })).toBe(
      'Hallo, Jan! (maatwerk-core 0.1.0)',
    );
  });
});
