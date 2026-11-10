// SPDX-License-Identifier: AGPL-3.0-or-later

//! Headless entry point: `typst compile` (Step 5b), `validate-data` and `migrate` (Step 7a),
//! `admin reset-pin` (Step 7b), `assignment check | render | export-lib` (Step 9), `stats` (Step 19).

mod assignment;
mod data;
mod rubric;
mod stats;

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;

use maatwerk_core::paths::RelPath;
use maatwerk_core::typst_svc::{FontStore, TypstProject, compile_pdf, local_now, to_text};
use typst::foundations::{Dict, IntoValue};

const USAGE: &str = "\
usage: maatwerk-cli typst compile <file.typ> [--out <file.pdf>] [--input <key>=<value>]...
                                  [--ignore-system-fonts]
       maatwerk-cli validate-data <data-folder> [--json]
       maatwerk-cli migrate <data-folder> (--dry-run | --apply --backup-dir <dir>) [--json] [-v]
       maatwerk-cli admin reset-pin <data-folder>
       maatwerk-cli stats <data-folder> --year <school-year> --vak <vak> [--json]
       maatwerk-cli rubric check <rubric.json | data-folder> [--json]
       maatwerk-cli assignment check <opdracht> [--json] [--answers] [--ignore-system-fonts]
       maatwerk-cli assignment render <opdracht> --pdf <file.pdf> [--answers | --no-answers]
                                     [--ignore-system-fonts]
       maatwerk-cli assignment export-lib <dir> [--overwrite]
       maatwerk-cli --version

typst compile: compiles <file.typ> to PDF with Maatwerk's embedded packages and fonts. The
folder of <file.typ> is the project root; nothing outside it is readable. In an opdracht folder,
`--input maatwerk-data=<json>` sets the header and mode that main.typ reads.

validate-data: checks a data folder (format v3) and lists errors and warnings; exit code 1 when
there are errors. Files Maatwerk does not use (leftovers) are warnings; nothing is removed.

migrate: converts a v1 or v2 data folder to v3 (docs/reference/data-files-v3.md). --dry-run
lists what would change, with the observaties each inhaal and herkansing gets. --apply first zips the whole folder into --backup-dir, which must be outside the
data folder, the shared folder and OneDrive, then migrates and validates. Nobody may have
Maatwerk open on the folder meanwhile (docs/cutover-runbook.md).

admin reset-pin: removes the admin's PIN and recovery codes; the next admin login sets a new PIN
and gets new codes. Last resort when both are lost (docs/cutover-runbook.md).

stats: prints the numbers of one school year and vak, for checking them by hand: per test the
mean, SD and % onvoldoende, per student (by number) the year average, SE average and trend. Reads
only (docs/phase-2/step-19-grade-rules.md).

rubric check: checks the levels of one rubric file, or of every rubric in a data folder (with
the number of PO's that use it): 2-5 levels per category, whole points, no two levels with the
same minimum or maximum, every score from 0 to the max covered. Exit code 1 when one is invalid,
2 when the target cannot be read. Reads only.

assignment: works on one opdracht folder (main.typ, opdracht.typ, lib.typ, images/) and reads
nothing outside it (docs/assignment-format.md). <opdracht> is the folder, or a .typ file in it
(opdracht.typ means the main.typ next to it); any other folder is refused. No student data is used: the header is main.typ's
placeholder.
  check: compiles and lists errors and warnings with file:line:column, the page count, the vragen
  with punten and answers, and the editor's checks. --json prints
  docs/schemas/assignment-check.schema.json. Exit code 1 when it does not compile, 2 when the
  opdracht cannot be opened.
  render: writes the PDF to --pdf (--answers: the answer key). --no-answers leaves out the
  upside-down answers at the bottom.
  export-lib: writes lib.typ, main.typ, a starting opdracht.typ, the embedded packages and fonts
  into <dir> for an external editor such as tinymist (see LEESMIJ.txt there). Files that exist
  with other content stop the export unless --overwrite.";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    match args.as_slice() {
        ["--version"] => {
            println!("maatwerk-cli {}", maatwerk_core::VERSION);
            ExitCode::SUCCESS
        }
        ["typst", "compile", rest @ ..] => match CompileArgs::parse(rest) {
            Ok(compile) => compile.run(),
            Err(message) => usage_error(&message),
        },
        ["validate-data", rest @ ..] => match data::ValidateArgs::parse(rest) {
            Ok(args) => args.run(),
            Err(message) => usage_error(&message),
        },
        ["migrate", rest @ ..] => match data::MigrateArgs::parse(rest) {
            Ok(args) => args.run(),
            Err(message) => usage_error(&message),
        },
        ["assignment", "check", rest @ ..] => match assignment::CheckArgs::parse(rest) {
            Ok(args) => args.run(),
            Err(message) => usage_error(&message),
        },
        ["assignment", "render", rest @ ..] => match assignment::RenderArgs::parse(rest) {
            Ok(args) => args.run(),
            Err(message) => usage_error(&message),
        },
        ["assignment", "export-lib", rest @ ..] => match assignment::ExportLibArgs::parse(rest) {
            Ok(args) => args.run(),
            Err(message) => usage_error(&message),
        },
        ["admin", "reset-pin", rest @ ..] => match data::ResetPinArgs::parse(rest) {
            Ok(args) => args.run(),
            Err(message) => usage_error(&message),
        },
        ["rubric", "check", rest @ ..] => match rubric::CheckArgs::parse(rest) {
            Ok(args) => args.run(),
            Err(message) => usage_error(&message),
        },
        ["stats", rest @ ..] => match stats::StatsArgs::parse(rest) {
            Ok(args) => args.run(),
            Err(message) => usage_error(&message),
        },
        ["--help" | "-h"] => {
            println!("{USAGE}");
            ExitCode::SUCCESS
        }
        _ => usage_error("unknown command"),
    }
}

