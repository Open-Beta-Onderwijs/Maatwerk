// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri commands for Typst and the PDFs it makes (`ipc-api.md` methods 28, 30-32; ADR-0002
//! section 9). PDFs go to the output folder; the UI gets an output ID, which the viewer loads
//! through the `maatwerk-out` URI scheme (`scheme.rs`) and which printing copies into
//! `rapporten/`.

use maatwerk_core::outputs::{self, PrintName};
use maatwerk_core::paths::RelPath;
use maatwerk_core::typst_svc::{
    self, BatchError, BatchJob, BatchOptions, BatchProgress, Diagnostic, Mode, OpdrachtHeader,
    OpdrachtInputs, RapportData, TypstProject, local_now,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use tauri_specta::Event;

use crate::commands::{Res, blocking};
use crate::error::CommandError;
use crate::state::{Core, Shared};

/// Progress of a batch: once with `done: 0`, then after every job (`assignment:progress`).
#[derive(Debug, Clone, Serialize, Type, Event)]
#[tauri_specta(event_name = "assignment:progress")]
pub struct AssignmentProgress {
    pub done: u32,
    pub total: u32,
}

/// A compiled PDF in the output folder.
#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RenderedPdf {
    /// The output ID (not a path): for `pdfUrl`, `open_path` and `print_pdf`.
    pub pdf_path: String,
    /// Warnings as text, e.g. characters no font can draw (the reference dropped them; T14).
    pub warnings: Vec<String>,
}

/// A merged batch in the output folder.
#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RenderedBatch {
    pub pdf_path: String,
    /// Pages of the merged PDF, blank duplex pages included.
    pub pages: u32,
    pub warnings: Vec<String>,
}

#[derive(Serialize, Type)]
pub struct RenderedSvg {
    /// One SVG document per page.
    pub pages: Vec<String>,
    pub warnings: Vec<String>,
}

/// One `renderAssignmentBatch` job, as `modals/opdrachten-genereren.js` builds it.
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BatchJobArg {
    pub key: String,
    pub typ_file: String,
    pub label: Option<String>,
    /// `{ title, student, group, exam, observaties: [{ icon, name }] }`; fields may be missing.
    pub header: Option<Value>,
    /// `answers` for the answer key; anything else is the student's opdracht.
    pub mode: Option<String>,
}

#[derive(Debug, Default, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BatchOptionsArg {
    /// Default true.
    pub include_answers: Option<bool>,
    /// Default false.
    pub duplex: Option<bool>,
    /// Default `opdrachten.pdf`.
    pub output_name: Option<String>,
}

/// What a printed copy is called (ADR-0002 section 9): `rapporten/<schooljaar>/<YYYY-MM-DD HHmm>
/// <soort> <vak> <groep> <toets>.pdf`. Empty parts are left out.
#[derive(Debug, Deserialize, Type)]
pub struct PrintNameArg {
    pub schooljaar: String,
    pub soort: String,
    pub vak: String,
    pub groep: String,
    pub toets: String,
}

fn warning_texts(warnings: &[Diagnostic]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for w in warnings {
        let text = typst_svc::to_text(std::slice::from_ref(w));
        if !out.contains(&text) {
            out.push(text);
        }
    }
    out
}

fn invalid_file_name(name: &str) -> CommandError {
    CommandError::from(maatwerk_core::Error::InvalidArgument {
        message: format!("Ongeldige bestandsnaam: {name}"),
    })
}

/// A v1 opdracht project for a bare `.typ` name, else the reference's error text.
fn opdracht_project(core: &Core, typ_file: &str) -> Res<TypstProject> {
    TypstProject::opdracht_v1(core.storage()?.data_dir(), typ_file).map_err(|e| match e {
        maatwerk_core::Error::InvalidPath { .. } => invalid_file_name(typ_file),
        e => e.into(),
    })
}

