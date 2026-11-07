// SPDX-License-Identifier: AGPL-3.0-or-later

//! `validate-data` on the migrated golden folder (`tests/fixtures/migrate/v2`) and on
//! deliberately broken copies of it.

use std::fs;
use std::path::{Path, PathBuf};

use tempfile::TempDir;

use super::*;

fn golden() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/migrate/v2/data")
}

fn copy_tree(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

fn copy() -> (TempDir, PathBuf) {
    let tmp = TempDir::new().unwrap();
    let data = tmp.path().join("data");
    copy_tree(&golden(), &data);
    (tmp, data)
}

fn issues_for<'a>(report: &'a ValidationReport, path: &str) -> Vec<&'a Issue> {
    report.issues.iter().filter(|i| i.path == path).collect()
}

fn has(report: &ValidationReport, kind: IssueKind, path: &str, text: &str) -> bool {
    issues_for(report, path)
        .iter()
        .any(|i| i.kind == kind && i.message.contains(text))
}

#[test]
fn the_migrated_fixture_has_no_errors_only_its_known_strays() {
    let report = validate(&golden()).unwrap();
    assert_eq!(report.schema_version, 2);
    assert_eq!(report.errors(), 0, "{:#?}", report.issues);
    let paths: Vec<(&str, IssueKind)> = report
        .issues
        .iter()
        .map(|i| (i.path.as_str(), i.kind))
        .collect();
    assert_eq!(
        paths,
        [
            ("notities.txt", IssueKind::Stray),
            ("opdrachten/images/weg/x.png", IssueKind::Stray),
            ("opdrachten/verweesd.typ", IssueKind::Stray),
        ],
        "{:#?}",
        report.issues
    );
    assert!(report.files_checked > 25);
}

#[test]
fn a_v1_folder_needs_migration() {
    let v1 = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/migrate/v1/data");
    let report = validate(&v1).unwrap();
    assert_eq!(report.schema_version, 1);
    assert_eq!(report.errors(), 1);
    assert_eq!(report.issues[0].kind, IssueKind::Version);
}

#[test]
fn an_edit_outside_maatwerk_breaks_the_stamp() {
    let (_tmp, data) = copy();
    let rel = "2025-2026/groups/3a-nat-2025-2026.json";
    let text = fs::read_to_string(data.join(rel)).unwrap();
    fs::write(data.join(rel), text.replace("3a nat", "3a nat (hand)")).unwrap();
    let report = validate(&data).unwrap();
    assert!(has(&report, IssueKind::Stamp, rel, "stempel klopt niet"));
    // A hand-made file has no stamp at all.
    fs::write(
        data.join("observaties/obs-9.json"),
        r#"{"id":"obs-9","naam":"x"}"#,
    )
    .unwrap();
    let report = validate(&data).unwrap();
    assert!(has(
        &report,
        IssueKind::Stamp,
        "observaties/obs-9.json",
        "geen stempel"
    ));
    assert_eq!(report.errors(), 0, "a stamp never blocks");
}

#[test]
fn conflict_copies_and_leftovers_are_strays() {
    let (_tmp, data) = copy();
    let group = "2025-2026/groups/3a-nat-2025-2026.json";
    for name in [
        "2025-2026/groups/3a-nat-2025-2026-LOKAAL12-PC.json",
        "2025-2026/groups/3a-nat-2025-2026 (1).json",
        // The Linux sync clients of the README (step 16b): OneDrive Client for Linux, rclone.
        "2025-2026/groups/3a-nat-2025-2026-lokaal12-safeBackup-0001.json",
        "2025-2026/groups/3a-nat-2025-2026.json.conflict1",
        "school.json.4242-1.tmp",
    ] {
        fs::copy(data.join(group), data.join(name)).unwrap();
    }
    let report = validate(&data).unwrap();
    assert!(
        has(
            &report,
            IssueKind::Stray,
            "2025-2026/groups/3a-nat-2025-2026.json.conflict1",
            ""
        ),
        "listed, not read"
    );
    for name in [
        "2025-2026/groups/3a-nat-2025-2026-LOKAAL12-PC.json",
        "2025-2026/groups/3a-nat-2025-2026 (1).json",
        "2025-2026/groups/3a-nat-2025-2026-lokaal12-safeBackup-0001.json",
    ] {
        assert!(
            has(
                &report,
                IssueKind::Stray,
                name,
                &format!("conflictkopie van {group}")
            ),
            "{name}: {:#?}",
            issues_for(&report, name)
        );
    }
    assert!(has(
        &report,
        IssueKind::Stray,
        "school.json.4242-1.tmp",
        "tijdelijk"
    ));
}

#[test]
fn ids_must_match_their_path() {
    let (_tmp, data) = copy();
    fs::rename(
        data.join("observaties/obs-1756713600101.json"),
        data.join("observaties/obs-2.json"),
    )
    .unwrap();
    let report = validate(&data).unwrap();
    assert!(has(
        &report,
        IssueKind::Placement,
        "observaties/obs-2.json",
        "\"obs-1756713600101\""
    ));
}

