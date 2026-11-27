// SPDX-License-Identifier: AGPL-3.0-or-later

//! The workspace a CLI works in (ADR-0009 decision step 1, decisions 50-53, 64): a folder in
//! local app data, never in the shared data folder, with
//!
//! - `opdracht.typ`, `main.typ`, `lib.typ`: the editor's current text (or the saved files),
//! - `images/`: the opdracht's images when the teacher switched "Afbeeldingen" on, otherwise grey
//!   placeholders of the same size and type, so the opdracht still compiles and lays out alike,
//! - `.maatwerk/request.md`: the instructions, the context list and the teacher's message,
//! - `.maatwerk/context/`: what the chips switched on (guide and examples, opdracht data, current
//!   diagnostics, the rendered PDF, the syllabus, other opdrachten),
//! - `.maatwerk/attachments/`: the teacher's own attachments,
//! - `.maatwerk/check` (and `check.cmd`): the bundled check ([`super::check`]),
//! - the provider's own config (Vibe: `.vibe/config.toml`).
//!
//! The folder keeps its path for the whole conversation (Gemini keys sessions by it, ADR-0009
//! finding 3); its content is rebuilt before every turn. Per turn there is also a run folder
//! next to it (`{run}`), for files the CLI must not edit (Gemini's policy, Vibe's export).

use std::collections::BTreeMap;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::guard::Guard;
use super::provider::{Builtin, CHECK_COMMAND, REQUEST_FILE, Resolved};
use crate::assignment::{self, Assignment, RenderOptions};
use crate::error::{Error, Result};
use crate::opdracht_images::{IMAGE_EXTS, clean_image_name, extension_of, stem_of};
use crate::typst_svc::{FontStore, local_now};

/// The files of an opdracht a CLI may see. Only `opdracht.typ` (and `images/`) may change.
pub const OPDRACHT_FILES: [&str; 3] = ["opdracht.typ", "main.typ", "lib.typ"];
pub const WRITABLE_FILE: &str = "opdracht.typ";
pub const IMAGES_DIR: &str = "images";

/// Limits on the teacher's own attachments (decision 53).
pub const MAX_ATTACHMENT_BYTES: u64 = 25 * 1024 * 1024;
pub const MAX_ATTACHMENTS: usize = 10;

/// How long the context's check and PDF render may take.
const CONTEXT_COMPILE_LIMIT: Duration = Duration::from_secs(30);

const GUIDE: &str = include_str!("../../../../docs/ai-context/assignment-authoring.md");
const EXAMPLES: [(&str, &str); 6] = [
    (
        "01-basis.typ",
        include_str!("../../../../docs/assignment-examples/01-basis.typ"),
    ),
    (
        "02-figuur.typ",
        include_str!("../../../../docs/assignment-examples/02-figuur.typ"),
    ),
    (
        "03-tabel.typ",
        include_str!("../../../../docs/assignment-examples/03-tabel.typ"),
    ),
    (
        "04-context-en-grid.typ",
        include_str!("../../../../docs/assignment-examples/04-context-en-grid.typ"),
    ),
    (
        "05-wiskunde.typ",
        include_str!("../../../../docs/assignment-examples/05-wiskunde.typ"),
    ),
    (
        "images/stroomkring.svg",
        include_str!("../../../../docs/assignment-examples/images/stroomkring.svg"),
    ),
];

fn invalid(message: impl Into<String>) -> Error {
    Error::InvalidArgument {
        message: message.into(),
    }
}

fn io(path: &Path) -> impl Fn(std::io::Error) -> Error + '_ {
    move |e| Error::io(path.to_string_lossy(), e)
}

/// `[A-Za-z0-9_-]+`: a safe single path segment (gebruiker and opdracht ids).
fn check_segment(s: &str, what: &str) -> Result<()> {
    if !s.is_empty()
        && s.len() <= 100
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        Ok(())
    } else {
        Err(invalid(format!("Ongeldige {what}.")))
    }
}

/// Where one teacher's AI files live: `<local app data>/ai/<gebruiker>/`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Layout {
    root: PathBuf,
}

