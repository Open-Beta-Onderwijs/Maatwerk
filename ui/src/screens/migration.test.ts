// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { issueCounts, needsAttention } from './gegevens';
import { migrationSummary } from './migration';

describe('migration and data check texts', () => {
  it('summarises a migration in Dutch', () => {
    const lines = migrationSummary({
      fromVersion: 1,
      toVersion: 2,
      applied: true,
      backup: 'C:\\b\\maatwerk-backup-v1.zip',
      written: 10,
      moved: 2,
      deleted: 3,
      warnings: [],
      validation: {
        filesChecked: 10,
        issues: [{ severity: 'warning', kind: 'stray', path: 'x', message: 'm' }],
      },
    });
    expect(lines).toEqual([
      'Gegevensmap omgezet van versie 1 naar 2.',
      '10 bestanden bijgewerkt, 2 verplaatst, 3 verwijderd.',
      'Back-up: C:\\b\\maatwerk-backup-v1.zip',
      'Controle: geen fouten, 1 waarschuwing.',
    ]);
  });

  it('counts issues and decides when the admin is told', () => {
    const issue = (severity: string, kind: string) => ({ severity, kind, path: 'p', message: 'm' });
    expect(issueCounts([])).toBe('Geen fouten of waarschuwingen.');
    expect(issueCounts([issue('error', 'corrupt'), issue('warning', 'stray')])).toBe(
      '1 fout, 1 waarschuwing',
    );
    expect(needsAttention({ filesChecked: 1, issues: [issue('warning', 'stray')] })).toBe(false);
    expect(needsAttention({ filesChecked: 1, issues: [issue('warning', 'stamp')] })).toBe(true);
    expect(needsAttention({ filesChecked: 1, issues: [issue('error', 'reference')] })).toBe(true);
  });
});
