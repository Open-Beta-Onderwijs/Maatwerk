# Phase 2 design spec

Result of the design pass (ROADMAP step PD) with the user, 2026-11-04. This file is the source of
truth for the look of phase 2. The mocks are the illustration; where a mock and this file
disagree, this file wins.

- **Live canvas (interactive mocks):** <https://claude.ai/artifact/SXCUa2nfJcNiJGyZm6SbDE>
  (private to the user; ask for a screenshot or export if you cannot open it).
- **Mock sources:** `mocks/*.dc.html`. They are Design Component files (HTML with inline styles
  and a small `renderVals()` script). Read them for exact sizes, colours and states. They do not
  run on their own (they need the canvas runtime), and they are not app code: rebuild the UI with
  the app's own components and CSS.
- **Assets:** `assets/` (logo, icon, tab-bar wordmark; text converted to outlines, no font needed).
- **Implementation plan:** [`implementation-plan.md`](implementation-plan.md).

UI text stays Dutch, decimal comma, as everywhere in the app.

## 1. Boards and roadmap items

| Board (mock file)            | Covers                                                                                                                                                   | Roadmap                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1 Fundament (`Main.dc.html`) | tab bar, user menu, theme + accent, student and group cards                                                                                              | V-05, F-17, F-18, F-07, F-08, F-09 |
| 2 Kaartvarianten             | history: card variants A/B/C (C chosen)                                                                                                                  | F-07                               |
| 3 Groepsoverzicht            | modal position, sticky header, placeholders (content superseded by board 45)                                                                             | V-08..V-10                         |
| 4 Knoppen                    | buttons, inputs, chips, dialog buttons, test-type badges                                                                                                 | V-06, V-11                         |
| 5 Login                      | login flow with inline PIN                                                                                                                               | V-04                               |
| 6 Splash                     | splash screen                                                                                                                                            | F-06                               |
| 7 Logo, 9 Logo B             | wordmark (7 = final; 9 is history)                                                                                                                       | V-12                               |
| 8 Tabbalk                    | tab-bar wordmark variants (4 chosen)                                                                                                                     | V-12                               |
| 10 Editor                    | editor header, toolbar, divider, status, AI rail                                                                                                         | V-07, F-16, F-05, B-08, F-01       |
| 11 Toetsen                   | test-type badges, attempts as a tree, "+ PO toevoegen"                                                                                                   | V-11, F-12                         |
| 12 Beheer                    | admin tab bar, Gebruikers (+ edit, photo crop), School, Gegevenscontrole, Instellingen                                                                   | V-05, F-19, B-04                   |
| 13 Scores                    | score-entry modal: sticky parts, centred                                                                                                                 | V-06, V-10                         |
| 14 Toetsmodals               | new test (PTA/D), edit test, inhaal/herkansing                                                                                                           | V-11, F-12                         |
| 15 ObsOpdModals              | observatie edit with icon picker, opdracht edit                                                                                                          | F-15                               |
| 16 Rubrics                   | Rubrics tab, rubric editor with level display and validation                                                                                             | F-22                               |
| 17 PO                        | PO card, PO toevoegen (rubric), projectgroepen                                                                                                           | F-20, F-22                         |
| 18 POScores                  | PO score table, projectgroep grading modal                                                                                                               | F-22                               |
| 19 PORapport1                | PO rapport page 1: grade sentence, projectgroep, lollipop score table, bonus/malus, comment                                                              | F-22                               |
| 20 PORapportA                | PO rapport category pages (chosen): level cards, comment, observaties with leeradvies                                                                    | F-22                               |
| 21-24 PORapportB-E           | history: category page variants B-E (not chosen)                                                                                                         | F-22                               |
| 25-36 POOv*                  | history: PO overview, three alternatives per tab (chosen: Res C, Dist A and C, Cat B, Obs B)                                                             | F-24                               |
| 37-42 Profiel*               | history: profile, three alternatives per tab (chosen: Cijferverloop C, Analyse B)                                                                        | F-25                               |
| 43 POOverzicht               | PO overview (final, interactive): Per klas / Per projectgroep, tooltips, five tabs                                                                       | F-24                               |
| 44 Profiel                   | student profile (final, interactive): bar chart, SD bands, RTTI cards                                                                                    | F-25                               |
| 45 Groepsoverzicht2          | group overview (final, interactive; replaces board 3's content)                                                                                          | F-10, F-26                         |
| 46 Toetsoverzicht            | exam overview (final, interactive) with the verzameloverzicht toggle                                                                                     | F-11, F-26                         |
| 47-50 ToetsenKaartA-D        | history: Toetsen as cards, four ways to open attempts (chosen: card C, tray idea of B)                                                                   | F-27                               |
| 51-54 ToetsenStapelA-D       | history: the stack as one outlined shape, four variants (chosen: A)                                                                                      | F-27                               |
| 55 ToetsenStapelA2           | Toetsen as cards (final): a stack with two attempts, tray centred under the stack                                                                        | F-27                               |
| 56 ToetsenStapelA3           | Toetsen as cards (final): card layout and a stack with three attempts                                                                                    | F-27                               |
| 57 ObservatiesKaarten        | Observaties as cards (final)                                                                                                                             | F-28                               |
| 58 OpdrachtenVoorbeeld       | Opdrachten as cards with the preview panel (final, interactive)                                                                                          | F-28                               |
| 59 AIChat                    | AI in the editor (final, interactive): empty chat with starters and chips, running status line and transcript, finished with the diff card, error states | F-01                               |
| 60 AIContext                 | context chips, syllabus choice, Andere opdrachten picker, image warning, drop zone, attachment errors (final)                                            | F-01                               |
| 61 AIDiff                    | Voorstel bekijken (final, interactive): hunk choice, conflict, skipped files, PDF preview                                                                | F-01                               |
| 62 AIInstellingen            | AI-instellingen, first-use notice, install help, assistant off by the school, Beheer › Instellingen switch (final)                                       | F-01                               |
| 63 AIStart                   | Opdracht toevoegen with AI, Opdrachten genereren: Laat AI dit oplossen (final)                                                                           | F-01                               |

## 2. Design tokens

Implement as CSS custom properties on `:root`, switched by `data-theme="light|dark"` and
`data-accent="<name>"` on `<html>` (R-03). Names below are suggestions; keep them semantic.

### 2.1 Neutrals

| Token             | Light                | Dark              | Use                               |
| ----------------- | -------------------- | ----------------- | --------------------------------- |
| `--bg`            | `#F5F6F8`            | `#14171C`         | window background                 |
| `--surface`       | `#FFFFFF`            | `#1D2128`         | cards, modals, header             |
| `--surface-2`     | `#EEF0F3`            | `#272C35`         | chips, segmented control, badges  |
| `--border`        | `#E1E4EA`            | `#30363F`         | card and section borders          |
| `--border-strong` | `#C9CED8`            | `#434A57`         | inputs, secondary buttons         |
| `--line`          | `#EEF0F3`            | `#262B33`         | table row separators              |
| `--text`          | `#1B2230`            | `#E7EAF0`         | body text                         |
| `--muted`         | `#5D6675`            | `#A3ABB8`         | secondary text (passes 4.5:1)     |
| `--disabled`      | `#9AA1AD`            | `#6B7380`         | disabled text                     |
| `--danger`        | `#B42318`            | `#FF8A80`         | danger text and icons             |
| `--danger-fill`   | `#C0362C`            | `#C0362C`         | danger button fill (white text)   |
| `--scrim`         | `rgba(16,24,40,.42)` | `rgba(0,0,0,.55)` | modal backdrop                    |
| `--brand`         | `#2E3E50`            | `#2E3E50`         | logo diamond; accent before login |

Dark theme: cards are a slightly lighter shade than the background (`--surface` on `--bg`), the
watermark is inverted (CSS `filter: invert(1)` with reduced opacity, or a light variant of the
school's SVG), and the logo diamond gets a `#5B6B80` outline.

### 2.2 Accents (F-18)

21 accents in the user menu as a 7×3 grid. Row 1 is the rainbow; each column below it holds
colours near that rainbow colour (rood: koraal, bordeaux; oranje: koper, bruin; geel: oker, olijf;
groen: mint, bos; blauw: turquoise, marine; indigo: leisteen, zwart; paars: roze, magenta).
Default `blauw`, default theme light. Both are remembered per user (decision 7.7 in ROADMAP).
Every fill passes 4.5:1 against its `--on-accent` text, and every dark `--accent-text` passes
4.5:1 on the dark surface.

| Name      | `--accent` (fill) | `--accent-text` light | `--accent-text` dark | `--on-accent` | `--anti` (SE colour) |
| --------- | ----------------- | --------------------- | -------------------- | ------------- | -------------------- |
| rood      | `#C93636`         | `#C93636`             | `#D66868`            | `#FFFFFF`     | `#0F7F86`            |
| oranje    | `#C2540F`         | `#C2540F`             | `#CE763F`            | `#FFFFFF`     | `#2F6FD6`            |
| geel      | `#E5AE0B`         | `#916E0A`             | `#E5AE0B`            | `#2A2000`     | `#4F46C8`            |
| groen     | `#24804E`         | `#24804E`             | `#509971`            | `#FFFFFF`     | `#C2387A`            |
| blauw     | `#2F6FD6`         | `#2F6FD6`             | `#598CDE`            | `#FFFFFF`     | `#C2540F`            |
| indigo    | `#4F46C8`         | `#4F46C8`             | `#847ED8`            | `#FFFFFF`     | `#E5AE0B`            |
| paars     | `#8A3FC2`         | `#8A3FC2`             | `#AD79D4`            | `#FFFFFF`     | `#5A7A12`            |
| koraal    | `#C8492F`         | `#C8492F`             | `#D36D59`            | `#FFFFFF`     | `#1F3A93`            |
| koper     | `#AE611C`         | `#AE611C`             | `#BA793E`            | `#FFFFFF`     | `#0F7F86`            |
| oker      | `#9A6A12`         | `#9A6A12`             | `#AE8841`            | `#FFFFFF`     | `#4F46C8`            |
| mint      | `#13866E`         | `#13866E`             | `#369884`            | `#FFFFFF`     | `#A3248F`            |
| turquoise | `#0F7F86`         | `#0F7F86`             | `#3F999E`            | `#FFFFFF`     | `#C93636`            |
| leisteen  | `#4A5568`         | `#4A5568`             | `#B8C2D1`            | `#FFFFFF`     | `#C2540F`            |
| roze      | `#C2387A`         | `#C2387A`             | `#D16A9B`            | `#FFFFFF`     | `#24804E`            |
| bordeaux  | `#8E2340`         | `#8E2340`             | `#BB7B8C`            | `#FFFFFF`     | `#13866E`            |
| bruin     | `#8B5A2B`         | `#8B5A2B`             | `#A88360`            | `#FFFFFF`     | `#1F3A93`            |
| olijf     | `#5A7A12`         | `#5A7A12`             | `#7B9541`            | `#FFFFFF`     | `#8A3FC2`            |
| bos       | `#1E5E3A`         | `#1E5E3A`             | `#6D967F`            | `#FFFFFF`     | `#A3248F`            |
| marine    | `#1F3A93`         | `#1F3A93`             | `#7989BE`            | `#FFFFFF`     | `#9A6A12`            |
| zwart     | `#111418`         | `#111418`             | `#E7EAF0`            | `#FFFFFF`     | `#C2540F`            |
| magenta   | `#A3248F`         | `#A3248F`             | `#C371B6`            | `#FFFFFF`     | `#13866E`            |

- `--accent` fills primary buttons and the active-filter chip border; `--accent-text` is used
  for titles (`h1`, jaarlaag headings, group names), links and the active tab underline on a light
  header (yellow needs the darker shade there).
- Yellow (`#E5AE0B`) takes dark text (`#2A2000`) as a fill and as an `--anti` colour; all others white.
- Accent soft tints: fill + alpha `14` (light) / `2E` (dark) for chips; focus ring fill + `33`.

### 2.3 Grade colours (unchanged meaning, new values)

Independent of the accent. `g` is the grade, pass from 5,5. Grades are always shown with a
decimal comma and one decimal, also for whole grades: `7,0`, `4,0`.

- **Text:** fail `#B42318` (dark `#FF8A80`); pass: interpolate `#8A6A00` → `#1E7B3C` over
  5,5..9,5 (dark `#E2BD45` → `#6CCB8A`).
- **Pill border, bars, histogram:** fail `#E5736B`; pass: interpolate `#F2C94C` → `#5DB97B`.
- **Grade pill:** min-width 44 px, padding 2px 6px, radius 6, 1.5 px border in the bar colour,
  text in the text colour; fails bold.
- **Diagnostic grades:** italic, `--muted` text, `#9AA1AD` border (in every table).
- **Grade cell (score-entry grid only):** plain number (700) on a background from red through
  yellow to green, as the current app does: fail `#F7CFCA`; 5,5..7,5 `#FBE7A6` → `#E3EDB4`;
  7,5..9,5 `#E3EDB4` → `#C6E8CF`.

### 2.4 Trend arrow (F-08)

One arrow icon (→) rotated by level. `d = last grade − year average`:

| `d`            | Level        | Rotation | Colour light / dark   |
| -------------- | ------------ | -------- | --------------------- |
| `> 1,0`        | sterk omhoog | −50°     | `#0E9F4F` / `#3DDC84` |
| `0,5 .. 1,0`   | licht omhoog | −25°     | `#4E8F63` / `#86C99C` |
| `−0,5 .. 0,5`  | gelijk       | 0°       | `--muted`             |
| `−1,0 .. −0,5` | licht omlaag | 25°      | `#B4654F` / `#E6A08F` |
| `< −1,0`       | sterk omlaag | 50°      | `#D92D20` / `#FF6B5E` |

Boundaries: `|d| < 0,5` is level; `0,5 ≤ |d| ≤ 1,0` is slight. `aria-label="Trend: <level>"`.
Which grades count as "last" and "average" is ROADMAP decision 7.9.

### 2.5 Test types (V-11)

A test's badge (the `201`-style code) shows its type. Same rule everywhere a test code appears
(Toetsen list, overview modals, group overview, profile, rapport input).

| Type                         | Badge                                                       |
| ---------------------------- | ----------------------------------------------------------- |
| Toets                        | `--accent` fill, `--on-accent` text                         |
| Praktische opdracht          | `--accent`, diagonal stripes                                |
| SE-toets                     | `--anti` fill                                               |
| SE praktische opdracht       | `--anti`, diagonal stripes                                  |
| Diagnostisch (telt niet mee) | `--surface-2` fill, 1.5 px `#9AA1AD` border, `--muted` text |

- Stripes: `repeating-linear-gradient(135deg, C 0 4px, mix(C, white, 50%) 4px 8px)` (yellow
  mixes 60%). White text on stripes gets `text-shadow: 0 0 2px D, 0 0 3px D` with
  `D = mix(C, black, 40%)` for readability.
- Badge: 12 px, weight 700, padding 1px 6px, radius 5, 1.5 px border in the type colour.
- Charts per test (boxplot, histogram) use the same type colour (striped boxes for practical
  assignments, grey for diagnostic).
- **Data:** the exam schema has `type: pta|regular` and `weging_se` but no field for "practical
  assignment" or "diagnostic". User direction (2026-11-04): a diagnostic test is a toets with the
  **D** box checked (next to PTA; D and PTA exclude each other; D sets Weging to 0 and disables
  it). A praktische opdracht gets its own "+ PO toevoegen" button and its own modal (designed
  later). ROADMAP decision 7.11 fixes the field names.

### 2.6 RTTI colours

UI: R `#3A9A4A`, T1 `#2A9FC4`, T2 `#E0922F`, I `#D24A45` (the existing `#5cb85c/#5bc0de/#f0ad4e/
#d9534f`, deepened for contrast on white). The rapport keeps its own colours unless the user
decides otherwise (rapport output change).

**Names (user, 2026-11-14, F-26):** R = reproductie, T1 = training, T2 = transfer, I = inzicht,
everywhere in the UI (legends, tooltips, headings, help text), as the rapport already does
(`rapport.typ`). Never "toepassen bekend" / "toepassen nieuw".

### 2.7 Type, spacing, radii, shadows

- **Font:** `'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif`. Numbers
  `font-variant-numeric: tabular-nums`. Code: `Consolas, 'Cascadia Mono', monospace`, 13.5/22.
- **Sizes:** screen title 24/650 (accent text); section heading (JAARLAAG 2) 12/700, uppercase,
  letter-spacing 1 px, accent text; body 14; secondary 13; captions 12; modal title 22/700.
- **Radii:** buttons 8 (small 7), inputs 8, cards 10 (student) / 12 (group, exam), modals 14,
  chips and pills 999.
- **Shadows:** card `0 1px 2px rgba(16,24,40,.04)`, card hover `0 4px 14px rgba(16,24,40,.08)`,
  popover `0 12px 32px rgba(16,24,40,.16)`, modal `0 24px 64px rgba(16,24,40,.28)`. None on dark
  cards.
- **Page width:** content `max-width: 1360px`, side padding 40 px.

## 3. Components

### 3.1 Buttons (V-06)

One component, replacing every existing button style (including the PIN buttons).

| Variant   | Look                                                        | Use                                    |
| --------- | ----------------------------------------------------------- | -------------------------------------- |
| primary   | `--accent` fill, `--on-accent` text                         | the one main action of a screen/dialog |
| secondary | `--surface`, 1 px `--border-strong`, `--text`               | other actions                          |
| text      | transparent, `--accent-text`                                | cancel-like and navigation actions     |
| danger    | `--danger-fill`, white text                                 | only inside a delete confirmation      |
| icon      | 32×32, 1 px `--border`, radius 7; delete icon in `--danger` | row actions (edit, copy, delete, ⋮)    |

- Sizes: default 36 px (padding 0 16, 14/600), small 30 px (padding 0 12, 13/600).
- States: hover (slightly darker fill or `--surface-2`), focus-visible ring `2px solid --accent`
  offset 2, busy (spinner + label, e.g. "Bezig…"), disabled (`--surface-2`, `--disabled`).
- Dialog footers: right-aligned, primary last. When the footer has a navigational action
  ("← Andere gebruiker"), that one goes left, the primary action right.

### 3.2 Inputs and filters

- Inputs and selects: 36 px, 1 px `--border-strong`, radius 8, focus border `--accent` + 3 px
  ring `--accent` at 20%.
- Filter chips: 32 px pills with the funnel icon. Active filter: `--accent` border, soft accent
  fill, `--accent-text`, weight 600 (e.g. "Jaarlaag 4, 5").
- Search field in the screen header: 220 px, magnifier icon inside.

### 3.3 Modal (R-02, V-08, V-09, V-10)

- Opens at a **fixed top of 64 px**, horizontally centred; never vertically centred. Max height
  `calc(100vh - 96px)`. Modals with tabs or lazy content have a **fixed height** (the max), so
  switching tabs or loading never changes the size.
- **Header is sticky:** title (22/700, accent text), optional badge, subtitle (13, muted), close
  button (icon, 36 px), and tabs (underline 3 px `--accent-text`, active 600). Only the body
  scrolls. Tables inside keep their `thead` sticky at the top and summary rows (`tfoot`) sticky
  at the bottom.
- Backdrop `--scrim`. Escape and the close button close it (with the existing close guard).
- Screens: the title row and the filter bar of every tab are sticky too (board 1).

### 3.4 Placeholders (V-09)

- While data loads, render the final layout with skeleton blocks of the **same size** as the
  real content: grade pills 44×24 radius 6, chart areas their final height, list rows their final
  height. Data that is already known (student names) is shown at once; only the lazy part shows
  skeletons.
- Skeleton: `--surface-2` block with a shimmer (`linear-gradient(90deg, a 25%, b 50%, a 75%)`,
  `background-size: 200%`, 1.3 s linear infinite). Light a/b `#EEF0F3/#F7F8FA`, dark
  `#262B33/#323843`. No shimmer under `prefers-reduced-motion`.

### 3.5 Tab bar (V-05, V-12)

- Height 56, header in `--surface` with a 1 px `--border` bottom line (white in the light theme,
  the dark surface in the dark theme). The dark header of the current app is gone.
- Left: icon (28 px, `assets/maatwerk-icon.svg`) + wordmark "M<sub>AATWERK</sub>" in small caps
  (`assets/maatwerk-tabbalk.svg`, about 14 px high; the M is full height, the rest 72%).
- Tabs: 18 px stroke icon + label, padding 0 14, active tab: weight 600, `--text`, icon in
  `--accent-text`, underline `inset 0 -3px 0 --accent-text`.

| Tab         | Icon                                                            |
| ----------- | --------------------------------------------------------------- |
| Leerlingen  | one person (Lucide `user`)                                      |
| Groepen     | several people (Lucide `users`)                                 |
| Toetsen     | sheet with a grade in a circle (custom; path in `Main.dc.html`) |
| Observaties | eye (Lucide `eye`)                                              |
| Opdrachten  | puzzle piece (Lucide `puzzle`, or the simpler path in the mock) |

Lucide is ISC-licensed: allowed; add to `THIRD_PARTY_LICENSES.md` if its paths are copied.

### 3.6 User menu (F-17)

Click the avatar (38 px, 2 px accent ring, photo or initials) → dropdown (280 px, radius 12,
popover shadow) anchored top right, not an overlay:

1. Name (600) + "Docent · Natuurkunde" (muted), 40 px avatar.
2. **Thema:** segmented control Licht / Donker.
3. **Accentkleur:** 10 swatches (26 px), rainbow row of 7, second row of 3; selected one has a
   double ring.
4. Foto wijzigen (F-19) · Pincode wijzigen · Uitloggen (in `--danger`).

Changes apply immediately and are saved for the user.

### 3.7 Form layout rule

In every form (modals and settings), fields that share a row are aligned on their **labels**:
all labels in a row sit at the same height (`align-items: flex-start` on the row, label 12/700
uppercase above its control) and all controls start at the same height below them. A control
that is narrower or shorter than its column (a row of colour swatches, a segmented control) is
centred in the remaining space of its column, at the control height of the row (36 px). Steppers
that occur in more than one row of a form line up in the same grid columns (board 14).

### 3.8 Observatie icons

An observatie is always shown with its own emoji icon (table headings, chips, overviews), never
with a letter. Chips: emoji 15 px + name; table headings: emoji 16 px with the name as tooltip
and `aria-label`.

### 3.9 Checkbox fields

Single yes/no fields in forms (PTA, D) use a label above a 36×36 tick box (radius 8; checked:
`--accent` fill with a white ✓ 22 px; unchecked: white with `--border-strong`). A tooltip spells
out a short label ("D" = "Diagnostisch: telt niet mee voor rapport of SE").

### 3.10 Overview charts and tables (step 29)

Shared by the group, exam and PO overviews and the profile (boards 43-46). Mocks draw them in
HTML/CSS; the app may use Chart.js where it gives the same result.

- **Histogram:** the bins of `maatwerk-grades::histogram`, as the current program: step 1 starts
  at 0,5 (0,5-1,5 ... 9,5-10), step 0,5 at 1,0 (18 bins); labels "<1,5" ... "≤10,0". Bar colour =
  the grade colour of the bin centre; an empty bin is a 2 px line. The **count above every bar**
  (0 in `--muted`). A 2 px dashed `#E5736B` line at the 5,5 bin boundary. The "Stapgrootte:
  0,5 punten / 1 punt" toggle (default 0,5) only on an "Alle leerlingen" histogram; smaller
  cards use 1 point. Header: "gem. X ± SD · p% onvoldoende".
- **Boxplot:** a row per set (label 260 px): box Q1-Q3 in the type colour (tint fill, 2 px
  border; striped for a PO), median 3 px, whiskers to min and max, **every student a dot** (8 px,
  tooltip name and grade), dashed 5,5 line, axis 1-10 below, "mediaan X,X" right.
- **RTTI-verloop:** one point per test in date order (PO's skipped, with a note; diagnostic
  tests included), the test badges (2.5) on the x-axis, a y-axis 0/25/50/75/100%, lines dashed
  (5 5, 75% opacity), a dot per value and **its percentage always shown** in the line colour,
  right of the dot. Per test the four labels are sorted and pushed apart to at least 14 px (the
  stack moves up if it would cross the axis). Legend with the names of 2.6. The current test
  gets an accent-tint band where the chart sits in that test's overview.
- **RTTI card:** badge and title, four bars (2.6) with the percentage above, R/T1/T2/I below.
- **Observatie bars:** a row per observatie: icon, name, bar, "n (p%)"; alphabetical unless
  grouped by category.
- **Grade tooltip:** hovering a grade or score cell shows a tooltip under the cell (aligned left
  in the left columns, right in the right ones): a title (test or category and grade), a sub line
  (attempt, projectgroep, "diagnostisch, telt niet mee"), the observaties (icon and name) or
  "Geen observaties". Dark surface in the light theme, light in the dark theme. Cells with
  observaties get a 1 px dotted underline.
- **Resit dot:** the existing `.attempt-badge` (16 px accent circle, I or H), placed directly to
  the right of the grade pill **without moving the pill** (grades stay aligned); tooltip
  "Herkansing (poging 2)" / "Inhaal (poging 2)".
- **Group sections in a table:** a heading row per group (or klas, projectgroep); GEMIDDELDE and
  STANDAARDDEVIATIE rows **directly under each group's students**. A single sticky `tfoot` only
  when the table has one group (group overview).

## 4. Screens

### 4.1 Splash (F-06)

Full window `--bg`, wordmark (520 px wide, fades in 0.7 s), below it a 220×3 px indeterminate
progress bar in `--brand` and a status line (13, muted: "Gegevens laden…"); version at the bottom
(12, muted). Shown only while loading. It must paint before the JS bundle runs, so it lives as
inline SVG + CSS in `index.html` and is removed when the app is ready.

### 4.2 Login (V-04)

No accent yet, so `--brand` is the accent. Board 5 is clickable; follow it.

1. **Start:** wordmark (400 px), "Kies je vak", four vak tiles 200×200 (radius 20, white, 2 px
   `--border`) with the vak emoji (64 px, neutral) and name (18/600). A vak without users is
   disabled (opacity .45, "nog geen gebruikers", not clickable).
2. **Vak chosen:** the wordmark fades out and the small logo appears top left; the tiles move up
   (top 84) and shrink to 112×112; the chosen tile gets a `--brand` border, the others .7
   opacity; clicking the chosen tile again goes back. The users fade in group by group (stagger
   45 ms): DOCENTEN (round avatars), SECTIEVOORZITTER and BEHEER (rounded squares, radius 18).
   Avatars 80 px with the user's own 3 px ring colour; name below.
3. **User chosen (no overlay):** the other users, headings and tiles fade out; the chosen avatar
   flies from its place to a fixed spot (vertically centred, left edge at about 31% of the
   width), growing from 80 to 152 px (ring 5 px, light shadow). Then the PIN block slides in to
   its right: name (26/700), role · vak, the PIN field(s), and the buttons
   "← Andere gebruiker" (text, left) and "Inloggen" (primary, right). The PIN input keeps its
   current behaviour.
4. **First login:** two fields, "Nieuwe pincode" and "Herhaal pincode", a one-line explanation,
   and the button "Pincode opslaan en inloggen". The PIN area always reserves the height of two
   fields (168 px), so nothing shifts.
5. **"Andere gebruiker"** plays step 3 in reverse.

Durations: 0.5–0.6 s, `cubic-bezier(.2,.8,.2,1)`. Under `prefers-reduced-motion`, replace the
movement with a fade.

### 4.3 Leerlingen (F-07)

- Grid `repeat(auto-fill, minmax(300px, 1fr))`, gap 10, grouped by jaarlaag (heading) and class
  (13/600 muted subheading), as today. Search and filters keep working.
- **Card (variant C):** left name (600) and student number (12, muted); then one bar per test
  (7 px wide, height ∝ grade, grade bar colour, `title` with the grade); right the **year
  average** (17/700, grade colour) with the trend arrow, and below it "laatste X,X" (12).
- **Years 4–6:** the small line alternates between "laatste X,X" and "SE X,X": each visible
  ~3.8 s, 0.7 s cross-fade, cycle 9 s, all cards in sync. Hover shows both (`title`). Under
  reduced motion show "laatste X,X · SE X,X" on one line.
- No grades yet: "Nog geen cijfers" (italic, muted).
- **Admin** keeps the plain list (no grades), restyled with the new tokens.

### 4.4 Groepen (F-09)

- Grid `repeat(auto-fill, minmax(380px, 1fr))`, gap 12, per jaarlaag.
- **Card:** group name (18/700, accent text) + schoolsoort pill (vertically centred with the name),
  "<docent> · <n> leerlingen" (13, muted), student first names (13, muted, clamp 2 lines). Right:
  - lower school: "7,6 ± 1,4" (mean in grade colour, 17/700) and "14% onvoldoende" (12; danger
    colour from 20%);
  - upper school (**variant B**): "SE 6,2 ± 1,3 · R 6,6 ± 1,5" on one line, then the
    onvoldoende line.
- No trend per group.

### 4.5 Group overview modal (F-10, board 45)

Modal per 3.3, width 1120, fixed height. Header: group name, schoolsoort pill, "<docent> · <n>
leerlingen · klik een naam om het leerlingprofiel te openen". Tabs over the whole year, each
lazy-loaded with placeholders (3.4):

1. **Resultaten:** rows 30 px; columns per test grouped by PERIODE, then JAAR with "gem." (the
   weighted year average, as on the card and the rapport, decision 12) and "SE" (examendossier
   average; only for groups whose tests count for an examendossier). JAAR columns on `--foot`.
   Names as links with "· leerlingnummer" and the trend arrow. Grade pills; diagnostic tests
   grey italic and out of the averages. One column per original test with the attempt that
   counts and the resit dot (3.10). A PO cell is the student's PO grade; a student not in a
   projectgroep gets "—" with the tooltip "Niet ingedeeld in een projectgroep". Grade tooltip
   (3.10). Sticky `tfoot`: GEMIDDELDE (pills) and STANDAARDDEVIATIE ("± 1,3", muted).
2. **Cijferverdeling:** a card per test, three per row: badge and title, "gem. ... onvoldoende" on
   its own line, histogram with 1 point (3.10).
3. **Boxplot:** a row per test in its type colour, students as dots (3.10).
4. **RTTI-analyse:** RTTI-verloop over the year (3.10), then an RTTI card per test (PO's
   skipped), two per row.
5. **Observaties:** table: observatie (alphabetical; icon and name) × test and PO badges; cell
   "n (p%)" (students, percentage of the group) with an accent tint by intensity; empty when the
   observatie's toetstype does not fit the test; "—" for none. Last column Totaal: times given
   this year. PO observaties count every member of the projectgroep.

### 4.6 Exam overview modal (F-11, board 46)

Title "Overzicht: <toets>" with the test badge, subtitle "Jaarlaag <n> · <jaar>", summary line
"<n> leerlingen · ● 6,4 ± 1,4 · 30% onvoldoende". Tabs: Resultaten, Cijferverdeling, Boxplot
cijfers, Vraaganalyse, RTTI-analyse, Observaties.

1. **Resultaten:** one table with a sticky `thead`; a heading row per group ("Groep 5A · 12
   leerlingen"); columns Naam, Totaal ("34 / 50"), Cijfer, an icon column per linked observatie
   (3.8), R/T1/T2/I percentages. GEMIDDELDE and STANDAARDDEVIATIE under each group (3.10).
2. **Cijferverdeling:** "Alle leerlingen" with the Stapgrootte toggle, then a card per group,
   two per row (3.10).
3. **Boxplot cijfers:** rows Alle leerlingen and each group, students as dots (3.10).
4. **Vraaganalyse:** restyle only. Card "Score per vraag, alle leerlingen": a row per question
   (name, max points, bar in the question's RTTI colour, percentage). Card "Score per vraag, per
   groep": a thin bar per group under each question, group legend.
5. **RTTI-analyse:** RTTI cards for Alle leerlingen and each group (three per row), then the
   RTTI-verloop of the jaarlaag over this school year with this test highlighted (3.10).
6. **Observaties:** three cards. "Observaties, alle leerlingen": observatie bars (percentage of
   the students with a score). "Observaties per groep": a bar per group under each observatie,
   "n (p%)" of that group, group legend. "Observaties per cijfergroep": legend <4, 4-5, 5-6,
   6-7, 7-8, ≥8 (as `maatwerk-grades::grade_group`) with the group sizes, then a card per
   observatie (three per row) with a vertical histogram of the six grade groups, counts above,
   one shared scale; colours `#C62828 #E5736B #F2C94C #CFC255 #A6C266 #6DBE77`.

**Verzameloverzicht** (best attempt over the original and its resits): the same modal; Cijfer
shows the resit dot directly right of the grade, an empty column keeps space before the
observatie icons; Vraaganalyse, RTTI-analyse and Observaties are disabled with the existing
tooltip.

### 4.7 Toetsen (V-11, F-12, F-27; boards 55, 56)

Cards since step 33 (user, 2026-11-17); the list design of step 20 is replaced.

- **Header and filters:** title, "RTTI uitleg / leeradvies" (secondary), "+ PO toevoegen"
  (secondary), "+ Toets toevoegen" (primary), schooljaar select; the filter bar with the legend of
  the five test types on the right.
- **Grid:** a section per jaarlaag ("JAARLAAG 5", 12/700 accent), three cards per row, column gap
  36 px, row gap 16 px. The periodes of a jaarlaag continue in reading order (left to right, then
  down): a 20 px label row above every card shows "Periode N" on the first card of a periode; when
  that card is not in the first column, a 2 px `--border` divider stands in the middle of the gap
  to its left.
- **Card** (fixed height, 214 px in the mock; radius 12):
  - top: badge (2.5), title (15/650, accent text; diagnostic grey italic), ⋮. A click on the card
    opens the overview; "Overzicht openen" moves into the ⋮ menu.
  - middle left: kind pill ("Toets", "Praktische opdracht", "SE-toets", "SE praktische opdracht",
    "Diagnostisch"; an attempt adds its label pill and the lock pill); line 1 "48 punten · weging
    rapport 2 · SE 10" (no SE part without SE weging; diagnostic: "30 punten · telt niet mee");
    line 2 the points per RTTI category "R 12p · T1 14p · T2 13p · I 9p", the letters in the RTTI
    colours (2.6), the names in the tooltip. A PO has no line 2 (rubrics can have many
    categories).
  - middle right: a mini histogram (104 × 46) against the right edge, centred vertically between
    the top row and the bottom block: the bins of 3.10 with step 1, grade colours, the dashed 5,5
    line, the count per bin in the tooltip.
  - bottom left: "<n> leerlingen" (a Verzamelkaart: "beste poging · <n> leerlingen") and under it
    the three most given observaties (icon and count; tooltip with the name).
  - bottom right: the average ± SD (average 20 px in its grade colour) and under it
    "<p>% onvoldoende".
- **Attempts (stack):** a test with resits is a stack with the Verzamelkaart on top (its numbers
  over the best attempt per student).
  - Closed (default; open or closed remembered per session): the attempt cards, the same size as
    the Verzamelkaart, lie behind it, each 5 px further right and down, at 85%, 60% and 40%
    opacity. A pill "<N> pogingen ▾" sits on the bottom edge, right ("Inklappen ▴" when open).
  - Open: a tray row is inserted under the row of the stack. The attempts slide down out from
    under the Verzamelkaart while the tray grows and everything below moves down (400 ms); 200 ms
    after the start they spread to their columns (380 ms). Closing is the reverse (gather, then
    slide up under the Verzamelkaart after 220 ms). Cards left, right and above never move. With
    `prefers-reduced-motion` the states switch without transitions.
  - One outline around the Verzamelkaart and the tray: 2 px `--accent`, `--accent` tint fill,
    8 px outside the cards, radius 16 on every corner, the inner (concave) corners included; drawn
    as one shape so the lines join exactly. Tray title "Pogingen van <code> · de beste poging per
    leerling telt".
  - The tray is centred under the Verzamelkaart (two attempts spread evenly to the left and
    right) and shifted only to stay inside the grid; three attempts use the full width.
  - Attempt cards: the same card with the label pill (Origineel, Inhaal, Herkansing) and, for a
    resit, the lock pill "Observaties van 502" with the tooltip of step 20.

### 4.8 Opdrachten-editor (V-07, F-16, F-05, B-08, F-01)

- **Header** 52 px, `--surface`: "← Terug naar opdrachten" (text button, accent) | divider |
  title (16/700) with "Opdracht · <vak> · <schoolsoort> <jaarlagen>" (12, muted) | status pill |
  user avatar with photo or initials (B-08).
- **Status pill (F-05):** "Compileren…" with spinner (accent tint) while a compile runs;
  "Opgeslagen · PDF bijgewerkt" with a check (green tint) otherwise; errors in danger tint.
  `role="status"`.
- **Left pane:** formatting toolbar **on top** (wraps; groups separated by 1 px dividers; the math
  buttons collapse into "Wiskunde ▾", "Symbolen ▾", "Opmaak ▾" dropdowns), then the file tabs
  (opdracht.typ, main.typ, lib.typ), then the code.
- **Divider (F-16):** 10 px, grip 4×44, `cursor: col-resize`, drag between 25% and 75%,
  double-click resets to 50%, arrow keys move it by 2% (`role="separator"`). Remember the ratio
  per user.
- **Right pane:** own bar (zoom −/+ , percentage, Paginabreedte; the "Vragen" warning as an amber
  pill on the right), PDF below.
- **AI rail and assistant (F-01):** see 4.8.1. The provider buttons in boards 10 and 59-63 are
  monograms; use each provider's official logo per its brand guidelines.

#### 4.8.1 AI assistant (F-01, boards 59-63, design round 15)

Decisions 48-61 and 62-75 in `PLAN-2.md`. The boards use the mock's own colour values; the tokens of section 2 win (for example
`--border-strong` for inputs in the dark theme). Mock names that differ from the app: the boards say
`afbeeldingen/` and `maatwerk check`; the app uses `images/` and
`maatwerk-cli assignment check --json` (the UI text may still say "afbeeldingen").

- **Rail (board 59):** 60 px column at the far right, "AI" label, one 40 px button per CLI found
  on this computer (Claude Code, Codex, Gemini CLI, Mistral Vibe, Copilot CLI; mock monograms C,
  G, Ge, M, Co). None found: one dashed "?" button that opens the install help (board 62). The
  selected button has a 2 px ring in the provider colour; a dot top right marks a provider with
  an open conversation (accent while it runs). A click opens or switches the conversation (one
  per provider per opdracht); clicking the open one closes the panel.
- **Chat panel (380 px):** header: logo, name, "via de command line op deze computer", "+ Nieuw
  gesprek", gear (AI-instellingen, board 62), close. Messages: the teacher's in an accent-tint
  bubble (attachments as small chips under it), the AI's in `--surface-2`.
- **Empty chat:** "Waar kan <naam> mee helpen?", one line on the temp copy and the proposal, then
  the starter buttons (icon tile, label, one-line description): Fouten oplossen (danger tint,
  only when the opdracht has compile errors), Antwoorden en punten aanvullen, Herschrijven voor
  ander niveau, Nieuwe opgave toevoegen. A starter fills the input; it does not send.
- **Composer, top to bottom:** the image warning (amber, only while Afbeeldingen is on); the
  context chips; the attachment chips; inline attachment errors; the input row (paperclip,
  textarea, send); the footer line with a lock icon, always visible: "Alleen deze opdracht en de
  gekozen context worden verstuurd, via jouw eigen abonnement."
- **Context chips (board 60), 26 px pills:** Opdrachtinstructies AI, Opdrachtgegevens, Fouten &
  waarschuwingen, PDF-output, "Syllabus: <naam> ▾" (listbox: the PDFs of the syllabus folder,
  the one matching vak and schoolsoort preselected, "Geen" last, footer with the folder and
  "Map openen"), "Andere opdrachten (n) ▾" (popover: search, checkboxes, at most 3, the rest
  disabled at 3, "n van max. 3 gekozen", Klaar), Afbeeldingen. On: accent tint, accent border,
  check icon; off: outline, muted text, plus icon. Tooltips say what each sends. Remembered per
  user per opdracht, except Afbeeldingen: off by default, amber when on, switched off again after
  each message, with the warning "Afbeeldingen kunnen leerlingen tonen…".
- **Attachments:** paperclip, drop onto the panel (a dashed accent overlay inset 6 px: "Laat los
  om toe te voegen", accepted types, 25 MB, how many of the 10 are left), paste. A pasted image
  becomes an attachment; pasted text goes into the input, from 2.000 characters it becomes a
  "Geplakte tekst" attachment. Chips: icon, name, size, remove button. Errors per file in danger
  tint (too large, unsupported type); at 10 per chat the paperclip is disabled with a message.
- **While running:** a status card in the message list: spinner, the current step ("Leest
  syllabus…", "Controleert de opdracht… ronde 2", `role="status"`), elapsed / limit ("1:42 /
  5:00"), a chevron for the transcript, Stop (red square); a 3 px progress bar of the time limit
  underneath. One run per opdracht at a time: input, send and chips are disabled, the other
  conversations stay readable. The editor stays editable, with an accent-tint bar above the code:
  "<naam> werkt op een kopie. Je kunt gewoon verder typen; …". The header status pill shows
  "<naam> is bezig".
- **Transcript:** monospace card, "Transcript · <command>" with Kopiëren; one collapsible row per
  step (chevron, status dot: accent running, green done, red error or stopped; title; duration);
  the body shows tool calls, edits (`+` lines green) and check output (errors red). After the run
  a summary row ("Klaar in 2:31 · 6 stappen", "Gestopt na 1:42", …) opens the same transcript.
- **Result:** the AI's answer, then the diff card: "Voorstel · n wijzigingen · m bestanden"; one
  row per file with +/− counts and a pill ("n wijzigingen", "nieuw" for an image); `main.typ`
  and `lib.typ` struck through with "niet toegepast" and the line "main.typ: niet toegepast
  (alleen opdracht.typ en afbeeldingen)"; the diagnostics left after the proposal in an amber
  box; Bekijken (secondary) and Toepassen (primary). Toepassen applies every hunk that does not
  conflict plus the new images as one undo step, then the footer turns green: "Toegepast: …" with
  "Ongedaan maken".
- **Error and end states** (card under the user's message, `role="alert"`): not logged in
  (danger; "Open een terminal, start <command> en log in…"; Opnieuw proberen, Hulp bij
  inloggen); CLI error (danger; the last lines of output in monospace; Opnieuw proberen, Details
  kopiëren); time-out (amber; nothing changed; Opnieuw proberen, AI-instellingen); stopped by
  the teacher (neutral; "Wat de AI tot dan toe deed, is weggegooid"); no changes (the AI's answer,
  then a neutral card "Geen wijzigingen voorgesteld"). A stopped or timed-out run keeps nothing.
- **Voorstel bekijken (board 61):** dialog inset 24 px. Header: provider logo, "Voorstel van
  <naam>", time and whether the teacher edited since; "n van m gekozen · k conflict", Alles /
  Niets, Annuleren, "Toepassen (n)" (disabled at 0). Left (260 px, the editor's gutter tint): WORDT
  TOEGEPAST with `opdracht.typ` (tri-state checkbox) and its hunks as links with a state dot, the
  new image with its own checkbox; NIET TOEGEPAST card; NA TOEPASSEN card with the remaining
  diagnostics. Middle: column heads "HUIDIGE VERSIE (NU IN DE EDITOR)" and "VOORSTEL"; one card
  per hunk with a checkbox, title, line range and state ("Wordt toegepast", "Wordt niet
  toegepast" at 50% opacity); side-by-side monospace rows (deleted lines danger tint, added
  lines green tint, empty filler). A conflict hunk has an amber head, a disabled checkbox and the
  text "Conflict: je hebt deze regels aangepast terwijl de AI werkte. Deze wijziging wordt
  overgeslagen…". Then the image card (preview, which hunk uses it; a hunk that uses a deselected
  image renders a missing-image error) and the skipped files, collapsed, with "Toon voorstel".
  Right (380 px): PDF preview with Voorstel / Huidige versie tabs, following the current choice;
  new parts outlined in the accent with a "nieuw" label; "Pagina x van N".
- **AI-instellingen (board 62, gear):** dialog 780 px, per teacher on this computer: switch "AI-
  assistent tonen"; AI-PROGRAMMA'S OP DEZE COMPUTER with "Opnieuw zoeken", an accordion card per
  CLI found (logo, name, path; "standaard" or "aangepast"; open: Opdracht and Argumenten fields in
  monospace, "Maatwerk voegt zelf de vraag en de map met de kopie toe.", Standaard herstellen);
  "Niet gevonden: … · Installatiehulp"; Tijdslimiet (minuten, 1-30); Syllabusmap (fixed `syllabus/` folder next to the app, shown read-only with "Map openen"; the board's "Wijzigen…" is not built); footer "Gesprekken blijven op deze computer bij de opdracht.",
  Annuleren, Opslaan.
- **First-use notice (board 62):** modal, once per teacher: "Voordat je de AI-assistent
  gebruikt", the own-subscription paragraph, two cards WORDT VERSTUURD / WORDT NOOIT VERSTUURD,
  the amber image warning (photos in the opdracht, attachments and the PDF-output), the line that
  the AI never writes into the opdracht itself, "Begrepen".
- **Install help (board 62, the "?" button):** the panel "AI-assistent instellen": "Geen
  AI-programma gevonden", what Maatwerk needs, one card per CLI (logo, name, maker, install
  command with Kopiëren), a Node.js note; footer "AI-assistent verbergen" and "Opnieuw zoeken".
  The install commands are checked in the research sub-task.
- **Off by the school (board 62):** no rail, no AI option in Opdracht toevoegen, no "Laat AI dit
  oplossen". The only explanation is the user menu item "AI-instellingen…" with "Uitgeschakeld
  door je school". The switch itself is in Beheer › Instellingen (4.9).
- **Opdracht toevoegen (board 63):** below the fields a card with the switch "Eerste versie laten
  maken met AI" (accent border when on): textarea "Wat moet er in de opdracht staan?", select
  AI-programma (installed CLIs only), "De gegevens hierboven gaan als context mee. Dit wordt het
  eerste bericht in de chat."; the primary button becomes "Opslaan en AI starten". The editor
  opens with the chat open and the message already sent.
- **Opdrachten genereren, failed (board 63):** "x van y opdrachten gemaakt" with "n mislukt" and a
  green/red bar; MISLUKT, PER OPDRACHT: one card per opdracht with "voor n leerlingen" (never
  names), the error in monospace, "Laat AI dit oplossen" (primary, with the provider logo),
  "Openen in editor", "Melding kopiëren"; footer Sluiten, "Opnieuw genereren (n)". "Laat AI dit
  oplossen" opens the editor with the chat input prefilled with the Fouten oplossen text and the
  error as an attachment; the teacher sends it.

### 4.9 Beheer (admin)

- **Tab bar:** seven tabs with icons: Leerlingen (person), Groepen (people), Opdrachten (puzzle),
  Gebruikers (ID card), School (mortarboard), Gegevenscontrole (shield with tick), Instellingen
  (sliders). Admin avatar: rounded square with the red ring.
- **Leerlingen/Groepen/Opdrachten:** as for teachers, but students as a plain list (no grades).
- **Gebruikers:** sections BEHEERDER, ACTIEVE GEBRUIKERS (cards: 52 px avatar, name, vak, amber
  pill "Nog geen pincode"; actions in this order: "Pincode resetten" (only when a PIN exists),
  edit, deactivate), SECTIEVOORZITTERS (one card, a row per vak with emoji and a select).
- **Gebruiker bewerken (modal):** Voornaam / Tussenvoegsel / Achternaam; Afkorting + Kleur (12
  swatches, centred per 3.7); Schoolsoort and Vakken chips; Profielfoto with the crop (F-19):
  drag a square over any image, scroll to zoom, round preview in the ring colour, "Andere foto…",
  "Verwijderen".
- **School:** two-column card: logo panel left ("Logo wijzigen…"), fields with an edit button
  right (Naam, Ondertitel, Motto), Schoolsoorten chips, Watermerk with preview and
  "Watermerk wijzigen…" (inverted in the dark theme).
- **Gegevenscontrole:** explanation + "Opnieuw controleren". Clean: green card "Geen fouten of
  waarschuwingen" with count and time. Findings: one card each with a FOUT/WAARSCHUWING pill,
  message, path (monospace) and an action ("Map openen", "Vergelijken", "Toets openen").
- **Instellingen:** Snapshots card (four number fields with units: uur, dagen, weken, maanden),
  Editor card (time limit, seconden), "Aanwezige snapshots" card on the right with the kind
  (dagelijks/wekelijks/maandelijks) and "Map openen"; "Opslaan" top right of the screen. Below
  the Editor card an "AI-assistent" card (2 px accent border in board 62): switch "Docenten mogen
  de AI-assistent gebruiken", the explanation, an "Aan" / "Uit voor alle docenten" pill (step 32,
  user 2026-11-18: here, not on the School tab).

### 4.10 Scores invoeren (modal)

- Fixed-height modal (1320 px wide), content **centred** horizontally (tests with few questions
  look natural).
- Header row: title "Scores invoeren" + test badge + name; then **?** (help: shortcuts and
  explanation, on click or hover), undo, redo, ". → N" toggle, "Toets bewerken", N-term stepper,
  close.
- Grid as today, restyled: question headings show RTTI tag and max points; cells tinted by score
  (full `#DFF1E5`, partial `#FCF1CF`, zero `#FBE1DE`, N `#EEF0F3`); focused cell 2 px accent ring;
  observatie columns with emoji headings and checkboxes; Totaal "18 / 23"; Cijfer per 2.3 (grade
  cell); R%/T1%/T2%/I% tinted (≥80 green, ≥55 yellow, else red; "NVT" muted).
- Sticky: group heading ("<n> leerlingen · alle scores ingevuld"), column headings, and the # and
  Naam columns. Per group a GEMIDDELDE and STANDAARDDEVIATIE footer.
- Footer bar: colour legend and the save status ("● Alles opgeslagen"). No shortcut hints there.

### 4.11 Toets modals

- **Nieuwe toets:** steps "1 · Gegevens / 2 · Vragen". Row 1: Naam, PTA box, D box, Schooljaar.
  Schoolsoort chips. Then a 3-column grid: [Jaarlaag segmented + Periode segmented centred in the
  remaining space] Weging, Weging SE / [Opgave- en vraagstructuur] Aantal vragen, N-term. Weging SE
  only active with PTA; D sets Weging to 0 (disabled) and shows a grey note with the diagnostic
  badge.
- **Toets bewerken:** title with badge, "Toets bewerken · Jaarlaag 5 · Gymnasium · 2026-2027";
  one row: Naam (max 220 px), PTA, D, Periode, Weging, Weging SE, N-term. Question table with a
  sticky heading: Opgave (I…X), Vr., Max punten (0–10), B / D (Normaal/Bonus/Diagnostisch), RTTI,
  delete. Segmented buttons: light grey unselected, solid accent with white text selected.
  "+ Vraag toevoegen". Observaties as chips (emoji + name). Footer: "12 vragen · 41 punten ·
  R: 3 (7%) · T1: 21 (51%) · T2: 17 (41%) · I: 0 (0%)", Annuleren, Opslaan.
- **Nieuwe poging (inhaal/herkansing):** "van <badge> <name>"; Soort poging as three cards
  (Inhaal, Herkansing, Anders). Inhaal/Herkansing fill Beschrijving with INHAAL/HERKANSING and
  disable it; Anders makes it editable. Jaarlaag, periode, weging read-only from the original.
  Structure, aantal vragen, N-term. A lock block lists the observaties copied from the original
  (F-12).
- **PO modal:** separate, designed later.

### 4.12 Observatie and opdracht bewerken

- **Observatie:** two columns: form left (Icoon box 36 px next to Naam so the labels align,
  Korte uitleg, Leeradvies, Schoolsoort, Vakken, Jaarlagen), icon picker right (search,
  categories: Natuurkunde, Scheikunde, Biologie, Wiskunde, Leren & school, Fouten & aandacht;
  200+ emoji, F-15). Fixed height.
- **Opdracht:** Naam, Beschrijving, Schoolsoort, Vakken, Jaarlagen, Observaties (emoji chips);
  footer "Inhoud bewerken in de editor" (left), Annuleren, Opslaan.

- **Toetstype (F-23):** the observatie form gets TOETSTYPE chips "Toets" and "PO" (one or both,
  never none; new observaties default to Toets). Test screens list only Toets observaties, PO
  screens (rubric editor, PO grading) only PO; the Observaties tab gets a filter chip
  "Alle toetstypes / Toets / PO". Opdracht bewerken lists all.

### 4.13 Praktische opdrachten and rubrics (F-20, F-22)

Boards 16-18. Decisions: `PLAN-2.md` 16-25.

- **Tab bar:** a sixth teacher tab **Rubrics** between Toetsen and Observaties, icon a table
  (rounded rectangle with two horizontal lines and one vertical line). Not for the admin.
- **Rubrics screen:** title, "+ Rubric toevoegen", filters (schoolsoort, jaarlaag, vak). Cards
  (`minmax(420px, 1fr)`): name (link, accent), "Gymnasium · Natuurkunde · jaarlaag 4, 5, 6",
  category chips ("Theorie 8"; bonus chips tinted accent, diagnostic grey italic), "4
  categorieën · 17 punten · bonus 4", lock pill "In gebruik bij 2 PO's" (tooltip: max and soort
  locked). Actions: edit, Dupliceren, delete (disabled with tooltip while in use).
- **Rubric editor (dialog, 1180 × fixed height):** header row Naam, Schoolsoort chips, Vak,
  Jaarlagen, Totaal ("17 punten + 4 bonus"); when in use an amber pill "In gebruik bij n PO's:
  maxima en soort liggen vast" and those controls disabled. Body (`--surface` cards on a light
  ground), per category: drag handle, Naam, max (number), segmented Normaal / Bonus /
  Diagnostisch, delete; the **level display**: a number row with one box per score 0..max, then
  one bar per level spanning exactly its boxes (2 px inset, so 0–2 and 3–4 sit side by side
  without touching), labelled "range title"; scores not covered show red in the number row;
  then the level rows (min–max number fields, Titel optional, Uitleg; "+ Niveau (n van 5)"; the
  rule as a hint); category observaties (type PO) as chips with "+ Observatie". An error line
  per category in red ("Twee niveaus beginnen bij 2 · Niet gedekt: 3"); Opslaan disabled with a
  footer note while any category is invalid. Footer: general observaties (type PO).
- **Toetsen:** "+ PO toevoegen" (secondary) left of "+ Toets toevoegen". **PO card** as a test
  card: striped badge (SE: striped anti colour), kind pill, meta line ending in "9
  projectgroepen", the rubric line ("Rubric Onderzoeksverslag · 4 categorieën · 17 punten ·
  bonus 4") where a test shows its RTTI split, mean ± SD · % onvoldoende. Same ⋮ menu (Nieuwe
  poging = herkansing only).
- **PO toevoegen, step 1 "Gegevens":** exactly the Nieuwe toets layout (Naam, PTA, D,
  Schooljaar; Schoolsoort; the three-column grid Jaarlaag + Periode / Weging / Weging SE); the
  last row has the **Rubric** select in the first column (only matching rubrics) and the filter
  note in columns 2–3; no Aantal vragen, no N-term. Below: a preview card with the category chips
  and "Cijfer = 10 × punten ÷ 17, minimaal 1,0 en hoogstens 10,0. Bonuspunten tellen mee in de
  punten, niet in het maximum."
- **Step 2 "Projectgroepen" (dialog 1180 × fixed height):** left panel "Niet ingedeeld" (count,
  class filter chips, students with a class tag and "+"; clicking adds to the active
  projectgroep); right: "n projectgroepen · leerlingen uit verschillende klassen mogen samen",
  "Willekeurig indelen…", "+ Projectgroep"; projectgroep cards (3 columns; active one with a 2 px
  accent border): editable name, count "2 lln" / "1 ll", members with class tag and ×; empty
  card hint. Footer: "← Gegevens", the amber note "n leerlingen nog niet ingedeeld…", Annuleren,
  Opslaan.
- **Scores invoeren (PO):** as 4.10, but rows grouped by projectgroep (heading row with name,
  count, "Beoordelen" button and a status: Beoordeeld / Bezig / Nog niet beoordeeld); category
  columns with headings slanted at −55° ("Theorie (8)"; bonus in accent); then Punten ("13 /
  17"), Groep ±, Eigen ± (tooltip with the line names), Cijfer (grade cell). Read-only cells;
  double-click a row opens grading. Header: ?, "Projectgroepen", "PO bewerken", close. Footer
  hint "Scores per categorie wijzig je via Beoordelen…" and the save status.
- **Projectgroep beoordelen (dialog 1240 × fixed height):** title "<naam> beoordelen", members
  with classes, "● Automatisch opgeslagen · 14:32". Per category a card: name (+ BONUS pill),
  score "6 / 8"; the level cards side by side (range, optional title, explanation); every level
  whose interval contains the value is highlighted (accent border and tint, others 60 %
  opacity); a slider 0..max (step 1) with the numbers below; right column (300 px) the category
  observaties (toggle chips) and "Opmerking bij <categorie>". Then "Commentaar op het werk als
  geheel" and a two-column card: "Bonus / malus voor de hele projectgroep" (lines: Omschrijving,
  grade points, ×; "+ Regel") and "Bonus / malus per leerling". Sticky footer: general observaties
  (toggle chips), "Punten 14 / 17 → projectgroep 7,7", each member's grade on its grade colour,
  "← Vorige", "Volgende →", "Klaar". Autosave every 10 s and on closing.
- **PO rapport (boards 19, 20; decision 26):** the toets rapport's look (fonts, colours,
  footer, logo, italic section labels, zebra tables). Page 1: title "Beoordeling <vak>
  <PO-naam>", subtitle "<klas> — <naam> (<nr>)", one sentence with points, percentage, group
  grade and the final grade in bold; "Projectgroep <naam>" as one line of names with classes;
  Scoretabel per category (Categorie, B / D, Jij (●), lollipop on one scale, Gemiddeld (◇) over
  the PO), no Totaal row (user, 2026-11-12); "Bonus / malus" (Voor, Omschrijving, Cijfer); "Opmerking van de
  docent". Then "Beoordeling per categorie": per category a heading with score and the level
  cards side by side (achieved levels outlined in blue), "Opmerking:", and per observatie the
  icon, **name** — short description, "Leeradvies:" on the next line; "Algemene observaties"
  last. No RTTI parts, no grade histogram; duplex as the toets rapport.

### 4.14 PO overview modal (F-24, board 43)

Opened from "Overzicht openen" on a PO card (enabled now). Header: striped PO badge, PO name, kind
pill ("SE · praktische opdracht"), subtitle "<jaarlaag> · <jaar> · rubric <naam> · <n>
categorieën · <max> punten · bonus <b> · <n> projectgroepen · <n> leerlingen". Tabs:
Resultaten, Cijferverdeling, Boxplot, Categorieën, Observaties.

1. **Resultaten:** segmented control "Per klas" (default) / "Per projectgroep".
   - Per klas: a section per klas, students alphabetical; label column Projectgroep (chip; a
     dashed "niet ingedeeld" chip for a student without one).
   - Per projectgroep: a section per projectgroep (heading: projectgroepcijfer, the group's
     bonus/malus lines, number of members), label column Klas; last "Niet ingedeeld · geen
     cijfer, geen rapport".
   - Columns: Naam, label, one per category (name, "/ max", B or D tag; diagnostic scores italic
     and muted), Punten "/ max", Bonus / malus (group and own lines summed, signed), Cijfer pill.
   - Grade tooltip (3.10). On a category score: "<categorie>: s / max", "Niveau <range title> ·
     projectgroep <naam>" and that category's observaties. On Punten, Bonus / malus and Cijfer:
     the grade build-up (projectgroepcijfer, group and personal lines) and all the student's
     observaties (category observaties prefixed with the category name).
   - GEMIDDELDE and STANDAARDDEVIATIE per section (3.10); none for "Niet ingedeeld".
2. **Cijferverdeling:** final grades only; "Alle leerlingen" with the Stapgrootte toggle, then a
   card per klas (3.10).
3. **Boxplot:** final grades; rows Alle leerlingen and each klas, students as dots (3.10).
4. **Categorieën:** a line "<n> ingedeelde leerlingen; bij overlappende niveaus telt een leerling
   twee keer", then a table: Categorie (name, pill "bonus" or "diagnostisch · telt niet mee"),
   Gem. "s / max", "Van het maximum" (bar and percentage), "Leerlingen per niveau" (a stacked bar
   with a segment per level and its count, accent shades from light to dark, grey shades for a
   diagnostic category; a legend "range title count"). Footer TOTAAL PUNTEN "gem / max · % ·
   incl. bonus, excl. diagnostisch". Only placed students count.
5. **Observaties:** a card per category, then "Algemene observaties"; a row per observatie: icon,
   name, bar (percentage of the placed students), "n (p%)", "<k> van <m> groepen". Every member
   of a projectgroep counts.

### 4.15 Student profile (F-25, board 44)

Restyle on the dialog component with the same content and tabs (Cijferverloop, Analyse); tinted
body; footer "← Vorige (<naam>)" and "Volgende (<naam>) →". Header: name, stamklas pill,
"<leerlingnummer> · ...".

1. **Cijferverloop**
   - Card "Cijferverloop" (Onderbouw / Bovenbouw): a **bar chart**, one bar per test, grouped
     per school year (year label and divider); bar in the test type colour (PO striped,
     diagnostic grey with a border), the grade above the bar in the grade colour, badges under
     the axis, gridlines 2-10 and a dashed 5,5 line. **No toetsgemiddelde.** Hover: badge and
     title, "Cijfer x"; for a PO also "projectgroep <naam> <cijfer> · persoonlijk ±x" and the
     category scores; for a diagnostic test "telt niet mee".
   - Card "Ten opzichte van het toetsgemiddelde" (school-year toggle): a row per test: badge and
     title; a 1-10 track with a grey **±1 SD band** around the test average (◇), the student's
     dot in the grade colour and a green or red line between them; text "7,7 vs 7,3 ± 0,9 +0,4".
   - Card "Gemiddeld cijfer per jaar, ten opzichte van de jaarlaag": the same per school year,
     against the jaarlaag average ± SD.
2. **Analyse:** "RTTI-scores per toets" (school-year toggle and Examendossier): an RTTI card per
   test (PO's left out, with a note) and a "Gemiddeld <jaar>" card with an accent border;
   "Observaties per schooljaar": table observatie × schooljaar with heat cells "n×" and Totaal.

### 4.16 Observaties as cards (F-28, board 57)

- **Header and filters:** title, "+ Observatie toevoegen" (primary); filter chips Alle toetstypes,
  Alle schoolsoorten, Alle jaarlagen, Alle observaties; the number of observaties on the right.
- **Grid:** three cards per row, gaps as Toetsen (row 16 px, column 36 px), alphabetical.
- **Card** (fixed height, 210 px in the mock; radius 12):
  - top: a 42 px tile (`--surface-2`, radius 10) with the emoji (22 px); the name (15/650,
    accent text, at most two lines); ⋮ with Bewerken and Verwijderen (disabled with the reason
    when the observatie is used in a test, as today).
  - the toetstype pills: "Toets" (accent tint) and/or "PO" (striped, as the PO badge).
  - the description (13, muted), at most three lines.
  - bottom row (top border): the schoolsoort pill; the jaarlagen as six 20 px boxes 1-6, the
    active ones in accent tint; right "<n> toetsen · <m> opdrachten" (tests of the active school
    year that link it; opdrachten linked to it; tooltip with the opdracht names), "nog niet
    gebruikt" when unused.
  - a click on the card opens Observatie bewerken (spec 4.12).

### 4.17 Opdrachten as cards with a preview (F-28, board 58)

- **Header and filters:** title, "+ Opdracht toevoegen" (primary); filter chips Alle
  schoolsoorten, Alle jaarlagen, Alle observaties; the number of opdrachten on the right.
- **Grid:** three cards per row as Toetsen. **Card** (fixed height, 196 px in the mock): the name
  (15/650, accent text), ⋮ (Openen in de editor, Bewerken, Kopiëren, Verwijderen); the
  description (at most three lines); "<schoolsoort> · <vakken>"; bottom row: the jaarlagen
  boxes (as 4.16) and the linked observatie icons on the right (tooltip with the names).
- **Preview:** a click on a card opens a preview of the opdracht:
  - the cards move to the left half in two narrower columns (description at most two lines);
    left, top and width animate (350 ms, ease-out); the selected card gets a 2 px accent border.
  - a panel slides in on the right half (from 60 px to the right, fading in): header with the
    name (17/700, accent), "<schoolsoort> · <vakken> · jaarlagen ... · <N> pagina's",
    "Kopiëren" (secondary), "Openen in editor" (primary) and ✕; the body (`--surface-2`) shows
    the rendered pages (Typst, the same render as the editor preview of step 31), page 1 first,
    scrolling for the rest; footer "Pagina x van N".
  - the panel stays in view while the list scrolls; clicking another card switches the preview
    in place; the selected card again, ✕ or Escape closes it and the cards move back.
  - rendering happens on demand (`spawn_blocking`), cached per opdracht until it changes, with a
    page-sized placeholder (3.4) meanwhile; a render error shows the message in the panel.
  - with `prefers-reduced-motion` the layout switches without transitions.

## 5. Logo (V-12)

- **Icon:** unchanged (`assets/maatwerk-icon.svg`, traced from `icon.ico`); dark variant with a
  light outline (`maatwerk-icon-dark.svg`).
- **Wordmark:** the icon's M and W, with "AAT" and "ERK" in Archivo Black small caps (70% of the
  M's height); "ERK" slanted 20°, the same angle as the sides of Archivo Black's A, set against
  the W's tail. `maatwerk-wordmark.svg` / `-dark.svg` (outlines; no font needed).
- **Tab bar:** `maatwerk-tabbalk.svg` / `-dark.svg`: "MAATWERK" with only the M full size.
- If the app ever sets this text live, Archivo Black is OFL (allowed); bundle it, do not load it
  from Google Fonts (CSP).

## 6. Accessibility and motion

- Text contrast ≥ 4.5:1 in both themes (the token pairs above pass); never colour alone: trend
  arrows have labels, test types have the kind pill, grade pills have numbers.
- Every animation has a `prefers-reduced-motion` fallback (fade or none).
- Real `<button>`s and `<a>`s; icon-only buttons have `aria-label`; tabs use `role="tab"`;
  the divider is keyboard-operable.