impl Layout {
    pub fn new(ai_dir: &Path, gebruiker: &str) -> Result<Layout> {
        check_segment(gebruiker, "gebruiker")?;
        Ok(Layout {
            root: ai_dir.join(gebruiker),
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn settings_file(&self) -> PathBuf {
        self.root.join("settings.json")
    }

    fn opdracht_dir(&self, opdracht: &str) -> Result<PathBuf> {
        check_segment(opdracht, "opdracht")?;
        Ok(self.root.join("opdrachten").join(opdracht))
    }

    /// The conversation of one provider about one opdracht ([`super::history`]).
    pub fn history_file(&self, opdracht: &str, key: &super::ProviderKey) -> Result<PathBuf> {
        Ok(self.opdracht_dir(opdracht)?.join(format!("{key}.json")))
    }

    /// The chips remembered for one opdracht (decision 51).
    pub fn context_file(&self, opdracht: &str) -> Result<PathBuf> {
        Ok(self.opdracht_dir(opdracht)?.join("context.json"))
    }

    /// The workspace of one conversation; its path stays the same.
    pub fn workdir(&self, opdracht: &str, key: &super::ProviderKey) -> Result<PathBuf> {
        check_segment(opdracht, "opdracht")?;
        Ok(self.root.join("work").join(opdracht).join(key.as_str()))
    }

    /// The per-turn folder next to the workspace (`{run}`).
    pub fn run_dir(&self, opdracht: &str, key: &super::ProviderKey) -> Result<PathBuf> {
        check_segment(opdracht, "opdracht")?;
        Ok(self
            .root
            .join("work")
            .join(opdracht)
            .join(format!("{key}.run")))
    }

    /// "Nieuw gesprek": the conversation's history, workspace and run folder go.
    pub fn forget(&self, opdracht: &str, key: &super::ProviderKey) -> Result<()> {
        for dir in [self.workdir(opdracht, key)?, self.run_dir(opdracht, key)?] {
            remove_dir(&dir)?;
        }
        let history = self.history_file(opdracht, key)?;
        match fs::remove_file(&history) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(io(&history)(e)),
            _ => Ok(()),
        }
    }
}

fn remove_dir(dir: &Path) -> Result<()> {
    match fs::remove_dir_all(dir) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(io(dir)(e)),
        _ => Ok(()),
    }
}

/// A starter button (decision 57); `None` for a free message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Starter {
    FixErrors,
    CompleteAnswers,
    Rewrite,
    NewOpgave,
}

/// Another opdracht the teacher picked as an example (decision 51).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OtherOpdracht {
    pub id: String,
    pub title: String,
    pub text: String,
}

/// The context chips of one message (decision 51, 64).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextChoice {
    /// Opdrachtinstructies AI: the authoring guide and the examples.
    pub guide: bool,
    /// Opdrachtgegevens: title, vak, schoolsoort, jaarlagen, linked observaties (as the UI has
    /// them). Never student, toets or score data (decision 54).
    pub metadata: Option<serde_json::Value>,
    /// Fouten & waarschuwingen: the current check report.
    pub diagnostics: bool,
    /// PDF-output: the rendered opdracht (with placeholder images unless `images`).
    pub pdf: bool,
    /// Syllabus: a PDF from the syllabus folder.
    pub syllabus: Option<PathBuf>,
    /// Andere opdrachten (at most 3).
    #[serde(default)]
    pub others: Vec<OtherOpdracht>,
    /// Afbeeldingen: the real images (never remembered, decision 64).
    pub images: bool,
}

/// One of the teacher's attachments: a file on disk or pasted content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bytes: Option<Vec<u8>>,
}

/// One earlier message, for CLIs without resume.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PastMessage {
    pub from_teacher: bool,
    pub text: String,
}

/// Everything one turn needs.
#[derive(Debug, Clone)]
pub struct TurnInput {
    /// The opdracht folder in the data folder (read only).
    pub opdracht_dir: PathBuf,
    /// Editor text by file name (`opdracht.typ`, ...), newer than the saved files.
    pub buffers: BTreeMap<String, String>,
    pub message: String,
    pub starter: Option<Starter>,
    pub context: ContextChoice,
    pub attachments: Vec<Attachment>,
    /// The conversation so far, written into the request when the CLI does not resume.
    pub past: Vec<PastMessage>,
    /// The Maatwerk program, for the check script.
    pub check_program: PathBuf,
}

/// What the workspace held when the CLI started: the diff's base ([`super::diff`]).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Baseline {
    /// File name -> text of `opdracht.typ`, `main.typ`, `lib.typ`.
    pub files: BTreeMap<String, String>,
    /// `images/<file>` -> SHA-256 of what was put there.
    pub images: BTreeMap<String, String>,
    /// The images that are placeholders (not the real ones).
    pub placeholders: Vec<String>,
}

/// A prepared turn.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Prepared {
    pub workdir: PathBuf,
    pub run_dir: PathBuf,
    pub baseline: Baseline,
    /// Attached images, inside the workspace, for `{images}`.
    pub image_args: Vec<PathBuf>,
}

