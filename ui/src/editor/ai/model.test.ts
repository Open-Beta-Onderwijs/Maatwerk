// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { CheckReport, Proposal, RunSummary } from '../../bridge/ai-api';
import {
  addEvent,
  appliedText,
  attachmentError,
  chipsFrom,
  chipsToSave,
  contextRequest,
  finishRun,
  formatClock,
  formatSize,
  hunkLocation,
  hunkRows,
  newRun,
  preselectSyllabus,
  proposalHeadline,
  remainingDiagnostics,
  starters,
  statusText,
  summaryText,
  syllabusSubtitle,
  triState,
} from './model';

describe('context chips', () => {
  it('defaults: everything on but Andere opdrachten and Afbeeldingen, syllabus preselected', () => {
    expect(chipsFrom(null, 'Nat havo.pdf')).toEqual({
      guide: true,
      metadata: true,
      diagnostics: true,
      pdf: true,
      syllabus: 'Nat havo.pdf',
      others: [],
      images: false,
    });
  });

  it('remembers everything but Afbeeldingen, also "Geen" syllabus', () => {
    const chips = { ...chipsFrom(null, 'x.pdf'), pdf: false, syllabus: null, images: true };
    const saved = chipsToSave(chips);
    expect(saved).not.toHaveProperty('images');
    expect(chipsFrom({ ...(saved as object), images: true }, 'x.pdf')).toEqual({
      ...chips,
      images: false,
    });
  });

  it('keeps at most three other opdrachten and leaves out metadata when off', () => {
    const chips = chipsFrom({ others: ['a', 'b', 'c', 'd'], metadata: false }, null);
    expect(chips.others).toEqual(['a', 'b', 'c']);
    const req = contextRequest(chips, { titel: 'x' });
    expect(req.metadata).toBeNull();
    expect(req.others).toEqual(['a', 'b', 'c']);
  });
});

describe('syllabus', () => {
  const files = [
    'NLT havo vwo 2026.pdf',
    'Natuurkunde havo 2025.pdf',
    'Natuurkunde havo 2026.pdf',
    'Natuurkunde vwo 2026.pdf',
  ];
  it('preselects the newest file naming vak and schoolsoort', () => {
    expect(preselectSyllabus(files, ['nat'], ['havo'])).toBe('Natuurkunde havo 2026.pdf');
    expect(preselectSyllabus(files, ['bio'], ['havo'])).toBeNull();
  });
  it('describes the others', () => {
    const pre = 'Natuurkunde havo 2026.pdf';
    expect(syllabusSubtitle(pre, ['nat'], ['havo'], pre)).toContain('voorgeselecteerd');
    expect(syllabusSubtitle('Natuurkunde vwo 2026.pdf', ['nat'], ['havo'], pre)).toBe('Zelfde vak');
    expect(syllabusSubtitle('NLT havo vwo 2026.pdf', ['nat'], ['havo'], pre)).toBe('Ander vak');
  });
});

describe('attachments', () => {
  it('formats sizes with a decimal comma', () => {
    expect(formatSize(412 * 1024)).toBe('412 kB');
    expect(formatSize(31.4 * 1024 * 1024)).toBe('31,4 MB');
  });
  it('refuses unsupported types and files over 25 MB', () => {
    expect(attachmentError('uitleg.mp4', 10)).toBe('dit soort bestand kan niet mee.');
    expect(attachmentError('scan.pdf', 31.4 * 1024 * 1024)).toBe(
      'te groot (31,4 MB; max. 25 MB per bestand).',
    );
    expect(attachmentError('foto.PNG', 1000)).toBeNull();
  });
});

