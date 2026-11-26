// SPDX-License-Identifier: AGPL-3.0-or-later

//! The AI CLIs Maatwerk knows (decisions 49, 76), their command presets (ADR-0009 "CLI
//! research", the "Default args" rows), the teacher's own CLIs (decision 77) and the per-teacher
//! AI settings of this computer (decision 71).
//!
//! Arguments are one string per turn kind (first message, later messages), split like a shell
//! would ([`split_args`]), with placeholders that Maatwerk fills in ([`Placeholders`]). The
//! teacher's free text is never an argument: it goes into the request file, and `{prompt}` is a
//! fixed instruction to read it (ADR-0009 finding 1).

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::jsonfmt::to_js_json;
use crate::storage::atomic::write_atomic;

/// The fixed `{prompt}`: an ASCII instruction, safe on every command line.
pub const PROMPT: &str = "Read .maatwerk/request.md and do what it asks.";

/// The request file in the workspace, relative to it.
pub const REQUEST_FILE: &str = ".maatwerk/request.md";

/// The bundled check command as the CLI calls it from the workspace (a script that runs
/// Maatwerk's own check, see [`super::workspace`]).
pub const CHECK_COMMAND: &str = ".maatwerk/check";

/// The AI CLIs with a built-in preset.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Builtin {
    Claude,
    Codex,
    Gemini,
    Antigravity,
    Vibe,
    Copilot,
}

/// How a CLI's stdout is read ([`super::events`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StreamFormat {
    ClaudeStreamJson,
    CodexJson,
    GeminiStreamJson,
    AntigravityStreamJson,
    VibeStreaming,
    CopilotJson,
    /// Plain text: every line is shown as it comes (custom CLIs).
    Text,
}

/// Where the session id of a conversation comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionMode {
    /// Maatwerk makes a UUID before the first turn (`{session}` in the first arguments too).
    Maatwerk,
    /// The CLI reports its id in the first run's output; `{session}` only in later arguments.
    Reported,
}

/// Install help per CLI (decision 72): one command per platform family, copyable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallHelp {
    pub windows: &'static str,
    pub unix: &'static str,
    /// A short Dutch note (requirements), if any.
    pub note: Option<&'static str>,
    /// The vendor's install page.
    pub url: &'static str,
}

/// A built-in preset (ADR-0009 "CLI research").
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Preset {
    pub builtin: Builtin,
    pub name: &'static str,
    pub command: &'static str,
    pub args: &'static str,
    pub args_next: &'static str,
    pub format: StreamFormat,
    pub session: SessionMode,
    /// The flag `{images}` puts before each attached image; `None`: the images are only named
    /// in the request file.
    pub image_flag: Option<&'static str>,
    /// The CLI can run `{check}` itself; otherwise Maatwerk runs the check after the turn and
    /// feeds errors back (ADR-0009 finding 9).
    pub runs_check: bool,
    /// Arguments that ask whether the CLI is logged in without sending a prompt (exit 0 = yes).
    pub login_probe: Option<&'static [&'static str]>,
    pub install: InstallHelp,
}

const CLAUDE_ARGS: &str = "-p {prompt} --output-format stream-json --verbose --restricted \
     --tools Read,Glob,Grep,Edit,Write,WebSearch,WebFetch,Bash,PowerShell \
     --allowedTools \"Edit(./opdracht.typ)\" \"Edit(./images/**)\" WebSearch WebFetch \
     \"Bash({check} *)\" \"PowerShell({check} *)\" \
     --permission-mode dontAsk --permission-prompts none --strict-mcp-config";

const CODEX_ARGS: &str = "--json --skip-git-repo-check --sandbox workspace-write \
     -c approval_policy=never -c web_search=live {images} {prompt}";

const COPILOT_ARGS: &str = "-p {prompt} --output-format json --no-ask-user \
     --allow-tool write --allow-all-urls --session-id {session} {images}";

