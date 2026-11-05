# Review: step 14 (Foundation b)

Scope: `main...step/14-foundation-b` (base `766e4aa`), commits `5538f85`..`4797c2d` (8 commits,
43 files, +2993/-2114; the last commit is only the 0.5.0 version bump). Reviewer: fresh-context
subagent, checklist PLAN.md Appendix C. I checked the code itself, not the commit messages or
STATE, and compared it with `git show main:<path>`. Three findings (M1, M2, M3, plus m1) were
confirmed with throw-away Playwright probes against the current `dist-mock` (kept outside the
repo). `e2e/dialog.spec.ts`: 64 passed.

## Summary

| Severity | Count |
| -------- | ----- |
| Blocker  | 0     |
| Major    | 3     |
| Minor    | 6     |
| Nit      | 7     |

Checked and found correct:

- **Escaping:** `Dialog` escapes the title, badge, subtitle, tab labels and tab tooltips with
  `esc()`. No caller passes pre-escaped text, so nothing is escaped twice. Callers that put user
  data into `footerHtml` escape it (the profile's Vorige/Volgende names). `showReloadNotice` still
  escapes its message.
- **CSP:** no new `style=""` attributes. The backdrop z-index is set through CSSOM. The skeleton
  sizes go through `data-w`/`data-h`.
- **Removed DOM:** nothing in `ui/src`, `ui/index.html` or `ui/e2e` still references
  `#modal-overlay`, `#modal-box`, `#modal-content`, `#modal-close`, `.app-dialog*`,
  `.overview-tab*`, `.pta-btn`, `.pin-role`, `.rtti-unsaved-*`, `showModal`, `overlayElement` or
  `backFn`. Every `u-*` class still used is still defined.
- **Escape ordering:**
  - The dialog listens on `window` in the bubble phase, so document-level handlers run first.
    These handlers call `preventDefault()` and so keep the modal open: CustomSelect (document),
    the grid cell editor (root), the score cell menu (document, capture), the exam menu and the
    dev theme menu (n8).
  - Confirm dialogs stop propagation inside their own element.
- **U12:** `Dialog.close()` destroys every `.csel` host's `_csel`. `destroy()` removes both
  document listeners and deletes `_csel`.
- **U14:** the RTTI uitleg modal uses `guardModalClose`. The capture listeners and the inline bar
  are gone, and Annuleren goes through `requestCloseModal`.
- **U15:** a modal replaced by `key` runs its cleanups, charts and `onClose`
  (`prev.close()` in `openModal`).
- **Guard and close behaviour:**
  - `requestClose` re-checks `this.closed` after the guard question.
  - `asking` prevents a second question.
  - A dialog that is not on top cannot be closed through the guard.
  - A backdrop click closes only when the press also started on the backdrop.
  - Focus is restored to `prevFocus` when it lies in the new top dialog, and otherwise to the top
    dialog itself.
- **Layering:** dialogs (1010+) are above the editor overlay (500) and the sticky
  `.screen-head` (50). They are below toasts, `#bg-notices`, the exam/cell menus and CustomSelect
  dropdowns (9998–10000). The CustomSelect dropdown switches to `position: fixed`, so the
  dialog's `overflow: hidden` does not clip it.
- **`onShow` gets the whole dialog:** no handler writes `innerHTML` or `scrollTop` on that root.
  `formSnapshot(el)` now also sees the header and footer buttons, which have no `.selected` or
  `data-checked`, so the guards are unchanged. Tick boxes keep `data-checked`, which
  `formSnapshot` reads.
- **CSV year flow:** `askSchoolYear` resolves the year before `closeModal()`, and `onClose`
  resolves `null` only for other closes.

## Major

### M1. Stacked modals: background-change callbacks act on the top modal, and `key` only replaces the top

- **Where:**
  - `ui/src/app.js:186` (`if (opts.key && prev?.key === opts.key)` checks only the current
    modal).
  - `ui/src/modals/groep-leerlingen.js:286-303`: `showReloadNotice(..., closeModal)` and
    `reopen`.
  - `ui/src/modals/profiel.js:40-48` (same pattern).
  - `ui/src/app.js:317` (`showReloadNotice` is not bound to a modal).
- **Evidence:** before this step, one modal was open at a time. Since the profile now stacks on
  the group overview, these callbacks run while the overview is covered:
  - A colleague **changes** the group: OK runs `openGroupStudentsModal`. `currentModal()` is the
    profile (key `profile`), so a second overview stacks **on top of the profile**, and the stale
    overview stays underneath. Probe result after OK: three dialogs,
    `["3a nat", "Sem van den Dekker", "3a nat (gewijzigd)"]`. The stale overview keeps its sync
    subscriptions, so the next change adds more.
  - A colleague **deletes** the group: OK runs `closeModal`, which closes the profile and leaves
    the deleted group's overview open.
  - A change to a student of the group fires both the overview's and the profile's `students`
    handlers. Only the first notice is shown (the overview's), so the stacking above happens and
    the profile is not reloaded.
- **Fix:**
  - Bind the callbacks to the modal that registered them. For example, capture
    `const d = currentModal()` in `onModalSync`, `showReloadNotice` and `modalRefresher`, and use
    `d.close()` in place of `closeModal`.
  - Let `openModal({ key })` replace a same-key modal anywhere in `_modals`, at its stack
    position: close the modals above it, or insert the new one at the same index.
  - Test: profile over group overview, external group write, OK, then expect 1 overview + 0
    stale.

### M2. Opening a dialog leaves focus on the opener behind the backdrop; keyless modals stack duplicates

- **Where:** `ui/src/components/dialog.ts:291` (`mount()` never moves focus) and `:142`. The
  keyless `openModal` calls are at `screens/observaties.js:247`, `screens/opdrachten.js:208`,
  `screens/gebruikers.js:268`, `screens/scores.js:311`, `modals/herkansing.js:168`, the CSV import
  modals, `about.ts` and `pin.ts`.
- **Evidence:**
  - Probe: click "+ Observatie toevoegen". `document.activeElement` is still `#btn-add-obs`.
    Pressing Enter gives **2 stacked dialogs**.
  - The same happens with a double-click on any async keyless opener: `openObsModal`,
    `openOpdrachtenModal` and `openSummaryEditModal` await before they open.
  - On `main`, `showModal` replaced the open modal, so this was harmless. Now it stacks.
  - For the score modal a duplicate would be worse. `scores.js` keeps grid, undo and roster state
    in module globals, and closing the top copy runs `resetScoreModal` under the copy that stays
    visible. Today its only opener is the exam menu item, which is removed on click, but nothing
    in the dialog layer prevents it.
  - Tab also walks through the page behind an `aria-modal` dialog: there is no containment except
    in confirms.
- **Fix:**
  - In `openDialog`, after `onShow`, focus the first focusable control in the body, or else the
    dialog element (confirms already focus OK).
  - Contain Tab in the top dialog, as `confirmDialog` already does.
  - Give the score modal, observatie, opdracht, user and verzamelkaart modals a `key`.
  - Add an e2e test: Enter right after opening does not add a dialog, and focus is inside the
    dialog.

### M3. Dialog tabs cannot be reached with the keyboard

- **Where:** `ui/src/components/dialog.ts:318` (`t.tabIndex = on ? 0 : -1`). There is no
  keydown handler on `.dlg-tabs`.
- **Evidence:**
  - The probe on the exam overview gives tabindex `[0, -1, -1, -1, -1, -1]`.
  - ArrowRight on the active tab does nothing, and Tab goes from it into the body.
  - Inactive tabs can only be reached with the mouse. On `main` every `.overview-tab` was a
    normal tabbable button. This is a regression in the exam overview, the profile and the RTTI
    uitleg (spec 6: real buttons, `role="tab"`, keyboard-operable).
- **Fix:** add ArrowLeft/ArrowRight/Home/End on the tablist, which move focus and select while
  skipping disabled tabs. Alternatively, drop the roving tabindex. Add `aria-controls` /
  `role="tabpanel"` where the panes are known. Add an e2e test.

## Minor

### m1. The reload notice can be dismissed with Escape, skipping the reload

- **Where:** `ui/src/app.js:341` (stopPropagation only inside the notice) and
  `ui/src/components/dialog.ts:505`.
- **Evidence:** the probe clicked the notice's backdrop (focus goes to `body`) and then pressed
  Escape. The window listener calls `requestClose()` on the notice, which closes it without
  `onOk`. The stale modal stays open and is not reloaded. `backdropCloses: false` does not cover
  Escape.
- **Fix:** add an `escapeCloses?: false` option (or a `dismissible: false` that covers ✕,
  backdrop and Escape) and use it for the notice.

### m2. Async work after an `await` still targets "the current modal"

- **Where:**
  - `ui/src/app.js:284-300` (`modalRefresher`).
  - `ui/src/modals/toets-overzicht.js:1062` (`pushModalChart` after `await Store.getExams` /
    `getStudentScores`).
  - `ui/src/modals/profiel.js:233-1136` (charts and `switchTabRef` set two frames later).
- **Evidence:**
  - `modalRefresher` checks `isOpen`/covered and then `await reopen()`. `reopen` awaits data
    before `openModal`, so a modal that the teacher closed in that window reopens. A modal stacked
    in that window gets a duplicate (see M1). The window existed on `main` too.
  - After the await, `currentModal().body.scrollTop = y` is set on whatever is on top.
  - `pushModalChart`, `onModalSync` and `onModalCleanup` attach to `currentModal()` at call time.
    The RTTI-history chart is registered after several awaits, and if another modal is on top by
    then, the chart is destroyed when that modal closes.
- **Fix:**
  - Check `d.isOpen` again before `openModal` in the reopen path (pass `d` or a session).
  - Restore the scroll on the dialog that `reopen` returns.
  - Let `pushModalChart` and friends take the dialog explicitly (`dialog.onCleanup`) in async
    code.

### m3. Skeletons and sticky table heads exist only as CSS/helpers; the "lazy" test cannot see loading

- **Where:**
  - `ui/src/components/skeleton.ts` (none of its five exports is imported).
  - `ui/src/styles/dialog.css:175-186` (`.dlg-sticky` is used nowhere).
  - `ui/e2e/dialog.spec.ts` "a lazy modal keeps its size while loading".
- **Evidence:**
  - Spec 3.3 asks for sticky `thead`/`tfoot` in modal tables. The group overview and results
    tables do not use them.
  - Spec 3.4 asks for skeletons while data loads. STATE defers them to the area steps, but there
    is also no unit test of the helpers.
  - The test takes its "loading" box after `openView`. With the mock's instant data this is
    usually after the load, so it tests the fixed height, not "does not change while loading".
- **Fix:**
  - Apply `dlg-sticky-head` to the group overview and results tables, or record the deferral in
    `docs/backlog.md`.
  - Add a Vitest for `skeleton.ts`.
  - In the lazy test, delay the mock compile (or measure before `rapport-pdf-frame` exists) so
    that the first box is provably taken while loading.

### m4. Fixed quirks and new behaviour have no regression tests

- **Where:** `ui/e2e/dialog.spec.ts`, `ui/e2e/quirks.spec.ts`. There is no Vitest for
  `components/dialog.ts`.
- **Evidence:**
  - Nothing tests these:
    - U15 (a replaced modal runs its `onClose`).
    - U12 (CustomSelects destroyed: listener count).
    - That a reload notice ignores Escape (m1).
    - Keyboard tabs (M3).
    - Footer arrangement for `data-align="start"`. The footer test returns early when there is
      no primary, and never checks the left group.
  - `arrangeFooter`, the guard flow and stacking are pure DOM and easy to unit-test in jsdom.
- **Fix:** add `quirks.spec.ts` U12/U15 cases (e.g. count `document` keydown handlers via a spy,
  or check that the `onClose` side effect runs after key replacement). Add
  `ui/tests/components/dialog.test.ts` covering `arrangeFooter`, `requestClose` with a guard,
  stacking and `onCleanup` after close.

### m5. Bookkeeping: quirks and backlog items not updated

- **Where:** `docs/reference/quirks.md` U12/U14/U15 and `docs/backlog.md` "From Step 13".
- **Evidence:**
  - The quirks file marks fixed items with **Fixed (Step N)** and the test. U12, U14 and U15
    have no such note.
  - **n6** is only partly done. `setBusy` is used in `pin.ts`, but not in `instellingen.ts`,
    `gegevens.ts` or `migration.ts`, and `setBusy` still replaces `textContent`, which drops
    icons.
  - **n8** fixes only the Escape half. The AltGr+T half (Ctrl+Alt on Windows layouts) is
    unchanged.
  - The plan's "remove the remaining `u-*` utilities in the touched files" is deferred in STATE
    (about 400 uses left in the touched files) but not in the backlog.
  - Behaviour changes are not recorded where the next reader looks: Escape closes modals, the
    profile stacks, and the account modal stays open.
- **Fix:** add "Fixed (Step 14)" notes with test names, move the open halves of n6/n8 and the
  `u-*` deferral into `docs/backlog.md`, and list the behaviour changes in the step's
  STATE/changelog entry.

### m6. Accessible names: confirms and tick boxes

- **Where:**
  - `ui/src/components/dialog.ts` `confirmDialog`: `role="alertdialog"` with no
    `aria-labelledby`, and the `<h2 class="dlg-confirm-title">` has no id.
  - `ui/src/components/form.ts` `field()`: the `<label>` has no `for` unless the caller passes
    one.
  - `tickBox`: `aria-label` defaults to the long tooltip.
- **Evidence:**
  - Confirm and notice dialogs have no accessible name; only a description.
  - The visible "PTA" label is not linked to the tick box. In the new-exam step 1 and in the
    verzamelkaart, screen readers announce the whole PTA sentence and not "PTA".
- **Fix:**
  - Give the confirm title an id and set `aria-labelledby`, falling back to `aria-label` = the
    message when there is no title.
  - In `field()`, pass `for: id` for tick boxes and use the short label as `aria-label`, with the
    long text as `title`/`aria-describedby`.

## Nit

### n1. Dead exports and CSS

- `alertDialog` (re-exported from `app.js:164`, no caller).
- `modalSession` (`app.js:273`).
- `openDialogs`, `Dialog.setTitle` (`dialog.ts:281`; herkansing writes `.dlg-title` itself) and
  `formRow` (`form.ts:43`).
- `dlg-close--float` (`dialog.ts:200`, `dialog.css:124`): every `openModal` call has a title, and
  confirms and notices have no close button.

Remove these, or use them (`setTitle` in herkansing).

### n2. Profile tabs before the charts are ready

The dialog marks a clicked tab active at once. `switchTabRef` is only set two animation frames
later (`profiel.js:1136`), so a click in that window underlines "Analyse" while the
Cijferverloop pane stays. Set the ref before the rAF, or call `dialog.selectTab(activeTab,
false)` once it is ready.

### n3. Block braces left to avoid reindenting

`{ const el = dialog.el; { ... } }` in `profiel.js`, `{ const el = dialog.body; ... }` in
`groep-edit.js`, and `wireAbout(){ { ... } }` in `about.ts`. Several files are still well over
500 lines (`app.js` 1189, `toets-overzicht.js` 1288, `profiel.js` 1144, `scores.js` 1479). This
was accepted under R-05 for the area steps; tidy the braces then.

### n4. Skeleton colours are raw hex

`styles/skeleton.css` defines its own `--skel-a/b` hex values. Spec 3.4 names `--surface-2` as
the base. Move them into `tokens.css` with the other light/dark pairs (as backlog n5 does for
other raw colours).

### n5. `:has()` in the dialog header

`.dlg-header:not(:has(.dlg-tabs))` is fine on WebView2. Add it to the step 16 WebKit/WebKitGTK
checklist, or use a class set by `Dialog` (`dlg-header--tabs`).

### n6. Account modal: the primary action is in the body

"Uitloggen" (primary) and the two secondary actions stay as a body button row
(`pin.ts:413-420`), not in the footer by the button rule. After a PIN change the account modal
stays open underneath (documented as intended). Consider closing it after a successful change.

### n7. About: the "Probleem melden" `<h3>` lost its size rule

`#modal-box h3 { font-size: 17px }` was removed. That `h3` (`about.ts:40`) now uses the UA size.
Give it a class, or add a `.dlg-body h3` rule next to `.dlg-body h4`.

## Triage (implementer, 2026-11-05)

- **M1 fixed:** `onModalSync` holds the events of a modal that is covered by another modal and
  delivers them when it is on top again (`app.js`), so its reload notice acts on that modal.
  Test "M1 + m1" in `e2e/dialog.spec.ts` (fails on the code before the fix).
- **M2 fixed:** a dialog takes focus when it opens (its `[autofocus]` field, else itself); Tab
  and Shift+Tab stay inside the top dialog; every modal has a `key`, so a second open (double
  click on an async opener) replaces it. Tests "M2" (Enter after opening, Tab containment).
- **M3 fixed:** arrow keys, Home and End on the tab list (disabled tabs skipped). Test "M3".
- **m1 fixed:** `dismissible: false` for the reload notice (no Escape, backdrop or ✕).
- **m5 fixed:** U12/U14/U15 marked fixed in `quirks.md`; deferrals in `docs/backlog.md`.
- **m6 fixed:** confirm dialogs have `aria-label` (title or button text); the PTA label is
  linked to its tick box (`for`).
- **n1:** `modalSession`, `openDialogs` and `setTitle` removed. `alertDialog` and `formRow` stay:
  they are the step's alert and form-row helpers (plan items), `dlg-close--float` serves dialogs
  without a title. **n7 fixed:** About headings 17 px.
- **Backlog:** m2, m3, m4, n2, n3, n4, n5, n6 (`docs/backlog.md` "From Step 14").
