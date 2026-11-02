// SPDX-License-Identifier: AGPL-3.0-or-later

//! The headless opdracht API (Step 9): `check`, `render` and `export_lib` on **one** opdracht
//! folder (ADR-0002 5a). This is the seam a later AI integration, or any external tool, uses
//! (ADR-0009): it sees exactly that folder and nothing else of the data folder (the Typst World
//! is sandboxed to it), and gets structured diagnostics and the vragen back, the same facts the
//! editor shows. `maatwerk-cli assignment ...` is a thin wrapper; the JSON of [`CheckReport`] is
//! specified in `docs/schemas/assignment-check.schema.json`.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use time::OffsetDateTime;
use typst::foundations::{Dict, IntoValue};

use crate::assets;
use crate::error::{Error, Result};
use crate::paths::{RelPath, display_path};
use crate::typst_svc::{
    CompileError, Compiled, Diagnostic, FontStore, INPUTS_KEY, Location, Mode, Severity,
    TypstProject, compile_document, compile_pdf, vragen,
};

/// The `schema` value of a [`CheckReport`]; bump the number on an incompatible change.
pub const CHECK_SCHEMA: &str = "maatwerk-assignment-check/1";

/// The entry file of an opdracht folder.
const MAIN: &str = "main.typ";

/// An opdracht to compile: its folder (the sandbox root) and the entry file in it.
#[derive(Debug, Clone, PartialEq)]
pub struct Assignment {
    root: PathBuf,
    entry: RelPath,
}

