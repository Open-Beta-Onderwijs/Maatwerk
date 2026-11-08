// SPDX-License-Identifier: AGPL-3.0-or-later

//! `maatwerk-cli admin reset-pin` end to end.

use std::fs;
use std::process::Command;

#[test]
fn reset_pin_clears_the_admin_pin_and_codes_only() {
    let tmp = tempfile::tempdir().unwrap();
    let data = tmp.path().join("data");
    fs::create_dir_all(data.join("gebruikers")).unwrap();
    fs::write(data.join("config.json"), r#"{"schema_version":3}"#).unwrap();
    fs::write(
        data.join("gebruikers/admin.json"),
        r#"{"id":"admin","isAdmin":true,"pinHash":"$argon2id$x","recoveryCodeHashes":["a"]}"#,
    )
    .unwrap();
    fs::write(
        data.join("gebruikers/gebr-1.json"),
        r#"{"id":"gebr-1","isAdmin":false,"pinHash":"$argon2id$y"}"#,
    )
    .unwrap();

    let out = Command::new(env!("CARGO_BIN_EXE_maatwerk-cli"))
        .args(["admin", "reset-pin"])
        .arg(&data)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(String::from_utf8_lossy(&out.stdout).contains("admin"));

    let admin = fs::read_to_string(data.join("gebruikers/admin.json")).unwrap();
    assert!(
        !admin.contains("pinHash") && !admin.contains("recoveryCodeHashes"),
        "{admin}"
    );
    let teacher = fs::read_to_string(data.join("gebruikers/gebr-1.json")).unwrap();
    assert!(teacher.contains("pinHash"));
}
