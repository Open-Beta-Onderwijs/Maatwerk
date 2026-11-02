// SPDX-License-Identifier: AGPL-3.0-or-later

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use serde_json::Value;
use tempfile::TempDir;
use time::OffsetDateTime;

use super::*;

fn fonts() -> Arc<FontStore> {
    static FONTS: OnceLock<Arc<FontStore>> = OnceLock::new();
    FONTS
        .get_or_init(|| Arc::new(FontStore::new(false)))
        .clone()
}

fn now() -> OffsetDateTime {
    OffsetDateTime::from_unix_timestamp(1_793_369_100).unwrap()
}

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// A new opdracht folder as Maatwerk creates it: main.typ, lib.typ, the starting opdracht.typ.
fn opdracht(opdracht_typ: Option<&str>) -> TempDir {
    let tmp = TempDir::new().unwrap();
    fs::write(tmp.path().join("main.typ"), assets::OPDRACHT_MAIN_TYP).unwrap();
    fs::write(tmp.path().join("lib.typ"), assets::LIB_TYP).unwrap();
    fs::write(
        tmp.path().join("opdracht.typ"),
        opdracht_typ.unwrap_or(assets::BASE_ASSIGNMENT_TYP),
    )
    .unwrap();
    tmp
}

fn check_dir(dir: &Path, options: RenderOptions) -> CheckReport {
    check(&Assignment::open(dir).unwrap(), options, fonts(), now())
}

#[test]
fn the_starting_opdracht_checks_clean() {
    let tmp = opdracht(None);
    let report = check_dir(tmp.path(), RenderOptions::default());
    assert!(report.ok, "{:?}", report.diagnostics);
    assert_eq!(report.schema, CHECK_SCHEMA);
    assert_eq!(report.entry, "main.typ");
    assert_eq!(report.errors(), 0);
    assert_eq!(
        report.page_count,
        Some(2),
        "uitleg, then a page break, then the opgaven"
    );
    let labels: Vec<&str> = report.vragen.iter().map(|v| v.label.as_str()).collect();
    assert_eq!(labels, ["1a", "1b", "1c", "2"]);
    assert_eq!(report.total_punten, 5.0);
    assert!(report.checks.is_empty(), "{:?}", report.checks);
    assert!(report.vragen.iter().all(|v| v.page == 2), "1-based pages");
}

#[test]
fn opdracht_typ_means_the_main_typ_next_to_it() {
    let tmp = opdracht(None);
    let a = Assignment::open(&tmp.path().join("opdracht.typ")).unwrap();
    assert_eq!(a.entry(), "main.typ");
    let alone = TempDir::new().unwrap();
    fs::write(alone.path().join("opdracht.typ"), "= Los").unwrap();
    let a = Assignment::open(&alone.path().join("opdracht.typ")).unwrap();
    assert_eq!(
        a.entry(),
        "opdracht.typ",
        "no main.typ: compile the file itself"
    );
    let empty = TempDir::new().unwrap();
    assert!(
        Assignment::open(empty.path()).is_err(),
        "a folder needs main.typ"
    );
    assert!(Assignment::open(&empty.path().join("nope.typ")).is_err());
}

#[test]
fn a_compile_error_is_reported_with_its_place_in_the_teachers_file() {
    let src = assets::BASE_ASSIGNMENT_TYP.replace(
        "#vraag(punten: 1, antwoord: [Antwoord op de derde vraag.])",
        "#vraag(punten: 1, antwoord: [Antwoord op de derde vraag.], kleur: rood)",
    );
    let tmp = opdracht(Some(&src));
    let report = check_dir(tmp.path(), RenderOptions::default());
    assert!(!report.ok);
    assert_eq!(report.page_count, None);
    assert!(report.vragen.is_empty());
    let error = &report.diagnostics[0];
    assert_eq!(error.severity, Severity::Error);
    let at = error.location.as_ref().expect("a location");
    assert_eq!(at.file, "opdracht.typ");
    let line = src.lines().position(|l| l.contains("kleur: rood")).unwrap() + 1;
    assert_eq!(at.line, line, "{error:?}");
    assert_eq!(&src.as_bytes()[at.range[0]..at.range[1]], b"rood");
}

#[test]
fn the_editors_vragen_checks_are_reported() {
    let src = assets::BASE_ASSIGNMENT_TYP.replace(
        "#vraag(punten: 1, antwoord: [Antwoord op de tweede vraag.])",
        "#vraag(punten: 1)",
    );
    let tmp = opdracht(Some(&src));
    let report = check_dir(tmp.path(), RenderOptions::default());
    assert!(report.ok);
    assert_eq!(report.checks, ["Vraag 1b heeft geen antwoord."]);
}

