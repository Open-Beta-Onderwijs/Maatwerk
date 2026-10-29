// SPDX-License-Identifier: AGPL-3.0-or-later

//! Rapport parity with the Step 2b goldens (`docs/parity.md`, Typst rows) and the quirk fixes
//! of Step 5a (T26 template side, T11/T27 for `uitleg_rtti`).

mod support;

use maatwerk_core::paths::DataDir;
use maatwerk_core::typst_svc::{
    CompileError, Compiled, RapportData, compile_document, rapport_world, render_rapport_pdf,
};
use serde_json::Value;
use support::{WATERMARK_SVG, assert_matches_golden, decode, fonts, frame_text, load_case};
use time::OffsetDateTime;
use typst::layout::PagedDocument;

/// 2026-01-01 00:00 UTC.
fn fixed_now() -> OffsetDateTime {
    OffsetDateTime::from_unix_timestamp(1_767_225_600).unwrap()
}

/// The rapport data of a golden call `app:renderRapportPdf(examId, students, examInfo)`, with
/// the reference's `?? []` / `?? {}` defaults.
fn case_data(case: &Value) -> RapportData {
    let args = decode(&case["call"]["args"]);
    let or = |v: &Value, default: Value| if v.is_null() { default } else { v.clone() };
    RapportData {
        students: or(&args[1], Value::Array(vec![])),
        exam_info: or(&args[2], serde_json::json!({})),
    }
}

fn data_dir(watermark: bool) -> (tempfile::TempDir, DataDir) {
    let tmp = tempfile::tempdir().unwrap();
    if watermark {
        std::fs::create_dir_all(tmp.path().join("fotos")).unwrap();
        std::fs::write(tmp.path().join("fotos/school-watermerk.svg"), WATERMARK_SVG).unwrap();
    }
    let dir = DataDir::open(tmp.path()).unwrap();
    (tmp, dir)
}

fn compile(data: &RapportData, watermark: bool) -> Result<Compiled<PagedDocument>, CompileError> {
    let (_tmp, dir) = data_dir(watermark);
    compile_document(&rapport_world(fonts(), data, &dir, fixed_now()))
}

fn page_text(doc: &PagedDocument, page: usize) -> String {
    let mut text = String::new();
    frame_text(&doc.pages[page].frame, &mut text);
    text
}

fn golden(id: &str) {
    let case = load_case(id);
    assert!(case["result"]["success"].as_bool().unwrap());
    let doc = compile(&case_data(&case), true)
        .unwrap_or_else(|e| panic!("{id}: {}", e.to_text()))
        .output;
    assert_matches_golden(id, &case, &doc);
}

#[test]
fn rapport_one_student_matches_the_golden() {
    golden("rapport-one-student");
}

#[test]
fn rapport_valid_matches_the_golden() {
    golden("rapport-valid");
}

#[test]
fn rapport_without_watermark_fails_on_the_missing_file() {
    let case = load_case("rapport-no-watermark");
    assert!(!case["result"]["success"].as_bool().unwrap());
    let err = compile(&case_data(&case), false).unwrap_err();
    let first = &err.diagnostics[0];
    assert_eq!(
        first.message,
        "file not found (searched at /data/fotos/school-watermerk.svg)"
    );
    assert_eq!(first.location.as_ref().unwrap().file, "rapport.typ");
    let text = err.to_text();
    assert!(text.starts_with("error: file not found"), "{text}");
    assert!(text.contains("┌─ rapport.typ:"), "{text}");
    assert!(!text.contains(":\\"), "no machine paths: {text}");
}

#[test]
fn other_invalid_teacher_markup_still_fails_with_a_call_trace() {
    // As in the reference (T11): only the `$` count is guarded.
    let case = load_case("rapport-one-student");
    let mut data = case_data(&case);
    data.exam_info["uitleg_rtti"]["I"] = Value::from("#bestaatniet()");
    let err = compile(&data, true).unwrap_err();
    assert_eq!(err.diagnostics[0].message, "unknown variable: bestaatniet");
    let text = err.to_text();
    assert!(
        text.contains("help: error occurred in this call of function `rtti_uitleg_section`"),
        "{text}"
    );
    assert!(
        !text.contains("error occurred error occurred"),
        "review m1: {text}"
    );
}

#[test]
fn t27_rapport_markup_with_the_old_guard_output_now_compiles() {
    // The golden's data is what the reference UI sent: its `$` guard left one unescaped `$` in
    // its own warning, so the reference failed with "unclosed delimiter" (T27). The template
    // guard counts that `$` and escapes it, so the rapport compiles with the red warning.
    let case = load_case("rapport-markup");
    assert!(!case["result"]["success"].as_bool().unwrap());
    let data = case_data(&case);
    let students = data.students.as_array().unwrap().len();
    let doc = compile(&data, true)
        .unwrap_or_else(|e| panic!("{}", e.to_text()))
        .output;
    assert_eq!(doc.pages.len(), 2 * students);
    let all: String = (0..doc.pages.len()).map(|p| page_text(&doc, p)).collect();
    assert!(all.contains("$-teken niet gesloten"), "{all}");
}

