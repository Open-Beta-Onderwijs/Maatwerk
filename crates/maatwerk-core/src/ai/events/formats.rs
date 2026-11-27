// SPDX-License-Identifier: AGPL-3.0-or-later

//! One reader per CLI output format (ADR-0009 "Streaming" rows), on [`Parser`].

use super::*;

impl Parser {
    /// `claude -p --output-format stream-json --verbose`.
    pub(super) fn claude(&mut self, v: &Value, out: &mut Vec<AiEvent>) {
        let kind = str_at(v, "type").unwrap_or_default();
        let subtype = str_at(v, "subtype").unwrap_or_default();
        match (kind, subtype) {
            ("system", "init") => {
                if let Some(id) = str_at(v, "session_id") {
                    self.set_session(id.to_owned(), out);
                }
            }
            ("system", "api_retry") => {
                let error = str_at(v, "error").unwrap_or("unknown");
                if error == "authentication_failed" {
                    self.auth_failed = true;
                }
                out.push(AiEvent::Notice {
                    message: format!("Opnieuw proberen ({error})"),
                });
            }
            ("system", "permission_denied") => out.push(AiEvent::Notice {
                message: format!(
                    "Geweigerd: {}",
                    str_at(v, "tool_name").unwrap_or("een actie")
                ),
            }),
            ("assistant", _) => {
                for block in content_blocks(v) {
                    match str_at(block, "type") {
                        Some("text") => {
                            let t = str_at(block, "text").unwrap_or_default().to_owned();
                            self.text(&t, false, out);
                        }
                        Some("tool_use") => {
                            let name = str_at(block, "name").unwrap_or("tool").to_owned();
                            self.step(&name, block.get("input"), out);
                        }
                        _ => {}
                    }
                }
            }
            ("user", _) => {
                for block in content_blocks(v) {
                    if str_at(block, "type") == Some("tool_result") {
                        out.push(AiEvent::StepOutput {
                            text: clip(&flatten_text(block.get("content"))),
                            error: block.get("is_error").and_then(Value::as_bool) == Some(true),
                        });
                    }
                }
            }
            ("result", _) => {
                if let Some(id) = str_at(v, "session_id") {
                    self.set_session(id.to_owned(), out);
                }
                let result = str_at(v, "result").map(str::to_owned);
                let is_error = v.get("is_error").and_then(Value::as_bool) == Some(true)
                    || subtype.starts_with("error");
                if is_error {
                    self.error = Some(result.unwrap_or_else(|| subtype.to_owned()));
                } else if let Some(r) = result {
                    self.answer = Some(r);
                }
            }
            _ => {}
        }
    }

