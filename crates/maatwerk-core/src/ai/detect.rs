// SPDX-License-Identifier: AGPL-3.0-or-later

//! Finding the AI CLIs on this computer (decision 49, ADR-0009 finding 2).
//!
//! The search path is the process's `PATH` plus the folders the vendors' installers use by
//! default. On macOS and Linux an app started from Finder or a desktop launcher does not get the
//! login shell's `PATH`, so [`SearchPath::discover`] also asks the login shell once. The same
//! path is given to the CLI when it runs ([`SearchPath::env_value`]): npm-installed CLIs start
//! with `#!/usr/bin/env node` and need Node on it.

use std::collections::HashSet;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;

use super::provider::{AiSettings, ProviderKey};
use super::run::quick_output;

/// How long `--version` and the login shell may take.
const PROBE_TIMEOUT: Duration = Duration::from_secs(10);

/// An ordered list of folders to look for commands in.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SearchPath {
    dirs: Vec<PathBuf>,
}

impl SearchPath {
    pub fn new(dirs: impl IntoIterator<Item = PathBuf>) -> SearchPath {
        let mut seen = HashSet::new();
        SearchPath {
            dirs: dirs
                .into_iter()
                .filter(|d| !d.as_os_str().is_empty() && seen.insert(d.clone()))
                .collect(),
        }
    }

    /// `PATH` of this process, the login shell's `PATH` (macOS, Linux) and the installers'
    /// default folders. Runs a shell, so call it off the UI thread and keep the result.
    pub fn discover() -> SearchPath {
        let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
            .map(|p| std::env::split_paths(&p).collect())
            .unwrap_or_default();
        if cfg!(unix)
            && let Some(p) = login_shell_path()
        {
            dirs.extend(std::env::split_paths(&p));
        }
        dirs.extend(default_dirs());
        SearchPath::new(dirs)
    }

    pub fn dirs(&self) -> &[PathBuf] {
        &self.dirs
    }

    /// The value for the CLI's `PATH`.
    pub fn env_value(&self) -> OsString {
        std::env::join_paths(&self.dirs).unwrap_or_default()
    }

    /// The program for `command`: an absolute path as it is (if it exists), else the first
    /// match in the folders. On Windows the `PATHEXT` extensions are tried (`.exe`, `.cmd`, ...).
    pub fn find(&self, command: &str) -> Option<PathBuf> {
        let command = command.trim();
        if command.is_empty() {
            return None;
        }
        let as_path = Path::new(command);
        if as_path.is_absolute() {
            return candidates(as_path).into_iter().find(|p| is_program(p));
        }
        if as_path.components().count() > 1 {
            return None;
        }
        self.dirs
            .iter()
            .flat_map(|d| candidates(&d.join(command)))
            .find(|p| is_program(p))
    }
}

/// `path` itself, and on Windows with every `PATHEXT` extension when it has none.
fn candidates(path: &Path) -> Vec<PathBuf> {
    if cfg!(windows) && path.extension().is_none() {
        let exts = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
        exts.split(';')
            .filter(|e| !e.is_empty())
            .map(|e| {
                let mut s = path.as_os_str().to_owned();
                s.push(e.to_ascii_lowercase());
                PathBuf::from(s)
            })
            .collect()
    } else {
        vec![path.to_path_buf()]
    }
}

#[cfg(unix)]
fn is_program(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    p.metadata()
        .is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn is_program(p: &Path) -> bool {
    p.is_file()
}

/// The folders the installers put the CLIs in (ADR-0009 tables, "Detection").
fn default_dirs() -> Vec<PathBuf> {
    let home =
        std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from);
    let mut dirs = Vec::new();
    if let Some(home) = &home {
        dirs.push(home.join(".local").join("bin"));
    }
    if cfg!(windows) {
        if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
            dirs.push(local.join("agy").join("bin"));
            dirs.push(local.join("Microsoft").join("WinGet").join("Links"));
        }
        if let Some(roaming) = std::env::var_os("APPDATA").map(PathBuf::from) {
            dirs.push(roaming.join("npm"));
            dirs.extend(
                newest_first(&roaming.join("Python"), |name| name.starts_with("Python"))
                    .into_iter()
                    .map(|d| d.join("Scripts")),
            );
        }
    } else {
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
        if let Some(home) = &home {
            dirs.push(home.join(".npm-global").join("bin"));
            dirs.extend(
                newest_first(&home.join(".nvm/versions/node"), |_| true)
                    .into_iter()
                    .map(|d| d.join("bin")),
            );
        }
    }
    dirs
}

/// The subfolders of `dir` whose name passes `keep`, by name descending (newest version first).
fn newest_first(dir: &Path, keep: impl Fn(&str) -> bool) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut found: Vec<PathBuf> = entries
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .filter(|e| e.file_name().to_str().is_some_and(&keep))
        .map(|e| e.path())
        .collect();
    found.sort();
    found.reverse();
    found
}

