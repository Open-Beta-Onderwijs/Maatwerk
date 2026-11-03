# Manual test results: Step 10 (`v0.3.1-13-g4466a7f`)

Run by the user on 2026-11-03 on a copy of real data, against `docs/manual-test.md` as of
`step-10`. Results and the user's comments (in `{…}`) are kept verbatim; the follow-ups are in
the section "Follow-ups" at the end, `ROADMAP.md` section 4 and `docs/backlog.md` ("From the Step
10 manual test").

## Start (M-START)

- [ pass ] **M-START-1** The window is titled "Maatwerk", 1280x800, no menu bar, Maatwerk icon in the
  taskbar. It cannot be made smaller than 900x600.
- [ pass ] **M-START-2** The startup screen shows the subjects; after picking one, the teachers of that
  subject and the admin badge (with photos). Picking a teacher opens Leerlingen with the
  last-used year.
- [ pass ] **M-START-3** Unusable data folder: point `MAATWERK_DATA_DIR` at a copy whose
  `config.json` has `"schema_version": 99`. Expect the screen "Maatwerk kan de gegevensmap
  niet openen" with "nieuwere versie van Maatwerk (schemaversie 99)", the folder, and
  "Opnieuw proberen". Fix the file, click the button: the app restarts and opens normally.
  Same with a folder on a disconnected drive (I/O advice about OneDrive).
- [ pass ] **M-START-4** No WebView2 (simulated), on the **release** exe:

      ```powershell
      $env:WEBVIEW2_BROWSER_EXECUTABLE_FOLDER = 'C:\bestaat-niet'; .\maatwerk.exe
      ```

      Expect exactly one Windows message box, "Maatwerk kan niet starten", with WebView2 install
      advice and a technical line (no English Tauri box first); no silent exit. The log file of
      that day has a "cannot start" line.

- [ pass ] **M-START-5** Start without internet (Wi-Fi off): everything below still works (no CDN).
- [ pass ] **M-START-6** "Over Maatwerk" (startup screen, bottom left; after login: the title "Maatwerk"
  in the top bar) shows the version, a build such as `v0.2.0-parity-…`, the copyright line, the
  AGPL notice and the source link. "Licentietekst" and "Licenties van derden" show the texts.
  `LICENSE` and `THIRD_PARTY_NOTICES.txt` come with the CI artifact.
- [ pass ] **M-START-7** The release exe's windows ignore a dropped file (no navigation), and selected
  text in the editor can be dragged to another place (`M-OPD-6`).

## Leerlingen (M-LEER)

- [ pass ] **M-LEER-1** Year selector "Schooljaar:" switches the list; an empty year shows the "Voeg
  leerlingen toe of kies een ander schooljaar" hint.
- [ pass ] **M-LEER-2** "+ Leerling toevoegen", edit (pencil), delete (bin, with confirmation;
  blocked when the student has data). Changes survive a restart.
- [ pass ] **M-LEER-3** "↑ CSV importeren" with a real export: same students as in the old app,
  accents and names with a tussenvoegsel intact.
  {This works, but I would like to add to the backlog that this screen needs updating. I want to see an example CSV file (of 5 rows or so) of how the CSV should look.}
- [ pass ] **M-LEER-4** Student name opens the profile: tabs "Cijferverloop" and "Analyse", year
  buttons, "Onderbouw"/"Bovenbouw", "Examendossier". Charts look as in the old app.

## Groepen (M-GRP)

- [ pass ] **M-GRP-1** "+ Groep toevoegen" with jaarlaag, schoolsoort, vak and teacher chips; edit;
  "Groep verwijderen".
- [ pass ] **M-GRP-2** Group name opens its students: "Alles"/"Niets", toggling membership saves.
- [ pass ] **M-GRP-3** Group CSV and group assignment CSV import ("Importeren") with a real file.
  {Same remark as for the student CSV import.}

## Toetsen (M-TOE)

- [ pass ] **M-TOE-1** "+ Toets toevoegen": step 1 and step 2 ("+ Vraag toevoegen", RTTI category
  buttons, "✕"), "Opslaan". Edit and delete an exam ("Toets verwijderen" is blocked with
  resits).
- [ pass ] **M-TOE-2** "Scores invoeren": typing, arrows, undo/redo "↶ ↷", paste a range from Excel,
  "Berekend cijfer herstellen". Grades equal the old app's for the same scores (compare a
  few students, decimal comma).
