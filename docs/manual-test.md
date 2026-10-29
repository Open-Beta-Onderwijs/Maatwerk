# Manual test checklist (click-through)

For the user, on the portable exe and a **copy** of real data (never the live OneDrive folder,
never inside the repo). The automated tests run on synthetic fixtures and a mock backend; this
list covers what only the real app on a real Windows machine shows: OS dialogs, the clipboard,
opening PDFs, OneDrive timing, two teachers at once. Ids (`M-…`) are referenced from
`docs/parity.md`.

Report a difference with the id, what you did, what you expected (old app) and what you saw.
The log is in `%LOCALAPPDATA%\nl.openbetaonderwijs.maatwerk\logs\maatwerk.<date>.log`.

## Setup

1. Get the exe: CI artifact `maatwerk-windows-x64`, or `npm run build:exe` ->
   `target\release\maatwerk.exe`.
2. Copy the data folder, e.g. to `D:\maatwerk-test\data`. Point the app at it: put the exe in
   `D:\maatwerk-test\` (it uses `data\` next to the exe), or set `MAATWERK_DATA_DIR`:
   `$env:MAATWERK_DATA_DIR = 'D:\maatwerk-test\data'; .\maatwerk.exe` (PowerShell).
3. Keep the old app closed while testing on the same copy (old and new never share a folder).

## Start (M-START)

- [ ] **M-START-1** The window is titled "Maatwerk", 1280x800, no menu bar, Maatwerk icon in the
      taskbar. It cannot be made smaller than 900x600.
- [ ] **M-START-2** The startup screen shows the subjects; after picking one, the teachers of that
      subject and the admin badge (with photos). Picking a teacher opens Leerlingen with the
      last-used year.
- [ ] **M-START-3** Unusable data folder: point `MAATWERK_DATA_DIR` at a copy whose
      `config.json` has `"schema_version": 99`. Expect the screen "Maatwerk kan de gegevensmap
      niet openen" with "nieuwere versie van Maatwerk (schemaversie 99)", the folder, and
      "Opnieuw proberen". Fix the file, click the button: the app restarts and opens normally.
      Same with a folder on a disconnected drive (I/O advice about OneDrive).
- [ ] **M-START-4** No WebView2 (simulated): `$env:WEBVIEW2_BROWSER_EXECUTABLE_FOLDER =
  'C:\bestaat-niet'; .\maatwerk.exe`. Expect a Windows message box "Maatwerk kan niet
      starten" with WebView2 install advice and a technical line; no silent exit.
- [ ] **M-START-5** Start without internet (Wi-Fi off): everything below still works (no CDN).

## Leerlingen (M-LEER)

- [ ] **M-LEER-1** Year selector "Schooljaar:" switches the list; an empty year shows the "Voeg
      leerlingen toe of kies een ander schooljaar" hint.
- [ ] **M-LEER-2** "+ Leerling toevoegen", edit (pencil), delete (bin, with confirmation;
      blocked when the student has data). Changes survive a restart.
- [ ] **M-LEER-3** "↑ CSV importeren" with a real export: same students as in the old app,
      accents and names with a tussenvoegsel intact.
- [ ] **M-LEER-4** Student name opens the profile: tabs "Cijferverloop" and "Analyse", year
      buttons, "Onderbouw"/"Bovenbouw", "Examendossier". Charts look as in the old app.

## Groepen (M-GRP)

- [ ] **M-GRP-1** "+ Groep toevoegen" with jaarlaag, schoolsoort, vak and teacher chips; edit;
      "Groep verwijderen".
- [ ] **M-GRP-2** Group name opens its students: "Alles"/"Niets", toggling membership saves.
- [ ] **M-GRP-3** Group CSV and group assignment CSV import ("Importeren") with a real file.

## Toetsen (M-TOE)

- [ ] **M-TOE-1** "+ Toets toevoegen": step 1 and step 2 ("+ Vraag toevoegen", RTTI category
      buttons, "✕"), "Opslaan". Edit and delete an exam ("Toets verwijderen" is blocked with
      resits).
- [ ] **M-TOE-2** "Scores invoeren": typing, arrows, undo/redo "↶ ↷", paste a range from Excel,
      "Berekend cijfer herstellen". Grades equal the old app's for the same scores (compare a
      few students, decimal comma).
- [ ] **M-TOE-3** "Overzicht openen": tabs "Resultaten", "Cijferverdeling", "Boxplot cijfers",
      "Vraaganalyse", "RTTI-analyse", "Observaties"; "0,5 punten"/"1 punt".
- [ ] **M-TOE-4** "Inhaal / herkansing toevoegen" and "Verzamelkaart bewerken": best attempt
      and history as in the old app.
- [ ] **M-TOE-5** "Rapport genereren" on a real class: the PDF viewer shows every page; zoom,
      zoom list, Ctrl+scroll, previous/next page. Compare a few pages with the old app's rapport
      (logo, watermark, emoji medals, leeradvies text). Edit the RTTI uitleg/leeradvies texts
      ("Kopiëren naar…", "Opslaan"); unsaved changes ask "Blijven bewerken"/"Toch sluiten".
- [ ] **M-TOE-6** "Afdrukken" in the rapport viewer: a copy appears in
      `data\rapporten\<schooljaar>\` named `<YYYY-MM-DD HHmm> Rapport <vak> <groep> <toets>.pdf`
      and opens in the default PDF app. A second print in the same minute gets ` (2)`.
- [ ] **M-TOE-7** "Opdrachten genereren": cut-offs, "Alles aan"/"Alles uit", "Antwoordsleutel",
      "Genereren" shows progress and then the merged PDF; "Afdrukken" copies and opens it
      (name has `Opdrachten`, or `Antwoordsleutel` for the key). With duplex, every student starts on an odd page.

## Observaties (M-OBS)

- [ ] **M-OBS-1** "+ Observatie toevoegen", edit, delete (with confirmation); filters by
      schoolsoort, vak, jaarlaag.

## Opdrachten and the editor (M-OPD)

- [ ] **M-OPD-1** "+ Opdracht toevoegen" creates the opdracht and its `.typ` file
      (`opdrachten\<id>.typ`, from the base template). "Kopiëren" copies text and images
      ("Opdracht gekopieerd als …"); delete removes its images folder.
- [ ] **M-OPD-2** Opening an opdracht shows the editor with the preview. Typing updates the
      preview; toolbar buttons insert their markup; Ctrl+scroll zooms the preview. A Typst
      error shows the message with line and column.
- [ ] **M-OPD-3** Autosave: type, wait a second, close with "Maatwerk": reopening shows the edit.
      Close right after typing: the last edit is kept too.
- [ ] **M-OPD-4** "Figuur toevoegen" -> "📂 Van schijf kiezen…": the Windows file dialog shows
      image types; pick a PNG, a JPG with an accented name (`één foto.jpg`) and an SVG. Name
      form with "afbeelding-N", "Invoegen"; the same name again offers "Overschrijven". The
      image shows in the preview and in `opdrachten\images\<id>\`. An image of 10+ MB (phone
      photo) still works.
- [ ] **M-OPD-5** "📋 Plakken van klembord" and Ctrl+V in the text after copying a screenshot
      (Win+Shift+S) and after copying an image in a browser: a PNG is saved and inserted. With
      text on the clipboard: a clear message, no crash.
- [ ] **M-OPD-6** Drag and drop of an image into the editor: the port has no drop handler. Note
      whether the old app did anything here; report it only if it did.

## Gebruikers and School (admin) (M-ADM)

- [ ] **M-ADM-1** "+ Gebruiker toevoegen" with a JPG/PNG photo, edit, "Gebruiker
      deactiveren"/"activeren"; the startup screen follows.
- [ ] **M-ADM-2** School: edit naam/ondertitel/motto, schoolsoort buttons, logo (PNG/JPG/SVG)
      and watermark (SVG). A `.bmp` logo gets "Bestandstype .bmp wordt niet ondersteund". The
      rapport (M-TOE-5) shows the new logo and watermark.

## Two teachers at once (M-SYNC)

Run two copies on two machines (or two Windows accounts) on the **same** test folder, synced
through OneDrive or a network share.

- [ ] **M-SYNC-1** Presence: teacher B sees A's badge (green when active, orange when idle) on the
      exam card and in the score grid ("<naam> werkt hierin"); closing A's window marks A
      offline shortly after.
- [ ] **M-SYNC-2** A enters scores; B's open score grid updates the row and flashes it. A adds an
      exam; B gets the toast "Nieuwe toets toegevoegd".
- [ ] **M-SYNC-3** Both edit the same student/group/exam modal: the second save shows "gewijzigd
      door … wordt opnieuw geladen" or "Niet opgeslagen: dit is intussen … gewijzigd", never a
      silent overwrite.
- [ ] **M-SYNC-4** Switching the year in one app: changes in that year from the other app arrive.

## Shutdown (M-END)

- [ ] **M-END-1** Closing the window ends the process (Task Manager) and marks the teacher offline
      for colleagues.
- [ ] **M-END-2** Render outputs go to
      `%LOCALAPPDATA%\nl.openbetaonderwijs.maatwerk\output\<pid>\` (one folder per run);
      folders of earlier runs disappear after a day. Printed copies in `rapporten\` stay.