const VIBE_ARGS: &str = "--prompt-file {request} --workdir {workdir} --trust --agent accept-edits \
     --output streaming --output-dir {run} --time-limit {secs}";

/// The six presets, in rail order.
pub fn presets() -> &'static [Preset] {
    static PRESETS: OnceLock<Vec<Preset>> = OnceLock::new();
    PRESETS.get_or_init(build_presets)
}

fn build_presets() -> Vec<Preset> {
    vec![
        Preset {
            builtin: Builtin::Claude,
            name: "Claude Code",
            command: "claude",
            args: concat_static(CLAUDE_ARGS, " --session-id {session}"),
            args_next: concat_static(CLAUDE_ARGS, " --resume {session}"),
            format: StreamFormat::ClaudeStreamJson,
            session: SessionMode::Maatwerk,
            image_flag: None,
            runs_check: true,
            login_probe: Some(&["auth", "status", "--json"]),
            install: InstallHelp {
                windows: "irm https://claude.ai/install.ps1 | iex",
                unix: "curl -fsSL https://claude.ai/install.sh | bash",
                note: Some("Vereist een betaald Claude-abonnement."),
                url: "https://code.claude.com/docs/en/setup",
            },
        },
        Preset {
            builtin: Builtin::Codex,
            name: "Codex",
            command: "codex",
            args: concat_static("exec ", CODEX_ARGS),
            args_next: concat_static("exec resume {session} ", CODEX_ARGS),
            format: StreamFormat::CodexJson,
            session: SessionMode::Reported,
            image_flag: Some("-i"),
            runs_check: true,
            login_probe: Some(&["login", "status"]),
            install: InstallHelp {
                windows: "powershell -ExecutionPolicy ByPass -c \"irm https://chatgpt.com/codex/install.ps1 | iex\"",
                unix: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
                note: Some("Vereist een ChatGPT-abonnement of een API-sleutel."),
                url: "https://learn.chatgpt.com/docs/codex/cli",
            },
        },
        Preset {
            builtin: Builtin::Gemini,
            name: "Gemini CLI",
            command: "gemini",
            args: "-p {prompt} --output-format stream-json --approval-mode auto_edit \
                   --admin-policy {run}/gemini-policy.toml",
            args_next: "-p {prompt} --output-format stream-json --approval-mode auto_edit \
                        --admin-policy {run}/gemini-policy.toml --resume {session}",
            format: StreamFormat::GeminiStreamJson,
            session: SessionMode::Reported,
            image_flag: None,
            runs_check: false,
            login_probe: None,
            install: InstallHelp {
                windows: "npm install -g @google/gemini-cli",
                unix: "npm install -g @google/gemini-cli",
                note: Some(
                    "Vereist Node.js 20 of nieuwer, en een betaalde Gemini-licentie of API-sleutel.",
                ),
                url: "https://geminicli.com/docs/get-started/installation/",
            },
        },
        Preset {
            builtin: Builtin::Antigravity,
            name: "Antigravity",
            command: "agy",
            args: "-p {prompt} --output-format stream-json",
            args_next: "-p {prompt} --output-format stream-json --conversation {session}",
            format: StreamFormat::AntigravityStreamJson,
            session: SessionMode::Reported,
            image_flag: None,
            runs_check: false,
            login_probe: None,
            install: InstallHelp {
                windows: "irm https://antigravity.google/cli/install.ps1 | iex",
                unix: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
                note: Some(
                    "Log één keer in door agy zelf te starten. Een Google Workspace-account van school werkt niet.",
                ),
                url: "https://antigravity.google/docs/getting-started",
            },
        },
        Preset {
            builtin: Builtin::Vibe,
            name: "Mistral Vibe",
            command: "vibe",
            args: VIBE_ARGS,
            args_next: concat_static(VIBE_ARGS, " --resume {session}"),
            format: StreamFormat::VibeStreaming,
            session: SessionMode::Reported,
            image_flag: None,
            runs_check: false,
            login_probe: None,
            install: InstallHelp {
                windows: "powershell -ExecutionPolicy ByPass -c \"irm https://astral.sh/uv/install.ps1 | iex\"; uv tool install --python 3.14 mistral-vibe",
                unix: "curl -LsSf https://mistral.ai/vibe/install.sh | bash",
                note: Some("Log daarna in met: vibe --setup"),
                url: "https://docs.mistral.ai/mistral-vibe/introduction",
            },
        },
        Preset {
            builtin: Builtin::Copilot,
            name: "GitHub Copilot",
            command: "copilot",
            args: COPILOT_ARGS,
            args_next: COPILOT_ARGS,
            format: StreamFormat::CopilotJson,
            session: SessionMode::Maatwerk,
            image_flag: Some("--attachment"),
            runs_check: false,
            login_probe: None,
            install: InstallHelp {
                windows: "winget install GitHub.Copilot",
                unix: "curl -fsSL https://gh.io/copilot-install | bash",
                note: Some("Vereist een GitHub Copilot-abonnement."),
                url: "https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli",
            },
        },
    ]
}

