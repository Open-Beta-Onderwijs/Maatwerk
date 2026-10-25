// SPDX-License-Identifier: AGPL-3.0-or-later
// Deterministic process environment for running reference code: fixed clock,
// fixed time zone and a Dutch default collation locale.

/** Default "now" for goldens: a Monday in the 2025-2026 school year, local time. */
export const DEFAULT_NOW = '2026-03-02T10:00:00';

const RealDate = Date;

/**
 * Replaces the global Date with one whose `Date.now()` and `new Date()` return
 * `iso` (local time unless it carries an offset). Returns a restore function.
 */
export function freezeClock(iso = DEFAULT_NOW) {
  const fixed = new RealDate(iso).getTime();
  class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixed]));
    }
    static now() {
      return fixed;
    }
  }
  globalThis.Date = FixedDate;
  return () => {
    globalThis.Date = RealDate;
  };
}

/**
 * The reference runs in Electron on Dutch Windows machines, so `localeCompare`
 * without a locale collates as Dutch there. Node's default locale depends on the
 * host, so pin it (docs/testing.md, "Harness assumptions").
 */
export function pinDefaultLocale(locale = 'nl-NL') {
  const orig = String.prototype.localeCompare;
  String.prototype.localeCompare = function (that, locales, options) {
    return orig.call(this, that, locales ?? locale, options);
  };
}

/** Must run before the first Date is created: Node reads TZ lazily. */
export function setupEnvironment() {
  process.env.TZ = 'Europe/Amsterdam';
  pinDefaultLocale();
}
