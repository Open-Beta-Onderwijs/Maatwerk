# Development setup (Windows)

## Required

| Tool              | Version checked (2026-10-25)        | Notes                                                                                     |
| ----------------- | ----------------------------------- | ----------------------------------------------------------------------------------------- |
| rustup            | 1.28.2                              | Toolchain pinned in `rust-toolchain.toml` (1.93.1, MSVC); rustup installs it on first use |
| MSVC build tools  | VS 2022 Community, MSVC 14.44.35207 | Was missing `link.exe` until repaired via VS Installer (see below)                        |
| Windows 10/11 SDK | 10.0.26100.0                        | Was missing until the same repair                                                         |
| Node.js           | 24.14.0 (npm 11.9.0)                | `engines.node >= 24`                                                                      |
| WebView2 runtime  | 155.0.4283.62                       | Ships with Windows 11                                                                     |
| git               | 2.51.0                              |                                                                                           |

Fixing the MSVC/SDK problem: open **Visual Studio Installer** -> Visual Studio 2022 Community ->
**Modify** -> workload **Desktop development with C++**, making sure these are ticked:
_MSVC v143 - VS 2022 C++ x64/x86 build tools (Latest)_ and _Windows 11 SDK_ (any recent version).
If the workload is already ticked, use **Repair** instead. Needs admin rights.

Check afterwards (PowerShell):

```powershell
Get-ChildItem "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\*\bin\Hostx64\x64\link.exe"
Test-Path "C:\Program Files (x86)\Windows Kits\10\Lib"
```

## Optional

- `cargo-deny` 0.20.x (CI runs it). Without a working linker, download the prebuilt
  `x86_64-pc-windows-msvc` release from GitHub instead of `cargo install`.
- `gh` CLI: not installed; only needed to create the GitHub remote from the terminal.

## Pitfalls

- **Run cargo from PowerShell or cmd, not Git Bash.** Git Bash puts coreutils `link` on `PATH`
  before MSVC's `link.exe`, and rustc then fails with `link: extra operand ...`.
- `cargo clippy`/`cargo test` on `maatwerk-app` need `ui/dist` to exist (`npm run build:ui`),
  because `tauri::generate_context!` checks `frontendDist` at compile time.
- **The repo lives inside OneDrive.** `target/` (several GB) and `node_modules/` will be synced and
  can be locked mid-build. Mark the folder "always keep on this device" and exclude `target/` and
  `node_modules/` from sync, set `CARGO_TARGET_DIR` to a folder outside OneDrive, or move the repo.