#[test]
fn nothing_outside_the_opdracht_folder_is_readable() {
    let outer = TempDir::new().unwrap();
    fs::write(outer.path().join("leerlingen.json"), "[]").unwrap();
    let dir = outer.path().join("opdracht");
    fs::create_dir(&dir).unwrap();
    fs::write(dir.join("main.typ"), r#"#read("../leerlingen.json")"#).unwrap();
    let report = check_dir(&dir, RenderOptions::default());
    assert!(!report.ok);
    assert_eq!(report.errors(), 1, "{:?}", report.diagnostics);
}

#[test]
fn render_writes_a_pdf_in_both_modes() {
    let tmp = opdracht(None);
    let a = Assignment::open(tmp.path()).unwrap();
    for options in [
        RenderOptions::default(),
        RenderOptions {
            mode: Mode::Answers,
            include_answers: true,
        },
        RenderOptions {
            mode: Mode::Student,
            include_answers: false,
        },
    ] {
        let pdf = render_pdf(&a, options, fonts(), now()).unwrap();
        assert!(pdf.output.starts_with(b"%PDF-"), "{options:?}");
    }
    let answers = check(
        &a,
        RenderOptions {
            mode: Mode::Answers,
            include_answers: true,
        },
        fonts(),
        now(),
    );
    assert_eq!(answers.page_count, Some(1), "the answer key alone");
    assert_eq!(
        answers.vragen.len(),
        4,
        "still found in the hidden opdracht"
    );
}

#[test]
fn export_lib_writes_a_folder_typst_and_tinymist_can_use() {
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path().join("maatwerk-lib");
    let written = export_lib(&dir, false).unwrap();
    assert_eq!(written.len(), export_files().len());
    for rel in [
        "lib.typ",
        "main.typ",
        "opdracht.typ",
        EXPORT_README,
        "packages/preview/zero/0.7.1/typst.toml",
        "packages/preview/cetz/0.3.4/LICENSE",
        "fonts/SourceSerif4-Regular.otf",
        "fonts/STIXTwoMath-Regular.otf",
    ] {
        assert!(dir.join(rel).is_file(), "{rel}");
    }
    // The exported folder is itself an opdracht that checks clean.
    let report = check_dir(&dir, RenderOptions::default());
    assert!(report.ok && report.checks.is_empty(), "{report:?}");

    assert!(
        export_lib(&dir, false).unwrap().is_empty(),
        "identical: nothing to do"
    );
    fs::write(dir.join("opdracht.typ"), "= Mijn opdracht").unwrap();
    let refused = export_lib(&dir, false).unwrap_err().to_string();
    assert!(refused.contains("opdracht.typ"), "{refused}");
    assert_eq!(
        fs::read_to_string(dir.join("opdracht.typ")).unwrap(),
        "= Mijn opdracht",
        "left alone"
    );
    assert_eq!(export_lib(&dir, true).unwrap(), ["opdracht.typ"]);
}

/// `docs/schemas/samples/assignment-check.sample.json` is the report of the starting opdracht
/// (`MAATWERK_UPDATE_GOLDEN=1` rewrites it) and must match the schema.
#[test]
fn the_check_json_matches_its_schema_and_sample() {
    let tmp = opdracht(Some(&assets::BASE_ASSIGNMENT_TYP.replace(
        "#vraag(punten: 1, antwoord: [Antwoord op de tweede vraag.])",
        "#vraag(antwoord: [Antwoord op de tweede vraag.])",
    )));
    let mut report = check_dir(tmp.path(), RenderOptions::default());
    report.root = "C:/opdrachten/voorbeeld".into();
    let mut json = serde_json::to_value(&report).unwrap();
    let docs = repo().join("docs/schemas");
    let schema: Value = serde_json::from_str(
        &fs::read_to_string(docs.join("assignment-check.schema.json")).unwrap(),
    )
    .unwrap();
    validate(&schema, &schema, &json, "$");

    let sample = docs.join("samples/assignment-check.sample.json");
    let text = serde_json::to_string_pretty(&json).unwrap() + "\n";
    if std::env::var_os("MAATWERK_UPDATE_GOLDEN").is_some() {
        fs::write(&sample, &text).unwrap();
    }
    let expected: Value = serde_json::from_str(&fs::read_to_string(&sample).unwrap()).unwrap();
    assert_eq!(json, expected, "regenerate with MAATWERK_UPDATE_GOLDEN=1");

    // A failed compile is valid too.
    let broken = opdracht(Some("#let render_uitleg() = [#foo]"));
    json = serde_json::to_value(check_dir(broken.path(), RenderOptions::default())).unwrap();
    validate(&schema, &schema, &json, "$");
}

/// The JSON Schema subset the check schema uses: `$ref` (to `#/$defs/...`), `type` (string or
/// list), `enum`, `const`, `properties`, `required`, `additionalProperties: false`, `items`,
/// `minimum`, `minItems`/`maxItems`.
fn validate(root: &Value, schema: &Value, value: &Value, at: &str) {
    if let Some(r) = schema.get("$ref").and_then(Value::as_str) {
        let name = r.strip_prefix("#/$defs/").expect("local $ref");
        return validate(root, &root["$defs"][name], value, at);
    }
    if let Some(types) = schema.get("type") {
        let types: Vec<&str> = match types {
            Value::String(t) => vec![t.as_str()],
            Value::Array(ts) => ts.iter().filter_map(Value::as_str).collect(),
            _ => panic!("bad type in schema at {at}"),
        };
        let matches = |t: &str| match t {
            "object" => value.is_object(),
            "array" => value.is_array(),
            "string" => value.is_string(),
            "boolean" => value.is_boolean(),
            "null" => value.is_null(),
            "number" => value.is_number(),
            "integer" => value.as_u64().is_some() || value.as_i64().is_some(),
            other => panic!("unknown type {other}"),
        };
        assert!(
            types.iter().any(|t| matches(t)),
            "{at}: {value} is not {types:?}"
        );
    }
    if let Some(options) = schema.get("enum").and_then(Value::as_array) {
        assert!(options.contains(value), "{at}: {value} not in {options:?}");
    }
    if let Some(c) = schema.get("const") {
        assert_eq!(value, c, "{at}");
    }
    if let (Some(min), Some(n)) = (
        schema.get("minimum").and_then(Value::as_f64),
        value.as_f64(),
    ) {
        assert!(n >= min, "{at}: {n} < {min}");
    }
    if let Value::Object(map) = value {
        let props = schema.get("properties").and_then(Value::as_object);
        for key in schema
            .get("required")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let key = key.as_str().unwrap();
            assert!(map.contains_key(key), "{at}: missing {key}");
        }
        for (key, v) in map {
            match props.and_then(|p| p.get(key)) {
                Some(s) => validate(root, s, v, &format!("{at}.{key}")),
                None => assert!(
                    schema.get("additionalProperties") != Some(&Value::Bool(false)),
                    "{at}: unexpected {key}"
                ),
            }
        }
    }
    if let Value::Array(items) = value {
        if let Some(n) = schema.get("minItems").and_then(Value::as_u64) {
            assert!(items.len() as u64 >= n, "{at}: too few items");
        }
        if let Some(n) = schema.get("maxItems").and_then(Value::as_u64) {
            assert!(items.len() as u64 <= n, "{at}: too many items");
        }
        if let Some(s) = schema.get("items") {
            for (i, v) in items.iter().enumerate() {
                validate(root, s, v, &format!("{at}[{i}]"));
            }
        }
    }
}

