// SPDX-License-Identifier: AGPL-3.0-or-later

//! A scripted stand-in for an AI CLI (decision 61): the tests of `maatwerk_core::ai` run it
//! instead of a real CLI, and a developer can point a provider's command at it.
//!
//! It ignores its arguments except `--fake-script <file>`; without that it reads the script
//! from `$MAATWERK_FAKE_AI_SCRIPT`, then from `.maatwerk/fake-ai.json` in the working folder.
//! A script is a JSON array of steps, run in order:
//!
//! - `{"out": "line"}` / `{"err": "line"}`: print a line to stdout / stderr. `{args}` in the line
//!   becomes the arguments as a JSON array, `{cwd}` the working folder.
//! - `{"write": "path", "content": "text"}`: write a file (relative to the working folder).
//! - `{"sleepMs": 100}`: wait.
//! - `{"child": 60000}`: start a copy of itself that sleeps that long (for the tree kill), and
//!   print its pid as `child <pid>`.
//! - `{"exit": 3}`: exit with that code (the default at the end is 0).

use std::path::PathBuf;
use std::process::{Command, ExitCode, Stdio};
use std::time::Duration;

use serde_json::Value;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let [flag, ms] = args.as_slice()
        && flag == "--fake-sleep"
    {
        std::thread::sleep(Duration::from_millis(ms.parse().unwrap_or(0)));
        return ExitCode::SUCCESS;
    }
    let script_path = args
        .iter()
        .position(|a| a == "--fake-script")
        .and_then(|i| args.get(i + 1))
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("MAATWERK_FAKE_AI_SCRIPT").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from(".maatwerk/fake-ai.json"));
    let script: Vec<Value> = match std::fs::read(&script_path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
    {
        Some(s) => s,
        None => {
            eprintln!("fake-ai: no script at {}", script_path.display());
            return ExitCode::from(2);
        }
    };
    let cwd = std::env::current_dir().unwrap_or_default();
    let fill = |s: &str| {
        s.replace("{args}", &Value::from(args.clone()).to_string())
            .replace("{cwd}", &cwd.to_string_lossy())
    };
    for step in script {
        if let Some(line) = step.get("out").and_then(Value::as_str) {
            println!("{}", fill(line));
        }
        if let Some(line) = step.get("err").and_then(Value::as_str) {
            eprintln!("{}", fill(line));
        }
        if let Some(path) = step.get("write").and_then(Value::as_str) {
            let content = step
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let path = cwd.join(path);
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Err(e) = std::fs::write(&path, content) {
                eprintln!("fake-ai: write {}: {e}", path.display());
            }
        }
        if let Some(ms) = step.get("sleepMs").and_then(Value::as_u64) {
            std::thread::sleep(Duration::from_millis(ms));
        }
        if let Some(ms) = step.get("child").and_then(Value::as_u64) {
            let me = std::env::current_exe().unwrap_or_default();
            match Command::new(me)
                .args(["--fake-sleep", &ms.to_string()])
                .stdin(Stdio::null())
                .spawn()
            {
                Ok(child) => println!("child {}", child.id()),
                Err(e) => eprintln!("fake-ai: child: {e}"),
            }
        }
        if let Some(code) = step.get("exit").and_then(Value::as_u64) {
            return ExitCode::from(u8::try_from(code).unwrap_or(1));
        }
    }
    ExitCode::SUCCESS
}