    /// `codex exec --json`.
    pub(super) fn codex(&mut self, v: &Value, out: &mut Vec<AiEvent>) {
        match str_at(v, "type").unwrap_or_default() {
            "thread.started" => {
                if let Some(id) = str_at(v, "thread_id") {
                    self.set_session(id.to_owned(), out);
                }
            }
            "turn.failed" => {
                self.error = Some(
                    v.pointer("/error/message")
                        .and_then(Value::as_str)
                        .unwrap_or("turn failed")
                        .to_owned(),
                );
            }
            "error" => {
                let message = str_at(v, "message").unwrap_or("error").to_owned();
                out.push(AiEvent::Notice {
                    message: message.clone(),
                });
                self.keep_tail(&message);
                self.error = Some(message);
            }
            t if t.starts_with("item.") => {
                let Some(item) = v.get("item") else { return };
                let started = t == "item.started";
                match str_at(item, "type").unwrap_or_default() {
                    "agent_message" if !started => {
                        let text = str_at(item, "text").unwrap_or_default().to_owned();
                        self.text(&text, false, out);
                    }
                    "reasoning" if !started => out.push(AiEvent::Step {
                        step: StepKind::Thinking,
                        title: "Nadenken".into(),
                        detail: str_at(item, "text").map(clip),
                    }),
                    "command_execution" => {
                        if started || item.get("aggregated_output").is_none() {
                            let command = str_at(item, "command").unwrap_or_default();
                            out.push(command_step(command));
                        }
                        if !started {
                            let code = item.get("exit_code").and_then(Value::as_i64);
                            out.push(AiEvent::StepOutput {
                                text: clip(str_at(item, "aggregated_output").unwrap_or_default()),
                                error: code.is_some_and(|c| c != 0),
                            });
                        }
                    }
                    "file_change" if !started => {
                        let paths: Vec<&str> = item
                            .get("changes")
                            .and_then(Value::as_array)
                            .map(|c| c.iter().filter_map(|c| str_at(c, "path")).collect())
                            .unwrap_or_default();
                        out.push(AiEvent::Step {
                            step: StepKind::Edit,
                            title: format!("Bestand bewerken: {}", short_names(&paths)),
                            detail: None,
                        });
                    }
                    "web_search" if !started => out.push(AiEvent::Step {
                        step: StepKind::Search,
                        title: format!(
                            "Zoeken op internet: {}",
                            str_at(item, "query").unwrap_or_default()
                        ),
                        detail: None,
                    }),
                    _ => {}
                }
            }
            _ => {}
        }
    }

    /// `gemini -p --output-format stream-json`.
    pub(super) fn gemini(&mut self, v: &Value, out: &mut Vec<AiEvent>) {
        match str_at(v, "type").unwrap_or_default() {
            "init" => {
                if let Some(id) = str_at(v, "session_id") {
                    self.set_session(id.to_owned(), out);
                }
            }
            "message" if str_at(v, "role") == Some("assistant") => {
                let delta = v.get("delta").and_then(Value::as_bool) == Some(true);
                let text = str_at(v, "content").unwrap_or_default().to_owned();
                self.text(&text, delta, out);
            }
            "tool_use" => {
                let name = str_at(v, "tool_name").unwrap_or("tool").to_owned();
                // A text after a tool call starts a new message.
                self.current.clear();
                self.step(&name, v.get("parameters"), out);
            }
            "tool_result" => out.push(AiEvent::StepOutput {
                text: clip(&flatten_text(v.get("output"))),
                error: str_at(v, "status") == Some("error"),
            }),
            "error" => {
                let message = str_at(v, "message").unwrap_or("error").to_owned();
                self.keep_tail(&message);
                out.push(AiEvent::Notice { message });
            }
            "result" => {
                let status = str_at(v, "status").unwrap_or("success");
                if status != "success" {
                    self.error = Some(
                        v.pointer("/error/message")
                            .and_then(Value::as_str)
                            .unwrap_or(status)
                            .to_owned(),
                    );
                }
            }
            _ => {}
        }
    }

    /// Antigravity, Vibe and Copilot: formats without (complete) field docs. Known shapes
    /// first, then likely keys (ADR-0009, the _verify_ rows).
    /// Vibe 3 `--output streaming` (checked against Vibe 3.0.4, step 40): chat entries with
    /// `type` `message` (role user/assistant), `reasoning`, and `effect` for a tool call:
    /// `detail.toolName` (`file_system.read_file`, `file_system.edit`, ...), `detail.input`, and
    /// `state.status`, `state.outputText`, `state.display.success`. Everything else as
    /// [`Parser::generic`].
    pub(super) fn vibe(&mut self, v: &Value, out: &mut Vec<AiEvent>) {
        if str_at(v, "type") != Some("effect") {
            if str_at(v, "type") == Some("reasoning") {
                if let Some(id) = find_session(v) {
                    self.set_session(id, out);
                }
                return;
            }
            return self.generic(v, out);
        }
        if let Some(id) = find_session(v) {
            self.set_session(id, out);
        }
        let detail = v.get("detail");
        let name = detail
            .and_then(|d| str_at(d, "toolName"))
            .or_else(|| str_at(v, "title"))
            .unwrap_or("tool")
            .to_owned();
        self.current.clear();
        self.step(&name, detail.and_then(|d| d.get("input")), out);
        let state = v.get("state");
        let failed = state.is_some_and(|st| {
            st.get("display")
                .and_then(|d| d.get("success"))
                .and_then(Value::as_bool)
                == Some(false)
                || str_at(st, "status").is_some_and(|x| x != "completed")
        });
        let text = state
            .and_then(|st| str_at(st, "outputText"))
            .filter(|t| !t.trim().is_empty())
            .map(str::to_owned)
            .or_else(|| {
                failed
                    .then(|| {
                        state
                            .and_then(|st| st.get("display"))
                            .and_then(|d| str_at(d, "message"))
                    })
                    .flatten()
                    .map(str::to_owned)
            });
        if let Some(text) = text {
            out.push(AiEvent::StepOutput {
                text: clip(&text),
                error: failed,
            });
        }
    }

