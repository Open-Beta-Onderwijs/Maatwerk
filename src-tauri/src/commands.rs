// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri commands for storage, presence and the local session (`ipc-api.md` methods 1-5, 7-12,
//! 21-25). Each one parses its arguments, calls `maatwerk_core` on a blocking thread and maps
//! the error. Results are typed; `ui/src/bridge/tauri-api.ts` turns them into the reference's
//! result shapes.

use maatwerk_core::paths::{RelPath, display_path};
use maatwerk_core::storage::{Expect, check_opdracht_typ_path, check_photo_path};
use serde::Serialize;
use serde_json::Value;
use specta::Type;
use tauri::State;

use crate::error::CommandError;
use crate::state::{Core, DataFolderStatus, Shared};

pub(crate) type Res<T> = Result<T, CommandError>;

/// Runs `f` with the core on a blocking thread (all file work blocks).
pub(crate) async fn blocking<T: Send + 'static>(
    state: State<'_, Shared>,
    f: impl FnOnce(&Core) -> Res<T> + Send + 'static,
) -> Res<T> {
    let core = Shared::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || f(&core))
        .await
        .map_err(|e| CommandError::internal(format!("blocking task failed: {e}")))?
}

pub(crate) fn rel(raw: &str) -> Res<RelPath> {
    Ok(RelPath::parse(raw)?)
}

/// A JSON file and the SHA-1 of its bytes, the CAS token for the next write.
#[derive(Serialize, Type)]
pub struct VersionedJson {
    pub data: Value,
    pub hash: String,
}

/// Parsed JSON; `null` if missing; error `corrupt_json` if it does not parse.
#[tauri::command]
#[specta::specta]
pub async fn read_json(state: State<'_, Shared>, rel_path: String) -> Res<Option<Value>> {
    blocking(state, move |c| {
        Ok(c.storage()?.read_json(&rel(&rel_path)?)?)
    })
    .await
}

/// JSON plus hash; `null` if missing.
#[tauri::command]
#[specta::specta]
pub async fn read_json_versioned(
    state: State<'_, Shared>,
    rel_path: String,
) -> Res<Option<VersionedJson>> {
    blocking(state, move |c| {
        let v = c.storage()?.read_json_versioned(&rel(&rel_path)?)?;
        Ok(v.map(|v| VersionedJson {
            data: v.data,
            hash: v.hash,
        }))
    })
    .await
}

/// Writes JSON atomically; returns the hash written. With `cas`, the file must still hash to
/// `expectedHash` (`null`: must not exist), else error `conflict`.
#[tauri::command]
#[specta::specta]
pub async fn write_json(
    state: State<'_, Shared>,
    rel_path: String,
    data: Value,
    cas: bool,
    expected_hash: Option<String>,
) -> Res<String> {
    blocking(state, move |c| {
        let expect = match (cas, expected_hash.as_deref()) {
            (false, _) => Expect::Any,
            (true, None) => Expect::Missing,
            (true, Some(h)) => Expect::Hash(h),
        };
        Ok(c.storage()?.write_json(&rel(&rel_path)?, &data, expect)?)
    })
    .await
}

/// Year folders, newest first.
#[tauri::command]
#[specta::specta]
pub async fn list_years(state: State<'_, Shared>) -> Res<Vec<String>> {
    blocking(state, |c| Ok(c.storage()?.list_years())).await
}

/// Creates the year's folders; returns the year folder's absolute path.
#[tauri::command]
#[specta::specta]
pub async fn ensure_year(state: State<'_, Shared>, year: String) -> Res<String> {
    blocking(state, move |c| {
        Ok(display_path(&c.storage()?.ensure_year(&year)?))
    })
    .await
}

/// Every parsable `*.json` directly in the folder.
#[tauri::command]
#[specta::specta]
pub async fn read_all_json(state: State<'_, Shared>, dir_rel_path: String) -> Res<Vec<Value>> {
    blocking(state, move |c| {
        Ok(c.storage()?.read_all_json(&rel(&dir_rel_path)?)?)
    })
    .await
}

/// Deletes the file; a missing file is fine.
#[tauri::command]
#[specta::specta]
pub async fn delete_file(state: State<'_, Shared>, rel_path: String) -> Res<()> {
    blocking(state, move |c| Ok(c.storage()?.delete(&rel(&rel_path)?)?)).await
}

