# Cutover runbook: from the old app to Maatwerk

The one-time switch from the Electron app (v1 data folder) to Maatwerk (format v2,
[`reference/data-files-v2.md`](reference/data-files-v2.md)). Planned after Step 8; the date is the
user's call (PLAN section 9, decision 11). Old and new app never use the same folder at the same
time: once the folder is v2, the old app must not start on it again.

Roles: **the admin** runs the migration; **the teachers** close the old app and start the new one.

## 1. Prepare (a week before)

1. Test the migration on a **copy** of the real folder, outside OneDrive:
   `maatwerk-cli migrate <copy>\data --dry-run --verbose`, then
   `maatwerk-cli migrate <copy>\data --apply --backup-dir C:\Maatwerk-backups`. Read the warnings
   and the check (`Controle: ... fouten`). Fix what blocks (the dry run names the file) in the real
   folder with the old app, or ask the developer. A warning "Vraag-id qN komt 2 keer voor" (quirk
   B24, an exam saved by the old app after deleting and adding a question) does not block, but
   that exam's grades are wrong where the two questions share scores: tell the developer, who
   decides with the teacher how to repair it.
2. Start the new exe on the migrated copy (`MAATWERK_DATA_DIR=<copy>\data`) and click through
   [`manual-test.md`](manual-test.md) (at least M-START, M-TOE, M-OPD, M-RAP).
3. Check that OneDrive's version history is on for the shared folder (it is the last resort if
   everything else fails).
4. Agree on the moment with the teachers (a quiet hour, no report deadline that day).

## 2. Announce (the day before and one hour before)

> Morgen om [tijd] stappen we over op de nieuwe Maatwerk. Sluit vóór [tijd] de oude app en start
> hem daarna niet meer. Je krijgt een bericht zodra je de nieuwe kunt gebruiken.

## 3. Switch (the admin, about 15 minutes)

1. **Everyone closes the old app.** Check the presence files: in `data\users\` every file has
   `"online": false`, or its `heartbeatAt` is more than a few minutes old.
2. Wait until OneDrive shows the folder as synced (green tick) on the admin's PC.
3. **Backup and migrate**, one of:
   - In the new app: put the new `maatwerk.exe` in the shared folder next to `data\` (step 4.1)
     and start it there; only the admin starts it before the migration. It shows "Deze gegevensmap moet
     eenmalig worden omgezet". Tick the box, click **Omzetten**. The backup goes to
     `%LOCALAPPDATA%\nl.openbetaonderwijs.maatwerk\backups\`; the screen shows the path and the
     check. Click **Maatwerk starten**.
   - Or with the CLI: `maatwerk-cli migrate <shared>\data --apply --backup-dir <local folder>`.
     The backup folder must be outside OneDrive and outside the shared folder (the tool refuses
     otherwise). It cannot recognise a SharePoint library synced by OneDrive: choose a plain
     local folder such as `C:\Maatwerk-backups`.
4. **Copy the backup zip** and its report `<backup> verslag.txt` (same folder: migration
   warnings, the check and every change) to a second place (a USB stick or the school network
   drive). Note its name in the log below.
5. Open **Gegevenscontrole** (admin tab). No errors expected; warnings are listed for later.
   A "Vraag-id qN komt 2 keer voor" warning (B24, see section 1) is no reason to roll back.
6. Wait until OneDrive has synced the migrated folder (many files change once: this is expected).

## 4. Distribute the new exe

1. Put the new `maatwerk.exe` in the shared folder, next to `data\` (and `rapporten\`, which the
   migration created next to `data\` if there were printed reports).
2. **Move the old exe away** from the shared folder (to a local `old\` folder of the admin) and
   remove desktop shortcuts to it, so nobody starts it out of habit. The old app does not read
   `schema_version`: on a v2 folder it would write v1 data again.
3. Tell the teachers they can start the new Maatwerk. **The admin logs in first**: Maatwerk asks
   for a new PIN (4-8 digits) and then shows ten recovery codes **once**. Print them or save them
   ("Afdrukken" / "Opslaan als") and keep them outside the shared folder (e.g. in the school
   safe). Each teacher chooses a PIN at their first login.
4. Optional: assign the sectievoorzitters (Gebruikers > Sectievoorzitters) and check the snapshot
   settings (Instellingen; default: one per day, keep 7 daily, 4 weekly, 12 monthly).

## 5. Rollback (only if the new app cannot be used)

1. Everyone closes Maatwerk.
2. Rename the shared `data\` folder to `data-v2-<date>` (keep it: work done in the new app is in
   it).
3. Unzip the backup; its `data\` folder becomes the shared `data\`. Put the old exe back.
4. Tell the teachers to use the old app again. Report what went wrong to the developer. Work done
   in the new app since the switch must be re-entered (or copied over by the developer).

## 6. PINs (after the switch)

- **A teacher forgot the PIN:** the admin opens Gebruikers and clicks "Pincode resetten" on that
  teacher. The teacher chooses a new PIN at the next login.
- **The admin forgot the PIN:** on the login screen, the admin badge, "Pincode vergeten?", one of
  the recovery codes and a new PIN. Each code works once; "Nieuwe herstelcodes" (click the badge
  at the top right) replaces all of them.
- **Pincode beheerder kwijt (PIN and codes lost):** on a PC with the shared folder, with nobody
  logged in as admin:

  ```powershell
  maatwerk-cli admin reset-pin <shared>\data
  ```

  The admin chooses a new PIN at the next login and gets new recovery codes. Note it in the log.

The PIN guards the shared PC, not the files: anyone who can write to the shared folder can change
the files anyway.

## 7. Snapshots and restoring

Maatwerk keeps zips of all data (JSON, `.typ` files and opdracht images; not the photos and not
`rapporten\`) in `data\snapshots\`, named `<YYYY-MM-DD HHmm>.zip`. The first app that starts after
the interval (Instellingen) writes one in the background.

- **One file changed by accident** (Gegevenscontrole shows "Buiten Maatwerk gewijzigd"):
  "Herstellen uit snapshot" puts back the newest intact copy (the dialog names its date). Changes
  to that file made after that snapshot are lost.
- **The whole folder** (hard to undo, so a manual step for now):
  1. Everyone closes Maatwerk.
  2. Copy the snapshot zip you want out of `data\snapshots\` to a local folder.
  3. Rename the shared `data\` folder to `data-kapot-<date>` (keep it).
  4. Create a new `data\` folder and unzip the snapshot into it. Copy `snapshots\` and `fotos\`
     back from `data-kapot-<date>` (the zip has neither).
  5. Start Maatwerk as admin and run Gegevenscontrole.
- **The shared folder itself is gone or damaged** (the snapshots go with it): use OneDrive's
  version history or recycle bin for the folder (OneDrive website, "Vorige versies herstellen"),
  or the migration backup from step 3.4.

## Log

| Date       | Who                         | Backup zip (name and second place) | Check result                                     | Notes                                                                                                                                                                    |
| ---------- | --------------------------- | ---------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-11-01 | Claude (rehearsal, Step 8b) | `school` fixture copy, local only  | validate-data: only the fixture's known warnings | Steps 1.1, 3.3, 3.5 with the CLI; second apply is a no-op; rollback (5.3): the unzipped backup equals the original byte for byte (5094 files). Not yet: real data (user) |