/// Every example in `docs/assignment-examples/` (the AI context points at them) compiles without
/// errors, warnings or checks, in both modes.
#[test]
fn the_documented_examples_check_clean() {
    let examples = repo().join("docs/assignment-examples");
    let mut seen = 0;
    for entry in fs::read_dir(&examples).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_none_or(|e| e != "typ") {
            continue;
        }
        seen += 1;
        let tmp = opdracht(Some(&fs::read_to_string(&path).unwrap()));
        let images = tmp.path().join("images");
        fs::create_dir(&images).unwrap();
        for img in fs::read_dir(examples.join("images")).unwrap() {
            let img = img.unwrap().path();
            fs::copy(&img, images.join(img.file_name().unwrap())).unwrap();
        }
        for options in [
            RenderOptions::default(),
            RenderOptions {
                mode: Mode::Answers,
                include_answers: true,
            },
        ] {
            let report = check_dir(tmp.path(), options);
            let name = path.file_name().unwrap().to_string_lossy();
            assert!(report.ok, "{name}: {:#?}", report.diagnostics);
            assert!(
                report.diagnostics.is_empty(),
                "{name}: {:#?}",
                report.diagnostics
            );
            assert!(report.checks.is_empty(), "{name}: {:?}", report.checks);
            assert!(!report.vragen.is_empty(), "{name}");
        }
    }
    assert_eq!(seen, 5);
}

/// The complete example in `docs/ai-context/assignment-authoring.md` section 7 checks clean.
#[test]
fn the_ai_context_example_checks_clean() {
    let doc = fs::read_to_string(repo().join("docs/ai-context/assignment-authoring.md")).unwrap();
    let section = &doc[doc.find("## 7. A complete example").unwrap()..];
    let start = section.find("```typst\n").unwrap() + "```typst\n".len();
    let src = &section[start..start + section[start..].find("```").unwrap()];
    let tmp = opdracht(Some(src));
    let report = check_dir(tmp.path(), RenderOptions::default());
    assert!(
        report.ok && report.diagnostics.is_empty(),
        "{:#?}",
        report.diagnostics
    );
    assert!(report.checks.is_empty(), "{:?}", report.checks);
    assert_eq!(report.total_punten, 4.5);
}
