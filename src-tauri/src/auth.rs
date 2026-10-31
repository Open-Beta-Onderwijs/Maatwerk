// SPDX-License-Identifier: AGPL-3.0-or-later

//! Accounts and snapshots (Step 7b): PIN login, recovery codes, the admin's PIN reset, and
//! restoring one file from a snapshot. Not reference methods. The logic is in
//! `maatwerk_core::auth` and `maatwerk_core::snapshots`; the login state lives in [`Core`].

use std::time::{Instant, SystemTime};

use maatwerk_core::auth::Check;
use maatwerk_core::snapshots;
use serde::Serialize;
use serde_json::Value;
use specta::Type;
use tauri::{AppHandle, State, Window};
use tauri_plugin_dialog::DialogExt;

use crate::commands::{Res, blocking, rel};
use crate::error::CommandError;
use crate::state::{Core, Shared};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum PinOutcome {
    Ok,
    /// Wrong PIN or code; `retryAfterMs` says when the next try is allowed.
    Wrong,
    /// Too soon after a wrong try: not checked.
    Wait,
    /// The user has no PIN yet and sets one first.
    NoPin,
}

/// Result of every PIN command.
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PinCheck {
    pub outcome: PinOutcome,
    pub retry_after_ms: u32,
    /// The user record as written, when the command changed it.
    pub user: Option<Value>,
    /// New recovery codes, shown once (the admin's first PIN, or renewed codes).
    pub recovery_codes: Option<Vec<String>>,
}

impl PinCheck {
    fn from(check: Check, user: Option<Value>) -> PinCheck {
        let (outcome, wait) = match check {
            Check::Ok => (PinOutcome::Ok, None),
            Check::Wrong { retry_after } => (PinOutcome::Wrong, Some(retry_after)),
            Check::Wait { retry_after } => (PinOutcome::Wait, Some(retry_after)),
            Check::NoPin => (PinOutcome::NoPin, None),
        };
        PinCheck {
            outcome,
            retry_after_ms: wait.map_or(0, |d| d.as_millis().min(u128::from(u32::MAX)) as u32),
            user,
            recovery_codes: None,
        }
    }
}

/// Login with a PIN; on success the user is logged in on this PC.
#[tauri::command]
#[specta::specta]
pub async fn verify_pin(state: State<'_, Shared>, user_id: String, pin: String) -> Res<PinCheck> {
    blocking(state, move |c| {
        let check = c
            .auth
            .verify_pin(c.storage()?, &user_id, &pin, Instant::now())?;
        Ok(PinCheck::from(check, None))
    })
    .await
}

/// First login (or after a reset): sets the PIN of a user without one and logs them in.
#[tauri::command]
#[specta::specta]
pub async fn set_first_pin(
    state: State<'_, Shared>,
    user_id: String,
    pin: String,
) -> Res<PinCheck> {
    blocking(state, move |c| {
        let set = c
            .auth
            .set_first_pin(c.storage()?, &user_id, &pin, SystemTime::now())?;
        Ok(PinCheck {
            recovery_codes: set.recovery_codes,
            ..PinCheck::from(Check::Ok, Some(set.user))
        })
    })
    .await
}

/// The logged-in user changes their PIN.
#[tauri::command]
#[specta::specta]
pub async fn change_pin(
    state: State<'_, Shared>,
    current_pin: String,
    new_pin: String,
) -> Res<PinCheck> {
    blocking(state, move |c| {
        let (check, user) = c.auth.change_pin(
            c.storage()?,
            &current_pin,
            &new_pin,
            Instant::now(),
            SystemTime::now(),
        )?;
        Ok(PinCheck::from(check, user))
    })
    .await
}

/// Admin only: removes a teacher's PIN. Returns the user record as written.
#[tauri::command]
#[specta::specta]
pub async fn reset_pin(state: State<'_, Shared>, user_id: String) -> Res<Value> {
    blocking(state, move |c| {
        Ok(c.auth
            .reset_pin(c.storage()?, &user_id, SystemTime::now())?)
    })
    .await
}

