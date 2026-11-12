// SPDX-License-Identifier: AGPL-3.0-or-later

//! The PO rapport (step 24, `rapport-po.typ`): the golden `tests/golden/typst/rapport-po`, whose
//! data is `buildPoRapportData` on the fixture of `ui/tests/domain/po-rapport.fixture.ts`
//! (`po-rapport.test.ts` checks that), and the layout rules of design spec 4.13.

mod support;

use maatwerk_core::paths::DataDir;
use maatwerk_core::typst_svc::{
    CompileError, Compiled, PoRapportData, compile_document, po_rapport_world,
    render_po_rapport_pdf,
};
use serde_json::Value;
use support::{WATERMARK_SVG, assert_matches_golden, decode, fonts, frame_text, load_case};
use time::OffsetDateTime;
use typst::layout::{FrameItem, PagedDocument};

const CASE: &str = "rapport-po";

/// 2026-01-01 00:00 UTC.
fn fixed_now() -> OffsetDateTime {
    OffsetDateTime::from_unix_timestamp(1_767_225_600).unwrap()
}

fn case_data() -> PoRapportData {
    let args = decode(&load_case(CASE)["call"]["args"]);
    PoRapportData {
        students: args[1].clone(),
        po_info: args[2].clone(),
    }
}

fn data_dir() -> (tempfile::TempDir, DataDir) {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(tmp.path().join("afbeeldingen")).unwrap();
    std::fs::write(
        tmp.path().join("afbeeldingen/school-watermerk.svg"),
        WATERMARK_SVG,
    )
    .unwrap();
    let dir = DataDir::open(tmp.path()).unwrap();
    (tmp, dir)
}

fn compile(data: &PoRapportData) -> Result<Compiled<PagedDocument>, CompileError> {
    let (_tmp, dir) = data_dir();
    compile_document(&po_rapport_world(fonts(), data, &dir, fixed_now()))
}

fn doc(data: &PoRapportData) -> PagedDocument {
    compile(data)
        .unwrap_or_else(|e| panic!("{}", e.to_text()))
        .output
}

fn page_text(doc: &PagedDocument, page: usize) -> String {
    let mut text = String::new();
    frame_text(&doc.pages[page].frame, &mut text);
    text
}

/// The footer's "n / m" of every page (the lowest text with a slash).
fn footer_numbers(doc: &PagedDocument) -> Vec<String> {
    fn items(frame: &typst::layout::Frame, y0: f64, out: &mut Vec<(String, f64)>) {
        for (pos, item) in frame.items() {
            let y = y0 + pos.y.to_pt();
            match item {
                FrameItem::Group(g) => items(&g.frame, y, out),
                FrameItem::Text(t) => out.push((t.text.to_string(), y)),
                _ => {}
            }
        }
    }
    doc.pages
        .iter()
        .map(|p| {
            let mut all = Vec::new();
            items(&p.frame, 0.0, &mut all);
            let lowest = all.iter().map(|i| i.1).fold(f64::MIN, f64::max);
            all.iter()
                .filter(|i| i.1 == lowest && i.0.contains('/'))
                .map(|i| i.0.replace(' ', ""))
                .collect::<Vec<_>>()
                .join("")
        })
        .collect()
}

#[test]
fn rapport_po_matches_the_golden() {
    let case = load_case(CASE);
    assert_matches_golden(CASE, &case, &doc(&case_data()));
}

#[test]
fn the_overview_page_has_the_sentence_projectgroep_scores_lines_and_comment() {
    let d = doc(&case_data());
    let p1 = page_text(&d, 0);
    for want in [
        "Beoordeling Natuurkunde PO Onderzoek valbeweging",
        "5A — Sem Dijkstra (900101)",
        "Jullie hebben 27 / 36 punten behaald en hadden dus 75% goed.",
        "De beoordeling van het groepswerk is een 7,5.",
        "wordt je cijfer een 7,3.",
        "Projectgroep Valtoren",
        "Sem Dijkstra (5A), Emma Kok (5A) en Bas Vos (5B)",
        "Scoretabel",
        "Totaal",
        "28,3 / 36 (78%)",
        "Bonus / malus",
        "−0,5",
        "+0,3",
        "Opmerking van de docent",
    ] {
        assert!(p1.contains(want), "{want:?} not on page 1: {p1}");
    }
    assert!(!p1.contains("Beoordeling per categorie"));
}

