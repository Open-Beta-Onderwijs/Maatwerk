// SPDX-License-Identifier: AGPL-3.0-or-later

//! Opdracht parity with the Step 2b goldens (`docs/parity.md`, Typst rows, paths B, C and D for
//! one job): a v1 opdracht as a virtual project, `main.typ` driven by `sys.inputs`, SVG pages
//! and the sandbox of the opdracht World.

mod support;

use std::path::Path;

use maatwerk_core::assets;
use maatwerk_core::paths::{DataDir, RelPath};
use maatwerk_core::typst_svc::{
    BatchError, BatchJob, BatchOptions, BatchOutput, BatchProgress, CompileError, Compiled, Mode,
    OpdrachtHeader, OpdrachtInputs, TypstProject, compile_document, opdracht_world,
    render_assignment_batch, render_assignment_svg_pages,
};
use serde_json::Value;
use support::{assert_matches_golden, decode, fonts, frame_text, load_case};
use time::OffsetDateTime;
use typst::layout::PagedDocument;

/// 2026-01-01 00:00 UTC.
fn fixed_now() -> OffsetDateTime {
    OffsetDateTime::from_unix_timestamp(1_767_225_600).unwrap()
}

/// The tiny fixture's `opdrachten/` (tools/fixtures/export-opdrachten.mjs) plus the files the
/// golden cases add (`basis.typ`, `kapot.typ`, tests/reference-harness/typst/cases.mjs).
fn data_dir() -> (tempfile::TempDir, DataDir) {
    let tmp = tempfile::tempdir().unwrap();
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/opdrachten");
    copy_dir(&src, &tmp.path().join("opdrachten"));
    let opdrachten = tmp.path().join("opdrachten");
    std::fs::write(opdrachten.join("basis.typ"), assets::BASE_ASSIGNMENT_TYP).unwrap();
    std::fs::write(
        opdrachten.join("kapot.typ"),
        "#import \"lib.typ\": *\n#let setup_extra() = []\n#let render_uitleg() = [ Uitleg\n#let render_opgaven() = []\n",
    )
    .unwrap();
    let dir = DataDir::open(tmp.path()).unwrap();
    (tmp, dir)
}

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), target).unwrap();
        }
    }
}

/// The reference's cursor marker, renamed (naming map).
fn renamed_marker(source: &str) -> String {
    source.replace("<__rtti_cursor>", "<__maatwerk_cursor>")
}

/// What a golden call compiles: the project and its inputs. Batch goldens of one job only.
fn golden_job(case: &Value, dir: &DataDir) -> (TypstProject, OpdrachtInputs) {
    let args = decode(&case["call"]["args"]);
    let str_arg = |i: usize| args[i].as_str().unwrap();
    match case["call"]["channel"].as_str().unwrap() {
        // Path B: placeholder header, no cursor.
        "app:renderAssignmentPdf" => (
            TypstProject::opdracht_v1(dir, str_arg(0)).unwrap(),
            OpdrachtInputs::preview(str_arg(1), false),
        ),
        // Path C: the editor buffer instead of the file, with the cursor foreground.
        "app:renderAssignmentSvg" => (
            TypstProject::opdracht_v1(dir, str_arg(0))
                .unwrap()
                .with_file(
                    &RelPath::parse("opdracht.typ").unwrap(),
                    renamed_marker(str_arg(2)),
                ),
            OpdrachtInputs::preview(str_arg(1), true),
        ),
        "app:renderAssignmentBatch" => {
            let jobs = args[0].as_array().unwrap();
            assert_eq!(jobs.len(), 1, "one job per opdracht golden");
            batch_job(&jobs[0], &args[1], dir)
        }
        other => panic!("unexpected channel {other}"),
    }
}

