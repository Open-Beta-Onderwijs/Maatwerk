// SPDX-License-Identifier: AGPL-3.0-or-later

//! Where the data folder is (step 16a). The order: `$MAATWERK_DATA_DIR`, the project's `data/`
//! in a dev build, the folder chosen on this PC (stored in the local config, never in the shared
//! folder), and `data/` beside the program if that folder exists (how the Windows portable exe
//! has always worked). Nothing found means first run: the UI asks the teacher to choose.
//!
//! A macOS `.app` is a bundle that Gatekeeper may run from a read-only, translocated copy, so a
//! folder beside the program is never used or offered there.

use std::ffi::OsString;
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::jsonfmt::to_js_json;
use crate::paths::DATA_DIR_ENV;
use crate::storage::atomic::write_atomic;
use crate::{Error, Result};

/// The local config file in the app's config folder (beside `session.json`).
pub const LOCAL_CONFIG_FILE: &str = "local-config.json";

/// Settings of this PC only. Unknown fields are kept when the file is rewritten.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalConfig {
    /// The data folder chosen on this PC.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_dir: Option<PathBuf>,
    #[serde(flatten)]
    pub other: Map<String, Value>,
}

impl LocalConfig {
    /// The config at `path`; empty when the file is missing or unreadable (a broken file must
    /// not stop the app: the teacher just chooses the folder again).
    pub fn load(path: &Path) -> LocalConfig {
        let Ok(bytes) = fs::read(path) else {
            return LocalConfig::default();
        };
        serde_json::from_slice(&bytes).unwrap_or_else(|e| {
            tracing::warn!("{LOCAL_CONFIG_FILE} is unreadable, ignored: {e}");
            LocalConfig::default()
        })
    }

    /// Writes the config atomically, creating its folder.
    pub fn save(&self, path: &Path) -> Result<()> {
        let io = |e| Error::io(LOCAL_CONFIG_FILE, e);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(io)?;
        }
        let value = serde_json::to_value(self).expect("plain data serialises");
        write_atomic(path, to_js_json(&value).as_bytes()).map_err(io)
    }
}

/// Why the data folder is where it is; the UI offers "choose another folder" only for the last
/// two.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    /// `$MAATWERK_DATA_DIR`.
    Env,
    /// `data/` in the project folder (debug builds).
    Dev,
    /// Chosen on this PC, from the local config.
    Chosen,
    /// `data/` beside the program.
    BesideApp,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Location {
    pub dir: PathBuf,
    pub source: Source,
}

/// What [`locate`] looks at, gathered by the shell.
#[derive(Debug, Clone)]
pub struct Inputs<'a> {
    /// The value of `$MAATWERK_DATA_DIR` (empty counts as unset).
    pub env_override: Option<OsString>,
    /// The project folder in a dev build.
    pub dev_project_dir: Option<&'a Path>,
    /// From the local config.
    pub chosen: Option<&'a Path>,
    /// The running program.
    pub exe: &'a Path,
}

/// The data folder, or `None` on first run (nothing set, chosen or beside the program).
pub fn locate(inputs: &Inputs<'_>) -> Option<Location> {
    let at = |dir: PathBuf, source| Some(Location { dir, source });
    if let Some(dir) = inputs.env_override.as_ref().filter(|d| !d.is_empty()) {
        return at(PathBuf::from(dir), Source::Env);
    }
    if let Some(project) = inputs.dev_project_dir {
        return at(project.join("data"), Source::Dev);
    }
    if let Some(dir) = inputs.chosen {
        return at(dir.to_path_buf(), Source::Chosen);
    }
    beside_app(inputs.exe)
        .filter(|dir| dir.is_dir())
        .and_then(|dir| at(dir, Source::BesideApp))
}

/// `data/` beside the program; `None` inside a macOS app bundle.
pub fn beside_app(exe: &Path) -> Option<PathBuf> {
    if in_app_bundle(exe) {
        return None;
    }
    Some(exe.parent()?.join("data"))
}