impl Assignment {
    /// Opens `path`: an opdracht folder (entry `main.typ`), or a `.typ` file in one.
    /// `opdracht.typ` means the `main.typ` next to it, since `opdracht.typ` only defines
    /// functions and lays out nothing on its own. The folder must look like an opdracht folder
    /// ([`is_opdracht_folder`]); it is the root of the sandbox.
    pub fn open(path: &Path) -> Result<Assignment> {
        let real = path
            .canonicalize()
            .map_err(|e| Error::io(display_path(path), e))?;
        let (root, name) = if real.is_dir() {
            (real, MAIN.to_owned())
        } else {
            let name = real
                .file_name()
                .and_then(|n| n.to_str())
                .ok_or_else(|| invalid("De bestandsnaam is geen geldige UTF-8."))?
                .to_owned();
            let root = real
                .parent()
                .ok_or_else(|| invalid("Het bestand heeft geen map."))?
                .to_path_buf();
            (root, name)
        };
        // The folder is the sandbox: only an opdracht folder may be one, never e.g. the data
        // folder that a stray .typ file happens to be in (review 9 M2).
        if !is_opdracht_folder(&root) {
            return Err(invalid(&format!(
                "{} is geen opdrachtmap: daarin horen main.typ en opdracht.typ (en geen \
                 config.json van een gegevensmap).",
                display_path(&root)
            )));
        }
        let name = if name == "opdracht.typ" {
            MAIN.to_owned()
        } else {
            name
        };
        if !root.join(&name).is_file() {
            return Err(invalid(&format!(
                "{name} ontbreekt in {}.",
                display_path(&root)
            )));
        }
        Ok(Assignment {
            entry: RelPath::parse(&name)?,
            root,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn entry(&self) -> &str {
        self.entry.as_str()
    }

    fn project(&self, options: RenderOptions) -> TypstProject {
        let project = TypstProject::folder(&self.root, &self.entry);
        if options == RenderOptions::default() {
            // No inputs: main.typ uses its placeholder header, as `typst compile` would.
            return project;
        }
        let json = serde_json::json!({
            "mode": options.mode,
            "include_answers": options.include_answers,
        });
        let mut inputs = Dict::new();
        inputs.insert(INPUTS_KEY.into(), json.to_string().into_value());
        project.with_inputs(inputs)
    }
}

/// True for a folder with `main.typ` and `opdracht.typ` and without a data folder's
/// `config.json`.
pub fn is_opdracht_folder(dir: &Path) -> bool {
    dir.join(MAIN).is_file()
        && dir.join("opdracht.typ").is_file()
        && !dir.join("config.json").exists()
}

fn invalid(message: &str) -> Error {
    Error::InvalidArgument {
        message: message.to_owned(),
    }
}

/// What to lay out. The student header is always `main.typ`'s placeholder: no student data
/// goes into a headless compile.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RenderOptions {
    pub mode: Mode,
    /// Student mode: the answers upside down at the bottom.
    pub include_answers: bool,
}

impl Default for RenderOptions {
    fn default() -> RenderOptions {
        RenderOptions {
            mode: Mode::Student,
            include_answers: true,
        }
    }
}

/// The result of [`check`] (`docs/schemas/assignment-check.schema.json`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckReport {
    pub schema: &'static str,
    /// True when the opdracht compiled (no errors; warnings and checks may remain).
    pub ok: bool,
    /// The compiled file, relative to the opdracht folder. The folder itself is not in the
    /// report: its absolute path holds e.g. the Windows user name (review 9 m6).
    pub entry: String,
    pub mode: Mode,
    /// `None` when it did not compile.
    pub page_count: Option<usize>,
    /// Errors first, then warnings, as the compiler reports them.
    pub diagnostics: Vec<CheckDiagnostic>,
    pub vragen: Vec<CheckVraag>,
    /// The sum of the known punten.
    pub total_punten: f64,
    /// The editor's checks on the vragen, in Dutch ("Vraag 2a heeft geen antwoord.").
    pub checks: Vec<String>,
}

impl CheckReport {
    pub fn errors(&self) -> usize {
        self.diagnostics
            .iter()
            .filter(|d| d.severity == Severity::Error)
            .count()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CheckDiagnostic {
    pub severity: Severity,
    pub message: String,
    pub hints: Vec<String>,
    pub location: Option<CheckLocation>,
    /// Where the error came through (e.g. the call in opdracht.typ of a function in lib.typ).
    pub trace: Vec<CheckTrace>,
}

/// A place in a file of the opdracht folder. `line` and `column` are 1-based (column in
/// Unicode scalar values); `range` is the UTF-8 byte range, end exclusive.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CheckLocation {
    /// Relative to the opdracht folder, `/` as separator.
    pub file: String,
    pub line: usize,
    pub column: usize,
    pub range: [usize; 2],
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CheckTrace {
    pub message: String,
    pub location: Option<CheckLocation>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CheckVraag {
    /// The opgave number; 0 for a vraag outside any `#opgave`.
    pub opgave: u64,
    /// "1", "2a", ... as on the answer key.
    pub label: String,
    /// `None` when not given or not a finite number.
    pub punten: Option<f64>,
    /// The answer as plain text.
    pub antwoord: Option<String>,
    /// 1-based page the vraag is on; `None` in answers mode, where the opdracht is laid out
    /// hidden and only the answer list shows.
    pub page: Option<usize>,
}

fn location(l: &Location) -> CheckLocation {
    CheckLocation {
        file: l.file.trim_start_matches('/').to_owned(),
        line: l.line,
        column: l.column,
        range: [l.range.0, l.range.1],
    }
}

fn diagnostic(d: &Diagnostic) -> CheckDiagnostic {
    CheckDiagnostic {
        severity: d.severity,
        message: d.message.clone(),
        hints: d.hints.clone(),
        location: d.location.as_ref().map(location),
        trace: d
            .trace
            .iter()
            .map(|t| CheckTrace {
                message: t.message.clone(),
                location: t.location.as_ref().map(location),
            })
            .collect(),
    }
}

/// Compiles the opdracht and reports diagnostics, page count, vragen, total punten and the
/// editor's checks. A compile error is part of the report, not an `Err`.
pub fn check(
    assignment: &Assignment,
    options: RenderOptions,
    fonts: Arc<FontStore>,
    now: OffsetDateTime,
) -> CheckReport {
    let world = assignment.project(options).world(fonts, now);
    let mut report = CheckReport {
        schema: CHECK_SCHEMA,
        ok: false,
        entry: assignment.entry().to_owned(),
        mode: options.mode,
        page_count: None,
        diagnostics: Vec::new(),
        vragen: Vec::new(),
        total_punten: 0.0,
        checks: Vec::new(),
    };
    match compile_document(&world) {
        Ok(Compiled { output, warnings }) => {
            let v = vragen(&output);
            let answers = options.mode == Mode::Answers;
            report.ok = true;
            report.page_count = Some(output.pages.len());
            report.diagnostics = warnings.iter().map(diagnostic).collect();
            report.vragen = v
                .items
                .into_iter()
                .map(|q| CheckVraag {
                    opgave: q.opgave,
                    label: q.label,
                    punten: q.punten.filter(|p| p.is_finite()),
                    antwoord: q.antwoord,
                    page: (!answers).then_some(q.page + 1),
                })
                .collect();
            report.total_punten = report.vragen.iter().filter_map(|q| q.punten).sum();
            report.checks = v.checks;
        }
        Err(e) => report.diagnostics = e.diagnostics.iter().map(diagnostic).collect(),
    }
    report
}

/// Compiles the opdracht to PDF, with the placeholder header.
pub fn render_pdf(
    assignment: &Assignment,
    options: RenderOptions,
    fonts: Arc<FontStore>,
    now: OffsetDateTime,
) -> std::result::Result<Compiled<Vec<u8>>, CompileError> {
    compile_pdf(&assignment.project(options).world(fonts, now))
}

/// The name of the read-me that [`export_lib`] writes.
pub const EXPORT_README: &str = "LEESMIJ.txt";

/// Every file [`export_lib`] writes, as `(relative path, bytes)`: the bundled `lib.typ`,
/// `main.typ` and the starting `opdracht.typ`, the embedded packages under `packages/` (Typst's
/// `--package-path` layout), the embedded fonts under `fonts/`, and a read-me.
pub fn export_files() -> Vec<(String, &'static [u8])> {
    let mut files: Vec<(String, &'static [u8])> = vec![
        ("lib.typ".into(), assets::LIB_TYP.as_bytes()),
        ("main.typ".into(), assets::OPDRACHT_MAIN_TYP.as_bytes()),
        (
            "opdracht.typ".into(),
            assets::BASE_ASSIGNMENT_TYP.as_bytes(),
        ),
        (EXPORT_README.into(), EXPORT_README_TEXT.as_bytes()),
    ];
    files.extend(
        assets::PACKAGE_FILES
            .iter()
            .map(|(path, bytes)| (format!("packages/{path}"), *bytes)),
    );
    files.extend(
        assets::FONTS
            .iter()
            .map(|(name, bytes)| (format!("fonts/{name}"), *bytes)),
    );
    files
}

const EXPORT_README_TEXT: &str = include_str!("../assets/export-readme.txt");

/// Writes [`export_files`] into `dir` (created when missing) for an external editor such as
/// tinymist, or the plain Typst CLI. A file that exists with other content is left alone and
/// the export fails before writing anything, unless `overwrite`. Returns the written paths.
pub fn export_lib(dir: &Path, overwrite: bool) -> Result<Vec<String>> {
    let files = export_files();
    if !overwrite {
        let clashes: Vec<&str> = files
            .iter()
            .filter(|(rel, bytes)| match fs::read(dir.join(rel)) {
                Ok(existing) => existing != *bytes,
                Err(_) => false,
            })
            .map(|(rel, _)| rel.as_str())
            .collect();
        if !clashes.is_empty() {
            return Err(invalid(&format!(
                "Deze bestanden bestaan al met een andere inhoud: {}. Kies een lege map of \
                 overschrijf ze bewust.",
                clashes.join(", ")
            )));
        }
    }
    let mut written = Vec::new();
    for (rel, bytes) in &files {
        let path = dir.join(rel);
        let io_err = |e: io::Error| Error::io(display_path(&path), e);
        if fs::read(&path).is_ok_and(|existing| existing == *bytes) {
            continue;
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(io_err)?;
        }
        fs::write(&path, bytes).map_err(io_err)?;
        written.push(rel.clone());
    }
    Ok(written)
}

#[cfg(test)]
mod tests;
