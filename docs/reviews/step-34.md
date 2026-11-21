# Review: step 34, Observaties and Opdrachten as cards

Reviewer: fresh-context subagent, 2026-11-21. Scope: `git diff 334cc77..HEAD` on
`step/34-obs-opd-cards` (`7c4fe50` step 34a, `d12d611` step 34b), without the regenerated
`ui/src/bridge/bindings.ts` beyond its doc comment. Read against `PLAN-2.md` decisions 45-47 and
the step 34 section, spec 4.16 and 4.17, and the mocks of boards 57 and 58. Read in full:
`components/card-menu.ts`, `screens/cards/item-card.ts`, `screens/observaties.ts`,
`screens/observaties/{card,filter}.ts`, `screens/opdrachten.ts`,
`screens/opdrachten/{card,preview,preview-layout}.ts`, `styles/item-cards.css`, the
`exam-menu.ts`, `app.js`, `tokens.css`, `render.rs` hunks, `e2e/item-cards.spec.ts` and the
helper/view changes. Compared with the deleted JS screens (`git show 334cc77:ui/src/screens/
{observaties,opdrachten}.js`). Checked the Escape handling of `components/dialog.ts`,
`choice-chip.ts` and `user-menu.ts`, the editor's save path (`modals/editor.ts`) and the
opdracht modal's "Openen in editor" (`modals/opdracht-edit.ts`). Ran `npx vitest run src/screens`:
73/73 pass. e2e and cargo were not run (STATE: run at the gate). Note: during this review the
working tree was switched to `main` by the caller; line numbers below are those of `d12d611`.

Accepted deviations, not reported (STATE "Choices made without a spec line"): "<n> toetsen"
counts this year's tests with a resit counted through its original and a PO only through its own
`obs_ids`; the delete rule is unchanged; Opdrachten ⋮ keeps Afdrukken; a colleague changing only
`opdracht.typ` is not noticed until a restart or the editor. Visual baselines are not updated by
design (plan: stop and ask).

## Summary