- [ pass ] **M-TOE-3** "Overzicht openen": tabs "Resultaten", "Cijferverdeling", "Boxplot cijfers",
  "Vraaganalyse", "RTTI-analyse", "Observaties"; "0,5 punten"/"1 punt".
- [ pass ] **M-TOE-4** "Inhaal / herkansing toevoegen" and "Verzamelkaart bewerken": best attempt
  and history as in the old app.
- [ pass ] **M-TOE-5** "Rapport genereren" on a real class: the PDF viewer shows every page; zoom,
  zoom list, Ctrl+scroll, previous/next page. Compare a few pages with the old app's rapport
  (logo, watermark, emoji medals, leeradvies text). Edit the RTTI uitleg/leeradvies texts
  ("Kopiëren naar…", "Opslaan"); unsaved changes ask "Blijven bewerken"/"Toch sluiten".
- [ pass ] **M-TOE-6** "Afdrukken" in the rapport viewer: a copy appears in
  `data\rapporten\<schooljaar>\` named `<YYYY-MM-DD HHmm> Rapport <vak> <groep> <toets>.pdf`
  and opens in the default PDF app. A second print in the same minute gets ` (2)`.
  {I would like these reports to go not inside the data folder, but next to it, in a folder 'rapporten'. Add this to the backlog.}
- [ pass ] **M-TOE-7** "Opdrachten genereren": cut-offs, "Alles aan"/"Alles uit", "Antwoordsleutel",
  "Genereren" shows progress and then the merged PDF; "Afdrukken" copies and opens it
  (name has `Opdrachten`, or `Antwoordsleutel` for the key). With duplex, every student starts on an odd page.

## Observaties (M-OBS)

- [ pass ] **M-OBS-1** "+ Observatie toevoegen", edit, delete (with confirmation); filters by
  schoolsoort, vak, jaarlaag.

## Opdrachten and the editor (M-OPD)

- [ pass ] **M-OPD-1** "+ Opdracht toevoegen" creates the opdracht and its `.typ` file
  (`opdrachten\<id>.typ`, from the base template). "Kopiëren" copies text and images
  ("Opdracht gekopieerd als …"); delete removes its images folder.
- [ pass ] **M-OPD-2** Opening an opdracht shows the editor with the preview. Typing updates the
  preview; toolbar buttons insert their markup; Ctrl+scroll zooms the preview. A Typst
  error shows the message with line and column.
- [ pass ] **M-OPD-3** Autosave: type, wait a second, close with "Maatwerk": reopening shows the edit.
  Close right after typing: the last edit is kept too.
- [ pass ] **M-OPD-4** "Figuur toevoegen" -> "📂 Van schijf kiezen…": the Windows file dialog shows
  image types; pick a PNG, a JPG with an accented name (`één foto.jpg`) and an SVG. Name
  form with "afbeelding-N", "Invoegen"; the same name again offers "Overschrijven". The
  image shows in the preview and in `opdrachten\images\<id>\`. An image of 10+ MB (phone
  photo) still works.
- [ pass ] **M-OPD-5** "📋 Plakken van klembord" and Ctrl+V in the text after copying a screenshot
  (Win+Shift+S) and after copying an image in a browser: a PNG is saved and inserted. With
  text on the clipboard: a clear message, no crash.
- [ pass ] **M-OPD-6** Drop an image file on the editor: nothing happens (the old app replaced the
  window with the file, quirk U20). Select text in the editor and drag it to another place:
  it moves.
- [ pass ] **M-OPD-7** Editor help (Step 8b): typing `#tab` offers `table` (Enter inserts it with the
  cursor between the brackets); Ctrl+Space anywhere offers completions; hovering `#figure`
  shows its description; Ctrl+click (or F12) on a name defined with `#let` selects its
  definition, also in `lib.typ` (e.g. on `vraag`).
- [ pass ] **M-OPD-8** Preview sync: moving the cursor to a paragraph further down scrolls the preview
  there and marks the line briefly; clicking text in the preview puts the cursor on it (text
  from the header switches to `main.typ`). Works after an error is fixed; while there is an
  error, a click does nothing.
  {please record in the backlog to make this scrolling smooth, not instant, to make it less jarring. It works, but it can be a bit nicer.}