/// Rebuilds the workspace for one turn and writes the request.
pub fn prepare(
    workdir: &Path,
    run_dir: &Path,
    provider: &Resolved,
    resumes: bool,
    input: &TurnInput,
    guard: &Guard,
) -> Result<Prepared> {
    check_attachments(&input.attachments)?;
    if input.context.others.len() > 3 {
        return Err(invalid("Kies hoogstens drie andere opdrachten."));
    }
    remove_dir(workdir)?;
    remove_dir(run_dir)?;
    for dir in [workdir, run_dir] {
        fs::create_dir_all(dir).map_err(io(dir))?;
    }
    let mut baseline = Baseline::default();
    for name in OPDRACHT_FILES {
        let text = match input.buffers.get(name) {
            Some(t) => t.clone(),
            None => {
                let path = input.opdracht_dir.join(name);
                fs::read_to_string(&path).map_err(io(&path))?
            }
        };
        let path = workdir.join(name);
        fs::write(&path, &text).map_err(io(&path))?;
        baseline.files.insert(name.to_owned(), text);
    }
    copy_images(input, workdir, &mut baseline)?;
    let meta = workdir.join(".maatwerk");
    let mut listed = Vec::new();
    write_context(input, workdir, &meta, &mut listed, guard)?;
    let image_args = write_attachments(&input.attachments, &meta, &mut listed)?;
    // Only for CLIs that run the check themselves and cannot edit `.maatwerk/` (review 32 M1).
    if provider.runs_check {
        write_check_scripts(workdir, &meta, &input.check_program)?;
    } else {
        fs::create_dir_all(&meta).map_err(io(&meta))?;
    }
    write_provider_files(provider, workdir, run_dir)?;
    let request = request_text(provider, resumes, input, &listed, &baseline);
    let path = workdir.join(REQUEST_FILE);
    fs::write(&path, request).map_err(io(&path))?;
    let base_file = run_dir.join("baseline.json");
    let json = serde_json::to_vec(&baseline).map_err(|e| invalid(e.to_string()))?;
    fs::write(&base_file, json).map_err(io(&base_file))?;
    Ok(Prepared {
        workdir: workdir.to_path_buf(),
        run_dir: run_dir.to_path_buf(),
        baseline,
        image_args,
    })
}

