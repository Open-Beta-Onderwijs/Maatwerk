// SPDX-License-Identifier: AGPL-3.0-or-later

//! Reading the Step 2b Typst goldens (`tests/golden/typst/<case>/`) and comparing a compiled
//! document with them: page count, page sizes, text and pixels (PNG at the golden's ppi).

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
/// reaches Rust through JSON: `{"$number": "NaN"}` (and other non-finite numbers) becomes `null`,
/// as `JSON.stringify` does; `{"$undefined": true}` disappears from objects.
pub fn decode(v: &Value) -> Value {
    match v {
        Value::Array(items) => Value::Array(items.iter().map(decode).collect()),
        Value::Object(map) => {
            if map.len() == 1 {
                if let Some(Value::String(n)) = map.get("$number") {
                    return match n.parse::<f64>() {
                        Ok(f) if f.is_finite() => serde_json::json!(f),
                        _ => Value::Null,
                    };
                }
                if map.contains_key("$undefined") {
                    return Value::Null;
                }
            }
            Value::Object(
                map.iter()
                    .filter(|(_, v)| !is_undefined(v))
                    .map(|(k, v)| (k.clone(), decode(v)))
                    .collect(),
            )
        }
        other => other.clone(),
    }
}

fn is_undefined(v: &Value) -> bool {
    v.as_object()
        .is_some_and(|m| m.len() == 1 && m.contains_key("$undefined"))
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

fn squash(s: &str) -> String {
    s.chars().filter(|c| !c.is_whitespace()).collect()
}

/// Compares `doc` with the golden's `pdf` and `png` entries. Text is compared without
/// whitespace (pdf.js inserts line breaks where Typst has none); the golden's `schema` lines come
/// from the watermark SVG, which is an image in Typst's frames, so they are dropped.
pub fn assert_matches_golden(id: &str, case: &Value, doc: &PagedDocument) {
    let pdf = &case["pdf"];
    let pages = pdf["pages"].as_array().unwrap();
    assert_eq!(doc.pages.len(), pages.len(), "{id}: page count");
    let ppi = case["reference"]["ppi"].as_f64().unwrap() as f32;
    let pngs = case["png"].as_array().unwrap();
    let out_dir = Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join("golden")
        .join(id);
    std::fs::create_dir_all(&out_dir).unwrap();

    for (i, (page, golden)) in doc.pages.iter().zip(pages).enumerate() {
        let n = i + 1;
        let size = page.frame.size();
        let want = golden["size"].as_array().unwrap();
        assert!(
            (size.x.to_pt() - want[0].as_f64().unwrap()).abs() < 0.01
                && (size.y.to_pt() - want[1].as_f64().unwrap()).abs() < 0.01,
            "{id} p{n}: page size"
        );

        let mut text = String::new();
        frame_text(&page.frame, &mut text);
        let golden_text: String = golden["text"]
            .as_str()
            .unwrap()
            .lines()
            .filter(|l| *l != "schema")
            .collect();
        assert_eq!(squash(&text), squash(&golden_text), "{id} p{n}: text");

        let actual = typst_render::render(page, ppi / 72.0);
        let file = pngs[i]["file"].as_str().unwrap();
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
            .filter(|(a, b)| a != b)
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
