// SPDX-License-Identifier: AGPL-3.0-or-later

//! A batch of opdracht jobs (path D, `typst-contract.md` 4.3): every (student, opdracht) is its
//! own compile, because opdracht files share function names and labels. Jobs run on a few worker
//! threads that share the font store and the embedded packages; the PDFs are merged in job order.

use std::collections::HashSet;
use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicUsize, Ordering};
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
    /// The opdracht this job compiles. After a job of an opdracht fails, its other jobs are
    /// skipped: they would fail the same way (T23).
    pub opdracht: String,
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

/// Why one job failed.
#[derive(Debug)]
pub enum JobFailureKind {
    /// The opdracht text does not compile.
    Compile(CompileError),
    /// A panic inside the job (a bug in Maatwerk or Typst, not in the opdracht text); caught per
    /// job (review 5b n1). The panic itself is in the log.
    Panic(String),
}

/// The first failed job of one opdracht.
#[derive(Debug)]
pub struct JobFailure {
    pub index: usize,
    pub label: String,
    pub kind: JobFailureKind,
}

impl std::fmt::Display for JobFailure {
    /// The reference's `Fout in opdracht "<label>":\n\n<stderr>`.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Fout in opdracht \"{}\":\n\n", self.label)?;
        match &self.kind {
            JobFailureKind::Compile(error) => f.write_str(&error.to_text()),
            JobFailureKind::Panic(message) => write!(
                f,
                "Interne fout bij het maken van de PDF ({message}). Meld dit probleem bij de \
                 beheerder (Over Maatwerk > Probleem melden)."
            ),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum BatchError {
    /// The reference's text for an empty job list.
    #[error("Er is niets om te genereren.")]
    Empty,
    /// Every opdracht that failed, once each, in job order (T23: the reference reported only the
    /// first). Never empty.
    #[error("{}", failures_text(.0))]
    Failed(Vec<JobFailure>),
    #[error(transparent)]
    Merge(#[from] MergeError),
}

/// Separates the failures of several opdrachten in the error text.
pub const FAILURE_SEPARATOR: &str = "\n\n────────\n\n";

/// One failure as the reference wrote it; several under a count line.
fn failures_text(failures: &[JobFailure]) -> String {
    match failures {
        [one] => one.to_string(),
        many => {
            let parts: Vec<String> = many.iter().map(ToString::to_string).collect();
            format!(
                "{} opdrachten bevatten een fout.{FAILURE_SEPARATOR}{}",
                many.len(),
                parts.join(FAILURE_SEPARATOR)
            )
        }
    }
}

/// `BATCH_PARALLEL = max(2, min(4, cpus - 1))` (`main.js:813-917`).
pub fn batch_workers() -> usize {
    let cpus = std::thread::available_parallelism().map_or(1, usize::from);
    cpus.saturating_sub(1).clamp(2, 4)
}

/// Compiles every job and merges the PDFs in job order. A failure does not stop the batch: the
/// other opdrachten still compile, the remaining jobs of the failed opdracht are skipped, and
/// every failed opdracht is reported with its lowest-index job, in job order (T23; the reference
/// reported only the first to fail in time).
pub fn render_assignment_batch(
    fonts: Arc<FontStore>,
    jobs: Vec<BatchJob>,
    options: BatchOptions,
    now: OffsetDateTime,
    progress: &(dyn Fn(BatchProgress) + Sync),
) -> Result<BatchOutput, BatchError> {
    run_batch(jobs, options, progress, &|job: BatchJob| {
        render_assignment_pdf(fonts.clone(), job.project, &job.inputs, now)
    })
}

/// [`render_assignment_batch`] with the compile of one job passed in (tests inject failures).
fn run_batch(
    jobs: Vec<BatchJob>,
    options: BatchOptions,
    progress: &(dyn Fn(BatchProgress) + Sync),
    render: &(dyn Fn(BatchJob) -> JobResult + Sync),
) -> Result<BatchOutput, BatchError> {
    let total = jobs.len();
    if total == 0 {
        return Err(BatchError::Empty);
    }
    let keys: Vec<String> = jobs.iter().map(|j| j.key.clone()).collect();
    let labels: Vec<String> = jobs.iter().map(|j| j.label.clone()).collect();
    let opdrachten: Vec<String> = jobs.iter().map(|j| j.opdracht.clone()).collect();
    let queue: Vec<Mutex<Option<BatchJob>>> =
        jobs.into_iter().map(|j| Mutex::new(Some(j))).collect();
    let results: Vec<Mutex<Option<Result<JobResult, String>>>> =
        (0..total).map(|_| Mutex::new(None)).collect();
    let next = AtomicUsize::new(0);
    // Counted and reported under one lock, so `done` never goes backwards (review 5b m4).
    let done = Mutex::new(0usize);
    // Opdrachten with a failed job; their later jobs are skipped.
    let failed: Mutex<HashSet<String>> = Mutex::new(HashSet::new());

    progress(BatchProgress { done: 0, total });
    let workers = options
        .workers
        .unwrap_or_else(batch_workers)
        .clamp(1, total);
    std::thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| {
                loop {
                    let index = next.fetch_add(1, Ordering::SeqCst);
                    let Some(slot) = queue.get(index) else {
                        break;
                    };
                    let job = lock(slot).take().expect("each job is taken once");
                    if !lock(&failed).contains(&opdrachten[index]) {
                        let result = std::panic::catch_unwind(AssertUnwindSafe(|| render(job)))
                            .map_err(|payload| panic_message(payload.as_ref()));
                        if !matches!(result, Ok(Ok(_))) {
                            lock(&failed).insert(opdrachten[index].clone());
                        }
                        *lock(&results[index]) = Some(result);
                    }
                    // A skipped job counts as done, so the progress reaches the total (T23).
                    let mut finished = lock(&done);
                    *finished += 1;
                    progress(BatchProgress {
                        done: *finished,
                        total,
                    });
                }
            });
        }
    });

    let mut pdfs = Vec::with_capacity(total);
    let mut warnings = Vec::new();
    let mut failures: Vec<JobFailure> = Vec::new();
    let mut reported: HashSet<&str> = HashSet::new();
    for (index, slot) in results.into_iter().enumerate() {
        let kind = match slot.into_inner().unwrap_or_else(|e| e.into_inner()) {
            Some(Ok(Ok(compiled))) => {
                warnings.extend(compiled.warnings.into_iter().map(|diagnostic| JobWarning {
                    index,
                    label: labels[index].clone(),
                    diagnostic,
                }));
                pdfs.push(compiled.output);
                continue;
            }
            Some(Ok(Err(error))) => JobFailureKind::Compile(error),
            Some(Err(message)) => JobFailureKind::Panic(message),
            // Skipped: another job of this opdracht failed.
            None => continue,
        };
        // Jobs of one opdracht that were running at the same time may all fail; the opdracht is
        // reported once, with its first job.
        if reported.insert(opdrachten[index].as_str()) {
            failures.push(JobFailure {
                index,
                label: labels[index].clone(),
                kind,
            });
        }
    }
    if !failures.is_empty() {
        return Err(BatchError::Failed(failures));
    }
    debug_assert_eq!(pdfs.len(), total, "no failure means every job compiled");
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

