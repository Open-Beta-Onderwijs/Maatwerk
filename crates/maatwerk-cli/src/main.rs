// SPDX-License-Identifier: AGPL-3.0-or-later

//! Headless entry point. `typst compile` arrives in Step 5b; data subcommands in Steps 7-9.

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;

use maatwerk_core::paths::RelPath;
use maatwerk_core::typst_svc::{FontStore, TypstProject, compile_pdf, local_now, to_text};
use typst::foundations::{Dict, IntoValue};

const USAGE: &str = "\
usage: maatwerk-cli typst compile <file.typ> [--out <file.pdf>] [--input <key>=<value>]...
                                  [--ignore-system-fonts]
       maatwerk-cli --version

typst compile: compiles <file.typ> to PDF with Maatwerk's embedded packages and fonts. The
folder of <file.typ> is the project root; nothing outside it is readable. In an opdracht folder,
`--input maatwerk-data=<json>` sets the header and mode that main.typ reads.";

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
