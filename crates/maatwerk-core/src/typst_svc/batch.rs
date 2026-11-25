// SPDX-License-Identifier: AGPL-3.0-or-later

//! A batch of opdracht jobs (path D, `typst-contract.md` 4.3): every (student, opdracht) is its
//! own compile, because opdracht files share function names and labels. Jobs run on a few worker
//! threads that share the font store and the embedded packages; the PDFs are merged in job order
//! as they arrive, so the batch does not hold every job's PDF until the end (backlog 5b n2).

use std::collections::HashSet;
use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, TryLockError};

use time::OffsetDateTime;

use super::compile::{CompileError, Compiled};
use super::diagnostics::Diagnostic;
use super::fonts::FontStore;
use super::opdracht::{OpdrachtInputs, render_assignment_pdf};
use super::project::TypstProject;
use crate::pdf_merge::{MergeError, Merged, PdfMerger};

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
    let results: Vec<Mutex<Slot>> = (0..total).map(|_| Mutex::new(Slot::Pending)).collect();
    let merge = Mutex::new(Merge {
        merger: Some(PdfMerger::new(options.duplex)),
        next: 0,
        error: None,
    });
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
                    if lock(&failed).contains(&opdrachten[index]) {
                        *lock(&results[index]) = Slot::Skipped;
                    } else {
                        let result = std::panic::catch_unwind(AssertUnwindSafe(|| render(job)))
                            .map_err(|payload| panic_message(payload.as_ref()));
                        if !matches!(result, Ok(Ok(_))) {
                            lock(&failed).insert(opdrachten[index].clone());
                        }
                        *lock(&results[index]) = Slot::Done(result);
                    }
                    // Another worker merging carries on with this result; never wait for it.
                    match merge.try_lock() {
                        Ok(mut m) => m.advance(&results, &keys),
                        Err(TryLockError::Poisoned(e)) => e.into_inner().advance(&results, &keys),
                        Err(TryLockError::WouldBlock) => {}
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
    // What arrived while another worker was merging.
    let mut merge = merge.into_inner().unwrap_or_else(|e| e.into_inner());
    merge.advance(&results, &keys);

    let mut warnings = Vec::new();
    let mut failures: Vec<JobFailure> = Vec::new();
    let mut reported: HashSet<&str> = HashSet::new();
    for (index, slot) in results.into_iter().enumerate() {
        let kind = match slot.into_inner().unwrap_or_else(|e| e.into_inner()) {
            Slot::Done(Ok(Ok(compiled))) => {
                warnings.extend(compiled.warnings.into_iter().map(|diagnostic| JobWarning {
                    index,
                    label: labels[index].clone(),
                    diagnostic,
                }));
                continue;
            }
            Slot::Done(Ok(Err(error))) => JobFailureKind::Compile(error),
            Slot::Done(Err(message)) => JobFailureKind::Panic(message),
            // Skipped: another job of this opdracht failed.
            Slot::Skipped | Slot::Pending => continue,
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
    if let Some(error) = merge.error {
        return Err(error.into());
    }
    debug_assert_eq!(merge.next, total, "no failure means every job was merged");
    let merged = merge.merger.expect("merged without an error").finish()?;
    Ok(BatchOutput { merged, warnings })
}

/// A job's state: waiting or running, skipped (its opdracht failed), or done.
enum Slot {
    Pending,
    Skipped,
    Done(Result<JobResult, String>),
}

/// The merge so far: every job before `next` is merged.
struct Merge {
    /// `None` once the merge stopped (a failed job or a merge error).
    merger: Option<PdfMerger>,
    next: usize,
    error: Option<MergeError>,
}

impl Merge {
    /// Merges the finished jobs from `next` on, in job order, and drops their PDFs. Stops at
    /// the first job that is not done or did not compile: the batch then fails and needs no PDF.
    fn advance(&mut self, results: &[Mutex<Slot>], keys: &[String]) {
        while let Some(merger) = self.merger.as_mut() {
            let Some(slot) = results.get(self.next) else {
                return;
            };
            let mut slot = lock(slot);
            match &mut *slot {
                Slot::Pending => return,
                Slot::Done(Ok(Ok(compiled))) => {
                    let pdf = std::mem::take(&mut compiled.output);
                    drop(slot);
                    if let Err(error) = merger.push(&keys[self.next], &pdf) {
                        self.error = Some(error);
                        self.merger = None;
                    }
                    self.next += 1;
                }
                Slot::Skipped | Slot::Done(_) => self.merger = None,
            }
        }
    }
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

    /// Backlog 5b n2: merging as jobs finish (out of order, several workers) gives the bytes
    /// `pdf_merge` gives for the same PDFs, duplex padding included.
    #[test]
    fn n2_merging_as_jobs_finish_gives_the_same_pdf() {
        use crate::pdf_merge::{MergePart, pdf_merge, tests::pdf};
        let tmp = tempfile::tempdir().unwrap();
        let dir = DataDir::open(tmp.path()).unwrap();
        // (key, pages): neighbouring jobs of one student, and odd page counts for the padding.
        let spec = [
            ("s1", 1),
            ("s1", 2),
            ("s2", 1),
            ("s3", 2),
            ("s3", 1),
            ("s4", 3),
            ("s5", 1),
        ];
        let pdfs: Vec<Vec<u8>> = spec
            .iter()
            .enumerate()
            .map(|(i, (_, n))| {
                let texts: Vec<String> = (0..*n).map(|p| format!("job {i} page {p}")).collect();
                let texts: Vec<&str> = texts.iter().map(String::as_str).collect();
                pdf(&texts, (595, 842))
            })
            .collect();
        let mut jobs = jobs(&dir, &["a"; 7]);
        for (i, (job, (key, _))) in jobs.iter_mut().zip(spec).enumerate() {
            job.key = key.to_owned();
            job.label = i.to_string();
        }
        let output = run_batch(
            jobs,
            BatchOptions {
                duplex: true,
                workers: Some(4),
            },
            &|_| {},
            &|job: BatchJob| {
                // Later jobs finish first.
                let i: usize = job.label.parse().unwrap();
                std::thread::sleep(std::time::Duration::from_millis(5 * (7 - i as u64)));
                Ok(Compiled {
                    output: pdfs[i].clone(),
                    warnings: Vec::new(),
                })
            },
        )
        .unwrap();
        let parts: Vec<MergePart<'_>> = spec
            .iter()
            .zip(&pdfs)
            .map(|((key, _), pdf)| MergePart { key, pdf })
            .collect();
        let want = pdf_merge(&parts, true).unwrap();
        assert_eq!(output.merged.pages, want.pages);
        assert_eq!(output.merged.pdf, want.pdf);
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
