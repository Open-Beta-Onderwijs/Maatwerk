# Maatwerk

Desktop app for Dutch secondary-school teachers (the app is in Dutch): enter exam scores, analyse
them with the RTTI framework (Reproductie, Toepassen 1, Toepassen 2, Inzicht), and produce
per-student reports and remedial assignments (opdrachten) written in Typst. Several teachers of a
school share one data folder, for example through OneDrive. Built with Rust and Tauri 2; a port of
an earlier Electron app.

## Install

Maatwerk is one portable Windows exe, no installer.

1. Download `maatwerk.exe` (and `maatwerk.exe.sha256`) from the release, or the CI artifact
   `maatwerk-windows-x64`. Check the checksum:
   `(Get-FileHash maatwerk.exe -Algorithm SHA256).Hash.ToLower()`.
2. Put it in the shared folder of the school, next to the `data\` folder. Without a `data\`
   folder beside it, the first start asks for the data folder ("Kies de gegevensmap"; see
   below).
3. Start it. It needs Microsoft Edge WebView2 (standard on Windows 10 and 11); without it,
   Maatwerk says so in a message box.

### macOS (from 0.7)

Maatwerk for macOS is one universal app (Apple Silicon and Intel, macOS 12 or newer). It is not
signed with an Apple Developer ID, so macOS blocks the first start; it is safe to allow it once:

1. Download `Maatwerk-macos-universal.dmg` from the release (or the CI artifact
   `maatwerk-macos-universal`). Check it in Terminal: `shasum -a 256 Maatwerk-macos-universal.dmg`
   equals the line in `SHA256SUMS.txt`.
2. Open the `.dmg` and drag Maatwerk to Programma's (Applications). Do not start it from the
   `.dmg`.
3. Start Maatwerk. macOS says it cannot check the app: click **Gereed** (Done).
4. Open Systeeminstellingen > Privacy en beveiliging, scroll to Beveiliging and click **Toch
   openen** (Open Anyway) next to "Maatwerk", then **Toch openen** again and log in with your Mac
   password. (macOS 14 and older: right-click Maatwerk in Programma's > Open > Open.)
5. On the first start Maatwerk asks for the data folder ("Kies de gegevensmap"): choose the
   shared folder in OneDrive (Finder > OneDrive). Keep that folder "Altijd behouden op dit
   apparaat" (always keep on this device), so the files are there when Maatwerk reads them.

On a Mac the function keys F1, F2, … (observaties in the score grid) need the fn key, unless
"Gebruik F1, F2 enz. als standaardfunctietoetsen" is on in Systeeminstellingen > Toetsenbord.
Undo and redo are Cmd+Z and Cmd+Shift+Z.

### Linux (from 0.7)

Maatwerk for Linux is an AppImage and a `.deb` for x86-64 PCs with glibc 2.39 or newer (Ubuntu
24.04, Linux Mint 22, Debian 13 or newer). Download them from the release (or the CI artifact
`maatwerk-linux-x86_64`) and check them: `sha256sum -c SHA256SUMS.txt`.

- **`.deb`** (Ubuntu, Mint, Debian): `sudo apt install ./maatwerk-linux-amd64.deb`. Maatwerk
  is then in the app menu; updates are a new `.deb` installed the same way.
- **AppImage** (any distribution): `chmod +x Maatwerk-linux-x86_64.AppImage`, then start it.
  Ubuntu 24.04 and newer first need `sudo apt install libfuse2t64`. Like the Windows exe, an
  AppImage uses a folder `data` beside it if there is one.

On the first start Maatwerk asks for the data folder ("Kies de gegevensmap"): choose the local
copy of the shared folder (below).

#### Linux: the shared folder

OneDrive has no official Linux client. Maatwerk needs a local copy of the shared folder that
stays in sync, not a network mount: it watches the files for colleagues' changes and saves by
writing a new file and renaming it.

1. **Recommended: "OneDrive Client for Linux"** (<https://github.com/abraunegg/onedrive>, open
   source). Sync only the shared folder (`sync_list`) and run it as a service, so it keeps
   syncing while Maatwerk runs (`onedrive --monitor`; its documentation explains the systemd
   service). For a folder another person shared with you, see its "shared folders" guide.
2. **Alternative: rclone bisync** (<https://rclone.org/bisync/>, open source): a two-way sync
   that runs every few minutes from a systemd timer or cron. It is not real-time, so a
   colleague's change reaches you a few minutes later, and while both of you work on the same
   file, the later sync makes a conflict copy.

**Not suitable:** `rclone mount` and OneDrive in GNOME Files (Online Accounts). Both are network
mounts without a local copy. Commercial clients (such as Insync) work like option 1; they have
not been tested with Maatwerk.

Conflict copies of either client are not read by Maatwerk; `maatwerk-cli validate-data` lists
them, as it does OneDrive's.

## The data folder

- The data folder holds everything: school settings, users, groups, students, exams,
  scores, observaties, opdrachten (JSON files and Typst folders, format v2:
  `docs/reference/data-files-v2.md`). Printed PDFs go to `rapporten\` next to it.
- Every teacher's app watches the folder and shows colleagues' changes; a save that would
  overwrite a colleague's newer change is refused with a message, never done silently.
- Where it is, in this order: `MAATWERK_DATA_DIR` (tests, a copy), the folder chosen on this PC,
  `data\` next to the exe if that exists. Otherwise the first start asks: choose the shared
  data folder (the one with `config.json`, or the folder that holds `data`), or an empty folder
  for a new school. The choice is stored on this PC only, in `local-config.json` in the app's
  local folder (Windows `%LOCALAPPDATA%\nl.openbetaonderwijs.maatwerk`, macOS
  `~/Library/Application Support/nl.openbetaonderwijs.maatwerk`, Linux
  `~/.local/share/nl.openbetaonderwijs.maatwerk`). "Over Maatwerk" shows the folder in use and
  offers "Andere map kiezen…" when it was chosen on this PC or lies beside the program; so does
  the error screen when the folder cannot be opened. A chosen folder that is gone (OneDrive
  signed out, renamed) is never created again: the error screen asks to check it or choose
  another.
- A folder from the old Electron app is converted once, after a backup; see
  `docs/cutover-runbook.md`.

## Backup

- **Snapshots:** the first app that starts after the interval writes
  `data\snapshots\<datum tijd>.zip` (default daily; keeps 7 daily, 4 weekly, 12 monthly;
  Beheer > Instellingen). Single files can be restored in Beheer > Gegevenscontrole; restoring
  the whole folder is in `docs/cutover-runbook.md` section 7.
- **OneDrive version history** is the last resort; keep it on.
- The conversion from the old app writes a verified backup zip outside the shared folder.

## Problems

"Over Maatwerk" (the title top left) > Probleem melden shows where the log files are
(`%LOCALAPPDATA%\nl.openbetaonderwijs.maatwerk\logs`, 14 days, technical messages only). Send
the log of that day with a description to the admin or the developer.

## Development

`docs/dev-setup.md` (prerequisites), `CLAUDE.md` (commands), `docs/architecture.md` (map),
`docs/release.md` (release process), `PLAN.md` and `docs/STATE.md` (status), `ROADMAP.md`
(phase 2).

## Licence and source

Copyright © 2026 Open Beta Onderwijs - Matthias Kortleven.

Maatwerk is free software: you can redistribute it and/or modify it under the terms of the GNU
Affero General Public License as published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version (`AGPL-3.0-or-later`, see `LICENSE`). It is
distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied
warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.

- **Source:** https://github.com/Open-Beta-Onderwijs/Maatwerk. Every exe states its version and
  build (`git describe`, e.g. `v0.2.0-parity-4-gef073ac`) under "Over Maatwerk", so the matching
  source can be found by tag or commit.
- **Third-party components:** an overview is in `THIRD_PARTY_LICENSES.md`; the full licence texts
  of everything inside the exe are in `THIRD_PARTY_NOTICES.txt` (generated by `npm run notices`).
- **Distributing the exe:** give `LICENSE` and `THIRD_PARTY_NOTICES.txt` with it (the CI artifact
  contains both) and keep the source link above valid. If you distribute a modified version, you
  must publish its source under the same licence.
- **In the app:** "Over Maatwerk" (startup screen, or the title in the top bar) shows the licence
  notice, the source link, the licence text and the third-party notices to every user.