/// `concat!` for the two-part presets; built once ([`presets`] keeps them for the program's
/// lifetime).
fn concat_static(a: &str, b: &str) -> &'static str {
    Box::leak(format!("{a}{b}").into_boxed_str())
}

pub fn preset(builtin: Builtin) -> Preset {
    presets()
        .iter()
        .find(|p| p.builtin == builtin)
        .cloned()
        .unwrap_or_else(|| unreachable!("every builtin has a preset"))
}

/// A provider: a built-in CLI (`claude`, ...) or a teacher's own (`custom-<slug>`).
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct ProviderKey(String);

impl ProviderKey {
    pub fn builtin(b: Builtin) -> ProviderKey {
        ProviderKey(builtin_key(b).to_owned())
    }

    /// Parses `claude`, `codex`, ... or `custom-<a-z0-9->{1,40}`.
    pub fn parse(s: &str) -> Result<ProviderKey> {
        let custom = s.strip_prefix("custom-").is_some_and(|slug| {
            !slug.is_empty()
                && slug.len() <= 40
                && slug
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        });
        if custom || presets().iter().any(|p| builtin_key(p.builtin) == s) {
            Ok(ProviderKey(s.to_owned()))
        } else {
            Err(invalid(format!("Onbekend AI-programma: {s}")))
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn as_builtin(&self) -> Option<Builtin> {
        presets()
            .iter()
            .map(|p| p.builtin)
            .find(|b| builtin_key(*b) == self.0)
    }
}

impl TryFrom<String> for ProviderKey {
    type Error = Error;
    fn try_from(s: String) -> Result<ProviderKey> {
        ProviderKey::parse(&s)
    }
}

impl From<ProviderKey> for String {
    fn from(k: ProviderKey) -> String {
        k.0
    }
}

impl std::fmt::Display for ProviderKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

pub fn builtin_key(b: Builtin) -> &'static str {
    match b {
        Builtin::Claude => "claude",
        Builtin::Codex => "codex",
        Builtin::Gemini => "gemini",
        Builtin::Antigravity => "antigravity",
        Builtin::Vibe => "vibe",
        Builtin::Copilot => "copilot",
    }
}

fn invalid(message: String) -> Error {
    Error::InvalidArgument { message }
}

/// Splits an argument string like a POSIX shell without expansion: whitespace separates,
/// `"..."` and `'...'` group (quotes removed), `\` escapes the next character outside single
/// quotes. Backslashes in Windows paths therefore need quotes or doubling.
pub fn split_args(s: &str) -> Result<Vec<String>> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_token = false;
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        match c {
            c if c.is_whitespace() => {
                if in_token {
                    out.push(std::mem::take(&mut cur));
                    in_token = false;
                }
            }
            '\'' => {
                in_token = true;
                loop {
                    match chars.next() {
                        Some('\'') => break,
                        Some(c) => cur.push(c),
                        None => return Err(invalid("Een ' wordt niet gesloten.".into())),
                    }
                }
            }
            '"' => {
                in_token = true;
                loop {
                    match chars.next() {
                        Some('"') => break,
                        Some('\\') => match chars.next() {
                            Some(c @ ('"' | '\\')) => cur.push(c),
                            Some(c) => {
                                cur.push('\\');
                                cur.push(c);
                            }
                            None => return Err(invalid("Een \" wordt niet gesloten.".into())),
                        },
                        Some(c) => cur.push(c),
                        None => return Err(invalid("Een \" wordt niet gesloten.".into())),
                    }
                }
            }
            '\\' => {
                in_token = true;
                match chars.next() {
                    Some(c) => cur.push(c),
                    None => cur.push('\\'),
                }
            }
            c => {
                in_token = true;
                cur.push(c);
            }
        }
    }
    if in_token {
        out.push(cur);
    }
    Ok(out)
}