/// One `renderAssignmentBatch` job with the batch options.
fn batch_job(job: &Value, opts: &Value, dir: &DataDir) -> (TypstProject, OpdrachtInputs) {
    let inputs = OpdrachtInputs {
        mode: serde_json::from_value(job["mode"].clone()).unwrap(),
        include_answers: opts["includeAnswers"].as_bool().unwrap_or(true),
        cursor: false,
        header: serde_json::from_value(job["header"].clone()).unwrap(),
    };
    let project = TypstProject::opdracht_v1(dir, job["typFile"].as_str().unwrap()).unwrap();
    (project, inputs)
}

fn compile(
    project: TypstProject,
    inputs: &OpdrachtInputs,
) -> Result<Compiled<PagedDocument>, CompileError> {
    compile_document(&opdracht_world(fonts(), project, inputs, fixed_now()))
}

fn golden(id: &str) -> PagedDocument {
    let case = load_case(id);
    assert!(case["result"]["success"].as_bool().unwrap(), "{id}");
    let (_tmp, dir) = data_dir();
    let (project, inputs) = golden_job(&case, &dir);
    let compiled = compile(project, &inputs).unwrap_or_else(|e| panic!("{id}: {}", e.to_text()));
    assert!(
        compiled.warnings.is_empty(),
        "{id}: {:?}",
        compiled.warnings
    );
    assert_matches_golden(id, &case, &compiled.output);
    compiled.output
}

fn page_text(doc: &PagedDocument, page: usize) -> String {
    let mut text = String::new();
    frame_text(&doc.pages[page].frame, &mut text);
    text
}

#[test]
fn opdracht_base_template_matches_the_golden() {
    golden("opdracht-base-template");
}

#[test]
fn opdracht_base_template_answers_matches_the_golden() {
    golden("opdracht-base-template-answers");
}

#[test]
fn opdracht_placeholder_pdf_matches_the_golden() {
    golden("opdracht-placeholder-pdf");
}

#[test]
fn opdracht_images_student_matches_the_golden() {
    // Also the emoji check of PLAN Step 5b: 📏, 👩‍🔬 and the keycap 5️⃣ in the header.
    golden("opdracht-images-student");
}

#[test]
fn opdracht_grid_no_answers_matches_the_golden() {
    golden("opdracht-grid-no-answers");
}

#[test]
fn opdracht_grid_answers_matches_the_golden() {
    golden("opdracht-grid-answers");
}

#[test]
fn opdracht_zero_vragen_matches_the_golden() {
    golden("opdracht-zero-vragen");
}

#[test]
fn opdracht_long_odd_matches_the_golden() {
    golden("opdracht-long-odd");
}

#[test]
fn opdracht_lib_features_matches_the_golden() {
    golden("opdracht-lib-features");
}

/// Path C: the document matches the golden PNGs, and the SVG pages match the golden's SVG facts.
fn svg_golden(id: &str) {
    golden(id);
    let case = load_case(id);
    let (_tmp, dir) = data_dir();
    let (project, inputs) = golden_job(&case, &dir);
    let pages = render_assignment_svg_pages(fonts(), project, &inputs, fixed_now())
        .unwrap()
        .output;
    let want = case["svg"].as_array().unwrap();
    assert_eq!(pages.len(), want.len(), "{id}: SVG pages");
    for (n, (svg, want)) in pages.iter().zip(want).enumerate() {
        assert!(svg.starts_with("<svg class=\"typst-doc\""), "{id} p{n}");
        assert!(
            svg.contains(&format!(
                "viewBox=\"{}\"",
                want["viewBox"].as_str().unwrap()
            )),
            "{id} p{n}: viewBox"
        );
        // As the golden counted them: `<a ...>` tags with `href="rtti-cursor:"` (renamed).
        let anchors = svg
            .split("<a ")
            .skip(1)
            .filter(|tag| {
                tag.split('>')
                    .next()
                    .unwrap()
                    .contains("href=\"maatwerk-cursor:\"")
            })
            .count();
        assert_eq!(
            anchors,
            want["cursorLinks"].as_u64().unwrap() as usize,
            "{id} p{n}: cursor links"
        );
        assert!(!svg.contains("rtti-cursor:"), "{id} p{n}");
        assert_eq!(
            svg.matches("<image ").count(),
            want["images"].as_u64().unwrap() as usize,
            "{id} p{n}: images"
        );
        if want["images"].as_u64().unwrap() > 0 {
            assert!(
                svg.contains("data:image/"),
                "{id} p{n}: images are data URIs"
            );
        }
    }
}