    pub(super) fn generic(&mut self, v: &Value, out: &mut Vec<AiEvent>) {
        if let Some(id) = find_session(v) {
            self.set_session(id, out);
        }
        let kind = str_at(v, "type").unwrap_or_default();
        // Antigravity: {"type":"step_update","step":{"type":"tool","tool_info":{...}}}.
        let step = v.get("step").unwrap_or(v);
        let step_type = str_at(step, "type").unwrap_or(kind);
        // Vibe (chat messages): {"role":"assistant","content":..,"tool_calls":[..]}.
        let role = str_at(v, "role");
        if role == Some("tool") || step_type.contains("tool_result") {
            out.push(AiEvent::StepOutput {
                text: clip(&flatten_text(v.get("content").or_else(|| v.get("output")))),
                error: false,
            });
            return;
        }
        if let Some(calls) = v.get("tool_calls").and_then(Value::as_array) {
            for call in calls {
                let f = call.get("function").unwrap_or(call);
                let name = str_at(f, "name").unwrap_or("tool").to_owned();
                let args = f.get("arguments").map(|a| match a {
                    Value::String(s) => serde_json::from_str(s).unwrap_or(a.clone()),
                    _ => a.clone(),
                });
                self.current.clear();
                self.step(&name, args.as_ref(), out);
            }
        }
        if step_type == "tool" || step_type.ends_with("tool_use") || step_type.contains("tool.") {
            let info = step
                .get("tool_info")
                .or_else(|| step.get("tool"))
                .unwrap_or(step);
            let name = str_at(info, "name")
                .or_else(|| str_at(info, "tool_name"))
                .or_else(|| str_at(info, "toolName"))
                .unwrap_or("tool")
                .to_owned();
            let input = info
                .get("args")
                .or_else(|| info.get("arguments"))
                .or_else(|| info.get("input"))
                .or_else(|| info.get("parameters"));
            self.current.clear();
            self.step(&name, input, out);
            return;
        }
        let is_assistant = role == Some("assistant")
            || step_type == "agent_response"
            || step_type.contains("assistant");
        if is_assistant {
            let text = text_of(step).or_else(|| text_of(v)).unwrap_or_default();
            let delta = step_type.contains("delta");
            self.text(&text, delta, out);
            return;
        }
        if kind == "result" || step_type == "result" {
            let status = str_at(v, "status")
                .unwrap_or("SUCCESS")
                .to_ascii_uppercase();
            if let Some(text) = text_of(v) {
                if status == "SUCCESS" {
                    self.answer = Some(text);
                } else {
                    self.error = Some(text);
                }
            } else if status != "SUCCESS" {
                self.error = Some(status);
            }
            return;
        }
        if kind == "error" {
            let message = text_of(v).unwrap_or_else(|| "error".into());
            self.keep_tail(&message);
            self.error = Some(message.clone());
            out.push(AiEvent::Notice { message });
        }
    }
}
