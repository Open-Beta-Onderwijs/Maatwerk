// SPDX-License-Identifier: AGPL-3.0-or-later

//! `assignment check | render | export-lib` (PLAN Step 9): thin wrappers around
//! `maatwerk_core::assignment`, which works on one opdracht folder and sees nothing else.

use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Arc;

use maatwerk_core::assignment::{self, Assignment, CheckReport, RenderOptions};
use maatwerk_core::paths::display_path;
use maatwerk_core::typst_svc::{FontStore, Mode, local_now, to_text};

/// Options shared by `check` and `render`.
#[derive(Debug, PartialEq)]
struct Common {
    path: PathBuf,
    options: RenderOptions,
    system_fonts: bool,
}

impl Common {
    /// Takes the shared flags out of `args`; the rest is returned for the subcommand.
    fn parse<'a>(args: &[&'a str]) -> Result<(Common, Vec<&'a str>), String> {
        let mut path = None;
        let mut options = RenderOptions::default();
        let mut system_fonts = true;
        let mut rest = Vec::new();
        let mut it = args.iter();
        while let Some(&arg) = it.next() {
            match arg {
                "--answers" => options.mode = Mode::Answers,
                "--no-answers" => options.include_answers = false,
                "--ignore-system-fonts" => system_fonts = false,
                "--pdf" | "--out" | "-o" => {
                    rest.push(arg);
                    rest.push(it.next().ok_or(format!("{arg} needs a file"))?);
                }
                flag if flag.starts_with('-') => rest.push(flag),
                p if path.is_none() => path = Some(PathBuf::from(p)),
                extra => return Err(format!("unexpected argument {extra}")),
            }
        }
        if options.mode == Mode::Answers && !options.include_answers {
            return Err("--answers and --no-answers do not go together".into());
        }
        let common = Common {
            path: path.ok_or("missing <opdracht folder or file.typ>")?,
            options,
            system_fonts,
        };
        Ok((common, rest))
    }

    fn fonts(&self) -> Arc<FontStore> {
        if self.system_fonts {
            FontStore::shared()
        } else {
            Arc::new(FontStore::new(false))
        }
    }

    fn open(&self) -> Result<Assignment, ExitCode> {
        Assignment::open(&self.path).map_err(|e| {
            eprintln!("error ({}): {e}", e.code());
            ExitCode::FAILURE
        })
    }
}

/// `assignment check <path> [--json] [--answers] [--ignore-system-fonts]`.
#[derive(Debug, PartialEq)]
pub struct CheckArgs {
    common: Common,
    json: bool,
}

impl CheckArgs {
    pub fn parse(args: &[&str]) -> Result<CheckArgs, String> {
        let (common, rest) = Common::parse(args)?;
        let mut json = false;
        for arg in rest {
            match arg {
                "--json" => json = true,
                other => return Err(format!("unknown option {other}")),
            }
        }
        Ok(CheckArgs { common, json })
    }

    /// Exit code 1 when the opdracht does not compile (also with `--json`).
    pub fn run(self) -> ExitCode {
        let assignment = match self.common.open() {
            Ok(a) => a,
            Err(code) => return code,
        };
        let report = assignment::check(
            &assignment,
            self.common.options,
            self.common.fonts(),
            local_now(),
        );
        if self.json {
            println!(
                "{}",
                serde_json::to_string_pretty(&report).expect("serialisable")
            );
        } else {
            print_check(&report);
        }
        if report.ok {
            ExitCode::SUCCESS
        } else {
            ExitCode::FAILURE
        }
    }
}

fn print_check(r: &CheckReport) {
    for d in &r.diagnostics {
        let sev = match d.severity {
            maatwerk_core::typst_svc::Severity::Error => "error",
            maatwerk_core::typst_svc::Severity::Warning => "warning",
        };
        match &d.location {
            Some(l) => println!("{sev}: {}:{}:{}: {}", l.file, l.line, l.column, d.message),
            None => println!("{sev}: {}", d.message),
        }
        for h in &d.hints {
            println!("  hint: {h}");
        }
    }
    let Some(pages) = r.page_count else {
        println!("{}: does not compile", r.entry);
        return;
    };
    println!(
        "{}: {pages} page(s), {} vraag/vragen, {} punten",
        r.entry,
        r.vragen.len(),
        r.total_punten.to_string().replace('.', ",")
    );
    for v in &r.vragen {
        let punten = v
            .punten
            .map_or("-".to_owned(), |p| p.to_string().replace('.', ","));
        println!(
            "  {:<4} {punten:>4}p  p.{}  {}",
            v.label,
            v.page,
            v.antwoord.as_deref().unwrap_or("(geen antwoord)")
        );
    }
    for c in &r.checks {
        println!("check: {c}");
    }
}

