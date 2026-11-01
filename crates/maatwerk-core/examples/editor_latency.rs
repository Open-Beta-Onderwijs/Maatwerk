// SPDX-License-Identifier: AGPL-3.0-or-later

//! Simulates typing in the editor on a synthetic fixture opdracht, for `docs/perf.md` (Step 8a):
//!
//! ```text
//! cargo run --release -p maatwerk-core --example editor_latency -- <typ file> <edits>
//! ```
//!
//! One `EditorSession` on the v1 opdracht with the preview inputs; every edit types one more
//! character into the second paragraph and compiles. Prints the cold compile, then median / p90
//! / max of layout and SVG time per edit and the pages sent, and the same edits as one-shot
//! renders (a fresh World and every page, as the old preview did per compile). Peak memory is
//! measured outside.

use std::path::Path;
use std::time::Instant;

use maatwerk_core::paths::{DataDir, RelPath};
use maatwerk_core::typst_svc::{
    EditorSession, FontStore, OpdrachtInputs, TypstProject, local_now, opdracht_world,
    render_assignment_svg_pages,
};

fn main() {
    let mut args = std::env::args().skip(1);
    let file = args
        .next()
        .unwrap_or_else(|| "opdracht_1756713600203.typ".to_owned());
    let edits: usize = args.next().map_or(200, |a| a.parse().expect("a number"));

    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let dir = DataDir::open(&fixtures).expect("fixture dir");
    let source = std::fs::read_to_string(fixtures.join("opdrachten").join(&file)).expect("file");
    let at = source.find("Alinea 2.").expect("a second paragraph") + "Alinea 2.".len();
    let opdracht = RelPath::parse("opdracht.typ").unwrap();
    let inputs = OpdrachtInputs::preview("Opdracht", true);
    let project = TypstProject::opdracht_v1(&dir, &file).expect("fixture opdracht");

    let start = Instant::now();
    let fonts = FontStore::shared();
    println!("system fonts: {} ms", start.elapsed().as_millis());

    let mut session = EditorSession::new(opdracht_world(
        fonts.clone(),
        project.clone(),
        &inputs,
        local_now(),
    ));
    session.set_file(&opdracht, source.clone()).unwrap();
    let start = Instant::now();
    let first = session.compile(0, &|| false).expect("not stale");
    assert!(first.ok, "{:?}", first.diagnostics);
    println!(
        "cold: {} pages, layout {} ms, svg {} ms, total {} ms",
        first.page_count,
        first.compile_ms,
        first.render_ms,
        start.elapsed().as_millis()
    );

    let text = |n: usize| {
        let typed: String = (0..n).map(|i| if i % 6 == 5 { ' ' } else { 'x' }).collect();
        format!("{} {typed}{}", &source[..at], &source[at..])
    };
    let (mut layout, mut svg, mut total, mut sent) = (vec![], vec![], vec![], vec![]);
    for n in 1..=edits {
        session.set_file(&opdracht, text(n)).unwrap();
        let start = Instant::now();
        let update = session.compile(n as u64, &|| false).expect("not stale");
        total.push(start.elapsed().as_secs_f64() * 1000.0);
        assert!(update.ok, "{:?}", update.diagnostics);
        layout.push(update.compile_ms as f64);
        svg.push(update.render_ms as f64);
        sent.push(update.pages.len() as f64);
    }
    println!("session, {edits} edits:");
    report("  layout ms", &mut layout);
    report("  svg ms   ", &mut svg);
    report("  total ms ", &mut total);
    report("  pages    ", &mut sent);

    let mut one_shot = vec![];
    for n in 1..=edits.min(50) {
        let start = Instant::now();
        render_assignment_svg_pages(
            fonts.clone(),
            project.clone().with_file(&opdracht, text(n)),
            &inputs,
            local_now(),
        )
        .expect("compiles");
        one_shot.push(start.elapsed().as_secs_f64() * 1000.0);
    }
    println!(
        "one-shot (fresh World, all pages), {} edits:",
        one_shot.len()
    );
    report("  total ms ", &mut one_shot);
}

fn report(label: &str, values: &mut [f64]) {
    values.sort_by(f64::total_cmp);
    let at = |q: f64| values[((values.len() - 1) as f64 * q).round() as usize];
    println!(
        "{label} median {:.1}  p90 {:.1}  max {:.1}",
        at(0.5),
        at(0.9),
        at(1.0)
    );
}
