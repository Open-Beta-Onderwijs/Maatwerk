// SPDX-License-Identifier: AGPL-3.0-or-later

use super::*;

fn feed(format: StreamFormat, lines: &[&str]) -> (Vec<AiEvent>, Parser) {
    let mut p = Parser::new(format);
    let mut events = Vec::new();
    for l in lines {
        events.extend(p.line(l, false));
    }
    (events, p)
}

fn titles(events: &[AiEvent]) -> Vec<String> {
    events
        .iter()
        .filter_map(|e| match e {
            AiEvent::Step { title, .. } => Some(title.clone()),
            _ => None,
        })
        .collect()
}

#[test]
fn claude_stream_json() {
    let (events, p) = feed(
        StreamFormat::ClaudeStreamJson,
        &[
            r#"{"type":"system","subtype":"init","session_id":"abc","model":"x"}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Ik kijk."},{"type":"tool_use","name":"Edit","input":{"file_path":"/w/opdracht.typ"}}]}}"#,
            r#"{"type":"user","message":{"content":[{"type":"tool_result","content":"ok","is_error":false}]}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":".maatwerk/check"}}]}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"WebSearch","input":{"query":"dichtheid ijzer"}}]}}"#,
            r#"{"type":"result","subtype":"success","result":"Klaar: twee vragen toegevoegd.","session_id":"abc","is_error":false}"#,
        ],
    );
    assert_eq!(events[0], AiEvent::Session { id: "abc".into() });
    assert_eq!(
        titles(&events),
        [
            "Bestand bewerken: opdracht.typ",
            "Opdracht controleren",
            "Zoeken op internet: dichtheid ijzer"
        ]
    );
    assert!(events.contains(&AiEvent::StepOutput {
        text: "ok".into(),
        error: false
    }));
    let c = p.finish(Some(0));
    assert_eq!(c.session.as_deref(), Some("abc"));
    assert_eq!(c.answer.as_deref(), Some("Klaar: twee vragen toegevoegd."));
    assert!(!c.auth_failed);
}

