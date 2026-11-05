// SPDX-License-Identifier: AGPL-3.0-or-later

// The banner of a read-only app (minimum app version, PLAN-2 decision 5).

import { readOnlyBannerText } from '../services/read-only';

/** Shows the read-only banner once: the top of the main area, under the tab bar. */
export function showReadOnlyBanner(
  minVersion: string,
  appVersion: string,
  doc: Document = document,
): HTMLElement {
  const existing = doc.getElementById('read-only-banner');
  if (existing) return existing;
  const banner = doc.createElement('div');
  banner.id = 'read-only-banner';
  banner.className = 'read-only-banner';
  banner.setAttribute('role', 'status');
  banner.textContent = readOnlyBannerText(minVersion, appVersion);
  doc.documentElement.dataset.readOnly = 'true';
  (doc.getElementById('app') ?? doc.body).prepend(banner);
  return banner;
}
