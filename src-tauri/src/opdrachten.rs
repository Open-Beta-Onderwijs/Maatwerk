// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri commands for opdracht files and images (`ipc-api.md` methods 13-20). The image dialog
//! and the clipboard are used from Rust only: the UI gets a token, never a path, and needs no
//! plugin permissions.

use maatwerk_core::opdracht_images::{self, Stored};
use maatwerk_core::storage::decode_base64_lenient;
use maatwerk_core::typst_svc::create_v1_opdracht_file;
use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, State, Window};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;

use crate::commands::{Res, blocking};
use crate::error::CommandError;
use crate::state::Shared;

/// One image of an opdracht.
#[derive(Serialize, Type)]
pub struct ImageInfo {
    /// Relative to `opdrachten/`: `images/<id>/<name>.<ext>`.
    pub file: String,
    pub name: String,
    /// PNG data URL, 48 px high; `null` for SVG and files that do not decode.
    pub thumb: Option<String>,
}

/// The outcome of saving or importing an image.
#[derive(Serialize, Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ImageStored {
    Saved {
        file: String,
        name: String,
    },
    /// An image with this name exists and `overwrite` was not set.
    Exists {
        name: String,
    },
    /// Not saved; `message` is Dutch text for the teacher.
    Rejected {
        message: String,
    },
}

impl From<Stored> for ImageStored {
    fn from(s: Stored) -> ImageStored {
        match s {
            Stored::Saved { file, name } => ImageStored::Saved { file, name },
            Stored::Exists { name } => ImageStored::Exists { name },
            Stored::Rejected { message } => ImageStored::Rejected { message },
        }
    }
}

/// A file chosen in the dialog: a token for the import, the cleaned name and the extension.
#[derive(Serialize, Type)]
pub struct PickedImage {
    pub token: String,
    pub name: String,
    pub ext: String,
}

/// Writes the base template to `opdrachten/<typFile>` (a bare `.typ` name).
#[tauri::command]
#[specta::specta]
pub async fn create_assignment_typ_file(state: State<'_, Shared>, typ_file: String) -> Res<()> {
    blocking(state, move |c| {
        Ok(create_v1_opdracht_file(c.storage()?, &typ_file)?)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn list_opdracht_images(
    state: State<'_, Shared>,
    opdracht_id: String,
) -> Res<Vec<ImageInfo>> {
    blocking(state, move |c| {
        let images = opdracht_images::list(c.storage()?, &opdracht_id)?;
        Ok(images
            .into_iter()
            .map(|i| ImageInfo {
                file: i.file,
                name: i.name,
                thumb: i.thumb,
            })
            .collect())
    })
    .await
}

/// Saves a pasted image (base64) under a cleaned name.
#[tauri::command]
#[specta::specta]
pub async fn save_opdracht_image(
    state: State<'_, Shared>,
    opdracht_id: String,
    name: String,
    ext: String,
    base64: String,
    overwrite: bool,
) -> Res<ImageStored> {
    blocking(state, move |c| {
        let bytes = decode_base64_lenient(&base64)?;
        let stored =
            opdracht_images::store(c.storage()?, &opdracht_id, &name, &ext, &bytes, overwrite)?;
        Ok(stored.into())
    })
    .await
}

/// Opens the file dialog (`Afbeelding kiezen`); `null` if cancelled. The path stays here.
#[tauri::command]
#[specta::specta]
pub async fn pick_image_file(
    state: State<'_, Shared>,
    app: AppHandle,
    window: Window,
) -> Res<Option<PickedImage>> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Afbeelding kiezen")
            .add_filter("Afbeeldingen", &opdracht_images::IMAGE_EXTS)
            .set_parent(&window)
            .blocking_pick_file()
    })
    .await
    .map_err(|e| CommandError::internal(format!("dialog task failed: {e}")))?;
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_owned();
    let name = opdracht_images::clean_image_name(opdracht_images::stem_of(&file_name));
    let ext = opdracht_images::extension_of(&file_name);
    let token = state.picked().add(path);
    Ok(Some(PickedImage { token, name, ext }))
}

/// Copies the file chosen with `pick_image_file` into the opdracht's images. The token is kept
/// until the import succeeds.
#[tauri::command]
#[specta::specta]
pub async fn import_opdracht_image(
    state: State<'_, Shared>,
    opdracht_id: String,
    token: String,
    name: String,
    overwrite: bool,
) -> Res<ImageStored> {
    blocking(state, move |c| {
        let Some(path) = c.picked().get(&token) else {
            return Ok(ImageStored::Rejected {
                message: "Kies de afbeelding opnieuw.".into(),
            });
        };
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        let ext = opdracht_images::extension_of(file_name);
        let bytes = std::fs::read(&path).map_err(|e| maatwerk_core::Error::Io {
            path: file_name.to_owned(),
            source: e,
        })?;
        let stored =
            opdracht_images::store(c.storage()?, &opdracht_id, &name, &ext, &bytes, overwrite)?;
        if matches!(stored, Stored::Saved { .. }) {
            c.picked().remove(&token);
        }
        Ok(stored.into())
    })
    .await
}

/// The clipboard image as base64 PNG, or `null`.
#[tauri::command]
#[specta::specta]
pub async fn read_clipboard_image(app: AppHandle) -> Res<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        let image = app.clipboard().read_image().ok()?;
        opdracht_images::rgba_to_png_base64(image.rgba(), image.width(), image.height())
    })
    .await
    .map_err(|e| CommandError::internal(format!("clipboard task failed: {e}")))
}

#[tauri::command]
#[specta::specta]
pub async fn copy_opdracht_images(
    state: State<'_, Shared>,
    from_id: String,
    to_id: String,
) -> Res<()> {
    blocking(state, move |c| {
        Ok(opdracht_images::copy(c.storage()?, &from_id, &to_id)?)
    })
    .await
}

/// Deletes the images; a folder OneDrive keeps locked is retried in the background.
#[tauri::command]
#[specta::specta]
pub async fn delete_opdracht_images(state: State<'_, Shared>, opdracht_id: String) -> Res<()> {
    let core = Shared::clone(state.inner());
    blocking(state, move |c| {
        if let Some(dir) = opdracht_images::delete_all(c.storage()?, &opdracht_id)? {
            std::thread::spawn(move || {
                if let Ok(storage) = core.storage() {
                    opdracht_images::remove_dir_later(storage, &dir);
                }
            });
        }
        Ok(())
    })
    .await
}