/// All students of one toets in one PDF. `examId` is unused, as in the reference. The UI passes
/// the payload through `normaliseForTypst` first.
#[tauri::command]
#[specta::specta]
pub async fn render_rapport_pdf(
    state: State<'_, Shared>,
    exam_id: String,
    students: Value,
    exam_info: Value,
) -> Res<RenderedPdf> {
    let _ = exam_id;
    blocking(state, move |c| {
        let data = RapportData {
            exam_info,
            students,
        };
        let compiled =
            typst_svc::render_rapport_pdf(c.fonts(), &data, c.storage()?.data_dir(), local_now())
                .map_err(|e| CommandError::typst(e.to_text()))?;
        let pdf_path = c.outputs()?.put("rapport_preview.pdf", &compiled.output)?;
        Ok(RenderedPdf {
            pdf_path,
            warnings: warning_texts(&compiled.warnings),
        })
    })
    .await
}

/// The editor preview: the buffer (`previewContent`, default empty) compiled as the opdracht,
/// with the placeholder header and the cursor marker, one SVG per page.
#[tauri::command]
#[specta::specta]
pub async fn render_assignment_svg(
    state: State<'_, Shared>,
    typ_file: String,
    title: String,
    preview_content: Option<String>,
) -> Res<RenderedSvg> {
    blocking(state, move |c| {
        let project = opdracht_project(c, &typ_file)?.with_file(
            &RelPath::parse("opdracht.typ")?,
            preview_content.unwrap_or_default(),
        );
        let compiled = typst_svc::render_assignment_svg_pages(
            c.fonts(),
            project,
            &OpdrachtInputs::preview(title, true),
            local_now(),
        )
        .map_err(|e| CommandError::typst(e.to_text()))?;
        Ok(RenderedSvg {
            pages: compiled.output,
            warnings: warning_texts(&compiled.warnings),
        })
    })
    .await
}

/// Compiles every job and merges them in job order; reports `assignment:progress`.
#[tauri::command]
#[specta::specta]
pub async fn render_assignment_batch(
    state: State<'_, Shared>,
    app: AppHandle,
    jobs: Vec<BatchJobArg>,
    opts: Option<BatchOptionsArg>,
) -> Res<RenderedBatch> {
    blocking(state, move |c| {
        let opts = opts.unwrap_or_default();
        if jobs.is_empty() {
            return Err(invalid_argument(BatchError::Empty.to_string()));
        }
        let output_name = opts
            .output_name
            .unwrap_or_else(|| "opdrachten.pdf".to_owned());
        let include_answers = opts.include_answers.unwrap_or(true);
        let mut batch = Vec::with_capacity(jobs.len());
        for job in &jobs {
            batch.push(BatchJob {
                key: job.key.clone(),
                label: job.label.clone().unwrap_or_else(|| job.typ_file.clone()),
                project: opdracht_project(c, &job.typ_file)?,
                inputs: OpdrachtInputs {
                    mode: match job.mode.as_deref() {
                        Some("answers") => Mode::Answers,
                        _ => Mode::Student,
                    },
                    include_answers,
                    cursor: false,
                    header: header(job.header.clone())?,
                },
            });
        }
        outputs::check_output_name(&output_name).map_err(|_| invalid_file_name(&output_name))?;
        let progress = |p: BatchProgress| {
            let event = AssignmentProgress {
                done: u32::try_from(p.done).unwrap_or(u32::MAX),
                total: u32::try_from(p.total).unwrap_or(u32::MAX),
            };
            if let Err(e) = event.emit(&app) {
                tracing::warn!("emitting assignment:progress failed: {e}");
            }
        };
        let options = BatchOptions {
            duplex: opts.duplex.unwrap_or(false),
            workers: None,
        };
        let out =
            typst_svc::render_assignment_batch(c.fonts(), batch, options, local_now(), &progress)
                .map_err(|e| match e {
                BatchError::Empty => invalid_argument(e.to_string()),
                e => CommandError::typst(e.to_string()),
            })?;
        let warnings: Vec<Diagnostic> = out.warnings.into_iter().map(|w| w.diagnostic).collect();
        Ok(RenderedBatch {
            pdf_path: c.outputs()?.put(&output_name, &out.merged.pdf)?,
            pages: u32::try_from(out.merged.pages).unwrap_or(u32::MAX),
            warnings: warning_texts(&warnings),
        })
    })
    .await
}

