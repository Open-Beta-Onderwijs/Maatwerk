// SPDX-License-Identifier: AGPL-3.0-or-later

use super::*;
use crate::ai::provider::{AiSettings, ProviderKey};
use std::sync::atomic::AtomicBool;
use std::time::Instant;

static NO_STOP: AtomicBool = AtomicBool::new(false);

/// [`prepare`] without Stop and with an hour to go.
fn prep(
    workdir: &Path,
    run_dir: &Path,
    provider: &Resolved,
    resumes: bool,
    input: &TurnInput,
) -> Result<Prepared> {
    let guard = Guard {
        stop: &NO_STOP,
        deadline: Instant::now() + Duration::from_secs(3600),
    };
    prepare(workdir, run_dir, provider, resumes, input, &guard)
}

/// An opdracht folder with the template files, a 40x20 PNG and an SVG.
pub(crate) fn opdracht_folder(dir: &Path) {
    for (name, bytes) in crate::assignment::export_files() {
        if OPDRACHT_FILES.contains(&name.as_str()) {
            fs::write(dir.join(&name), bytes).unwrap();
        }
    }
    let images = dir.join("images");
    fs::create_dir_all(&images).unwrap();
    image::RgbImage::from_pixel(40, 20, image::Rgb([255, 0, 0]))
        .save(images.join("rood.png"))
        .unwrap();
    fs::write(
        images.join("kring.svg"),
        "<?xml version=\"1.0\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"120\" height=\"60\" viewBox=\"0 0 120 60\"><circle r=\"5\"/></svg>",
    )
    .unwrap();
    fs::write(images.join("notes.txt"), "not an image").unwrap();
}

/// The template opdracht with a marker line.
pub(crate) fn buffer() -> String {
    format!("{}\n// buffer\n", crate::assets::BASE_ASSIGNMENT_TYP)
}

pub(crate) fn input(dir: &Path) -> TurnInput {
    TurnInput {
        opdracht_dir: dir.to_path_buf(),
        buffers: BTreeMap::from([("opdracht.typ".into(), buffer())]),
        message: "Voeg een opgave toe over dichtheid.".into(),
        starter: None,
        context: ContextChoice::default(),
        attachments: Vec::new(),
        past: Vec::new(),
        check_program: PathBuf::from("/opt/maatwerk/maatwerk"),
    }
}

fn provider(key: &str) -> Resolved {
    AiSettings::default()
        .resolve(&ProviderKey::parse(key).unwrap())
        .unwrap()
}

#[test]
fn copies_buffers_and_placeholder_images() {
    let src = tempfile::tempdir().unwrap();
    opdracht_folder(src.path());
    let ws = tempfile::tempdir().unwrap();
    let (work, run) = (ws.path().join("w"), ws.path().join("w.run"));
    let p = prep(&work, &run, &provider("claude"), false, &input(src.path())).unwrap();
    assert_eq!(
        fs::read_to_string(work.join("opdracht.typ")).unwrap(),
        buffer()
    );
    assert_eq!(
        fs::read(work.join("lib.typ")).unwrap(),
        fs::read(src.path().join("lib.typ")).unwrap()
    );
    // Placeholders: same size and type, not the pixels.
    assert_eq!(
        image::image_dimensions(work.join("images/rood.png")).unwrap(),
        (40, 20)
    );
    let grey = image::open(work.join("images/rood.png")).unwrap().to_rgb8();
    assert_eq!(grey.get_pixel(0, 0), &image::Rgb([204, 204, 204]));
    let svg = fs::read_to_string(work.join("images/kring.svg")).unwrap();
    assert!(
        svg.contains("width=\"120\" height=\"60\" viewBox=\"0 0 120 60\""),
        "{svg}"
    );
    assert!(!svg.contains("circle"));
    assert!(!work.join("images/notes.txt").exists());
    let mut placeholders = p.baseline.placeholders.clone();
    placeholders.sort();
    assert_eq!(placeholders, ["images/kring.svg", "images/rood.png"]);
    assert_eq!(p.baseline.images.len(), 2);
    assert_eq!(p.baseline.files.len(), 3);
    assert_eq!(read_baseline(&run).unwrap(), p.baseline);
    // The placeholders compile.
    let (json, code) = crate::ai::check::check_command(&work, Duration::from_secs(60));
    assert_eq!(code, 0, "{json}");
    let request = fs::read_to_string(work.join(REQUEST_FILE)).unwrap();
    assert!(request.contains("grey placeholders"));
    assert!(request.contains("Voeg een opgave toe over dichtheid."));
    // Claude Code: the Bash form its permission rules allow, also on Windows (step 32c).
    assert!(request.contains("run the check with the Bash tool, exactly `.maatwerk/check`"));
    let other = tempfile::tempdir().unwrap();
    let (w2, r2) = (other.path().join("w"), other.path().join("r"));
    prep(&w2, &r2, &provider("codex"), false, &input(src.path())).unwrap();
    let codex = fs::read_to_string(w2.join(REQUEST_FILE)).unwrap();
    assert!(codex.contains("run the check `.maatwerk/check` (on Windows `.maatwerk\\check.cmd`)"));
    assert!(work.join(".maatwerk/check").is_file());
    let cmd = fs::read_to_string(work.join(".maatwerk/check.cmd")).unwrap();
    assert!(cmd.contains("--ai-check"));
}

