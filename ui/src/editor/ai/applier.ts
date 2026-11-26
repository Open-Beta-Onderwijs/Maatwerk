// SPDX-License-Identifier: AGPL-3.0-or-later

// Toepassen, the images saved with the text, and Ongedaan maken of a proposal (decisions 56,
// 68; review 32 m3, m4, m5), for the AI panel (panel.ts).

import type { ApplyResult, ProviderKey } from '../../bridge/ai-api';
import type { DiffCardState } from './cards';
import type { EditorAi } from './client';
import type { PanelHost } from './panel';

interface Applied {
  before: Record<string, string>;
  after: Record<string, string>;
  /** Stored in the opdracht (by a save). */
  images: string[];
  /** Chosen, waiting for the next save of the text (review 32 m4). */
  pending: string[];
  hunks: number;
  conflicts: number;
}

/** Rounds of Toepassen while the teacher keeps typing (review 32 m3). */
const APPLY_TRIES = 3;

/** What the panel does when a proposal's state changes. */
export interface ApplierHooks {
  /** The in-memory history follows `ai_apply` / `ai_undo_images`. */
  markApplied(key: ProviderKey, applied: boolean): void;
  /** The card of `key` changed (render it when shown). */
  changed(key: ProviderKey): void;
}

/** The applied proposals of this editor session, per provider. */
export class Applier {
  private applied = new Map<ProviderKey, Applied>();
  /** The diff card's state; none: from the history. */
  readonly cardState = new Map<ProviderKey, DiffCardState>();

  constructor(
    private readonly ai: EditorAi,
    private readonly host: PanelHost,
    private readonly hooks: ApplierHooks,
  ) {}

  /** A new run or conversation: the last proposal's state goes. */
  forget(key: ProviderKey): void {
    this.applied.delete(key);
    this.cardState.delete(key);
  }

  /** Toepassen on the card: every hunk that still fits, and the new images. */
  async applyAll(key: ProviderKey): Promise<void> {
    const view = await this.ai.proposal(key, this.host.buffers());
    const hunks: Record<string, number[]> = {};
    for (const f of view.proposal.files) {
      const statuses = view.statuses[f.path] ?? [];
      hunks[f.path] = f.hunks.filter((_, i) => statuses[i]?.kind === 'clean').map((x) => x.id);
    }
    // An image on a placeholder's name only by choice in Voorstel bekijken (review 32 m5).
    await this.apply(
      key,
      hunks,
      view.proposal.images.filter((i) => !i.placeholder).map((i) => i.path),
    );
  }

  /**
   * Applies the chosen hunks as one undo step per file (decision 68). The images wait for the
   * save of the text, which follows at once ([`saveWithImages`], review 32 m4). When the
   * teacher typed during the round trip, the hunks are rebased onto the new text again instead
   * of reverting it (review 32 m3).
   */
  async apply(key: ProviderKey, hunks: Record<string, number[]>, images: string[]): Promise<void> {
    let asked = false;
    try {
      let done: ApplyResult | null = null;
      let base = this.host.buffers();
      for (let i = 0; i < APPLY_TRIES && !done; i++) {
        if (i > 0) base = this.host.buffers();
        const result = await this.ai.apply(key, base, hunks, images);
        asked = true;
        const now = this.host.buffers();
        if (Object.keys(result.files).every((f) => now[f] === base[f])) done = result;
      }
      if (!done) throw new Error('Je typte tijdens het toepassen. Probeer het nog een keer.');
      const after: Record<string, string> = {};
      let applied = 0;
      let conflicts = 0;
      for (const [file, a] of Object.entries(done.files)) {
        applied += a.applied.length;
        conflicts += a.conflicts.length;
        if (a.text === base[file]) continue;
        if (!(await this.host.applyText(file, a.text, base[file])))
          throw new Error('Je typte tijdens het toepassen. Probeer het nog een keer.');
        after[file] = a.text;
      }
      const chosen = done.images.map((i) => i.path);
      this.applied.set(key, {
        // Ongedaan maken goes back to the text the hunks went onto (review 40 m1).
        before: base,
        after,
        images: [],
        pending: chosen,
        hunks: applied,
        conflicts,
      });
      this.hooks.markApplied(key, applied > 0 || chosen.length > 0);
      this.cardState.set(key, {
        kind: 'applied',
        hunks: applied,
        images: chosen.length,
        conflicts,
      });
      // The text and its images reach the opdracht together; a failed save keeps them pending.
      if (chosen.length) await this.host.save();
    } catch (err) {
      // `ai_apply` marked the history as applied; nothing was (review 40 m2).
      if (asked && !this.applied.has(key)) await this.ai.undoImages(key, []).catch(() => {});
      this.cardState.set(key, { kind: 'error', message: (err as Error).message });
    }
    this.hooks.changed(key);
  }

