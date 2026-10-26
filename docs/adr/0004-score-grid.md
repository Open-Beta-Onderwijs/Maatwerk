# ADR-0004: Score grid replacement

Status: **proposed** (Step 3b). The user chooses (PLAN section 9, open decision 1).

## Context

The score grid (`ui/src/screens/scores.js`) uses Handsontable 14 under the HandsOnCode
Non-Commercial licence. It cannot ship in an AGPL-3.0 app used by a school (institutional use
counts as commercial after a 45-day evaluation, there is no clear distribution right, and the
licence is proprietary). Its dependency tree also carries the open advisories of `dompurify` 2.x and
`moment` (`npm audit`, Step 3a) and the GPL-3.0-only `hyperformula`.

What the grid must do is written down in `docs/specs/score-grid.md` (rules G01-G58). Nearly all of
it is already app code on top of Handsontable hooks: navigation, `N` entry, validation and colours,
observatie checkboxes, grade overrides, undo, autosave, colleague updates and cursors. Handsontable
itself contributes the cell editor, the selection model, rendering and copy/paste. The grids are
small: one class (about 30 rows) by up to about 60 columns, a few groups per modal, no frozen rows
or columns, no sorting, filtering, formulas or virtual scrolling needed.

The fixes U2 (fast entry dropped while a save is in flight) and U4 (paste into observaties not
saved) were decided for 3b; U1 (Ctrl+Z reaches Handsontable's undo instead of the app's) changes
with any replacement, since Handsontable's own undo disappears.

## Options

| Option                         | Licence     | Size (min+gz, approx.) | Fit with the spec                                                                                                                                                                                         | Risk                                                                                                                         |
| ------------------------------ | ----------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **A. Own grid on a `<table>`** | AGPL (ours) | ~10-15 kB of own code  | Exact: the keyboard scheme, `N`, checkbox cells, stacked headers and summary rows are ours anyway. Plain DOM, CSS classes only (strict CSP).                                                              | We own selection, editing and copy/paste (~600-900 lines with tests). No virtualisation (not needed at this size).           |
| B. AG Grid Community           | MIT         | ~250-300 kB            | Good editing/navigation API; custom keyboard needs `suppressKeyboardEvent` per column; checkbox cell renderers, header components. Copy/paste of ranges is **Enterprise-only** (G54 would need own code). | Large API surface for a small table; inline styles in some features (CSP check needed); frequent major versions.             |
| C. Tabulator                   | MIT         | ~100 kB                | Spreadsheet-ish editing, range selection and clipboard built in; custom keybindings possible. Header/summary rows via column calcs.                                                                       | Sets many inline styles via CSSOM (fine for CSP) but owns the DOM; our capture-phase key handling must coexist with its own. |
| D. RevoGrid / Jspreadsheet CE  | MIT         | ~100-150 kB            | Spreadsheet-like; RevoGrid uses Web Components (shadow DOM, styling), Jspreadsheet CE is small but its API changed a lot between v4 and v5.                                                               | Smaller communities; more adaptation of our renderers.                                                                       |

All options keep the existing app logic (`recomputeRow`, `saveCell`, undo, presence, Sync) behind a
small `ScoreGrid` interface, so the choice is replaceable later.

## Proposal

**Option A, own grid on a `<table>`**, behind a `ScoreGrid` interface in
`ui/src/components/score-grid/` (TypeScript): render rows and headers from the existing data
arrays, own selection/editor/clipboard, and call the existing callbacks. It fits the spec exactly,
adds no licence or supply-chain risk, works under the strict CSP without exceptions, and is small
enough to test fully. B-D save some work on editing and clipboard but bring a large dependency whose
own keyboard and DOM handling we would fight for the numpad scheme.

Fallback if A turns out too costly during 3b: C (Tabulator), with the same Playwright tests.

## Consequences

- The Playwright tests of the spec (`ui/e2e/score-grid.spec.ts`) are written against Handsontable
  first and must pass unchanged on the new grid (only the small grid driver in the test changes).
- U2 and U4 are fixed in the new grid (failing tests first). U1: Ctrl+Z/Ctrl+Y drive the app's undo
  (decision needed, see the 3b questions).
- `handsontable` and its licence exception are removed from `ui/package.json`,
  `tools/check-npm-licenses.mjs` and `THIRD_PARTY_LICENSES.md`.
