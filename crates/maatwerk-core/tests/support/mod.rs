// SPDX-License-Identifier: AGPL-3.0-or-later

//! Reading the Step 2b Typst goldens (`tests/golden/typst/<case>/`) and comparing a compiled
//! document with them: page count, page sizes, text and pixels (PNG at the golden's ppi).
//! Shared by several test binaries, each using a part of it.
#![allow(dead_code)]

use std::path::{Path, PathBuf};

use serde_json::Value;
use tiny_skia::Pixmap;
use typst::layout::{Frame, FrameItem, PagedDocument};

pub fn golden_dir(id: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/golden/typst")
        .join(id)
}

pub fn load_case(id: &str) -> Value {
    let text = std::fs::read_to_string(golden_dir(id).join("case.json")).unwrap();
    serde_json::from_str(&text).unwrap()
}

/// Undoes the golden encoding (`tests/reference-harness/golden.mjs` `decode`) the way the data
/// reaches Rust: through `normaliseForTypst` (ui/src/domain/rapport.ts) and JSON, which gives
/// the `toTypst` values: `{"$undefined": true}` becomes `null` (key kept) and a non-finite
/// `{"$number": "NaN"}` becomes `0`.
pub fn decode(v: &Value) -> Value {
    match v {
        Value::Array(items) => Value::Array(items.iter().map(decode).collect()),
        Value::Object(map) => {
            if map.len() == 1 {
                if let Some(Value::String(n)) = map.get("$number") {
                    return match n.parse::<f64>() {
                        Ok(f) if f.is_finite() => serde_json::json!(f),
                        _ => Value::from(0),
                    };
                }
                if map.contains_key("$undefined") {
                    return Value::Null;
                }
            }
            Value::Object(map.iter().map(|(k, v)| (k.clone(), decode(v))).collect())
        }
        other => other.clone(),
    }
}

/// The SVG watermark of the synthetic data folder (`tools/fixtures/generate.mjs`, `SVG`).
pub const WATERMARK_SVG: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"120\" height=\"60\" viewBox=\"0 0 120 60\"><rect x=\"1\" y=\"1\" width=\"118\" height=\"58\" fill=\"#eef\" stroke=\"#235\"/><path d=\"M10 50 L60 10 L110 50\" fill=\"none\" stroke=\"#a23\" stroke-width=\"3\"/><text x=\"60\" y=\"55\" font-size=\"10\" text-anchor=\"middle\">schema</text></svg>\n";

/// All text of a frame in content order.
pub fn frame_text(frame: &Frame, out: &mut String) {
    for (_, item) in frame.items() {
        match item {
            FrameItem::Group(group) => frame_text(&group.frame, out),
            FrameItem::Text(text) => out.push_str(&text.text),
            _ => {}
        }
    }
}

/// Page count of a golden: its PDF, or its SVG pages (path C has no PDF).
pub fn golden_page_count(case: &Value) -> usize {
    match case["pdf"]["pages"].as_array() {
        Some(pages) => pages.len(),
        None => case["svg"].as_array().map_or(0, Vec::len),
    }
}

/// Compares `doc` with the golden's `pdf` (page sizes, text) and `png` entries. Text is compared
/// without whitespace (pdf.js inserts line breaks where Typst has none); the golden's `schema`
/// lines come from the watermark SVG, which is an image in Typst's frames, so they are dropped.
pub fn assert_matches_golden(id: &str, case: &Value, doc: &PagedDocument) {
    assert_eq!(doc.pages.len(), golden_page_count(case), "{id}: page count");
    let ppi = case["reference"]["ppi"].as_f64().unwrap() as f32;
    let out_dir = Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join("golden")
        .join(id);
    std::fs::create_dir_all(&out_dir).unwrap();

    for (i, page) in doc.pages.iter().enumerate() {
        let n = i + 1;
        if let Some(golden) = case["pdf"]["pages"].get(i) {
            let size = page.frame.size();
            let want = golden["size"].as_array().unwrap();
            assert!(
                (size.x.to_pt() - want[0].as_f64().unwrap()).abs() < 0.01
                    && (size.y.to_pt() - want[1].as_f64().unwrap()).abs() < 0.01,
                "{id} p{n}: page size"
            );
            let mut text = String::new();
            frame_text(&page.frame, &mut text);
            assert_eq!(
                squash(&text),
                squash(&golden_text(golden)),
                "{id} p{n}: text"
            );
        }

        let Some(png) = case["png"].get(i) else {
            continue;
        };
        let actual = typst_render::render(page, ppi / 72.0);
        let file = png["file"].as_str().unwrap();
        let expected = Pixmap::load_png(golden_dir(id).join(file)).unwrap();
        assert_eq!(
            (actual.width(), actual.height()),
            (expected.width(), expected.height()),
            "{id} {file}: PNG size"
        );
        let differing = actual
            .pixels()
            .iter()
            .zip(expected.pixels())
            .filter(|(a, b)| !close(**a, **b, tolerance(id)))
            .count();
        if differing > 0 {
            actual.save_png(out_dir.join(file)).unwrap();
        }
        assert_eq!(
            differing,
            0,
            "{id} {file}: {differing} pixels differ (actual written to {})",
            out_dir.display()
        );
    }
}

/// Per-channel tolerance of a golden: 0, except where a JPEG photo is drawn. JPEGs differ by up
/// to 3 levels because our `image` crate decodes with zune-jpeg 0.5 and the reference CLI's
/// build used an older decoder (`foto.jpg`; review 5b m3).
fn tolerance(id: &str) -> u8 {
    if id == "opdracht-images-student" {
        3
    } else {
        0
    }
}

fn close(a: tiny_skia::PremultipliedColorU8, b: tiny_skia::PremultipliedColorU8, tol: u8) -> bool {
    let d = |x: u8, y: u8| x.abs_diff(y) <= tol;
    d(a.red(), b.red())
        && d(a.green(), b.green())
        && d(a.blue(), b.blue())
        && d(a.alpha(), b.alpha())
}

/// The text of one golden PDF page without the watermark's `schema` line.
pub fn golden_text(page: &Value) -> String {
    page["text"]
        .as_str()
        .unwrap()
        .lines()
        .filter(|l| *l != "schema")
        .collect()
}

/// Text without whitespace and soft hyphens, for comparing Typst frame text with pdf.js text
/// (Typst keeps a U+00AD where it hyphenated; pdf.js joins the word).
pub fn squash(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_whitespace() && *c != '\u{ad}')
        .collect()
}
