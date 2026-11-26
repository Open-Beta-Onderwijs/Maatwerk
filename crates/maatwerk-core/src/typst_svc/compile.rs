// SPDX-License-Identifier: AGPL-3.0-or-later

//! Compiling a [`MaatwerkWorld`] to a document or a PDF. Blocking and CPU-heavy: callers on an
//! async runtime use `spawn_blocking` (PLAN 2.5).

use std::cell::Cell;

use time::OffsetDateTime;
use typst::diag::Warned;
use typst::foundations::Datetime;
use typst_layout::PagedDocument;
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

/// Lays out the document. Warnings include characters that no font could draw.
pub fn compile_document(world: &MaatwerkWorld) -> Result<Compiled<PagedDocument>, CompileError> {
    let Warned { output, warnings } = typst::compile::<PagedDocument>(world);
    let mut warnings = diagnostics::convert(world, &warnings);
    // Bound the memoisation cache between compiles, as the Typst CLI does.
    if !DEFER_EVICTION.get() {
        evict();
    }
    match output {
        Ok(document) => {
            warnings.extend(diagnostics::tofu_warnings(world, &document));
            Ok(Compiled {
                output: document,
                warnings,
            })
        }
        Err(errors) => {
            let mut diagnostics = diagnostics::convert(world, &errors);
            diagnostics.extend(warnings);
            Err(CompileError { diagnostics })
        }
    }
}

thread_local! {
    static DEFER_EVICTION: Cell<bool> = const { Cell::new(false) };
}

/// Ages the memoisation cache by one step and drops what was not used in the last 10 steps.
pub(crate) fn evict() {
    typst::comemo::evict(10);
}

/// Runs `f` without an [`evict`] after each compile on this thread; the caller evicts itself.
/// The cache is process-wide: a batch that evicted after every job aged an open editor's
/// entries out (review 8a m2), so the batch evicts every few jobs instead.
pub(crate) fn deferring_eviction<R>(f: impl FnOnce() -> R) -> R {
    struct Reset(bool);
    impl Drop for Reset {
        fn drop(&mut self) {
            DEFER_EVICTION.set(self.0);
        }
    }
    let _reset = Reset(DEFER_EVICTION.replace(true));
    f()
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

/// Compiles to one SVG string per page (`typst_svg::svg`, as the CLI's `--format svg`). Images
/// are embedded as data URIs, which the editor's CSP (`img-src data: blob:`) needs.
pub fn compile_svg_pages(world: &MaatwerkWorld) -> Result<Compiled<Vec<String>>, CompileError> {
    let Compiled { output, warnings } = compile_document(world)?;
    Ok(Compiled {
        output: output.pages().iter().map(svg_page).collect(),
        warnings,
    })
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

/// One page as SVG, as the CLI's `--format svg` (page bounds, compact).
pub(crate) fn svg_page(page: &typst_layout::Page) -> String {
    typst_svg::svg(page, &typst_svg::SvgOptions::default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn review_8a_m2_eviction_is_deferred_only_inside_and_restored_after_a_panic() {
        assert!(!DEFER_EVICTION.get());
        deferring_eviction(|| {
            assert!(DEFER_EVICTION.get());
            deferring_eviction(|| assert!(DEFER_EVICTION.get()));
            assert!(DEFER_EVICTION.get(), "nested calls keep it");
        });
        assert!(!DEFER_EVICTION.get());
        let panicked = std::panic::catch_unwind(|| deferring_eviction(|| panic!("boom")));
        assert!(panicked.is_err());
        assert!(!DEFER_EVICTION.get());
    }
}