/// Decision 53 counts 10 per chat, which the composer enforces; this guard counts per message
/// (review 32 n7).
fn check_attachments(attachments: &[Attachment]) -> Result<()> {
    if attachments.len() > MAX_ATTACHMENTS {
        return Err(invalid(format!(
            "Hoogstens {MAX_ATTACHMENTS} bijlagen per gesprek."
        )));
    }
    for a in attachments {
        let size = match (&a.path, &a.text, &a.bytes) {
            (Some(p), _, _) => fs::metadata(p).map_err(io(p))?.len(),
            (_, Some(t), _) => t.len() as u64,
            (_, _, Some(b)) => b.len() as u64,
            _ => return Err(invalid(format!("Bijlage {} is leeg.", a.name))),
        };
        if size > MAX_ATTACHMENT_BYTES {
            return Err(invalid(format!("{} is groter dan 25 MB.", a.name)));
        }
    }
    Ok(())
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// One line of the request's context list: path and description.
type Listed = (String, &'static str);

fn write_context(
    input: &TurnInput,
    workdir: &Path,
    meta: &Path,
    listed: &mut Vec<Listed>,
    guard: &Guard,
) -> Result<()> {
    let ctx = meta.join("context");
    fs::create_dir_all(&ctx).map_err(io(&ctx))?;
    let write = |rel: &str, bytes: &[u8]| -> Result<()> {
        let path = ctx.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(io(parent))?;
        }
        fs::write(&path, bytes).map_err(io(&path))
    };
    let c = &input.context;
    if c.guide {
        write("assignment-authoring.md", GUIDE.as_bytes())?;
        listed.push((
            ".maatwerk/context/assignment-authoring.md".into(),
            "how to write an opdracht: the lib.typ API, the rules and the checks. Read it first.",
        ));
        for (name, text) in EXAMPLES {
            write(&format!("examples/{name}"), text.as_bytes())?;
        }
        listed.push((
            ".maatwerk/context/examples/".into(),
            "example opdracht.typ files that compile cleanly",
        ));
    }
    if let Some(m) = &c.metadata {
        let json = serde_json::to_string_pretty(m).map_err(|e| invalid(e.to_string()))?;
        write("opdracht.json", json.as_bytes())?;
        listed.push((
            ".maatwerk/context/opdracht.json".into(),
            "the opdracht's data: title, subject (vak), school type, year levels, linked observations",
        ));
    }
    let needs_compile = c.diagnostics || c.pdf;
    let assignment = if needs_compile {
        Assignment::open(workdir).ok()
    } else {
        None
    };
    if c.diagnostics
        && let Some(a) = assignment.clone()
    {
        // Stop and the time limit end the wait (review 32 m7); the turn then keeps nothing.
        let report = guard.wait(CONTEXT_COMPILE_LIMIT, move || {
            assignment::check(
                &a,
                RenderOptions::default(),
                FontStore::shared(),
                local_now(),
            )
        });
        if let Some(r) = report {
            let json = serde_json::to_string_pretty(&r).map_err(|e| invalid(e.to_string()))?;
            write("diagnostics.json", json.as_bytes())?;
            listed.push((
                ".maatwerk/context/diagnostics.json".into(),
                "the current errors, warnings and checks of the opdracht (same format as the check)",
            ));
        }
    }
    if c.pdf
        && let Some(a) = assignment
    {
        let pdf = guard.wait(CONTEXT_COMPILE_LIMIT, move || {
            assignment::render_pdf(
                &a,
                RenderOptions::default(),
                FontStore::shared(),
                local_now(),
            )
        });
        if let Some(Ok(compiled)) = pdf {
            write("opdracht.pdf", &compiled.output)?;
            listed.push((
                ".maatwerk/context/opdracht.pdf".into(),
                "the opdracht as it prints now (placeholder header; grey boxes for images you were not given)",
            ));
        }
    }
    if let Some(syllabus) = &c.syllabus {
        let name = file_name(syllabus);
        let bytes = fs::read(syllabus).map_err(io(syllabus))?;
        write(&format!("syllabus/{name}"), &bytes)?;
        listed.push((
            format!(".maatwerk/context/syllabus/{name}"),
            "the exam syllabus for this subject and school type: use its terms and level",
        ));
    }
    for other in &c.others {
        check_segment(&other.id, "opdracht")?;
        write(
            &format!("other-opdrachten/{}.typ", other.id),
            other.text.as_bytes(),
        )?;
    }
    if !c.others.is_empty() {
        listed.push((
            ".maatwerk/context/other-opdrachten/".into(),
            "other opdrachten of this teacher, as examples of style and level (do not copy them blindly)",
        ));
    }
    Ok(())
}

/// The last path segment, cleaned to a safe file name.
fn file_name(path: &Path) -> String {
    let raw = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    safe_name(&raw)
}

/// `clean_image_name` for the stem, the extension kept (lower case).
fn safe_name(raw: &str) -> String {
    let ext = extension_of(raw);
    let stem = clean_image_name(stem_of(raw));
    let stem = if stem.is_empty() {
        "bijlage".to_owned()
    } else {
        stem
    };
    if ext.is_empty() {
        stem
    } else {
        format!("{stem}.{ext}")
    }
}

fn write_attachments(
    attachments: &[Attachment],
    meta: &Path,
    listed: &mut Vec<Listed>,
) -> Result<Vec<PathBuf>> {
    let dir = meta.join("attachments");
    let mut images = Vec::new();
    let mut used = Vec::new();
    for a in attachments {
        fs::create_dir_all(&dir).map_err(io(&dir))?;
        let mut name = safe_name(&a.name);
        if a.text.is_some() && extension_of(&name).is_empty() {
            name.push_str(".txt");
        }
        let mut unique = name.clone();
        let mut n = 2;
        while used.contains(&unique.to_ascii_lowercase()) {
            unique = format!("{}-{n}.{}", stem_of(&name), extension_of(&name));
            n += 1;
        }
        used.push(unique.to_ascii_lowercase());
        let target = dir.join(&unique);
        match (&a.path, &a.text, &a.bytes) {
            (Some(p), _, _) => {
                fs::copy(p, &target).map_err(io(p))?;
            }
            (_, Some(t), _) => fs::write(&target, t).map_err(io(&target))?,
            (_, _, Some(b)) => fs::write(&target, b).map_err(io(&target))?,
            _ => {}
        }
        if ["png", "jpg", "jpeg", "gif", "webp"].contains(&extension_of(&unique).as_str()) {
            images.push(target.clone());
        }
        listed.push((
            format!(".maatwerk/attachments/{unique}"),
            "attached by the teacher",
        ));
    }
    Ok(images)
}

/// The syllabus `name` in `dir` (decision 52): a plain PDF name only. No separators and no
/// drive (`C:x.pdf` would make `join` leave the folder on Windows), no hidden file (review 32
/// m1).
pub fn syllabus_file(dir: &Path, name: &str) -> Result<PathBuf> {
    if name.contains(['/', '\\', ':'])
        || name.starts_with('.')
        || !name.to_ascii_lowercase().ends_with(".pdf")
    {
        return Err(invalid("Ongeldige syllabus."));
    }
    Ok(dir.join(name))
}

/// Reads the baseline a turn wrote ([`prepare`]), e.g. after the app restarted.
pub fn read_baseline(run_dir: &Path) -> Result<Baseline> {
    let path = run_dir.join("baseline.json");
    let bytes = fs::read(&path).map_err(io(&path))?;
    serde_json::from_slice(&bytes).map_err(|e| invalid(e.to_string()))
}

mod images;
mod provider_files;
mod request;

use images::copy_images;
pub use images::placeholder;
use provider_files::{write_check_scripts, write_provider_files};
use request::request_text;

#[cfg(test)]
mod tests;