describe('run transcript', () => {
  it('builds steps with durations and a status text', () => {
    const run = newRun(0);
    expect(statusText(run, 'Claude Code')).toBe('Start Claude Code…');
    addEvent(run, { kind: 'step', step: 'read', title: 'Leest de syllabus', detail: null }, 1000);
    expect(statusText(run, 'Claude Code')).toBe('Leest de syllabus…');
    addEvent(run, { kind: 'stepOutput', text: 'fout', error: true }, 1500);
    addEvent(run, { kind: 'step', step: 'check', title: 'Controleert', detail: null }, 4000);
    addEvent(run, { kind: 'notice', message: 'Controleert de opdracht… ronde 2' }, 4100);
    expect(statusText(run, 'x')).toBe('Controleert de opdracht… ronde 2');
    addEvent(run, { kind: 'text', text: 'Klaar.' }, 4200);
    finishRun(run, 6000, false);
    expect(run.steps.map((s) => [s.startMs, s.endMs, s.error])).toEqual([
      [1000, 4000, true],
      [4000, 6000, false],
    ]);
    expect(run.text).toBe('Klaar.');
  });

  it('formats the clock and the summary row', () => {
    expect(formatClock(102_000)).toBe('1:42');
    const run: RunSummary = {
      end: 'finished',
      elapsedMs: 151_000,
      steps: Array(6).fill({ step: 'read', title: 'x', error: false }),
      lines: [],
      authFailed: false,
      fixRounds: 0,
      proposal: true,
      applied: false,
    };
    expect(summaryText(run)).toEqual({ text: 'Klaar in 2:31 · 6 stappen', tone: 'success' });
    expect(summaryText({ ...run, proposal: false }).text).toBe('Klaar in 2:31 · geen wijzigingen');
    expect(summaryText({ ...run, end: 'stopped', elapsedMs: 102_000 }).text).toBe(
      'Gestopt na 1:42 · 6 stappen',
    );
    expect(summaryText({ ...run, end: 'timedOut', elapsedMs: 300_000 }).text).toBe(
      'Tijdslimiet bereikt na 5:00',
    );
    expect(summaryText({ ...run, end: 'failed', elapsedMs: 3000 }).tone).toBe('danger');
  });
});

describe('starters', () => {
  it('shows Fouten oplossen only with errors', () => {
    expect(starters(0).map((s) => s.key)).toEqual(['completeAnswers', 'rewrite', 'newOpgave']);
    expect(starters(2)[0]).toMatchObject({
      key: 'fixErrors',
      subtitle: '2 fouten in de opdracht',
    });
  });
});

describe('diff card', () => {
  const proposal: Proposal = {
    files: [
      {
        path: 'opdracht.typ',
        base: '',
        proposed: '',
        hunks: [
          { id: 0, baseStart: 16, baseLines: ['a\n', 'b\n'], newLines: ['A\n'] },
          { id: 1, baseStart: 19, baseLines: [], newLines: ['x\n', 'y\n'] },
        ],
      },
    ],
    images: [{ path: 'images/meet.png', new: true, source: 'bijlage' }],
    skipped: ['main.typ'],
  };

  it('counts changes and files', () => {
    expect(proposalHeadline(proposal)).toBe('3 wijzigingen · 3 bestanden');
    expect(appliedText(4, 1)).toBe('Toegepast: 4 wijzigingen en 1 afbeelding');
    expect(appliedText(1, 0)).toBe('Toegepast: 1 wijziging');
  });

  it('describes hunk places and rows', () => {
    const [h0, h1] = proposal.files[0]!.hunks;
    expect(hunkLocation(h0!)).toBe('regels 17–18');
    expect(hunkLocation(h1!)).toBe('na regel 19 · 2 regels erbij');
    expect(hunkRows(h0!)).toEqual([
      { left: { n: 17, text: 'a', kind: 'del' }, right: { n: 17, text: 'A', kind: 'add' } },
      { left: { n: 18, text: 'b', kind: 'del' }, right: null },
    ]);
  });

  it('tri-state checkbox and remaining diagnostics', () => {
    expect(triState([true, false])).toBe('mixed');
    expect(triState([true, true])).toBe('on');
    expect(triState([])).toBe('off');
    const check: CheckReport = {
      ok: true,
      pageCount: 2,
      checks: [],
      totalPunten: 10,
      diagnostics: [
        {
          severity: 'warning',
          message: 'ongebruikte variabele',
          hints: [],
          location: { file: 'opdracht.typ', line: 131, column: 1, range: [0, 1] },
        },
      ],
    };
    expect(remainingDiagnostics(check)).toBe(
      '1 waarschuwing blijft · regel 131: ongebruikte variabele',
    );
    expect(remainingDiagnostics(null)).toBeNull();
  });
});
