// SPDX-License-Identifier: AGPL-3.0-or-later

//! Migration tests on the synthetic v1 fixture `tests/fixtures/migrate/v1` (no real data). The
//! expected results are `tests/fixtures/migrate/v2` (v1 -> v2 only) and `v3` (the whole way, and
//! from `v2`); `MAATWERK_UPDATE_GOLDEN=1` rewrites them.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;
use tempfile::TempDir;
use time::OffsetDateTime;

use super::*;
use crate::integrity::{self, StampState};

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/migrate")
}

/// 2026-10-30 14:05 UTC.
fn now() -> OffsetDateTime {
    OffsetDateTime::from_unix_timestamp(1_793_369_100).unwrap()
}

struct Rig {
    _tmp: TempDir,
    shared: PathBuf,
    data: PathBuf,
    backups: PathBuf,
}

fn rig() -> Rig {
    rig_from("v1")
}

/// A shared folder holding the fixture `name` (`v1`: `data/` only; `v2`: also `rapporten/`).
fn rig_from(name: &str) -> Rig {
    let tmp = TempDir::new().unwrap();
    let shared = tmp.path().join("shared");
    let data = shared.join("data");
    copy_tree(&fixtures().join(name), &shared);
    let backups = tmp.path().join("backups");
    Rig {
        _tmp: tmp,
        shared,
        data,
        backups,
    }
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

fn tree(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    plan::walk_all(dir)
        .unwrap()
        .into_iter()
        .map(|rel| {
            let bytes = fs::read(dir.join(&rel)).unwrap();
            (rel, bytes)
        })
        .collect()
}

fn assert_tree_eq(actual: &Path, expected: &Path) {
    let (a, e) = (tree(actual), tree(expected));
    let a_keys: Vec<_> = a.keys().collect();
    let e_keys: Vec<_> = e.keys().collect();
    assert_eq!(a_keys, e_keys, "file list of {}", expected.display());
    for (rel, bytes) in &a {
        assert!(
            bytes == &e[rel],
            "{rel} differs:\n{}",
            String::from_utf8_lossy(bytes)
        );
    }
}

fn update_golden() -> bool {
    std::env::var_os("MAATWERK_UPDATE_GOLDEN").is_some()
}

fn check_against_golden(r: &Rig) {
    check_against(r, "v3");
}

fn check_against(r: &Rig, name: &str) {
    let golden = fixtures().join(name);
    if update_golden() {
        let _ = fs::remove_dir_all(&golden);
        copy_tree(&r.shared, &golden);
    }
    assert_tree_eq(&r.data, &golden.join("data"));
    assert_tree_eq(&r.shared.join("rapporten"), &golden.join("rapporten"));
}

#[test]
fn v1_fixture_migrates_to_the_expected_v2_tree() {
    let r = rig();
    let report = migrate_to(&r.data, Some(&r.backups), now(), 2).unwrap();
    assert!(report.applied);
    assert_eq!((report.from_version, report.to_version), (1, 2));
    check_against(&r, "v2");
    assert_eq!(folder_version(&r.data).unwrap(), 2);

    let warnings = report.warnings.join("\n");
    for expected in [
        "gebruiker gebr-1756713600000 stond er dubbel in",
        "leerling 1002 stond er dubbel in",
        "tekstbestand opdracht_1756713600201.typ ontbrak",
    ] {
        assert!(warnings.contains(expected), "{expected:?} in\n{warnings}");
    }
}

#[test]
fn v1_fixture_migrates_through_v2_to_the_expected_v3_tree() {
    let r = rig();
    let report = migrate(&r.data, Some(&r.backups), now()).unwrap();
    assert!(report.applied);
    assert_eq!((report.from_version, report.to_version), (1, 3));
    check_against_golden(&r);
    assert_eq!(folder_version(&r.data).unwrap(), 3);
    assert_eq!(report.notes.len(), 2, "{:?}", report.notes);
}

#[test]
fn v2_fixture_migrates_to_the_same_v3_tree() {
    let r = rig_from("v2");
    let report = migrate(&r.data, Some(&r.backups), now()).unwrap();
    assert!(report.applied);
    assert_eq!((report.from_version, report.to_version), (2, 3));
    check_against_golden(&r);
    let zip = PathBuf::from(report.backup.unwrap());
    assert!(
        zip.to_string_lossy().contains("maatwerk-backup-v2 "),
        "{zip:?}"
    );
}

#[test]
fn v3_content_follows_the_spec() {
    let r = rig_from("v2");
    let report = migrate(&r.data, Some(&r.backups), now()).unwrap();
    let read = |rel: &str| -> Value {
        serde_json::from_slice(&fs::read(r.data.join(rel)).unwrap()).unwrap()
    };
    // X-07b: fotos/ -> afbeeldingen/, with the paths in the data.
    assert!(!r.data.join("fotos").exists());
    assert!(r.data.join("afbeeldingen/school-logo.png").is_file());
    assert!(r.data.join("afbeeldingen/gebr-1756713600000.png").is_file());
    let school = read("school.json");
    assert_eq!(school["logo"], "afbeeldingen/school-logo.png");
    assert_eq!(school["minAppVersion"], "0.9.0");
    assert_eq!(school["_meta"]["rev"], 2, "rev + 1 for a changed entity");
    assert_eq!(school["_meta"]["updatedAt"], "2026-10-30T14:05:00.000Z");
    assert_eq!(
        read("gebruikers/gebr-1756713600000.json")["foto"],
        "afbeeldingen/gebr-1756713600000.png"
    );
    let admin = read("gebruikers/admin.json");
    assert_eq!(admin["foto"], Value::Null);
    // X-07c, D20: the stale presence files are gone, nothing moved.
    assert!(!r.data.join("users").exists());
    assert!(!r.data.join("aanwezigheid").exists());
    assert!(
        report
            .changes
            .iter()
            .any(|c| c.action == Action::Delete && c.path == "users/admin.json")
    );
    // Decision 14: every exam has the new fields; existing ones are kept.
    let exam = read("2025-2026/exams/nat-toets-1-2025-2026.json");
    assert_eq!(exam["kind"], "toets");
    assert_eq!(exam["diagnostic"], false);
    let keys: Vec<&String> = exam.as_object().unwrap().keys().collect();
    assert_eq!(keys.last().unwrap().as_str(), "_meta", "_meta stays last");
    // Decision 13, F-12: resits get the original's observaties, locked.
    let herkansing = read("2025-2026/exams/toets-herkansing-1.json");
    assert_eq!(
        herkansing["obs_ids"],
        serde_json::json!(["obs-1756713600100"])
    );
    assert_eq!(herkansing["obs_from_parent"], true);
    let inhaal = read("2025-2026/exams/toets-inhaal-1.json");
    assert_eq!(
        inhaal["obs_ids"],
        serde_json::json!(["obs-1756713600100", "obs-1756713600101"]),
        "its own observatie stays, after the original's"
    );
    assert_eq!(
        report.notes,
        [
            "2025-2026 Toets 1 — HERKANSING (van Toets 1): observaties vóór: geen; na: \
             Eenheden vergeten",
            "2025-2026 Toets 1 — INHAAL (van Toets 1): observaties vóór: Rekenfout; na: \
             Eenheden vergeten, Rekenfout",
        ]
    );
    let warnings = report.warnings.join("\n");
    assert!(
        warnings.contains("Toets 1 — INHAAL: had eigen observaties (Rekenfout)"),
        "{warnings}"
    );
    assert_eq!(read("config.json")["schema_version"], 3);
    // The migrated folder is clean apart from the fixture's strays.
    let check = crate::validate::validate(&r.data).unwrap();
    let errors: Vec<_> = check
        .issues
        .iter()
        .filter(|i| i.severity == crate::validate::Severity::Error)
        .collect();
    assert!(errors.is_empty(), "{errors:?}");
}

#[test]
fn a_v2_dry_run_lists_the_resits_before_anything_changes() {
    let r = rig_from("v2");
    let before = tree(&r.data);
    let report = migrate(&r.data, None, now()).unwrap();
    assert!(!report.applied);
    assert_eq!(tree(&r.data), before);
    assert_eq!(report.notes.len(), 2);
    assert_eq!(
        report.changes[0].path, "school.json",
        "minAppVersion is the first write (runbook section 8)"
    );
    assert!(report.changes.iter().any(|c| c.action == Action::Move
        && c.path == "fotos/school-logo.png"
        && c.to.as_deref() == Some("afbeeldingen/school-logo.png")));
    assert_eq!(report.changes.last().unwrap().path, "config.json");
    let text = report_text(&report, None, "d", now());
    assert!(
        text.contains("Observaties bij inhaal- en herkansingstoetsen (2):"),
        "{text}"
    );
}

#[test]
fn an_interrupted_v3_run_continues_to_the_same_result() {
    for stop_after in [1, 3, 5, 8] {
        let r = rig_from("v2");
        let plan = v3::build(&r.data, now()).unwrap();
        assert!(plan.ops.len() > stop_after, "{} ops", plan.ops.len());
        for op in plan.ops.iter().take(stop_after) {
            op.apply(&r.data).unwrap();
        }
        assert_eq!(folder_version(&r.data).unwrap(), 2, "config.json goes last");
        migrate(&r.data, Some(&r.backups), now()).unwrap();
        check_against_golden(&r);
    }
}

#[test]
fn a_windows_made_v2_folder_in_mixed_case_migrates() {
    let r = rig_from("v2");
    fs::rename(r.data.join("fotos"), r.data.join("Fotos")).unwrap();
    fs::rename(r.data.join("users"), r.data.join("Users")).unwrap();
    migrate(&r.data, Some(&r.backups), now()).unwrap();
    check_against_golden(&r);
}

#[test]
fn every_json_file_maatwerk_owns_is_stamped_after_migration() {
    let r = rig();
    migrate(&r.data, Some(&r.backups), now()).unwrap();
    for (rel, bytes) in tree(&r.data) {
        if !rel.ends_with(".json") {
            continue;
        }
        assert!(bytes.ends_with(b"}\n"), "C13 trailing newline: {rel}");
        let v: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(integrity::check(&v), StampState::Ok, "{rel}");
    }
}

#[test]
fn v2_content_follows_the_spec() {
    let r = rig();
    migrate_to(&r.data, Some(&r.backups), now(), 2).unwrap();
    let read = |rel: &str| -> Value {
        serde_json::from_slice(&fs::read(r.data.join(rel)).unwrap()).unwrap()
    };
    // C8: string ids, duplicates merged (later fields win).
    let students = read("2025-2026/students-2025-2026.json");
    let list = students["students"].as_array().unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0]["id"], "1001");
    assert_eq!(list[1]["id"], "1002");
    assert_eq!(list[1]["stamklas"], "3b");
    let group = read("2025-2026/groups/3a-nat-2025-2026.json");
    assert_eq!(group["student_ids"], serde_json::json!(["1001", "1002"]));
    assert_eq!(group["_meta"]["rev"], 4, "existing _meta is kept");
    // C9: null -> "N"; invalid input stays as typed.
    let scores = read("2025-2026/scores/nat/1001.json");
    assert_eq!(scores["student_id"], "1001");
    assert_eq!(
        scores["scores"]["nat-toets-1-2025-2026"],
        serde_json::json!({ "q1": 2, "q2": "N", "q3": "abc" })
    );
    // C5: entity without _meta gets rev 1.
    let obs = read("observaties/obs-1756713600101.json");
    assert_eq!(obs["_meta"]["rev"], 1);
    assert_eq!(obs["_meta"]["updatedAt"], "2026-10-30T14:05:00.000Z");
    // C14: opdracht folder, no typFile, image paths rewritten.
    let dir = r.data.join("opdrachten/opdracht_1756713600200");
    let opdracht = read("opdrachten/opdracht_1756713600200/opdracht.json");
    assert!(opdracht.get("typFile").is_none());
    let typ = fs::read_to_string(dir.join("opdracht.typ")).unwrap();
    assert!(typ.contains(r#"image("images/figuur.png""#), "{typ}");
    assert!(dir.join("images/figuur.png").is_file());
    assert_eq!(
        fs::read_to_string(dir.join("lib.typ")).unwrap(),
        crate::assets::LIB_TYP
    );
    // C11: wi_4 filled the missing wisa/wisc/wisd but not the existing wisb.
    let wisb = read("templates/rtti/wisb_4.json");
    assert_eq!(wisb["uitleg"]["R"], "R wisb4");
    let wisa = read("templates/rtti/wisa_4.json");
    assert_eq!(wisa["uitleg"]["R"], "R wi4");
    assert!(!r.data.join("templates/rtti/wi_4.json").exists());
    // C16, C1.
    assert!(r.data.join("gebruikers/admin.json").is_file());
    assert!(!r.data.join("gebruikers.json").exists());
    assert_eq!(read("config.json")["schema_version"], 2);
    // Strays stay.
    assert!(r.data.join("notities.txt").is_file());
    assert!(r.data.join("opdrachten/verweesd.typ").is_file());
    assert!(r.data.join("opdrachten/images/weg/x.png").is_file());
}

#[test]
fn a_dry_run_changes_nothing_and_lists_the_plan() {
    let r = rig();
    let before = tree(&r.data);
    let report = migrate(&r.data, None, now()).unwrap();
    assert!(!report.applied);
    assert!(report.backup.is_none());
    assert_eq!(tree(&r.data), before);
    assert!(!r.backups.exists());
    let has = |action, path: &str| {
        report
            .changes
            .iter()
            .any(|c| c.action == action && c.path == path)
    };
    assert!(has(Action::Delete, "gebruikers.json"));
    assert!(has(Action::Write, "gebruikers/admin.json"));
    assert!(has(
        Action::Delete,
        "2025-2026/exams/nat-toets-1-2025-2026.json.lock"
    ));
    assert!(report.changes.iter().any(|c| c.action == Action::Move
        && c.to.as_deref()
            == Some("../rapporten/2025-2026/2025-09-02 0800 rapport nat 3a nat Toets 1.pdf")));
    assert_eq!(report.changes.last().unwrap().path, "config.json");
    assert!(
        report.warnings.last().unwrap().contains("versie 3"),
        "the v3 step is announced: {:?}",
        report.warnings
    );
}

#[test]
fn a_second_run_does_nothing() {
    let r = rig();
    migrate(&r.data, Some(&r.backups), now()).unwrap();
    let after = tree(&r.data);
    let again = migrate(&r.data, Some(&r.backups), now()).unwrap();
    assert!(!again.applied);
    assert!(again.changes.is_empty());
    assert!(again.backup.is_none());
    assert_eq!(tree(&r.data), after);
}

#[test]
fn an_interrupted_run_continues_to_the_same_result() {
    for stop_after in [1, 7, 20, 40] {
        let r = rig();
        let plan = plan::build(&r.data, now()).unwrap();
        for op in plan.ops.iter().take(stop_after) {
            op.apply(&r.data).unwrap();
        }
        assert_eq!(folder_version(&r.data).unwrap(), 1, "config.json goes last");
        migrate(&r.data, Some(&r.backups), now()).unwrap();
        check_against_golden(&r);
    }
}

#[test]
fn the_backup_holds_every_file_and_lives_outside_the_shared_folder() {
    let r = rig();
    let before = tree(&r.data);
    let report = migrate(&r.data, Some(&r.backups), now()).unwrap();
    let zip_path = PathBuf::from(report.backup.unwrap());
    assert_eq!(
        zip_path.file_name().unwrap().to_str().unwrap(),
        "maatwerk-backup-v1 2026-10-30 1405.zip"
    );
    let mut zip = zip::ZipArchive::new(fs::File::open(&zip_path).unwrap()).unwrap();
    assert_eq!(zip.len(), before.len());
    for (rel, bytes) in &before {
        let mut entry = zip.by_name(&format!("data/{rel}")).unwrap();
        let mut buf = Vec::new();
        std::io::Read::read_to_end(&mut entry, &mut buf).unwrap();
        assert_eq!(&buf, bytes, "{rel}");
    }

    for bad in [r.data.join("backup"), r.shared.join("backup")] {
        let r2 = rig();
        let bad = bad
            .strip_prefix(&r.shared)
            .map(|t| r2.shared.join(t))
            .unwrap();
        let before = tree(&r2.data);
        let err = migrate(&r2.data, Some(&bad), now()).unwrap_err();
        assert_eq!(err.code(), "migration_blocked", "{err}");
        assert_eq!(tree(&r2.data), before, "nothing changed");
        assert!(!bad.exists(), "not even the backup folder");
    }
}

#[test]
fn unmigrated_legacy_data_blocks_before_anything_changes() {
    let cases: [(&str, &str); 4] = [
        ("students.json", r#"[{"id":1}]"#),
        ("observaties.json", r#"[{"id":"obs-1"}]"#),
        ("2025-2026/exams.json", r#"[{"id":"e"}]"#),
        ("2025-2026/scores/1001.json", r#"{"student_id":1001}"#),
    ];
    for (rel, content) in cases {
        let r = rig();
        fs::write(r.data.join(rel), content).unwrap();
        let before = tree(&r.data);
        let err = migrate(&r.data, Some(&r.backups), now()).unwrap_err();
        assert_eq!(err.code(), "migration_blocked", "{rel}");
        assert!(err.to_string().contains(rel), "{err}");
        assert_eq!(tree(&r.data), before, "{rel}: nothing changed");
        assert!(!r.backups.exists(), "{rel}: no backup either");
    }
}

#[test]
fn a_corrupt_file_blocks() {
    let r = rig();
    fs::write(r.data.join("school.json"), "{ half").unwrap();
    let err = migrate(&r.data, Some(&r.backups), now()).unwrap_err();
    assert_eq!(err.code(), "migration_blocked");
    assert!(err.to_string().contains("school.json"));
}

#[test]
fn a_newer_folder_is_refused_and_an_empty_one_just_gets_a_version() {
    let r = rig();
    fs::write(r.data.join("config.json"), r#"{"schema_version":4}"#).unwrap();
    let err = migrate(&r.data, Some(&r.backups), now()).unwrap_err();
    assert_eq!(err.code(), "unsupported_schema");

    let tmp = TempDir::new().unwrap();
    let data = tmp.path().join("shared/data");
    fs::create_dir_all(&data).unwrap();
    let report = migrate(&data, Some(&tmp.path().join("b")), now()).unwrap();
    assert!(report.applied);
    assert_eq!(folder_version(&data).unwrap(), 3);
}

#[test]
fn a_windows_made_folder_in_mixed_case_migrates() {
    // Hand-typed `Images/<id>/` and a `.PNG` file: Windows found both, so must the migration.
    let r = rig();
    let old = r.data.join("opdrachten");
    let typ = old.join("opdracht_1756713600200.typ");
    let text = fs::read_to_string(&typ).unwrap().replace(
        "images/opdracht_1756713600200/figuur.png",
        "Images/opdracht_1756713600200/Figuur.PNG",
    );
    fs::write(&typ, text).unwrap();
    let images = old.join("images/opdracht_1756713600200");
    fs::rename(images.join("figuur.png"), images.join("tmp.png")).unwrap();
    fs::rename(images.join("tmp.png"), images.join("Figuur.PNG")).unwrap();

    migrate(&r.data, Some(&r.backups), now()).unwrap();
    let dir = r.data.join("opdrachten/opdracht_1756713600200");
    let migrated = fs::read_to_string(dir.join("opdracht.typ")).unwrap();
    assert!(migrated.contains("\"images/Figuur.PNG\""), "{migrated}");
    assert!(dir.join("images/Figuur.PNG").is_file());
    let report = crate::validate::validate(&r.data).unwrap();
    assert!(
        !report.issues.iter().any(|i| i.message.contains("Figuur")),
        "{:?}",
        report.issues
    );
}

#[test]
fn helper_rules() {
    assert!(plan::is_temp_name("x.json.4242.tmp"));
    assert!(plan::is_temp_name("x.json.4242-3.tmp"));
    assert!(!plan::is_temp_name("notes.tmp"));
    assert!(!plan::is_temp_name("x.json"));
    assert_eq!(
        plan::v1_template_key("rtti_expl_adv_wisb_4.json"),
        Some(("wisb", 4))
    );
    assert_eq!(plan::v1_template_key("other.json"), None);
    assert_eq!(
        plan::id_string(&serde_json::json!(12345)),
        serde_json::json!("12345")
    );
    assert!(plan::is_file_id("toets-lk3j2-a1b2c3"));
    assert!(!plan::is_file_id("../x"));
}

#[test]
fn the_report_lists_every_warning_and_check_issue_next_to_the_backup() {
    let r = rig();
    let report = migrate(&r.data, Some(&r.backups), now()).unwrap();
    let check = crate::validate::ValidationReport {
        schema_version: 2,
        files_checked: 7,
        issues: vec![
            crate::validate::Issue {
                severity: crate::validate::Severity::Warning,
                kind: crate::validate::IssueKind::Stray,
                path: "nat/x (1).json".into(),
                message: "conflictkopie".into(),
            },
            crate::validate::Issue {
                severity: crate::validate::Severity::Error,
                kind: crate::validate::IssueKind::Corrupt,
                path: "bio/y.json".into(),
                message: "onleesbaar".into(),
            },
        ],
    };
    let path = save_report(&report, Some(&check), "D:/data", now())
        .unwrap()
        .unwrap();
    let backup = PathBuf::from(report.backup.as_ref().unwrap());
    assert_eq!(path.parent(), backup.parent());
    assert!(
        path.file_name()
            .unwrap()
            .to_string_lossy()
            .ends_with(" verslag.txt")
    );
    let text = fs::read_to_string(&path).unwrap();
    for w in &report.warnings {
        assert!(text.contains(w.as_str()), "{w:?} in\n{text}");
    }
    assert!(
        text.contains("7 bestanden gecontroleerd, 1 fout, 1 waarschuwing."),
        "{text}"
    );
    // Errors first.
    let err = text.find("[FOUT] bio/y.json: onleesbaar").unwrap();
    let warn = text.find("[Let op] nat/x (1).json: conflictkopie").unwrap();
    assert!(err < warn, "{text}");
    assert!(text.contains("Map: D:/data"));
}

#[test]
fn a_dry_run_has_no_report_file() {
    let r = rig();
    let report = migrate(&r.data, None, now()).unwrap();
    assert_eq!(save_report(&report, None, "d", now()).unwrap(), None);
    assert!(report_text(&report, None, "d", now()).contains("(niet uitgevoerd)"));
}
