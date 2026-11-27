// SPDX-License-Identifier: AGPL-3.0-or-later

//! Files a turn writes besides the context: the check scripts and the per-CLI config.

use super::*;

/// `.maatwerk/check` (sh) and `.maatwerk/check.cmd`: run Maatwerk's check on the workspace.
pub(super) fn write_check_scripts(workdir: &Path, meta: &Path, program: &Path) -> Result<()> {
    let flag = crate::ai::check::CHECK_FLAG;
    // Git Bash (Claude Code's shell on Windows) takes `C:/...`; backslashes would be escapes.
    let sh_quote = |p: &Path| {
        let text = p.to_string_lossy();
        let text = if cfg!(windows) {
            text.replace('\\', "/")
        } else {
            text.into_owned()
        };
        format!("'{}'", text.replace('\'', "'\\''"))
    };
    let sh = format!(
        "#!/bin/sh\n# Maatwerk's check of this opdracht: prints JSON, \"ok\": true when it compiles.\nexec {} {flag} {}\n",
        sh_quote(program),
        sh_quote(workdir)
    );
    let cmd_quote = |p: &Path| format!("\"{}\"", p.to_string_lossy().replace('%', "%%"));
    let cmd = format!(
        // UTF-8 code page first: the file is UTF-8 and the paths may not be ASCII (review 32 m2).
        "@echo off\r\nchcp 65001 >nul\r\nrem Maatwerk's check of this opdracht: prints JSON, \"ok\": true when it compiles.\r\n{} {flag} {}\r\nexit /b %ERRORLEVEL%\r\n",
        cmd_quote(program),
        cmd_quote(workdir)
    );
    let check = workdir.join(CHECK_COMMAND);
    fs::create_dir_all(meta).map_err(io(meta))?;
    fs::write(&check, sh).map_err(io(&check))?;
    let check_cmd = workdir.join(format!("{CHECK_COMMAND}.cmd"));
    fs::write(&check_cmd, cmd).map_err(io(&check_cmd))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&check, fs::Permissions::from_mode(0o755)).map_err(io(&check))?;
    }
    Ok(())
}

/// Vibe's project config (read with `--trust`) and Gemini's policy file (ADR-0009 tables).
pub(super) fn write_provider_files(
    provider: &Resolved,
    workdir: &Path,
    run_dir: &Path,
) -> Result<()> {
    match provider.builtin {
        Some(Builtin::Vibe) => {
            let dir = workdir.join(".vibe");
            fs::create_dir_all(&dir).map_err(io(&dir))?;
            // No shell at all: its file tools can edit `.maatwerk/`, so a check script it may
            // run would be a way to any command (review 32 M1); Maatwerk checks after the turn.
            let shell = |tool: &str| format!("[tools.{tool}]\npermission = \"never\"\n\n");
            let config = format!(
                "# Written by Maatwerk before every message; changes here are lost.\noutside_workdir = \"deny\"\n\n[tools.web_search]\npermission = \"always\"\n\n[tools.web_fetch]\npermission = \"always\"\n\n{}{}{}",
                shell("bash"),
                shell("powershell"),
                shell("git_bash")
            );
            let path = dir.join("config.toml");
            fs::write(&path, config).map_err(io(&path))
        }
        Some(Builtin::Gemini) => {
            let policy = "# Written by Maatwerk (ADR-0009): web search only; Maatwerk runs the check.\n\
                 [[rule]]\ntoolName = [\"google_web_search\", \"web_fetch\"]\ndecision = \"allow\"\npriority = 900\n\n\
                 [[rule]]\ntoolName = \"run_shell_command\"\ndecision = \"deny\"\npriority = 800\n";
            let path = run_dir.join("gemini-policy.toml");
            fs::write(&path, policy).map_err(io(&path))
        }
        _ => Ok(()),
    }
}