/// The text of a caught panic.
fn panic_message(payload: &(dyn std::any::Any + Send)) -> String {
    payload
        .downcast_ref::<&str>()
        .map(|s| (*s).to_owned())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "panic".to_owned())
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::{DataDir, RelPath};

    /// One job per entry: key = its index, `opdracht` and label = the entry.
    fn jobs(dir: &DataDir, opdrachten: &[&str]) -> Vec<BatchJob> {
        opdrachten
            .iter()
            .enumerate()
            .map(|(i, op)| BatchJob {
                key: i.to_string(),
                label: format!("opdracht {op}"),
                opdracht: (*op).to_owned(),
                project: TypstProject::folder(dir.root(), &RelPath::parse("main.typ").unwrap()),
                inputs: OpdrachtInputs::default(),
            })
            .collect()
    }

    fn one_worker() -> BatchOptions {
        BatchOptions {
            duplex: false,
            workers: Some(1),
        }
    }

    /// Runs `ops` with one worker; the jobs of the opdrachten in `broken` panic. Returns the
    /// result, the keys of the jobs that ran, and the last progress.
    fn run_with_broken(
        ops: &[&str],
        broken: &[&str],
    ) -> (
        Result<BatchOutput, BatchError>,
        Vec<String>,
        Option<BatchProgress>,
    ) {
        let tmp = tempfile::tempdir().unwrap();
        let dir = DataDir::open(tmp.path()).unwrap();
        let started = Mutex::new(Vec::new());
        let last = Mutex::new(None);
        let result = run_batch(
            jobs(&dir, ops),
            one_worker(),
            &|p| *lock(&last) = Some(p),
            &|job: BatchJob| {
                lock(&started).push(job.key.clone());
                if broken.contains(&job.opdracht.as_str()) {
                    panic!("layout bug in {}", job.opdracht);
                }
                Ok(Compiled {
                    output: Vec::new(),
                    warnings: Vec::new(),
                })
            },
        );
        let started = lock(&started).clone();
        let last = *lock(&last);
        (result, started, last)
    }

    /// Review 5b n1: a panic in one job is that job's error.
    #[test]
    fn n1_a_panic_in_one_job_is_reported_as_that_jobs_error() {
        let (result, _, _) = run_with_broken(&["a", "b", "c"], &["b"]);
        let err = result.unwrap_err();
        let BatchError::Failed(failures) = &err else {
            panic!("{err:?}");
        };
        assert_eq!(failures.len(), 1);
        assert_eq!(failures[0].index, 1);
        assert!(
            matches!(&failures[0].kind, JobFailureKind::Panic(m) if m == "layout bug in b"),
            "{err:?}"
        );
        assert_eq!(
            err.to_string(),
            "Fout in opdracht \"opdracht b\":\n\nInterne fout bij het maken van de PDF (layout \
             bug in b). Meld dit probleem bij de beheerder (Over Maatwerk > Probleem melden)."
        );
    }

    /// T23: every failed opdracht is reported (once, in job order), the other opdrachten still
    /// compile, a failed opdracht's later jobs are skipped, and the progress reaches the total.
    #[test]
    fn t23_every_failed_opdracht_is_reported_once() {
        let (result, started, last) =
            run_with_broken(&["a", "a", "b", "c", "c", "a", "b"], &["a", "c"]);
        let err = result.unwrap_err();
        let BatchError::Failed(failures) = &err else {
            panic!("{err:?}");
        };
        let reported: Vec<(usize, &str)> = failures
            .iter()
            .map(|f| (f.index, f.label.as_str()))
            .collect();
        assert_eq!(reported, [(0, "opdracht a"), (3, "opdracht c")]);
        assert_eq!(started, ["0", "2", "3", "6"], "1, 4 and 5 are skipped");
        assert_eq!(last, Some(BatchProgress { done: 7, total: 7 }));
        let text = err.to_string();
        assert!(
            text.starts_with(
                "2 opdrachten bevatten een fout.\n\n────────\n\nFout in opdracht \"opdracht a\":"
            ),
            "{text}"
        );
        assert!(
            text.contains(&format!(
                "{FAILURE_SEPARATOR}Fout in opdracht \"opdracht c\":"
            )),
            "{text}"
        );
    }

    /// T23: with several workers, jobs of one opdracht may fail at the same time; the opdracht
    /// is still reported once, with its first job.
    #[test]
    fn t23_parallel_failures_of_one_opdracht_are_reported_once() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = DataDir::open(tmp.path()).unwrap();
        let options = BatchOptions {
            duplex: false,
            workers: Some(3),
        };
        let result = run_batch(
            jobs(&dir, &["a", "a", "a", "b", "a"]),
            options,
            &|_| {},
            &|_job: BatchJob| {
                Err(CompileError {
                    diagnostics: Vec::new(),
                })
            },
        );
        let Err(BatchError::Failed(failures)) = result else {
            panic!("expected failures");
        };
        let reported: Vec<&str> = failures.iter().map(|f| f.label.as_str()).collect();
        assert_eq!(reported, ["opdracht a", "opdracht b"]);
        assert_eq!(failures[0].index, 0);
    }
}
