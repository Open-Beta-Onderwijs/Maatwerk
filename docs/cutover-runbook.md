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
   folder with the old app, or ask the developer.
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
   - In the new app: start `maatwerk.exe` from the shared folder. It shows "Deze gegevensmap moet
     eenmalig worden omgezet". Tick the box, click **Omzetten**. The backup goes to
     `%LOCALAPPDATA%\nl.openbetaonderwijs.maatwerk\backups\`; the screen shows the path and the
     check. Click **Maatwerk starten**.
   - Or with the CLI: `maatwerk-cli migrate <shared>\data --apply --backup-dir <local folder>`.
     The backup folder must be outside OneDrive and outside the shared folder (the tool refuses
     otherwise).
4. **Copy the backup zip** to a second place (a USB stick or the school network drive). Note its
   name in the log below.
5. Open **Gegevenscontrole** (admin tab). No errors expected; warnings are listed for later.
6. Wait until OneDrive has synced the migrated folder (many files change once: this is expected).

## 4. Distribute the new exe

1. Put the new `maatwerk.exe` in the shared folder, next to `data\` (and `rapporten\`, which the
   migration created next to `data\` if there were printed reports).
2. **Move the old exe away** from the shared folder (to a local `old\` folder of the admin) and
   remove desktop shortcuts to it, so nobody starts it out of habit. The old app does not read
   `schema_version`: on a v2 folder it would write v1 data again.
3. Tell the teachers they can start the new Maatwerk.

## 5. Rollback (only if the new app cannot be used)

1. Everyone closes Maatwerk.
2. Rename the shared `data\` folder to `data-v2-<date>` (keep it: work done in the new app is in
   it).
3. Unzip the backup; its `data\` folder becomes the shared `data\`. Put the old exe back.
4. Tell the teachers to use the old app again. Report what went wrong to the developer. Work done
   in the new app since the switch must be re-entered (or copied over by the developer).

## Log

| Date | Who | Backup zip (name and second place) | Check result | Notes |
| ---- | --- | ---------------------------------- | ------------ | ----- |
|      |     |                                    |              |       |