fn usage_error(message: &str) -> ExitCode {
    eprintln!("error: {message}\n\n{USAGE}");
    ExitCode::from(2)
}

#[derive(Debug, PartialEq)]
struct CompileArgs {
    file: PathBuf,
    out: Option<PathBuf>,
    inputs: Vec<(String, String)>,
    system_fonts: bool,
}

impl CompileArgs {
    fn parse(args: &[&str]) -> Result<CompileArgs, String> {
        let mut file = None;
        let mut out = None;
        let mut inputs = Vec::new();
        let mut system_fonts = true;
        let mut it = args.iter();
        while let Some(&arg) = it.next() {
            match arg {
                "--out" | "-o" => {
                    out = Some(PathBuf::from(it.next().ok_or("--out needs a file")?));
                }
                "--input" => {
                    let pair = it.next().ok_or("--input needs <key>=<value>")?;
                    let (key, value) = pair.split_once('=').ok_or("--input needs <key>=<value>")?;
                    inputs.push((key.to_owned(), value.to_owned()));
                }
                "--ignore-system-fonts" => system_fonts = false,
                flag if flag.starts_with('-') => return Err(format!("unknown option {flag}")),
                path if file.is_none() => file = Some(PathBuf::from(path)),
                extra => return Err(format!("unexpected argument {extra}")),
            }
        }
        Ok(CompileArgs {
            file: file.ok_or("missing <file.typ>")?,
            out,
            inputs,
            system_fonts,
        })
    }

    fn run(self) -> ExitCode {
        let (root, entry) = match split_entry(&self.file) {
            Ok(split) => split,
            Err(message) => {
                eprintln!("error: {message}");
                return ExitCode::FAILURE;
            }
        };
        let out = self
            .out
            .clone()
            .unwrap_or_else(|| self.file.with_extension("pdf"));
        let mut project = TypstProject::folder(root, &entry);
        if !self.inputs.is_empty() {
            let mut dict = Dict::new();
            for (key, value) in self.inputs {
                dict.insert(key.as_str().into(), value.into_value());
            }
            project = project.with_inputs(dict);
        }
        let fonts = if self.system_fonts {
            FontStore::shared()
        } else {
            Arc::new(FontStore::new(false))
        };
        match compile_pdf(&project.world(fonts, local_now())) {
            Ok(compiled) => {
                if !compiled.warnings.is_empty() {
                    eprint!("{}", to_text(&compiled.warnings));
                }
                if let Err(e) = std::fs::write(&out, compiled.output) {
                    eprintln!("error: cannot write {}: {e}", out.display());
                    return ExitCode::FAILURE;
                }
                ExitCode::SUCCESS
            }
            Err(e) => {
                eprint!("{}", e.to_text());
                ExitCode::FAILURE
            }
        }
    }
}

/// The folder of `file` (the project root) and its name as the entry.
fn split_entry(file: &Path) -> Result<(PathBuf, RelPath), String> {
    let real = file
        .canonicalize()
        .map_err(|e| format!("cannot open {}: {e}", file.display()))?;
    let root = real.parent().ok_or("the file has no folder")?.to_path_buf();
    let name = real
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("the file name is not valid UTF-8")?;
    let entry = RelPath::parse(name).map_err(|e| e.to_string())?;
    Ok((root, entry))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_compile_arguments() {
        let args = CompileArgs::parse(&[
            "main.typ",
            "--out",
            "x.pdf",
            "--input",
            "a=b=c",
            "--ignore-system-fonts",
        ])
        .unwrap();
        assert_eq!(
            args,
            CompileArgs {
                file: "main.typ".into(),
                out: Some("x.pdf".into()),
                inputs: vec![("a".into(), "b=c".into())],
                system_fonts: false,
            }
        );
        assert!(CompileArgs::parse(&[]).is_err());
        assert!(CompileArgs::parse(&["a.typ", "b.typ"]).is_err());
        assert!(CompileArgs::parse(&["a.typ", "--input", "novalue"]).is_err());
        assert!(CompileArgs::parse(&["a.typ", "--root", "x"]).is_err());
    }
}
