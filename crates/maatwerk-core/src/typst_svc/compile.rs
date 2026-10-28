// SPDX-License-Identifier: AGPL-3.0-or-later

//! Compiling a [`MaatwerkWorld`] to a document or a PDF. Blocking and CPU-heavy: callers on an
//! async runtime use `spawn_blocking` (PLAN 2.5).

use time::OffsetDateTime;
use typst::diag::Warned;
use typst::foundations::Datetime;
use typst::layout::PagedDocument;
use typst_pdf::{PdfOptions, Timestamp};

use super::diagnostics::{self, Diagnostic, Severity};
use super::world::MaatwerkWorld;

/// A successful compile and the warnings it produced (the reference dropped them; T14).
#[derive(Debug, Clone)]
pub struct Compiled<T> {
    pub output: T,
    pub warnings: Vec<Diagnostic>,
}

/// A failed compile: the errors first, then any warnings.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{}", summary(.diagnostics))]
pub struct CompileError {
    pub diagnostics: Vec<Diagnostic>,
}

impl CompileError {
    /// The diagnostics as CLI-like text (the reference showed Typst's stderr).
    pub fn to_text(&self) -> String {
        diagnostics::to_text(&self.diagnostics)
    }
}

fn summary(diags: &[Diagnostic]) -> String {
    match diags.iter().find(|d| d.severity == Severity::Error) {
        Some(d) => format!("Typst error: {}", d.message),
        None => "Typst error".to_owned(),
    }
}

/// The local time, falling back to UTC where the offset cannot be determined.
pub fn local_now() -> OffsetDateTime {
    OffsetDateTime::now_local().unwrap_or_else(|_| OffsetDateTime::now_utc())
}

/// Lays out the document.
pub fn compile_document(world: &MaatwerkWorld) -> Result<Compiled<PagedDocument>, CompileError> {
    let Warned { output, warnings } = typst::compile::<PagedDocument>(world);
    let warnings = diagnostics::convert(world, &warnings);
    // Bound the memoisation cache between compiles, as the Typst CLI does.
    typst::comemo::evict(10);
    match output {
        Ok(document) => Ok(Compiled {
            output: document,
            warnings,
        }),
        Err(errors) => {
            let mut diagnostics = diagnostics::convert(world, &errors);
            diagnostics.extend(warnings);
            Err(CompileError { diagnostics })
        }
    }
}

/// Compiles to PDF (standard Typst PDF, no PDF/A, as the reference). The creation date is
/// `world`'s clock, so a fixed clock gives byte-identical PDFs.
pub fn compile_pdf(world: &MaatwerkWorld) -> Result<Compiled<Vec<u8>>, CompileError> {
    let Compiled { output, warnings } = compile_document(world)?;
    let options = PdfOptions {
        timestamp: pdf_timestamp(world.now()),
        ..PdfOptions::default()
    };
    match typst_pdf::pdf(&output, &options) {
        Ok(pdf) => Ok(Compiled {
            output: pdf,
            warnings,
        }),
        Err(errors) => {
            let mut diagnostics = diagnostics::convert(world, &errors);
            diagnostics.extend(warnings);
            Err(CompileError { diagnostics })
        }
    }
}

fn pdf_timestamp(now: OffsetDateTime) -> Option<Timestamp> {
    let datetime = Datetime::from_ymd_hms(
        now.year(),
        now.month().into(),
        now.day(),
        now.hour(),
        now.minute(),
        now.second(),
    )?;
    Timestamp::new_local(datetime, i32::from(now.offset().whole_minutes()))
}
