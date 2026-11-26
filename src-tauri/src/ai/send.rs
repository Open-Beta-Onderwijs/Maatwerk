// SPDX-License-Identifier: AGPL-3.0-or-later

//! Sending a message: one turn of a CLI (decisions 48-55, 63).

use super::*;

/// What the UI sends with a message.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendRequest {
    #[serde(default)]
    message: String,
    #[serde(default)]
    starter: Option<Starter>,
    #[serde(default)]
    context: ContextRequest,
    #[serde(default)]
    attachments: Vec<AttachmentRequest>,
    /// Editor text by file name (`opdracht.typ`, ...).
    #[serde(default)]
    buffers: BTreeMap<String, String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContextRequest {
    #[serde(default)]
    guide: bool,
    #[serde(default)]
    metadata: Option<Value>,
    #[serde(default)]
    diagnostics: bool,
    #[serde(default)]
    pdf: bool,
    /// A file name in the syllabus folder.
    #[serde(default)]
    syllabus: Option<String>,
    /// Opdracht ids (at most 3).
    #[serde(default)]
    others: Vec<String>,
    #[serde(default)]
    images: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentRequest {
    name: String,
    /// A file chosen with a picker (the token of `Picked`).
    #[serde(default)]
    token: Option<String>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    data_base64: Option<String>,
}

/// Sends a message to `provider` about the opdracht and waits for the turn's result
/// (`turn::TurnResult`); events stream through `on_event` (`AiEvent`). One run per opdracht.
#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn ai_send(
    app: AppHandle,
    state: State<'_, Shared>,
    ai: State<'_, Arc<AiState>>,
    gebruiker: String,
    opdracht_id: String,
    provider: String,
    request: Value,
    on_event: Channel<Value>,
) -> Res<Value> {
    // A gast has no AI assistant (step 36); the UI shows none.
    if state
        .get()
        .is_some_and(|c| c.storage().is_ok_and(|s| s.is_guest()))
    {
        return Err(bad("Een gast kan de AI-assistent niet gebruiken."));
    }
    let layout = layout(&app, &gebruiker)?;
    let key = key(&provider)?;
    opdracht_images::check_opdracht_id(&opdracht_id)?;
    let request: SendRequest = from_value(request, "bericht")?;
    let syllabus_dir = syllabus_dir(&app)?;
    let stop = Arc::new(AtomicBool::new(false));
    {
        let mut running = lock(&ai.running);
        if running.contains_key(&opdracht_id) {
            return Err(bad("Er loopt al een AI-opdracht voor deze opdracht."));
        }
        running.insert(opdracht_id.clone(), (key.clone(), stop.clone()));
    }
    let ai_state = Arc::clone(ai.inner());
    let id = opdracht_id.clone();
    let result = blocking(state, move |c| {
        let storage = c.storage()?;
        let data_root = storage.data_dir().root().to_path_buf();
        let opdracht_dir = data_root.join("opdrachten").join(&id);
        if !school_allows_in(storage) {
            return Err(bad("De AI-assistent is uitgeschakeld door je school."));
        }
        let settings = AiSettings::load(&layout.settings_file());
        if !settings.enabled {
            return Err(bad("De AI-assistent staat uit in je AI-instellingen."));
        }
        // Decision 70 for every entry point, not only the panel (review 32 n6).
        if !settings.notice_seen {
            return Err(bad("Lees eerst de uitleg over de AI-assistent."));
        }
        let provider = settings.resolve(&key)?;
        let ctx = request.context;
        let syllabus = match ctx.syllabus {
            Some(name) => {
                // A plain PDF name in the folder: no separators, no drive (`C:x.pdf` would make
                // `join` leave the folder on Windows; review 32 m1).
                if name.contains(['/', '\\', ':'])
                    || name.starts_with('.')
                    || !name.to_ascii_lowercase().ends_with(".pdf")
                {
                    return Err(bad("Ongeldige syllabus."));
                }
                Some(syllabus_dir.join(name))
            }
            None => None,
        };
        let mut others = Vec::new();
        for other in ctx.others.iter().take(3) {
            opdracht_images::check_opdracht_id(other)?;
            let dir = data_root.join("opdrachten").join(other);
            let text = std::fs::read_to_string(dir.join("opdracht.typ"))
                .map_err(|e| io_err(format!("opdrachten/{other}/opdracht.typ"), e))?;
            let title = std::fs::read(dir.join("opdracht.json"))
                .ok()
                .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
                .and_then(|v| v.get("titel").and_then(Value::as_str).map(str::to_owned))
                .unwrap_or_default();
            others.push(OtherOpdracht {
                id: other.clone(),
                title,
                text,
            });
        }
        let mut attachments = Vec::new();
        for a in request.attachments {
            let mut att = Attachment {
                name: a.name,
                path: None,
                text: a.text,
                bytes: None,
            };
            if let Some(token) = a.token {
                att.path = Some(
                    c.picked()
                        .get(&token)
                        .ok_or_else(|| bad("De gekozen bijlage is niet meer beschikbaar."))?,
                );
            }
            if let Some(b64) = a.data_base64 {
                att.bytes =
                    Some(decode_base64_lenient(&b64).map_err(|_| bad("Ongeldige bijlage."))?);
            }
            attachments.push(att);
        }
        let check_program = std::env::current_exe()
            .map_err(|e| CommandError::internal(format!("no program path: {e}")))?;
        let turn = Turn {
            layout,
            opdracht: id,
            provider,
            search: search_path(&ai_state, false),
            time_limit: settings.time_limit(),
            input: TurnInput {
                opdracht_dir,
                buffers: request.buffers,
                message: request.message,
                starter: request.starter,
                context: ContextChoice {
                    guide: ctx.guide,
                    metadata: ctx.metadata,
                    diagnostics: ctx.diagnostics,
                    pdf: ctx.pdf,
                    syllabus,
                    others,
                    images: ctx.images,
                },
                attachments,
                past: Vec::new(),
                check_program,
            },
        };
        let result = turn::run_turn(turn, &stop, |event| {
            if let Ok(v) = serde_json::to_value(&event)
                && let Err(e) = on_event.send(v)
            {
                tracing::warn!("sending an AI event failed: {e}");
            }
        })?;
        to_value(&result)
    })
    .await;
    lock(&ai.running).remove(&opdracht_id);
    result
}
