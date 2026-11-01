// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import type { EditorUpdateEvent } from '../bindings';
import { MockEditor, mockTimeoutMessage, mockVragen } from './mock-editor';

function collect(editor: MockEditor): EditorUpdateEvent[] {
  const seen: EditorUpdateEvent[] = [];
  editor.onUpdate((u) => seen.push(u));
  return seen;
}

describe('mock live editor', () => {
  it('compiles at once, merges edits of one tick; only changed pages are sent', async () => {
    vi.useFakeTimers();
    const editor = new MockEditor();
    const seen = collect(editor);
    const id = editor.open(() => 'A\n#pagebreak()\nB');
    await vi.advanceTimersByTimeAsync(0);
    expect(seen[0]).toMatchObject({ generation: 0, ok: true, pageCount: 2 });
    expect(seen[0]!.pages.map((p) => p.index)).toEqual([0, 1]);

    editor.update(id, 'opdracht.typ', 'A\n#pagebreak()\nB2');
    const last = editor.update(id, 'opdracht.typ', 'A\n#pagebreak()\nB3');
    await vi.advanceTimersByTimeAsync(60);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toMatchObject({ generation: last, previewGeneration: last });
    expect(seen[1]!.pages.map((p) => p.index)).toEqual([1]);
    vi.useRealTimers();
  });

  it('keeps the preview on errors and reports them with UTF-16 ranges', async () => {
    vi.useFakeTimers();
    const editor = new MockEditor();
    const seen = collect(editor);
    const id = editor.open(() => 'A');
    await vi.advanceTimersByTimeAsync(0);
    editor.update(id, 'opdracht.typ', 'A\n#vraag[');
    await vi.advanceTimersByTimeAsync(60);
    const u = seen[1]!;
    expect(u).toMatchObject({ ok: false, previewGeneration: 0, pageCount: 1, pages: [] });
    expect(u.diagnostics[0]!.location).toMatchObject({ line: 2, column: 7, from: 8, to: 9 });
    expect(editor.jumpFromCursor(id, 0)).toBeNull();

    editor.timeoutSeconds = 30;
    editor.update(id, 'opdracht.typ', '#traag');
    await vi.advanceTimersByTimeAsync(60);
    expect(seen[2]!.diagnostics[0]!.message).toBe(mockTimeoutMessage(30));
    vi.useRealTimers();
  });

  it('labels vragen like lib.typ and checks them', () => {
    const v = mockVragen(
      '#opgave[#vraag(punten: 2, antwoord: [A])[x]]\n#opgave[#vraag(antwoord: [B])[y] #vraag(punten: 1)[z]]',
    );
    expect(v.items.map((i) => i.label)).toEqual(['1', '2a', '2b']);
    expect(v.totalPunten).toBe(3);
    expect(v.checks).toEqual(['Vraag 2a heeft geen punten.', 'Vraag 2b heeft geen antwoord.']);
    expect(mockVragen('Uitleg').checks).toEqual(['De opdracht heeft geen vragen.']);
  });
});
