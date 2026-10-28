// SPDX-License-Identifier: AGPL-3.0-or-later

//! The Typst service (ADR-0002 section 5): a sandboxed `World` per compile, embedded templates,
//! packages and fonts, structured diagnostics. Step 5a: World and rapport PDF.

mod compile;
mod diagnostics;
mod fonts;
mod rapport;
mod world;

pub use compile::{CompileError, Compiled, compile_document, compile_pdf, local_now};
pub use diagnostics::{Diagnostic, Location, Severity, TraceFrame, to_text};
pub use fonts::FontStore;
pub use rapport::{RapportData, rapport_world, render_rapport_pdf};
pub use world::{MaatwerkWorld, Mount, WorldSpec};