#[test]
fn broken_references_are_listed() {
    let (_tmp, data) = copy();
    fs::remove_file(data.join("opdrachten/opdracht_1756713600200/images/figuur.png")).unwrap();
    fs::remove_file(data.join("opdrachten/opdracht_1756713600201/lib.typ")).unwrap();
    fs::remove_file(data.join("gebruikers/gebr-1756713600000.json")).unwrap();
    fs::remove_file(data.join("2025-2026/exams/nat-toets-1-2025-2026.json")).unwrap();
    let report = validate(&data).unwrap();
    assert!(has(
        &report,
        IssueKind::Reference,
        "opdrachten/opdracht_1756713600200/opdracht.typ",
        "images/figuur.png ontbreekt"
    ));
    assert!(has(
        &report,
        IssueKind::Reference,
        "opdrachten/opdracht_1756713600201/opdracht.json",
        "lib.typ ontbreekt"
    ));
    assert!(has(
        &report,
        IssueKind::Reference,
        "2025-2026/groups/3a-nat-2025-2026.json",
        "Docent gebr-1756713600000 bestaat niet"
    ));
    assert!(has(
        &report,
        IssueKind::Reference,
        "2025-2026/scores/nat/1001.json",
        "toets nat-toets-1-2025-2026, die niet bestaat"
    ));
    assert_eq!(report.errors(), 1, "only the missing lib.typ is an error");
}

/// Renames in two steps, so a case-only rename also works on Windows.
fn rename_case(from: &Path, to: &Path) {
    let between = from.with_extension("rename-tmp");
    fs::rename(from, &between).unwrap();
    fs::rename(&between, to).unwrap();
}

#[test]
fn an_image_in_other_case_is_a_warning_with_the_real_name() {
    // A Windows-made folder: the opdracht says images/figuur.png, the file is Figuur.PNG.
    let (_tmp, data) = copy();
    let images = data.join("opdrachten/opdracht_1756713600200/images");
    rename_case(&images.join("figuur.png"), &images.join("Figuur.PNG"));
    let report = validate(&data).unwrap();
    let typ = "opdrachten/opdracht_1756713600200/opdracht.typ";
    assert!(has(
        &report,
        IssueKind::Reference,
        typ,
        "Afbeelding images/figuur.png heet anders gespeld: images/Figuur.PNG"
    ));
    assert!(!has(&report, IssueKind::Reference, typ, "ontbreekt"));
    assert_eq!(report.errors(), 0);
}

#[test]
fn corrupt_and_v1_shaped_content_is_reported() {
    let (_tmp, data) = copy();
    fs::write(data.join("school.json"), "{ half").unwrap();
    fs::write(
        data.join("2025-2026/scores/nat/1002.json"),
        r#"{"student_id":1002,"scores":{"nat-toets-1-2025-2026":{"q1":null}}}"#,
    )
    .unwrap();
    let report = validate(&data).unwrap();
    assert!(has(
        &report,
        IssueKind::Corrupt,
        "school.json",
        "Geen geldige JSON"
    ));
    let scores = "2025-2026/scores/nat/1002.json";
    assert!(has(
        &report,
        IssueKind::Shape,
        scores,
        "geen getal of tekst"
    ));
    assert!(has(&report, IssueKind::Placement, scores, "student_id"));
}

#[test]
fn image_refs_are_found_in_typst_text() {
    let typ = r#"#image("images/a.png", width: 1cm) #image( "images/b c.svg") #image("https://x/y.png") #let image(x) = x"#;
    assert_eq!(image_refs(typ), ["images/a.png", "images/b c.svg"]);
}

#[test]
fn step_7b_files_and_sectie_references_are_checked() {
    let (_tmp, data) = copy();
    let stamp = |v: serde_json::Value| {
        let mut v = v;
        crate::integrity::stamp(&mut v);
        format!("{}\n", serde_json::to_string_pretty(&v).unwrap())
    };
    fs::write(
        data.join("instellingen.json"),
        stamp(serde_json::json!({ "snapshots": { "intervalHours": 24 }, "_meta": { "rev": 1 } })),
    )
    .unwrap();
    fs::create_dir_all(data.join("snapshots")).unwrap();
    fs::write(data.join("snapshots/2026-10-31 0815.zip"), "zip").unwrap();
    let school_path = data.join("school.json");
    let mut school: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&school_path).unwrap()).unwrap();
    school["secties"] = serde_json::json!({ "nat": { "voorzitter": "gebr-weg" } });
    fs::write(&school_path, stamp(school)).unwrap();

    let report = validate(&data).unwrap();
    assert!(
        issues_for(&report, "instellingen.json").is_empty(),
        "{report:#?}"
    );
    assert!(issues_for(&report, "snapshots/2026-10-31 0815.zip").is_empty());
    assert!(has(
        &report,
        IssueKind::Reference,
        "school.json",
        "Sectievoorzitter nat: gebruiker gebr-weg bestaat niet"
    ));
}

/// Quirk B24: the reference could give two questions the same id after a deletion; their
/// scores then share one slot. The check reports it as a warning (review 10 M2); nothing is
/// repaired.
#[test]
fn b24_a_repeated_question_id_is_reported() {
    let (_tmp, data) = copy();
    let rel = "2025-2026/exams/nat-toets-1-2025-2026.json";
    let text = fs::read_to_string(data.join(rel)).unwrap();
    fs::write(
        data.join(rel),
        text.replacen(r#""id": "q3""#, r#""id": "q2""#, 1),
    )
    .unwrap();
    let report = validate(&data).unwrap();
    assert!(
        has(
            &report,
            IssueKind::Shape,
            rel,
            "Vraag-id q2 komt 2 keer voor"
        ),
        "{:#?}",
        report.issues
    );
    assert_eq!(report.errors(), 0, "{:#?}", report.issues);
}