#[test]
fn real_images_when_switched_on() {
    let src = tempfile::tempdir().unwrap();
    opdracht_folder(src.path());
    let ws = tempfile::tempdir().unwrap();
    let mut i = input(src.path());
    i.context.images = true;
    let p = prep(
        &ws.path().join("w"),
        &ws.path().join("r"),
        &provider("codex"),
        true,
        &i,
    )
    .unwrap();
    assert!(p.baseline.placeholders.is_empty());
    assert_eq!(
        fs::read(ws.path().join("w/images/rood.png")).unwrap(),
        fs::read(src.path().join("images/rood.png")).unwrap()
    );
}

#[test]
fn context_chips_attachments_and_request() {
    let src = tempfile::tempdir().unwrap();
    opdracht_folder(src.path());
    let syllabus = src.path().join("Syllabus nat havo 2026.pdf");
    fs::write(&syllabus, b"%PDF-1.4 fake").unwrap();
    let ws = tempfile::tempdir().unwrap();
    let mut i = input(src.path());
    i.starter = Some(Starter::CompleteAnswers);
    i.context = ContextChoice {
        guide: true,
        metadata: Some(serde_json::json!({"titel": "Dichtheid", "vak": "nat"})),
        diagnostics: true,
        pdf: true,
        syllabus: Some(syllabus),
        others: vec![OtherOpdracht {
            id: "opd-2".into(),
            title: "Druk".into(),
            text: "// druk".into(),
        }],
        images: false,
    };
    i.attachments = vec![
        Attachment {
            name: "Geplakte tekst".into(),
            path: None,
            text: Some("lange tekst".into()),
            bytes: None,
        },
        Attachment {
            name: "foto.png".into(),
            path: None,
            text: None,
            bytes: Some(vec![1, 2, 3]),
        },
    ];
    i.past = vec![
        PastMessage {
            from_teacher: true,
            text: "Eerste vraag".into(),
        },
        PastMessage {
            from_teacher: false,
            text: "Eerste antwoord".into(),
        },
    ];
    let work = ws.path().join("w");
    let p = prep(
        &work,
        &ws.path().join("r"),
        &provider("antigravity"),
        false,
        &i,
    )
    .unwrap();
    let ctx = work.join(".maatwerk/context");
    for f in [
        "assignment-authoring.md",
        "examples/01-basis.typ",
        "examples/images/stroomkring.svg",
        "opdracht.json",
        "diagnostics.json",
        "opdracht.pdf",
        "syllabus/Syllabus-nat-havo-2026.pdf",
        "other-opdrachten/opd-2.typ",
    ] {
        assert!(ctx.join(f).is_file(), "{f}");
    }
    let att = work.join(".maatwerk/attachments");
    assert_eq!(
        fs::read_to_string(att.join("Geplakte-tekst.txt")).unwrap(),
        "lange tekst"
    );
    assert_eq!(p.image_args, [att.join("foto.png")]);
    let request = fs::read_to_string(work.join(REQUEST_FILE)).unwrap();
    for needle in [
        "Add the missing answers",
        "**Teacher:** Eerste vraag",
        "**You:** Eerste antwoord",
        "`.maatwerk/context/syllabus/Syllabus-nat-havo-2026.pdf`",
        "`.maatwerk/attachments/foto.png`",
        "Do not run commands",
    ] {
        assert!(request.contains(needle), "{needle}\n{request}");
    }
}