/// `assignment render <path> --pdf <out.pdf> [--answers | --no-answers]`.
#[derive(Debug, PartialEq)]
pub struct RenderArgs {
    common: Common,
    out: Option<PathBuf>,
}

impl RenderArgs {
    pub fn parse(args: &[&str]) -> Result<RenderArgs, String> {
        let (common, rest) = Common::parse(args)?;
        let mut out = None;
        let mut it = rest.into_iter();
        while let Some(arg) = it.next() {
            match arg {
                "--pdf" | "--out" | "-o" => out = it.next().map(PathBuf::from),
                other => return Err(format!("unknown option {other}")),
            }
        }
        Ok(RenderArgs { common, out })
    }

    pub fn run(self) -> ExitCode {
        let assignment = match self.common.open() {
            Ok(a) => a,
            Err(code) => return code,
        };
        let out = self.out.clone().unwrap_or_else(|| {
            let name = if self.common.options.mode == Mode::Answers {
                "antwoorden.pdf"
            } else {
                "opdracht.pdf"
            };
            assignment.root().join(name)
        });
        match assignment::render_pdf(
            &assignment,
            self.common.options,
            self.common.fonts(),
            local_now(),
        ) {
            Ok(compiled) => {
                if !compiled.warnings.is_empty() {
                    eprint!("{}", to_text(&compiled.warnings));
                }
                if let Err(e) = std::fs::write(&out, compiled.output) {
                    eprintln!("error: cannot write {}: {e}", out.display());
                    return ExitCode::FAILURE;
                }
                println!("{}", display_path(&out));
                ExitCode::SUCCESS
            }
            Err(e) => {
                eprint!("{}", e.to_text());
                ExitCode::FAILURE
            }
        }
    }
}

/// `assignment export-lib <dir> [--overwrite]`.
#[derive(Debug, PartialEq)]
pub struct ExportLibArgs {
    dir: PathBuf,
    overwrite: bool,
}

impl ExportLibArgs {
    pub fn parse(args: &[&str]) -> Result<ExportLibArgs, String> {
        let mut dir = None;
        let mut overwrite = false;
        for &arg in args {
            match arg {
                "--overwrite" => overwrite = true,
                flag if flag.starts_with('-') => return Err(format!("unknown option {flag}")),
                d if dir.is_none() => dir = Some(PathBuf::from(d)),
                extra => return Err(format!("unexpected argument {extra}")),
            }
        }
        Ok(ExportLibArgs {
            dir: dir.ok_or("missing <dir>")?,
            overwrite,
        })
    }

    pub fn run(self) -> ExitCode {
        match assignment::export_lib(&self.dir, self.overwrite) {
            Ok(written) => {
                println!(
                    "{} file(s) written to {} (see {}).",
                    written.len(),
                    display_path(&self.dir),
                    assignment::EXPORT_README
                );
                ExitCode::SUCCESS
            }
            Err(e) => {
                eprintln!("error ({}): {e}", e.code());
                ExitCode::FAILURE
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_check_render_and_export_arguments() {
        let c = CheckArgs::parse(&["op", "--json", "--answers", "--ignore-system-fonts"]).unwrap();
        assert!(c.json);
        assert_eq!(c.common.path, PathBuf::from("op"));
        assert_eq!(c.common.options.mode, Mode::Answers);
        assert!(!c.common.system_fonts);
        assert!(CheckArgs::parse(&[]).is_err());
        assert!(CheckArgs::parse(&["op", "--pdf", "x.pdf"]).is_err());
        assert!(CheckArgs::parse(&["op", "--answers", "--no-answers"]).is_err());

        let r = RenderArgs::parse(&["op/main.typ", "--pdf", "o.pdf", "--no-answers"]).unwrap();
        assert_eq!(r.out, Some(PathBuf::from("o.pdf")));
        assert!(!r.common.options.include_answers);
        assert!(RenderArgs::parse(&["op", "--pdf"]).is_err());
        assert!(RenderArgs::parse(&["op", "--json"]).is_err());

        let e = ExportLibArgs::parse(&["d", "--overwrite"]).unwrap();
        assert_eq!((e.dir, e.overwrite), (PathBuf::from("d"), true));
        assert!(ExportLibArgs::parse(&["a", "b"]).is_err());
    }
}