/// "Pincode vergeten": the admin logs in with a recovery code and sets a new PIN.
#[tauri::command]
#[specta::specta]
pub async fn recover_with_code(
    state: State<'_, Shared>,
    user_id: String,
    code: String,
    new_pin: String,
) -> Res<PinCheck> {
    blocking(state, move |c| {
        let (check, user) = c.auth.recover(
            c.storage()?,
            &user_id,
            &code,
            &new_pin,
            Instant::now(),
            SystemTime::now(),
        )?;
        Ok(PinCheck::from(check, user))
    })
    .await
}

/// Admin only, with the PIN: ten new recovery codes replace the old ones.
#[tauri::command]
#[specta::specta]
pub async fn renew_recovery_codes(state: State<'_, Shared>, pin: String) -> Res<PinCheck> {
    blocking(state, move |c| {
        let (check, set) =
            c.auth
                .renew_recovery_codes(c.storage()?, &pin, Instant::now(), SystemTime::now())?;
        Ok(match set {
            Some(set) => PinCheck {
                recovery_codes: set.recovery_codes,
                ..PinCheck::from(check, Some(set.user))
            },
            None => PinCheck::from(check, None),
        })
    })
    .await
}

/// Back to the login screen.
#[tauri::command]
#[specta::specta]
pub async fn logout(state: State<'_, Shared>) -> Res<()> {
    state.auth.logout();
    Ok(())
}

/// "Opslaan als" for the recovery codes: a save dialog, then the text as a UTF-8 file. Returns
/// the path, `null` when cancelled.
#[tauri::command]
#[specta::specta]
pub async fn save_text_as(
    app: AppHandle,
    window: Window,
    default_name: String,
    content: String,
) -> Res<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        let picked = app
            .dialog()
            .file()
            .set_title("Opslaan als")
            .set_file_name(&default_name)
            .add_filter("Tekst", &["txt"])
            .set_parent(&window)
            .blocking_save_file();
        let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
            return Ok(None);
        };
        std::fs::write(&path, content.as_bytes()).map_err(|e| {
            CommandError::from(maatwerk_core::Error::Io {
                path: path.display().to_string(),
                source: e,
            })
        })?;
        Ok(Some(path.display().to_string()))
    })
    .await
    .map_err(|e| CommandError::internal(format!("dialog task failed: {e}")))?
}

/// Snapshots in `snapshots/`, newest first (names: `YYYY-MM-DD HHmm.zip`).
#[tauri::command]
#[specta::specta]
pub async fn list_snapshots(state: State<'_, Shared>) -> Res<Vec<String>> {
    blocking(state, move |c| {
        Ok(snapshots::list(c.storage()?)?
            .into_iter()
            .map(|s| s.name)
            .collect())
    })
    .await
}

/// The newest snapshot with an intact copy of the JSON file; `null` if none has one.
#[tauri::command]
#[specta::specta]
pub async fn snapshot_for_file(state: State<'_, Shared>, rel_path: String) -> Res<Option<String>> {
    blocking(state, move |c| {
        Ok(snapshots::find_intact_copy(c.storage()?, &rel(&rel_path)?)?.map(|s| s.name))
    })
    .await
}

/// "Herstellen uit snapshot": writes that snapshot's copy of the JSON file back. Admin only.
#[tauri::command]
#[specta::specta]
pub async fn restore_from_snapshot(
    state: State<'_, Shared>,
    rel_path: String,
    snapshot: String,
) -> Res<()> {
    blocking(state, move |c| {
        require_admin(c)?;
        Ok(snapshots::restore_file(
            c.storage()?,
            &snapshot,
            &rel(&rel_path)?,
        )?)
    })
    .await
}

fn require_admin(c: &Core) -> Res<()> {
    let storage = c.storage()?;
    let admin = c.auth.session().and_then(|id| {
        let user = storage
            .read_json(&maatwerk_core::auth::user_path(&id).ok()?)
            .ok()??;
        (user.get("isAdmin") == Some(&Value::Bool(true))).then_some(())
    });
    admin.ok_or_else(|| {
        maatwerk_core::Error::InvalidArgument {
            message: "Alleen de beheerder mag dit.".into(),
        }
        .into()
    })
}