#[test]
fn limits_and_rebuild() {
    let src = tempfile::tempdir().unwrap();
    opdracht_folder(src.path());
    let ws = tempfile::tempdir().unwrap();
    let (work, run) = (ws.path().join("w"), ws.path().join("r"));
    let mut i = input(src.path());
    i.attachments = (0..11)
        .map(|n| Attachment {
            name: format!("a{n}.txt"),
            path: None,
            text: Some("x".into()),
            bytes: None,
        })
        .collect();
    assert!(prep(&work, &run, &provider("claude"), false, &i).is_err());
    i.attachments.clear();
    prep(&work, &run, &provider("claude"), false, &i).unwrap();
    fs::write(work.join("stray.txt"), "left by the AI").unwrap();
    prep(&work, &run, &provider("claude"), true, &i).unwrap();
    assert!(!work.join("stray.txt").exists(), "rebuilt per turn");
}

#[test]
fn provider_files() {
    let src = tempfile::tempdir().unwrap();
    opdracht_folder(src.path());
    let ws = tempfile::tempdir().unwrap();
    let i = input(src.path());
    let (work, run) = (ws.path().join("v"), ws.path().join("v.run"));
    prep(&work, &run, &provider("vibe"), false, &i).unwrap();
    let vibe = fs::read_to_string(work.join(".vibe/config.toml")).unwrap();
    assert!(vibe.contains("outside_workdir = \"deny\""));
    // No shell and no check script (review 32 M1): Maatwerk runs the check.
    assert!(vibe.contains("[tools.powershell]\npermission = \"never\""));
    assert!(!vibe.contains("allowlist"));
    assert!(!work.join(".maatwerk/check").exists());
    let request = fs::read_to_string(work.join(REQUEST_FILE)).unwrap();
    assert!(request.contains("Do not run commands"));
    let (work, run) = (ws.path().join("g"), ws.path().join("g.run"));
    prep(&work, &run, &provider("gemini"), false, &i).unwrap();
    let policy = fs::read_to_string(run.join("gemini-policy.toml")).unwrap();
    assert!(!policy.contains("commandPrefix"));
    assert!(policy.contains("toolName = \"run_shell_command\"\ndecision = \"deny\""));
    assert!(!work.join(".vibe").exists());
}

#[test]
fn layout_paths_and_forget() {
    let dir = tempfile::tempdir().unwrap();
    assert!(Layout::new(dir.path(), "../x").is_err());
    let l = Layout::new(dir.path(), "gebr-1").unwrap();
    let key = ProviderKey::parse("claude").unwrap();
    assert!(l.workdir("../evil", &key).is_err());
    let work = l.workdir("opd-1", &key).unwrap();
    assert!(work.ends_with("gebr-1/work/opd-1/claude"));
    fs::create_dir_all(&work).unwrap();
    let history = l.history_file("opd-1", &key).unwrap();
    fs::create_dir_all(history.parent().unwrap()).unwrap();
    fs::write(&history, "{}").unwrap();
    l.forget("opd-1", &key).unwrap();
    assert!(!work.exists() && !history.exists());
    l.forget("opd-1", &key).unwrap();
}

