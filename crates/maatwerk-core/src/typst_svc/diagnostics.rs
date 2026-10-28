// SPDX-License-Identifier: AGPL-3.0-or-later

//! Structured Typst diagnostics (ADR-0002 5a), mapped to the file the user knows: a project or
//! template file by its name, a package file as `@preview/x:1.0.0/...`. No machine paths (quirk
//! T14). [`to_text`] renders them in the shape of the Typst CLI for screens that show plain text.

use serde::Serialize;
use typst::World;
use typst::diag::{Severity as TypstSeverity, SourceDiagnostic, Tracepoint};
use typst::syntax::Span;

use super::world::MaatwerkWorld;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
}

/// Where a diagnostic or trace frame points. `line`/`column` are 1-based (column in characters);
/// `range` is the byte range in the file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Location {
    pub file: String,
    pub line: usize,
    pub column: usize,
    pub range: (usize, usize),
    /// The source line, for [`to_text`].
    #[serde(skip)]
    line_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TraceFrame {
    pub message: String,
    pub location: Option<Location>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Diagnostic {
    pub severity: Severity,
    pub message: String,
    pub hints: Vec<String>,
    /// `None` for spans without a file (e.g. text that went through `eval`).
    pub location: Option<Location>,
    pub trace: Vec<TraceFrame>,
}

impl Diagnostic {
    /// An error without a source location (e.g. from the PDF exporter).
    pub fn error(message: impl Into<String>) -> Diagnostic {
        Diagnostic {
            severity: Severity::Error,
            message: message.into(),
            hints: Vec::new(),
            location: None,
            trace: Vec::new(),
        }
    }
}

pub(crate) fn convert(world: &MaatwerkWorld, diags: &[SourceDiagnostic]) -> Vec<Diagnostic> {
    diags
        .iter()
        .map(|d| Diagnostic {
            severity: match d.severity {
                TypstSeverity::Error => Severity::Error,
                TypstSeverity::Warning => Severity::Warning,
            },
            message: d.message.to_string(),
            hints: d.hints.iter().map(ToString::to_string).collect(),
            location: locate(world, d.span),
            trace: d
                .trace
                .iter()
                .map(|t| TraceFrame {
                    message: trace_message(&t.v),
                    location: locate(world, t.span),
                })
                .collect(),
        })
        .collect()
}

/// Same wording as the CLI ("error occurred in this call of function `x`").
fn trace_message(point: &Tracepoint) -> String {
    format!("error occurred {point}")
}

fn locate(world: &MaatwerkWorld, span: Span) -> Option<Location> {
    let id = span.id()?;
    let source = world.source(id).ok()?;
    let range = source.range(span)?;
    let lines = source.lines();
    let line = lines.byte_to_line(range.start)?;
    let line_range = lines.line_to_range(line)?;
    let line_text = source.text()[line_range]
        .trim_end_matches(['\r', '\n'])
        .to_owned();
    Some(Location {
        file: world.display_path(id),
        line: line + 1,
        column: lines.byte_to_column(range.start)? + 1,
        range: (range.start, range.end),
        line_text,
    })
}

/// Plain-text rendering like the Typst CLI's stderr, for screens that show the old error text:
///
/// ```text
/// error: unclosed delimiter
///    ┌─ opdracht.typ:12:3
///    │
/// 12 │   #vraag[
///    │   ^^^^^^^
/// ```
pub fn to_text(diags: &[Diagnostic]) -> String {
    let mut out = String::new();
    for d in diags {
        let label = match d.severity {
            Severity::Error => "error",
            Severity::Warning => "warning",
        };
        out.push_str(&format!("{label}: {}\n", d.message));
        if let Some(loc) = &d.location {
            snippet(loc, &mut out);
        }
        for hint in &d.hints {
            out.push_str(&format!("  = hint: {hint}\n"));
        }
        for frame in &d.trace {
            out.push_str(&format!("\nhelp: {}\n", frame.message));
            if let Some(loc) = &frame.location {
                snippet(loc, &mut out);
            }
        }
        out.push('\n');
    }
    out
}

fn snippet(loc: &Location, out: &mut String) {
    let number = loc.line.to_string();
    let pad = " ".repeat(number.len());
    out.push_str(&format!(
        "{pad} ┌─ {}:{}:{}\n{pad} │\n",
        loc.file, loc.line, loc.column
    ));
    // Carets under the part of the span that is on this line (at least one).
    let span_bytes = loc.range.1.saturating_sub(loc.range.0);
    let width = loc
        .line_text
        .chars()
        .skip(loc.column - 1)
        .scan(0usize, |bytes, c| {
            let start = *bytes;
            *bytes += c.len_utf8();
            (start < span_bytes).then_some(())
        })
        .count()
        .max(1);
    out.push_str(&format!("{number} │ {}\n", loc.line_text));
    out.push_str(&format!(
        "{pad} │ {}{}\n",
        " ".repeat(loc.column - 1),
        "^".repeat(width)
    ));
}