/// The placeholders an argument string may use.
pub const PLACEHOLDERS: [&str; 8] = [
    "prompt", "request", "workdir", "session", "check", "images", "run", "secs",
];

/// The values for one run. `{images}` is a whole token: it becomes `flag path` per image (or
/// just the paths without a flag), or nothing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Placeholders {
    pub workdir: PathBuf,
    pub run: PathBuf,
    pub session: Option<String>,
    pub images: Vec<PathBuf>,
    pub image_flag: Option<String>,
    pub time_limit: Duration,
}

impl Placeholders {
    fn value(&self, name: &str) -> Result<String> {
        Ok(match name {
            "prompt" => PROMPT.to_owned(),
            "request" => path_text(&self.workdir.join(REQUEST_FILE)),
            "workdir" => path_text(&self.workdir),
            "run" => path_text(&self.run),
            "check" => CHECK_COMMAND.to_owned(),
            "secs" => self.time_limit.as_secs().to_string(),
            "session" => self
                .session
                .clone()
                .ok_or_else(|| invalid("Er is nog geen gesprek om voort te zetten.".into()))?,
            other => return Err(invalid(format!("Onbekende plaatshouder {{{other}}}."))),
        })
    }

    /// Splits `args` and fills in the placeholders.
    pub fn expand(&self, args: &str) -> Result<Vec<String>> {
        let mut out = Vec::new();
        for token in split_args(args)? {
            if token == "{images}" {
                for image in &self.images {
                    if let Some(flag) = &self.image_flag {
                        out.push(flag.clone());
                    }
                    out.push(path_text(image));
                }
                continue;
            }
            out.push(fill(&token, |name| self.value(name))?);
        }
        Ok(out)
    }
}

fn path_text(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Replaces every `{name}` in `token`; `{{` and other braces stay as they are.
fn fill(token: &str, mut value: impl FnMut(&str) -> Result<String>) -> Result<String> {
    let mut out = String::new();
    let mut rest = token;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('}') {
            Some(end) if is_name(&after[..end]) => {
                out.push_str(&value(&after[..end])?);
                rest = &after[end + 1..];
            }
            _ => {
                out.push('{');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    Ok(out)
}

fn is_name(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_lowercase())
}

/// Checks an argument string as the settings screen saves it: it splits, and every
/// placeholder is known (`{images}` only as a whole token).
pub fn validate_args(args: &str) -> Result<()> {
    for token in split_args(args)? {
        if token == "{images}" {
            continue;
        }
        fill(&token, |name| {
            if PLACEHOLDERS.contains(&name) && name != "images" {
                Ok(String::new())
            } else {
                Err(invalid(format!("Onbekende plaatshouder {{{name}}}.")))
            }
        })?;
    }
    Ok(())
}

/// Default time limit of a run (decision 55) and the allowed range in minutes (decision 71).
pub const DEFAULT_TIME_LIMIT_MINUTES: u32 = 5;
pub const TIME_LIMIT_RANGE: (u32, u32) = (1, 30);

/// The teacher's changes to a built-in preset; `None` fields use the preset.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderOverride {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args_next: Option<String>,
}

/// A teacher's own CLI (decision 77).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomCli {
    pub key: ProviderKey,
    pub name: String,
    pub command: String,
    pub args: String,
    /// Empty: every message is a fresh run with the conversation in the request file.
    #[serde(default)]
    pub args_next: String,
}

