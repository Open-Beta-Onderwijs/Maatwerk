// SPDX-License-Identifier: AGPL-3.0-or-later

//! `maatwerk-cli assignment export-lib | check | render` end to end (Step 9).

use std::path::Path;
use std::process::{Command, Output};

fn cli(args: &[&str], dir: &Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_maatwerk-cli"))
        .args(args)
        .current_dir(dir)
        .output()
        .unwrap()
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

#[test]
fn export_check_and_render_an_opdracht() {
    let tmp = tempfile::tempdir().unwrap();
    let out = cli(&["assignment", "export-lib", "op"], tmp.path());
    assert!(out.status.success(), "{}", text(&out.stderr));
    assert!(tmp.path().join("op/LEESMIJ.txt").is_file());

    let out = cli(
        &[
            "assignment",
            "check",
            "op/opdracht.typ",
            "--json",
            "--ignore-system-fonts",
        ],
        tmp.path(),
    );
    assert!(out.status.success(), "{}", text(&out.stderr));
    let json: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(json["schema"], "maatwerk-assignment-check/1");
    assert_eq!(json["ok"], true);
    assert_eq!(json["entry"], "main.typ");
    assert_eq!(json["pageCount"], 2);
    assert_eq!(json["totalPunten"], 5.0);

    let out = cli(
        &["assignment", "check", "op", "--ignore-system-fonts"],
        tmp.path(),
    );
    let stdout = text(&out.stdout);
    assert!(
        stdout.contains("main.typ: 2 page(s), 4 vraag/vragen, 5 punten"),
        "{stdout}"
    );

    let out = cli(
        &[
            "assignment",
            "render",
            "op",
            "--answers",
            "--pdf",
            "sleutel.pdf",
            "--ignore-system-fonts",
        ],
        tmp.path(),
    );
    assert!(out.status.success(), "{}", text(&out.stderr));
    assert!(
        std::fs::read(tmp.path().join("sleutel.pdf"))
            .unwrap()
            .starts_with(b"%PDF-")
    );
}

#[test]
fn a_broken_opdracht_fails_with_its_place() {
    let tmp = tempfile::tempdir().unwrap();
    assert!(
        cli(&["assignment", "export-lib", "."], tmp.path())
            .status
            .success()
    );
    std::fs::write(
        tmp.path().join("opdracht.typ"),
        "#import \"lib.typ\": *\n#let setup_extra() = []\n#let render_uitleg() = [#onbekend]\n#let render_opgaven() = []\n",
    )
    .unwrap();
    let out = cli(
        &["assignment", "check", ".", "--ignore-system-fonts"],
        tmp.path(),
    );
    assert_eq!(out.status.code(), Some(1));
    let stdout = text(&out.stdout);
    assert!(
        stdout.contains("error: opdracht.typ:3:"),
        "file:line:column in\n{stdout}"
    );
    assert!(stdout.contains("does not compile"), "{stdout}");

    // export-lib refuses to overwrite the teacher's opdracht.typ.
    let out = cli(&["assignment", "export-lib", "."], tmp.path());
    assert_eq!(out.status.code(), Some(1));
    assert!(text(&out.stderr).contains("opdracht.typ"));
}