#[test]
fn svg_preview_matches_the_golden() {
    svg_golden("svg-preview");
}

#[test]
fn svg_preview_cursor_matches_the_golden() {
    svg_golden("svg-preview-cursor");
}

#[test]
fn svg_preview_many_pages_matches_the_golden() {
    svg_golden("svg-preview-many-pages");
}

#[test]
fn svg_preview_error_names_the_opdracht_file_with_line_and_column() {
    // TC 9 / 10.11: the reference mapped `_preview_<file>` back to `<file>` and showed machine
    // paths. Here the editor buffer is `opdracht.typ` of the project and no machine path shows.
    let case = load_case("svg-preview-error");
    assert!(!case["result"]["success"].as_bool().unwrap());
    let (_tmp, dir) = data_dir();
    let (project, inputs) = golden_job(&case, &dir);
    let err = compile(project, &inputs).unwrap_err();
    let first = &err.diagnostics[0];
    assert_eq!(first.message, "unknown variable: onbekend");
    let loc = first.location.as_ref().unwrap();
    // Quirk T28: the Typst CLI printed 0-based columns (`:9:27`); columns here are 1-based.
    assert_eq!(
        (loc.file.as_str(), loc.line, loc.column),
        ("opdracht.typ", 9, 28)
    );
    let text = err.to_text();
    assert!(
        text.starts_with("error: unknown variable: onbekend\n"),
        "{text}"
    );
    assert!(text.contains("┌─ opdracht.typ:9:28"), "{text}");
    assert!(
        text.contains("help: error occurred in this call of function `render_opgaven`"),
        "{text}"
    );
    assert!(text.contains("┌─ main.typ:"), "{text}");
    assert!(
        !text.contains(":\\") && !text.contains("_preview_"),
        "{text}"
    );
}

#[test]
fn a_syntax_error_in_an_opdracht_points_into_opdracht_typ() {
    let (_tmp, dir) = data_dir();
    let project = TypstProject::opdracht_v1(&dir, "kapot.typ").unwrap();
    let err = compile(project, &OpdrachtInputs::default()).unwrap_err();
    let first = &err.diagnostics[0];
    assert_eq!(first.message, "unclosed delimiter");
    let loc = first.location.as_ref().unwrap();
    // batch-error golden: `kapot.typ:3:23` (0-based column, quirk T28).
    assert_eq!(
        (loc.file.as_str(), loc.line, loc.column),
        ("opdracht.typ", 3, 24)
    );
}

#[test]
fn main_typ_without_inputs_uses_the_placeholder_header_and_student_mode() {
    let (_tmp, dir) = data_dir();
    let project = || TypstProject::opdracht_v1(&dir, "opdracht_1756713600205.typ").unwrap();
    let plain = compile_document(&project().world(fonts(), fixed_now()))
        .unwrap()
        .output;
    let with = compile(project(), &OpdrachtInputs::preview("Titel", false))
        .unwrap()
        .output;
    assert_eq!(plain.pages.len(), with.pages.len());
    for p in 0..plain.pages.len() {
        assert_eq!(page_text(&plain, p), page_text(&with, p));
    }
    assert!(page_text(&plain, 0).contains("Leerling Voornaam Achternaam"));
}

