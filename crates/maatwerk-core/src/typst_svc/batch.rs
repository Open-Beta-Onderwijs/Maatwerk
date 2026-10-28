// SPDX-License-Identifier: AGPL-3.0-or-later

//! A batch of opdracht jobs (path D, `typst-contract.md` 4.3): every (student, opdracht) is its
//! own compile, because opdracht files share function names and labels. Jobs run on a few worker
//! threads that share the font store and the embedded packages; the PDFs are merged in job order.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use time::OffsetDateTime;

use super::compile::{CompileError, Compiled};
use super::diagnostics::Diagnostic;
use super::fonts::FontStore;
use super::opdracht::{OpdrachtInputs, render_assignment_pdf};
use super::project::TypstProject;
use crate::pdf_merge::{MergeError, MergePart, Merged, pdf_merge};

/// One compile of the batch.
#[derive(Debug, Clone)]
pub struct BatchJob {
    /// Jobs with the same key (student) are kept together; duplex pads between keys.
    pub key: String,
    /// Shown in the error text (`label ?? typFile` in the reference).
    pub label: String,
    pub project: TypstProject,
    pub inputs: OpdrachtInputs,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BatchOptions {
    /// Every key starts on an odd page (student opdrachten; not the answer key).
    pub duplex: bool,
    /// Worker threads; `None` is [`batch_workers`].
    pub workers: Option<usize>,
}

/// Progress after each finished job; also sent once at the start with `done: 0`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BatchProgress {
    pub done: usize,
    pub total: usize,
}

/// A warning of one job.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JobWarning {
    pub index: usize,
    pub label: String,
    pub diagnostic: Diagnostic,
}

#[derive(Debug)]
pub struct BatchOutput {
    pub merged: Merged,
    pub warnings: Vec<JobWarning>,
}

#[derive(Debug, thiserror::Error)]
pub enum BatchError {
    /// The reference's text for an empty job list.
    #[error("Er is niets om te genereren.")]
    Empty,
    /// The reference's `Fout in opdracht "<label>":\n\n<stderr>`.
    #[error("Fout in opdracht \"{label}\":\n\n{}", .error.to_text())]
    Compile {
        index: usize,
        label: String,
        error: CompileError,
    },
    #[error(transparent)]
    Merge(#[from] MergeError),
}

/// `BATCH_PARALLEL = max(2, min(4, cpus - 1))` (`main.js:813-917`).
pub fn batch_workers() -> usize {
    let cpus = std::thread::available_parallelism().map_or(1, usize::from);
    cpus.saturating_sub(1).clamp(2, 4)
}

/// Compiles every job and merges the PDFs in job order. The first failure stops the batch:
/// running jobs finish, no new job starts, and the failed job with the lowest index is reported
/// (the reference reported the first to fail in time, which depends on scheduling; T23).
pub fn render_assignment_batch(
    fonts: Arc<FontStore>,
    jobs: Vec<BatchJob>,
    options: BatchOptions,
    now: OffsetDateTime,
    progress: &(dyn Fn(BatchProgress) + Sync),
) -> Result<BatchOutput, BatchError> {
    let total = jobs.len();
    if total == 0 {
        return Err(BatchError::Empty);
    }
    let keys: Vec<String> = jobs.iter().map(|j| j.key.clone()).collect();
    let labels: Vec<String> = jobs.iter().map(|j| j.label.clone()).collect();
    let queue: Vec<Mutex<Option<BatchJob>>> =
        jobs.into_iter().map(|j| Mutex::new(Some(j))).collect();
    let results: Vec<Mutex<Option<JobResult>>> = (0..total).map(|_| Mutex::new(None)).collect();
    let next = AtomicUsize::new(0);
    let done = AtomicUsize::new(0);
    let failed = AtomicBool::new(false);

    progress(BatchProgress { done: 0, total });
    let workers = options
        .workers
        .unwrap_or_else(batch_workers)
        .clamp(1, total);
    std::thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| {
                while !failed.load(Ordering::SeqCst) {
                    let index = next.fetch_add(1, Ordering::SeqCst);
                    let Some(slot) = queue.get(index) else {
                        break;
                    };
                    let job = lock(slot).take().expect("each job is taken once");
                    let result =
                        render_assignment_pdf(fonts.clone(), job.project, &job.inputs, now);
                    if result.is_err() {
                        failed.store(true, Ordering::SeqCst);
                    }
                    *lock(&results[index]) = Some(result);
                    let finished = done.fetch_add(1, Ordering::SeqCst) + 1;
                    progress(BatchProgress {
                        done: finished,
                        total,
                    });
                }
            });
        }
    });

    let mut pdfs = Vec::with_capacity(total);
    let mut warnings = Vec::new();
    for (index, slot) in results.into_iter().enumerate() {
        match slot.into_inner().unwrap_or_else(|e| e.into_inner()) {
            Some(Ok(compiled)) => {
                warnings.extend(compiled.warnings.into_iter().map(|diagnostic| JobWarning {
                    index,
                    label: labels[index].clone(),
                    diagnostic,
                }));
                pdfs.push(compiled.output);
            }
            Some(Err(error)) => {
                return Err(BatchError::Compile {
                    index,
                    label: labels[index].clone(),
                    error,
                });
            }
            // Not started because an earlier job failed; that failure has a lower index or is
            // reported further on.
            None => continue,
        }
    }
    debug_assert_eq!(
        pdfs.len(),
        total,
        "a missing result means a failure was returned"
    );
    let parts: Vec<MergePart<'_>> = keys
        .iter()
        .zip(&pdfs)
        .map(|(key, pdf)| MergePart { key, pdf })
        .collect();
    let merged = pdf_merge(&parts, options.duplex)?;
    Ok(BatchOutput { merged, warnings })
}

/// The PDF of one job, or why it failed.
type JobResult = Result<Compiled<Vec<u8>>, CompileError>;

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}
