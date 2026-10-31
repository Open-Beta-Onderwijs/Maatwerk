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
4. From Step 7a the app works on format v2: on a copy of the old app's folder it first shows the
   conversion screen (M-MIG-1). Convert the copy, then test the rest on it.

## Start (M-START)

- [ ] **M-START-1** The window is titled "Maatwerk", 1280x800, no menu bar, Maatwerk icon in the
      taskbar. It cannot be made smaller than 900x600.
- [ ] **M-START-2** The startup screen shows the subjects; after picking one, the teachers of that
      subject and the admin badge (with photos). Picking a teacher asks the PIN (M-PIN) and then
      opens Leerlingen with the last-used year.
- [ ] **M-START-3** Unusable data folder: on a converted copy (M-MIG-1) change `"schema_version": 2`
      in `config.json` to `99`. Expect the screen "Maatwerk kan de gegevensmap
      niet openen" with "nieuwere versie van Maatwerk (schemaversie 99)", the folder, and
      "Opnieuw proberen". Fix the file, click the button: the app restarts and opens normally.
      Same with a folder on a disconnected drive (I/O advice about OneDrive).
- [ ] **M-START-4** No WebView2 (simulated), on the **release** exe:

      ```powershell
      $env:WEBVIEW2_BROWSER_EXECUTABLE_FOLDER = 'C:\bestaat-niet'; .\maatwerk.exe
      ```

      Expect exactly one Windows message box, "Maatwerk kan niet starten", with WebView2 install
      advice and a technical line (no English Tauri box first); no silent exit. The log file of
      that day has a "cannot start" line.

- [ ] **M-START-5** Start without internet (Wi-Fi off): everything below still works (no CDN).
- [ ] **M-START-6** "Over Maatwerk" (startup screen, bottom left; after login: the title "Maatwerk"
      in the top bar) shows the version, a build such as `v0.2.0-parity-…`, the copyright line, the
      AGPL notice and the source link. "Licentietekst" and "Licenties van derden" show the texts.
      `LICENSE` and `THIRD_PARTY_NOTICES.txt` come with the CI artifact.