#[test]
fn answers_mode_ignores_the_student_fields() {
    let (_tmp, dir) = data_dir();
    let project = TypstProject::opdracht_v1(&dir, "opdracht_1756713600205.typ").unwrap();
    let inputs = OpdrachtInputs {
        mode: Mode::Answers,
        header: OpdrachtHeader {
            title: "Sleutel".into(),
            ..OpdrachtHeader::default()
        },
        ..OpdrachtInputs::default()
    };
    let doc = compile(project, &inputs).unwrap().output;
    assert_eq!(doc.pages.len(), 1);
    let text = page_text(&doc, 0);
    assert!(text.starts_with("SleutelAntwoordsleutel"), "{text}");
}

/// An opdracht whose source is `body`, compiled in the fixture data dir.
fn compile_source(body: &str) -> Result<Compiled<PagedDocument>, CompileError> {
    let (_tmp, dir) = data_dir();
    std::fs::write(dir.root().join("geheim.json"), "{\"geheim\": 1}").unwrap();
    let source = format!(
        "#import \"lib.typ\": *\n#let setup_extra() = []\n#let render_uitleg() = [{body}]\n#let render_opgaven() = []\n"
    );
    let project = TypstProject::opdracht_v1(&dir, "opdracht_1756713600200.typ")
        .unwrap()
        .with_file(&RelPath::parse("opdracht.typ").unwrap(), source);
    compile(project, &OpdrachtInputs::default())
}

#[test]
fn the_opdracht_world_sees_its_own_images_and_nothing_else() {
    // Own images (v1 path), as the golden opdracht does.
    compile_source("#image(\"images/opdracht_1756713600200/figuur.png\")").unwrap();
    // The sandbox (ADR-0002 section 5): the reference could read anything under its app dir.
    for path in [
        "/data/geheim.json",
        "../geheim.json",
        "../../geheim.json",
        "/geheim.json",
        "opdracht_1756713600201.typ",
        "/opdrachten/opdracht_1756713600201.typ",
        "images/opdracht_1756713600201/figuur.png",
        "C:/Windows/win.ini",
    ] {
        let err = compile_source(&format!("#read(\"{path}\")")).unwrap_err();
        let message = &err.diagnostics[0].message;
        assert!(
            message.starts_with("file not found") || message.contains("access denied"),
            "{path}: {message}"
        );
        assert!(
            !err.to_text().contains("--root"),
            "review 5a n3: {}",
            err.to_text()
        );
    }
}

#[test]
fn a_folder_project_compiles_main_typ_from_disk() {
    // The v2 layout (ADR-0002 5a): main.typ, opdracht.typ, lib.typ and images/ in one folder.
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    std::fs::write(root.join("main.typ"), assets::OPDRACHT_MAIN_TYP).unwrap();
    std::fs::write(root.join("lib.typ"), assets::LIB_TYP).unwrap();
    std::fs::write(root.join("opdracht.typ"), assets::BASE_ASSIGNMENT_TYP).unwrap();
    let project = TypstProject::folder(root, &RelPath::parse("main.typ").unwrap());
    let doc = compile(project, &OpdrachtInputs::preview("Remweg", false))
        .unwrap()
        .output;
    // TC 10.1: the base template is 2 pages in student mode.
    assert_eq!(doc.pages.len(), 2);
    assert!(page_text(&doc, 0).starts_with("Remweg"));
}

#[test]
fn characters_without_a_font_give_one_tofu_warning_each() {
    // Quirk T2: the reference drew characters without a font as boxes and said nothing. Emoji
    // now come from the bundled font, so a Tibetan icon (no bundled font has it) stands in.
    let case = load_case("opdracht-images-student");
    let (_tmp, dir) = data_dir();
    let (project, mut inputs) = golden_job(&case, &dir);
    for observatie in &mut inputs.header.observaties {
        observatie.icon = "ༀ".to_owned();
    }
    let compiled =
        compile_document(&opdracht_world(fonts(), project, &inputs, fixed_now())).unwrap();
    let messages: Vec<&str> = compiled
        .warnings
        .iter()
        .map(|w| w.message.as_str())
        .collect();
    assert!(
        messages.contains(&"no font can display `ༀ` (U+0F00); it is shown as a box"),
        "{messages:?}"
    );
    let icon = messages.iter().filter(|m| m.contains("`ༀ`")).count();
    assert_eq!(icon, 1, "one warning per character: {messages:?}");
    let first = &compiled.warnings[0];
    assert_eq!(first.location.as_ref().unwrap().file, "lib.typ");
    assert!(!first.hints.is_empty());
}

