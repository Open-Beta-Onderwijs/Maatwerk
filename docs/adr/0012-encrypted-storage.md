# ADR-0012: Encrypted storage in the shared folder

Status: **proposed**, 2026-11-22 (the user's design answers, recorded before step 41b). Accepted
only together with the storage layout report of step 41b (sub-task 1), which the user approves
first.

## Context

The rights of steps 35-36 (own groups only, Sectiesecretaris, Gast) are enforced by the app. The
data itself is plain JSON in a shared OneDrive folder, so any colleague with folder access can read
it in Notepad and change a grade on disk without the app noticing. A fully offline app cannot
truly secure this: whoever runs the app holds whatever key the app holds. The goal is to make
reading and editing on disk a real hassle, which stops nosy colleagues, not a determined attacker
who extracts the key from the exe. OneDrive permissions and the colleagues' good faith remain the
real trust boundary.

## Decision (the user's answers, 2026-11-22)

1. **Goal: stop reading and editing.** Authenticated encryption: an edited, truncated or swapped
   file fails to open. Not prevented (stated in the docs): rollback through OneDrive version
   history and deleting files. Snapshots and OneDrive history are the defence there.
2. **Contents: XChaCha20-Poly1305** (RustCrypto `chacha20poly1305`, MIT/Apache). The 192-bit
   random nonce is safe with many PCs writing the same files and no shared counter. File format:
   magic `MWK1`, format version, key id, nonce, ciphertext + tag. Associated data = the logical
   path relative to the root (forward slashes) + the format version, so a file copied over
   another one fails. Compression (zstd) before encryption is decided in sub-task 1.
3. **Names: encrypted below the top level, folders kept.** Top-level folders keep their names.
   Below them, every folder and file name not on the plain list is encrypted per component with
   **AES-SIV** (RustCrypto `aes-siv`, deterministic and reversible, as Cryptomator does), with the
   parent's logical path as associated data, encoded as **lowercase base32 without padding**
   (OneDrive and Windows ignore case). Being reversible, a folder can be listed without opening
   its files, which matters with OneDrive Files On-Demand (opening would download every file). No
   index file: one mapping file written by every PC would breed conflict copies.
4. **Keys: a KEK built into the exe wraps a DEK per school.** KEK = 32 bytes from
   `MAATWERK_MASTER_KEY`, read at build time; locally from `.env` (gitignored, `.env.example`
   committed with a placeholder), on CI from a repository secret. The school's random DEK is
   stored wrapped (XChaCha20-Poly1305, associated data = the school id) in a key file in the
   shared folder. Its entries carry key ids, so the key can be rotated and old snapshots still
   open. Content and name keys are derived from the DEK with HKDF-SHA256.
   - A **release build without the key fails**. Debug and test builds use a fixed public test key
     with its own key id; a release app refuses data under the test key id.
   - The KEK constant is lightly scrambled in the binary (split and XOR at build time): only
     against `strings`, not a security measure.
5. **Plain on disk:** `rapporten/` PDFs, opdrachten Typst sources ("Openen in editor" keeps
   working) and the images inside an opdracht folder (Typst reads them by name), and a small
   plain `school.json` version stub (`minAppVersion` + format
   marker) that older apps can still read. The real school settings move to an encrypted file.
   **Encrypted, not plain** (user, 2026-11-28): `afbeeldingen/` (student and teacher photos,
   school logo, watermark), names and contents; there was no reason to keep it plain. The
   rapport reads them through the vault.
6. **Migration: automatic on the first start** of the new version, when the stub has no format
   marker. The user's procedure: run it on an up-to-date offline copy, then replace the online
   folder in one go, while nobody else touches the data. The code still guards against misuse:
   claim file, `minAppVersion` raised first, convert, verify that every file decrypts, flip the
   marker last. It is resumable if interrupted.
7. **Tamper check failed:** the file is refused. A Dutch message ("gewijzigd buiten Maatwerk")
   is shown and that item stays read-only. The admin restores it from a snapshot or from OneDrive
   version history. Never a silent fallback or auto-restore.
8. **Dev tool:** `maatwerk-cli decrypt <folder> <out>` and `encrypt`, key from `.env` at run
   time; never shipped to schools.

## Consequences and open points (settled in step 41b)

- **Key loss = data loss.** Keep the KEK backed up outside GitHub (password manager or paper).
  The key file is a single point of failure: snapshots include it, and a second copy is kept
  (where: sub-task 1).
- **Plain leftovers.** Existing snapshots in the shared folder are plain: convert or delete them
  during migration. The old plain files stay in the OneDrive recycle bin and version history
  until purged (the owner may want to empty them).
- **OneDrive conflict copies** (`<name>-<PC>.ext`, `-<PC>-2`): the suffix is split off before
  decoding (base32 has no `-`). Path length budget and the file extension (none, or a neutral
  one) are settled in sub-task 1.
- **No-op writes.** Every write has a fresh nonce, so identical content still changes the bytes:
  skip a write when the plain content is unchanged. The content hash and CAS checks of the
  watcher work on the ciphertext.
- **Older apps:** a 0.27-0.32 app reads the stub, goes read-only and cannot read the rest. Its
  behaviour is checked with the 0.27 exe.
- **Mock backend:** encryption lives in `maatwerk-core` storage only; the UI and the TS mock keep
  logical paths, so the e2e suite does not change.
- **AGPL (open).** The source is public; whether a built-in key counts as "Corresponding Source"
  is unsettled. The user decides, possibly with advice. The DEK-per-school design limits what one
  leaked key exposes.
- Wording in the docs and towards schools: "afgeschermd" (obfuscated), not "versleuteld beveiligd".
  It does not change the school's AVG position.

## Alternatives considered

- Integrity only (a MAC per file, plain JSON): simplest and debuggable, but snooping stays
  possible. Rejected by goal 1.
- Contents only, names plain: leaks which exams and groups exist. Rejected.
- Flat random layout: hides structure too, but every listing downloads files on On-Demand and the
  watcher/snapshot code needs a rewrite. Rejected.
- One master key for everything: a leak exposes every school and rotation means re-encrypting
  everything. Rejected.
- School key typed in per PC (no secret in the exe): avoids the AGPL question, but means more
  onboarding work, and every PC still holds the key. Rejected for now.
- Per-teacher signatures: short PINs are brute-forced offline once the exe key is known; much
  work. Not now.
- Per-sectie OneDrive/SharePoint permissions: the only real enforcement, but up to IT. Can be
  combined later.
- One encrypted SQLite file: OneDrive with concurrent writers corrupts it. Rejected.