  /**
   * The editor's save of `opdracht.typ` with `content`: the pending images of applied
   * proposals go into the opdracht just before the text; when the text is not saved, they are
   * taken out again and stay pending (review 32 m4). Only images the saved text names are
   * stored, so an image never lands without the text that uses it (review 40 M2); every
   * provider's (m3). An image that cannot be stored stays pending and does not stop the text
   * (m4).
   */
  async saveWithImages<T extends { ok?: boolean } | null | undefined>(
    content: string,
    write: () => Promise<T>,
  ): Promise<T> {
    const text = content.toLowerCase();
    const commits: { key: ProviderKey; a: Applied; used: string[]; stored: string[] }[] = [];
    for (const [key, a] of this.applied) {
      const used = a.pending.filter((p) => text.includes(imageStem(p)));
      if (!used.length) continue;
      try {
        const stored = (await this.ai.commitImages(key, used)).map((i) => i.path);
        commits.push({ key, a, used, stored });
      } catch (err) {
        const state = this.cardState.get(key);
        if (state?.kind === 'applied') {
          this.cardState.set(key, {
            ...state,
            message: `De afbeeldingen zijn nog niet opgeslagen: ${(err as Error).message}`,
          });
          this.hooks.changed(key);
        }
      }
    }
    const rollBack = () =>
      Promise.all(commits.map((c) => this.ai.undoImages(c.key, c.stored).catch(() => {})));
    let result: T;
    try {
      result = await write();
    } catch (err) {
      await rollBack();
      throw err;
    }
    if (!result?.ok) {
      await rollBack();
      return result;
    }
    for (const c of commits) {
      c.a.images = [...new Set([...c.a.images, ...c.stored])];
      c.a.pending = c.a.pending.filter((p) => !c.used.includes(p));
    }
    if (commits.length) this.host.refreshPreview();
    return result;
  }

  /**
   * The editor text was replaced by a colleague's version ("Hun versie laden"): the AI's images
   * that were not stored yet belong to text that is gone (review 40 M2).
   */
  dropPending(): void {
    for (const a of this.applied.values()) a.pending = [];
  }

  /** Ongedaan maken: the texts from before Toepassen and the images removed or restored. */
  async undo(key: ProviderKey): Promise<void> {
    const a = this.applied.get(key);
    const state = this.cardState.get(key);
    if (!a || state?.kind !== 'applied') return;
    const now = this.host.buffers();
    const changed = Object.keys(a.after).filter((f) => now[f] !== a.after[f]);
    if (changed.length) {
      // Still applied: the card keeps its state and says why it cannot undo.
      this.cardState.set(key, {
        ...state,
        message:
          'Je hebt de opdracht na het toepassen nog aangepast. Gebruik Ctrl+Z in de editor om terug te gaan.',
      });
      this.hooks.changed(key);
      return;
    }
    for (const file of Object.keys(a.after)) await this.host.applyText(file, a.before[file] ?? '');
    // Pending images were never stored: dropping them is enough (review 32 m4). Also without
    // images: the history says "not applied" again (user, 2026-11-20). A failed image undo is
    // said, not swallowed (review 32 M4).
    a.pending = [];
    let imageError: string | null = null;
    await this.ai.undoImages(key, a.images).catch((err: unknown) => {
      imageError = err instanceof Error ? err.message : String(err);
    });
    if (a.images.length) this.host.refreshPreview();
    this.hooks.markApplied(key, false);
    this.applied.delete(key);
    this.cardState.set(
      key,
      imageError
        ? {
            kind: 'error',
            message: `De tekst is teruggezet, de afbeeldingen niet: ${imageError}`,
          }
        : { kind: 'ready' },
    );
    this.hooks.changed(key);
  }
}

/** `images/Grafiek-1.png` -> `grafiek-1`: how the text names the image (any extension). */
function imageStem(path: string): string {
  return path
    .slice(path.lastIndexOf('/') + 1)
    .replace(/\.[^.]*$/, '')
    .toLowerCase();
}