/// The AI settings of one teacher on this computer (decision 71), in local app data, never in
/// the shared data folder. Unknown fields are kept.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    /// The teacher's own switch (decision 59); the school's is in `instellingen.json`.
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default = "default_minutes")]
    pub time_limit_minutes: u32,
    /// The first-use notice was confirmed (decision 70).
    #[serde(default)]
    pub notice_seen: bool,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub overrides: BTreeMap<Builtin, ProviderOverride>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub custom: Vec<CustomCli>,
    #[serde(flatten)]
    pub other: serde_json::Map<String, serde_json::Value>,
}

fn yes() -> bool {
    true
}

fn default_minutes() -> u32 {
    DEFAULT_TIME_LIMIT_MINUTES
}

impl Default for AiSettings {
    fn default() -> AiSettings {
        AiSettings {
            enabled: true,
            time_limit_minutes: DEFAULT_TIME_LIMIT_MINUTES,
            notice_seen: false,
            overrides: BTreeMap::new(),
            custom: Vec::new(),
            other: serde_json::Map::new(),
        }
    }
}

/// A provider with its effective command and arguments.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    pub key: ProviderKey,
    pub builtin: Option<Builtin>,
    pub name: String,
    pub command: String,
    pub args: String,
    /// Empty: no resume, every turn runs `args` again.
    pub args_next: String,
    pub format: StreamFormat,
    pub session: SessionMode,
    pub image_flag: Option<String>,
    pub runs_check: bool,
    /// Arguments of the CLI's own login status command, run before its first turn (review 32
    /// m8); `None` when it has none.
    pub login_probe: Option<Vec<String>>,
}

/// Whether the login status command says the CLI is logged in: Claude Code prints JSON with
/// `loggedIn`, Codex answers with its exit code.
pub fn logged_in(succeeded: bool, stdout: &str) -> bool {
    match serde_json::from_str::<serde_json::Value>(stdout.trim()) {
        Ok(v) => match v.get("loggedIn").and_then(serde_json::Value::as_bool) {
            Some(b) => succeeded && b,
            None => succeeded,
        },
        Err(_) => succeeded,
    }
}