// ── Batch (path D) ──────────────────────────────────────────────────────────────

/// The jobs and options of a `renderAssignmentBatch` golden.
fn golden_batch(case: &Value, dir: &DataDir) -> (Vec<BatchJob>, BatchOptions) {
    let args = decode(&case["call"]["args"]);
    let opts = &args[1];
    let jobs = args[0]
        .as_array()
        .unwrap()
        .iter()
        .map(|job| {
            let (project, inputs) = batch_job(job, opts, dir);
            BatchJob {
                key: job["key"].as_str().unwrap().to_owned(),
                label: job["label"].as_str().unwrap().to_owned(),
                project,
                inputs,
            }
        })
        .collect();
    let options = BatchOptions {
        duplex: opts["duplex"].as_bool().unwrap(),
        workers: None,
    };
    (jobs, options)
}

fn run_batch(
    jobs: Vec<BatchJob>,
    options: BatchOptions,
) -> (Result<BatchOutput, BatchError>, Vec<BatchProgress>) {
    let seen = std::sync::Mutex::new(Vec::new());
    let result = render_assignment_batch(fonts(), jobs, options, fixed_now(), &|p| {
        seen.lock().unwrap().push(p)
    });
    (result, seen.into_inner().unwrap())
}

/// Per page of a PDF: its text (whitespace dropped) and its size in pt.
fn pdf_pages(pdf: &[u8]) -> Vec<(String, (f32, f32))> {
    let doc = lopdf::Document::load_mem(pdf).unwrap();
    doc.get_pages()
        .into_iter()
        .map(|(n, id)| {
            let page = doc.get_dictionary(id).unwrap();
            let b = page.get(b"MediaBox").unwrap().as_array().unwrap();
            let size = (b[2].as_float().unwrap(), b[3].as_float().unwrap());
            let text = if page.has(b"Contents") {
                support::squash(&doc.extract_text(&[n]).unwrap())
            } else {
                String::new()
            };
            (text, size)
        })
        .collect()
}

fn assert_batch_golden(id: &str) -> BatchOutput {
    let case = load_case(id);
    assert!(case["result"]["success"].as_bool().unwrap(), "{id}");
    let (_tmp, dir) = data_dir();
    let (jobs, options) = golden_batch(&case, &dir);
    let total = jobs.len();
    let (result, progress) = run_batch(jobs, options);
    let out = result.unwrap_or_else(|e| panic!("{id}: {e}"));
    let pages = case["result"]["pages"].as_u64().unwrap() as usize;
    assert_eq!(out.merged.pages, pages, "{id}");
    // Progress: once at the start, then once per job.
    assert_eq!(progress.len(), total + 1, "{id}");
    assert_eq!(progress[0].done, 0);
    assert_eq!(progress.last().unwrap().done, total);

    // Kept for inspection with a PDF viewer or pdf.js.
    let out_dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join("batch");
    std::fs::create_dir_all(&out_dir).unwrap();
    std::fs::write(out_dir.join(format!("{id}.pdf")), &out.merged.pdf).unwrap();

    let want = case["pdf"]["pages"].as_array().unwrap();
    let got = pdf_pages(&out.merged.pdf);
    assert_eq!(got.len(), want.len(), "{id}: page count");
    for (n, ((text, size), want)) in got.iter().zip(want).enumerate() {
        let w = want["size"].as_array().unwrap();
        assert!(
            (f64::from(size.0) - w[0].as_f64().unwrap()).abs() < 0.01
                && (f64::from(size.1) - w[1].as_f64().unwrap()).abs() < 0.01,
            "{id} p{}: size",
            n + 1
        );
        let golden = support::squash(&support::golden_text(want));
        assert_eq!(no_emoji(text), no_emoji(&golden), "{id} p{}: text", n + 1);
    }
    out
}