- [ ] **M-START-7** The release exe's windows ignore a dropped file (no navigation), and selected
      text in the editor can be dragged to another place (`M-OPD-6`).

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
      `rapporten\<schooljaar>\` **next to** `data\` (C18) named `<YYYY-MM-DD HHmm> Rapport <vak> <groep> <toets>.pdf`
      and opens in the default PDF app. A second print in the same minute gets ` (2)`.
- [ ] **M-TOE-7** "Opdrachten genereren": cut-offs, "Alles aan"/"Alles uit", "Antwoordsleutel",
      "Genereren" shows progress and then the merged PDF; "Afdrukken" copies and opens it
      (name has `Opdrachten`, or `Antwoordsleutel` for the key). With duplex, every student starts on an odd page.

## Observaties (M-OBS)

- [ ] **M-OBS-1** "+ Observatie toevoegen", edit, delete (with confirmation); filters by
      schoolsoort, vak, jaarlaag.

## Opdrachten and the editor (M-OPD)

- [ ] **M-OPD-1** "+ Opdracht toevoegen" creates the folder `opdrachten\<id>\` with
      `opdracht.json`, `opdracht.typ` (base template), `main.typ` and `lib.typ` (C14). "Kopiëren"
      copies the folder, images included ("Opdracht gekopieerd als …"); delete removes the folder.
      `typst compile main.typ` (plain Typst CLI 0.14) in an opdracht folder makes a PDF.
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
- [ ] **M-OPD-6** Drop an image file on the editor: nothing happens (the old app replaced the
      window with the file, quirk U20). Select text in the editor and drag it to another place:
      it moves.

## Gebruikers and School (admin) (M-ADM)

- [ ] **M-ADM-1** "+ Gebruiker toevoegen" with a JPG/PNG photo, edit, "Gebruiker
      deactiveren"/"activeren"; the startup screen follows. The photo shows the same on the login
      badge, the top-bar badge and the Gebruikers card (Step 7b; group cards list names only).
      Editing a user who has a PIN keeps the PIN (log in as that user afterwards).
- [ ] **M-ADM-2** School: edit naam/ondertitel/motto, schoolsoort buttons, logo (PNG/JPG/SVG)
      and watermark (SVG). A `.bmp` logo gets "Bestandstype .bmp wordt niet ondersteund". The
      rapport (M-TOE-5) shows the new logo and watermark.

## Accounts, roles, snapshots (Step 7b: M-PIN, M-VZ, M-SNAP)

- [ ] **M-PIN-1** First login of a teacher: "Welkom, …", choose a PIN. `1234` and two different
      PINs are refused with a Dutch message. After that the next login asks the PIN.
- [ ] **M-PIN-2** Wrong PIN twice: "Onjuiste pincode. Probeer het over 2 seconden opnieuw.", the
      button is grey meanwhile; the waits grow (4, 8, … s, at most a minute). Another teacher can
      log in at once. A restart clears the waits.
- [ ] **M-PIN-3** The admin's first login shows ten recovery codes. "Verder" stays grey until "Ik
      heb de codes bewaard" is ticked. "Afdrukken" prints only the codes; "Opslaan als…" writes
      a `.txt`. `gebruikersdmin.json` holds `pinHash` and `recoveryCodeHashes` (`$argon2id$…`),
      never the PIN or a code.
- [ ] **M-PIN-4** Admin: "Pincode vergeten?" with a code (dash and case do not matter) and a new
      PIN logs in. The same code a second time: "Onjuiste herstelcode." Badge (top right) >
      "Nieuwe herstelcodes" asks the PIN and shows ten new codes; the old ones no longer work.
- [ ] **M-PIN-5** Badge (top right) > "Pincode wijzigen" (current PIN, new twice); "Uitloggen"
      goes back to the login screen.
- [ ] **M-PIN-6** Admin > Gebruikers > "Pincode resetten" on a teacher: that teacher chooses a new
      PIN at the next login; the card says "Nog geen pincode". On a second PC the teacher's open
      login dialog still accepts the old PIN only until the reset has synced.
- [ ] **M-PIN-7** Lost everything: `maatwerk-cli admin reset-pin <copy>\data`; the admin chooses
      a new PIN and gets new codes.
- [ ] **M-VZ-1** Admin > Gebruikers > Sectievoorzitters: pick a nat teacher. On the login screen
      (vak Natuurkunde) a square "Sectievoorzitter" badge appears after the teachers; other vakken
      show none. It asks that teacher's PIN; the top-bar badge is square.
- [ ] **M-VZ-2** As sectievoorzitter, Groepen shows a pen on the nat groups only: name, jaarlaag,
      schoolsoort and vak are grey; students in/out and Docent(en) can change; no delete, no new
      group. The saved group's `_meta.updatedBy` is the teacher. Logged in through the teacher's
      own badge: no pen.
- [ ] **M-SNAP-1** Start the app on a test copy: within a minute `data\snapshots\<datum tijd>.zip`
      appears (the log says `snapshot: Written`); a second start the same day writes none.
      Instellingen lists it. Two PCs starting together write one zip.
- [ ] **M-SNAP-2** Instellingen: interval 1 hour, daily 2, weekly 0, monthly 0, "Opslaan"; with
      older zips copied in (rename them to older dates), the next due start keeps the newest two
      days only.
- [ ] **M-SNAP-3** Edit a user file by hand, Gegevenscontrole > "Herstellen uit snapshot": the
      dialog names the snapshot date; afterwards the file is as in the zip and the line is gone.
- [ ] **M-SNAP-4** Measure on the real copy: zip size and time (log line), and the size of
      `fotos\`, to decide whether photos go into snapshots (PLAN Step 7b).

## Two teachers at once (M-SYNC)

Run two copies on two machines (or two Windows accounts) on the **same** test folder, synced
through OneDrive or a network share.

- [ ] **M-SYNC-1** Presence: teacher B sees A's badge (green when active, orange when idle) on the
      exam card ("<naam> werkt hierin") and in the score grid ("heeft dit scorescherm open", or
      "heeft de afgelopen 2 minuten scores ingevoerd"); closing A's window marks A offline
      shortly after.
- [ ] **M-SYNC-2** A enters scores; B's open score grid updates the row and flashes it. A adds an
      exam; B gets the toast "Nieuwe toets toegevoegd".
- [ ] **M-SYNC-3** Both edit the same student/group/exam modal: the second save shows "gewijzigd
      door … wordt opnieuw geladen" or "Niet opgeslagen: dit is intussen … gewijzigd", never a
      silent overwrite.
- [ ] **M-SYNC-4** Switching the year in one app: changes in that year from the other app arrive.
- [ ] **M-SYNC-5** Both open the same opdracht in the editor; A types and waits for "Opgeslagen",
      then B types: B sees "Intussen gewijzigd door een collega" and A's text is not overwritten.
      "Hun versie laden" shows A's text; "Mijn versie bewaren als kopie" makes "<naam> (kopie)"
      with B's text (C17).
- [ ] **M-SYNC-6** Two admins edit the same user (Gebruikers) or the same school field: the second
      save is refused with "intussen … gewijzigd" (C16).

## Data format v2 (M-MIG)

- [ ] **M-MIG-1** Start the exe on a copy of the old app's folder: "Deze gegevensmap moet eenmalig
      worden omgezet". "Omzetten" stays grey until the box is ticked. After converting: the
      summary with the backup path (`%LOCALAPPDATA%\nl.openbetaonderwijs.maatwerk\backups\`) and
      the check; "Maatwerk starten" opens the app with all students, exams, scores, opdrachten and
      RTTI texts as in the old app (spot-check a few grades and one rapport against the old app's
      PDF).
- [ ] **M-MIG-2** The backup zip opens in Explorer and holds the whole old `data\` folder.
- [ ] **M-MIG-3** `maatwerk-cli migrate <copy>\data --dry-run` lists what would change and changes
      nothing; `--apply --backup-dir <folder inside OneDrive>` is refused.
- [ ] **M-MIG-4** Admin tab "Gegevenscontrole" lists the check. Edit a group file by hand
      (Notepad): after "Opnieuw controleren" it shows "Buiten Maatwerk gewijzigd"; "Accepteren"
      removes the line. At the next admin login a notice says so before you look.
- [ ] **M-MIG-5** Put a copy of a group file next to it as `<naam> (1).json`: the check lists it as
      "OneDrive-conflictkopie".

## Shutdown (M-END)

- [ ] **M-END-1** Closing the window ends the process (Task Manager) and marks the teacher offline
      for colleagues.
- [ ] **M-END-2** Render outputs go to
      `%LOCALAPPDATA%\nl.openbetaonderwijs.maatwerk\output\<pid>\` (one folder per run);
      folders of earlier runs disappear after a day. Printed copies in `rapporten\` stay.
