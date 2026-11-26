// SPDX-License-Identifier: AGPL-3.0-or-later

//! The proposal of a turn: its view, Toepassen, the images and Ongedaan maken (decisions
//! 56, 68, 69; review 32 m4).

use super::*;

pub(super) fn proposal_of(layout: &Layout, opdracht: &str, key: &ProviderKey) -> Res<Proposal> {
    turn::saved_proposal(layout, opdracht, key).ok_or_else(|| bad("Er is geen voorstel (meer)."))
}

/// The last proposal with every hunk's status against the editor's current text
/// (`{ proposal, statuses: { [file]: HunkStatus[] } }`).
#[tauri::command]
#[specta::specta]
pub async fn ai_proposal(
    app: AppHandle,
    gebruiker: String,
    opdracht_id: String,
    provider: String,
    current: BTreeMap<String, String>,
) -> Res<Value> {
    let layout = layout(&app, &gebruiker)?;
    let key = key(&provider)?;
    off_thread(move || {
        let p = proposal_of(&layout, &opdracht_id, &key)?;
        let statuses: BTreeMap<&str, Vec<diff::HunkStatus>> = p
            .files
            .iter()
            .map(|f| {
                let cur = current.get(&f.path).map_or(f.base.as_str(), String::as_str);
                (f.path.as_str(), diff::rebase(&f.hunks, &f.base, cur))
            })
            .collect();
        Ok(json!({ "proposal": to_value(&p)?, "statuses": to_value(&statuses)? }))
    })
    .await
}

/// "Toepassen" (decisions 56, 68): the chosen hunks onto the current text, returned for the
/// editor, which records one undo step. Nothing is written into the opdracht: the chosen
/// images (checked against the proposal) come back for the editor to store with its next save,
/// [`ai_commit_images`] (review 32 m4). The call has no effect on disk but the history, so the
/// editor may ask again when the teacher typed during the round trip (review 32 m3).
#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn ai_apply(
    app: AppHandle,
    gebruiker: String,
    opdracht_id: String,
    provider: String,
    current: BTreeMap<String, String>,
    hunks: BTreeMap<String, Vec<u32>>,
    images: Vec<String>,
) -> Res<Value> {
    let layout = layout(&app, &gebruiker)?;
    let key = key(&provider)?;
    off_thread(move || {
        let p = proposal_of(&layout, &opdracht_id, &key)?;
        let mut files = BTreeMap::new();
        let mut any = false;
        for f in &p.files {
            let Some(chosen) = hunks.get(&f.path) else {
                continue;
            };
            let chosen: Vec<usize> = chosen.iter().map(|&h| h as usize).collect();
            let cur = current.get(&f.path).map_or(f.base.as_str(), String::as_str);
            let applied = diff::apply(f, cur, &chosen);
            any |= !applied.applied.is_empty();
            files.insert(f.path.clone(), to_value(&applied)?);
        }
        let chosen = apply::chosen_images(&p, &images)?;
        // Review 32 n8: only a proposal of which something was taken counts as applied.
        if any || !chosen.is_empty() {
            let history = layout.history_file(&opdracht_id, &key)?;
            let mut conv = Conversation::load(&history, &key);
            conv.set_applied(true);
            conv.save(&history)?;
        }
        let images: Vec<Value> = chosen
            .iter()
            .map(|i| json!({ "path": i.path, "new": i.new }))
            .collect();
        Ok(json!({ "files": files, "images": images }))
    })
    .await
}

/// The images of an applied proposal into the opdracht's `images/`, called by the editor just
/// before it saves the text that uses them (review 32 m4); the images they replace are kept for
/// [`ai_undo_images`].
#[tauri::command]
#[specta::specta]
pub async fn ai_commit_images(
    app: AppHandle,
    state: State<'_, Shared>,
    gebruiker: String,
    opdracht_id: String,
    provider: String,
    images: Vec<String>,
) -> Res<Value> {
    let layout = layout(&app, &gebruiker)?;
    let key = key(&provider)?;
    blocking(state, move |c| {
        let p = proposal_of(&layout, &opdracht_id, &key)?;
        let undo = layout.run_dir(&opdracht_id, &key)?.join("undo");
        let saved: Vec<Value> =
            apply::apply_images(c.storage()?, &opdracht_id, &p, &images, &undo)?
                .into_iter()
                .map(|a| json!({ "path": a.path, "new": a.new }))
                .collect();
        let history = layout.history_file(&opdracht_id, &key)?;
        let mut conv = Conversation::load(&history, &key);
        conv.set_applied(true);
        conv.save(&history)?;
        Ok(Value::Array(saved))
    })
    .await
}

/// "Ongedaan maken": removes the images [`ai_apply`] added and puts back the ones it replaced
/// (none: only the history), and marks the proposal as not applied again. (The text goes back
/// through the editor's undo.)
#[tauri::command]
#[specta::specta]
pub async fn ai_undo_images(
    app: AppHandle,
    state: State<'_, Shared>,
    gebruiker: String,
    opdracht_id: String,
    provider: String,
    images: Vec<String>,
) -> Res<()> {
    let layout = layout(&app, &gebruiker)?;
    let key = key(&provider)?;
    blocking(state, move |c| {
        let undo = layout.run_dir(&opdracht_id, &key)?.join("undo");
        apply::undo_images(c.storage()?, &opdracht_id, &images, &undo)?;
        let history = layout.history_file(&opdracht_id, &key)?;
        let mut conv = Conversation::load(&history, &key);
        conv.set_applied(false);
        conv.save(&history)?;
        Ok(())
    })
    .await
}

/// An image of the proposal as a data URL (Voorstel bekijken).
#[tauri::command]
#[specta::specta]
pub async fn ai_proposal_image(
    app: AppHandle,
    gebruiker: String,
    opdracht_id: String,
    provider: String,
    path: String,
) -> Res<String> {
    let layout = layout(&app, &gebruiker)?;
    let key = key(&provider)?;
    off_thread(move || {
        let p = proposal_of(&layout, &opdracht_id, &key)?;
        let img = p
            .images
            .iter()
            .find(|i| i.path == path)
            .ok_or_else(|| bad("Onbekende afbeelding."))?;
        let bytes = std::fs::read(&img.source).map_err(|e| io_err(path.clone(), e))?;
        let mime = match extension_of(&path).as_str() {
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "svg" => "image/svg+xml",
            "webp" => "image/webp",
            _ => "image/png",
        };
        Ok(format!(
            "data:{mime};base64,{}",
            maatwerk_core::storage::encode_base64(&bytes)
        ))
    })
    .await
}
