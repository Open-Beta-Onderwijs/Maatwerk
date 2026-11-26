// SPDX-License-Identifier: AGPL-3.0-or-later

use super::*;

#[test]
fn split_args_handles_quotes_and_escapes() {
    assert_eq!(
        split_args(r#"-p {prompt} "Edit(./a b)" 'x"y' a\ b """#).unwrap(),
        ["-p", "{prompt}", "Edit(./a b)", "x\"y", "a b", ""]
    );
    assert!(split_args("\"open").is_err());
    assert!(split_args("'open").is_err());
    assert_eq!(split_args("  ").unwrap(), Vec::<String>::new());
}

fn values() -> Placeholders {
    Placeholders {
        workdir: PathBuf::from("/w"),
        run: PathBuf::from("/r"),
        session: Some("s-1".into()),
        images: vec![PathBuf::from("/w/a.png"), PathBuf::from("/w/b.png")],
        image_flag: Some("-i".into()),
        time_limit: Duration::from_secs(300),
    }
}

#[test]
fn placeholders_expand_inside_tokens_and_images_repeat() {
    let v = values();
    assert_eq!(
        v.expand("x \"Bash({check} *)\" {images} --t {secs} --s={session} {X}y {")
            .unwrap(),
        [
            "x",
            "Bash(.maatwerk/check *)",
            "-i",
            "/w/a.png",
            "-i",
            "/w/b.png",
            "--t",
            "300",
            "--s=s-1",
            "{X}y",
            "{"
        ]
    );
    let none = Placeholders {
        images: vec![],
        session: None,
        ..v
    };
    assert_eq!(none.expand("a {images} b").unwrap(), ["a", "b"]);
    assert!(none.expand("--resume {session}").is_err());
    assert!(none.expand("{nope}").is_err());
}

#[test]
fn every_preset_expands_and_validates() {
    let v = values();
    for p in presets() {
        validate_args(p.args).unwrap();
        validate_args(p.args_next).unwrap();
        let first = v.expand(p.args).unwrap();
        assert!(first.iter().all(|a| !a.contains('{')), "{first:?}");
        let next = v.expand(p.args_next).unwrap();
        // A resume names the session; a fresh Maatwerk session does too.
        assert!(
            next.iter().any(|a| a.contains("s-1")),
            "{} {next:?}",
            p.name
        );
    }
    assert!(validate_args("{images}x").is_err());
    assert!(validate_args("{bogus}").is_err());
}

#[test]
fn provider_keys() {
    assert_eq!(
        ProviderKey::parse("claude").unwrap().as_builtin(),
        Some(Builtin::Claude)
    );
    assert_eq!(
        ProviderKey::parse("antigravity").unwrap().as_builtin(),
        Some(Builtin::Antigravity)
    );
    assert!(
        ProviderKey::parse("custom-my-cli2")
            .unwrap()
            .as_builtin()
            .is_none()
    );
    for bad in ["", "custom-", "custom-A", "deepseek", "custom-../x"] {
        assert!(ProviderKey::parse(bad).is_err(), "{bad}");
    }
}

#[test]
fn settings_round_trip_overrides_and_custom() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("ai/settings.json");
    assert_eq!(AiSettings::load(&path), AiSettings::default());
    let mut s = AiSettings {
        time_limit_minutes: 7,
        ..AiSettings::default()
    };
    s.overrides.insert(
        Builtin::Claude,
        ProviderOverride {
            command: Some("C:\\tools\\claude.exe".into()),
            ..Default::default()
        },
    );
    s.custom.push(CustomCli {
        key: ProviderKey::parse("custom-aider").unwrap(),
        name: "Aider".into(),
        command: "aider".into(),
        args: "--message-file {request} --yes".into(),
        args_next: String::new(),
    });
    s.other.insert("future".into(), serde_json::json!(1));
    s.save(&path).unwrap();
    let back = AiSettings::load(&path);
    assert_eq!(back, s);
    let claude = back
        .resolve(&ProviderKey::builtin(Builtin::Claude))
        .unwrap();
    assert_eq!(claude.command, "C:\\tools\\claude.exe");
    assert_eq!(claude.args, preset(Builtin::Claude).args);
    let aider = back
        .resolve(&ProviderKey::parse("custom-aider").unwrap())
        .unwrap();
    assert_eq!(aider.format, StreamFormat::Text);
    assert!(!aider.runs_check);
    assert_eq!(back.resolved().len(), 7);
    assert_eq!(back.time_limit(), Duration::from_secs(420));
}

#[test]
fn settings_validation() {
    let mut s = AiSettings {
        time_limit_minutes: 31,
        ..AiSettings::default()
    };
    assert!(s.validate().is_err());
    s.time_limit_minutes = 30;
    s.validate().unwrap();
    s.custom.push(CustomCli {
        key: ProviderKey::parse("custom-x").unwrap(),
        name: " ".into(),
        command: "x".into(),
        args: String::new(),
        args_next: String::new(),
    });
    assert!(s.validate().is_err());
    s.custom[0].name = "X".into();
    s.custom[0].args = "{nope}".into();
    assert!(s.validate().is_err());
    s.custom[0].args = "{prompt}".into();
    s.validate().unwrap();
    s.custom.push(s.custom[0].clone());
    assert!(s.validate().is_err());
}

#[test]
fn login_status_from_json_or_exit_code() {
    assert!(logged_in(
        true,
        r#"{ "loggedIn": true, "authMethod": "claude.ai" }"#
    ));
    assert!(!logged_in(true, r#"{"loggedIn":false}"#));
    assert!(!logged_in(false, r#"{"loggedIn":true}"#));
    assert!(logged_in(true, "Logged in using ChatGPT"));
    assert!(!logged_in(false, "Not logged in"));
    assert!(logged_in(true, "[1, 2]"));
}