- [ fail ] **M-OPD-9** Tabs `main.typ` / `lib.typ`: the yellow warning shows; "Bekijk verschillen"
  lists your changes against the standard version; "Herstel standaardversie" asks first,
  replaces the text and the file, and Ctrl+Z brings your version back (saved again). An
  opdracht folder with an unchanged `lib.typ` from an older Maatwerk is updated silently when
  the editor opens; a changed older one shows "Er is een nieuwere versie van lib.typ".
  {The 'herstel standaardversie' shows, but not the 'bekijk verschillen'. Clicking 'herstel' also does not show a prompt first that asks the user if he is sure. This is not a breaking problem for now, record it to the backlog.}
- [ pass ] **M-OPD-10** "Vragen: n · p" in the preview bar: the list shows every vraag as on the
  answer key (1, 2a, 2b), its punten and answer, and the total; clicking a row scrolls the
  preview to it. An opdracht without vragen, a vraag without punten or answer, or a vraag
  outside an `#opgave` shows a warning in the list.
- [ pass ] **M-OPD-11** Time limit: as admin set Instellingen > Editor to 2 seconds, open an opdracht
  and add `#for i in range(50000000) { }`: after about 2 s the editor says "Het compileren
  duurde langer dan 2 seconden …", the preview stays; remove the line: the preview updates
  again. Set the limit back to 30.
  {There is not really a visual hint that the program is still compiling the document. Please add to the backlog to add a spinner somewhere or something. We'll decide later how to solve that.}

## Gebruikers and School (admin) (M-ADM)

- [ pass ] **M-ADM-1** "+ Gebruiker toevoegen" with a JPG/PNG photo, edit, "Gebruiker
  deactiveren"/"activeren"; the startup screen follows.
  {Photo works, but is shown inconsistently through the app. Add to the backlog to check this please.}
- [ pass ] **M-ADM-2** School: edit naam/ondertitel/motto, schoolsoort buttons, logo (PNG/JPG/SVG)
  and watermark (SVG). A `.bmp` logo gets "Bestandstype .bmp wordt niet ondersteund". The
  rapport (M-TOE-5) shows the new logo and watermark.

## Accounts, roles, snapshots (Step 7b: M-PIN, M-VZ, M-SNAP)

- [ pass ] **M-PIN-1** First login of a teacher: "Welkom, …", choose a PIN. `1234` and two different
  PINs are refused with a Dutch message. After that the next login asks the PIN.
- [ pass ] **M-PIN-2** Wrong PIN twice: "Onjuiste pincode. Probeer het over 2 seconden opnieuw.", the
  button is grey meanwhile; the waits grow (4, 8, … s, at most a minute). Another teacher can
  log in at once. A restart clears the waits.
- [ pass ] **M-PIN-3** The admin's first login shows ten recovery codes. "Verder" stays grey until "Ik
  heb de codes bewaard" is ticked. "Afdrukken" prints only the codes; "Opslaan als…" writes
  a `.txt`. `gebruikers dmin.json` holds `pinHash` and `recoveryCodeHashes` (`$argon2id$…`),
  never the PIN or a code.
- [ pass ] **M-PIN-4** Admin: "Pincode vergeten?" with a code (dash and case do not matter) and a new
  PIN logs in. The same code a second time: "Onjuiste herstelcode." Badge (top right) >
  "Nieuwe herstelcodes" asks the PIN and shows ten new codes; the old ones no longer work.
- [ pass ] **M-PIN-5** Badge (top right) > "Pincode wijzigen" (current PIN, new twice); "Uitloggen"
  goes back to the login screen.
- [ pass ] **M-PIN-6** Admin > Gebruikers > "Pincode resetten" on a teacher: that teacher chooses a new
  PIN at the next login; the card says "Nog geen pincode". On a second PC the teacher's open
  login dialog still accepts the old PIN only until the reset has synced.
- [ pass ] **M-PIN-7** Lost everything: `maatwerk-cli admin reset-pin <copy>\data`; the admin chooses
  a new PIN and gets new codes.
- [ pass ] **M-VZ-1** Admin > Gebruikers > Sectievoorzitters: pick a nat teacher. On the login screen
  (vak Natuurkunde) a square "Sectievoorzitter" badge appears after the teachers; other vakken
  show none. It asks that teacher's PIN; the top-bar badge is square.
- [ pass ] **M-VZ-2** As sectievoorzitter, Groepen shows a pen on the nat groups only: name, jaarlaag,
  schoolsoort and vak are grey; students in/out and Docent(en) can change; no delete, no new
  group. The saved group's `_meta.updatedBy` is the teacher. Logged in through the teacher's
  own badge: no pen.
- [ pass ] **M-SNAP-1** Start the app on a test copy: within a minute `data\snapshots\<datum tijd>.zip`
  appears (the log says `snapshot: Written`); a second start the same day writes none.
  Instellingen lists it. Two PCs starting together write one zip.
- [ pass ] **M-SNAP-2** Instellingen: interval 1 hour, daily 2, weekly 0, monthly 0, "Opslaan"; with
  older zips copied in (rename them to older dates), the next due start keeps the newest two
  days only.
- [ pass ] **M-SNAP-3** Edit a user file by hand, Gegevenscontrole > "Herstellen uit snapshot": the
  dialog names the snapshot date; afterwards the file is as in the zip and the line is gone.
- [ pass ] **M-SNAP-4** Measure on the real copy: zip size and time (log line), and the size of
  `fotos\`, to decide whether photos go into snapshots (PLAN Step 7b).
- [ pass ] **M-PERF-1** Speed on the real copy (Step 7c, budget < 100 ms). In a dev checkout run
  `node tools/perf/measure.mjs --data <copy>\data --subject <vak> --user <id> --pin <PIN>`
  with a teacher of the copy (without `--user` it takes the first teacher; one without a PIN
  gets `12345` on the copy), and once more as the admin with
  `--admin 1 --tabs leerlingen,groepen,gebruikers --exams 0`. It logs in through the UI and
  prints the times: add them to `docs/perf.md` without names. By hand: switching tabs back
  and forth shows the list at once; "Scores invoeren" shows the first group at once, the
  others follow within a second.
- [ pass ] **M-PERF-2** After a colleague's change (second PC) to a student, group or score, the
  changed tab shows it when you come back to it; a filter change on one tab applies on the
  others too.

## Two teachers at once (M-SYNC)

Run two copies on two machines (or two Windows accounts) on the **same** test folder, synced
through OneDrive or a network share.

- [ pass ] **M-SYNC-1** Presence: teacher B sees A's badge (green when active, orange when idle) on the
  exam card ("<naam> werkt hierin") and in the score grid ("heeft dit scorescherm open", or
  "heeft de afgelopen 2 minuten scores ingevoerd"); closing A's window marks A offline
  shortly after.
- [ pass ] **M-SYNC-2** A enters scores; B's open score grid updates the row and flashes it. A adds an
  exam; B gets the toast "Nieuwe toets toegevoegd".
- [ pass ] **M-SYNC-3** Both edit the same student/group/exam modal: the second save shows "gewijzigd
  door … wordt opnieuw geladen" or "Niet opgeslagen: dit is intussen … gewijzigd", never a
  silent overwrite.
- [ pass ] **M-SYNC-4** Switching the year in one app: changes in that year from the other app arrive.
- [ pass ] **M-SYNC-5** Both open the same opdracht in the editor; A types and waits for "Opgeslagen",
  then B types: B sees "Intussen gewijzigd door een collega" and A's text is not overwritten.
  "Hun versie laden" shows A's text; "Mijn versie bewaren als kopie" makes "<naam> (kopie)"
  with B's text (C17).
- [ pass ] **M-SYNC-6** Two admins edit the same user (Gebruikers) or the same school field: the second
  save is refused with "intussen … gewijzigd" (C16).

## Data format v2 (M-MIG)

- [ pass ] **M-MIG-1** Start the exe on a copy of the old app's folder: "Deze gegevensmap moet eenmalig
  worden omgezet". "Omzetten" stays grey until the box is ticked. After converting: the
  report "Verslag van het omzetten" with the backup path
  (`%LOCALAPPDATA%\nl.openbetaonderwijs.maatwerk\backups\`), every migration warning and
  every error/warning of the check (file and message, errors first), and the path of
  `<backup> verslag.txt` next to the zip (the same report plus the list of changes); "Maatwerk starten" opens the app with all students, exams, scores, opdrachten and
  RTTI texts as in the old app (spot-check a few grades and one rapport against the old app's
  PDF).
- [ pass ] **M-MIG-2** The backup zip opens in Explorer and holds the whole old `data\` folder.
- [ pass ] **M-MIG-3** `maatwerk-cli migrate <copy>\data --dry-run` lists what would change and changes
  nothing; `--apply --backup-dir <folder inside OneDrive>` is refused.
- [ pass ] **M-MIG-4** Admin tab "Gegevenscontrole" lists the check. Edit a group file by hand
  (Notepad): after "Opnieuw controleren" it shows "Buiten Maatwerk gewijzigd"; "Accepteren"
  removes the line. At the next admin login a notice says so before you look.
- [ pass ] **M-MIG-5** Put a copy of a group file next to it as `<naam> (1).json`: the check lists it as
  "OneDrive-conflictkopie".

## Shutdown (M-END)

- [ pass ] **M-END-1** Closing the window ends the process (Task Manager) and marks the teacher offline
  for colleagues.
- [ pass ] **M-END-2** Render outputs go to
  `%LOCALAPPDATA%\nl.openbetaonderwijs.maatwerk\output\<pid>\` (one folder per run);
  folders of earlier runs disappear after a day. Printed copies in `rapporten\` stay.

## Follow-ups (2026-11-03, `fix/manual-test-10`, 0.3.2)

The item texts above are partly those of the Step 6 checklist (for example M-TOE-6 still says
`data\rapporten\`, M-ADM-1 lacks the photo check) and the comments on M-LEER-3, M-GRP-3, M-TOE-6
and M-ADM-1 are the Step 6 comments word for word. Each one is answered below.

| Item        | Comment                                        | Follow-up                                                                                                                                                                                                                                              |
| ----------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M-LEER-3    | Show a 5-row example CSV                       | Already `ROADMAP.md` F-02 (moved from Step 10 to phase 2 on 2026-11-03).                                                                                                                                                                               |
| M-GRP-3     | Same for the group CSV imports                 | F-02 covers the student, group and group assignment imports.                                                                                                                                                                                           |
| M-TOE-6     | Printed copies next to the data folder         | Done in Step 7a (C18): printed copies go to `<parent of data>\rapporten\<schooljaar>\` and the migration moved the old ones. The current checklist says so; re-check against it. A copy in `data\rapporten\` would be a bug: please report it.         |
| M-OPD-8     | Scroll the preview smoothly                    | `ROADMAP.md` V-03.                                                                                                                                                                                                                                     |
| **M-OPD-9** | **Fail:** no "Bekijk verschillen", no question | **Fixed** in 0.3.2 (below). Re-check by hand on the new exe.                                                                                                                                                                                           |
| M-OPD-11    | No sign that a compile is still running        | `ROADMAP.md` F-05; how to show it is decided later.                                                                                                                                                                                                    |
| M-ADM-1     | Photos shown inconsistently                    | Step 7b made the login badge, top-bar badge and Gebruikers card use one helper (`ui/src/utils/badges.js`); group cards show names only. `ROADMAP.md` B-04 keeps a re-check: please note where a photo still looks different (screen and what differs). |

### M-OPD-9: cause and fix

- **No question before "Herstel standaardversie".** The editor asked with `window.confirm`. In
  the Tauri app `tauri-plugin-dialog` replaces `window.confirm` with an async function, which
  returns a Promise; `!window.confirm(...)` is then always false, so the restore went ahead
  without asking. The same bug hit "Toch sluiten?" when the last save had failed: the editor
  closed and the unsaved edit was lost. The browser mock used by the e2e tests has the native
  synchronous `confirm`, so the tests (which accepted a native dialog) passed. Both questions now
  use the app's own dialog through the parent window (`maatwerk-confirm`; review 8b m6 had
  proposed this). ESLint now forbids `window.alert/confirm/prompt` in `ui/src`, and the e2e
  tests emulate Tauri's async `confirm`.
- **No "Bekijk verschillen".** The button only showed when the copy was already outdated or
  changed when the editor opened (status from `projectFilesStatus`). A current `lib.typ`, or one
  edited in this session, had no button. It now shows for every existing `main.typ`/`lib.typ`;
  the diff uses the editor text and says "Geen verschillen" when the copy equals the standard
  version.

### Found while retesting: no school year selected after a restart

M-OPD-9 passed on the 0.3.2 exe. The user then saw that after reopening the app no Schooljaar
was selected on any tab ("— kies schooljaar —"). Cause: the reference never writes `activeYear`
and falls back to the current school year when `config.json` is missing; since Step 7a the
migration and the first-run setup write `config.json` with only `schema_version`, so the
fallback no longer applied. The first session after migrating still worked because the Store
had cached "no `config.json`" before the migration wrote it. Fixed in the Store (missing key
falls back too); nothing is written to the data.