#[tauri::command]
#[specta::specta]
pub async fn ensure_dir(state: State<'_, Shared>, rel_path: String) -> Res<()> {
    blocking(state, move |c| {
        c.storage()?.ensure_dir(&rel(&rel_path)?)?;
        Ok(())
    })
    .await
}

/// Absolute data folder.
#[tauri::command]
#[specta::specta]
pub async fn get_data_dir(state: State<'_, Shared>) -> Res<String> {
    blocking(state, |c| Ok(display_path(c.storage()?.data_dir().root()))).await
}

/// The data folder and why it could not be opened, if so. Not a reference method: the UI calls
/// it before anything else to show a startup error screen (review 4b m5).
#[tauri::command]
#[specta::specta]
pub async fn data_folder_status(state: State<'_, Shared>) -> Res<DataFolderStatus> {
    blocking(state, |c| Ok(c.data_folder_status())).await
}

/// Restarts the app: "Opnieuw proberen" on the startup error screen opens the folder again.
/// Goes through the normal exit (presence offline, watcher stopped; review 6 m1).
#[tauri::command]
#[specta::specta]
pub fn restart_app(app: tauri::AppHandle) {
    tracing::info!("restart requested from the startup error screen");
    app.request_restart();
}

/// UTF-8 text; `null` if missing.
#[tauri::command]
#[specta::specta]
pub async fn read_text_file(state: State<'_, Shared>, rel_path: String) -> Res<Option<String>> {
    blocking(state, move |c| {
        Ok(c.storage()?.read_text(&rel(&rel_path)?)?)
    })
    .await
}

/// Atomic text write without a check; only `opdrachten/<name>.typ` (backlog n8).
#[tauri::command]
#[specta::specta]
pub async fn write_text_file(
    state: State<'_, Shared>,
    rel_path: String,
    content: String,
) -> Res<()> {
    blocking(state, move |c| {
        let rel = rel(&rel_path)?;
        check_opdracht_typ_path(&rel)?;
        Ok(c.storage()?.write_text(&rel, &content)?)
    })
    .await
}

/// The school year whose folder the watcher polls (ADR-0003 C7); `null`: `config.json`
/// `activeYear`. Not a reference method.
#[tauri::command]
#[specta::specta]
pub async fn set_watch_year(state: State<'_, Shared>, year: Option<String>) -> Res<()> {
    blocking(state, move |c| {
        c.set_watch_year(year);
        Ok(())
    })
    .await
}

/// Writes `users/<userId>.json`; `null` user = logged out. Write failures are only logged.
#[tauri::command]
#[specta::specta]
pub async fn update_presence(
    state: State<'_, Shared>,
    user_id: Option<String>,
    presence: Option<Value>,
) -> Res<()> {
    blocking(state, move |c| {
        Ok(c.presence
            .update(c.storage()?, user_id.as_deref(), presence)?)
    })
    .await
}

/// The machine-local session file; `null` if missing or unreadable.
#[tauri::command]
#[specta::specta]
pub async fn read_local_session(state: State<'_, Shared>) -> Res<Option<Value>> {
    blocking(state, |c| Ok(c.session.read())).await
}

#[tauri::command]
#[specta::specta]
pub async fn write_local_session(state: State<'_, Shared>, data: Value) -> Res<()> {
    blocking(state, move |c| Ok(c.session.write(&data)?)).await
}

/// `data:<mime>;base64,...`; `null` if missing or unreadable.
#[tauri::command]
#[specta::specta]
pub async fn read_photo_as_data_url(
    state: State<'_, Shared>,
    rel_path: String,
) -> Res<Option<String>> {
    blocking(state, move |c| {
        Ok(c.storage()?.read_photo_data_url(&rel(&rel_path)?)?)
    })
    .await
}

/// Only `fotos/<name>` (backlog n8).
#[tauri::command]
#[specta::specta]
pub async fn save_photo(
    state: State<'_, Shared>,
    rel_path: String,
    base64_data: String,
) -> Res<()> {
    blocking(state, move |c| {
        let rel = rel(&rel_path)?;
        check_photo_path(&rel)?;
        Ok(c.storage()?.save_photo(&rel, &base64_data)?)
    })
    .await
}
