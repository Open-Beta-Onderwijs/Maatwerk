# ADR-0006: PIN login, sectievoorzitter role and snapshots

Status: **accepted** (Step 7b, 2026-10-31). Implements PLAN Step 7b and decision 13; additive to
the v2 format of ADR-0003 (no `schema_version` change).

## Context

Maatwerk runs on shared school PCs and every teacher can open any account by clicking a badge.
The user asked for a PIN per teacher, an admin PIN with recovery codes, a sectievoorzitter role
per vak, admin settings and periodic snapshots of the shared folder (PLAN Step 7b). All data
stays plain JSON in a OneDrive folder that every teacher can write.

## Decision

**PINs (`maatwerk-core::auth`).**

- 5-8 digits, stored as Argon2id PHC strings (`argon2` 0.5.3, default parameters
  m=19 MiB, t=2, p=1, random salt) in `gebruikers/<id>.json` as `pinHash`. The admin's ten
  recovery codes (`ABCD-EFGH`, 40 random bits each) as `recoveryCodeHashes`. Plain PINs and codes
  never reach the disk; codes are shown once.
- Hashing and checking happen in Rust only. The UI calls `verifyPin`, `setFirstPin`,
  `changePin`, `resetPin`, `recoverWithCode`, `renewRecoveryCodes`, `logout`.
- **Who is logged in lives in the Rust process** (`Core.auth`), set by a successful PIN check.
  The admin-only commands (`resetPin`, `restoreFromSnapshot`) re-read that user from disk and
  refuse otherwise, so they do not trust the UI. Ordinary data writes (`writeJson`) are not
  gated: the PIN guards the shared PC, not the files.
- **Throttle:** per user (and per user for recovery codes), after the n-th wrong try in a row the
  next is allowed after 0, 2, 4, 8, 16, 32, 60, 60 … seconds. In memory, per app instance: a
  restart clears it (and takes longer than the first waits). Nothing about failures is written to
  the shared folder, so a stranger cannot lock a teacher out on all PCs.
- First PIN: allowed only while the file has no `pinHash` (checked inside the CAS update, so two
  PCs cannot both set one). The admin gets new codes with the first PIN; a recovery code is used
  up and the others stay valid; "Nieuwe herstelcodes" (PIN required) replaces all.
- Last resort: `maatwerk-cli admin reset-pin <data>` removes every admin's PIN and codes.
- Debug builds compile `argon2` and `blake2` with `opt-level = 3` (workspace `Cargo.toml`):
  unoptimised Argon2 makes tests and `tauri dev` logins take seconds.

**Sectievoorzitter.** `school.json` `secties.<vak>.voorzitter = <userId>`, assigned by the admin
(Gebruikers). Not a separate account: a separate badge on the login screen of that vak, the
teacher's own PIN, `_meta.updatedBy` = the teacher. The role exists only in the UI session
(`Store` `_activeRole`) and allows, for the groups of that vak, changing the students and the
assigned teachers in the existing group modal; the other group fields stay locked and creating or
deleting groups stays admin-only. Like the existing admin/teacher split, these are UI rights.

**Settings and snapshots (`maatwerk-core::snapshots`).**

- `instellingen.json` (entity file with `_meta`): `snapshots.intervalHours/daily/weekly/monthly`;
  the admin tab "Instellingen" edits it.
- At start, on a background thread (never delays the window), if the newest snapshot is older than
  the interval: claim `snapshots/state.json` with compare-and-swap (`claim: { by, atMs }`, stale
  after 30 minutes), zip to `<name>.zip.partial`, read it back, rename, note `last` in the state
  file, prune. Retention keeps the newest snapshot and the newest per day / ISO week / month.
- Contents: all `*.json`, `*.typ` and opdracht images; **not** `fotos/` (until measured on a real
  copy, manual test M-SNAP-4), `rapporten/`, `snapshots/`, temp files. The watcher ignores
  `snapshots/`; `validate-data` already did.
- Restoring one JSON file ("Herstellen uit snapshot" in Gegevenscontrole) takes the newest
  snapshot whose copy has a valid stamp (C19). Restoring the whole folder is a manual runbook
  step.

**UI.** The top-bar badge opens an account modal (PIN wijzigen, nieuwe herstelcodes,
uitloggen) instead of logging out on the first click. Badge photos load through one helper
(`utils/badges.js`) on the login screen, the top bar and Gebruikers.

## Consequences

- A teacher without a PIN can be "claimed" by whoever logs in first on that badge; this matches
  the plan ("sets a PIN at the first login") and is visible to the admin ("Nog geen pincode").
- Anyone with write access to the folder can remove a `pinHash`, which is no worse than today:
  the files themselves were never protected. Anyone who can read the folder can also read the
  hashes: a 5-digit PIN (10^5 candidates) can be brute-forced offline in about an hour on one core.
  The PIN stops a colleague at a shared PC, not someone with the files.
- The snapshot claim is compare-and-swap on the local replica: two PCs that start in the same
  minute can both write a zip before OneDrive syncs `state.json`. Retention thins them out, and
  OneDrive conflict copies of a zip (`... 0815-PCNAAM.zip`) count as snapshots so they are pruned.
- "Herstellen uit snapshot" only overwrites a file whose stamp is still bad, with a fresh `_meta`
  (rev + 1, the admin as `updatedBy`); a user file keeps its PIN and recovery code hashes.
- Snapshots inside OneDrive do not survive deleting the whole folder; the runbook points at
  OneDrive's version history.
- Logout is one click more than before.
