// SPDX-License-Identifier: AGPL-3.0-or-later

//! `maatwerk-cli typst compile` end to end.

use std::path::Path;
use std::process::{Command, Output};

fn cli(args: &[&str], dir: &Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_maatwerk-cli"))
        .args(args)
        .current_dir(dir)
        .output()
        .unwrap()
}

fn stderr(out: &Output) -> String {
    String::from_utf8_lossy(&out.stderr).into_owned()
}

#[test]
fn compiles_a_file_to_pdf_next_to_it() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(
        tmp.path().join("main.typ"),
        "#import \"@preview/zero:0.7.1\": num\n= Hallo #num[1.5]\n#sys.inputs.at(\"x\", default: \"\")",
    )
    .unwrap();
    let out = cli(
        &[
            "typst",
            "compile",
            "main.typ",
            "--input",
            "x=y",
            "--ignore-system-fonts",
        ],
        tmp.path(),
    );
    assert!(out.status.success(), "{}", stderr(&out));
    let pdf = std::fs::read(tmp.path().join("main.pdf")).unwrap();
    assert!(pdf.starts_with(b"%PDF-"));
}

#[test]
fn compile_errors_go_to_stderr_with_the_file_name() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("main.typ"), "= Kop\n#onbekend\n").unwrap();
    let out = cli(
        &["typst", "compile", "main.typ", "--ignore-system-fonts"],
        tmp.path(),
    );
    assert_eq!(out.status.code(), Some(1));
    let text = stderr(&out);
    assert!(
        text.starts_with("error: unknown variable: onbekend"),
        "{text}"
    );
    assert!(text.contains("┌─ main.typ:2:2"), "{text}");
    assert!(!tmp.path().join("main.pdf").exists());
}

#[test]
fn the_project_is_the_folder_of_the_file() {
    let tmp = tempfile::tempdir().unwrap();
    let project = tmp.path().join("opdracht");
    std::fs::create_dir_all(&project).unwrap();
    std::fs::write(tmp.path().join("geheim.txt"), "geheim").unwrap();
    std::fs::write(project.join("main.typ"), "#read(\"../geheim.txt\")").unwrap();
    let out = cli(
        &[
            "typst",
            "compile",
            "opdracht/main.typ",
            "--out",
            "x.pdf",
            "--ignore-system-fonts",
        ],
        tmp.path(),
    );
    assert_eq!(out.status.code(), Some(1));
    let text = stderr(&out);
    assert!(
        text.contains("access denied") || text.contains("not found"),
        "{text}"
    );
}

#[test]
fn usage_errors_exit_with_2() {
    let tmp = tempfile::tempdir().unwrap();
    let out = cli(&["typst", "compile"], tmp.path());
    assert_eq!(out.status.code(), Some(2));
    assert!(stderr(&out).contains("usage: maatwerk-cli typst compile"));
}