/// True for a path inside a macOS `.app` bundle (`Maatwerk.app/Contents/...`).
pub fn in_app_bundle(path: &Path) -> bool {
    let names: Vec<_> = path
        .components()
        .filter_map(|c| match c {
            Component::Normal(name) => name.to_str(),
            _ => None,
        })
        .collect();
    names
        .windows(2)
        .any(|w| w[0].to_ascii_lowercase().ends_with(".app") && w[1] == "Contents")
}

/// Files a file manager or sync client drops into any folder; a folder with only these counts
/// as empty.
const NOISE: &[&str] = &[".DS_Store", "desktop.ini", "Thumbs.db", ".localized"];

/// The data folder for a folder the teacher picked: the folder itself when it is a data folder
/// or empty, its `data/` subfolder when that is a data folder (the shared folder holding
/// `data/`). Any other folder is refused, so Maatwerk never fills e.g. Documents with its files.
/// The messages are the Dutch text for the UI.
pub fn check_chosen(picked: &Path) -> Result<PathBuf> {
    let refuse = |message: &str| {
        Err(Error::InvalidArgument {
            message: message.to_owned(),
        })
    };
    if !picked.is_absolute() {
        return refuse("Kies een map op deze computer.");
    }
    if in_app_bundle(picked) {
        return refuse("Deze map hoort bij het programma zelf. Kies een andere map.");
    }
    if !picked.is_dir() {
        return refuse("Deze map bestaat niet (meer). Kies een andere map.");
    }
    if is_data_folder(picked) {
        return Ok(picked.to_path_buf());
    }
    let inner = picked.join("data");
    if is_data_folder(&inner) {
        return Ok(inner);
    }
    let entries = fs::read_dir(picked).map_err(|e| Error::io(picked.display().to_string(), e))?;
    let mut others = entries.filter_map(|e| e.ok()).filter(|e| {
        let name = e.file_name();
        !NOISE.iter().any(|n| name == *n)
    });
    if others.next().is_none() {
        return Ok(picked.to_path_buf());
    }
    refuse(
        "In deze map staan andere bestanden en geen gegevens van Maatwerk. Kies de gedeelde \
         gegevensmap (met config.json of de map data erin) of een lege map.",
    )
}

/// A Maatwerk data folder (any schema version) has `config.json` or `gebruikers/`.
fn is_data_folder(dir: &Path) -> bool {
    dir.join("config.json").is_file() || dir.join("gebruikers").is_dir()
}

/// The program file the teacher sees, for [`Inputs::exe`]: an AppImage runs from a read-only
/// mount (`/tmp/.mount_*`), so on Linux the AppImage file itself (`$APPIMAGE`, set by its
/// runtime) when that is an absolute path, so `data/` beside the AppImage works like beside the
/// Windows exe (step 16b).
pub fn program_path(current_exe: PathBuf, appimage: Option<OsString>) -> PathBuf {
    match appimage.map(PathBuf::from) {
        Some(file) if cfg!(target_os = "linux") && file.is_absolute() => file,
        _ => current_exe,
    }
}