/// Review 32 m12 (ADR-0009 constraint 1): a workspace built inside a data folder that holds
/// students, exams and scores contains only the opdracht, the chosen context and Maatwerk's own
/// files, and no student data anywhere, with every chip but the images on.
#[test]
fn a_workspace_holds_no_school_data() {
    const NAME: &str = "Fleur Privacytest";
    let data = tempfile::tempdir().unwrap();
    let root = data.path();
    for (rel, text) in [
        (
            "leerlingen/2026-2027/leer-1.json",
            format!(r#"{{"naam":"{NAME}"}}"#),
        ),
        (
            "toetsen/2026-2027/nat/toets-1.json",
            r#"{"naam":"Toets geheim"}"#.into(),
        ),
        (
            "scores/2026-2027/nat/leer-1.json",
            format!(r#"{{"leerling":"{NAME}","score":7}}"#),
        ),
        (
            "opdrachten/opd-2/opdracht.typ",
            "// andere opdracht\n".into(),
        ),
    ] {
        let path = root.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }
    let opdracht = root.join("opdrachten/opd-1");
    fs::create_dir_all(&opdracht).unwrap();
    opdracht_folder(&opdracht);
    let mut i = input(&opdracht);
    i.context = ContextChoice {
        guide: true,
        metadata: Some(serde_json::json!({ "titel": "Dichtheid", "vakken": ["Natuurkunde"] })),
        diagnostics: true,
        pdf: true,
        syllabus: None,
        others: vec![OtherOpdracht {
            id: "opd-2".into(),
            title: "Andere".into(),
            text: "// andere opdracht\n".into(),
        }],
        images: false,
    };
    let ws = tempfile::tempdir().unwrap();
    for key in ["claude", "vibe", "gemini"] {
        let (work, run) = (ws.path().join(key), ws.path().join(format!("{key}.run")));
        prep(&work, &run, &provider(key), false, &i).unwrap();
        let mut files = Vec::new();
        let mut stack = vec![work.clone()];
        while let Some(dir) = stack.pop() {
            for e in fs::read_dir(&dir).unwrap().flatten() {
                let path = e.path();
                if path.is_dir() {
                    stack.push(path);
                } else {
                    files.push(path);
                }
            }
        }
        for f in &files {
            let rel = f
                .strip_prefix(&work)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            let allowed = ["opdracht.typ", "main.typ", "lib.typ"].contains(&rel.as_str())
                || rel.starts_with("images/")
                || rel.starts_with(".maatwerk/")
                || rel.starts_with(".vibe/")
                || rel.starts_with(".gemini/");
            assert!(allowed, "{key}: unexpected file {rel}");
            let bytes = fs::read(f).unwrap();
            let text = String::from_utf8_lossy(&bytes);
            assert!(!text.contains(NAME), "{key}: student name in {rel}");
            assert!(!text.contains("Toets geheim"), "{key}: exam in {rel}");
            assert!(
                !rel.contains("leerling") && !rel.contains("scores"),
                "{key}: {rel}"
            );
        }
        // The real images stay out without the Afbeeldingen chip.
        let png = fs::read(work.join("images/rood.png")).unwrap();
        assert_ne!(png, fs::read(opdracht.join("images/rood.png")).unwrap());
    }
}

/// Review 32 m1, m12: only a plain PDF name inside the syllabus folder.
#[test]
fn syllabus_names() {
    let dir = Path::new("/syllabus");
    assert_eq!(
        syllabus_file(dir, "Natuurkunde havo 2027.PDF").unwrap(),
        dir.join("Natuurkunde havo 2027.PDF")
    );
    for bad in [
        "../geheim.pdf",
        "sub/x.pdf",
        "sub\\x.pdf",
        "C:x.pdf",
        ".verborgen.pdf",
        "syllabus.docx",
        "",
    ] {
        assert!(syllabus_file(dir, bad).is_err(), "{bad}");
    }
}
