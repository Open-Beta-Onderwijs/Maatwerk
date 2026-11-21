// SPDX-License-Identifier: AGPL-3.0-or-later

//! The bundled check command (decision 50): the CLI runs `.maatwerk/check` in the workspace,
//! a script that starts the Maatwerk program with [`CHECK_FLAG`] and the workspace folder. It
//! prints the check report (`docs/schemas/assignment-check.schema.json`) as JSON, under the
//! editor's compile time limit.

use std::path::Path;
use std::time::Duration;

use crate::assignment::{self, Assignment, RenderOptions, with_time_limit};
use crate::typst_svc::{FontStore, local_now};

/// The first argument that turns the Maatwerk program into the check command.
pub const CHECK_FLAG: &str = "--ai-check";

/// Exit codes of the check command.
pub const EXIT_OK: i32 = 0;
pub const EXIT_ERRORS: i32 = 1;
pub const EXIT_UNUSABLE: i32 = 2;
pub const EXIT_TIMEOUT: i32 = 3;

/// The check of the opdracht in `dir`: the JSON text to print and the exit code (0 compiles,
/// 1 errors, 2 not an opdracht folder, 3 time-out).
pub fn check_command(dir: &Path, limit: Duration) -> (String, i32) {
    let assignment = match Assignment::open(dir) {
        Ok(a) => a,
        Err(e) => return (message_json(&e.to_string()), EXIT_UNUSABLE),
    };
    let report = with_time_limit(limit, move || {
        assignment::check(
            &assignment,
            RenderOptions::default(),
            FontStore::shared(),
            local_now(),
        )
    });
    match report {
        Some(r) => {
            let code = if r.ok { EXIT_OK } else { EXIT_ERRORS };
            let json =
                serde_json::to_string_pretty(&r).unwrap_or_else(|e| message_json(&e.to_string()));
            (json, code)
        }
        None => (
            message_json(&format!(
                "Compiling took longer than {} s and was stopped. Look for an endless loop or a very large figure.",
                limit.as_secs()
            )),
            EXIT_TIMEOUT,
        ),
    }
}

fn message_json(message: &str) -> String {
    serde_json::json!({ "ok": false, "message": message }).to_string()
}

/// For `main`: when the arguments start with [`CHECK_FLAG`], runs the check (folder: the next
/// argument, else the working folder), prints it and returns the exit code.
pub fn main_from_args(args: &[String]) -> Option<i32> {
    if args.first().map(String::as_str) != Some(CHECK_FLAG) {
        return None;
    }
    let dir = args
        .get(1)
        .filter(|a| !a.starts_with('-'))
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let (json, code) = check_command(&dir, crate::typst_svc::DEFAULT_COMPILE_TIMEOUT);
    println!("{json}");
    Some(code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_a_folder_and_refuses_others() {
        let dir = tempfile::tempdir().unwrap();
        let (json, code) = check_command(dir.path(), Duration::from_secs(60));
        assert_eq!(code, EXIT_UNUSABLE);
        assert!(json.contains("\"ok\":false"));
        for (name, bytes) in crate::assignment::export_files() {
            let path = dir.path().join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, bytes).unwrap();
        }
        let (json, code) = check_command(dir.path(), Duration::from_secs(60));
        assert_eq!(code, EXIT_OK, "{json}");
        assert!(json.contains("maatwerk-assignment-check/1"));
        std::fs::write(dir.path().join("opdracht.typ"), "#let x = (").unwrap();
        let (_, code) = check_command(dir.path(), Duration::from_secs(60));
        assert_eq!(code, EXIT_ERRORS);
    }

    #[test]
    fn main_only_answers_to_the_flag() {
        assert_eq!(main_from_args(&["--other".into()]), None);
        assert_eq!(main_from_args(&[]), None);
    }

    #[test]
    fn a_slow_job_times_out() {
        let r = with_time_limit(Duration::from_millis(50), || {
            std::thread::sleep(Duration::from_secs(2));
            1
        });
        assert_eq!(r, None);
        assert_eq!(with_time_limit(Duration::from_secs(5), || 2), Some(2));
    }
}
