// SPDX-License-Identifier: AGPL-3.0-or-later

import seed from 'virtual:maatwerk-fixtures';
import { MockApi } from './mock-api';

/** A MockApi on a fresh copy of the fixture chosen at build time (MAATWERK_FIXTURE). */
export function createMockFromFixtures(): MockApi {
  return new MockApi(seed);
}