#[test]
fn t26_a_score_colour_that_is_not_a_colour_does_not_break_the_rapport() {
    // rapport-tiny: the reference failed with "color string contains non-hexadecimal letters"
    // on `dot_color: "#NaNNaNNaN"` (a typed score such as `abc`, quirk T26).
    let case = load_case("rapport-tiny");
    assert!(!case["result"]["success"].as_bool().unwrap());
    let data = case_data(&case);
    let students = data.students.as_array().unwrap().len();
    let doc = compile(&data, true)
        .unwrap_or_else(|e| panic!("{}", e.to_text()))
        .output;
    assert_eq!(doc.pages.len(), 2 * students);
    // Review 5a n5: the two rows with the broken colour are drawn. Their score arrives as 0
    // (`toTypst(NaN)` in the old payload), so they read "0 / max", as the reference would have.
    let vragen = data.students[0]["vragen"].as_array().unwrap();
    let broken: Vec<&str> = vragen
        .iter()
        .filter(|v| v["dot_color"] == "#NaNNaNNaN")
        .map(|v| v["label"].as_str().unwrap())
        .collect();
    assert_eq!(broken, ["III12", "III16"]);
    let text = page_text(&doc, 0);
    assert!(text.contains("III12I0 / 3"), "{text}");
    assert!(text.contains("III16IDiag.0 / 1"), "{text}");
}

#[test]
fn t26_a_score_that_is_not_a_number_counts_as_not_entered() {
    let case = load_case("rapport-one-student");
    let mut data = case_data(&case);
    let vraag = &mut data.students[0]["vragen"][0];
    vraag["score"] = Value::from("abc");
    vraag["dot_color"] = Value::from("#NaNNaNNaN");
    let doc = compile(&data, true)
        .unwrap_or_else(|e| panic!("{}", e.to_text()))
        .output;
    // The scoretabel row reads "N / 5", as for an empty score.
    assert!(
        page_text(&doc, 0).contains("I1RN / 5"),
        "{}",
        page_text(&doc, 0)
    );
}

#[test]
fn review_m1_optional_fields_sent_as_null_compile_as_in_the_reference() {
    // `normaliseForTypst` sends an `undefined` field as `null` (toTypst: `none`) and `NaN` as 0.
    let case = load_case("rapport-one-student");
    let mut data = case_data(&case);
    data.students[0]["observaties"] = serde_json::json!([
        { "icon": "🧮", "naam": "Rekenfout", "uitleg": null, "leeradvies": null }
    ]);
    data.students[0]["vragen"][0]["class_avg"] = Value::from(0);
    let doc = compile(&data, true)
        .unwrap_or_else(|e| panic!("{}", e.to_text()))
        .output;
    assert!(page_text(&doc, 0).contains("Rekenfout"));
}

#[test]
fn t11_an_odd_dollar_in_uitleg_rtti_shows_the_warning_instead_of_failing() {
    let case = load_case("rapport-one-student");
    let mut data = case_data(&case);
    data.exam_info["uitleg_rtti"]["T1"] = Value::from("Kost $5 per stuk.");
    let doc = compile(&data, true)
        .unwrap_or_else(|e| panic!("{}", e.to_text()))
        .output;
    let text = page_text(&doc, 1);
    assert!(text.contains("$-teken niet gesloten"), "{text}");
    assert!(text.contains("Kost $5 per stuk."), "{text}");
}

#[test]
fn review_m2_an_escaped_dollar_is_not_counted_by_the_guard() {
    // The reference rendered `\$` as a literal dollar (uitleg had no guard).
    let case = load_case("rapport-one-student");
    let mut data = case_data(&case);
    data.exam_info["uitleg_rtti"]["T1"] = Value::from("Kost \\$5.");
    data.exam_info["uitleg_rtti"]["T2"] = Value::from("Kost \\$5 of $x$ en $.");
    let doc = compile(&data, true)
        .unwrap_or_else(|e| panic!("{}", e.to_text()))
        .output;
    let text = page_text(&doc, 1);
    assert!(text.contains("Kost $5."), "{text}");
    assert_eq!(text.matches("niet gesloten").count(), 1, "{text}");
}

#[test]
fn even_dollars_in_uitleg_rtti_stay_math() {
    let case = load_case("rapport-one-student");
    let mut data = case_data(&case);
    data.exam_info["uitleg_rtti"]["R"] = Value::from("Formule $v = s/t$.");
    let doc = compile(&data, true)
        .unwrap_or_else(|e| panic!("{}", e.to_text()))
        .output;
    let text = page_text(&doc, 1);
    assert!(!text.contains("niet gesloten"), "{text}");
    assert!(!text.contains('$'), "{text}");
}

#[test]
fn the_pdf_is_deterministic_with_a_fixed_clock() {
    let case = load_case("rapport-one-student");
    let data = case_data(&case);
    let (_tmp, dir) = data_dir(true);
    let a = render_rapport_pdf(fonts(), &data, &dir, fixed_now()).unwrap();
    // Review 5a n4: without the memoisation cache the second compile does all the work again,
    // as a new process would.
    typst::comemo::evict(0);
    let b = render_rapport_pdf(fonts(), &data, &dir, fixed_now()).unwrap();
    assert!(a.output.starts_with(b"%PDF-"));
    assert_eq!(a.output, b.output);
    assert!(a.warnings.is_empty(), "{:?}", a.warnings);
}