/// Reads `$MAATWERK_DATA_DIR`.
pub fn env_override() -> Option<OsString> {
    std::env::var_os(DATA_DIR_ENV)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn exe_in(dir: &Path) -> PathBuf {
        dir.join("maatwerk.exe")
    }

    #[test]
    fn order_env_dev_chosen_beside() {
        let tmp = tempfile::tempdir().unwrap();
        let exe = exe_in(tmp.path());
        let chosen = tmp.path().join("chosen");
        let mut inputs = Inputs {
            env_override: Some("/tmp/d".into()),
            dev_project_dir: Some(Path::new("/proj")),
            chosen: Some(&chosen),
            exe: &exe,
        };
        assert_eq!(locate(&inputs).unwrap().source, Source::Env);
        inputs.env_override = Some("".into());
        let dev = locate(&inputs).unwrap();
        assert_eq!(
            (dev.dir, dev.source),
            (Path::new("/proj").join("data"), Source::Dev)
        );
        inputs.dev_project_dir = None;
        assert_eq!(
            locate(&inputs).unwrap(),
            Location {
                dir: chosen.clone(),
                source: Source::Chosen
            }
        );
        inputs.chosen = None;
        assert_eq!(locate(&inputs), None, "no data/ beside the exe: first run");
        fs::create_dir(tmp.path().join("data")).unwrap();
        assert_eq!(
            locate(&inputs).unwrap(),
            Location {
                dir: tmp.path().join("data"),
                source: Source::BesideApp
            }
        );
    }

    #[test]
    fn never_beside_the_program_in_an_app_bundle() {
        let tmp = tempfile::tempdir().unwrap();
        let macos = tmp.path().join("Maatwerk.app/Contents/MacOS");
        fs::create_dir_all(macos.join("data")).unwrap();
        let exe = macos.join("maatwerk");
        assert!(in_app_bundle(&exe));
        assert_eq!(beside_app(&exe), None);
        let inputs = Inputs {
            env_override: None,
            dev_project_dir: None,
            chosen: None,
            exe: &exe,
        };
        assert_eq!(locate(&inputs), None);
        assert!(!in_app_bundle(Path::new(
            "/Users/x/Maatwerk.application/data"
        )));
        assert!(!in_app_bundle(Path::new("C:/Apps/Maatwerk/maatwerk.exe")));
    }

    #[test]
    fn an_appimage_counts_as_the_program_on_linux() {
        let exe = PathBuf::from("/tmp/.mount_MaatwX/usr/bin/maatwerk");
        let file = std::env::temp_dir().join("Maatwerk.AppImage");
        let got = program_path(exe.clone(), Some(file.clone().into()));
        assert_eq!(
            got,
            if cfg!(target_os = "linux") {
                file
            } else {
                exe.clone()
            }
        );
        assert_eq!(program_path(exe.clone(), Some("relatief".into())), exe);
        assert_eq!(program_path(exe.clone(), None), exe);
    }

    #[test]
    fn chosen_folder_rules() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let refused = |p: &Path| match check_chosen(p) {
            Err(Error::InvalidArgument { message }) => message,
            other => panic!("expected a refusal for {p:?}, got {other:?}"),
        };

        let empty = root.join("leeg");
        fs::create_dir(&empty).unwrap();
        fs::write(empty.join(".DS_Store"), b"x").unwrap();
        assert_eq!(check_chosen(&empty).unwrap(), empty);

        let data = root.join("gegevens");
        fs::create_dir(&data).unwrap();
        fs::write(data.join("config.json"), b"{}").unwrap();
        assert_eq!(check_chosen(&data).unwrap(), data);

        let shared = root.join("Maatwerk gedeeld");
        fs::create_dir_all(shared.join("data/gebruikers")).unwrap();
        fs::write(shared.join("maatwerk.exe"), b"").unwrap();
        assert_eq!(check_chosen(&shared).unwrap(), shared.join("data"));

        let docs = root.join("Documenten");
        fs::create_dir(&docs).unwrap();
        fs::write(docs.join("brief.docx"), b"").unwrap();
        assert!(refused(&docs).contains("andere bestanden"));

        assert!(refused(&root.join("weg")).contains("bestaat niet"));
        assert!(refused(Path::new("relatief")).contains("op deze computer"));
        let bundle = root.join("Maatwerk.app/Contents/Resources");
        fs::create_dir_all(&bundle).unwrap();
        assert!(refused(&bundle).contains("programma zelf"));
    }

    #[test]
    fn local_config_round_trip_keeps_unknown_fields() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("cfg").join(LOCAL_CONFIG_FILE);
        assert_eq!(LocalConfig::load(&path), LocalConfig::default());
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, br#"{"later":1}"#).unwrap();
        let mut config = LocalConfig::load(&path);
        config.data_dir = Some(tmp.path().join("d"));
        config.save(&path).unwrap();
        let back = LocalConfig::load(&path);
        assert_eq!(back.data_dir, Some(tmp.path().join("d")));
        assert_eq!(back.other.get("later"), Some(&Value::from(1)));

        fs::write(&path, b"{ kapot").unwrap();
        assert_eq!(LocalConfig::load(&path), LocalConfig::default());
    }
}
