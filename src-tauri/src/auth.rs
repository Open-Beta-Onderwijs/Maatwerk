// SPDX-License-Identifier: AGPL-3.0-or-later

//! Accounts and snapshots (Step 7b): PIN login, recovery codes, the admin's PIN reset, and
//! restoring one file from a snapshot. Not reference methods. The logic is in
//! `maatwerk_core::auth` and `maatwerk_core::snapshots`; the login state lives in [`Core`].

use std::time::{Instant, SystemTime};

use maatwerk_core::auth::Check;
use maatwerk_core::rights::Role;
use maatwerk_core::snapshots;
use serde::Serialize;
use serde_json::Value;
use specta::Type;
use tauri::{AppHandle, State, Window};
use tauri_plugin_dialog::DialogExt;

use crate::commands::{Res, blocking, rel};
use crate::error::CommandError;
use crate::state::Shared;

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

/// Login with a PIN; on success the user is logged in on this PC with `role` (`docent`,
/// `bestuur:<vak>` or `beheer`, step 35), which must be theirs; none: beheer for the admin,
/// else docent.
#[tauri::command]
#[specta::specta]
pub async fn verify_pin(
    state: State<'_, Shared>,
    user_id: String,
    pin: String,
    role: Option<String>,
) -> Res<PinCheck> {
    blocking(state, move |c| {
        let now = Instant::now();
        let check = match role {
            Some(role) => {
                c.auth
                    .verify_pin_as(c.storage()?, &user_id, Role::parse(&role)?, &pin, now)?
            }
            None => c.auth.verify_pin(c.storage()?, &user_id, &pin, now)?,
        };
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
    role: Option<String>,
) -> Res<PinCheck> {
    blocking(state, move |c| {
        let (storage, at) = (c.storage()?, SystemTime::now());
        let set = match role {
            Some(role) => {
                c.auth
                    .set_first_pin_as(storage, &user_id, Role::parse(&role)?, &pin, at)?
            }
            None => c.auth.set_first_pin(storage, &user_id, &pin, at)?,
        };
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
    blocking(state, |c| {
        c.auth.logout_from(c.storage().ok());
        Ok(())
    })
    .await
}

/// Step 36 (decision 81): the gast of `vak` logs in without a PIN; from then on this app writes
/// nothing to the data folder (presence excepted) until logout.
#[tauri::command]
#[specta::specta]
pub async fn login_gast(state: State<'_, Shared>, vak: String) -> Res<()> {
    blocking(state, move |c| {
        c.auth.login_gast(c.storage()?, &vak)?;
        Ok(())
    })
    .await
}

/// What "Kopieer naar…" did (step 36).
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CopiedTo {
    pub outcome: PinOutcome,
    pub retry_after_ms: u32,
    /// The new `opdracht.json`, when copied.
    pub opdracht: Option<Value>,
    pub dropped_observaties: u32,
}

/// "Kopieer naar…" (decision 82): a gast copies opdracht `fromId` to sectie `vak` as teacher
/// `teacherId`, who confirms with their PIN.
#[tauri::command]
#[specta::specta]
pub async fn copy_opdracht_to_sectie(
    state: State<'_, Shared>,
    from_id: String,
    vak: String,
    teacher_id: String,
    pin: String,
) -> Res<CopiedTo> {
    blocking(state, move |c| {
        let done = maatwerk_core::copy_to_sectie::copy_opdracht_to_sectie(
            c.storage()?,
            &c.auth,
            &from_id,
            &vak,
            &teacher_id,
            &pin,
            Instant::now(),
            SystemTime::now(),
        )?;
        let check = PinCheck::from(done.check, None);
        Ok(CopiedTo {
            outcome: check.outcome,
            retry_after_ms: check.retry_after_ms,
            opdracht: done.opdracht,
            dropped_observaties: u32::try_from(done.dropped_observaties).unwrap_or(u32::MAX),
        })
    })
    .await
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

/// The printed copies of one school year in `rapporten/` (X-06). Sizes in whole kB, rounded up
/// (u32: specta types f64 as `number | null`, u64 as bigint).
#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RapportenYear {
    pub schooljaar: String,
    pub files: u32,
    pub kb: u32,
}

/// What "Opruimen" deleted, and the copies it could not delete.
#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RapportenCleanup {
    pub files: u32,
    pub kb: u32,
    pub failed: Vec<String>,
}

fn saturate(n: u64) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

/// Bytes as whole kB, rounded up (a 1-byte copy is 1 kB, none is 0).
fn kb(bytes: u64) -> u32 {
    saturate(bytes.div_ceil(1024))
}

/// Beheer › Instellingen: the printed copies per school year, oldest first. Admin only.
#[tauri::command]
#[specta::specta]
pub async fn rapporten_usage(state: State<'_, Shared>) -> Res<Vec<RapportenYear>> {
    blocking(state, move |c| {
        let storage = c.storage()?;
        c.auth.require_admin(storage)?;
        Ok(maatwerk_core::rapporten::usage(storage)?
            .years
            .into_iter()
            .map(|y| RapportenYear {
                schooljaar: y.schooljaar,
                files: saturate(y.files),
                kb: kb(y.bytes),
            })
            .collect())
    })
    .await
}

/// "Opruimen" (decision 85): deletes the printed copies of the school years before `before`.
/// Admin only; refused for a gast and a read-only folder (`maatwerk_core::rapporten::cleanup`).
#[tauri::command]
#[specta::specta]
pub async fn rapporten_cleanup(state: State<'_, Shared>, before: String) -> Res<RapportenCleanup> {
    blocking(state, move |c| {
        let storage = c.storage()?;
        c.auth.require_admin(storage)?;
        let done = maatwerk_core::rapporten::cleanup(storage, &before)?;
        Ok(RapportenCleanup {
            files: saturate(done.files),
            kb: kb(done.bytes),
            failed: done.failed,
        })
    })
    .await
}

/// A snapshot and why it is kept (`dagelijks`, `wekelijks`, `maandelijks`; `null`: only as
/// the newest).
#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotEntry {
    pub name: String,
    pub kind: Option<String>,
}

/// Snapshots in `snapshots/`, newest first (names: `YYYY-MM-DD HHmm.zip`), with the kind
/// `maatwerk_core::snapshots::kinds` gives under the current settings (review 26-28 m6).
#[tauri::command]
#[specta::specta]
pub async fn list_snapshots(state: State<'_, Shared>) -> Res<Vec<SnapshotEntry>> {
    blocking(state, move |c| {
        let storage = c.storage()?;
        let all = snapshots::list(storage)?;
        let kinds = snapshots::kinds(&all, snapshots::Settings::read(storage));
        Ok(all
            .into_iter()
            .map(|s| SnapshotEntry {
                kind: kinds.get(&s.name).map(|k| {
                    match k {
                        snapshots::Kind::Dagelijks => "dagelijks",
                        snapshots::Kind::Wekelijks => "wekelijks",
                        snapshots::Kind::Maandelijks => "maandelijks",
                    }
                    .to_owned()
                }),
                name: s.name,
            })
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
        let storage = c.storage()?;
        let admin = c.auth.require_admin(storage)?;
        Ok(snapshots::restore_file(
            storage,
            &snapshot,
            &rel(&rel_path)?,
            Some(&admin),
            SystemTime::now(),
        )?)
    })
    .await
}
