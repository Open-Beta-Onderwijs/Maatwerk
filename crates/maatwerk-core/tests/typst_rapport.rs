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
use typst::layout::{Frame, FrameItem, PagedDocument};

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
fn t4_a_rapport_without_watermark_compiles_without_one() {
    // The reference failed with "file not found (searched at …school-watermerk.svg)" (T4).
    let case = load_case("rapport-no-watermark");
    assert!(!case["result"]["success"].as_bool().unwrap());
    let data = case_data(&case);
    let students = data.students.as_array().unwrap().len();
    let doc = compile(&data, false)
        .unwrap_or_else(|e| panic!("{}", e.to_text()))
        .output;
    assert_eq!(doc.pages.len(), 2 * students);
    // No image on the page: the background is empty.
    let mut images = 0;
    count_images(&doc.pages[0].frame, &mut images);
    assert_eq!(images, 0);
    let with = compile(&data, true).unwrap().output;
    let mut images = 0;
    count_images(&with.pages[0].frame, &mut images);
    assert_eq!(images, 1);
}

#[test]
fn t4_the_watermark_is_found_in_other_case() {
    // A data folder made on Windows may say `Fotos/School-Watermerk.svg` (T32).
    let case = load_case("rapport-one-student");
    let tmp = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(tmp.path().join("Fotos")).unwrap();
    std::fs::write(tmp.path().join("Fotos/School-Watermerk.svg"), WATERMARK_SVG).unwrap();
    let dir = DataDir::open(tmp.path()).unwrap();
    let doc = compile_document(&rapport_world(
        fonts(),
        &case_data(&case),
        &dir,
        fixed_now(),
    ))
    .unwrap_or_else(|e| panic!("{}", e.to_text()))
    .output;
    let mut images = 0;
    count_images(&doc.pages[0].frame, &mut images);
    assert_eq!(images, 1);
}

fn count_images(frame: &Frame, n: &mut usize) {
    for (_, item) in frame.items() {
        match item {
            FrameItem::Group(g) => count_images(&g.frame, n),
            FrameItem::Image(..) => *n += 1,
            _ => {}
        }
    }
}

/// Every text item of a frame with its absolute baseline (pt).
fn text_items(frame: &Frame, y0: f64, out: &mut Vec<(String, f64, String)>) {
    for (pos, item) in frame.items() {
        let y = y0 + pos.y.to_pt();
        match item {
            FrameItem::Group(g) => text_items(&g.frame, y + g.transform.ty.to_pt(), out),
            FrameItem::Text(t) => out.push((t.text.to_string(), y, t.lang.as_str().to_owned())),
            _ => {}
        }
    }
}

/// Diameters (pt) of the round shapes of a page between 5 and 15 pt: the score dots.
fn dot_diameters(frame: &Frame, out: &mut Vec<f64>) {
    for (_, item) in frame.items() {
        match item {
            FrameItem::Group(g) => dot_diameters(&g.frame, out),
            FrameItem::Shape(shape, _) if shape.fill.is_some() => {
                let size = shape.geometry.bbox_size();
                let (w, h) = (size.x.to_pt(), size.y.to_pt());
                if (w - h).abs() < 0.1 && (5.0..15.0).contains(&w) {
                    out.push((w * 10.0).round() / 10.0);
                }
            }
            _ => {}
        }
    }
}

fn footer_numbers(doc: &PagedDocument) -> Vec<String> {
    (0..doc.pages.len())
        .map(|p| {
            let mut items = Vec::new();
            text_items(&doc.pages[p].frame, 0.0, &mut items);
            let lowest = items.iter().map(|i| i.1).fold(f64::MIN, f64::max);
            items
                .iter()
                .filter(|i| i.1 == lowest && i.0.contains('/'))
                .map(|i| i.0.replace(' ', ""))
                .collect::<Vec<_>>()
                .join("")
        })
        .collect()
}

/// rapport-one-student with `n` observaties: about 25 push the first section onto a second page.
fn with_observaties(mut data: RapportData, student: usize, n: usize) -> RapportData {
    let obs: Vec<Value> = (0..n)
        .map(|i| {
            serde_json::json!({
                "icon": "🧮", "naam": format!("Observatie {i}"),
                "uitleg": "Een uitleg die een regel lang is.", "leeradvies": ""
            })
        })
        .collect();
    data.students[student]["observaties"] = Value::Array(obs);
    data
}

#[test]
fn t6_t7_half_points_show_with_a_decimal_comma() {
    // The reference showed "3 / 5" in the score column (int(3.5)), "3.5" in the dot and
    // "Je hebt 10.5 / 16 punten".
    let case = load_case("rapport-one-student");
    let doc = compile(&case_data(&case), true).unwrap().output;
    let text = page_text(&doc, 0).replace(' ', "");
    assert!(text.contains("Jehebt10,5/16punten"), "{text}");
    assert!(text.contains("I1R3,5/53,53,5/5(70%)"), "{text}");
    assert!(!text.contains("3.5"), "{text}");
}