/// The login shell's `PATH`: `$SHELL -l -i -c` printing it between markers (an interactive
/// shell reads the rc files where nvm and friends set it up).
#[cfg(unix)]
fn login_shell_path() -> Option<OsString> {
    use std::os::unix::ffi::OsStringExt;
    let shell = std::env::var_os("SHELL").unwrap_or_else(|| "/bin/sh".into());
    let mut cmd = std::process::Command::new(shell);
    cmd.args([
        "-l",
        "-i",
        "-c",
        "echo __MAATWERK_PATH__; printenv PATH; echo __MAATWERK_PATH__",
    ]);
    let out = quick_output(cmd, PROBE_TIMEOUT)?;
    let text = String::from_utf8_lossy(&out.stdout);
    let mut parts = text.split("__MAATWERK_PATH__");
    parts.next()?;
    let path = parts.next()?.trim();
    (!path.is_empty()).then(|| OsString::from_vec(path.as_bytes().to_vec()))
}

#[cfg(not(unix))]
#[allow(dead_code)]
fn login_shell_path() -> Option<OsString> {
    None
}

/// One provider as the rail and the settings show it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detected {
    pub key: ProviderKey,
    pub name: String,
    /// The command as configured.
    pub command: String,
    /// The program found; `None`: not installed (or not on the path).
    pub path: Option<PathBuf>,
    /// The first line of `--version`, when it answered in time.
    pub version: Option<String>,
}

/// Every provider of `settings`, found or not, with versions (asked in parallel).
pub fn detect(settings: &AiSettings, search: &SearchPath) -> Vec<Detected> {
    let found: Vec<(super::provider::Resolved, Option<PathBuf>)> = settings
        .resolved()
        .into_iter()
        .map(|r| {
            let path = search.find(&r.command);
            (r, path)
        })
        .collect();
    std::thread::scope(|scope| {
        let handles: Vec<_> = found
            .into_iter()
            .map(|(r, path)| {
                let env_path = search.env_value();
                scope.spawn(move || {
                    let version = path.as_deref().and_then(|p| version_of(p, &env_path));
                    Detected {
                        key: r.key,
                        name: r.name,
                        command: r.command,
                        path,
                        version,
                    }
                })
            })
            .collect();
        handles.into_iter().filter_map(|h| h.join().ok()).collect()
    })
}

/// The first non-empty line of `<program> --version`, at most 80 characters.
pub fn version_of(program: &Path, env_path: &OsString) -> Option<String> {
    let mut cmd = std::process::Command::new(program);
    cmd.arg("--version").env("PATH", env_path);
    let out = quick_output(cmd, PROBE_TIMEOUT)?;
    let text = String::from_utf8_lossy(&out.stdout);
    let line = text.lines().map(str::trim).find(|l| !l.is_empty())?;
    Some(line.chars().take(80).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn program(dir: &Path, name: &str) -> PathBuf {
        let path = dir.join(name);
        fs::write(&path, "#!/bin/sh\necho 'tool 1.2.3'\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        }
        path
    }

    #[test]
    fn finds_in_order_and_absolute_paths() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let name = if cfg!(windows) { "tool.cmd" } else { "tool" };
        let in_b = program(b.path(), name);
        let search = SearchPath::new([a.path().into(), b.path().into(), a.path().into()]);
        assert_eq!(search.dirs().len(), 2);
        assert_eq!(search.find("tool"), Some(in_b.clone()));
        let in_a = program(a.path(), name);
        assert_eq!(search.find("tool"), Some(in_a));
        assert_eq!(search.find(&in_b.to_string_lossy()), Some(in_b));
        assert_eq!(search.find("missing"), None);
        assert_eq!(search.find("sub/tool"), None);
        assert_eq!(search.find(""), None);
    }

    #[test]
    fn detect_lists_every_provider_and_reads_versions() {
        let dir = tempfile::tempdir().unwrap();
        if cfg!(windows) {
            fs::write(
                dir.path().join("vibe.cmd"),
                "@echo off\r\necho vibe 3.0.4\r\n",
            )
            .unwrap();
        } else {
            let p = program(dir.path(), "vibe");
            fs::write(&p, "#!/bin/sh\necho 'vibe 3.0.4'\n").unwrap();
        }
        let search = SearchPath::new([dir.path().to_path_buf()]);
        let found = detect(&AiSettings::default(), &search);
        assert_eq!(found.len(), 6);
        let vibe = found.iter().find(|d| d.key.as_str() == "vibe").unwrap();
        assert!(vibe.path.is_some());
        assert_eq!(vibe.version.as_deref(), Some("vibe 3.0.4"));
        assert!(
            found
                .iter()
                .filter(|d| d.key.as_str() != "vibe")
                .all(|d| d.path.is_none())
        );
    }
}