/// lopdf extracts no text from Typst's colour emoji glyphs (Type3 fonts), pdf.js did. The
/// emoji themselves are checked by the pixel goldens of the single opdrachten.
fn no_emoji(text: &str) -> String {
    text.chars()
        .filter(|c| {
            let c = u32::from(*c);
            !(c >= 0x1F000
                || (0x2600..=0x27BF).contains(&c)
                || [0x200D, 0xFE0F, 0x20E3].contains(&c))
        })
        .collect()
}

#[test]
fn batch_duplex_matches_the_golden() {
    // Blank pages (empty golden text) before a new student on an odd page count; none between
    // the two opdrachten of Bram.
    assert_batch_golden("batch-duplex");
}

#[test]
fn batch_answer_key_matches_the_golden() {
    assert_batch_golden("batch-answer-key");
}

#[test]
fn batch_error_reports_the_failing_opdracht_by_label() {
    let case = load_case("batch-error");
    let (_tmp, dir) = data_dir();
    let (jobs, options) = golden_batch(&case, &dir);
    let (result, _) = run_batch(jobs, options);
    let err = result.unwrap_err();
    assert!(
        matches!(&err, BatchError::Compile { index: 1, .. }),
        "{err}"
    );
    let text = err.to_string();
    let golden = case["result"]["error"].as_str().unwrap();
    let prefix = "Fout in opdracht \"Kapotte opdracht\":\n\nerror: unclosed delimiter\n";
    assert!(golden.starts_with(prefix));
    assert!(text.starts_with(prefix), "{text}");
    assert!(text.contains("┌─ opdracht.typ:3:24"), "{text}");
}

#[test]
fn an_empty_batch_has_the_reference_message() {
    let options = BatchOptions {
        duplex: true,
        workers: None,
    };
    let (result, progress) = run_batch(Vec::new(), options);
    assert_eq!(
        result.unwrap_err().to_string(),
        "Er is niets om te genereren."
    );
    assert!(progress.is_empty());
}

#[test]
fn batch_order_is_job_order_with_any_number_of_workers() {
    let (_tmp, dir) = data_dir();
    let job = |key: &str, file: &str, student: &str| BatchJob {
        key: key.into(),
        label: file.into(),
        project: TypstProject::opdracht_v1(&dir, file).unwrap(),
        inputs: OpdrachtInputs {
            header: OpdrachtHeader {
                student: student.into(),
                ..OpdrachtHeader::placeholder("T")
            },
            ..OpdrachtInputs::default()
        },
    };
    // long-even (4 pages) first, so with several workers the short jobs finish before it.
    let jobs = || {
        vec![
            job("1", "opdracht_1756713600204.typ", "Een"),
            job("2", "opdracht_1756713600205.typ", "Twee"),
            job("3", "opdracht_1756713600205.typ", "Drie"),
        ]
    };
    let mut texts = Vec::new();
    for workers in [1, 3] {
        let options = BatchOptions {
            duplex: true,
            workers: Some(workers),
        };
        let merged = run_batch(jobs(), options).0.unwrap().merged;
        // 4 + 2 + 2 pages, no padding needed.
        assert_eq!(merged.pages, 8);
        let pages: Vec<String> = pdf_pages(&merged.pdf).into_iter().map(|(t, _)| t).collect();
        texts.push(pages);
    }
    assert_eq!(texts[0], texts[1]);
    assert!(texts[0][0].contains("Een"), "{:?}", texts[0][0]);
    assert!(texts[0][4].contains("Twee"), "{:?}", texts[0][4]);
    assert!(texts[0][6].contains("Drie"), "{:?}", texts[0][6]);
}
