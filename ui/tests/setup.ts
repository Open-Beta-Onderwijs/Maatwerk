// SPDX-License-Identifier: AGPL-3.0-or-later

// Same environment the goldens were captured in (docs/testing.md, "Harness
// assumptions"): TZ Europe/Amsterdam, Dutch default collation, clock frozen at
// 2026-03-02T10:00 local.

import { freezeClock, setupEnvironment } from '../../tests/reference-harness/environment.mjs';

setupEnvironment();
freezeClock();
