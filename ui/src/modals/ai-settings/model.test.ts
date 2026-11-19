// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { AiSettings } from '../../bridge/ai-api';
import {
  argsProblem,
  customKey,
  customProblem,
  isCustomized,
  minutesProblem,
  settingsToSave,
  type BuiltinRow,
} from './model';

const row = (over: Partial<BuiltinRow> = {}): BuiltinRow => ({
  builtin: 'claude',
  command: 'claude',
  args: '-p {prompt}',
  argsNext: '-p {prompt} --resume {session}',
  defaults: { command: 'claude', args: '-p {prompt}', argsNext: '-p {prompt} --resume {session}' },
  ...over,
});

describe('AI-instellingen model (step 32c)', () => {
  it('marks a row aangepast when any field differs from the preset', () => {
    expect(isCustomized(row())).toBe(false);
    expect(isCustomized(row({ args: '-p {prompt} --model x' }))).toBe(true);
  });

  it('checks minutes 1-30 and argument strings as the core does', () => {
    expect(minutesProblem('5')).toBeNull();
    expect(minutesProblem('0')).toMatch(/1 tot en met 30/);
    expect(minutesProblem('2,5')).not.toBeNull();
    expect(argsProblem('-p {prompt} --x "a \\" b"')).toBeNull();
    expect(argsProblem('--json {"a":1}')).toBeNull(); // not a placeholder
    expect(argsProblem('-p {vraag}')).toBe('Onbekende plaatshouder {vraag}.');
    expect(argsProblem("-p 'open")).toBe("Een ' wordt niet gesloten.");
    expect(
      customProblem({ key: 'custom-x', name: ' ', command: 'x', args: '', argsNext: '' }),
    ).toBe('Geef het programma een naam.');
  });

  it('makes unique custom keys', () => {
    expect(customKey('Mijn Aïder!', [])).toBe('custom-mijn-aider');
    expect(customKey('x', ['custom-x', 'custom-x-2'])).toBe('custom-x-3');
    expect(customKey('…', [])).toBe('custom-cli');
  });

  it('saves only what differs, keeping unknown fields and the notice', () => {
    const original: AiSettings = {
      enabled: true,
      timeLimitMinutes: 5,
      noticeSeen: true,
      overrides: { codex: { args: 'exec' }, claude: { args: 'old' } },
      future: 1,
    };
    const out = settingsToSave(original, {
      enabled: false,
      minutes: 9,
      rows: [row()],
      custom: [{ key: 'custom-a', name: ' A ', command: ' a ', args: '{prompt}', argsNext: '' }],
    });
    expect(out).toEqual({
      enabled: false,
      timeLimitMinutes: 9,
      noticeSeen: true,
      overrides: { codex: { args: 'exec' } },
      future: 1,
      custom: [{ key: 'custom-a', name: 'A', command: 'a', args: '{prompt}', argsNext: '' }],
    });
    const none = settingsToSave(
      { enabled: true, timeLimitMinutes: 5, noticeSeen: false },
      {
        enabled: true,
        minutes: 5,
        rows: [row({ args: '-p {prompt} --v' })],
        custom: [],
      },
    );
    expect(none.overrides).toEqual({ claude: { args: '-p {prompt} --v' } });
    expect(none.custom).toBeUndefined();
  });
});
