# Step 41b: storage layout report (ADR-0012, sub-task 1)

Status: **draft for the user (STOP)**, 2026-11-28. Written before any code, from the real layout:
the code paths in `maatwerk-core`, `maatwerk-cli`, `src-tauri` (inventory with file:line refs
below) and the synthetic `school` fixture (`tools/fixtures`, 5130 files, 23 MB). When the user
approves it (with the answers in section 9), ADR-0012 becomes **accepted** with these choices.

User decision 2026-11-28: **`afbeeldingen/` is encrypted too** (names and contents; there was no
reason to keep it plain). ADR-0012 item 5 changed with it.

Legend: **N** = name, **C** = content; `enc` = encrypted, `plain` = as today.

## 1. Rule in one sentence

A file whose **content** is encrypted also gets an encrypted **name** (`<base32>.mwk`); a file
whose content stays plain keeps its plain name; **folder names fixed by the code stay plain**
(top-level folders, year folders, `exams`, `groups`, `scores`, the vak folders, `templates/rtti`).

Why not "every name below the top level" (ADR text): the fixed folder names are the same in every
school and public in the source code, so encrypting them hides nothing and costs ~35 characters
of path length per level and a mapping case in the watcher, snapshots and validation. Names that
carry data (student numbers, exam titles, group names, user ids) are all file names and are all
encrypted. See question Q2.

## 2. Before / after tree

Data root `R` (the chosen `data/` folder). Examples from the fixture.

```
R/                                         before                                after
├── config.json                            N plain C plain                       N plain C plain   schema_version 4 = format marker (Q1)
├── sleutels.json                          (new)                                 N plain C plain*  wrapped school keys (section 5)
├── school.json                            N plain C plain                       N enc   C enc     -> 3k7q…m2a.mwk
├── instellingen.json                      N plain C plain                       N enc   C enc
├── gebruikers/                            plain folder
│   └── gebr-1756713600001.json            N plain C plain  (pinHash in it)      N enc   C enc
├── aanwezigheid/                          plain folder
│   └── gebr-1756713600001.json            presence, every 15 s                  N enc   C enc
├── observaties/obs-1756713600100.json                                           N enc   C enc
├── rubrics/rubric-onderzoek.json                                                N enc   C enc
├── templates/rtti/nat_3.json              folders plain                         N enc   C enc
├── opdrachten/                            plain folder
│   └── opdracht_1756713600200/            folder name plain (Q2)                N plain
│       ├── opdracht.json                  title, scope, metadata                N enc   C enc
│       ├── main.typ, lib.typ, opdracht.typ                                      N plain C plain   (ADR: editor, Typst)
│       └── images/figuur.png, foto.jpg, schema.svg                              N plain C plain   (ADR)
├── afbeeldingen/                          photos, logo, watermark; plain folder (still not in snapshots)
│   └── gebr-1756713600001.png, school-logo.png, school-watermerk.svg           N enc   C enc     (user 2026-11-28)
├── 2025-2026/                             year folder, plain
│   ├── students-2025-2026.json            all students of the year              N enc   C enc
│   ├── exams/                             plain folder
│   │   └── nat-toets-h1-krachten-nergie-herkansing-2025-2026.json              N enc   C enc
│   ├── groups/1a-nat-2025-2026.json       folder plain                          N enc   C enc
│   └── scores/nat/900001.json             folders plain; stem = student number N enc   C enc
└── snapshots/                             plain folder
    ├── 2026-11-28 0930.zip                N plain (date)                        N plain, zip of the *physical* (encrypted) files (section 6)
    ├── state.json                         claim file                            N enc   C enc
    └── sleutels.json                      (new)                                 second copy of the key file (section 5)

R/../rapporten/<schooljaar>/<stamp> <soort> <vak> <groep> <toets>.pdf          N plain C plain   (ADR; outside R)
```

`*` `sleutels.json` is plain JSON, but its values are wrapped keys (unreadable without the KEK).

