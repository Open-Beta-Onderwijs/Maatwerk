// SPDX-License-Identifier: AGPL-3.0-or-later

//! Argument strings: split like a shell would, with the placeholders Maatwerk fills in.

use super::*;

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
