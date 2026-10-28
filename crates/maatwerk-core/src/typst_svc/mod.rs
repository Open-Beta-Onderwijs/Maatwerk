// SPDX-License-Identifier: AGPL-3.0-or-later

//! The Typst service (ADR-0002 section 5): a sandboxed `World` per compile, embedded templates,
//! packages and fonts, structured diagnostics. Rapport (5a); opdracht projects, SVG pages, batch and merge (5b).

mod compile;
mod diagnostics;
mod fonts;
mod opdracht;
mod project;
mod rapport;
mod world;

pub use compile::{
    CompileError, Compiled, compile_document, compile_pdf, compile_svg_pages, local_now,
};
pub use diagnostics::{Diagnostic, Location, Severity, TraceFrame, to_text};
pub use fonts::FontStore;
pub use opdracht::{
    INPUTS_KEY, Mode, Observatie, OpdrachtHeader, OpdrachtInputs, opdracht_world,
    render_assignment_pdf, render_assignment_svg_pages,
};
pub use project::TypstProject;
pub use rapport::{RapportData, rapport_world, render_rapport_pdf};
pub use world::MaatwerkWorld;
