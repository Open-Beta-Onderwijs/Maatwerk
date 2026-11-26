// SPDX-License-Identifier: AGPL-3.0-or-later

//! The per-teacher AI settings of this computer (decision 71), own CLIs (decision 77) and
//! the resolved command of each provider.

use super::*;

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