#[test]
fn t8_f13_the_footer_counts_the_students_own_pages_and_pads_to_even() {
    let case = load_case("rapport-one-student");
    let mut data = case_data(&case);
    let second = data.students[0].clone();
    data.students.as_array_mut().unwrap().push(second);
    let data = with_observaties(data, 0, 30);
    let doc = compile(&data, true)
        .unwrap_or_else(|e| panic!("{}", e.to_text()))
        .output;
    assert_eq!(
        footer_numbers(&doc),
        ["1/4", "2/4", "3/4", "4/4", "1/2", "2/2"],
        "the first student has three pages and an empty fourth"
    );
    // The empty page has the footer only.
    let blank = page_text(&doc, 3);
    assert!(!blank.contains("Uitleg"), "{blank}");
    assert!(page_text(&doc, 4).contains("Toetsanalyse"));
}

#[test]
fn f13_the_last_student_is_padded_too() {
    let case = load_case("rapport-one-student");
    let data = with_observaties(case_data(&case), 0, 30);
    let doc = compile(&data, true).unwrap().output;
    assert_eq!(footer_numbers(&doc), ["1/4", "2/4", "3/4", "4/4"]);
}

#[test]
fn t10_edge_case_maxima_do_not_break_the_rapport() {
    let case = load_case("rapport-one-student");
    // Only bonus/diag questions: max_score 0 (the reference divided by zero).
    let mut data = case_data(&case);
    data.students[0]["max_score"] = Value::from(0);
    let doc = compile(&data, true)
        .unwrap_or_else(|e| panic!("max_score 0: {}", e.to_text()))
        .output;
    assert!(page_text(&doc, 0).contains("punten behaald. De N-term"));
    // A fractional or zero largest maximum (the reference's `range` failed on a float).
    for max in [Value::from(1.5), Value::from(0)] {
        let mut data = case_data(&case);
        data.exam_info["global_max_points"] = max.clone();
        compile(&data, true).unwrap_or_else(|e| panic!("global max {max}: {}", e.to_text()));
    }
}

#[test]
fn t25_the_rapport_is_dutch() {
    let case = load_case("rapport-one-student");
    let doc = compile(&case_data(&case), true).unwrap().output;
    let mut items = Vec::new();
    text_items(&doc.pages[0].frame, 0.0, &mut items);
    assert!(items.iter().all(|i| i.2 == "nl"), "{items:?}");
}

#[test]
fn b06_the_leeradvies_score_stays_on_one_line() {
    let case = load_case("rapport-one-student");
    let mut data = case_data(&case);
    data.students[0]["leeradvies_rows"][0]["score_str"] = Value::from("12,5 / 20 (63%)");
    let doc = compile(&data, true).unwrap().output;
    let mut items = Vec::new();
    text_items(&doc.pages[0].frame, 0.0, &mut items);
    let y_of = |s: &str| {
        items
            .iter()
            .find(|i| i.0.contains(s))
            .unwrap_or_else(|| panic!("{s}: {items:?}"))
            .1
    };
    assert_eq!(y_of("12,5"), y_of("(63%)"));
}

#[test]
fn b07_score_dots_are_larger_only_when_the_exam_has_half_points() {
    let case = load_case("rapport-one-student");
    let diameters = |data: &RapportData| {
        let doc = compile(data, true).unwrap().output;
        let mut d = Vec::new();
        dot_diameters(&doc.pages[0].frame, &mut d);
        d.into_iter().fold(0.0, f64::max)
    };
    let half = case_data(&case);
    let mut whole = case_data(&case);
    for s in whole.students.as_array_mut().unwrap() {
        for q in s["vragen"].as_array_mut().unwrap() {
            if let Some(x) = q["score"].as_f64() {
                q["score"] = Value::from(x.floor() as i64);
            }
        }
    }
    assert_eq!(diameters(&whole), 8.0, "4 pt radius as before");
    assert_eq!(diameters(&half), 11.0, "5.5 pt radius with half points");
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

/// A real rapport (embedded fonts, colour emoji as Type3 glyphs) for the Playwright check that
/// pdf.js shows it under the strict CSP (`ui/e2e/real-pdf.spec.ts`, backlog 3a m8). The mock's
/// canned PDF only uses Helvetica.
#[test]
fn writes_a_real_rapport_for_the_csp_check() {
    let case = load_case("rapport-valid");
    let (_tmp, dir) = data_dir(true);
    let pdf = render_rapport_pdf(fonts(), &case_data(&case), &dir, fixed_now()).unwrap();
    let out = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("e2e/rapport-valid.pdf");
    std::fs::create_dir_all(out.parent().unwrap()).unwrap();
    std::fs::write(&out, &pdf.output).unwrap();
}