Both screens do what decisions 46-47 and spec 4.16/4.17 ask. The filters are a faithful port
(`filter.ts` is the old chain, pure and tested, including the wiskunde OB/WisX mapping and "eigen
groepen"); the opdrachten filters, sort and both empty-state texts are unchanged. The delete rule
of an observatie is the old one (test first, then rubric), now as a disabled menu item with the
reason as its tooltip. The ⋮ menu moved into `components/card-menu.ts` without behaviour change,
and `exam-menu.ts` uses it. Every user string in the HTML is escaped (`esc`), the observatie and
opdracht icons included; no `style=` in HTML strings (positions via CSSOM and custom properties,
fine under `style-src 'self'`); Typst SVG goes in as `<img>` blob URLs (`img-src blob:` is in the
CSP) and the URLs are revoked when a cache entry is replaced or dropped. The panel's stale-result
guard (`fill` checks `selected` and `data-for`), the close timer that a reopen cancels, the single
`ResizeObserver` that is disconnected on close, and the in-flight dedupe (`pending`) are right.
`render_assignment_svg` without a buffer now compiles the saved file; the only other caller (the
editor) always passes its text, so nothing else changes. All new files carry the SPDX header.

The one finding that matters is that the preview cache is keyed on `_meta.rev`, which the editor
never changes, so an in-app edit reached by another path than this screen's "Openen in editor"
leaves a stale preview (M1). The rest are an Escape that closes the preview together with a card
menu, the panel being rebuilt (scroll lost) on every re-render, the lost double-click guard on
Kopiëren, keyboard focus, memory, and test gaps.

## Blockers

None.

## Majors

### M1. The preview shows old pages after an edit made through Bewerken → Openen in editor

`ui/src/screens/opdrachten/preview.ts:58-61` serves the cache while `cache.get(id).rev ===
_meta.rev`. The editor writes `opdrachten/<id>/opdracht.typ` with `writeTextFile`
(`modals/editor.ts:204-209`) and does not touch the opdracht JSON, so `_meta.rev` never changes
for an edit of the pages. The only invalidation is `forgetPreviews(id)` in this screen's
`openInEditor` (`opdrachten.ts:43-50`). But the editor is also opened from the opdracht modal
("Openen in editor", `modals/opdracht-edit.ts:209-220`, reached from ⋮ Bewerken on the same
card) and from Opdrachten genereren (`modals/opdrachten-genereren/generate.ts:132,149`, new ids,
harmless). Sequence: preview opdracht A (cached), ⋮ Bewerken, Openen in editor, change the text,
close, click A: the panel shows the pages from before the edit, for the rest of the session. The
spec says "cached per opdracht until it changes", and STATE says the cache is "dropped when the
editor opens it", which holds only for one of the two in-screen paths.

A second hole in the same mechanism: `forgetPreviews` while a render of that opdracht is in
flight does not cancel it; the job then runs `drop(o.id); cache.set(o.id, out)` (lines 79-80)
and puts the pre-edit pages back, and `pending.get` hands that job to any render started
meanwhile. Opening the editor from the panel during the first render (a second or more for a
real Typst document) hits this.

Fix: invalidate where the pages change, not where one caller opens the editor: have
`openEditor` (or the editor's close / successful `writeTextFile` of `opdracht.typ`) call a hook
the preview registers (`onOpdrachtTypChanged(id)`), or key the cache on something the backend
knows (the file's hash or mtime returned with the render result, checked by a cheap command, or
`render_assignment_svg` returning the hash so a later call can be skipped). For the race: keep a
per-id generation counter that `forgetPreviews` bumps, and in the job only `cache.set` when the
generation is unchanged; also `pending.delete(id)` in `forgetPreviews`. Add an e2e: preview,
Bewerken → Openen in editor, edit (mock `writeTextFile`), close, preview again → a second
`renderAssignmentSvg` call.

## Minors

### m1. Escape with a card's ⋮ menu open also closes the preview

`preview.ts:270-276` listens on `document` in the bubble phase and skips when
`document.querySelector('.exam-menu')` is present. The card menu's Escape listener is on
`document` in the **capture** phase (`card-menu.ts:77-86`) and removes the menu element before
the bubble listener runs, and it calls only `preventDefault()`, not `stopPropagation()`. So with
the preview open and the ⋮ of any card open, one Escape closes both; the `.exam-menu` check never
sees the menu. (The choice chips and the user menu call `stopPropagation()`, so they are fine; a
dialog is caught by `modalOpen()`, since the dialog listener is on `window`, after `document`.)
Related: the listener stays attached while the Opdrachten screen is hidden (another tab), so an
Escape on another screen silently closes the hidden preview and `preventDefault`s the key.
Fix: `if (e.defaultPrevented) return;` first in `onKey` (the dialog's window listener already
follows this convention), and skip when `#screen-opdrachten` is not the active screen (or close
the preview when the screen is left). e2e: preview open, open a card's ⋮, Escape → menu gone,
panel still visible.

### m2. Every re-render of the list rebuilds the panel: scroll position and focus are lost

The panel is appended inside `#opdracht-list` (`preview.ts:234-241`, `view()` is the list
container), and `renderOpdrachten` replaces that container's `innerHTML`
(`opdrachten.ts:165-172`). So after every re-render the panel is gone and `restorePreview` builds
a new one (`preview.ts:358`, `if (!panel()) show(o)`); the `else if` on line 359 is dead code.
Re-renders are frequent: the file watcher re-renders on every `opdracht` or `observatie` change
(`app.js:689`, colleagues included), and Kopiëren in the panel re-renders. A teacher reading page
3 is put back on page 1, the "Pagina x van N" label resets, and keyboard focus on a panel button
goes to `body`. Fix: render the cards into a child (`#opdracht-list > .igrid` or a dedicated
`.opd-cards` wrapper) and keep the panel as a sibling that the list render does not touch; then
the existing `else if` does what it intends. If the panel must be rebuilt, keep `scrollTop`.

### m3. Kopiëren lost its double-click guard

The old `copyOpdracht(btn, id)` disabled the button until the copy finished
(`334cc77:ui/src/screens/opdrachten.js`, `btn.disabled = true`). The new `copyOpdracht`
(`opdrachten.ts:52-60`) has no guard, and the panel's Kopiëren (`preview.ts:186, 257`) stays
clickable: a double click makes two copies ("… (kopie)" twice), and the re-render after the
first rebuilds the panel (m2) while the second is running. From the ⋮ menu it is harmless (the
menu closes on the click). Fix: a module-level `copying` set per id, or disable the panel button
until the promise settles.

### m4. Keyboard and screen reader in the preview

- Opening moves no focus and announces nothing: the `role="region"` panel appears to the right,
  and a keyboard user has to tab through all remaining cards to reach Kopiëren / ✕. Move focus
  to the panel heading (or the ✕) on open, or at least give the region an `aria-labelledby` the
  name so it is announced with the opdracht.
- Closing with ✕ or Kopiëren-then-close leaves focus on an element that becomes
  `visibility: hidden` and is removed 350 ms later; focus falls to `body`. Return focus to the
  card's title button (`[data-action="preview"][data-id=…]`) in `closePreview`.
- `aria-expanded` on the card titles is only set by `markSelected` (`preview.ts:262-268`); on a
  fresh render before any open, the buttons have `aria-controls="opd-preview"` but no
  `aria-expanded`, and `aria-controls` points to an id that does not exist while closed. Emit
  `aria-expanded="false"` in `opdCardHtml`.
- `observaties/card.ts:88`: `aria-label="Toetstype"` on a plain `div` is not exposed (generic
  role); give it `role="group"` or drop it.

### m5. The preview cache keeps every rendered page for the whole session

`cache` (`preview.ts:33`) holds the SVG blobs of every opdracht ever previewed and is only
emptied for one id by the editor path; deleted opdrachten stay in it too. Typst SVG pages with
glyph outlines and images are easily hundreds of kB to a few MB each, so browsing through a
section's 50+ opdrachten keeps tens of MB alive in the webview. Fix: a small LRU (e.g. the last
8-10 opdrachten), revoking on eviction; drop the entry in `deleteOpdracht`.

### m6. Test gaps

- The step text asks for "e2e: filters" on both screens; only the Observaties toetstype chip is
  tested. No e2e for the Opdrachten count following a filter (schoolsoort, observatie filter) or
  for the "Geen opdrachten gevonden voor de huidige filters." empty state, which also has to
  close an open preview (`restorePreview` with `still === false`).
- No test for M1 (cache invalidation after an edit / a `_meta.rev` change re-renders) or m1
  (Escape with a menu open).
- Reduced motion is not tested (spec 4.17 last line); the JS branch (`closePreview` calling
  `done()` at once) could be checked with `page.emulateMedia({ reducedMotion: 'reduce' })` and a
  synchronous `evaluate` right after the click that the panel is already gone.
- Switching while the close animation runs (`togglePreview` during `closeTimer`, `pin()`'s
  early return keeps the current positions) is untested and is the trickiest path.
- `obsCardHtml`/`opdCardHtml` tests do not cover escaping (a name or icon with `<` / `"`).
- The Opdrachten filter predicates (`matchesSchoolsoort`, `matchesVak` with the `wis*` rule)
  stay inline in `renderOpdrachten`; moving them next to `filterObservaties` would make them
  unit-testable like the Observaties filter.

## Nits

- n1. `observaties/card.ts` `useHtml`: a card can say "nog niet gebruikt" while Verwijderen is
  disabled with "gekoppeld aan een toets" (a test of another year, which the e2e at
  `item-cards.spec.ts:59-60` works around). Mention the year in the reason ("… aan een toets (ook
  in een ander schooljaar) …") so the two do not seem to contradict.
- n2. `observaties.ts:116-119`: with filters that exclude everything, the hint still says "Nog
  geen observaties. Klik …" (as before) while the count says "0 observaties"; the Opdrachten
  screen distinguishes the two cases. Cheap to copy.
- n3. `preview.ts:116-130`: `place(true)` from the `ResizeObserver` while the screen is hidden
  (`clientWidth` 0) writes negative slot widths (ignored) and lefts of 0/3 px. It heals on the
  next render, but an early `if (!g.clientWidth) return;` avoids the odd state.
- n4. `preview.ts:304`: the window `resize` listener duplicates the `ResizeObserver` for the
  width; it is only needed for `fitPanel`'s height, which could be done in the observer callback
  too (one listener less to detach).
- n5. `preview.ts:191`: the footer says "PDF · gegenereerd uit de opdracht (Typst)" (as the mock)
  but the pages are SVG renders with the placeholder header, not the PDF. Consider "Voorbeeld ·
  gegenereerd uit de opdracht (Typst)".
- n6. `observaties.ts:91-123` is now async with an `await` before the list is drawn; two quick
  renders both draw (last write wins with current filters, so correct), but the async
  `renderObservaties` is passed as a sync callback in a few places (`toetstypeFilterChip`,
  `openObsModalTs`) with `void`; fine, just keep it consistent with `renderOpdrachten`.
- n7. `card-menu.ts`: the menu has `role="menu"` but no arrow-key navigation and does not focus
  its first item on open (unchanged from the exam menu); worth a backlog line now that three
  screens use it.

## Resolution (implementer, 2026-11-21)

- **M1 fixed:** the editor forgets the opdracht's rendered pages when it closes (every path:
  the card, Bewerken › "Inhoud bewerken in de editor", the AI entry points), and an open preview
  renders again; a per-opdracht generation keeps a render that was running during the forget out
  of the cache. e2e "an editor session renders the preview again".
- **m1 fixed:** Escape is ignored when already handled (`defaultPrevented`, the ⋮ menu) and when
  the Opdrachten screen is not active; same e2e.
- **m3 fixed:** one copy per opdracht at a time (menu and panel).
- **m4 fixed in part:** `aria-expanded="false"` from the first draw; ✕ and Escape give the card's
  title the focus back; the toetstype pills are a `role="group"`. Focus into the panel on open:
  backlog.
- **m5 fixed:** at most 8 rendered opdrachten are kept, the least recently shown dropped first
  (their blob URLs revoked).
- **Backlog (not fixed in this step):** m2, m4 rest, m6, the nits (`docs/backlog.md` "From Step
  34").
- Also found in the gate's visual check: the Observatie card's footer ran past the card at 1280
  px; the schoolsoort pill now gives way (`8905357`).
