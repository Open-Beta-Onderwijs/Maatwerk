# Manual test results: Step 6 (`v0.2.0-parity`)

Run by the user on 2026-10-30 on a copy of real data, against `docs/manual-test.md` as of
`step-06`. Results and the user's comments (in `{…}`) are kept verbatim; follow-ups are in
`PLAN.md` (Steps 7, 8, 10) and `docs/backlog.md` ("From the Step 6 manual test").

## Start (M-START)

- [ pass ] **M-START-1** The window is titled "Maatwerk", 1280x800, no menu bar, Maatwerk icon in the
  taskbar. It cannot be made smaller than 900x600.
- [ pass ] **M-START-2** The startup screen shows the subjects; after picking one, the teachers of that
  subject and the admin badge (with photos). Picking a teacher opens Leerlingen with the
  last-used year.
- [ ??? ] **M-START-3** Unusable data folder: point `MAATWERK_DATA_DIR` at a copy whose
  `config.json` has `"schema_version": 99`. Expect the screen "Maatwerk kan de gegevensmap
  niet openen" with "nieuwere versie van Maatwerk (schemaversie 99)", the folder, and
  "Opnieuw proberen". Fix the file, click the button: the app restarts and opens normally.
  Same with a folder on a disconnected drive (I/O advice about OneDrive).
  {could not test, old data folder doesn't appear to have a schema version? I'd say this is not a blocking test though.}
- [ pass ] **M-START-4** No WebView2 (simulated), on the **release** exe:

      ```powershell
      $env:WEBVIEW2_BROWSER_EXECUTABLE_FOLDER = 'C:\bestaat-niet'; .\maatwerk.exe
      ```

      Expect exactly one Windows message box, "Maatwerk kan niet starten", with WebView2 install
      advice and a technical line (no English Tauri box first); no silent exit. The log file of
      that day has a "cannot start" line.

- [ pass ] **M-START-5** Start without internet (Wi-Fi off): everything below still works (no CDN).

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

- [ fail ] **M-GRP-1** "+ Groep toevoegen" with jaarlaag, schoolsoort, vak and teacher chips; edit;
  "Groep verwijderen".
  {Adding and editing works, deleting is broken. The group deletes, but it doesn't disappear from the list. After a restart it does disappear from the list. This might be a pre-existing bug.}
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
- [ fail ] **M-OPD-6** Drop an image file on the editor: nothing happens (the old app replaced the
  window with the file, quirk U20). Select text in the editor and drag it to another place:
  it moves.
  {Image dragging does what you describe. Text dragging does not work.}

## Gebruikers and School (admin) (M-ADM)

- [ pass ] **M-ADM-1** "+ Gebruiker toevoegen" with a JPG/PNG photo, edit, "Gebruiker
  deactiveren"/"activeren"; the startup screen follows.
  {Photo works, but is shown inconsistently through the app. Add to the backlog to check this please.}
- [ pass ] **M-ADM-2** School: edit naam/ondertitel/motto, schoolsoort buttons, logo (PNG/JPG/SVG)
  and watermark (SVG). A `.bmp` logo gets "Bestandstype .bmp wordt niet ondersteund". The
  rapport (M-TOE-5) shows the new logo and watermark.

## Two teachers at once (M-SYNC)

Run two copies on two machines (or two Windows accounts) on the **same** test folder, synced
through OneDrive or a network share.

- [ ??? ] **M-SYNC-1** Presence: teacher B sees A's badge (green when active, orange when idle) on the
  exam card ("<naam> werkt hierin") and in the score grid ("heeft dit scorescherm open", or
  "heeft de afgelopen 2 minuten scores ingevoerd"); closing A's window marks A offline
  shortly after.
  {I wasn't able to test this right now. We'll rely on your test results for now and just continue.}
- [ ??? ] **M-SYNC-2** A enters scores; B's open score grid updates the row and flashes it. A adds an
  exam; B gets the toast "Nieuwe toets toegevoegd".
- [ ??? ] **M-SYNC-3** Both edit the same student/group/exam modal: the second save shows "gewijzigd
  door … wordt opnieuw geladen" or "Niet opgeslagen: dit is intussen … gewijzigd", never a
  silent overwrite.
- [ ??? ] **M-SYNC-4** Switching the year in one app: changes in that year from the other app arrive.

## Shutdown (M-END)

- [ pass ] **M-END-1** Closing the window ends the process (Task Manager) and marks the teacher offline
  for colleagues.
- [ pass ] **M-END-2** Render outputs go to
  `%LOCALAPPDATA%\nl.openbetaonderwijs.maatwerk\output\<pid>\` (one folder per run);
  folders of earlier runs disappear after a day. Printed copies in `rapporten\` stay.