impl AiSettings {
    /// The settings at `path`; defaults when missing or unreadable.
    pub fn load(path: &Path) -> AiSettings {
        let Ok(bytes) = fs::read(path) else {
            return AiSettings::default();
        };
        serde_json::from_slice(&bytes).unwrap_or_else(|e| {
            tracing::warn!("AI settings unreadable, defaults used: {e}");
            AiSettings::default()
        })
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        self.validate()?;
        let io = |e| Error::io("ai-settings.json", e);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(io)?;
        }
        let value = serde_json::to_value(self).map_err(|e| invalid(e.to_string()))?;
        write_atomic(path, to_js_json(&value).as_bytes()).map_err(io)
    }

    pub fn validate(&self) -> Result<()> {
        let (min, max) = TIME_LIMIT_RANGE;
        if !(min..=max).contains(&self.time_limit_minutes) {
            return Err(invalid(format!(
                "De tijdslimiet is {min} tot {max} minuten."
            )));
        }
        for o in self.overrides.values() {
            for args in [&o.args, &o.args_next].into_iter().flatten() {
                validate_args(args)?;
            }
        }
        let mut keys = Vec::new();
        for c in &self.custom {
            if c.key.as_builtin().is_some() || !c.key.as_str().starts_with("custom-") {
                return Err(invalid(format!("{} is geen eigen programma.", c.key)));
            }
            if keys.contains(&&c.key) {
                return Err(invalid(format!("{} staat er twee keer in.", c.key)));
            }
            keys.push(&c.key);
            if c.name.trim().is_empty() || c.command.trim().is_empty() {
                return Err(invalid(
                    "Geef het programma een naam en een opdracht.".into(),
                ));
            }
            validate_args(&c.args)?;
            validate_args(&c.args_next)?;
        }
        Ok(())
    }

    pub fn time_limit(&self) -> Duration {
        let (min, max) = TIME_LIMIT_RANGE;
        Duration::from_secs(u64::from(self.time_limit_minutes.clamp(min, max)) * 60)
    }

    /// Every provider in rail order: the presets, then the teacher's own.
    pub fn resolved(&self) -> Vec<Resolved> {
        let mut out: Vec<Resolved> = presets()
            .iter()
            .map(|p| {
                let o = self.overrides.get(&p.builtin).cloned().unwrap_or_default();
                Resolved {
                    key: ProviderKey::builtin(p.builtin),
                    builtin: Some(p.builtin),
                    name: p.name.to_owned(),
                    command: o.command.unwrap_or_else(|| p.command.to_owned()),
                    args: o.args.unwrap_or_else(|| p.args.to_owned()),
                    args_next: o.args_next.unwrap_or_else(|| p.args_next.to_owned()),
                    format: p.format,
                    session: p.session,
                    image_flag: p.image_flag.map(str::to_owned),
                    runs_check: p.runs_check,
                    login_probe: p
                        .login_probe
                        .map(|a| a.iter().map(|s| (*s).to_owned()).collect()),
                }
            })
            .collect();
        out.extend(self.custom.iter().map(|c| Resolved {
            key: c.key.clone(),
            builtin: None,
            name: c.name.clone(),
            command: c.command.clone(),
            args: c.args.clone(),
            args_next: c.args_next.clone(),
            format: StreamFormat::Text,
            session: SessionMode::Maatwerk,
            image_flag: None,
            runs_check: false,
            login_probe: None,
        }));
        out
    }

    pub fn resolve(&self, key: &ProviderKey) -> Result<Resolved> {
        self.resolved()
            .into_iter()
            .find(|r| &r.key == key)
            .ok_or_else(|| invalid(format!("Onbekend AI-programma: {key}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_args_handles_quotes_and_escapes() {
        assert_eq!(
            split_args(r#"-p {prompt} "Edit(./a b)" 'x"y' a\ b """#).unwrap(),
            ["-p", "{prompt}", "Edit(./a b)", "x\"y", "a b", ""]
        );
        assert!(split_args("\"open").is_err());
        assert!(split_args("'open").is_err());
        assert_eq!(split_args("  ").unwrap(), Vec::<String>::new());
    }

    fn values() -> Placeholders {
        Placeholders {
            workdir: PathBuf::from("/w"),
            run: PathBuf::from("/r"),
            session: Some("s-1".into()),
            images: vec![PathBuf::from("/w/a.png"), PathBuf::from("/w/b.png")],
            image_flag: Some("-i".into()),
            time_limit: Duration::from_secs(300),
        }
    }

    #[test]
    fn placeholders_expand_inside_tokens_and_images_repeat() {
        let v = values();
        assert_eq!(
            v.expand("x \"Bash({check} *)\" {images} --t {secs} --s={session} {X}y {")
                .unwrap(),
            [
                "x",
                "Bash(.maatwerk/check *)",
                "-i",
                "/w/a.png",
                "-i",
                "/w/b.png",
                "--t",
                "300",
                "--s=s-1",
                "{X}y",
                "{"
            ]
        );
        let none = Placeholders {
            images: vec![],
            session: None,
            ..v
        };
        assert_eq!(none.expand("a {images} b").unwrap(), ["a", "b"]);
        assert!(none.expand("--resume {session}").is_err());
        assert!(none.expand("{nope}").is_err());
    }

    #[test]
    fn every_preset_expands_and_validates() {
        let v = values();
        for p in presets() {
            validate_args(p.args).unwrap();
            validate_args(p.args_next).unwrap();
            let first = v.expand(p.args).unwrap();
            assert!(first.iter().all(|a| !a.contains('{')), "{first:?}");
            let next = v.expand(p.args_next).unwrap();
            // A resume names the session; a fresh Maatwerk session does too.
            assert!(
                next.iter().any(|a| a.contains("s-1")),
                "{} {next:?}",
                p.name
            );
        }
        assert!(validate_args("{images}x").is_err());
        assert!(validate_args("{bogus}").is_err());
    }

    #[test]
    fn provider_keys() {
        assert_eq!(
            ProviderKey::parse("claude").unwrap().as_builtin(),
            Some(Builtin::Claude)
        );
        assert_eq!(
            ProviderKey::parse("antigravity").unwrap().as_builtin(),
            Some(Builtin::Antigravity)
        );
        assert!(
            ProviderKey::parse("custom-my-cli2")
                .unwrap()
                .as_builtin()
                .is_none()
        );
        for bad in ["", "custom-", "custom-A", "deepseek", "custom-../x"] {
            assert!(ProviderKey::parse(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn settings_round_trip_overrides_and_custom() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ai/settings.json");
        assert_eq!(AiSettings::load(&path), AiSettings::default());
        let mut s = AiSettings {
            time_limit_minutes: 7,
            ..AiSettings::default()
        };
        s.overrides.insert(
            Builtin::Claude,
            ProviderOverride {
                command: Some("C:\\tools\\claude.exe".into()),
                ..Default::default()
            },
        );
        s.custom.push(CustomCli {
            key: ProviderKey::parse("custom-aider").unwrap(),
            name: "Aider".into(),
            command: "aider".into(),
            args: "--message-file {request} --yes".into(),
            args_next: String::new(),
        });
        s.other.insert("future".into(), serde_json::json!(1));
        s.save(&path).unwrap();
        let back = AiSettings::load(&path);
        assert_eq!(back, s);
        let claude = back
            .resolve(&ProviderKey::builtin(Builtin::Claude))
            .unwrap();
        assert_eq!(claude.command, "C:\\tools\\claude.exe");
        assert_eq!(claude.args, preset(Builtin::Claude).args);
        let aider = back
            .resolve(&ProviderKey::parse("custom-aider").unwrap())
            .unwrap();
        assert_eq!(aider.format, StreamFormat::Text);
        assert!(!aider.runs_check);
        assert_eq!(back.resolved().len(), 7);
        assert_eq!(back.time_limit(), Duration::from_secs(420));
    }

    #[test]
    fn settings_validation() {
        let mut s = AiSettings {
            time_limit_minutes: 31,
            ..AiSettings::default()
        };
        assert!(s.validate().is_err());
        s.time_limit_minutes = 30;
        s.validate().unwrap();
        s.custom.push(CustomCli {
            key: ProviderKey::parse("custom-x").unwrap(),
            name: " ".into(),
            command: "x".into(),
            args: String::new(),
            args_next: String::new(),
        });
        assert!(s.validate().is_err());
        s.custom[0].name = "X".into();
        s.custom[0].args = "{nope}".into();
        assert!(s.validate().is_err());
        s.custom[0].args = "{prompt}".into();
        s.validate().unwrap();
        s.custom.push(s.custom[0].clone());
        assert!(s.validate().is_err());
    }

    #[test]
    fn login_status_from_json_or_exit_code() {
        assert!(logged_in(
            true,
            r#"{ "loggedIn": true, "authMethod": "claude.ai" }"#
        ));
        assert!(!logged_in(true, r#"{"loggedIn":false}"#));
        assert!(!logged_in(false, r#"{"loggedIn":true}"#));
        assert!(logged_in(true, "Logged in using ChatGPT"));
        assert!(!logged_in(false, "Not logged in"));
        assert!(logged_in(true, "[1, 2]"));
    }
}