fn invalid_argument(message: String) -> CommandError {
    CommandError::from(maatwerk_core::Error::InvalidArgument { message })
}

/// `job.header ?? {}`; missing and `null` fields are empty.
fn header(value: Option<Value>) -> Res<OpdrachtHeader> {
    match value {
        None | Some(Value::Null) => Ok(OpdrachtHeader::default()),
        Some(v) => serde_json::from_value(v)
            .map_err(|e| invalid_argument(format!("invalid opdracht header: {e}"))),
    }
}

/// Opens a render output (by ID) or a printed copy (`rapporten/<schooljaar>/<name>.pdf`) with
/// the OS. Unlike the reference, nothing else: not an absolute path and not other files in the
/// shared folder (ADR-0002 section 7, review 6a M1).
#[tauri::command]
#[specta::specta]
pub async fn open_path(state: State<'_, Shared>, app: AppHandle, target: String) -> Res<()> {
    let path = blocking(state, move |c| {
        Ok(outputs::openable_path(c.storage()?, c.outputs()?, &target)?)
    })
    .await?;
    open_with_os(app, path).await
}

/// "Afdrukken": copies the output into `rapporten/<schooljaar>/` under a descriptive name, opens
/// the copy with the OS and returns its data-relative path. If only the opening fails, the error
/// says where the copy was saved.
#[tauri::command]
#[specta::specta]
pub async fn print_pdf(
    state: State<'_, Shared>,
    app: AppHandle,
    pdf_path: String,
    name: PrintNameArg,
) -> Res<String> {
    let (rel, abs) = blocking(state, move |c| {
        let pdf = c.outputs()?.read(&pdf_path)?;
        let storage = c.storage()?;
        let name = PrintName {
            schooljaar: name.schooljaar,
            soort: name.soort,
            vak: name.vak,
            groep: name.groep,
            toets: name.toets,
        };
        let rel = outputs::print_copy(storage, &pdf, &name, local_now())?;
        let abs = storage.data_dir().resolve(&rel)?;
        Ok((rel.as_str().to_owned(), abs))
    })
    .await?;
    open_with_os(app, abs).await.map_err(|e| {
        CommandError::internal(format!(
            "Opgeslagen als {rel}, maar openen lukte niet: {}",
            e.message
        ))
    })?;
    Ok(rel)
}

/// ShellExecute can block (file associations, a slow share): off the async runtime (m5).
async fn open_with_os(app: AppHandle, path: std::path::PathBuf) -> Res<()> {
    tauri::async_runtime::spawn_blocking(move || {
        app.opener()
            .open_path(path.to_string_lossy(), None::<&str>)
            .map_err(|e| CommandError::internal(format!("opening the file failed: {e}")))
    })
    .await
    .map_err(|e| CommandError::internal(format!("open task failed: {e}")))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn headers_may_be_missing_null_or_partial() {
        assert_eq!(header(None).unwrap(), OpdrachtHeader::default());
        assert_eq!(
            header(Some(Value::Null)).unwrap(),
            OpdrachtHeader::default()
        );
        let h = header(Some(
            serde_json::json!({ "title": "Remweg", "student": null }),
        ))
        .unwrap();
        assert_eq!((h.title.as_str(), h.student.as_str()), ("Remweg", ""));
    }

    #[test]
    fn warnings_are_deduplicated() {
        let w = Diagnostic::error("tofu");
        assert_eq!(warning_texts(&[w.clone(), w]).len(), 1);
    }
}