#[test]
fn claude_not_logged_in() {
    let (_, p) = feed(
        StreamFormat::ClaudeStreamJson,
        &[
            r#"{"type":"result","subtype":"success","is_error":true,"result":"Not logged in · Please run /login"}"#,
        ],
    );
    let c = p.finish(Some(1));
    assert!(c.auth_failed);
    assert!(c.answer.is_none());
    let (_, p) = feed(
        StreamFormat::ClaudeStreamJson,
        &[r#"{"type":"system","subtype":"api_retry","attempt":1,"error":"authentication_failed"}"#],
    );
    assert!(p.finish(Some(1)).auth_failed);
}

#[test]
fn codex_json() {
    let (events, p) = feed(
        StreamFormat::CodexJson,
        &[
            r#"{"type":"thread.started","thread_id":"t-1"}"#,
            r#"{"type":"turn.started"}"#,
            r#"{"type":"item.started","item":{"id":"1","type":"command_execution","command":"sh .maatwerk/check","status":"in_progress"}}"#,
            r#"{"type":"item.completed","item":{"id":"1","type":"command_execution","command":"sh .maatwerk/check","aggregated_output":"{\"ok\":false}","exit_code":1}}"#,
            r#"{"type":"item.completed","item":{"id":"2","type":"file_change","changes":[{"path":"C:\\w\\opdracht.typ","kind":"update"}]}}"#,
            r#"{"type":"item.completed","item":{"id":"3","type":"agent_message","text":"Gedaan."}}"#,
            r#"{"type":"turn.completed","usage":{}}"#,
        ],
    );
    assert_eq!(events[0], AiEvent::Session { id: "t-1".into() });
    assert_eq!(
        titles(&events),
        ["Opdracht controleren", "Bestand bewerken: opdracht.typ"]
    );
    assert!(events.contains(&AiEvent::StepOutput {
        text: "{\"ok\":false}".into(),
        error: true
    }));
    let c = p.finish(Some(0));
    assert_eq!(c.answer.as_deref(), Some("Gedaan."));
    assert_eq!(c.session.as_deref(), Some("t-1"));
}

#[test]
fn codex_failure_with_login_text() {
    let (_, p) = feed(
        StreamFormat::CodexJson,
        &[r#"{"type":"turn.failed","error":{"message":"401 Unauthorized: please log in"}}"#],
    );
    let c = p.finish(Some(1));
    assert!(c.auth_failed);
    assert_eq!(c.error.as_deref(), Some("401 Unauthorized: please log in"));
}

#[test]
fn gemini_stream_json_and_exit_41() {
    let (events, p) = feed(
        StreamFormat::GeminiStreamJson,
        &[
            r#"{"type":"init","session_id":"g-1","model":"gemini"}"#,
            r#"{"type":"message","role":"user","content":"hi"}"#,
            r#"{"type":"message","role":"assistant","content":"Ik ","delta":true}"#,
            r#"{"type":"tool_use","tool_name":"replace","tool_id":"x","parameters":{"file_path":"opdracht.typ"}}"#,
            r#"{"type":"tool_result","tool_id":"x","status":"success","output":"done"}"#,
            r#"{"type":"message","role":"assistant","content":"Klaar ","delta":true}"#,
            r#"{"type":"message","role":"assistant","content":"hoor.","delta":true}"#,
            r#"{"type":"result","status":"success","stats":{}}"#,
        ],
    );
    assert_eq!(titles(&events), ["Bestand bewerken: opdracht.typ"]);
    let c = p.finish(Some(0));
    assert_eq!(c.answer.as_deref(), Some("Klaar hoor."));
    assert_eq!(c.session.as_deref(), Some("g-1"));
    let (_, p) = feed(StreamFormat::GeminiStreamJson, &[]);
    assert!(p.finish(Some(41)).auth_failed);
}

#[test]
fn antigravity_generic() {
    let (events, p) = feed(
        StreamFormat::AntigravityStreamJson,
        &[
            r#"{"type":"init","conversation_id":"c-9"}"#,
            r#"{"type":"step_update","step":{"type":"tool","tool_info":{"name":"write_file","args":{"path":"opdracht.typ"}}}}"#,
            r#"{"type":"step_update","step":{"type":"agent_response","text":"Opgave 3 toegevoegd."}}"#,
            r#"{"type":"result","status":"SUCCESS"}"#,
        ],
    );
    assert_eq!(events[0], AiEvent::Session { id: "c-9".into() });
    assert_eq!(titles(&events), ["Bestand bewerken: opdracht.typ"]);
    let c = p.finish(Some(0));
    assert_eq!(c.answer.as_deref(), Some("Opgave 3 toegevoegd."));
}

#[test]
fn vibe_messages() {
    let (events, p) = feed(
        StreamFormat::VibeStreaming,
        &[
            r#"{"role":"assistant","content":"","tool_calls":[{"function":{"name":"search_replace","arguments":"{\"file_path\":\"opdracht.typ\"}"}}]}"#,
            r#"{"role":"tool","name":"search_replace","content":"ok"}"#,
            r#"{"role":"assistant","content":"Aangepast."}"#,
        ],
    );
    assert_eq!(titles(&events), ["Bestand bewerken: opdracht.typ"]);
    assert_eq!(p.finish(Some(0)).answer.as_deref(), Some("Aangepast."));
}

#[test]
fn text_format_and_stderr() {
    let mut p = Parser::new(StreamFormat::Text);
    assert_eq!(
        p.line("hello", false),
        [AiEvent::Output {
            line: "hello".into(),
            stderr: false
        }]
    );
    p.line("world", false);
    p.line("warning: x", true);
    let c = p.finish(Some(0));
    assert_eq!(c.answer.as_deref(), Some("hello\nworld"));
    assert_eq!(c.tail, ["hello", "world", "warning: x"]);
}

#[test]
fn unknown_lines_are_output_and_auth_only_on_failure() {
    let mut p = Parser::new(StreamFormat::CopilotJson);
    assert_eq!(
        p.line("Error: not logged in. Run /login", true),
        [AiEvent::Output {
            line: "Error: not logged in. Run /login".into(),
            stderr: true
        }]
    );
    assert!(p.finish(Some(1)).auth_failed);
    let mut p = Parser::new(StreamFormat::CopilotJson);
    p.line("tip: sign in to sync", true);
    assert!(!p.finish(Some(0)).auth_failed);
}
