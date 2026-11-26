// SPDX-License-Identifier: AGPL-3.0-or-later

//! Runs a class-sized opdracht batch on the synthetic fixtures, for `docs/perf.md`:
//!
//! ```text
//! cargo run --release -p maatwerk-core --example batch_memory -- <students> <workers>
//! ```
//!
//! Every student gets two opdrachten (the images one and the 3-page one), as a batch after a
//! toets does. Prints the job count, pages, PDF size and time; peak memory is measured outside.

use std::path::Path;
use std::time::Instant;

use maatwerk_core::assets;
use maatwerk_core::paths::{DataDir, RelPath};
use maatwerk_core::typst_svc::{
    BatchJob, BatchOptions, FontStore, OpdrachtHeader, OpdrachtInputs, TypstProject, local_now,
    render_assignment_batch,
};

/// A fixture opdracht folder (`tests/fixtures/opdrachten/<id>/`, no `main.typ`/`lib.typ` on disk)
/// with the bundled `main.typ` and `lib.typ`.
fn fixture_project(dir: &DataDir, id: &str) -> TypstProject {
    TypstProject::opdracht(dir, id)
        .expect("fixture opdracht")
        .with_file(
            &RelPath::parse("main.typ").unwrap(),
            assets::OPDRACHT_MAIN_TYP,
        )
        .with_file(&RelPath::parse("lib.typ").unwrap(), assets::LIB_TYP)
}

fn main() {
    let args: Vec<usize> = std::env::args()
        .skip(1)
        .map(|a| a.parse().expect("numbers"))
        .collect();
    let students = args.first().copied().unwrap_or(30);
    let workers = args.get(1).copied();

    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let dir = DataDir::open(&fixtures).expect("fixture dir");
    let fonts = FontStore::shared();

    let mut jobs = Vec::new();
    for s in 0..students {
        for file in ["opdracht_1756713600200", "opdracht_1756713600203"] {
            jobs.push(BatchJob {
                key: s.to_string(),
                label: file.to_owned(),
                opdracht: file.to_owned(),
                project: fixture_project(&dir, file),
                inputs: OpdrachtInputs {
                    header: OpdrachtHeader {
                        student: format!("Leerling {s}"),
                        ..OpdrachtHeader::placeholder("Opdracht")
                    },
                    ..OpdrachtInputs::default()
                },
            });
        }
    }
    let count = jobs.len();
    let start = Instant::now();
    let out = render_assignment_batch(
        fonts,
        jobs,
        BatchOptions {
            duplex: true,
            workers,
        },
        local_now(),
        &|_| {},
    )
    .unwrap_or_else(|e| panic!("{e}"));
    println!(
        "jobs {count}, workers {}, pages {}, pdf {} KiB, {:.1} s",
        workers.map_or("default".to_owned(), |w| w.to_string()),
        out.merged.pages,
        out.merged.pdf.len() / 1024,
        start.elapsed().as_secs_f64()
    );
}