#[test]
fn a_projectgroep_of_one_has_no_group_line_and_empty_sections_are_left_out() {
    let d = doc(&case_data());
    let first = (0..d.pages.len())
        .find(|&p| page_text(&d, p).contains("Fleur de Wit (900104)"))
        .expect("Fleur's first page");
    let p = page_text(&d, first);
    assert!(
        p.contains("Je hebt 32 / 36 punten behaald en had dus 89% goed. Je cijfer is een 8,9.")
    );
    for gone in ["Projectgroep", "Bonus / malus", "Opmerking van de docent"] {
        assert!(!p.contains(gone), "{gone:?} on Fleur's page 1: {p}");
    }
}

#[test]
fn every_student_starts_on_an_odd_page_and_the_footer_counts_their_own_pages() {
    let d = doc(&case_data());
    let footers = footer_numbers(&d);
    let starts: Vec<usize> = footers
        .iter()
        .enumerate()
        .filter(|(_, f)| f.starts_with("1/"))
        .map(|(i, _)| i)
        .collect();
    assert_eq!(starts.len(), 2, "{footers:?}");
    assert!(starts.iter().all(|i| i % 2 == 0), "{footers:?}");
    assert_eq!(footers.len() % 2, 0, "{footers:?}");
    // The categories need two pages after the overview.
    assert!(footers[0].ends_with("/4"), "{footers:?}");
}

#[test]
fn the_categories_flow_over_pages_without_splitting_a_category() {
    let d = doc(&case_data());
    let names = [
        "Introductie",
        "Onderzoeksvraag en hypothese",
        "Theorie",
        "Meetopstelling",
        "Figuren",
        "Conclusie",
        "Discussie",
        "Originaliteit",
        "Samenwerking",
    ];
    // Sem's category pages are 2 and 3 (the first page holds the score table).
    let p2 = page_text(&d, 1);
    let p3 = page_text(&d, 2);
    assert!(p2.starts_with("Beoordeling per categorie"), "{p2}");
    // Every category on one of the two pages; the last one does not fit on the first, and moves
    // to the next page whole (its heading and its level cards together).
    for name in names {
        assert!(p2.contains(name) || p3.contains(name), "{name} missing");
    }
    assert!(p3.starts_with("Samenwerking"), "{p3}");
    assert!(p3.contains("De taken zijn niet verdeeld."), "{p3}");
    assert!(p3.contains("Algemene observaties"));
    assert!(p3.contains("Leeradvies:"));
    // Diagnostic and bonus tags.
    let all = format!("{p2}{p3}");
    assert!(all.contains("Originaliteitbonus") || all.contains("Originaliteit bonus"));
    assert!(all.contains("diagnostisch"));
}

#[test]
fn an_overwritten_grade_without_scores_shows_the_grade_only() {
    let mut data = case_data();
    let s = &mut data.students[0];
    s["grade_only"] = Value::Bool(true);
    s["grade_overridden"] = Value::Bool(true);
    s["grade"] = Value::String("6,0".into());
    s["rubric_grade"] = Value::Null;
    s["lines"] = Value::Array(vec![]);
    let d = doc(&data);
    let p1 = page_text(&d, 0);
    assert!(
        p1.contains("Je cijfer is een 6,0. Dit cijfer is met de hand overschreven door de docent."),
        "{p1}"
    );
    assert!(!p1.contains("Scoretabel"));
    assert!(!page_text(&d, 1).contains("Beoordeling per categorie"));
}

#[test]
fn render_po_rapport_pdf_makes_a_pdf() {
    let (_tmp, dir) = data_dir();
    let pdf = render_po_rapport_pdf(fonts(), &case_data(), &dir, fixed_now()).unwrap();
    assert!(pdf.output.starts_with(b"%PDF"));
}

/// For a visual check: `cargo test -p maatwerk-core --test typst_po_rapport -- --ignored`
/// writes every page at 110 ppi to `target/tmp/po-preview/`.
#[test]
#[ignore]
fn preview() {
    let d = doc(&case_data());
    let out = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("po-preview");
    std::fs::create_dir_all(&out).unwrap();
    for (i, page) in d.pages.iter().enumerate() {
        typst_render::render(page, 110.0 / 72.0)
            .save_png(out.join(format!("p{}.png", i + 1)))
            .unwrap();
    }
    eprintln!("{} pages in {}", d.pages.len(), out.display());
}
