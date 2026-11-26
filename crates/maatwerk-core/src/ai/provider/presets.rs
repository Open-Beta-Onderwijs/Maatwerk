// SPDX-License-Identifier: AGPL-3.0-or-later

//! The command presets of the launch set (ADR-0009 "CLI research", the "Default args" rows)
//! and the CLIs whose manual check passed (decision 89).

use super::*;

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

/// The CLIs whose manual check against the real program passed (ADR-0009, "Manual check"
/// rows). The others carry a "bèta" tag in the rail and AI-instellingen (decision 89).
pub const VERIFIED: &[Builtin] = &[Builtin::Claude, Builtin::Vibe];

/// True for a CLI of the launch set that has not passed its manual check (decision 89).
pub fn is_beta(builtin: Builtin) -> bool {
    !VERIFIED.contains(&builtin)
}

pub fn preset(builtin: Builtin) -> Preset {
    presets()
        .iter()
        .find(|p| p.builtin == builtin)
        .cloned()
        .unwrap_or_else(|| unreachable!("every builtin has a preset"))
}
