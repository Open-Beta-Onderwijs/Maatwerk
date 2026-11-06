# Release process

Maatwerk ships as one portable Windows exe (`tauri build --no-bundle`), no installer. Versions
follow SemVer below 1.0 with release candidates (PLAN section 9, item 9): `0.3.0-rc.1`, then
`0.3.0` at the cutover.

## 1. Bump the version

The version lives in two places, kept equal:

- `Cargo.toml` `[workspace.package] version` (app, core, CLI; the exe reports it in "Over
  Maatwerk" and in `problem_info`);
- `ui/package.json` `version`.

Then `npm install` (updates `package-lock.json`), `npm run bindings` if commands changed, and
`npm run notices` if dependencies changed. Commit as `chore(release): vX.Y.Z`.

## 2. Gate

The commands in `CLAUDE.md` (fmt, clippy, tests, lint, typecheck, Vitest, `npm run test:e2e`,
`cargo deny`, `npm run licenses`, SPDX). Plus `npm audit --omit=dev` (must be clean) and the
manual checks the release notes promise (`docs/manual-test.md`).

## 3. Merge, tag, build

1. PR into `main`; CI green; merge with a merge commit.
2. Tag the merge commit: `git tag -a vX.Y.Z -m "Maatwerk X.Y.Z"` and `git push origin vX.Y.Z`
   (version tags are pushed only when the user says so).
3. CI runs on the tag (`.github/workflows/ci.yml`, `tags: ['v*']`) and uploads the artifact
   `maatwerk-windows-x64`: `maatwerk.exe`, `maatwerk.exe.sha256`, `LICENSE`,
   `THIRD_PARTY_NOTICES.txt`. The exe's build string is `git describe` (`vX.Y.Z` on the tag).
   The macOS job uploads `maatwerk-macos-universal`: `Maatwerk-macos-universal.dmg` and `.zip`
   (the `.app`), `SHA256SUMS.txt`, `LICENSE`, `THIRD_PARTY_NOTICES.txt`. The app is universal
   (`lipo` shows `x86_64 arm64`) and ad-hoc signed, not notarised (user decision 2026-11-06):
   README "macOS" has the "Toch openen" steps.
   The Linux job uploads `maatwerk-linux-x86_64`: `Maatwerk-linux-x86_64.AppImage`,
   `maatwerk-linux-amd64.deb`, `SHA256SUMS.txt`, `LICENSE`, `THIRD_PARTY_NOTICES.txt` (built
   on Ubuntu 24.04: glibc 2.39 or newer).

## 4. Publish (manual)

1. Download the artifact; check the checksum:
   `(Get-FileHash maatwerk.exe -Algorithm SHA256).Hash.ToLower()` equals the first word of
   `maatwerk.exe.sha256`.
2. Start it once on a copy of the data (`MAATWERK_DATA_DIR`), check "Over Maatwerk" shows the
   version and build.
   On a Mac: open the `.dmg`, drag the app to Applications, allow it once (README "macOS"),
   check "Over Maatwerk" the same way. On Linux: `sha256sum -c SHA256SUMS.txt`, install the
   `.deb` or start the AppImage (README "Linux"), the same check.
3. Create the GitHub release for the tag with the Windows, macOS and Linux files and short Dutch notes for teachers
   (what changed, anything they must do). AGPL: the source link in the app must point at a
   public commit, so never publish an exe built from unpushed code.
4. Distribute as in `docs/cutover-runbook.md` section 4: the exe in the shared folder next to
   `data\`, replacing the previous one; teachers close the app first.

## Rollback

Give the previous release's exe back. A data format change (schema version) makes an older exe
refuse the folder (`unsupported_schema`); such releases say so in the notes and follow the
runbook's backup steps.