Encrypted names: AES-SIV over the **full logical file name** (with its extension: `.json`, or the
image extension in `afbeeldingen/`), associated data = the parent's logical path, lowercase
base32 without padding, then `.mwk`. Example: `scores/nat/900001.json` ->
`scores/nat/ab4…q7.mwk` (11 bytes + 16 -> 44 chars + `.mwk`).

## 3. What stays plain and why

| What                                        | Why                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config.json`                               | Format marker and `activeYear` only; every app version reads it first (`check_schema`, `mod.rs:281-316`; watcher `engine.rs:311-318`; `is_data_folder` probe `data_location.rs:186`). With `schema_version: 4` apps 0.9-0.32 refuse the folder at start with their existing "nieuwere versie van Maatwerk" message instead of going read-only on unreadable files (Q1). |
| Top-level, year and structural folder names | Fixed by the code, same in every school (section 1).                                                                                                                                                                                                                                                                                                                    |
| `opdrachten/<id>/*.typ`, `images/`          | ADR: "Openen in editor" opens the `.typ` file; the Typst World mounts the folder with `std::fs` (`project.rs:72-81`, `world.rs:310-339`) and `.typ` files refer to `lib.typ` and `images/<file>` by name.                                                                                                                                                               |
| `opdrachten/<id>/` folder name              | The `.typ` inside it is plain, so an encrypted folder name hides nothing; plain keeps the editor path, the AI workspace copy and the `write_text_file` check (`mod.rs:68-80`) unchanged (Q2).                                                                                                                                                                           |
| `snapshots/<date>.zip` names                | Dates only.                                                                                                                                                                                                                                                                                                                                                             |
| `R/../rapporten/`                           | ADR. Note: the PDF names contain group and test names, and the PDFs contain everything a rapport shows.                                                                                                                                                                                                                                                                 |

The real school settings: `school.json` stays at its logical path, so only its physical name and
content change. No separate stub is needed when Q1 is accepted (the marker is in `config.json`);
otherwise a plain `school.json` stub `{ minAppVersion, format }` next to the encrypted one.

## 4. File format and extension

- `MWK1` magic, format version (1 byte), flags (1 byte: bit 0 = deflated), key id (4 bytes),
  24-byte nonce, ciphertext + 16-byte tag. XChaCha20-Poly1305, associated data = logical path
  (forward slashes, as the app names it) + format version.
- Extension **`.mwk`**: Windows does not try to open it as text, the watcher can filter on it
  (today it filters on `json`/`typ`, `engine.rs:43-60`), and OneDrive's conflict suffix lands
  before it (`<b32>-<PC>.mwk`). Base32 (`a-z2-7`) has no `-`, so the name part before the first
  `-` is the encrypted name.
- **Compression (Q4):** deflate before encryption, via `flate2` (already in the dependency tree,
  MIT/Apache; zstd would add a C library). Fixture: a scores file 1475 -> 357 bytes, the
  students file 144 810 -> 6 335 bytes. The flags bit leaves room to change this later. Images
  in `afbeeldingen/` are stored without deflate (PNG/JPEG are compressed already).
- No-op writes: skip the write when the decrypted current content equals the new content (fresh
  nonces would otherwise change every byte and wake every PC's watcher and OneDrive).

## 5. Keys

- `R/sleutels.json`: `format` (1), `schoolId` (random UUID), `keys` (a list of `id`, 4-byte hex,
  and `wrapped`, base64 of XChaCha20-Poly1305(KEK, DEK) with associated data `schoolId` + `id`),
  `current` (the id new writes use). Plain name, because nothing can be decrypted before it is
  read. Content and name keys are HKDF-SHA256 subkeys of the DEK.
- **Second copy (Q5):** `R/snapshots/sleutels.json` (written together with the first, same
  bytes), plus every snapshot zip, plus a local cache per PC
  (`<app_local_data>/sleutels/<schoolId>.json`). On start: if `R/sleutels.json` is missing or
  unreadable but a copy is intact, the app does not create a new key (that would orphan all
  data); it tells the admin and offers "Sleutel herstellen" from the copy. A wrapped DEK is
  useless without the KEK, so the copies add no exposure.
- Test key: debug/test builds use the public test KEK with its own key id; a release build
  refuses a `sleutels.json` whose entries are under the test key id.

## 6. Snapshots, presence, claim, locks, temp files

- **Snapshots:** the zip holds the **physical files as they are on disk** (encrypted names and
  content, `sleutels.json` included), stored without deflate (ciphertext does not compress). No
  extra crypto, and a restore copies bytes back. `contents()` (`snapshots.rs:172-190`) selects by
  logical kind after mapping; `find_intact_copy` / `restore_file` map logical -> physical before
  looking up the entry. **Existing plain snapshots are deleted** by the migration after it made
  the first encrypted snapshot (Q7); the plain local migration backup zip stays (local app data,
  outside OneDrive, `backup.rs:24-51`).
- **Claim file** `snapshots/state.json`: encrypted like any data file (it names the PC).
- **Presence** `aanwezigheid/<userId>.json`: encrypted name and content; `prune_stale` keeps
  using the mtime first, then the decrypted `heartbeatAt`. A gast may still only write in
  `aanwezigheid/` (the check is on the plain top-level folder).
- **Commit lock:** local (`%LOCALAPPDATA%\maatwerk\locks\`), nothing in `R`; unchanged.
- **Temp files** `<name>.<pid>-<n>.tmp` (`atomic.rs:138-144`) and `.zip.partial`: built from the
  physical name, so they no longer show the logical name. The watcher already ignores them.

## 7. OneDrive conflict copies

OneDrive writes `<b32>-<PC>.mwk` / `<b32>-<PC>-2.mwk`. The mapping splits at the first `-`, so
the copy decodes to the original's logical name. Today the only conflict-copy detection is in
`validate.rs:112-195`; a copy such as `scores/nat/105455-PC.json` is read as an extra record by
every listing. **Proposed (Q6):** listings skip conflict copies (they would decode to a duplicate
logical name); Gegevenscontrole keeps reporting them by their physical name and logical original.

## 8. Path length budget

Encoded name length = `ceil((n + 16) * 8 / 5) + 4` for a file name of `n` bytes (extension
included): 10 -> 46, 20 -> 62, 30 -> 78, 40 -> 94, 50 -> 110, 60 -> 126.

| Relative path (fixture)                                                  | Before | After |
| ------------------------------------------------------------------------ | -----: | ----: |
| `2025-2026/exams/nat-toets-h1-krachten-nergie-herkansing-2025-2026.json` |     70 |   132 |
| `2025-2026/scores/nat/900001.json`                                       |     32 |    69 |
| `afbeeldingen/gebr-1756713600001.png`                                    |     35 |    78 |
| `opdrachten/opdracht_1756713600200/images/schema.svg`                    |     50 |    50 |

Plus the root, e.g. `C:\Users\j.jansen\OneDrive - Stichting Voorbeeldscholen\Sectie NASK\Maatwerk\data\`
(~95 chars): fixture worst case ~230 of the 260 that Explorer handles. Rust's `std::fs` handles
longer paths itself (verbatim prefix), and OneDrive allows 400, but **Explorer** copies fail above
260, and the migration procedure is an Explorer copy of the offline folder. New exam and group
ids are short (`toets-<t36>-<r6>`, `groep-<t>-<r>`); old ones are title slugs **without a length
limit** (`RelPath::parse` has none), so real data may be longer than the fixture (Q3).

**Proposed:** a long-name rule as Cryptomator does: a name whose encoded form would exceed 100
characters (a logical name over 44 bytes) is stored as `<base32 of the first 20 bytes of SHA-256(encrypted name)>.mwk` (36
chars + `.mwk`), with the full encrypted name in the file's header. Only those (rare) files must
be opened to be listed. The migration report states how many files used it.

## 9. Questions for the user

- **Q1 Format marker.** `config.json` `schema_version: 4` (plain) as the marker, so 0.9-0.32
  refuse the folder at start with "nieuwere versie" and never see unreadable files; `school.json`
  fully encrypted, no stub. _Alternative (ADR text):_ a plain `school.json` stub with
  `minAppVersion` + marker, older apps go read-only and then fail on every file they read.
  **Recommended: `schema_version: 4`.**
- **Q2 Names.** Encrypted: every file with encrypted content. Plain: folder names fixed by the
  code and the `opdrachten/<id>` folders. _Alternative (ADR text):_ every name below the top
  level. **Recommended: the rule of section 1.**
- **Q3 Real path lengths.** Please run this on the real `data` folder and paste the four numbers
  (it prints lengths only, no names):
  `$r=(Resolve-Path .).Path; $p=Get-ChildItem -Recurse -File | % { $_.FullName.Length - $r.Length - 1 }; $n=Get-ChildItem -Recurse -File -Filter *.json | % { $_.BaseName.Length }; "root $($r.Length) maxrel $(($p|measure -Max).Maximum) maxstem $(($n|measure -Max).Maximum) over40 $(($n|?{$_ -gt 40}).Count)"`
  (run in PowerShell inside the `data` folder on a teacher PC). Also: is 100 characters a good
  long-name threshold? **Recommended: yes, unless the numbers say otherwise.**
- **Q4 Compression.** Deflate (`flate2`, already a dependency) / zstd (new C dependency) / none.
  **Recommended: deflate.**
- **Q5 Key file copies.** `R/sleutels.json` + `R/snapshots/sleutels.json` + in every snapshot +
  a local cache per PC, with "Sleutel herstellen" from a copy. **Recommended: all four.**
- **Q6 Conflict copies.** Listings skip OneDrive conflict copies of data files (today
  `105455-PC.json` is read as an extra record); Gegevenscontrole reports them. A behaviour change.
  **Recommended: yes.**
- **Q7 Old plain snapshots.** Delete them after the migration's first encrypted snapshot (the
  local plain migration backup remains). _Alternative:_ convert each zip (slow, and the plain
  zips stay in the OneDrive recycle bin anyway). **Recommended: delete.**

## 10. Code that changes (for 41b-b, from the inventory)

- `Storage` gets the logical/physical mapping: `resolve`, `json_files` (sort by **logical**
  name: the order feeds float sums, `mod.rs:432-434`), `list_dir`, `try_list_years`, `read_*`,
  `write_*`, CAS on the ciphertext; `save_photo` and `read_photo_data_url` (`mod.rs:482-501`,
  `540-543`) encrypt and decrypt `afbeeldingen/`.
- `afbeeldingen/` readers outside `Storage`: the rapport's Typst mount `/data/afbeeldingen`
  (`rapport.rs:96, 210-218`) and `find_ignoring_case` for the watermark (`world.rs:345-368`) read
  through the vault (decrypt in memory; list and decode names for the any-case lookup); validate's
  image checks likewise.
- Direct `std::fs` readers of data files that must go through the vault: watcher (`engine.rs`),
  migration planner, validate (`validate.rs:221`), snapshots, CLI `stats`/`numbers`
  (`stats.rs:119-197`), `rubric check` (`rubric.rs:103-109`), AI context (`ai/send.rs:117-131`
  reads `opdracht.json`), `presence::prune_stale`, `data_location::check_chosen`.
- File-name parsers that must work on logical names: `locks.rs:55-159`, `rights.rs:182-199`,
  `rubrics.rs:60-155`, `numbers/load.rs:75-166`, `validate.rs:112-195`, `snapshots::contents`.
- Unchanged: the UI, bridge and TS mock (logical paths), the opdracht Typst mount (plain `.typ`
  and images), the commit lock, `rapporten/`.
- Local plaintext that stays (outside OneDrive, not in scope): migration backup zips, AI
  workspace copies and `undo/` image backups, output PDFs in the cache, `session.json`, logs.
